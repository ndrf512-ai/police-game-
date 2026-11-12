// Задания нарядам: создание и проверка, жизненный цикл (departing → enroute → active → returning → done),
// отзыв, цели для мастера приказа, оценка риска.
import { fullName } from '../core/names.js';
import { R, clamp, num, nid, absNow, dmOf, hourOf, minuteOfDay, nextAt, officer, oName, isDown, sk, tmod, rankIndex, emit, glog, callDep, dep, safeCall, adjustOfficer, nw, collectiveGen, money, cap, hhmm, isNight, whenPhrase, dateShort } from './city_util.js';
import { TASK_DEF, TASK_DEFS, CALLSIGNS, DISTRICT_INFO, dForm, GANG_TYPES } from './city_data.js';
import { C, dist, gang, gT, gn, crime as crimeById, intel as intelById, task as taskById, liveTasks, bump, findPlace, placePrep, maxInf, topGang, info } from './city_core.js';
import { say, report, pick, logTask } from './city_radio.js';
import { T } from './city_text.js';
import { leaderTick, helperArrived, squadPower, offPower, profile } from './city_leader.js';
import { dealBreachCheck } from './city_offers.js';
import { moleFor } from './city_gangs.js';

/* ------------------------------------------------------------------ справочник для UI */
export function taskTypes() { return JSON.parse(JSON.stringify(TASK_DEFS)); }

function defaultsFor(def) {
  const o = {};
  for (const opt of def.orderOptions) o[opt.key] = opt.default;
  for (const k of ['stance', 'force', 'detain', 'respondCalls', 'reportEvery', 'retreatOnWounded', 'returnAt', 'durationMin', 'focus', 'note']) {
    if (!(k in o)) o[k] = { stance: 'normal', force: 'proportional', detain: 'serious', respondCalls: false, reportEvery: 60, retreatOnWounded: true, returnAt: null, durationMin: def.defaultDuration, focus: null, note: '' }[k];
  }
  return o;
}
function mergeOrders(def, given) {
  const o = defaultsFor(def);
  if (given && typeof given === 'object') {
    for (const opt of def.orderOptions) {
      if (!(opt.key in given)) continue;
      const v = given[opt.key];
      if (opt.type === 'select' && !opt.options.some((x) => x.value === v)) continue;
      if (opt.type === 'bool') { o[opt.key] = !!v; continue; }
      if (opt.type === 'time') { o[opt.key] = Number.isFinite(v) ? ((Math.round(v) % 1440) + 1440) % 1440 : null; continue; }
      if (opt.type === 'text') { o[opt.key] = String(v || '').slice(0, 200); continue; }
      o[opt.key] = v;
    }
    if (Number.isFinite(given.durationMin) && !def.orderOptions.some((x) => x.key === 'durationMin')) o.durationMin = clamp(given.durationMin, 30, 1440);
    if (typeof given.helpFor === 'string') o.helpFor = given.helpFor;
  }
  return o;
}

/* ------------------------------------------------------------------ позывные, дорога */
function assignCallsign(game, type) {
  const [base, dat] = CALLSIGNS[type] || CALLSIGNS.patrol;
  const used = new Set(liveTasks(game).filter((t) => t.rt.callsign.startsWith(base + '-')).map((t) => t.rt.callsign));
  let n = 1;
  while (used.has(`${base}-${n}`)) n++;
  return { callsign: `${base}-${n}`, csDat: `${dat}-${n}` };
}
export function travelMin(game, t) {
  const rng = R(game);
  if (t.type === 'escort') return rng.int(4, 8);
  const [a, b] = info(t.districtId).travel;
  const base = rng.int(a, b);
  return t.vehicle ? base : Math.round(base * (t.districtId === 'centr' ? 1.6 : 2.3));
}
function vehicles(game) { return (game.state.economy && Array.isArray(game.state.economy.vehicles)) ? game.state.economy.vehicles : []; }
function vehicle(game, id) { return vehicles(game).find((v) => v.id === id) || null; }
function setVehicle(game, id, patch) {
  const f = dep(game, 'economy', 'setVehicle');
  if (f) { safeCall('economy.setVehicle', f, game, id, patch); return; }
  const v = vehicle(game, id); // CONTRACT-NEEDS: economy.setVehicle(game, id, patch)
  if (v) Object.assign(v, patch);
}
function useFuel(game, liters) {
  const f = dep(game, 'economy', 'consumeFuel');
  if (f) { safeCall('economy.consumeFuel', f, game, liters); return; }
  const e = game.state.economy; // CONTRACT-NEEDS: economy.consumeFuel(game, liters)
  if (e && Number.isFinite(e.fuel)) e.fuel = Math.max(0, Math.round((e.fuel - liters) * 10) / 10);
}

/* ------------------------------------------------------------------ свободные люди */
export function availableOfficers(game) {
  const f = dep(game, 'staff', 'available');
  let list = f ? safeCall('staff.available', f, game) : null;
  if (!Array.isArray(list)) list = (game.state.staff || []).filter((o) => o.status === 'station' && o.onShift !== false);
  return list.filter((o) => o && !isDown(o) && o.status === 'station');
}
function leaderScore(o) { return sk(o, 'discipline') + sk(o, 'tactics') + rankIndex(o.rank) * 8 + ((o.traits || []).includes('leader') ? 30 : 0) - ((o.traits || []).includes('rookie') ? 25 : 0); }
/** собрать наряд автоматически (для «Выслать наряд» по рации, приказов начальства) */
export function autoTask(game, type, opts = {}) {
  const def = TASK_DEF[type];
  const pool = availableOfficers(game).filter((o) => o.role !== 'duty' && o.role !== 'secretary' && (!['spec', 'sledovatel'].includes(o.role) || (opts.roles || []).includes(o.role))); // 1.1: спецназ и следователь — только по прямому запросу
  const prefer = opts.roles || def.roles.preferred;
  const need = def.roles.required;
  const sorted = pool.slice().sort((a, b) => (prefer.includes(b.role) ? 1 : 0) - (prefer.includes(a.role) ? 1 : 0) || num(a.fatigue, 20) - num(b.fatigue, 20));
  const n = clamp(opts.n || def.minOfficers, def.minOfficers, def.maxOfficers);
  let pickd = sorted.slice(0, n);
  if (need && !pickd.some((o) => need.includes(o.role))) {
    const r = sorted.find((o) => need.includes(o.role));
    if (!r) return { ok: false, reason: 'нет нужного сотрудника' };
    pickd = [r, ...pickd.filter((o) => o !== r)].slice(0, n);
  }
  if (pickd.length < def.minOfficers) return { ok: false, reason: pool.length ? 'людей не хватает' : 'все на заданиях' };
  const leader = pickd.reduce((a, o) => (leaderScore(o) > leaderScore(a) ? o : a), pickd[0]);
  const veh = vehicles(game).find((v) => v.status === 'station' && num(v.condition, 100) > 15);
  const spec = { type, districtId: opts.districtId, placeId: opts.placeId || null, targetCrimeId: opts.targetCrimeId || null, targetGangId: opts.targetGangId || null, targetId: opts.targetId || null, officerIds: pickd.map((o) => o.id), leaderId: leader.id, vehicle: veh && (type !== 'guard' || opts.vehicle) ? veh.id : null, orders: { ...(opts.orders || {}), ...(opts.helpFor ? { helpFor: opts.helpFor } : {}) } };
  return createTask(game, spec, true);
}

/* ------------------------------------------------------------------ создание */
export function createTask(game, spec, internal = false) {
  const c = C(game);
  const now = absNow(game);
  if (!spec || typeof spec !== 'object') return { ok: false, reason: 'Пустое задание' };
  const def = TASK_DEF[spec.type];
  if (!def) return { ok: false, reason: 'Неизвестный тип задания' };
  const ids = Array.isArray(spec.officerIds) ? [...new Set(spec.officerIds)] : [];
  if (ids.length < def.minOfficers) return { ok: false, reason: `Нужно не меньше ${nw(def.minOfficers, 'сотрудника', 'сотрудников', 'сотрудников')}` };
  if (ids.length > def.maxOfficers) return { ok: false, reason: `Не больше ${nw(def.maxOfficers, 'сотрудника', 'сотрудников', 'сотрудников')} на такое задание` };
  const offs = [];
  for (const id of ids) {
    const o = officer(game, id);
    if (!o) return { ok: false, reason: 'Сотрудник не найден' };
    if (o.status !== 'station') return { ok: false, reason: `${oName(game, o)} сейчас не в отделе` };
    if (o.onShift === false) return { ok: false, reason: `${oName(game, o)} не на смене` };
    if (isDown(o)) return { ok: false, reason: `${oName(game, o)} не в состоянии` };
    if (o.role === 'duty' && !internal) return { ok: false, reason: 'Дежурного с пульта не снять' };
    if (o.role === 'secretary') return { ok: false, reason: `${oName(game, o)} — вольнонаёмная, в наряд не ходит` };
    offs.push(o);
  }
  if (def.roles.required && !offs.some((o) => def.roles.required.includes(o.role))) return { ok: false, reason: 'Нужен оперуполномоченный или участковый' };
  // цель
  const tg = resolveTarget(game, spec, def, now);
  if (!tg.ok) return tg;
  const districtId = tg.districtId || spec.districtId;
  if (!dist(game, districtId)) return { ok: false, reason: 'Не указан район' };
  // машина
  let veh = spec.vehicle || null;
  if (veh) {
    const v = vehicle(game, veh);
    if (!v) return { ok: false, reason: 'Машина не найдена' };
    if (v.status !== 'station') return { ok: false, reason: `${v.name || 'Машина'} сейчас ${v.status === 'repair' ? 'в ремонте' : 'занята'}` };
    if (num(v.condition, 100) <= 15) return { ok: false, reason: `${v.name || 'Машина'} не на ходу` };
    const e = game.state.economy;
    if (e && Number.isFinite(e.fuel) && e.fuel < 4) return { ok: false, reason: 'Нет бензина' };
  }
  if (def.vehicle === 'required' && !veh) return { ok: false, reason: 'Для конвоя нужна машина' };
  const orders = mergeOrders(def, spec.orders);
  const warnings = [];
  if (spec.type === 'patrol' && orders.route === 'car' && !veh) { orders.route = 'foot'; warnings.push('Машины нет — наряд пойдёт пешком'); }
  const leaderId = ids.includes(spec.leaderId) ? spec.leaderId : offs.reduce((a, o) => (leaderScore(o) > leaderScore(a) ? o : a), offs[0]).id;
  const cs = assignCallsign(game, spec.type);
  const t = {
    id: nid(game, 'tk'), type: spec.type, districtId, placeId: tg.placeId || null, targetCrimeId: tg.crimeId || null, targetGangId: tg.gangId || null,
    targetId: tg.targetId || null, officerIds: ids, leaderId, vehicle: veh, orders,
    phase: 'departing', createdAt: dmOf(now), elapsed: 0, durationMin: orders.durationMin || def.defaultDuration,
    results: { detainees: [], crimesPrevented: 0, crimesSolved: 0, wounded: [], killed: [], money: 0, evidence: [], intel: [] },
    log: [],
    rt: {
      callsign: cs.callsign, csDat: cs.csDat, createdAbs: now, departBy: now + 6, arriveAt: 0, endAt: 0, backAt: 0, holdEnd: false,
      nextThink: 0, nextReport: 0, pauseUntil: 0, slackUntil: 0, silentUntil: 0, tally: {}, notes: [], fat: {}, inj: {}, out: {}, reported: {},
      captives: [], hidden: [], pocket: 0, enc: null, sub: null, stage: null, stageUntil: 0, cancel: false, helpFor: orders.helpFor || null, joined: null,
      cargo: tg.cargo || [], cash: !!tg.cash, legMin: 0, witness: tg.witness || null, suspectCrimeId: tg.suspectCrimeId || null, internal,
    },
  };
  if (t.targetCrimeId && (t.type === 'respond')) { const cr = crimeById(game, t.targetCrimeId); if (cr) { cr.status = 'responding'; cr.assignedTaskId = t.id; } }
  if (t.targetCrimeId && t.type !== 'respond') { const cr = crimeById(game, t.targetCrimeId); if (cr) cr.assignedTaskId = t.id; }
  if (tg.intel) tg.intel.reserved = t.id;
  for (const o of offs) { o.status = 'task'; o.taskId = t.id; }
  if (veh) setVehicle(game, veh, { status: 'task', taskId: t.id });
  c.tasks.push(t);
  bump(game, 'tasks');
  logTask(game, t, `Задание: ${def.name.toLowerCase()} (${dForm(districtId)}). Старший — ${oName(game, officer(game, leaderId))}.${orders.note ? ' Указания: ' + orders.note : ''}`);
  emit(game, 'task:depart', { taskId: t.id, officerIds: ids.slice(), vehicle: veh, detaineeIds: t.rt.cargo.slice() });
  pruneTasks(game);
  return { ok: true, task: t, warnings };
}

function resolveTarget(game, spec, def, now) {
  const c = C(game);
  const tid = spec.targetId != null ? String(spec.targetId) : null;
  const type = spec.type;
  if (type === 'patrol') return { ok: true, districtId: spec.districtId };
  if (type === 'guard') {
    if (tid && tid.startsWith('w:')) {
      const it = intelById(game, tid.slice(2));
      if (!it || it.kind !== 'witness' || it.used) return { ok: false, reason: 'Свидетель уже не нуждается в охране' };
      return { ok: true, districtId: it.districtId, placeId: it.placeId, targetId: it.id, intel: it, witness: { name: 'свидетель', f: false } };
    }
    const pid = spec.placeId || tid;
    const fp = pid ? findPlace(game, pid) : null;
    if (!fp) return { ok: false, reason: 'Выберите объект для охраны' };
    if (fp.p.guardable === false) return { ok: false, reason: `«${fp.p.name}» под охрану не взять` };
    return { ok: true, districtId: fp.d.id, placeId: fp.p.id };
  }
  if (type === 'ambush') {
    const it = intelById(game, (tid || '').replace(/^in:/, ''));
    if (!it || !it.revealed || it.used || !it.opens.includes('ambush')) return { ok: false, reason: 'Нет наводки для засады' };
    if (it.expires <= now) return { ok: false, reason: 'Наводка устарела' };
    if (it.window && it.window.from - now > 16 * 60) return { ok: false, reason: `Рано: ждать ${whenPhrase(game, now, it.window.from)}` };
    return { ok: true, districtId: it.districtId, placeId: it.placeId, gangId: it.gangId, targetId: it.id, intel: it };
  }
  if (type === 'raid') {
    if (tid && tid.startsWith('gp:')) {
      for (const g of c.gangs) {
        const pt = g.points.find((p) => p.id === tid.slice(3));
        if (pt) {
          if (!pt.known) return { ok: false, reason: 'Точка не установлена' };
          if (g.status !== 'active') return { ok: false, reason: 'Группировки больше нет' };
          return { ok: true, districtId: pt.districtId, placeId: pt.placeId, gangId: g.id, targetId: tid };
        }
      }
      return { ok: false, reason: 'Точка не найдена' };
    }
    const it = intelById(game, (tid || '').replace(/^in:/, ''));
    if (!it || !it.revealed || it.used || !it.opens.includes('raid')) return { ok: false, reason: 'Нет сведений о точке' };
    if (it.kind === 'suspect') return { ok: true, districtId: it.districtId, placeId: it.placeId, gangId: it.gangId, crimeId: it.crimeId, targetId: it.id, intel: it, suspectCrimeId: it.crimeId };
    return { ok: true, districtId: it.districtId, placeId: it.placeId, gangId: it.gangId, targetId: it.id, intel: it };
  }
  if (type === 'investigate' || type === 'search') {
    const cr = crimeById(game, spec.targetCrimeId || (tid || '').replace(/^cr:/, ''));
    if (!cr) return { ok: false, reason: 'Дело не найдено' };
    if (cr.status === 'resolved') return { ok: false, reason: 'Дело уже закрыто' };
    if (type === 'search' && !cr.missing) return { ok: false, reason: 'Это не розыск пропавшего' };
    if (liveTasks(game).some((t) => t.targetCrimeId === cr.id && t.type === type)) return { ok: false, reason: 'По этому делу уже работают' };
    return { ok: true, districtId: cr.districtId, placeId: cr.place.id, crimeId: cr.id, gangId: cr.gangId };
  }
  if (type === 'respond') {
    const help = (spec.orders && spec.orders.helpFor) || (tid && tid.startsWith('help:') ? tid.slice(5) : null);
    if (help) {
      const h = taskById(game, help);
      if (!h || h.phase === 'done') return { ok: false, reason: 'Наряд уже вернулся' };
      spec.orders = { ...(spec.orders || {}), helpFor: help };
      return { ok: true, districtId: h.districtId };
    }
    const cr = crimeById(game, spec.targetCrimeId || (tid || '').replace(/^cr:/, ''));
    if (!cr) return { ok: false, reason: 'Вызов не найден' };
    if (cr.status === 'resolved') return { ok: false, reason: 'Происшествие уже закончилось' };
    return { ok: true, districtId: cr.districtId, placeId: cr.place.id, crimeId: cr.id, gangId: cr.gangId };
  }
  if (type === 'escort') {
    if (tid && tid.startsWith('cash:')) {
      const fp = findPlace(game, tid.slice(5));
      if (!fp || fp.p.kind !== 'bank') return { ok: false, reason: 'Банк не найден' };
      return { ok: true, districtId: fp.d.id, placeId: fp.p.id, cash: true, targetId: tid };
    }
    const det = Array.isArray(game.state.detainees) ? game.state.detainees.filter((d) => d.status === 'cell') : [];
    let cargo = [];
    if (tid === 'det:all') cargo = det.map((d) => d.id);
    else if (tid && tid.startsWith('det:')) cargo = det.filter((d) => d.id === tid.slice(4)).map((d) => d.id);
    else if (Array.isArray(spec.detaineeIds)) cargo = det.filter((d) => spec.detaineeIds.includes(d.id)).map((d) => d.id);
    if (!cargo.length) return { ok: false, reason: 'Некого конвоировать' };
    if (liveTasks(game).some((t) => t.type === 'escort' && t.rt.cargo.some((id) => cargo.includes(id)))) return { ok: false, reason: 'Этого задержанного уже везут' };
    return { ok: true, districtId: 'centr', cargo, targetId: tid || 'det:list' };
  }
  return { ok: false, reason: 'Неизвестная цель' };
}

function pruneTasks(game) {
  const c = C(game);
  const done = c.tasks.filter((t) => t.phase === 'done');
  if (done.length > 30) {
    const drop = new Set(done.slice(0, done.length - 30).map((t) => t.id));
    c.tasks = c.tasks.filter((t) => !drop.has(t.id));
  }
}

/* ------------------------------------------------------------------ цикл */
export function stepTask(game, t, now) {
  const rt = t.rt;
  if (t.phase === 'departing') { if (now >= rt.departBy) depart(game, t, now); return; }
  if (t.phase === 'enroute') { if (now >= rt.arriveAt) arrive(game, t, now); return; }
  if (t.phase === 'active') { leaderTick(game, t, now); return; }
  if (t.phase === 'returning') {
    for (const id of t.officerIds) if (!rt.out[id]) rt.fat[id] = num(rt.fat[id]) + 0.02;
    if (now >= rt.backAt) finishReturn(game, t, now);
  }
}
export function onDeparted(game, taskId) {
  const t = taskById(game, taskId);
  if (t && t.phase === 'departing') depart(game, t, absNow(game));
}
export function onReturned(game, taskId) {
  const t = taskById(game, taskId);
  if (t) t.rt.confirmed = true;
}
function depart(game, t, now) {
  const rng = R(game);
  t.phase = 'enroute';
  const tm = travelMin(game, t);
  t.rt.arriveAt = now + tm;
  t.rt.travel = tm;
  if (t.vehicle) useFuel(game, Math.round(tm * 0.45 * 10) / 10);
  const n = t.officerIds.length;
  const squadTxt = n === 1 ? 'один' : `нас ${collectiveGen(n) === 'двоих' ? 'двое' : ['', '', 'двое', 'трое', 'четверо', 'пятеро', 'шестеро'][n] || n}`;
  const squadIn = `в составе ${['', 'одного человека', 'двух человек', 'трёх человек', 'четырёх человек', 'пяти человек', 'шести человек'][n] || n + ' человек'}`;
  const v = t.vehicle ? (vehicle(game, t.vehicle) || {}).name || 'УАЗ' : '';
  let tpl;
  if (t.type === 'escort') tpl = pick(game, T.depart.escort);
  else if (t.vehicle) tpl = pick(game, T.depart.car);
  else tpl = pick(game, T.depart.foot);
  report(game, t, tpl, { to: dForm(t.districtId, 'to'), squad: squadTxt, squadCap: cap(squadTxt), squadIn, veh: v ? `«${v}»` : 'наша', route: t.orders.escortRoute === 'detour' ? 'объездом' : 'основная' });
  void rng;
}
function arrive(game, t, now) {
  const rng = R(game);
  const rt = t.rt;
  t.phase = 'active';
  rt.activeAt = now;
  rt.nextThink = now + rng.int(2, 5);
  rt.nextReport = now + num(t.orders.reportEvery, 60);
  const back = rt.travel || 10;
  rt.endAt = t.orders.returnAt != null ? Math.max(now + 15, nextAt(now, t.orders.returnAt) - back) : now + num(t.durationMin, 240);
  const fp = t.placeId ? findPlace(game, t.placeId) : null;
  const vars = { prep: dForm(t.districtId, 'prep'), gen: dForm(t.districtId, 'gen'), place: fp ? fp.p.prep : dForm(t.districtId, 'prep'), weather: cap(C(game).weather || 'дождь') };
  let key = t.type;
  if (t.type === 'patrol') key = t.orders.route === 'car' ? 'patrol_car' : 'patrol_foot';
  if (t.type === 'guard' && t.orders.posture === 'hidden') key = 'guard_hidden';
  if (t.type === 'escort' && rt.cash) key = 'escort_cash';
  if (t.type === 'raid') {
    rt.holdEnd = true;
    if (t.orders.timing === 'dawn' || t.orders.timing === 'night') {
      const at = nextAt(now, t.orders.timing === 'dawn' ? 300 : 60);
      if (at - now <= 14 * 60) { rt.stage = 'wait'; rt.stageUntil = at; report(game, t, `На месте. Ждём ${t.orders.timing === 'dawn' ? 'рассвета' : 'ночи'}, начинаем в ${hhmm(minuteOfDay(at))}.`, {}); dealBreachCheck(game, t); return; }
    }
    rt.stage = 'recon'; rt.stageUntil = now + rng.int(8, 18);
  }
  if (t.type === 'ambush') {
    const it = intelById(game, t.targetId);
    if (it && it.window) rt.endAt = Math.min(now + 900, Math.max(rt.endAt, it.window.to + 30));
    rt.holdEnd = true;
  }
  if (t.type === 'respond') { rt.holdEnd = true; rt.endAt = now + 120; }
  if (t.type === 'escort') { rt.legMin = rng.int(35, 55) + (t.orders.escortRoute === 'detour' ? 15 : 0); rt.holdEnd = true; }
  if (t.type === 'raid' && rt.suspectCrimeId) key = 'raid';
  if (!(t.type === 'respond' && rt.helpFor)) report(game, t, pick(game, T.arrive[key] || T.arrive.patrol_foot), vars);
  if (rt.helpFor) helperArrived(game, t, now);
  dealBreachCheck(game, t);
}
/** начать возвращение: reason time|done|wounded|recall|fatigue|empty|abort|ammo */
export function beginReturn(game, t, reason) {
  const now = absNow(game);
  const rt = t.rt;
  if (t.phase === 'done' || t.phase === 'returning') return;
  if (t.phase === 'departing') { finishReturn(game, t, now, true); return; }
  if (rt.enc) {
    const e = rt.enc;
    if (e.stage === 'fight' || e.stage === 'standoff') { rt.cancel = true; return; }
    rt.enc = null;
  }
  rt.sub = null;
  const travel = t.phase === 'enroute' ? Math.max(2, (rt.travel || 10) - Math.max(0, rt.arriveAt - now)) : (rt.travel || travelMin(game, t));
  t.phase = 'returning';
  rt.backAt = now + travel;
  rt.returnReason = reason;
  // незавершённый вызов
  const cr = crimeById(game, t.targetCrimeId);
  if (cr && cr.status === 'responding' && cr.assignedTaskId === t.id) cr.status = cr.inProgress && now < num(cr.endsAt) ? 'new' : 'unsolved';
  const it = t.targetId && intelById(game, t.targetId);
  if (it && it.reserved === t.id) it.reserved = null;
  const capt = rt.captives.length ? ` С нами ${nw(rt.captives.length, 'задержанный', 'задержанных', 'задержанных')}.` : '';
  if (reason === 'time' || reason === 'done') report(game, t, pick(game, T.ret) + capt, {});
  else if (reason === 'wounded') report(game, t, pick(game, T.retWounded) + capt, {});
  else if (reason === 'recall') say(game, t, pick(game, T.retRecall) + capt);
  else if (reason === 'empty') report(game, t, pick(game, T.retEmpty), {});
  else if (reason === 'abort') say(game, t, 'Отходим, возвращаемся.' + capt);
}
export function cancelTask(game, taskId) {
  const t = taskById(game, taskId);
  if (!t || t.phase === 'done' || t.phase === 'returning') return { ok: false, reason: 'Наряд уже возвращается' };
  if (t.rt.enc && (t.rt.enc.stage === 'fight' || t.rt.enc.stage === 'standoff')) {
    t.rt.cancel = true;
    say(game, t, pick(game, T.retBusy), {}, 'report');
    return { ok: true, delayed: true };
  }
  beginReturn(game, t, 'recall');
  return { ok: true };
}

function finishReturn(game, t, now, cancelled = false) {
  const rng = R(game);
  const c = C(game);
  const rt = t.rt;
  // задержанные — в камеры
  const add = dep(game, 'detainees', 'add');
  const detIds = [];
  let overflow = 0;
  for (const cap1 of rt.captives) {
    let d = null;
    if (add) d = safeCall('detainees.add', add, game, cap1);
    if (d && d.id) {
      detIds.push(d.id);
      c.captivesHeld.push({ detId: d.id, gangId: cap1.gangId, leader: !!cap1.leader, nick: cap1.nick, day: dmOf(now).day });
    } else overflow++;
  }
  if (c.captivesHeld.length > 60) c.captivesHeld.splice(0, c.captivesHeld.length - 60);
  t.results.detainees = detIds;
  if (overflow) logTask(game, t, `Мест в камерах нет: ${nw(overflow, 'задержанного', 'задержанных', 'задержанных')} отправили в городской ИВС.`);
  // люди
  const back = [];
  const success = t.results.crimesSolved + t.results.crimesPrevented + detIds.length > 0;
  for (const id of t.officerIds) {
    const o = officer(game, id);
    if (!o) continue;
    if (o.status === 'task' && o.taskId === t.id) { o.status = 'station'; o.taskId = null; }
    if (o.status === 'station') back.push(id);
    adjustOfficer(game, o, { fatigue: Math.round(num(rt.fat[id])), morale: (success ? 2 : 0) - (t.results.killed.length ? 6 : 0) - (t.results.wounded.length ? 2 : 0) });
  }
  // скрытое: прикарманенное
  if (rt.pocket > 0) {
    const greedy = t.officerIds.map((id) => officer(game, id)).filter((o) => o && (num(o.hidden && o.hidden.corruption, 0) > 40 || (o.traits || []).includes('greedy')));
    c.ledger.push({ day: dmOf(now).day, officerId: (greedy[0] || officer(game, t.leaderId) || {}).id || t.leaderId, amount: rt.pocket, taskId: t.id, what: rt.hidden.join('; ') || 'взятки на маршруте' });
  }
  if (rt.hidden.length) c.hiddenLog.push({ day: dmOf(now).day, taskId: t.id, leaderId: t.leaderId, what: rt.hidden.slice() });
  if (c.ledger.length > 100) c.ledger.splice(0, c.ledger.length - 100);
  if (c.hiddenLog.length > 100) c.hiddenLog.splice(0, c.hiddenLog.length - 100);
  // машина
  if (t.vehicle) {
    const v = vehicle(game, t.vehicle);
    const wear = rng.int(0, 2) + (t.results.wounded.length || t.results.killed.length ? rng.int(5, 20) : 0);
    setVehicle(game, t.vehicle, { status: v && num(v.condition, 100) - wear <= 15 ? 'repair' : 'station', taskId: null, condition: Math.max(0, num(v && v.condition, 100) - wear) });
    if (!cancelled) useFuel(game, Math.round(num(rt.travel, 10) * 0.45 * 10) / 10);
  }
  if (t.results.money > 0) {
    const f = dep(game, 'economy', 'addMoney');
    if (f) safeCall('economy.addMoney', f, game, t.results.money, t.type === 'escort' ? 'Оплата сопровождения ценностей' : 'Изъятые средства (на нужды отдела)');
  }
  t.phase = 'done';
  rt.doneAt = now;
  rt.enc = null;
  const it = t.targetId && intelById(game, t.targetId);
  if (it && it.reserved === t.id) it.reserved = null;
  emit(game, 'task:return', { taskId: t.id, officerIds: back, wounded: t.results.wounded.slice(), detainees: detIds, dead: t.results.killed.slice(), money: t.results.money, cancelled });
  if (!cancelled) {
    const L = officer(game, t.leaderId);
    const sum = [`${rt.callsign} вернулся`, detIds.length ? `задержанных: ${detIds.length}` : '', t.results.wounded.length ? `ранены: ${t.results.wounded.length}` : '', t.results.killed.length ? `погибли: ${t.results.killed.length}` : ''].filter(Boolean).join(', ');
    glog(game, `${sum} (старший — ${oName(game, L)}).`, t.results.killed.length ? 'death' : 'task');
  }
}

/* ------------------------------------------------------------------ цели для мастера приказа */
export function validTargets(game, type, districtId) {
  const c = C(game);
  const now = absNow(game);
  const d = dist(game, districtId);
  const inD = (x) => !districtId || x === districtId;
  const out = [];
  if (type === 'patrol') return out;
  if (type === 'guard') {
    if (d) for (const p of d.places) if (p.guardable !== false && (p.guardable || ['bank', 'school', 'market', 'shop', 'office', 'kiosk', 'station', 'hospital'].includes(p.kind))) out.push({ id: p.id, name: p.name, desc: `${cap(placePrep(p))}. Ценность: ${'★'.repeat(clamp(num(p.value, 1), 1, 5))}` });
    for (const it of c.intel) if (it.kind === 'witness' && it.revealed && !it.used && it.expires > now && inD(it.districtId)) out.push({ id: 'w:' + it.id, name: 'Свидетель под угрозой', desc: it.text });
    for (const it of c.intel) if (it.kind === 'robbery' && it.revealed && !it.used && it.expires > now && inD(it.districtId) && it.placeId) { const fp = findPlace(game, it.placeId); if (fp) out.push({ id: it.placeId, name: `${fp.p.name} — по наводке`, desc: it.text }); }
    return out;
  }
  if (type === 'ambush') {
    for (const it of c.intel) if (it.revealed && !it.used && it.opens.includes('ambush') && it.expires > now && inD(it.districtId)) out.push({ id: it.id, name: { meeting: 'Сходка', deal: 'Сделка', robbery: 'Готовящийся налёт', suspect: 'Подозреваемый', racket: 'Вымогатели' }[it.kind] || 'Наводка', desc: `${it.text} Надёжность источника: ${it.reliability > 0.75 ? 'высокая' : it.reliability > 0.5 ? 'средняя' : 'низкая'}.` });
    return out;
  }
  if (type === 'raid') {
    for (const g of c.gangs) {
      if (g.status !== 'active') continue;
      for (const pt of g.points) {
        if (!pt.known || !inD(pt.districtId)) continue;
        const fp = findPlace(game, pt.placeId);
        if (!fp) continue;
        const recent = dmOf(now).day - pt.raidedDay < 2 ? ' Недавно был рейд — могут ждать.' : '';
        out.push({ id: 'gp:' + pt.id, name: `${fp.p.name} (${{ hideout: 'точка', stash: 'схрон', racket: 'место поборов' }[pt.kind]} «${g.name}»)`, desc: `${cap(fp.p.prep)}. ${gT(g).label}, оружие: ${['', 'биты и обрезы', 'пистолеты, обрезы', 'автоматы'][g.weaponsTier]}.${recent}` });
      }
    }
    for (const it of c.intel) if (it.revealed && !it.used && it.kind === 'suspect' && it.expires > now && inD(it.districtId)) out.push({ id: it.id, name: 'Адрес подозреваемого', desc: it.text });
    return out;
  }
  if (type === 'investigate') {
    const list = c.crimes.filter((x) => inD(x.districtId) && (x.status === 'new' || x.status === 'unsolved') && !x.inProgress && !x.missing && x.solvability > 0.03 && dmOf(now).day - x.day <= 14 && !liveTasks(game).some((t) => t.type === 'investigate' && t.targetCrimeId === x.id));
    list.sort((a, b) => b.severity - a.severity || (b.day * 1440 + b.minute) - (a.day * 1440 + a.minute));
    for (const x of list.slice(0, 15)) out.push({ id: x.id, name: `${cap(x.title)} (${dateShort(game, x.day)})`, desc: `${cap(x.place.prep)}. ${x.inv ? `Наработано: ${Math.round(x.inv.progress * 100)}%. ` : ''}Шансы: ${x.solvability > 0.6 ? 'хорошие' : x.solvability > 0.3 ? 'средние' : 'глухо'}.${x.gangId && gang(game, x.gangId) && gang(game, x.gangId).known > 30 ? ` Похоже на работу «${gang(game, x.gangId).name}».` : ''}` });
    return out;
  }
  if (type === 'respond') {
    for (const x of c.crimes) if (x.inProgress && x.status === 'new' && inD(x.districtId) && now < num(x.endsAt)) out.push({ id: x.id, name: cap(x.title), desc: `${cap(x.place.prep)}. Идёт сейчас, осталось около ${Math.max(1, x.endsAt - now)} мин.` });
    for (const t of liveTasks(game)) if (t.rt.enc && inD(t.districtId) && ['fight', 'standoff', 'waitBackup', 'await'].includes(t.rt.enc.stage)) out.push({ id: 'help:' + t.id, name: `На помощь ${t.rt.csDat}`, desc: `${cap(dForm(t.districtId, 'prep'))}: ${t.rt.enc.stage === 'fight' ? 'ведёт бой' : t.rt.enc.stage === 'standoff' ? 'осада' : 'ждёт подкрепления'}.` });
    return out;
  }
  if (type === 'escort') {
    const det = Array.isArray(game.state.detainees) ? game.state.detainees.filter((x) => x.status === 'cell') : [];
    if (det.length > 1) out.push({ id: 'det:all', name: `Всех задержанных в СИЗО (${det.length})`, desc: 'Освободит камеры. Если среди них люди банд — повод для налёта на отдел исчезнет.' });
    for (const x of det) {
      const g = gang(game, x.gangId);
      const p = x.person || {};
      out.push({ id: 'det:' + x.id, name: `${p.lastName || 'Задержанный'}${x.nick ? ` «${x.nick}»` : ''} — в СИЗО`, desc: `${x.charge || ''}${g ? `. ${gn(g, 'people') === g.name ? g.name : cap(gn(g, 'people'))} могут попытаться отбить` : ''}. Опасность: ${num(x.danger) > 70 ? 'высокая' : num(x.danger) > 40 ? 'средняя' : 'низкая'}.` });
    }
    for (const dd of c.districts) if (inD(dd.id)) for (const p of dd.places) if (p.kind === 'bank') out.push({ id: 'cash:' + p.id, name: `Сопровождение ценностей: ${p.name}`, desc: 'Банк заплатит отделу за охрану инкассации. Дорогу могут перекрыть.' });
    return out;
  }
  if (type === 'search') {
    for (const x of c.crimes) if (x.missing && x.status !== 'resolved' && inD(x.districtId)) {
      const hrs = Math.round((now - x.missing.since) / 60);
      out.push({ id: x.id, name: `${x.missing.person.firstName} ${x.missing.person.lastName}, ${x.missing.age}`, desc: `${cap(x.text.dispatch)} Прошло ${nw(hrs, 'час', 'часа', 'часов')}.` });
    }
    return out;
  }
  return out;
}

/* ------------------------------------------------------------------ подсказка: риск и эффект */
const BASE_RISK = { patrol: 0.08, guard: 0.06, ambush: 0.25, raid: 0.4, investigate: 0.06, respond: 0.2, escort: 0.12, search: 0.05 };
export function estimate(game, spec) {
  const def = TASK_DEF[spec && spec.type];
  if (!def) return { risk: 0, effect: 'Неизвестное задание', durationMin: 0 };
  const now = absNow(game);
  const tg = resolveTarget(game, { ...spec, orders: { ...(spec.orders || {}) } }, def, now);
  const dId = (tg.ok && tg.districtId) || spec.districtId;
  const d = dist(game, dId);
  const offs = (spec.officerIds || []).map((id) => officer(game, id)).filter(Boolean);
  const P = offs.reduce((s, o) => s + offPower(game, o, null), 0) || 0.5;
  const orders = mergeOrders(def, spec.orders);
  let E = d ? (d.crime / 100 * 1.5 + maxInf(d) / 100 * 1.5) : 1;
  const g = tg.ok && tg.gangId ? gang(game, tg.gangId) : d ? topGang(game, d, 15) : null;
  if ((spec.type === 'raid' || spec.type === 'ambush') && g) E = (spec.type === 'raid' ? 4 : 3) * [0, 0.6, 1.0, 1.6][g.weaponsTier] * gT(g).skill * (spec.type === 'raid' && orders.mode === 'quiet' ? 0.75 : 1);
  if (isNight(now)) E *= 1.25;
  if (orders.stance === 'aggressive') E *= 1.2;
  if (orders.stance === 'cautious') E *= 0.8;
  const mole = g && moleFor(game, g.id) ? 1.3 : 1;
  const risk = clamp(BASE_RISK[spec.type] * (E / P) * 2.2 * mole, 0.02, 0.95);
  const travel = d ? Math.round((info(d.id).travel[0] + info(d.id).travel[1]) / 2 * (spec.vehicle ? 1 : 2.3)) : 10;
  let dur = num(orders.durationMin, def.defaultDuration);
  if (spec.type === 'raid') dur = 90 + (orders.timing === 'now' ? 0 : Math.max(0, nextAt(now, orders.timing === 'dawn' ? 300 : 60) - now - travel));
  if (spec.type === 'respond') dur = 40;
  if (spec.type === 'escort') dur = 50;
  if (spec.type === 'ambush' && tg.ok && tg.intel && tg.intel.window) dur = Math.max(60, tg.intel.window.to + 30 - now - travel);
  const where = d ? dForm(d.id, 'prep') : '';
  const gName = g ? `«${g.name}»` : '';
  const effect = {
    patrol: `Пока наряд ${where}, преступлений там меньше, ${g ? `${gName} теряют влияние` : 'банды теряют влияние'}, люди начинают доверять. ${orders.focus === 'kiosks' ? 'Торговцы разговорятся, но рэкетиры разозлятся.' : orders.focus === 'drugs' ? 'Наркоторговцы разозлятся, возможна стычка.' : orders.focus === 'stealth' ? 'Отпугивает слабо, зато чаще берут с поличным.' : ''}`,
    guard: 'Объект будет почти неприкосновенен, пока стоит пост. Людям участка станет на столько же меньше.',
    ambush: `Если наводка верна — задержание с поличным${g ? `, удар по ${g.forms.dat}` : ''}. Если пустая — потерянное время.${mole > 1 ? ' Есть опасение, что информация уходит на сторону.' : ''}`,
    raid: `Сильный удар по ${g ? g.forms.dat : 'банде'}: люди, деньги, оружие, влияние ${where}. Злость банды вырастет — могут ответить налётом на отдел.`,
    investigate: 'Опер работает по делу: свидетели, приметы, подозреваемый. Чем выше доверие в районе, тем быстрее.',
    respond: 'Срочный выезд. Успеют — возьмут на месте, не успеют — по горячим следам.',
    escort: tg.ok && tg.cash ? 'Банк заплатит за сопровождение. Возможна попытка ограбления в дороге.' : 'Камеры освободятся, а у банд пропадёт повод идти на отдел. В дороге могут попытаться отбить.',
    search: 'Розыск пропавшего: чем раньше начнут, тем больше шансов найти живым.',
  }[spec.type].trim();
  const L = offs.find((o) => o.id === spec.leaderId) || offs[0];
  const details = [];
  if (L) {
    const tr = (L.traits || []).slice(0, 3).join(', ');
    details.push(`Старший: ${oName(game, L)}${tr ? ` (${tr})` : ''}`);
  }
  if (!tg.ok) details.push(`Цель: ${tg.reason}`);
  const avgF = offs.length ? offs.reduce((s, o) => s + num(o.fatigue, 20), 0) / offs.length : 0;
  if (avgF > 60) details.push('Люди устали — будут просить смены раньше');
  if (spec.type !== 'investigate' && offs.length && offs.every((o) => !o.equipment || o.equipment.armor === 'none')) details.push('Без бронежилетов');
  return { risk: Math.round(risk * 100) / 100, effect, durationMin: Math.round(dur + travel * 2), details, riskLabel: risk < 0.12 ? 'низкий' : risk < 0.3 ? 'средний' : risk < 0.55 ? 'высокий' : 'очень высокий' };
}
