// Доступ к состоянию города и общие эффекты (статистика суток, события для сводки, авторитет, доверие, мораль).
import { clamp, num, staffList, hasTrait, adjustOfficer, glog, absNow, dmOf, shiftOf } from './city_util.js';
import { DISTRICT_INFO, GANG_TYPES } from './city_data.js';

export const C = (game) => game.state.city;
export function dist(game, id) { return C(game).districts.find((d) => d.id === id) || null; }
export function gang(game, id) { return id ? C(game).gangs.find((g) => g.id === id) || null : null; }
export function activeGangs(game) { return C(game).gangs.filter((g) => g.status === 'active'); }
export function task(game, id) { return C(game).tasks.find((t) => t.id === id) || null; }
export function crime(game, id) { return id ? C(game).crimes.find((c) => c.id === id) || null : null; }
export function intel(game, id) { return C(game).intel.find((i) => i.id === id) || null; }
export function liveTasks(game) { return C(game).tasks.filter((t) => t.phase !== 'done'); }
export function place(game, districtId, placeId) {
  const d = dist(game, districtId);
  return (d && d.places.find((p) => p.id === placeId)) || null;
}
export function findPlace(game, placeId) {
  for (const d of C(game).districts) { const p = d.places.find((x) => x.id === placeId); if (p) return { d, p }; }
  return null;
}
export function placePrep(p) { return (p && (p.prep || (p.name ? `у объекта «${p.name}»` : ''))) || 'на месте'; }
export function placeLite(p) { return p ? { id: p.id, name: p.name, prep: placePrep(p), kind: p.kind || 'street', value: num(p.value, 1) } : null; }
export function gT(g) { return GANG_TYPES[g ? g.type : 'sport']; }
/** формы названия банды: nom/gen/dat/ins/people/peopleGen/peopleIns; formal — «группировка „X“» */
export function gn(g, form = 'nom') { return g ? (g.forms && g.forms[form]) || g.name : 'неизвестные'; }
export function gFormal(g, caseForm = 'nom') {
  const w = { nom: 'группировка', gen: 'группировки', dat: 'группировке', acc: 'группировку', ins: 'группировкой', prep: 'группировке' }[caseForm];
  return `${w} «${g ? g.name : '?'}»`;
}
export function topGang(game, d, minInf = 5) {
  let best = null, bi = minInf;
  for (const g of activeGangs(game)) { const v = num(d.influence[g.id]); if (v > bi) { bi = v; best = g; } }
  return best;
}
export function infSum(d) { let s = 0; for (const k in d.influence) s += num(d.influence[k]); return s; }
export function maxInf(d) { let s = 0; for (const k in d.influence) s = Math.max(s, num(d.influence[k])); return s; }

/* ------------------------------------------------------------------ статистика суток */
export function newDayStats(shift) {
  return {
    shift, crimes: 0, latent: 0, severe: 0, murders: 0, solved: 0, prevented: 0, arrests: 0,
    policeWounded: 0, policeKilled: 0, banditsKilled: 0, civiliansHurt: 0, civiliansKilled: 0,
    moneySeized: 0, bribes: 0, tasks: 0, calls: 0, callsAnswered: 0, callsIgnored: 0, clashes: 0,
    attacksPlanned: 0, tips: 0, brutality: 0, authorityDelta: 0, reputationDelta: 0, events: [], byDistrict: {},
  };
}
export function day(game) { return C(game).stats.day; }
export function dayD(game, districtId) {
  const s = day(game);
  if (!s.byDistrict[districtId]) s.byDistrict[districtId] = { crimes: 0, latent: 0, solved: 0, severe: 0, arrests: 0, raids: 0, events: 0 };
  return s.byDistrict[districtId];
}
export function bump(game, key, n = 1, districtId = null) {
  const s = day(game);
  s[key] = num(s[key]) + n;
  const t = C(game).stats.total;
  t[key] = num(t[key]) + n;
  if (districtId) { const b = dayD(game, districtId); if (key in b) b[key] += n; }
}
/** событие для утренней сводки: weight 1..10 */
export function addEvent(game, ev) {
  const c = C(game);
  if (!ev || !ev.text) return;
  const now = absNow(game);
  const e = { districtId: ev.districtId || null, text: ev.text, detail: ev.detail || null, weight: num(ev.weight, 1), kind: ev.kind || 'crime', crimeId: ev.crimeId || null, ...dmOf(now) };
  const list = c.stats.day.events;
  list.push(e);
  if (list.length > 80) { list.sort((a, b) => b.weight - a.weight); list.length = 60; }
  if (e.districtId) dayD(game, e.districtId).events++;
}

/* ------------------------------------------------------------------ авторитет, доверие, мораль */
export function flags(game) { if (!game.state.flags) game.state.flags = {}; return game.state.flags; }
export function authority(game, delta, reason) {
  const f = flags(game);
  const before = num(f.authority, 50);
  f.authority = clamp(before + delta, 0, 100);
  day(game).authorityDelta += f.authority - before;
  if (reason && Math.abs(delta) >= 5) glog(game, `Авторитет у начальства ${delta > 0 ? 'вырос' : 'упал'}: ${reason}.`, 'authority');
}
export function reputation(game, delta) {
  const f = flags(game);
  const before = num(f.reputation, 40);
  f.reputation = clamp(before + delta, 0, 100);
  day(game).reputationDelta += f.reputation - before;
}
export function trust(game, districtId, delta) {
  const d = dist(game, districtId);
  if (!d) return;
  d.trust = clamp(num(d.trust, 40) + delta, 0, 100);
  reputation(game, delta * 0.15);
}
/** мораль честных/всех сотрудников (по фильтру) */
export function staffMorale(game, filter, delta, history) {
  for (const o of staffList(game)) {
    if (o.status === 'dead' || o.status === 'fired') continue;
    if (filter && !filter(o)) continue;
    adjustOfficer(game, o, { morale: delta, history });
  }
}
export const isHonest = (o) => hasTrait(o, 'honest') || (o.hidden && num(o.hidden.corruption, 20) < 15);

export function districtShiftReset(d) {
  d.dayAcc = { presenceSum: 0, minutes: 0, raids: {}, arrests: {}, solved: 0, crimes: 0, ignored: 0, brutality: 0, gangCrimes: {} };
}
export function shiftNow(game) { return shiftOf(absNow(game)); }
export function info(id) { return DISTRICT_INFO[id] || DISTRICT_INFO.centr; }
