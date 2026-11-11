// Отделы и их начальники (v1.1 «Личный состав»).
// Игрок командует не каждым сотрудником, а начальниками отделов: ставит директиву (тихо/обычно/усиленно),
// даёт отделу самостоятельность, назначает начальника. Начальники сами решают, кого и куда посылать:
// УГРО — раскрытия, засады и рейды по наводкам; ППС — патрули и выезды; участковые — розыск и профилактика;
// дежурная часть — решения по вызовам; ИВС — конвой и камеры. Качество решений зависит от начальника:
// навыков, черт, усталости и настроения. Раз в сутки каждый отдел пишет доклад (бумага во «входящих»).
import { R, absNow, hourOf, num, sk, oName, rankShort, isDown, emit, glog, dep } from './city_util.js';
import { C, dist, liveTasks } from './city_core.js';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
import { dForm } from './city_data.js';
import { autoTask, availableOfficers } from './city_tasks.js';
import { answerRadio, dutySay } from './city_radio.js';
import { availableCount } from './city_crime.js';
import { authority as cityAuthority } from './city_core.js';
import { cases } from './cases.js';
import { deputy, deputyOf, appointDeputy, resolveDeputy } from './deputy.js';

export const DEPTS = [
  { id: 'ugro', name: 'Уголовный розыск', short: 'УГРО', genitive: 'уголовного розыска', roles: ['oper'], room: 'opers', headTitle: 'начальник УГРО' },
  { id: 'pps', name: 'Патрульно-постовая служба', short: 'ППС', genitive: 'ППС', roles: ['pps', 'driver', 'kinolog'], room: 'corridor', headTitle: 'командир взвода ППС' },
  { id: 'uchastok', name: 'Участковые инспекторы', short: 'участковые', genitive: 'службы участковых', roles: ['uchastkovy'], room: 'corridor', headTitle: 'старший участковый' },
  { id: 'duty', name: 'Дежурная часть', short: 'дежурная часть', genitive: 'дежурной части', roles: ['duty'], room: 'duty', headTitle: 'начальник дежурной части' },
  { id: 'ivs', name: 'Конвой и ИВС', short: 'ИВС', genitive: 'ИВС', roles: ['guard'], room: 'ivs', headTitle: 'начальник ИВС' },
  { id: 'sled', name: 'Следственное отделение', short: 'следствие', genitive: 'следственного отделения', roles: ['sledovatel'], room: 'opers', headTitle: 'начальник следственного отделения' },
  { id: 'spec', name: 'Спецподразделение', short: 'спецназ', genitive: 'спецподразделения', roles: ['spec'], room: 'armory', headTitle: 'командир спецподразделения' },
];
export const DEPT_BY_ID = Object.fromEntries(DEPTS.map((d) => [d.id, d]));
export const DIRECTIVES = [
  { id: 'quiet', label: 'Тихо', desc: 'Минимум выездов: люди отдыхают, бензин и нервы бережём. Отдел берёт только то, что нельзя не взять.' },
  { id: 'normal', label: 'Обычно', desc: 'Работа по обстановке: начальник решает сам, что важнее, не перегружая людей.' },
  { id: 'active', label: 'Усиленно', desc: 'Отдел работает на износ: больше нарядов, рейды по любой наводке. Усталость и жалобы растут.' },
];
export const SPEC_DIRECTIVES = [
  { id: 'standby', label: 'Резерв', desc: 'Спецподразделение сидит в оружейке и тренируется. Только оборона отдела и ваши прямые приказы.' },
  { id: 'ready', label: 'Готовность', desc: 'Угрозыск берёт бойцов на рейды и засады. При угрозе нападения командир сам вызывает свободных из дома.' },
  { id: 'active', label: 'Активно', desc: 'Командир сам организует рейды по наводкам и поднимает людей из дома. Усталость растёт, результаты — тоже.' },
];
const SPEC_IDS = SPEC_DIRECTIVES.map((x) => x.id);
const DIR_IDS = DIRECTIVES.map((x) => x.id);
export function directivesFor(deptId) { return deptId === 'spec' ? SPEC_DIRECTIVES : DIRECTIVES; }
const DIR_K = { quiet: 0.5, normal: 1, active: 1.6, standby: 0.5, ready: 1 };

/* ------------------------------------------------------------------ состояние */
function S(game) { const s = game.state; if (!s.departments) s.departments = {}; return s.departments; }
function staff(game) { return game.state.staff || []; }
function emptyStats() { return { tasks: 0, solved: 0, detained: 0, prevented: 0, calls: 0, missed: 0, raids: 0, searches: 0, papers: 0, refused: 0 }; }
function ensureDept(game, id) {
  const all = S(game);
  if (!all[id]) all[id] = { id, headId: null, directive: 'normal', autonomy: true, focusDistrict: null, stats: emptyStats(), today: emptyStats(), nextThink: 0, lastReportDay: 0, notes: [], trust: 50, unsigned: 0 };
  const d = all[id];
  if (!d.stats) d.stats = emptyStats(); if (!d.today) d.today = emptyStats(); if (!Array.isArray(d.notes)) d.notes = [];
  if (id === 'spec') { if (!SPEC_IDS.includes(d.directive)) d.directive = 'ready'; } else if (!DIR_IDS.includes(d.directive)) d.directive = 'normal';
  if (d.autonomy == null) d.autonomy = true; if (d.trust == null) d.trust = 50; if (d.unsigned == null) d.unsigned = 0;
  return d;
}
export function deptOfRole(role) { return DEPTS.find((d) => d.roles.includes(role)) || null; }
export function deptOf(game, officerId) { const o = staff(game).find((x) => x.id === officerId); return o ? deptOfRole(o.role) : null; }
export function members(game, deptId) { const def = DEPT_BY_ID[deptId]; if (!def) return []; return staff(game).filter((o) => def.roles.includes(o.role) && !['dead', 'fired', 'candidate'].includes(o.status)); }
export function head(game, deptId) { const d = ensureDept(game, deptId); const o = d.headId ? staff(game).find((x) => x.id === d.headId) : null; if (o && (['dead', 'fired'].includes(o.status) || !DEPT_BY_ID[deptId].roles.includes(o.role))) { d.headId = null; return null; } return o || null; }
export function isHead(game, officerId) { return DEPTS.some((d) => ensureDept(game, d.id).headId === officerId); }
export function headDeptId(game, officerId) { const d = DEPTS.find((x) => ensureDept(game, x.id).headId === officerId); return d ? d.id : null; }

/** Насколько хорош человек как начальник: 0..1 */
export function headScore(o) {
  if (!o) return 0;
  const rk = { 'капитан': 10, 'майор': 11, 'старший лейтенант': 8, 'лейтенант': 7, 'младший лейтенант': 6, 'старший прапорщик': 5.5, 'прапорщик': 5, 'старшина': 4.5, 'старший сержант': 4, 'сержант': 3, 'младший сержант': 2, 'рядовой': 1 }[o.rank] || 3;
  let s = 0.35 * sk(o, 'discipline') / 100 + 0.25 * sk(o, 'tactics') / 100 + 0.2 * sk(o, 'talk') / 100 + 0.2 * Math.min(1, rk / 10);
  const t = o.traits || [];
  if (t.includes('leader')) s += 0.15; if (t.includes('pedant')) s += 0.06; if (t.includes('ambitious')) s += 0.05; if (t.includes('veteran')) s += 0.05;
  if (t.includes('lazy')) s -= 0.15; if (t.includes('drinker')) s -= 0.1; if (t.includes('rookie')) s -= 0.25; if (t.includes('coward')) s -= 0.08;
  s += Math.min(0.1, (o.serviceYears || 0) * 0.008);
  return clamp(s, 0.05, 1);
}
/** Текущая «форма» начальника с учётом усталости, настроения и состояния: 0..1 */
export function headForm(o) {
  if (!o) return 0;
  let f = headScore(o);
  f *= 1 - Math.max(0, (num(o.fatigue, 20) - 60) / 100);
  f *= 0.75 + 0.25 * num(o.morale, 50) / 100;
  if (o.cond && o.cond.drunk > 0) f *= 0.4; if (o.cond && o.cond.hangover > 0) f *= 0.8;
  return clamp(f, 0.05, 1);
}
export function headQualityText(o) { const s = headScore(o); return s > 0.75 ? 'сильный руководитель' : s > 0.55 ? 'толковый' : s > 0.4 ? 'середняк' : s > 0.25 ? 'слабый' : 'никакой'; }

function pickHead(game, deptId) {
  const list = members(game, deptId).filter((o) => !['candidate'].includes(o.status));
  if (!list.length) return null;
  return list.slice().sort((a, b) => headScore(b) - headScore(a))[0];
}
export function appointHead(game, deptId, officerId, by = 'player') {
  const d = ensureDept(game, deptId); const def = DEPT_BY_ID[deptId]; if (!def) return { ok: false, reason: 'Нет такого отдела' };
  const o = officerId ? staff(game).find((x) => x.id === officerId) : null;
  if (officerId && !o) return { ok: false, reason: 'Сотрудник не найден' };
  if (o && !def.roles.includes(o.role)) return { ok: false, reason: `${oName(game, o)} не из этого отдела` };
  const prev = d.headId ? staff(game).find((x) => x.id === d.headId) : null;
  d.headId = o ? o.id : null;
  if (o) {
    o.flags = o.flags || {}; o.flags.headOf = deptId;
    if (prev && prev !== o) { prev.flags = prev.flags || {}; delete prev.flags.headOf; if (by === 'player') { prev.morale = clamp(num(prev.morale, 50) - 8, 0, 100); prev.history?.push?.({ day: game.state.time.day, text: `Снят с должности: ${def.headTitle}.` }); } }
    if (by === 'player') { o.morale = clamp(num(o.morale, 50) + 6, 0, 100); o.loyalty = clamp(num(o.loyalty, 50) + 4, 0, 100); }
    o.history?.push?.({ day: game.state.time.day, text: `Назначен${o.gender === 'f' ? 'а' : ''}: ${def.headTitle}.` });
    glog(game, `${def.headTitle[0].toUpperCase() + def.headTitle.slice(1)} — ${rankShort(o.rank)} ${o.lastName}.`, 'staff');
    emit(game, 'dept:head', { deptId, officerId: o.id, by });
  } else if (prev) { prev.flags = prev.flags || {}; delete prev.flags.headOf; emit(game, 'dept:head', { deptId, officerId: null, by }); }
  return { ok: true, officer: o };
}
export function setDirective(game, deptId, directive) { const d = ensureDept(game, deptId); if (!directivesFor(deptId).some((x) => x.id === directive)) return { ok: false }; d.directive = directive; emit(game, 'dept:directive', { deptId, directive }); return { ok: true }; }
export function setAutonomy(game, deptId, on) { const d = ensureDept(game, deptId); d.autonomy = !!on; return { ok: true }; }
export function setFocus(game, deptId, districtId) { const d = ensureDept(game, deptId); d.focusDistrict = districtId || null; return { ok: true }; }

/** Кто сейчас принимает решения за отдел: начальник, если он на месте; иначе старший из присутствующих (с штрафом) */
export function acting(game, deptId) {
  const h = head(game, deptId);
  const present = (o) => o && o.status === 'station' && o.onShift !== false && !isDown(o);
  if (h && present(h)) return { o: h, deputy: false };
  const list = members(game, deptId).filter(present).sort((a, b) => headScore(b) - headScore(a));
  return list[0] ? { o: list[0], deputy: true } : { o: null, deputy: true };
}

/* ------------------------------------------------------------------ наряды, которые отдел считает своими */
function deptTasks(game, deptId) {
  const def = DEPT_BY_ID[deptId];
  return liveTasks(game).filter((t) => (t.rt && t.rt.dept === deptId) || (!t.rt?.dept && (t.officerIds || []).some((id) => { const o = staff(game).find((x) => x.id === id); return o && def.roles.includes(o.role); })));
}
function freeOf(game, deptId) { const def = DEPT_BY_ID[deptId]; return availableOfficers(game).filter((o) => def.roles.includes(o.role) && o.role !== 'duty' && !(o.restUntil && absNow(game) < o.restUntil) && num(o.fatigue, 0) < 85); }
function note(game, d, text) { d.notes.push({ day: game.state.time.day, minute: game.state.time.minute, text }); if (d.notes.length > 24) d.notes.splice(0, d.notes.length - 24); }
function launched(game, d, r, label) {
  if (!r || !r.ok || !r.task) return false;
  if (typeof label === 'function') label = label(r.task);
  r.task.rt.dept = d.id; r.task.rt.byHead = true;
  d.stats.tasks++; d.today.tasks++;
  note(game, d, label);
  emit(game, 'dept:task', { deptId: d.id, taskId: r.task.id, label });
  return true;
}
function mistakeChance(form) { return clamp(0.35 - form * 0.33, 0.02, 0.35); }

/* ------------------------------------------------------------------ мозги начальников */
function thinkUgro(game, d, A, now, rng) {
  const k = DIR_K[d.directive] * (A.deputy ? 0.6 : 1); const form = headForm(A.o);
  const mine = deptTasks(game, 'ugro');
  const maxOpen = Math.max(1, Math.round(1 + 1.5 * k * (0.5 + form)));
  const free = freeOf(game, 'ugro');
  if (!free.length) return;
  const c = C(game);
  // 1. висяки: нераскрытые заявления без наряда
  if (mine.filter((t) => t.type === 'investigate').length < maxOpen) {
    const open = (c.crimes || []).filter((cr) => cr && ['new', 'unsolved'].includes(cr.status) && !cr.inProgress && !cr.assignedTaskId && !cr.missing && !cr.kuspPending && num(cr.severity, 1) >= (d.directive === 'quiet' ? 3 : 2))
      .filter((cr) => !liveTasks(game).some((t) => t.targetCrimeId === cr.id))
      .sort((a, b) => num(b.severity, 1) - num(a.severity, 1) || (d.focusDistrict ? (b.districtId === d.focusDistrict) - (a.districtId === d.focusDistrict) : 0));
    if (open.length) {
      // слабый начальник хватается не за то дело
      const cr = rng.chance(mistakeChance(form)) ? rng.pick(open) : open[0];
      const n = num(cr.severity, 1) >= 4 && free.length > 1 ? 2 : 1;
      const r = autoTask(game, 'investigate', { districtId: cr.districtId, targetCrimeId: cr.id, n, roles: ['oper'] });
      if (launched(game, d, r, (t) => `${rankShort(A.o.rank)} ${A.o.lastName} направил${A.o.gender === 'f' ? 'а' : ''} ${t.officerIds.length === 1 ? 'опера' : 'оперов'} на раскрытие: ${cr.title || 'дело'} (${dForm(cr.districtId, 'nom')}).`)) return;
    }
  }
  // 2. наводки: рейды и засады
  const intel = (c.intel || []).filter((it) => it.revealed && !it.used && it.expires > now && !it.reserved && it.opens && it.opens.length && !liveTasks(game).some((t) => t.targetId === it.id));
  for (const it of rng.shuffle(intel)) {
    const rel = num(it.reliability, 0.6);
    if (rel < (d.directive === 'active' ? 0.35 : d.directive === 'quiet' ? 0.75 : 0.55)) continue;
    if (it.window && it.window.from - now > 90) continue;
    const withSpec = ensureDept(game, 'spec').directive !== 'standby' && specAvailable(game).length >= 2;
    if (it.opens.includes('raid') && free.length + availableCount(game, ['pps']) + (withSpec ? specAvailable(game).length : 0) >= 3 && mine.filter((t) => t.type === 'raid').length === 0) {
      const r = autoTask(game, 'raid', { districtId: it.districtId, targetId: 'in:' + it.id, n: 4, roles: withSpec ? ['spec', 'oper'] : ['oper', 'pps'] });
      if (r && r.ok && withSpec) { const sd = ensureDept(game, 'spec'); sd.stats.raids++; sd.today.raids++; note(game, sd, `Бойцы ушли с угрозыском на рейд (${dForm(it.districtId, 'nom')}).`); }
      if (launched(game, d, r, `Рейд по наводке (${dForm(it.districtId, 'nom')}): ${it.text}`)) { d.stats.raids++; d.today.raids++; return; }
    }
    if (it.opens.includes('ambush') && mine.filter((t) => t.type === 'ambush').length === 0 && k >= 1) {
      const r = autoTask(game, 'ambush', { districtId: it.districtId, targetId: 'in:' + it.id, n: 3, roles: withSpec ? ['spec', 'oper'] : ['oper', 'pps'] });
      if (launched(game, d, r, `Засада по наводке (${dForm(it.districtId, 'nom')}): ${it.text}`)) return;
    }
  }
}
function thinkPps(game, d, A, now, rng) {
  const k = DIR_K[d.directive] * (A.deputy ? 0.6 : 1); const form = headForm(A.o);
  const h = hourOf(now);
  const want = d.directive === 'quiet' ? (h >= 20 || h < 4 ? 1 : 0) : d.directive === 'active' ? 2 + (h >= 18 || h < 3 ? 1 : 0) : 1 + (h >= 19 && h < 3 ? 1 : 0);
  const mine = deptTasks(game, 'pps');
  const patrols = liveTasks(game).filter((t) => t.type === 'patrol');
  const free = freeOf(game, 'pps');
  if (patrols.length >= want || free.length < 2) return;
  // не оголять участок: оставляем резерв
  const reserve = d.directive === 'active' ? 1 : 2;
  if (free.length - 2 < reserve && patrols.length >= 1) return;
  const c = C(game);
  let target = d.focusDistrict ? dist(game, d.focusDistrict) : null;
  if (!target) {
    const busy = new Set(patrols.map((t) => t.districtId));
    const cand = (c.districts || []).filter((x) => !busy.has(x.id));
    if (!cand.length) return;
    // по уровню преступности; слабый командир — куда попало
    const score = (x) => num(x.crime, 50) + (100 - num(x.trust, 40)) * 0.3 + rng.range(-8, 8);
    target = rng.chance(mistakeChance(form)) ? rng.pick(cand) : cand.sort((a, b) => score(b) - score(a))[0];
  }
  const r = autoTask(game, 'patrol', { districtId: target.id, n: 2, roles: ['pps', 'kinolog', 'driver'] });
  launched(game, d, r, `${rankShort(A.o.rank)} ${A.o.lastName} выставил${A.o.gender === 'f' ? 'а' : ''} патруль: ${dForm(target.id, 'nom')}.`);
  void mine; void k;
}
function thinkUchastok(game, d, A, now, rng) {
  const k = DIR_K[d.directive] * (A.deputy ? 0.6 : 1); const form = headForm(A.o);
  const free = freeOf(game, 'uchastok');
  if (!free.length) return;
  const c = C(game);
  const mine = deptTasks(game, 'uchastok');
  // розыск пропавших
  const missing = (c.crimes || []).filter((cr) => cr && cr.missing && cr.status !== 'resolved' && !cr.assignedTaskId && !liveTasks(game).some((t) => t.targetCrimeId === cr.id));
  if (missing.length && !mine.some((t) => t.type === 'search')) {
    const cr = missing[0];
    const r = autoTask(game, 'search', { districtId: cr.districtId, targetCrimeId: cr.id, n: 1, roles: ['uchastkovy'] });
    if (launched(game, d, r, `${rankShort(A.o.rank)} ${A.o.lastName} отправил${A.o.gender === 'f' ? 'а' : ''} участкового на розыск (${dForm(cr.districtId, 'nom')}).`)) { d.stats.searches++; d.today.searches++; return; }
  }
  // профилактический обход: район с низким доверием
  const h = hourOf(now);
  if (h >= 10 && h < 19 && k >= 1 && !mine.some((t) => t.type === 'patrol') && rng.chance(0.35 * form + 0.1)) {
    const cand = (c.districts || []).filter((x) => !liveTasks(game).some((t) => t.districtId === x.id && t.type === 'patrol'));
    const target = d.focusDistrict ? dist(game, d.focusDistrict) : cand.sort((a, b) => num(a.trust, 40) - num(b.trust, 40))[0];
    if (target) { const r = autoTask(game, 'patrol', { districtId: target.id, n: 1, roles: ['uchastkovy'] }); launched(game, d, r, `Участковый — на обход (${dForm(target.id, 'nom')}).`); }
  }
}
/* ------------------------------------------------------------------ спецподразделение */
/** Бойцы спецподразделения, готовые к выезду прямо сейчас */
export function specAvailable(game) {
  const now = absNow(game);
  return availableOfficers(game).filter((o) => o.role === 'spec' && !(o.restUntil && now < o.restUntil) && num(o.fatigue, 0) < 85);
}
function specMembers(game) { return members(game, 'spec'); }
function ensureGroupLeaders(game) {
  const mem = specMembers(game); if (mem.length < 3) return;
  const h = head(game, 'spec');
  const want = mem.length >= 5 ? 2 : 1;
  const cur = mem.filter((o) => o.flags && o.flags.groupLeader && o !== h);
  if (cur.length >= want) return;
  const cand = mem.filter((o) => o !== h && !(o.flags && o.flags.groupLeader)).sort((a, b) => headScore(b) + sk(b, 'tactics') / 200 - headScore(a) - sk(a, 'tactics') / 200);
  for (const o of cand.slice(0, want - cur.length)) { o.flags = o.flags || {}; o.flags.groupLeader = true; o.history?.push?.({ day: game.state.time.day, text: 'Назначен командиром группы спецподразделения.' }); }
}
/** Вызвать свободных от смены бойцов из дома */
function summonSpec(game, why) {
  const set = dep(game, 'staff', 'setShift'); if (!set) return 0;
  let n = 0;
  for (const o of specMembers(game)) {
    if (o.status !== 'home' || o.onShift) continue;
    const r = (() => { try { return set(game, o.id, true); } catch (e) { return null; } })();
    if (r && r.ok) n++;
  }
  if (n) note(game, ensureDept(game, 'spec'), `Из дома вызвано бойцов: ${n} (${why}).`);
  return n;
}
/** Группа обороны «Спецназ» (при предупреждении о нападении) */
export function specDefense(game, why) {
  const cb = game.combat; if (!cb || typeof cb.createGroup !== 'function') return null;
  const d = ensureDept(game, 'spec');
  if (d.directive !== 'standby') summonSpec(game, why);
  const here = specMembers(game).filter((o) => o.status === 'station' && !isDown(o));
  if (!here.length) { d.pendingGroup = true; return null; }
  const h = head(game, 'spec');
  const leader = (h && here.includes(h)) ? h : here.find((o) => o.flags && o.flags.groupLeader) || here.slice().sort((a, b) => headScore(b) - headScore(a))[0];
  const ids = here.map((o) => o.id);
  const groups = game.state.defense?.groups || [];
  // бойцы уходят из прочих групп
  for (const g of groups) { if (g.spec) continue; if (Array.isArray(g.memberIds)) g.memberIds = g.memberIds.filter((x) => !ids.includes(x)); if (ids.includes(g.leaderId)) { g.leaderId = (g.memberIds || []).shift() || null; } }
  const ex = groups.find((g) => g.spec);
  let r;
  try {
    if (ex) r = cb.updateGroup(ex.id, { leaderId: leader.id, memberIds: ids.filter((x) => x !== leader.id) });
    else { r = cb.createGroup({ name: 'Спецназ', leaderId: leader.id, memberIds: ids.filter((x) => x !== leader.id), zoneId: 'lobby', doctrine: { hold: 'counter', roe: 'free', fallbackAt: 0.25, note: 'Спецподразделение: контратака, держать вестибюль.' } }); if (r && r.group) r.group.spec = true; }
  } catch (e) { console.error('[dept spec group]', e); return null; }
  d.pendingGroup = false;
  note(game, d, `${rankShort(leader.rank)} ${leader.lastName}: группа «Спецназ» (${ids.length} чел.) — на рубеже в вестибюле.`);
  emit(game, 'dept:spec_group', { leaderId: leader.id, memberIds: ids });
  return r;
}
function thinkSpec(game, d, A, now, rng) {
  ensureGroupLeaders(game);
  if (d.pendingGroup && (game.state.attackPlans || []).some((p) => !p.done && !p.resolved)) specDefense(game, 'угроза нападения');
  if (d.directive !== 'active') return;
  const h = hourOf(now);
  if (d.summonDay !== game.state.time.day && h >= 9 && h < 21) { d.summonDay = game.state.time.day; summonSpec(game, 'режим «активно»'); }
  const free = specAvailable(game);
  if (free.length < 2 || deptTasks(game, 'spec').length >= 1) return;
  const c = C(game); const form = headForm(A.o);
  const intel = (c.intel || []).filter((it) => it.revealed && !it.used && it.expires > now && !it.reserved && it.opens && (it.opens.includes('raid') || it.opens.includes('ambush')) && !liveTasks(game).some((t) => t.targetId === 'in:' + it.id) && num(it.reliability, 0.6) >= 0.4 - form * 0.1);
  if (!intel.length) return;
  const it = rng.chance(mistakeChance(form)) ? rng.pick(intel) : intel.sort((a, b) => num(b.reliability, 0.5) - num(a.reliability, 0.5))[0];
  const type = it.opens.includes('raid') ? 'raid' : 'ambush';
  const r = autoTask(game, type, { districtId: it.districtId, targetId: 'in:' + it.id, n: Math.min(4, free.length + 1), roles: ['spec', 'oper'] });
  if (launched(game, d, r, `${rankShort(A.o.rank)} ${A.o.lastName}: ${type === 'raid' ? 'рейд' : 'засада'} по наводке (${dForm(it.districtId, 'nom')}).`)) { d.stats.raids++; d.today.raids++; }
}
function thinkSled(game, d, A) {
  try { cases.update(game, A ? A.o : null, d.autonomy); } catch (e) { console.error('[dept sled]', e); }
}
/* ------------------------------------------------------------------ распоряжения дежурной части */
function dutyOrders(game) { return (game.state.duty && game.state.duty.orders) || {}; }
function dutyDnd(game, now) { const o = dutyOrders(game); return !!(o.dndUntil && now < o.dndUntil); }
function holdAll(game, now) { const o = dutyOrders(game); return !!(o.holdUntil && now < o.holdUntil); }

/** Запросы по рации (вызовы, оперы, розыск), которые отделы берут на себя при самостоятельности */
function answerRequests(game, now, rng) {
  const list = game.state.radio || [];
  for (const m of list.slice(-30)) {
    if (!m || m.answered || !m.choices || !m.choices.length || !m.meta || !m.meta.type) continue;
    const type = m.meta.type; const deptId = type === 'call' ? 'duty' : type === 'oper' ? 'ugro' : type === 'missing' ? 'uchastok' : null;
    if (!deptId) continue;
    const d = ensureDept(game, deptId); if (!d.autonomy && !(deptId === 'duty' && dutyDnd(game, now))) continue;
    const A = acting(game, deptId); if (!A.o) continue;
    const form = headForm(A.o);
    // решение занимает время: сильный — минуту-две, слабый — тянет (может и не успеть)
    const born = m.day != null && m.minute != null ? (m.day - 1) * 1440 + m.minute : now;
    const delay = Math.round(1 + (1 - form) * 7 + (A.deputy ? 2 : 0));
    if (now - born < delay) continue;
    let choice = null;
    if (type === 'call') {
      const can = availableCount(game) > 0 && m.choices.some((c) => c.id === 'send_station');
      const redirect = m.choices.find((c) => c.id.startsWith('redirect:'));
      const lazy = (A.o.traits || []).includes('lazy');
      if (rng.chance(mistakeChance(form) * (lazy ? 1.8 : 1))) { choice = 'ignore'; d.stats.missed++; d.today.missed++; note(game, d, `${A.o.lastName}: вызов оставлен без наряда — «людей нет».`); }
      else if (can && (d.directive !== 'quiet' || rng.chance(0.5))) { choice = 'send_station'; d.stats.calls++; d.today.calls++; }
      else if (redirect) { choice = redirect.id; d.stats.calls++; d.today.calls++; }
      else { choice = 'ignore'; d.stats.missed++; d.today.missed++; }
    } else if (type === 'oper') {
      choice = m.choices.some((c) => c.id === 'send_oper') && freeOf(game, 'ugro').length && !rng.chance(mistakeChance(form) * 0.6) ? 'send_oper' : (m.choices[m.choices.length - 1].id);
      if (choice === 'send_oper') { d.stats.tasks++; d.today.tasks++; }
    } else if (type === 'missing') {
      choice = m.choices.some((c) => c.id === 'search_now') && (freeOf(game, 'uchastok').length || availableCount(game) > 2) ? 'search_now' : (m.choices[m.choices.length - 1].id);
      if (choice === 'search_now') { d.stats.searches++; d.today.searches++; }
    }
    if (!choice || !m.choices.some((c) => c.id === choice)) continue;
    const r = answerRadio(game, m.id, choice, true);
    if (r && r.ok) {
      m.byDept = deptId; m.byOfficer = A.o.id;
      const def = DEPT_BY_ID[deptId];
      const who = `${rankShort(A.o.rank)} ${A.o.lastName}`;
      const txt = choice === 'ignore' ? `${who} (${def.short}): наряд не высылаем — некого.` : choice === 'send_station' ? `${who}: высылаю наряд с участка.` : choice.startsWith('redirect:') ? `${who}: перенаправляю ближайший наряд.` : choice === 'send_oper' ? `${who}: опер выезжает.` : choice === 'search_now' ? `${who}: участковый — на поиски.` : `${who}: решено — ${choice}.`;
      dutySay(game, txt, 'info', { dept: deptId });
      emit(game, 'dept:decision', { deptId, officerId: A.o.id, msgId: m.id, choice });
    }
  }
}

/* ------------------------------------------------------------------ доклады */
function fmtStats(st) {
  const p = [];
  if (st.tasks) p.push(`нарядов направлено — ${st.tasks}`);
  if (st.solved) p.push(`раскрыто — ${st.solved}`);
  if (st.detained) p.push(`задержано — ${st.detained}`);
  if (st.prevented) p.push(`предотвращено — ${st.prevented}`);
  if (st.calls) p.push(`вызовов принято — ${st.calls}`);
  if (st.missed) p.push(`вызовов без наряда — ${st.missed}`);
  if (st.raids) p.push(`рейдов — ${st.raids}`);
  if (st.searches) p.push(`розысков — ${st.searches}`);
  return p.length ? p.join(', ') : 'происшествий по линии отдела не было';
}
/** Устный доклад начальника (для разговора и экрана) */
export function reportLines(game, deptId) {
  const def = DEPT_BY_ID[deptId]; const d = ensureDept(game, deptId); const A = acting(game, deptId);
  const mem = members(game, deptId); const on = mem.filter((o) => o.onShift && o.status === 'station'); const out = mem.filter((o) => o.status === 'task');
  const lines = [];
  if (!A.o) { lines.push(`${def.name}: докладывать некому — никого из отдела нет на месте.`); return lines; }
  lines.push(`${A.deputy ? 'За начальника ' + def.genitive : 'Начальник ' + def.genitive} — ${rankShort(A.o.rank)} ${A.o.lastName}. В отделе ${mem.length}, на месте ${on.length}, на заданиях ${out.length}.`);
  lines.push(`За сутки: ${fmtStats(d.today)}.`);
  const tired = mem.filter((o) => num(o.fatigue, 0) > 70).length;
  if (tired) lines.push(`${tired === 1 ? 'Один человек' : tired + ' человек'} на пределе усталости.`);
  if (d.unsigned >= 2) lines.push(`${d.unsigned} бумаг отдела лежат без вашей резолюции — люди ждут решений.`);
  const last = d.notes.slice(-3).map((n) => n.text);
  if (last.length) lines.push('Последнее: ' + last.join(' '));
  if (d.directive === 'active' && tired) lines.push('Режим «усиленно» людей выматывает, товарищ майор.');
  return lines;
}
/** Ежедневный доклад → бумага во «входящих». Если есть секретарь — бумага сначала «несётся», иначе ложится сразу */
function dailyPaper(game, deptId) {
  const def = DEPT_BY_ID[deptId]; const d = ensureDept(game, deptId); const A = acting(game, deptId);
  const rng = R(game);
  const st = d.today;
  const h = head(game, deptId);
  const who = h ? `${rankShort(h.rank)} ${h.lastName}` : A.o ? `и.о. — ${rankShort(A.o.rank)} ${A.o.lastName}` : 'и.о. не назначен';
  // просьбы отдела: чем хуже дела, тем больше просят
  const asks = [];
  const mem = members(game, deptId);
  const tired = mem.filter((o) => num(o.fatigue, 0) > 70);
  if (tired.length >= 2) asks.push({ id: 'rest', label: `Дать отделу день передышки`, desc: 'Снять директиву на сутки: усталость −, настроение +.', effect: 'rest' });
  if (mem.length <= 2 && !['duty', 'sled', 'spec'].includes(deptId)) asks.push({ id: 'people', label: 'Пообещать людей', desc: 'Начальник ждёт пополнения из кандидатов; если не будет — обида.', effect: 'people' });
  if ((st.missed || 0) >= 2) asks.push({ id: 'car', label: 'Выделить машину отделу в первую очередь', desc: 'Наряды отдела будут получать УАЗ первыми.', effect: 'car' });
  if ((st.solved || 0) + (st.detained || 0) >= 3 && A.o) asks.push({ id: 'bonus', label: `Премировать отличившихся (200 тыс.)`, desc: 'Деньги из кассы, настроение отдела +.', effect: 'bonus' });
  const text = [
    `${def.name}. Доклад за ${game.state.time.day - 1 > 0 ? 'прошедшие сутки' : 'сутки'}. ${who}.`,
    `Итоги: ${fmtStats(st)}.`,
    d.notes.filter((n) => n.day >= game.state.time.day - 1).slice(-4).map((n) => '— ' + n.text).join('\n'),
    asks.length ? 'Прошу рассмотреть.' : (A.o && (A.o.traits || []).includes('pedant') ? 'Замечаний нет. Подпись.' : rng.pick(['Жалоб нет.', 'Работаем.', 'Прошу ознакомиться.'])),
  ].filter(Boolean).join('\n');
  const choices = [{ id: 'sign', label: 'Подписать', desc: 'Принять к сведению.' }, ...asks, { id: 'return', label: 'Вернуть: «Переделать, мало»', desc: 'Начальник обидится, но в следующий раз напишет подробнее.' }];
  let extra = '';
  if (deptId === 'sled') { const cs = cases.stats(game); extra = `\nДел в производстве: ${cs.open}, готовы к передаче: ${cs.ready}, просрочено: ${cs.overdue}. Всего направлено в прокуратуру: ${cs.sent}, принято: ${cs.closed}, возвращено: ${cs.returned}.`; }
  if (deptId === 'spec') { const av = specAvailable(game).length; extra = `\nРежим: ${(SPEC_DIRECTIVES.find((x) => x.id === d.directive) || SPEC_DIRECTIVES[1]).label.toLowerCase()}. Готовы к выезду: ${av} из ${mem.length}.`; }
  const item = { source: 'dept', kind: 'dept_report', deptId, officerId: h ? h.id : A.o ? A.o.id : null, title: `Доклад: ${def.short}`, text: text + extra, choices, autoChoice: 'sign', expires: { day: game.state.time.day + 2, minute: 8 * 60 }, data: { asks: asks.map((a) => a.id) } };
  d.stats.papers++; d.unsigned++;
  // сброс суточной статистики
  d.today = emptyStats();
  // бумагу несёт секретарь (станция подхватит из очереди); если некому — ляжет на стол сама через час
  const s = game.state; if (!Array.isArray(s.papersQueue)) s.papersQueue = [];
  s.papersQueue.push({ id: 'pq' + Math.floor(R(game).next() * 1e9).toString(36), deptId, item, at: absNow(game), carried: false });
  emit(game, 'dept:paper', { deptId, item });
  return item;
}
/** Ответ игрока на бумагу отдела (из экрана «Бумаги») */
export function answerPaper(game, item, choiceId) {
  const d = ensureDept(game, item.deptId); const def = DEPT_BY_ID[item.deptId]; const h = head(game, item.deptId);
  d.unsigned = Math.max(0, d.unsigned - 1);
  const mem = members(game, item.deptId);
  const bump = (v) => { for (const o of mem) o.morale = clamp(num(o.morale, 50) + v, 0, 100); };
  switch (choiceId) {
    case 'sign': d.trust = clamp(d.trust + 2, 0, 100); return 'Подписано. Отдел работает дальше.';
    case 'rest': d.restDay = game.state.time.day + 1; bump(6); for (const o of mem) o.fatigue = clamp(num(o.fatigue, 0) - 15, 0, 100); d.trust = clamp(d.trust + 5, 0, 100); return `${def.name}: сутки без директивы, люди отдохнут.`;
    case 'people': d.promisedPeople = game.state.time.day + 5; d.trust = clamp(d.trust + 3, 0, 100); return 'Обещали пополнение. Начальник ждёт — не забудьте про кандидатов.';
    case 'car': for (const def0 of DEPTS) ensureDept(game, def0.id).carPriority = false; d.carPriority = true; d.trust = clamp(d.trust + 4, 0, 100); return `УАЗ — в первую очередь ${def.genitive}.`;
    case 'bonus': { const econ = game.state.economy; if (econ && econ.money >= 200) { econ.money -= 200; glog(game, `Премия отделу ${def.genitive}: −200 тыс.`, 'money'); bump(10); d.trust = clamp(d.trust + 8, 0, 100); if (h) h.loyalty = clamp(num(h.loyalty, 50) + 5, 0, 100); return 'Премия выплачена. В отделе оживление.'; } return 'В кассе нет двухсот тысяч — премия не выплачена, обещание повисло.'; }
    case 'return': bump(-3); d.trust = clamp(d.trust - 6, 0, 100); if (h) { h.morale = clamp(num(h.morale, 50) - 6, 0, 100); h.history?.push?.({ day: game.state.time.day, text: 'Доклад возвращён начальником на доработку.' }); } return 'Бумага вернулась в отдел. Начальник сжал зубы.';
    default: return 'Принято.';
  }
}

/* ------------------------------------------------------------------ учёт результатов нарядов */
function onTaskReturn(game, p) {
  const t = (C(game)?.tasks || []).find((x) => x.id === p.taskId); if (!t) return;
  const deptId = t.rt?.dept || (deptOf(game, t.leaderId)?.id) || null; if (!deptId) return;
  const d = ensureDept(game, deptId);
  const res = t.results || {};
  const det = (res.detainees || []).length, solved = num(res.crimesSolved, 0), prev = num(res.crimesPrevented, 0);
  d.stats.detained += det; d.today.detained += det; d.stats.solved += solved; d.today.solved += solved; d.stats.prevented += prev; d.today.prevented += prev;
  if (det || solved || prev) d.trust = clamp(d.trust + 1, 0, 100);
  if ((res.killed || []).length) { d.trust = clamp(d.trust - 10, 0, 100); note(game, d, `Потери в наряде ${t.rt?.callsign || ''}.`); }
}

/* ------------------------------------------------------------------ состав 1.1 */
/** Спецподразделение прибыло со своим оружием: автоматы, бронежилеты, каски — на склад и сразу бойцам */
function setupSpec(game) {
  const mem = specMembers(game); if (!mem.length) return;
  const all = S(game); if (all._specEquipped) return; all._specEquipped = true;
  ensureGroupLeaders(game);
  const e = game.state.economy; const issue = dep(game, 'economy', 'issue');
  if (e && e.inventory && issue) {
    const n = mem.length;
    for (const [k, q] of [['pm', n], ['aks74u', n], ['zh81', n], ['helmet_ssh68', n], ['radio_old', 2]]) e.inventory[k] = (e.inventory[k] || 0) + q;
    if (e.ammo) e.ammo['5.45x39'] = (e.ammo['5.45x39'] || 0) + 120 * n;
    for (const o of mem) for (const it of ['pm', 'aks74u', 'zh81', 'helmet_ssh68']) { try { issue(game, o.id, it, { silent: true }); } catch (er) { /* нет предмета — без него */ } }
    for (const o of mem.filter((x) => x.flags && x.flags.groupLeader).slice(0, 2)) { try { issue(game, o.id, 'radio_old', { silent: true }); } catch (er) { /* */ } }
  }
}
function migrateUnits(game, rng) {
  const st = game.state.staff || []; const mk = dep(game, 'staff', 'makeOfficer'); if (!mk) return 0;
  let n = 0;
  const add = (role, k) => { const o = mk(game, rng, { role }); o.status = 'home'; o.onShift = false; if (o.schedule === 'rotation') o.shiftGroup = k % 3; st.push(o); n++; return o; };
  if (!st.some((o) => o.role === 'sledovatel')) add('sledovatel', 0);
  if (!st.some((o) => o.role === 'spec')) for (let k = 0; k < 5; k++) add('spec', k);
  if (n) { for (const def of DEPTS) { ensureDept(game, def.id); if (!head(game, def.id)) { const h = pickHead(game, def.id); if (h) appointHead(game, def.id, h.id, 'init'); } } setupSpec(game); }
  return n;
}

/* ------------------------------------------------------------------ модуль */
export const departments = {
  DEPTS, DIRECTIVES,
  init(game) {
    const all = S(game);
    for (const def of DEPTS) {
      const d = ensureDept(game, def.id);
      if (!head(game, def.id)) { const h = pickHead(game, def.id); if (h) appointHead(game, def.id, h.id, 'init'); }
      d.nextThink = absNow(game) + R(game).int(5, 40);
    }
    try { setupSpec(game); } catch (e) { console.error('[dept spec init]', e); }
    this.attach(game);
    return all;
  },
  attach(game) {
    if (!game.bus || game._deptAttached) return;
    game._deptAttached = true;
    game.bus.on('task:return', (p) => { try { onTaskReturn(game, p); } catch (e) { console.error('[dept]', e); } });
    game.bus.on('attack:warning', () => { try { specDefense(game, 'предупреждение о нападении'); } catch (e) { console.error('[dept spec]', e); } });
    game.bus.on('attack:start', () => { try { if (!(game.state.defense?.groups || []).some((g) => g.spec)) specDefense(game, 'нападение'); } catch (e) { console.error('[dept spec]', e); } });
  },
  /** вызывается каждый игровой «тик» (dtMin минут) */
  update(game, dtMin) {
    if (!game.state || !game.state.city) return;
    this.attach(game);
    const now = absNow(game); const rng = R(game);
    const all = S(game);
    for (const def of DEPTS) {
      const d = ensureDept(game, def.id);
      if (d.restDay && d.restDay > game.state.time.day) continue;
      if (now < (d.nextThink || 0)) continue;
      const A = acting(game, def.id);
      const form = A.o ? headForm(A.o) : 0;
      d.nextThink = now + Math.round(12 + (1 - form) * 30 + rng.int(0, 10));
      if (def.id === 'sled') { thinkSled(game, d, A); continue; }
      if (!A.o || game.combat?.active) continue;
      if (!d.autonomy && def.id !== 'duty') continue;
      if (holdAll(game, now) && ['ugro', 'pps', 'uchastok', 'spec'].includes(def.id)) continue; // «всех на участок»
      // без начальника отдел «работает по инерции»: думает реже и хуже
      if (A.deputy && rng.chance(0.45)) continue;
      // бумаги без резолюции: начальник ждёт решений и работает вполсилы
      if (d.unsigned >= 3 && rng.chance(0.5)) { if (rng.chance(0.15)) note(game, d, 'Отдел ждёт резолюций по докладам.'); continue; }
      try {
        if (def.id === 'ugro') thinkUgro(game, d, A, now, rng);
        else if (def.id === 'pps') thinkPps(game, d, A, now, rng);
        else if (def.id === 'uchastok') thinkUchastok(game, d, A, now, rng);
        else if (def.id === 'spec') thinkSpec(game, d, A, now, rng);
      } catch (e) { console.error('[dept ' + def.id + ']', e); }
    }
    if (((this._reqT = (this._reqT || 0) + dtMin)) >= 1) { this._reqT = 0; try { answerRequests(game, now, rng); } catch (e) { console.error('[dept requests]', e); } }
    try { deputy.update(game, dtMin, headScore, headForm); } catch (e) { console.error('[deputy]', e); }
    // бумаги, которые никто не понёс
    const q = game.state.papersQueue; if (Array.isArray(q) && q.length) { for (const pq of q.slice()) { if (!pq.carried && now - pq.at > 60) { this.deliverPaper(game, pq.id, null); } } }
    void all;
  },
  dayStart(game) {
    const all = S(game);
    try { cases.dayStart(game); } catch (e) { console.error('[cases]', e); }
    // бойцы, тренировавшиеся вчера, прибавляют в огневой и тактике
    for (const o of specMembers(game)) if (o.flags && o.flags.specTrainDay >= game.state.time.day - 1 && o.skills) { for (const k of ['shooting', 'tactics', 'fitness']) o.skills[k] = Math.min(95, num(o.skills[k], 50) + 0.4); }
    ensureGroupLeaders(game);
    for (const def of DEPTS) {
      const d = ensureDept(game, def.id);
      if (!head(game, def.id)) { const h = pickHead(game, def.id); if (h) appointHead(game, def.id, h.id, 'auto'); }
      if (d.restDay && d.restDay <= game.state.time.day) d.restDay = null;
      if (d.promisedPeople && d.promisedPeople <= game.state.time.day) { d.promisedPeople = null; if (members(game, def.id).length <= 2) { d.trust = clamp(d.trust - 8, 0, 100); const h = head(game, def.id); if (h) h.morale = clamp(num(h.morale, 50) - 5, 0, 100); } }
      if (game.state.time.day > 1 && d.lastReportDay !== game.state.time.day) { d.lastReportDay = game.state.time.day; try { dailyPaper(game, def.id); } catch (e) { console.error('[dept paper]', e); } }
    }
    return all;
  },
  /** Положить бумагу на стол начальника (из очереди). who — секретарь (officerId) или null */
  deliverPaper(game, queueId, who = null) {
    const q = game.state.papersQueue || []; const k = q.findIndex((x) => x.id === queueId); if (k < 0) return null;
    const [pq] = q.splice(k, 1);
    const push = dep(game, 'staff', 'pushInbox');
    const item = push ? push(game, { ...pq.item, data: { ...(pq.item.data || {}), carriedBy: who } }) : null;
    emit(game, 'dept:paper_delivered', { deptId: pq.deptId, item, who });
    return item;
  },
  /** Очередь бумаг, ожидающих секретаря */
  pendingPapers(game) { return (game.state.papersQueue || []).filter((x) => !x.carried); },
  // API
  head, acting, members, deptOf, deptOfRole, isHead, headDeptId, appointHead, setDirective, setAutonomy, setFocus, headScore, headForm, headQualityText, reportLines, answerPaper,
  SPEC_DIRECTIVES, directivesFor, specAvailable, specDefense, cases,
  deputy(game) { return deputyOf(game); },
  appointDeputy(game, officerId) { return appointDeputy(game, officerId, headScore); },
  deputyActive(game) { return deputy.deputyActive(game); },
  sendCase(game, caseId) { return cases.sendCase(game, caseId, 'player'); },
  /** Ответ на бумаги заместителя/следствия/спецподразделения */
  resolveInbox(game, it, choiceId) {
    if (it.source === 'deputy') return resolveDeputy(game, it, choiceId);
    if (it.source === 'cases' && it.data && it.data.caseId) { if (choiceId === 'send') { const r = cases.sendCase(game, it.data.caseId, 'player'); return r.ok ? r.text : r.reason; } return 'Дело остаётся в производстве.'; }
    return 'Принято.';
  },
  /** Сохранения до 1.1: добавить следователя и спецподразделение */
  migrate(game, rng) { return migrateUnits(game, rng); },
  get(game, id) { return ensureDept(game, id); },
  all(game) { return DEPTS.map((def) => ({ def, d: ensureDept(game, def.id), head: head(game, def.id), acting: acting(game, def.id), members: members(game, def.id) })); },
  /** Доклад начальника на планёрке (утро) — строки для брифинга */
  briefingLines(game) { return DEPTS.map((def) => { const A = acting(game, def.id); const d = ensureDept(game, def.id); return A.o ? `${def.short}: ${rankShort(A.o.rank)} ${A.o.lastName}${A.deputy ? ' (и.о.)' : ''} — ${directivesFor(def.id).find((x) => x.id === d.directive)?.label.toLowerCase() || ''}${d.autonomy ? '' : ', по команде'}.` : `${def.short}: начальника нет.`; }); },
};
export default departments;
