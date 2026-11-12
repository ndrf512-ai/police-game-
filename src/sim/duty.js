// Дежурная часть (v1.1): журнал КУСП (книга учёта сообщений о преступлениях), передача сообщений отделам,
// контроль обстановки (кто свободен, кто на выезде, последний доклад), доклад игроку в дежурке, распоряжения.
// Слабый дежурный регистрирует с опозданием и теряет записи: доверие районов падает, угрозыск позже берётся за дела.
import { CRIME_TYPE_BY_ID } from './crimes.js';
import { R, absNow, num, rankShort, oName, emit, glog, dep, hhmm, dmOf } from './city_util.js';
import { C, liveTasks, trust, authority } from './city_core.js';
import { dForm } from './city_data.js';
import { docs } from './docs.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const CAP = 300;
const SRC = { call: 'телефон', phone: 'телефон', visitor: 'заявитель', dispatch: 'Гранит', report: 'заявление', radio: 'эфир', detainee: 'доставлен', patrol: 'наряд' };
export const STATUS_NAMES = { registered: 'зарегистрировано', assigned: 'передано отделу', in_progress: 'в работе', closed: 'закрыто', refused: 'отказано' };
const DEPT_SHORT = { ugro: 'УГРО', pps: 'ППС', uchastok: 'участковые', duty: 'ДЧ', ivs: 'ИВС', sled: 'следствие', spec: 'спецназ' };

function emptyDay() { return { registered: 0, late: 0, lost: 0, closed: 0, refused: 0 }; }
export function dutyState(game) {
  const s = game.state;
  if (!s.duty || typeof s.duty !== 'object') s.duty = {};
  const d = s.duty;
  if (!Array.isArray(d.journal)) d.journal = [];
  if (!Array.isArray(d.pending)) d.pending = [];
  if (!d.stats || typeof d.stats !== 'object') d.stats = { registered: 0, late: 0, lost: 0, closed: 0, refused: 0 };
  if (!d.today || typeof d.today !== 'object') d.today = emptyDay();
  if (!d.orders || typeof d.orders !== 'object') d.orders = { reinforce: false, holdUntil: null, dndUntil: null };
  if (!Number.isFinite(d.seq)) d.seq = d.journal.length;
  if (!Number.isFinite(d.lastPlayerReport)) d.lastPlayerReport = -9999;
  if (!Number.isFinite(d.lastPoll)) d.lastPoll = 0;
  return d;
}
function depts(game) { return game.sim && game.sim.departments; }
function crimeById(game, id) { return id ? (C(game)?.crimes || []).find((c) => c.id === id) || null : null; }
/** Дежурный, который сейчас отвечает за журнал, и его «форма» */
export function dutyOfficer(game) {
  const D = depts(game);
  let o = null; let deputyPen = false;
  try { const A = D && D.acting ? D.acting(game, 'duty') : null; o = A && A.o; deputyPen = !!(A && A.deputy); } catch (e) { o = null; }
  if (!o) o = (game.state.staff || []).find((x) => x.role === 'duty' && x.onShift && x.status === 'station') || null;
  let form = o ? (D && D.headForm ? D.headForm(o) : 0.5) : 0.15;
  if (deputyPen) form *= 0.9;
  if (dutyState(game).orders.reinforce) form += 0.2;
  return { o, form: clamp(form, 0.05, 1) };
}

/* ------------------------------------------------------------------ регистрация */
function deptFor(cr, source) {
  if (source === 'detainee') return ['ivs', null];
  if (!cr) return ['uchastok', null];
  if (cr.missing) return ['uchastok', cr.severity >= 4 ? 'ugro' : null];
  const sev = num(cr.severity, 1);
  // тип происшествия сам говорит, какие отделы нужны (crime_types_v11: depts, multi)
  const tdef = CRIME_TYPE_BY_ID[cr.typeId];
  if (tdef && Array.isArray(tdef.depts) && tdef.depts.length) {
    const ds = tdef.depts.filter((x) => ['ugro', 'pps', 'uchastok', 'duty', 'sled', 'spec', 'ivs'].includes(x) && x !== 'duty');
    if (cr.inProgress && !ds.includes('pps')) ds.unshift('pps');
    if (ds.length) return [ds[0], (tdef.multi || sev >= 4) ? (ds[1] || null) : null];
  }
  if (cr.inProgress) return ['pps', sev >= 4 ? 'ugro' : null];
  switch (cr.category) {
    case 'violent': return ['ugro', sev >= 4 ? 'pps' : null];
    case 'property': case 'drugs': case 'organized': case 'economic': return ['ugro', null];
    case 'domestic': return ['uchastok', sev >= 3 ? 'ugro' : null];
    case 'public_order': case 'traffic': return ['pps', null];
    default: return ['uchastok', null];
  }
}
function crimeText(cr) { return `${cr.title ? cr.title[0].toUpperCase() + cr.title.slice(1) : 'Происшествие'} ${cr.place && cr.place.prep ? cr.place.prep : ''}`.trim() + '.'; }
function known(d, key) { return d.journal.some((e) => e.key === key) || d.pending.some((p) => p.entry.key === key); }

function addEntry(game, e, late = false) {
  const d = dutyState(game); const t = game.state.time;
  d.seq++;
  const entry = { no: d.seq, day: t.day, minute: Math.floor(t.minute), source: e.source, text: String(e.text || '').slice(0, 240), districtId: e.districtId || null, crimeId: e.crimeId || null, detId: e.detId || null, deptId: e.deptId || null, deptId2: e.deptId2 || null, status: e.status || 'registered', closedDay: null, key: e.key, late: !!late };
  d.journal.push(entry);
  d.stats.registered++; d.today.registered++;
  if (e.crimeId) { const cr = crimeById(game, e.crimeId); if (cr) { cr.kuspPending = false; cr.kuspNo = entry.no; } }
  if (d.journal.length > CAP) { const k = d.journal.findIndex((x) => x.status === 'closed' || x.status === 'refused'); d.journal.splice(k >= 0 ? k : 0, 1); }
  emit(game, 'duty:registered', { no: entry.no, crimeId: entry.crimeId, deptId: entry.deptId });
  return entry;
}

/** Зарегистрировать сообщение. Слабый дежурный — с опозданием или теряет запись. */
export function register(game, e) {
  const d = dutyState(game); const rng = R(game);
  if (!e.key) e.key = e.crimeId ? 'cr:' + e.crimeId : e.detId ? 'det:' + e.detId : 'm:' + absNow(game) + ':' + rng.int(0, 1e6);
  if (known(d, e.key)) return null;
  const cr = crimeById(game, e.crimeId);
  if (!e.deptId) { const [a, b] = deptFor(cr, e.source); e.deptId = a; e.deptId2 = b; }
  const { o, form } = dutyOfficer(game);
  const lazy = o && (o.traits || []).includes('lazy');
  const urgent = e.source === 'dispatch' || e.source === 'detainee' || e.source === 'radio' || (cr && cr.inProgress);
  if (!urgent) {
    const lostP = clamp(0.16 - form * 0.2, 0, 0.14) * (lazy ? 1.7 : 1);
    if (rng.chance(lostP)) {
      d.stats.lost++; d.today.lost++;
      if (e.districtId) trust(game, e.districtId, -1.2);
      if (cr) cr.kuspPending = true;
      d.pending.push({ at: absNow(game) + 24 * 60, lost: true, entry: e });
      return null;
    }
    const delay = form >= 0.6 ? 0 : Math.round((0.6 - form) * 120 * rng.range(0.5, 1.2) * (lazy ? 1.4 : 1));
    if (delay >= 10) { if (cr) cr.kuspPending = true; d.pending.push({ at: absNow(game) + delay, entry: e }); return null; }
  }
  return addEntry(game, e);
}
function flushPending(game, now) {
  const d = dutyState(game);
  if (!d.pending.length) return;
  const due = d.pending.filter((p) => p.at <= now);
  if (!due.length) return;
  d.pending = d.pending.filter((p) => p.at > now);
  for (const p of due) {
    const cr = crimeById(game, p.entry.crimeId);
    if (p.lost) {
      // запись всплыла после жалобы заявителя
      p.entry.text = `${p.entry.text} (зарегистрировано по жалобе заявителя — сутки пролежало без записи)`;
      if (p.entry.districtId) trust(game, p.entry.districtId, -0.8);
    } else { d.stats.late++; d.today.late++; if (p.entry.districtId) trust(game, p.entry.districtId, -0.3); }
    if (cr && cr.status === 'resolved') p.entry.status = 'closed';
    addEntry(game, p.entry, true);
  }
}

/* ------------------------------------------------------------------ события шины */
function onCrime(game, cr) {
  if (!cr || !cr.id) return;
  const [a, b] = deptFor(cr, cr.source);
  register(game, { source: cr.source || 'report', text: crimeText(cr), districtId: cr.districtId, crimeId: cr.id, deptId: a, deptId2: b, key: 'cr:' + cr.id });
}
function onVisitor(game, v) {
  if (!v) return;
  if (v.crime && v.crime.id) return onCrime(game, v.crime);
  if (v.isFake) return;
  const txt = typeof v.complaint === 'string' && v.complaint ? v.complaint : 'Гражданин с жалобой.';
  register(game, { source: 'visitor', text: `Обращение: ${txt}`.slice(0, 200), districtId: v.districtId || (v.district && v.district.id) || null, deptId: 'uchastok', status: 'assigned' });
}
function onCall(game, call) {
  if (!call) return;
  if (call.crime && call.crime.id) return onCrime(game, call.crime);
  const txt = typeof call.callerDesc === 'string' ? call.callerDesc : 'Звонок без подробностей.';
  register(game, { source: 'call', text: `Звонок: ${txt}`.slice(0, 200), deptId: 'pps', status: 'assigned' });
}
function onRadio(game, m) {
  if (!m) return;
  if (m.meta && m.meta.crimeId) { const cr = crimeById(game, m.meta.crimeId); if (cr) onCrime(game, cr); return; }
  if (m.kind === 'alarm' && m.from === 'dispatch') register(game, { source: 'radio', text: `Гранит: ${m.text}`.slice(0, 200), deptId: 'duty', status: 'in_progress', key: 'rm:' + m.id });
}
function onDetainee(game, det) {
  if (!det) return;
  const p = det.person || {};
  register(game, { source: 'detainee', text: `Доставлен${p.gender === 'f' ? 'а' : ''}: ${p.lastName || ''} ${p.firstName || ''} — ${det.charge || 'без статьи'}.`.replace(/\s+/g, ' '), crimeId: null, detId: det.id, deptId: 'ivs', status: 'in_progress', key: 'det:' + det.id });
}

/* ------------------------------------------------------------------ статусы */
function poll(game, now) {
  const d = dutyState(game);
  const { form } = dutyOfficer(game);
  const live = liveTasks(game);
  const day = game.state.time.day;
  for (const e of d.journal) {
    if (e.status === 'closed' || e.status === 'refused') continue;
    const age = now - ((e.day - 1) * 1440 + e.minute);
    if (e.status === 'registered' && age >= Math.round((1 - form) * 30)) e.status = 'assigned';
    if (e.detId) {
      const det = (game.state.detainees || []).find((x) => x.id === e.detId);
      if (!det || det.status !== 'cell') { e.status = 'closed'; e.closedDay = day; d.stats.closed++; d.today.closed++; }
      continue;
    }
    if (e.crimeId) {
      const cr = crimeById(game, e.crimeId);
      if (!cr) { if (age > 2 * 1440) { e.status = 'closed'; e.closedDay = day; } continue; }
      if (cr.status === 'resolved') { e.status = 'closed'; e.closedDay = day; d.stats.closed++; d.today.closed++; continue; }
      if (cr.dropped) { e.status = 'refused'; e.closedDay = day; d.stats.refused++; d.today.refused++; continue; }
      const working = cr.status === 'responding' || (cr.assignedTaskId && live.some((t) => t.id === cr.assignedTaskId)) || live.some((t) => t.targetCrimeId === cr.id);
      if (working) { e.status = 'in_progress'; continue; }
      if (e.status === 'in_progress') e.status = 'assigned';
      // решение по материалу — в трёхдневный срок: возбуждено (дело у следствия) или отказной материал
      if (age > 3 * 1440 && !cr.inProgress) {
        const hasCase = (game.state.cases || []).some((x) => x.crimeId === cr.id);
        e.status = hasCase ? 'closed' : 'refused'; e.closedDay = day; e.note = hasCase ? 'передано в следствие' : 'отказной материал';
        if (hasCase) { d.stats.closed++; d.today.closed++; } else { d.stats.refused++; d.today.refused++; }
      }
      continue;
    }
    // обращения без состава: участковый проверяет и закрывает
    if (age > 6 * 60) { e.status = age > 12 * 60 && e.source === 'call' ? 'refused' : 'closed'; e.closedDay = day; if (e.status === 'closed') { d.stats.closed++; d.today.closed++; } else { d.stats.refused++; d.today.refused++; } }
  }
  // опрос: преступления, о которых шина не сообщила (например, из старых сохранений)
  const crimes = C(game)?.crimes || [];
  for (let k = Math.max(0, crimes.length - 12); k < crimes.length; k++) { const cr = crimes[k]; if (cr && cr.reported && cr.status !== 'resolved' && now - ((cr.day - 1) * 1440 + cr.minute) < 600) onCrime(game, cr); }
}

/* ------------------------------------------------------------------ обстановка */
export function overview(game) {
  const D = depts(game); const now = absNow(game);
  const byDept = [];
  for (const def of (D && D.DEPTS) || []) {
    const mem = (game.state.staff || []).filter((o) => def.roles.includes(o.role) && !['dead', 'fired', 'candidate'].includes(o.status));
    const here = mem.filter((o) => o.status === 'station' && o.onShift);
    const free = here.filter((o) => !(o.restUntil && now < o.restUntil) && num(o.fatigue, 0) < 85 && num(o.hp, 100) > 15);
    byDept.push({ id: def.id, short: def.short, total: mem.length, here: here.length, free: free.length, out: mem.filter((o) => o.status === 'task').length });
  }
  const crews = liveTasks(game).map((t) => {
    const last = (t.log || [])[t.log.length - 1] || null;
    return { id: t.id, callsign: (t.rt && t.rt.callsign) || 'Наряд', type: t.type, districtId: t.districtId, phase: t.phase, n: (t.officerIds || []).length, last: last ? { day: last.day, minute: last.minute, text: last.text } : null, ago: last ? now - ((last.day - 1) * 1440 + last.minute) : null };
  });
  let lastReport = null;
  for (const m of (game.state.radio || []).slice(-60).reverse()) { if (m.taskId && m.kind === 'report') { lastReport = { callsign: m.callsign, day: m.day, minute: m.minute, text: m.text }; break; } }
  const veh = (game.state.economy?.vehicles || []).map((v) => ({ id: v.id, name: v.name || v.id, status: v.status }));
  return { byDept, crews, lastReport, vehicles: veh, silent: crews.filter((c) => c.phase === 'active' && c.ago != null && c.ago > 90) };
}
export function stats(game) {
  const d = dutyState(game);
  const open = d.journal.filter((e) => !['closed', 'refused'].includes(e.status)).length;
  const { o, form } = dutyOfficer(game);
  return { ...d.stats, today: { ...d.today }, open, pending: d.pending.filter((p) => !p.lost).length, quality: Math.round(form * 100), officerId: o ? o.id : null };
}

/* ------------------------------------------------------------------ доклад игроку в дежурке */
function playerReport(game, now) {
  const d = dutyState(game);
  if (now - d.lastPlayerReport < 30 || dnd(game, now)) return;
  const W = game.world; const P = game.player; if (!W || !P || typeof W.zoneAt !== 'function') return;
  if (W.zoneAt(P.x, P.z) !== 'duty') return;
  const a = game.station && typeof game.station.deskActor === 'function' ? game.station.deskActor() : null;
  if (!a || typeof a.say !== 'function') return;
  d.lastPlayerReport = now;
  const st = stats(game); const ov = overview(game);
  const pr = game.state.player || {}; const rank = pr.rank || 'майор';
  const lines = [];
  lines.push(`Товарищ ${rank}, за смену в КУСП ${st.today.registered} ${plural(st.today.registered, 'запись', 'записи', 'записей')}, в работе ${st.open}.`);
  const out = ov.crews.filter((c) => c.phase !== 'done').slice(0, 3).map((c) => `${c.callsign} — ${dForm(c.districtId, 'nom')}`);
  const free = ov.byDept.filter((x) => x.free > 0 && ['pps', 'ugro', 'spec', 'uchastok'].includes(x.id)).map((x) => `${x.short} ${x.free}`);
  lines.push(`${out.length ? 'На выезде: ' + out.join(', ') + '.' : 'Все наряды на месте.'} ${free.length ? 'Свободны: ' + free.join(', ') + '.' : 'Свободных людей нет.'}`);
  if (ov.silent.length) lines.push(`${ov.silent[0].callsign} молчит больше полутора часов. Вызываю.`);
  else if (st.today.lost && st.officerId && st.quality < 45) lines.push('Тут… пара звонков, может, не записана. Разберусь.');
  else if (ov.lastReport) lines.push(`Последний доклад — ${ov.lastReport.callsign} в ${hhmm(ov.lastReport.minute)}.`);
  game._dutyTalk = { actor: a, lines, next: 0 };
  emit(game, 'duty:report', { lines });
}
function plural(n, a, b, c) { const x = Math.abs(n) % 100, y = x % 10; if (x > 10 && x < 20) return c; if (y > 1 && y < 5) return b; if (y === 1) return a; return c; }
function talkTick(game) {
  const t = game._dutyTalk; if (!t) return;
  const rt = game.realTime || 0;
  if (rt < t.next) return;
  const line = t.lines.shift();
  if (!line || !t.actor || t.actor.alive === false) { game._dutyTalk = null; return; }
  const dur = clamp(line.length * 0.065, 2.5, 7);
  try { t.actor.say(line, dur); t.actor.playAnim?.('talk', 2); } catch (e) { /* актор ушёл */ }
  t.next = rt + dur + 0.4;
}

/* ------------------------------------------------------------------ распоряжения */
function dnd(game, now) { const o = dutyState(game).orders; return !!(o.dndUntil && now < o.dndUntil); }
export function setReinforce(game, on) {
  const d = dutyState(game); d.orders.reinforce = !!on;
  const D = depts(game);
  try { D?.setDirective?.(game, 'duty', on ? 'active' : 'normal'); if (on) D?.setAutonomy?.(game, 'duty', true); } catch (e) { console.error('[duty]', e); }
  glog(game, on ? 'Дежурная часть усилена: помощник за вторым пультом, вызовы — без задержек.' : 'Дежурная часть — в обычном режиме.', 'staff');
  return { ok: true, text: on ? 'Дежурку усилили. Люди устают быстрее, зато ничего не теряется.' : 'Обычный режим дежурной части.' };
}
export function allIn(game, minutes = 120) {
  const d = dutyState(game); const now = absNow(game);
  d.orders.holdUntil = minutes ? now + minutes : null;
  if (!minutes) return { ok: true, text: 'Отделы снова работают по своим директивам.' };
  const cancel = dep(game, 'city', 'cancelTask'); let n = 0;
  for (const t of liveTasks(game)) if (['patrol', 'guard', 'ambush', 'search', 'investigate'].includes(t.type) && t.phase !== 'returning') { try { const r = cancel && cancel(game, t.id); if (r && r.ok) n++; } catch (e) { /* */ } }
  glog(game, `Распоряжение дежурному: всех на участок (${n} нарядов отозвано).`, 'important');
  return { ok: true, text: n ? `Отозвано нарядов: ${n}. Отделы два часа без самостоятельных выездов.` : 'Все и так на месте. Отделы два часа сидят на участке.' };
}
export function doNotDisturb(game, minutes) {
  const d = dutyState(game); const now = absNow(game);
  d.orders.dndUntil = minutes ? now + minutes : null;
  if (minutes) { try { depts(game)?.setAutonomy?.(game, 'duty', true); } catch (e) { /* */ } }
  return { ok: true, text: minutes ? `До ${hhmm((now + minutes) % 1440)} дежурный решает сам и не докладывает.` : 'Дежурный снова докладывает вам.' };
}

/* ------------------------------------------------------------------ последствия, бумаги */
function morningCheck(game) {
  const d = dutyState(game); const rng = R(game);
  const lost = d.today.lost; const late = d.today.late;
  if ((lost >= 1 && rng.chance(0.6)) || late >= 4) {
    const { o } = dutyOfficer(game);
    const push = dep(game, 'staff', 'pushInbox');
    if (push) push(game, {
      source: 'duty', kind: 'kusp_complaint', officerId: o ? o.id : null, title: 'Жалоба: заявление не зарегистрировано',
      text: `Гражданка дошла до прокуратуры: заявление «не приняли, а потом сказали — не было». За сутки дежурная часть ${lost ? `потеряла записей: ${lost}` : ''}${lost && late ? ', ' : ''}${late ? `зарегистрировала с опозданием: ${late}` : ''}.${o ? ` Дежурил${o.gender === 'f' ? 'а' : ''} ${oName(game, o)}.` : ''}`,
      choices: [
        o ? { id: 'reprimand', label: 'Выговор дежурному', desc: 'Дежурный подтянется (дисциплина +), но обидится.' } : null,
        { id: 'reinforce', label: 'Усилить дежурную часть', desc: 'Второй человек за пульт — меньше потерь, люди устают.' },
        { id: 'cover', label: 'Замять', desc: 'Прокурор запомнит: авторитет −2.' },
      ].filter(Boolean),
      autoChoice: 'cover', expires: { day: game.state.time.day + 1, minute: 8 * 60 }, data: { officerId: o ? o.id : null },
    });
  }
}
export function resolveInbox(game, it, choiceId) {
  if (it.source === 'docs') return docs.resolve(game, it, choiceId);
  if (it.kind === 'kusp_complaint') {
    if (choiceId === 'reprimand' && it.data && it.data.officerId) { const f = dep(game, 'staff', 'reprimand'); const r = f ? f(game, it.data.officerId, 'written') : null; const o = (game.state.staff || []).find((x) => x.id === it.data.officerId); if (o && o.skills) o.skills.discipline = Math.min(95, num(o.skills.discipline, 50) + 3); return (r && r.text) || 'Выговор объявлен.'; }
    if (choiceId === 'reinforce') return setReinforce(game, true).text;
    authority(game, -2, 'жалоба на нерегистрацию заявления'); return 'Замяли. В прокуратуре поставили галочку.';
  }
  return 'Принято.';
}

/* ------------------------------------------------------------------ модуль */
export const duty = {
  init(game) { dutyState(game); this.attach(game); return game.state.duty; },
  attach(game) {
    if (!game.bus || game._dutyAttached) return;
    game._dutyAttached = true;
    const on = (ev, fn) => game.bus.on(ev, (p) => { try { if (game.state) fn(p || {}); } catch (e) { console.error('[duty ' + ev + ']', e); } });
    on('crime:new', (p) => onCrime(game, p.crime));
    on('visitor:arrive', (p) => onVisitor(game, p.visitor));
    on('call:incoming', (p) => onCall(game, p.call));
    on('radio', (p) => onRadio(game, p.msg));
    on('detainee:new', (p) => onDetainee(game, p.detainee));
    on('task:return', () => { dutyState(game).lastPoll = 0; });
  },
  update(game, dtMin) {
    if (!game.state || !game.state.city) return;
    this.attach(game);
    const d = dutyState(game); const now = absNow(game);
    talkTick(game);
    if (now - d.lastPoll >= 5) {
      const gap = now - d.lastPoll; d.lastPoll = now;
      try { flushPending(game, now); poll(game, now); } catch (e) { console.error('[duty poll]', e); }
      // усиленная дежурка выматывает людей
      if (d.orders.reinforce && gap > 0 && gap < 60) for (const o of game.state.staff || []) if (o.role === 'duty' && o.status === 'station' && o.onShift) o.fatigue = clamp(num(o.fatigue, 20) + gap / 60 * 1.5, 0, 100);
    }
    try { playerReport(game, now); } catch (e) { console.error('[duty report]', e); }
    try { docs.update(game, now); } catch (e) { console.error('[docs]', e); }
    void dtMin;
  },
  dayStart(game) {
    const d = dutyState(game);
    try { morningCheck(game); } catch (e) { console.error('[duty day]', e); }
    d.yesterday = { ...d.today }; d.today = emptyDay();
    // распоряжения «до…» не переживают пересменку
    if (d.orders.holdUntil && d.orders.holdUntil < absNow(game)) d.orders.holdUntil = null;
    if (d.orders.dndUntil && d.orders.dndUntil < absNow(game)) d.orders.dndUntil = null;
  },
  register, overview, stats, dutyOfficer, setReinforce, allIn, doNotDisturb, resolveInbox,
  STATUS_NAMES, SRC, DEPT_SHORT,
  journal(game) { return dutyState(game).journal; },
  orders(game) { return dutyState(game).orders; },
  docs,
  writeDoc(game, spec) { return docs.write(game, spec); },
  docTemplates(game) { return docs.templates(game); },
};
export default duty;
void rankShort; void dmOf;
