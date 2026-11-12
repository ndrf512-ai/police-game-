// Личный состав отделения (агент B2): генерация людей, усталость/мораль/стресс, смены, события,
// приказы командира, разговоры, проверки на «крота». Состояние — только в game.state.
import { clamp, uid } from '../core/rng.js';
import { randomPerson } from '../core/names.js';
import { TRAITS, TRAIT_BY_ID, RANKS, RANK_BY_ID, ROLES, ROLE_BY_ID, MOD_KEYS } from '../data/staff_traits.js';
import { genFamily, genBio, genLook, genNick, officialCharacteristic, injuryName, injuryDays, MOLE_REASONS, MOLE_BEHAVIOR_TELLS, kidsText } from '../data/staff_text.js';
import * as TK from '../data/staff_talk.js';
import { fmt, cap, calendar, absMin, money, declSurname, shortRank, rankCase, clockStr, MONTHS_GEN } from '../data/staff_lang.js';
import { ITEMS, UPGRADES } from '../data/items.js';
import { economy } from './economy.js';
import { detainees } from './detainees.js';
import { campaign } from './campaign.js';

export { TRAITS, RANKS, ROLES, MOD_KEYS };

const DISTRICT_IDS = ['rynok', 'vokzal', 'promzona', 'cheremushki', 'centr', 'chastnyi'];
const DISTRICT_NAMES = { rynok: 'Рынок', vokzal: 'Вокзал', promzona: 'Промзону', cheremushki: 'Черёмушки', centr: 'Центр', chastnyi: 'Частный сектор' };
const SKILL_NAMES = { shooting: 'Огневая', tactics: 'Тактика', perception: 'Наблюдательность', fitness: 'Физическая', discipline: 'Дисциплина', talk: 'Общение', investigation: 'Розыск', driving: 'Вождение' };
const SHIFT_NAMES = ['«А»', '«Б»', '«В»'];
export const MAX_STAFF = 26;

// ======================= служебные помощники =======================
const R = (game) => game.rng;
const day = (game) => game.state.time.day;
const nowAbs = (game) => absMin(game.state.time);
function player(game) { return game.state.player || { gender: 'm', rank: 'майор', firstName: 'Иван', lastName: 'Командиров', patronymic: 'Иванович' }; }
function F(game, str, o, other, vars) { return fmt(str, { s: o, o: other || null, p: player(game), vars }); }
function PF(game, arr, o, other, vars) { return F(game, R(game).pick(arr), o, other, vars); }
export function glog(game, text, kind = 'staff') {
  if (typeof game.log === 'function') game.log(text, kind);
  else { const s = game.state; (s.log || (s.log = [])).push({ day: s.time.day, minute: s.time.minute, text, kind }); }
}
function emit(game, ev, p) { if (game.bus) game.bus.emit(ev, p); }
function hist(game, o, text) { o.history.push({ day: day(game), text }); if (o.history.length > 60) o.history.splice(0, o.history.length - 60); }
function hasT(o, t) { return o.traits.includes(t); }
const inService = (o) => o.status !== 'dead' && o.status !== 'fired';
const present = (o) => o.status === 'station';
function list(game) { return game.state.staff || []; }
function byId(game, id) { return list(game).find((o) => o.id === id) || null; }
function others(game, o) { return list(game).filter((x) => x !== o && inService(x) && x.status !== 'missing'); }
function addRel(a, b, v) { if (!a || !b || a === b) return; a.relations[b.id] = clamp((a.relations[b.id] || 0) + v, -100, 100); }
function lg(o, v) { return v * (1 + mod(o, 'loyalty_gain', { traitsOnly: true })); }
function ownedFlags(game) { return (game.state.economy && game.state.economy.flags) || {}; }
const fail = (text) => ({ ok: false, text, reason: text, effects: {} });

/** Применить эффекты к сотруднику с ограничениями. Возвращает фактический объект эффектов. */
function applyEff(game, o, e) {
  if (e.morale) o.morale = clamp(o.morale + e.morale, 0, 100);
  if (e.loyalty) o.loyalty = clamp(o.loyalty + e.loyalty, 0, 100);
  if (e.stress) o.stress = clamp(o.stress + e.stress, 0, 100);
  if (e.fatigue) o.fatigue = clamp(o.fatigue + e.fatigue, 0, 100);
  if (e.corruption) o.hidden.corruption = clamp(o.hidden.corruption + e.corruption, 0, 100);
  if (e.money) economy.addMoney(game, e.money, e.moneyReason || 'личный состав');
  if (e.authority) campaign.addAuthority(game, e.authority, e.authorityReason || 'личный состав');
  return e;
}
function everyone(game, fn) { for (const o of list(game)) if (inService(o) && o.status !== 'missing') fn(o); }

// ======================= модификаторы =======================
function addT(v, table, key, k = 1) { const x = table[key]; return x ? v + x * k : v; }
const DRUNK = { accuracy: -0.25, perception: -0.25, courage: 0.15, aggression: 0.2, discipline: -0.3, tactics: -0.2, driving: -0.4, talk: -0.1, honesty: 0.2, secrecy: -0.3, stamina: -0.1 };
const HANGOVER = { accuracy: -0.08, perception: -0.1, stamina: -0.1, discipline: -0.05, morale_decay: 0.05 };
const TIRED = { perception: -0.2, accuracy: -0.12, stamina: -0.3, tactics: -0.1, discipline: -0.1, driving: -0.2 };
const STRESSED = { accuracy: -0.1, courage: -0.12, aggression: 0.12, perception: 0.05, discipline: -0.08 };
const HURT = { stamina: -0.12, accuracy: -0.05, melee: -0.12, tactics: -0.03 };
const LOWMORALE = { courage: -0.1, discipline: -0.12, hold: -0.1 };

/** Суммарный модификатор: черты + временные состояния (пьян, похмелье, усталость, стресс, травмы, броня). */
export function mod(o, key, opts = {}) {
  let v = 0;
  for (const t of o.traits) { const tr = TRAIT_BY_ID[t]; if (tr && tr.mods[key]) v += tr.mods[key]; }
  if (opts.traitsOnly) return v;
  const c = o.cond || {};
  if (c.drunk > 0) v = addT(v, DRUNK, key);
  else if (c.hangover > 0) v = addT(v, HANGOVER, key);
  if (o.fatigue > 60) v = addT(v, TIRED, key, (o.fatigue - 60) / 40);
  if (o.stress > 60) v = addT(v, STRESSED, key, (o.stress - 60) / 40);
  const sev = (o.injuries || []).reduce((a, i) => a + i.severity, 0);
  if (sev) v = addT(v, HURT, key, Math.min(3, sev));
  if (o.morale < 30) v = addT(v, LOWMORALE, key, (30 - o.morale) / 30);
  if (key === 'stamina' && o.equipment && o.equipment.armorId && ITEMS[o.equipment.armorId]) v += ITEMS[o.equipment.armorId].stamina || 0;
  return v;
}

/** Готовые числа для боя (0..1), с учётом навыков, черт и состояния. */
export function combatStats(o) {
  const s = o.skills;
  return {
    accuracy: clamp((s.shooting / 100) * (1 + mod(o, 'accuracy')), 0.05, 0.98),
    courage: clamp(0.5 + mod(o, 'courage') + (o.morale - 50) / 250, 0, 1),
    aggression: clamp(0.4 + mod(o, 'aggression'), 0, 1),
    discipline: clamp(s.discipline / 100 + mod(o, 'discipline'), 0, 1),
    perception: clamp((s.perception / 100) * (1 + mod(o, 'perception')), 0.05, 1),
    tactics: clamp(s.tactics / 100 + mod(o, 'tactics'), 0, 1),
    stamina: clamp(s.fitness / 100 + mod(o, 'stamina'), 0.05, 1),
    luck: clamp(0.1 + mod(o, 'luck'), 0, 0.8),
    leadership: clamp((s.tactics + s.talk) / 200 + mod(o, 'leadership'), 0, 1),
    melee: clamp(s.fitness / 120 + mod(o, 'melee'), 0, 1),
    medic: clamp(0.2 + mod(o, 'medic'), 0, 1),
    hold: clamp(0.5 + mod(o, 'hold') + mod(o, 'discipline') * 0.5, 0, 1),
    retreatAt: clamp(0.35 - mod(o, 'courage') * 0.3 - mod(o, 'hold') * 0.2, 0.05, 0.8),
    panic: clamp(0.12 - mod(o, 'courage') * 0.3 + o.stress / 400, 0, 0.9),
    reaction: clamp(0.9 - s.tactics / 250 - mod(o, 'perception') * 0.4 + o.fatigue / 250, 0.3, 1.6),
    nightPerception: clamp((s.perception / 100) * (1 + mod(o, 'perception') + mod(o, 'night')), 0.05, 1),
    drunk: (o.cond.drunk || 0) > 0, hp: o.hp,
  };
}

// ======================= генерация =======================
const ROLE_SKILL = {
  pps: { shooting: 8, fitness: 10, tactics: 5 }, oper: { investigation: 30, talk: 15, perception: 10, shooting: 4 },
  duty: { discipline: 12, talk: 10, perception: 6, investigation: 6 }, uchastkovy: { talk: 20, investigation: 15, perception: 8 },
  driver: { driving: 35, fitness: 4 }, guard: { discipline: 10, fitness: 8, perception: 5 }, kinolog: { perception: 15, fitness: 10 },
  secretary: { talk: 18, discipline: 12, perception: 4, shooting: -25, tactics: -20, fitness: -8 },
  sledovatel: { investigation: 32, discipline: 14, talk: 12, perception: 8, shooting: -6, fitness: -6 },
  spec: { shooting: 26, tactics: 22, fitness: 24, discipline: 8, talk: -6 },
};
const TRAIT_SKILL = {
  marksman: { shooting: 25 }, athlete: { fitness: 25 }, driver_ace: { driving: 28 }, sharp: { perception: 20, investigation: 6 },
  pedant: { discipline: 20 }, lazy: { discipline: -18, fitness: -5 }, talker: { talk: 14 }, silent: { talk: -12 },
  rookie: { tactics: -15, shooting: -8, investigation: -10, perception: -5 }, veteran: { tactics: 14, investigation: 8, fitness: -10 },
  afghan: { shooting: 15, tactics: 18 }, chechnya: { shooting: 12, tactics: 12 }, sick: { fitness: -25 }, drinker: { discipline: -10, fitness: -6 },
  leader: { tactics: 10, talk: 8 }, local: { investigation: 8, talk: 6 }, kind: { talk: 6 }, hothead: { discipline: -8 }, medic: { perception: 3 },
};
const ROLE_AGE = { pps: [20, 44, 28], duty: [24, 50, 36], oper: [24, 42, 31], uchastkovy: [27, 52, 38], driver: [24, 55, 38], guard: [23, 50, 34], kinolog: [21, 40, 28], secretary: [19, 48, 27], sledovatel: [24, 50, 33], spec: [21, 38, 27] };
const TRAIT_ROLE_BIAS = { driver: { driver_ace: 5 }, oper: { sharp: 2, talker: 1.5, ambitious: 1.5 }, uchastkovy: { local: 4, talker: 1.5, kind: 1.5 }, duty: { pedant: 2.5, silent: 1.3 }, guard: { sadist: 1.6, silent: 1.5 }, pps: { athlete: 1.5, hothead: 1.3 }, kinolog: { kind: 2, athlete: 1.5 }, sledovatel: { pedant: 2.5, sharp: 1.5 }, spec: { athlete: 2.5, marksman: 2, leader: 1.5 } };

function traitOk(t, o, cur) {
  if (cur.includes(t.id)) return false;
  for (const c of cur) { if ((t.conflicts || []).includes(c)) return false; const ct = TRAIT_BY_ID[c]; if (ct && (ct.conflicts || []).includes(t.id)) return false; }
  const q = t.req || {};
  if (q.minAge && o.age < q.minAge) return false;
  if (q.maxAge && o.age > q.maxAge) return false;
  if (q.family && !(o.family.married || o.family.kids)) return false;
  return true;
}
function pickTraits(rng, o, opts) {
  const res = [];
  const add = (id) => { const t = TRAIT_BY_ID[id]; if (t && traitOk(t, o, res)) res.push(id); };
  if (opts.rookie) add('rookie');
  else if (o.age >= 42 && o.serviceYears >= 14 && rng.chance(0.65)) add('veteran');
  if (opts.force) for (const t of opts.force) add(t);
  const m = o.gender === 'm';
  if (!res.includes('afghan') && o.age >= 27 && o.age <= 48 && rng.chance(m ? (o.age <= 37 ? 0.3 : 0.15) : 0.05)) add('afghan');
  if (!res.includes('afghan') && !res.includes('chechnya') && rng.chance(m ? (o.age <= 24 ? 0.3 : 0.16) : 0.05)) add('chechnya');
  if ((o.family.married && o.family.kids) && rng.chance(0.4)) add('family_man');
  const target = Math.max(res.length, rng.chance(0.5) ? 3 : 2);
  const bias = TRAIT_ROLE_BIAS[o.role] || {};
  let guard = 0;
  while (res.length < target && guard++ < 50) {
    const pool = TRAITS.filter((t) => t.weight > 0 && !['afghan', 'chechnya', 'family_man'].includes(t.id) && traitOk(t, o, res));
    if (!pool.length) break;
    const t = rng.weighted(pool, (x) => x.weight * (bias[x.id] || 1));
    res.push(t.id);
  }
  return res;
}
function genSkills(rng, o) {
  const base = { shooting: 40, tactics: 32, perception: 42, fitness: 52, discipline: 50, talk: 40, investigation: 25, driving: 35 };
  const yrs = Math.min(15, o.serviceYears);
  const sk = {};
  for (const k of Object.keys(base)) {
    let v = base[k] + (ROLE_SKILL[o.role]?.[k] || 0);
    for (const t of o.traits) v += TRAIT_SKILL[t]?.[k] || 0;
    if (k === 'tactics' || k === 'investigation' || k === 'perception') v += yrs * 1.1;
    if (k === 'fitness' && o.age > 30) v -= (o.age - 30) * 0.9;
    if (k === 'fitness' && o.gender === 'f') v -= 3;
    v += rng.gauss(0, 9);
    sk[k] = Math.round(clamp(v, 5, 95));
  }
  return sk;
}
function rankFor(rng, role, years, opts) {
  let [lo, hi] = ROLE_BY_ID[role].ranks;
  if (ROLE_BY_ID[role].civilian) return RANKS[lo];
  if (role === 'duty') { if (opts.dutyChief) { lo = 8; hi = 10; } else { lo = 3; hi = 6; } }
  let lvl = opts.rookie ? lo : lo + Math.floor(years / rng.range(2.2, 3.4));
  return RANKS[clamp(lvl, lo, hi)];
}
function positionTitle(o) {
  if (o.role === 'duty') return RANK_BY_ID[o.rankId].officer ? 'оперативный дежурный' : 'помощник оперативного дежурного';
  return ROLE_BY_ID[o.role].name;
}
function personalNo(rng) { return String(rng.int(100, 9899)).padStart(4, '0'); }

/** Создать сотрудника. spec: {role, gender?, age?, rookie?, dutyChief?, force?:[traitId], candidate?} */
export function makeOfficer(game, rng, spec) {
  const role = spec.role || 'pps';
  const p = randomPerson(rng, spec.gender || null, { femaleChance: role === 'secretary' ? 0.97 : 0.15 });
  const [amin, amax, amean] = ROLE_AGE[role] || ROLE_AGE.pps;
  let age = spec.age || Math.round(clamp(rng.gauss(amean, 7), amin, amax));
  if (spec.rookie) age = rng.int(19, 23);
  if (role === 'duty' && spec.dutyChief) age = Math.max(age, 27);
  const minYears = ['oper', 'uchastkovy', 'sledovatel'].includes(role) || spec.dutyChief ? 3 : 1;
  const serviceYears = spec.rookie ? rng.int(0, 1) : clamp(rng.int(minYears, Math.max(minYears, age - 20)), minYears, 30);
  const o = {
    id: uid('o'), gender: p.gender, firstName: p.firstName, lastName: p.lastName, patronymic: p.patronymic,
    age, birth: null, rank: '', rankId: '', role, roleName: '', position: '', personalNo: personalNo(rng),
    serviceYears, serviceSince: 1996 - serviceYears,
    traits: [], knownTraits: [], skills: {},
    hp: 100, maxHp: 100, fatigue: rng.int(5, 30), morale: rng.int(42, 68), stress: rng.int(3, 25), loyalty: rng.int(40, 60),
    hidden: { corruption: 0, mole: false, gangId: null, addiction: null, debt: 0, drinkLevel: 0, moleReason: null, tells: [], guilt: 0, exposure: 0, bribes: 0, planted: false },
    status: spec.candidate ? 'candidate' : 'home', onShift: false, taskId: null, groupId: null,
    shiftGroup: 0, schedule: ROLE_BY_ID[role].schedule, overtime: false, arriveAt: null, restUntil: null, goingHome: null, returnAt: null,
    leaveUntil: null, dayOffDay: null, planned: null, missingUntil: null, suspendedUntil: null,
    cond: { drunk: 0, hangover: 0, sick: 0 },
    equipment: { weapon: 'none', ammo: 0, armor: 'none', armorId: null, helmet: false, helmetId: null, radio: false, radioId: null, baton: false, cuffs: false, gas: false, medkit: false, flashlight: false, sidearm: 'none', sidearmAmmo: 0, illegal: false },
    injuries: [], xp: spec.rookie ? 0 : Math.min(600, serviceYears * 35), stats: { arrests: 0, kills: 0, wounds: 0, daysServed: 0, shifts: 0, consecutive: 0, tasks: 0, attacks: 0 },
    bio: '', family: null, look: null, nick: '', relations: {}, relNotes: {}, history: [],
    record: { rewards: [], reprimands: [], misconduct: [], promotions: [] }, talkLog: {}, promises: [], flags: {}, salary: 0,
    smoker: rng.chance(0.7), debtToStation: 0,
  };
  o.family = genFamily(rng, o);
  o.traits = pickTraits(rng, o, spec);
  const rk = rankFor(rng, role, serviceYears, spec);
  o.rank = rk.name; o.rankId = rk.id; o.roleName = ROLE_BY_ID[role].name; o.position = positionTitle(o);
  o.salary = rk.salary + Math.min(15, serviceYears) * 8;
  o.skills = genSkills(rng, o);
  o.knownTraits = o.traits.filter((t) => !TRAIT_BY_ID[t].hidden);
  // скрытое
  const h = o.hidden;
  h.corruption = Math.round(clamp(rng.gauss(24, 12) + mod(o, 'corruptibility', { traitsOnly: true }) * 60, 0, 100));
  if (hasT(o, 'drinker')) { h.addiction = 'alcohol'; h.drinkLevel = rng.int(40, 80); } else h.drinkLevel = rng.int(0, 20);
  if (hasT(o, 'gambler')) { h.addiction = h.addiction || 'gambling'; h.debt = rng.int(8, 30) * 100; }
  if (hasT(o, 'sick')) { o.maxHp = 85; o.hp = 85; }
  if (o.age >= 50) { o.maxHp = Math.min(o.maxHp, 90); o.hp = o.maxHp; }
  // день рождения
  const bm = rng.int(1, 12), bd = rng.int(1, 28);
  o.birth = { d: bd, m: bm, y: (bm > 10 || (bm === 10 && bd > 7)) ? 1995 - age : 1996 - age };
  o.look = genLook(rng, o);
  o.nick = genNick(rng, o);
  o.bio = genBio(rng, o, { localDistrict: rng.pick(DISTRICT_IDS) });
  o.family.note = o.bio ? '' : '';
  return o;
}

function makeMole(game, rng, o, opts = {}) {
  const h = o.hidden;
  h.mole = true;
  const reason = hasT(o, 'gambler') ? MOLE_REASONS[1] : hasT(o, 'greedy') ? MOLE_REASONS[0] : rng.pick(MOLE_REASONS);
  h.moleReason = reason.id;
  h.tells = [fmt(rng.pick(reason.tells), { s: o }), fmt(rng.pick(MOLE_BEHAVIOR_TELLS), { s: o })];
  h.corruption = Math.max(h.corruption, rng.int(55, 80));
  h.planted = !!opts.planted;
  const gangs = game.state.city && game.state.city.gangs;
  if (gangs && gangs.length) h.gangId = opts.gangId || rng.pick(gangs.filter((g) => g.status !== 'broken') || gangs).id;
}

function genRelations(game, rng, staffList) {
  const rel = (a, b) => {
    let v = rng.gauss(5, 14);
    const both = (t) => hasT(a, t) && hasT(b, t);
    const pair = (x, y) => (hasT(a, x) && hasT(b, y)) || (hasT(a, y) && hasT(b, x));
    if (both('afghan') || both('chechnya')) v += 35;
    if (both('drinker')) v += 22;
    if (pair('honest', 'greedy')) v -= 25;
    if (pair('sadist', 'kind')) v -= 22;
    if (pair('pedant', 'lazy')) v -= 28;
    if (pair('talker', 'silent')) v -= 10;
    if (both('ambitious')) v -= 25;
    if (pair('veteran', 'rookie')) v += rng.chance(0.6) ? 15 : -12;
    if (hasT(a, 'leader') || hasT(b, 'leader')) v += 8;
    if (hasT(a, 'kind') || hasT(b, 'kind')) v += 6;
    if (hasT(a, 'hothead') || hasT(b, 'hothead')) v -= 6;
    if (a.role === b.role) v += 4;
    return Math.round(clamp(v, -80, 80));
  };
  for (let i = 0; i < staffList.length; i++) for (let j = i + 1; j < staffList.length; j++) {
    const a = staffList[i], b = staffList[j];
    const v = rel(a, b);
    a.relations[b.id] = clamp(v + rng.int(-6, 6), -100, 100);
    b.relations[a.id] = clamp(v + rng.int(-6, 6), -100, 100);
    if (both(a, b, 'afghan')) setNote(a, b, 'Вместе вспоминают Афган — хоть и служили в разных местах.', 'Вместе вспоминают Афган — хоть и служили в разных местах.');
    else if (both(a, b, 'chechnya')) setNote(a, b, 'Оба были в Чечне. Понимают друг друга без слов.', 'Оба были в Чечне. Понимают друг друга без слов.');
  }
  function both(a, b, t) { return hasT(a, t) && hasT(b, t); }
  function setNote(a, b, ta, tb) { a.relNotes[b.id] = ta; b.relNotes[a.id] = tb; }
  // особые истории
  const stories = [
    { w: 3, ok: () => true, apply: (a, b) => { set(a, b, 30); setNote(a, b, 'Вместе учились в школе милиции.', 'Вместе учились в школе милиции.'); } },
    { w: 2, ok: (a, b) => a.family.kids && b.family.kids, apply: (a, b) => { set(a, b, 35); setNote(a, b, 'Кумовья: крестили друг другу детей.', 'Кумовья: крестили друг другу детей.'); } },
    { w: 3, ok: () => true, apply: (a, b) => { set(a, b, -30); setNote(a, b, fmt('Занял{|а} у меня полмиллиона ещё весной — и делает вид, что не помнит.', { s: b }), fmt('Должен{|на} [ему|ей] денег, и [он|она] напоминает об этом каждый день.', { s: b, o: a })); } },
    { w: 1.5, ok: (a, b) => a.gender === 'm' && b.gender === 'm' && a.family.status === 'divorced', apply: (a, b) => { set(a, b, -60); setNote(a, b, 'Из-за него ушла жена. Подробностей никто не знает, но все догадываются.', 'Старая история с чужой женой. Сам он считает, что ни при чём.'); } },
    { w: 2, ok: (a, b) => hasT(a, 'ambitious') || hasT(b, 'ambitious'), apply: (a, b) => { set(a, b, -35); setNote(a, b, 'Не поделили должность при прежнем начальнике.', 'Не поделили должность при прежнем начальнике.'); } },
    { w: 1, ok: (a, b) => a.gender !== b.gender && a.family.status === 'divorced' && b.family.status === 'divorced' && Math.abs(a.age - b.age) < 10, apply: (a, b) => { set(a, b, rng.chance(0.5) ? -20 : 15); setNote(a, b, 'Бывшие супруги. Служат в одном отделении — назло всем, включая себя.', 'Бывшие супруги. Служат в одном отделении — назло всем, включая себя.'); } },
    { w: 2, ok: (a) => !hasT(a, 'rookie'), apply: (a, b) => { set(a, b, 50); setNote(a, b, fmt('В прошлом году {вытащил|вытащила} [его|её] из-под огня у Вокзала.', { s: a, o: b }), fmt('Обязан[|а] жизнью: в прошлом году {тот|та} вытащил{|а} [его|её] из-под огня.', { s: a, o: b })); } },
  ];
  function set(a, b, v) { a.relations[b.id] = clamp(v + rng.int(-5, 5), -100, 100); b.relations[a.id] = clamp(v + rng.int(-5, 5), -100, 100); }
  const n = rng.int(2, 3);
  for (let k = 0; k < n; k++) {
    const [a, b] = rng.sample(staffList, 2);
    if (!a || !b || a.relNotes[b.id]) continue;
    const st = rng.weighted(stories.filter((s) => s.ok(a, b)));
    if (st) st.apply(a, b);
  }
}

function assignShiftGroups(game, staffList) {
  const rot = staffList.filter((o) => o.schedule === 'rotation' && inService(o));
  const groups = [[], [], []];
  const order = ['duty', 'driver', 'guard', 'kinolog', 'pps'];
  rot.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || b.skills.discipline - a.skills.discipline);
  for (const o of rot) {
    let best = 0, bestScore = 1e9;
    for (let g = 0; g < 3; g++) {
      const score = groups[g].length * 10 + groups[g].filter((x) => x.role === o.role).length * 25;
      if (score < bestScore) { bestScore = score; best = g; }
    }
    groups[best].push(o); o.shiftGroup = best;
  }
  for (const o of staffList) if (o.schedule !== 'rotation') o.shiftGroup = -1;
}

function genCandidates(game, n) {
  const rng = R(game);
  const res = [];
  const lateCampaign = day(game) >= 40;
  const archetypes = [
    { w: 3, spec: () => ({ role: 'pps' }), pitch: ['После армии, ищет работу «с формой и общагой».', 'Пришёл по объявлению в газете «Из рук в руки».'] },
    { w: lateCampaign ? 4 : 2, spec: () => ({ role: 'pps', gender: 'm', age: rng.int(20, 26), force: ['chechnya'] }), pitch: ['Только что вернулся из Чечни. Говорит мало, руки не дрожат.', 'Дембель из-под Грозного. Хочет «туда, где хоть что-то понятно».'] },
    { w: 1.5, spec: () => ({ role: 'pps', gender: 'm', age: rng.int(26, 34), force: [rng.pick(['sadist', 'hothead'])] }), pitch: ['Бывший омоновец: уволен «за превышение». Стреляет отлично. Про превышение говорит неохотно.'], note: 'omon' },
    { w: 1.2, spec: () => ({ role: rng.pick(['pps', 'duty']), force: ['lazy'] }), pitch: ['Племянник заместителя главы администрации. Звонили «сверху», просили посмотреть.'], note: 'nephew' },
    { w: 1.5, spec: () => ({ role: rng.pick(['oper', 'duty', 'uchastkovy']), gender: 'f', rookie: true, force: [rng.pick(['idealist', 'pedant', 'sharp'])] }), pitch: ['Выпускница школы милиции с красным дипломом. Просится «на живую работу».'] },
    { w: 1.2, spec: () => ({ role: rng.pick(['uchastkovy', 'duty', 'guard']), age: rng.int(50, 56), force: ['veteran'] }), pitch: ['Пенсионер МВД: «на пенсию не прожить». Знает полгорода.'] },
    { w: 1.5, spec: () => ({ role: 'pps', gender: 'm', age: rng.int(23, 30), force: ['athlete'] }), pitch: ['Бывший боксёр. Говорит, что «с братвой завязал». Рекомендаций нет.'], note: 'suspicious' },
    { w: 1.5, spec: () => ({ role: 'driver' }), pitch: ['Шофёр с автобазы: базу закрыли, а он «без руля не может».'] },
    { w: 1.2, spec: () => ({ role: 'oper' }), pitch: ['Переводится из соседнего района. Почему уходит — не говорит.'] },
    { w: 0.8, spec: () => ({ role: 'kinolog' }), pitch: ['Кинолог из питомника УВД. Придёт вместе с собакой, если собаку купите.'] },
    { w: 1, spec: () => ({ role: 'guard' }), pitch: ['Бывший контролёр из колонии. Спокойный, как стена.'] },
  ];
  for (let i = 0; i < n; i++) {
    const a = rng.weighted(archetypes);
    const spec = { ...a.spec(), candidate: true };
    if (spec.role === 'oper' || spec.role === 'uchastkovy') spec.rookie = spec.rookie || rng.chance(0.3);
    const o = makeOfficer(game, rng, spec);
    o.loyalty = rng.int(40, 55); o.morale = rng.int(50, 70); o.fatigue = rng.int(0, 15);
    o.cand = { pitch: F(game, rng.pick(a.pitch), o), expiresDay: day(game) + rng.int(4, 7), note: a.note || null };
    if (a.note === 'nephew') o.cand.authorityBonus = 4;
    // банда может подсунуть своего
    const gangs = game.state.city && game.state.city.gangs;
    const plant = a.note === 'suspicious' ? 0.5 : 0.07;
    if (gangs && gangs.length && rng.chance(plant)) makeMole(game, rng, o, { planted: true });
    res.push(o);
  }
  return res;
}

// ======================= расписание =======================
function canWork(o, d) {
  if (!inService(o) || o.status === 'missing') return false;
  if (['leave', 'hospital'].includes(o.status)) return false;
  if (o.cond.sick > 0) return false;
  if (o.suspendedUntil && d < o.suspendedUntil) return false;
  if (o.dayOffDay === d) return false;
  return true;
}
/** Авто-график: сутки через двое для смен, пятидневка для оперов и участковых; гарантирует дежурного. */
export function autoSchedule(game, d = day(game)) {
  const all = list(game).filter((o) => canWork(o, d));
  const wd = calendar(d, game.state.campaign && game.state.campaign.startDate).weekday;
  const on = new Set();
  for (const o of all) {
    if (o.schedule === 'rotation' && o.shiftGroup === (d - 1) % 3) on.add(o);
    if (o.schedule === 'weekdays' && wd < 5) on.add(o);
    if (o.flags.owesShift === d) on.add(o);
  }
  // гарантировать дежурного
  if (![...on].some((o) => o.role === 'duty')) {
    const sub = all.filter((o) => !on.has(o) && o.role === 'duty').sort((a, b) => a.fatigue - b.fatigue)[0]
      || [...on].filter((o) => ['uchastkovy', 'oper', 'guard', 'pps'].includes(o.role) && RANK_BY_ID[o.rankId].level >= 3).sort((a, b) => b.skills.discipline - a.skills.discipline)[0];
    if (sub) { on.add(sub); sub.flags.actingDuty = d; }
  }
  // водитель
  if (![...on].some((o) => o.role === 'driver' || o.skills.driving >= 50)) {
    const drv = all.filter((o) => !on.has(o) && (o.role === 'driver' || o.skills.driving >= 50)).sort((a, b) => a.fatigue - b.fatigue)[0];
    if (drv) on.add(drv);
  }
  // конвойный, если в камерах кто-то есть
  const hasDet = (game.state.detainees || []).some((x) => x.status === 'cell');
  if (hasDet && ![...on].some((o) => o.role === 'guard')) {
    const g = all.filter((o) => !on.has(o) && o.role === 'guard').sort((a, b) => a.fatigue - b.fatigue)[0];
    if (g) on.add(g);
  }
  return [...on].map((o) => o.id);
}

function startShift(game) {
  const d = day(game), t = nowAbs(game);
  const auto = new Set(autoSchedule(game, d));
  for (const o of list(game)) {
    if (!inService(o) || o.status === 'missing') { o.onShift = false; continue; }
    let on = auto.has(o.id);
    if (o.planned && o.planned.day === d) on = o.planned.on && canWork(o, d);
    if (o.flags.awolDay === d) { on = false; o.flags.awolDay = null; o.record.misconduct.push({ day: d, kind: 'awol' }); glog(game, F(game, '%s.dn% не {вышел|вышла} на смену — самовольно. Телефон дома не отвечает.', o), 'staff'); applyEff(game, o, { loyalty: -3 }); }
    o.onShift = on; o.overtime = false; o.goingHome = null;
    if (o.flags.actingDuty !== d) o.flags.actingDuty = null;
    if (on && o.status === 'home') { o.status = 'station'; }
    if (!on && o.status === 'station') o.status = 'home';
    if (!on && o.status === 'task') o.goingHome = -1; // уйдёт домой по возвращении
  }
  void t;
}

// ======================= мораль =======================
function supplyStatus(game) { return (game.state.economy && game.state.economy.supply) || { tea: true, smokes: true, food: true }; }
export function moraleTarget(game, o) {
  let t = 52;
  const e = game.state.economy;
  const owed = e && e.salary ? e.salary.owedMonths : 0;
  if (owed > 0) t -= (10 + 8 * (owed - 1)) * (1 + mod(o, 'pay_sensitivity', { traitsOnly: true }));
  const fl = ownedFlags(game);
  const month = calendar(day(game), game.state.campaign && game.state.campaign.startDate).m;
  const winter = month >= 11 || month <= 3;
  for (const id of Object.keys((e && e.upgrades) || {})) { const u = UPGRADES[id]; if (u) { t += u.comfort || 0; if (winter) t += u.winterComfort || 0; } }
  if (winter && !fl.heating) t -= 4;
  if (!fl.roofOk) t -= 1.5;
  if (game.state.building) t += +game.state.building.moraleMod || 0; // состояние здания (sim/building.js)
  const ss = supplyStatus(game);
  t += ss.tea ? 2 : -3;
  if (o.smoker) t += ss.smokes ? 2 : -6;
  t += (o.loyalty - 50) * 0.15;
  if (o.stats.consecutive >= 2) t -= 6 * (o.stats.consecutive - 1);
  for (const i of o.injuries) t -= 3 * i.severity;
  if (o.stress > 40) t -= (o.stress - 40) * 0.25;
  if (o.fatigue > 70) t -= (o.fatigue - 70) * 0.2;
  // сплочённость: отношения с товарищами по смене
  const mates = list(game).filter((x) => x !== o && inService(x) && x.shiftGroup === o.shiftGroup && o.shiftGroup >= 0);
  if (mates.length) t += (mates.reduce((a, x) => a + (o.relations[x.id] || 0), 0) / mates.length) * 0.06;
  for (const x of mates) t += mod(x, 'cohesion', { traitsOnly: true }) * 10;
  if (hasT(o, 'cynic')) t = 50 + (t - 50) * 0.7;
  return clamp(t, 5, 95);
}

// ======================= события входящих =======================
function pushInbox(game, item) {
  const s = game.state;
  if (!s.inbox) s.inbox = [];
  const it = Object.assign({ id: uid('in'), source: 'staff', kind: 'note', title: '', text: '', choices: [], day: s.time.day, minute: s.time.minute, expires: null, autoChoice: null, answered: null, result: null, data: {} }, item);
  s.inbox.push(it);
  const answered = s.inbox.filter((x) => x.answered);
  if (answered.length > 40) s.inbox.splice(s.inbox.indexOf(answered[0]), 1);
  emit(game, 'inbox', { item: it });
  return it;
}
export { pushInbox };
function pendingCount(game, kind, officerId) { return (game.state.inbox || []).filter((x) => !x.answered && x.source === 'staff' && (!kind || x.kind === kind) && (!officerId || x.officerId === officerId)).length; }
function expireIn(game, hours) { const t = nowAbs(game) + hours * 60; return { day: Math.floor(t / 1440) + 1, minute: t % 1440 }; }
const ch = (id, label, desc) => (desc ? { id, label, desc } : { id, label });

const DAYOFF_REASONS = [
  { w: 3, ok: (o, m) => m === 9 || m === 10, t: 'Просит отгул на завтра: копать картошку на даче, пока не замёрзла. «Без картошки зиму не переживём, товарищ %p.rank%, это не шутка».' },
  { w: 3, ok: (o) => o.family.kids > 0, t: 'Просит отгул: у %kid% день рождения. «В прошлом году обещал{|а} — и не {пришёл|пришла}. Второй раз нельзя».' },
  { w: 2, ok: (o) => o.gender === 'm' && o.family.married && o.age < 40, t: 'Жена в роддоме, со дня на день. Просит отгул хотя бы на завтра.' },
  { w: 2, ok: () => true, t: 'Мать положили в областную больницу. Просит отгул — съездить, сорок километров электричкой.' },
  { w: 1.5, ok: (o) => o.family.married, t: 'Хоронят {тёщу|свекровь}. Просит отгул на завтра.' },
  { w: 2, ok: (o) => o.family.status === 'divorced', t: 'Завтра в десять — суд по алиментам. Не прийти нельзя.' },
  { w: 2, ok: (o, m) => m === 10 || m === 11, t: 'Надо перекрыть крышу на даче до снега — потом будет поздно.' },
  { w: 1, ok: () => true, t: 'Брат женится. «Один раз в жизни, товарищ %p.rank%. Ну, второй».' },
  { w: 4, ok: (o) => o.stats.consecutive >= 2 || o.fatigue > 72, t: '«Не могу больше, товарищ %p.rank%. Третьи сутки сплю урывками». Просит отгул.' },
];
const QUARREL_WHY = ['из-за смены, которую один отработал за другого', 'из-за денег', 'кто-то кого-то назвал стукачом', 'из-за последнего выезда: каждый считает, что другой подставил', 'из-за бутылки, которой никто не видел, но все обсуждают'];

function genEvent(game, kind, o, extra = {}) {
  const rng = R(game), p = player(game);
  const m = calendar(day(game), game.state.campaign && game.state.campaign.startDate).m;
  const base = { source: 'staff', kind, officerId: o ? o.id : null };
  switch (kind) {
    case 'dayoff_request': {
      const r = rng.weighted(DAYOFF_REASONS.filter((x) => x.ok(o, m)));
      const kid = o.family.children.length ? (rng.pick(o.family.children).g === 'f' ? 'дочки' : 'сына') : 'сына';
      return pushInbox(game, { ...base, title: F(game, 'Просьба об отгуле: %s.dn%', o), text: F(game, r.t, o, null, { kid }),
        choices: [ch('grant', 'Дать отгул'), ch('grant_trade', 'Дать, но отработает в свой выходной'), ch('refuse', 'Отказать: людей нет')], expires: expireIn(game, 12), autoChoice: 'refuse' });
    }
    case 'resignation': {
      const why = rng.pick([
        F(game, 'Зовут в охранную фирму: там платят миллион в месяц, и платят.', o),
        F(game, '{Жена сказала|Муж сказал}: или милиция, или семья.', o),
        F(game, 'Не хочу, чтобы меня, как прежнего начальника, — на крыльце.', o),
        F(game, 'Устал{|а}. Просто устал{|а}, товарищ %p.rank%.', o),
      ]);
      return pushInbox(game, { ...base, title: F(game, 'Рапорт об увольнении: %s.dn%', o), text: F(game, '%s.dn% {положил|положила} на стол рапорт об увольнении по собственному желанию. «%why%»', o, null, { why }),
        choices: [ch('persuade', 'Уговорить остаться'), ch('bonus', 'Предложить премию (300 тыс.)'), ch('threaten', '«Уволю по статье — никуда не возьмут»'), ch('accept', 'Подписать рапорт')], expires: expireIn(game, 24), autoChoice: 'accept' });
    }
    case 'quarrel': {
      const b = extra.other;
      const why = a2b(o, b) || rng.pick(QUARREL_WHY);
      return pushInbox(game, { ...base, data: { otherId: b.id }, title: 'Ссора в курилке', text: F(game, '%s.dn% и %o.dn% сцепились в курилке — %why% Дежурный еле растащил.', o, b, { why: why.endsWith('.') ? why : why + '.' }),
        choices: [ch('talk_both', 'Вызвать обоих и поговорить'), ch('punish_both', 'Обоим по выговору'), ch('separate', 'Развести по разным сменам'), ch('ignore', 'Сами разберутся')], expires: expireIn(game, 10), autoChoice: 'ignore' });
    }
    case 'bribe_rumor': {
      const place = rng.pick(['на Вокзале', 'на Рынке', 'у ночных ларьков в Центре', 'у автостоянки на Черёмушках']);
      return pushInbox(game, { ...base, data: { truth: !!extra.truth }, title: 'Слух о взятках', text: F(game, 'По отделу ходит слух: %s.dn% берёт с ларёчников %place%. «По пятницам, как зарплату», — говорят в курилке.', o, null, { place }),
        choices: [ch('investigate', 'Начать проверку (наружка, 400 тыс., 3 дня)'), ch('call_in', 'Вызвать на разговор'), ch('report', 'Доложить в инспекцию по личному составу'), ch('ignore', 'Не обращать внимания')], expires: expireIn(game, 24), autoChoice: 'ignore' });
    }
    case 'drunk_at_work': {
      const heavy = o.cond.drunk > 300;
      return pushInbox(game, { ...base, title: F(game, 'Пьян{|а} на службе: %s.dn%', o), text: F(game, heavy ? '%s.dn% {заступил|заступила} на смену еле держась на ногах. Дежурный усадил{|а} в комнате отдыха и ждёт приказа.' : '%s.dn% {заступил|заступила} на смену с запахом. Дежурный говорит: «Стоит ровно, но в глаза не смотрит».', o),
        choices: [ch('send_home', 'Отстранить и отправить домой'), ch('sleep_off', 'Пусть проспится в комнате отдыха'), ch('reprimand', 'Выговор и домой'), ch('cover', 'Закрыть глаза — людей и так нет')], expires: expireIn(game, 2), autoChoice: 'sleep_off' });
    }
    case 'asks_advance': {
      const sum = rng.pick([200, 300, 400, 500]);
      const why = o.hidden.debt > 0 ? 'Долг надо отдать до пятницы. Людям, которые не ждут.' : o.family.kids ? 'Детям зимние сапоги, а зарплаты нет.' : 'Матери лекарства нужны, импортные. Наших нет.';
      return pushInbox(game, { ...base, data: { sum }, title: F(game, 'Просит аванс: %s.dn%', o), text: F(game, 'Просит аванс из кассы отделения — %sum%. «%why%»', o, null, { sum: money(sum), why }),
        choices: [ch('give', `Дать ${money(sum)}`), ch('give_half', `Дать половину (${money(Math.round(sum / 2))})`), ch('refuse', 'Отказать')], expires: expireIn(game, 12), autoChoice: 'refuse' });
    }
    case 'birthday':
      return pushInbox(game, { ...base, title: F(game, 'День рождения: %s.dn%', o), text: F(game, 'У %s.last_g% сегодня день рождения — %age%. Отделение скидывается на торт, именинни{к|ца} собирается «проставиться» после смены.', o, null, { age: `${o.age} ${o.age % 10 === 1 && o.age !== 11 ? 'год' : [2, 3, 4].includes(o.age % 10) && ![12, 13, 14].includes(o.age) ? 'года' : 'лет'}` }),
        choices: [ch('allow', 'Разрешить посидеть после смены'), ch('gift', 'Подарок от отделения (100 тыс.)'), ch('forbid', 'Никаких застолий в отделении')], expires: expireIn(game, 10), autoChoice: 'allow' });
    case 'family_crisis': {
      const opts = [];
      if (o.gender === 'm' && o.family.status === 'married') opts.push({ id: 'left', t: 'Жена ушла. Забрала детей и уехала к матери в область. Оставила записку на холодильнике.' });
      if (o.gender === 'f' && o.family.status === 'married') opts.push({ id: 'left', t: 'Муж ушёл. Собрал вещи, пока она была на сутках.' });
      if (o.family.children.some((c) => c.age >= 13 && c.age <= 17)) opts.push({ id: 'teen', t: 'Сына-подростка забрали в милицию в соседнем районе: подрался на дискотеке, у второго — сотрясение.' });
      if (o.family.children.some((c) => c.age < 10)) opts.push({ id: 'ill', t: 'Ребёнок в больнице: воспаление лёгких. Нужны импортные антибиотики.' });
      opts.push({ id: 'robbed', t: 'Квартиру обокрали, пока {он|она} был{|а} на смене. Вынесли телевизор, шубу и деньги, отложенные на зиму.' });
      opts.push({ id: 'mother', t: 'Мать при смерти: инсульт. Врачи говорят — дни.' });
      const c = rng.pick(opts);
      if (c.id === 'left') { o.family.status = 'separated'; o.family.married = false; o.flags.familyTrouble = 'Ушла семья.'; }
      else o.flags.familyTrouble = F(game, c.t, o);
      applyEff(game, o, { morale: -12, stress: 15 });
      return pushInbox(game, { ...base, data: { crisis: c.id }, title: F(game, 'Беда в семье: %s.dn%', o), text: F(game, c.t, o),
        choices: [ch('leave3', 'Отпустить на три дня'), ch('money', 'Помочь деньгами (200 тыс.)'), ch('talk', 'Поговорить'), ch('nothing', 'Служба есть служба')], expires: expireIn(game, 12), autoChoice: 'nothing' });
    }
    case 'transfer_offer':
      return pushInbox(game, { ...base, title: F(game, 'Переманивают: %s.dn%', o), text: F(game, '%s.dn% {признался|призналась}: зовут в охранное агентство «Щит» — два с половиной миллиона в месяц, «и платят каждый месяц». Колеблется.', o),
        choices: [ch('counter', 'Премия 400 тыс. и благодарность'), ch('promote', 'Представить к очередному званию'), ch('appeal', 'Поговорить о долге'), ch('release', 'Отпустить с миром')], expires: expireIn(game, 24), autoChoice: 'release' });
    case 'flashback': {
      const what = F(game, rng.pick(['услышал{|а} хлопок на улице и {упал|упала} на пол, закрыв голову руками', 'кричал{|а} во сне так, что проснулась вся смена', 'разбил{|а} кулаком стекло в дежурке — показалось, что на крыльце кто-то с автоматом']), o);
      return pushInbox(game, { ...base, title: F(game, 'Срыв: %s.dn%', o), text: F(game, 'Ночью %s.dn% {сорвался|сорвалась}: %what%. Сейчас сидит в комнате отдыха и курит одну за одной.', o, null, { what }),
        choices: [ch('doctor', 'В госпиталь ветеранов, к психиатру — на неделю'), ch('talk', 'Посидеть рядом, поговорить'), ch('ignore', 'Пусть отоспится')], expires: expireIn(game, 8), autoChoice: 'ignore' });
    }
    case 'citizen_thanks':
      return pushInbox(game, { ...base, title: 'Благодарность от граждан', text: F(game, rng.pick([
        'В дежурку пришла бабушка с банкой малинового варенья — «тому милиционеру, который нашёл моего внука». Это был{|а} %s.dn%.',
        'Пришло письмо от жильцов дома на Черёмушках: «Выражаем благодарность %s.dn_d% за то, что не побоял{ся|ась} и разнял{|а} драку у подъезда». Двенадцать подписей.',
        'Водитель автобуса принёс коробку конфет: %s.dn% вчера ночью вытащил{|а} его из перевёрнутого «пазика».']), o),
        choices: [ch('thanks_order', 'Объявить благодарность в приказе'), ch('share', 'Поставить чайник — на всех')], expires: expireIn(game, 12), autoChoice: 'share' });
    case 'rookie_mistake': {
      const opts = [
        { id: 'mag', t: 'потерял{|а} на выезде магазин от ПМ — восемь патронов' },
        { id: 'cuffs', t: 'забыл{|а} наручники на отпущенном задержанном — наручники ушли вместе с ним' },
        { id: 'uaz', t: 'поцарапал{|а} УАЗ о ворота двора: фара вдребезги' },
        { id: 'shot', t: 'выстрелил{|а} в воздух, испугавшись собаки на стройке. Гильзу искали всей сменой' },
      ];
      const c = rng.pick(opts);
      if (c.id === 'mag') { o.equipment.ammo = Math.max(0, o.equipment.ammo - 8); }
      if (c.id === 'cuffs' && o.equipment.cuffs) o.equipment.cuffs = false;
      if (c.id === 'uaz') economy.damageVehicle(game, null, 6, 'фара');
      if (c.id === 'shot') o.equipment.ammo = Math.max(0, o.equipment.ammo - 1);
      o.record.misconduct.push({ day: day(game), kind: 'mistake' });
      return pushInbox(game, { ...base, data: { mistake: c.id }, title: F(game, 'Салага: %s.dn%', o), text: F(game, '%s.dn% ' + c.t + '.', o),
        choices: [ch('deduct', 'Удержать из зарплаты'), ch('reprimand', 'Выговор'), ch('forgive', 'Все через это прошли'), ch('teach', 'Прикрепить к опытному наставнику')], expires: expireIn(game, 12), autoChoice: 'forgive' });
    }
    case 'complaint_citizen': {
      const where = rng.pick(['у ночного ларька на Вокзале', 'в подъезде на Черёмушках', 'на Рынке', 'у бара «Шанс»']);
      const victim = rng.pick(['— пьяного студента', '— грузчика с Рынка', '— подростка шестнадцати лет', '— безработного, который «просто спросил, за что»']);
      o.record.misconduct.push({ day: day(game), kind: 'brutality' });
      return pushInbox(game, { ...base, title: 'Жалоба в прокуратуру', text: F(game, 'В прокуратуру поступила жалоба: %s.dn% %where% избил{|а} задержанного %victim%. Синяки сняты в травмпункте.', o, null, { where, victim }),
        choices: [ch('protect', 'Прикрыть: «упал сам»'), ch('punish', 'Строгий выговор'), ch('hand_over', 'Передать материалы в прокуратуру')], expires: expireIn(game, 24), autoChoice: 'protect' });
    }
    case 'mole_activity': {
      const opts = [
        { id: 'ammo', t: 'В оружейке недосчитались двух пачек патронов 9×18. Журнал выдачи в порядке — а патронов нет.' },
        { id: 'call', t: 'Дежурный заметил: ночью кто-то звонил из кабинета оперов. Номер в журнал не записан.' },
        { id: 'raid', t: 'Наряд приехал на точку на Рынке — а там пусто, будто ждали. Уже не первый раз.' },
      ];
      const c = rng.pick(opts);
      if (c.id === 'ammo' && game.state.economy) { const a = game.state.economy.ammo; a['9x18'] = Math.max(0, (a['9x18'] || 0) - 32); }
      const onShift = list(game).filter((x) => x.onShift && inService(x)).map((x) => x.id);
      if (!onShift.includes(o.id)) onShift.push(o.id);
      return pushInbox(game, { ...base, officerId: null, data: { moleId: o.id, onShift }, title: 'Подозрительное', text: c.t,
        choices: [ch('suspects', 'Посмотреть, кто был на смене'), ch('audit', 'Ревизия оружейки и журналов'), ch('ignore', 'Совпадение')], expires: expireIn(game, 24), autoChoice: 'ignore' });
    }
    case 'funeral': {
      const fam = o.family.married ? (o.gender === 'm' ? 'вдова' : 'вдовец') : o.family.kids ? 'дети' : 'мать';
      const text = F(game, 'Похороны %s.last_g% — послезавтра. Осталась %fam%%kids%. Управление обещает материальную помощь «в установленном порядке» — то есть через полгода.', o, null, { fam, kids: o.family.kids ? `, ${kidsText(o.family.children)}` : '' }).replace('Осталась вдовец', 'Остался вдовец').replace('Осталась дети', 'Остались дети');
      return pushInbox(game, { ...base, title: F(game, 'Похороны: %s.dn%', o), text,
        choices: [ch('pay', 'Похороны и поминки за счёт отделения (1,5 млн)'), ch('visit', 'Лично прийти к семье'), ch('standard', 'Всё — по линии управления')], expires: expireIn(game, 24), autoChoice: 'standard' });
    }
    case 'binge_return':
      return pushInbox(game, { ...base, title: F(game, 'Вернул{ся|ась}: %s.dn%', o), text: F(game, '%s.dn% {вернулся|вернулась} после %n%-дневного запоя. Стоит в дверях кабинета, мнёт фуражку.', o, null, { n: extra.days || 3 }),
        choices: [ch('fire', 'Уволить по статье'), ch('written', 'Строгий выговор'), ch('treatment', 'В наркодиспансер на десять дней'), ch('forgive', 'Простить — последний раз')], expires: expireIn(game, 12), autoChoice: 'written' });
    case 'sleeping':
      return pushInbox(game, { ...base, title: F(game, 'Сон на посту: %s.dn%', o), text: F(game, 'Под утро дежурный застал %s.dn_a% спящ{им|ей} на посту. Оружие — на коленях.', o),
        choices: [ch('verbal', 'Замечание'), ch('let_sleep', 'Пусть поспит два часа'), ch('ignore', 'Сделать вид, что не видели')], expires: expireIn(game, 3), autoChoice: 'let_sleep' });
    default: return null;
  }
}
function a2b(a, b) { return a.relNotes[b.id] ? a.relNotes[b.id].replace(/\.$/, '').toLowerCase() : null; }

function resolveStaffEvent(game, item, c) {
  const rng = R(game);
  const o = byId(game, item.officerId);
  const d = day(game);
  const T = (s, other, vars) => F(game, s, o, other, vars);
  switch (item.kind) {
    case 'dayoff_request':
      if (c === 'grant') { o.dayOffDay = d + 1; applyEff(game, o, { morale: 7, loyalty: lg(o, 4) }); return T('Отгул на завтра. %s.dn% благодарит — коротко, но от души.'); }
      if (c === 'grant_trade') { o.dayOffDay = d + 1; o.flags.owesShift = d + 4; applyEff(game, o, { morale: 3, loyalty: lg(o, 1) }); return T('Отгул на завтра — с отработкой через три дня. %s.dn% кивает: «Справедливо».'); }
      applyEff(game, o, { morale: -6, loyalty: lg(o, -5) });
      if (o.skills.discipline + mod(o, 'discipline') * 100 < 40 && rng.chance(0.35)) o.flags.awolDay = d + 1;
      return T('Отказано. %s.dn% молча {вышел|вышла} из кабинета.');
    case 'resignation': {
      if (c === 'persuade') {
        const p = 0.25 + o.loyalty / 150 + (hasT(o, 'idealist') ? 0.15 : 0) - (hasT(o, 'cynic') ? 0.1 : 0);
        if (rng.chance(p)) { applyEff(game, o, { morale: 10, loyalty: lg(o, 6) }); return T('Долгий разговор. %s.dn% забирает рапорт: «Ладно. Ради ребят. Но если и дальше так — уйду».'); }
        quit(game, o); return T('Не уговорили. «Простите, товарищ %p.rank%. Решение принято». %s.dn% сдаёт удостоверение.');
      }
      if (c === 'bonus') {
        if (!economy.canAfford(game, 300)) { quit(game, o); return T('Денег в кассе нет — и %s.dn% это видит. Рапорт подписан.'); }
        economy.addMoney(game, -300, 'премия, чтобы удержать сотрудника');
        if (rng.chance(hasT(o, 'greedy') || hasT(o, 'family_man') ? 0.95 : 0.75)) { applyEff(game, o, { morale: 15, loyalty: lg(o, 4) }); o.record.rewards.push({ day: d, kind: 'bonus' }); return T('Премия 300 тыс. — и рапорт порван. Надолго ли — неизвестно.'); }
        quit(game, o); return T('Премию %s.dn% взял{|а}... и всё равно {ушёл|ушла}. «Это на дорогу, товарищ %p.rank%».');
      }
      if (c === 'threaten') { applyEff(game, o, { morale: -10, loyalty: lg(o, -15), corruption: 10 }); o.flags.grudge = true; return T('%s.dn% забирает рапорт. В глазах — злость. Такие люди не забывают.'); }
      quit(game, o); return T('Рапорт подписан. %s.dn% больше у нас не служит.');
    }
    case 'quarrel': {
      const b = byId(game, item.data.otherId);
      if (!b) return 'Разбираться уже не с кем.';
      if (c === 'talk_both') { const ok = rng.chance(0.6); addRel(o, b, ok ? 18 : 6); addRel(b, o, ok ? 18 : 6); return ok ? T('Поговорили втроём. Руки пожали — нехотя, но пожали.', b) : T('Поговорили. Помолчали. Разошлись. Но хотя бы не дерутся.', b); }
      if (c === 'punish_both') { for (const x of [o, b]) { x.record.misconduct.push({ day: d, kind: 'fight' }); reprimand(game, x.id, 'written'); } addRel(o, b, -5); addRel(b, o, -5); return T('Обоим — по выговору. Теперь они злы не только друг на друга.', b); }
      if (c === 'separate') {
        if (o.schedule === 'rotation' && b.schedule === 'rotation') { b.shiftGroup = (o.shiftGroup + 1 + rng.int(0, 1)) % 3; return T('%o.dn% переведен[|а] в смену %grp%. Больше не пересекаются — кроме как в курилке.', b, { grp: SHIFT_NAMES[b.shiftGroup] }); }
        return T('Развести не получится: график у них разный, а курилка — одна.', b);
      }
      addRel(o, b, -10); addRel(b, o, -10);
      if (rng.chance(0.35)) { const v = rng.pick([o, b]); applyInjury(game, v.id, 1, 'драка'); return T('Сами не разобрались: через день — драка в гараже. %x%', b, { x: F(game, '%s.dn% — с разбитым лицом.', v) }); }
      return T('Не вмешивались. Пока тихо — но не мирно.', b);
    }
    case 'bribe_rumor': {
      if (c === 'investigate') return investigate(game, o.id, 'surveillance').text;
      if (c === 'call_in') { const r = talk(game, o.id, 'loyalty'); return r.text; }
      if (c === 'report') {
        if (o.hidden.corruption > 55 || o.hidden.mole) { campaign.addAuthority(game, 3, 'сдал коррупционера'); o.suspendedUntil = d + 5; if (o.status === 'station') o.status = 'home'; o.onShift = false; applyEff(game, o, { morale: -25, loyalty: -30 }); reveal(game, o, 'greedy'); everyone(game, (x) => { if (hasT(x, 'honest') || hasT(x, 'idealist')) applyEff(game, x, { loyalty: lg(x, 3) }); else if (x !== o) applyEff(game, x, { loyalty: -2 }); }); return T('Инспекция приехала, нашла. %s.dn% отстранен{|а} на пять дней до решения. В отделе притихли.'); }
        campaign.addAuthority(game, -3, 'ложный донос'); applyEff(game, o, { morale: -20, loyalty: -25 }); everyone(game, (x) => x !== o && applyEff(game, x, { loyalty: -3 })); return T('Инспекция ничего не нашла. %s.dn% чист{|а} — и смертельно обижен{|а}. Остальные смотрят на вас косо.');
      }
      if (item.data.truth) { o.hidden.corruption = clamp(o.hidden.corruption + 5, 0, 100); everyone(game, (x) => { if (hasT(x, 'honest') || hasT(x, 'idealist')) applyEff(game, x, { morale: -2 }); }); }
      return 'Слух повисел в курилке и растаял. Как и всё у нас.';
    }
    case 'drunk_at_work':
      o.record.misconduct.push({ day: d, kind: 'drunk' });
      if (c === 'send_home') { o.onShift = false; if (o.status === 'station') o.status = 'home'; o.cond.drunk = 0; o.cond.hangover = 600; applyEff(game, o, { morale: -4 }); return T('%s.dn% отстранен{|а} и отправлен{|а} домой. В смене на одного человека меньше.'); }
      if (c === 'sleep_off') { o.restUntil = nowAbs(game) + 240; o.cond.drunk = Math.min(o.cond.drunk, 240); return T('%s.dn% спит в комнате отдыха. К обеду будет человеком — помятым.'); }
      if (c === 'reprimand') { reprimand(game, o.id, 'written'); o.onShift = false; if (o.status === 'station') o.status = 'home'; o.cond.drunk = 0; o.cond.hangover = 600; return T('Выговор в личное дело — и домой. %s.dn% {ушёл|ушла}, не попрощавшись.'); }
      applyEff(game, o, { loyalty: lg(o, 5) }); o.flags.coveredDrunk = d;
      everyone(game, (x) => { if (x !== o && (hasT(x, 'pedant') || hasT(x, 'honest'))) applyEff(game, x, { morale: -2, loyalty: -1 }); });
      return T('Сделали вид, что ничего не было. %s.dn% на посту. Пахнет на всю дежурку.');
    case 'asks_advance': {
      const sum = c === 'give_half' ? Math.round(item.data.sum / 2) : item.data.sum;
      if (c === 'refuse') { applyEff(game, o, { loyalty: lg(o, -3), corruption: hasT(o, 'greedy') || hasT(o, 'gambler') ? 8 : 2 }); return T('Отказано. %s.dn% кивает: «Понимаю». Понимает — и ищет деньги в другом месте.'); }
      if (!economy.canAfford(game, sum)) return 'В кассе нет и этого. Пришлось развести руками.';
      economy.addMoney(game, -sum, 'аванс сотруднику'); o.debtToStation += sum;
      if (o.hidden.debt > 0) o.hidden.debt = Math.max(0, o.hidden.debt - sum);
      applyEff(game, o, { loyalty: lg(o, c === 'give' ? 6 : 3), morale: c === 'give' ? 6 : 3, corruption: c === 'give' ? -8 : -4 });
      if (o.hidden.debt > 0 || hasT(o, 'gambler')) reveal(game, o, 'gambler');
      return T('Выдано %sum% под расписку. Вернуть обещано с зарплаты.', null, { sum: money(sum) });
    }
    case 'birthday':
      if (c === 'allow') { everyone(game, (x) => { if (x.onShift) { applyEff(game, x, { morale: 4, stress: -4 }); if (hasT(x, 'drinker') && x.hidden.drinkLevel > 40 && rng.chance(0.5)) x.cond.hangover = 600; } }); applyEff(game, o, { morale: 6 }); return 'Посидели после смены в комнате отдыха: торт «Прага», чай, и ещё что-то в чайнике, о чём лучше не спрашивать.'; }
      if (c === 'gift') { if (!economy.canAfford(game, 100)) return 'В кассе нет даже на подарок. Скинулись сами.'; economy.addMoney(game, -100, 'подарок имениннику'); applyEff(game, o, { morale: 10, loyalty: lg(o, 6) }); everyone(game, (x) => applyEff(game, x, { morale: 2 })); return T('Подарили электробритву «Харьков» и открытку от всего отделения. %s.dn% растроган{|а}.'); }
      applyEff(game, o, { morale: -4 }); everyone(game, (x) => x !== o && applyEff(game, x, { morale: -1 })); return 'Без застолий. Торт съели молча, стоя, как на поминках.';
    case 'family_crisis':
      if (c === 'leave3') { sendLeave(game, o.id, 3); applyEff(game, o, { loyalty: lg(o, 6), stress: -10 }); return T('%s.dn% отпущен{|а} на три дня. «Спасибо, товарищ %p.rank%. Я не забуду».'); }
      if (c === 'money') { if (!economy.canAfford(game, 200)) return 'Денег в кассе нет. Помогли кто чем мог — из своих.'; economy.addMoney(game, -200, 'помощь сотруднику'); applyEff(game, o, { loyalty: lg(o, 8), morale: 6, stress: -6 }); return T('Двести тысяч из кассы — без расписки. %s.dn% не находит слов.'); }
      if (c === 'talk') { applyEff(game, o, { loyalty: lg(o, 4), stress: -8 }); return T('Поговорили. Легче не стало, но %s.dn% хотя бы знает, что не од{ин|на}.'); }
      applyEff(game, o, { loyalty: lg(o, -4), morale: -3 }); return T('«Служба есть служба». %s.dn% кивает и уходит на пост. Мыслями — не здесь.');
    case 'transfer_offer':
      if (c === 'counter') { if (!economy.canAfford(game, 400)) { quit(game, o); return 'Денег нет — и удерживать нечем. Ушёл в «Щит».'.replace('Ушёл', F(game, '{Ушёл|Ушла}', o)); } economy.addMoney(game, -400, 'удержание сотрудника'); reward(game, o.id, 'thanks'); if (rng.chance(0.8)) { applyEff(game, o, { morale: 12 }); return T('%s.dn% остаётся. Пока.'); } quit(game, o); return T('Премию взял{|а}, благодарность прочитал{|а} — и всё равно {ушёл|ушла} в «Щит».'); }
      if (c === 'promote') { const r = promote(game, o.id); if (r.ok && rng.chance(0.85)) return r.text + ' ' + T('%s.dn% остаётся.'); if (!r.ok) { quit(game, o); return r.text + ' ' + T('%s.dn% {ушёл|ушла} в «Щит».'); } quit(game, o); return T('Звание получил{|а} — и с новыми погонами {ушёл|ушла} в «Щит». Там такие ценят.'); }
      if (c === 'appeal') { const p = 0.25 + o.loyalty / 120 + (hasT(o, 'idealist') || hasT(o, 'honest') ? 0.3 : 0) - (hasT(o, 'cynic') || hasT(o, 'greedy') ? 0.25 : 0); if (rng.chance(p)) { applyEff(game, o, { loyalty: lg(o, 8) }); return T('«Кто, если не мы», — сказали вы. %s.dn% долго молчал{|а}, потом сказал{|а}: «Ладно. Остаюсь». Удивительно.'); } quit(game, o); return T('Про долг %s.dn% выслушал{|а} вежливо. И {ушёл|ушла} туда, где долг платят деньгами.'); }
      quit(game, o); everyone(game, (x) => applyEff(game, x, { morale: -3 })); return T('%s.dn% {ушёл|ушла} в «Щит». Остальные задумались.');
    case 'flashback':
      if (c === 'doctor') { sendLeave(game, o.id, 7); o.flags.therapy = true; applyEff(game, o, { stress: -25, morale: 3 }); return T('%s.dn% на неделю в госпитале ветеранов. Сначала сопротивлял{ся|ась}, потом — согласил{ся|ась}.'); }
      if (c === 'talk') { applyEff(game, o, { stress: -20, loyalty: lg(o, 6) }); return T('Просидели до рассвета. Говорил{|а} %s.last% — вы слушали.'); }
      applyEff(game, o, { stress: -5 }); o.flags.flashbacks = (o.flags.flashbacks || 0) + 1; return T('%s.dn% отоспал{ся|ась}. Утром делает вид, что ничего не было. Вы — тоже.');
    case 'citizen_thanks':
      if (c === 'thanks_order') return reward(game, o.id, 'thanks').text;
      everyone(game, (x) => { if (x.onShift) applyEff(game, x, { morale: 3 }); }); applyEff(game, o, { morale: 4 }); return 'Чайник вскипел. Пять минут в отделении было по-домашнему.';
    case 'rookie_mistake':
      if (c === 'deduct') { applyEff(game, o, { morale: -8, loyalty: lg(o, -4) }); economy.addMoney(game, 60, 'удержание из зарплаты'); return T('Удержали из зарплаты. Которой и так нет. %s.dn% урок усвоил{|а} — и обиду тоже.'); }
      if (c === 'reprimand') return reprimand(game, o.id, 'written').text;
      if (c === 'teach') {
        const mentor = list(game).filter((x) => x !== o && present(x) || (x !== o && x.status === 'home')).filter((x) => inService(x) && (hasT(x, 'veteran') || hasT(x, 'afghan') || hasT(x, 'leader'))).sort((a, b) => (b.relations[o.id] || 0) - (a.relations[o.id] || 0))[0];
        if (!mentor) return 'Наставника не нашлось: опытных в отделении — раз-два и обчёлся.';
        o.flags.mentorId = mentor.id; addRel(o, mentor, 15); addRel(mentor, o, 10); applyEff(game, o, { morale: 3 });
        return F(game, '%s.dn% теперь ходит хвостом за %o.dn_i%. Наставник ворчит, но учит.', o, mentor);
      }
      applyEff(game, o, { morale: 3, loyalty: lg(o, 5) }); return T('«Все через это прошли». %s.dn% краснеет до ушей и клянётся, что больше никогда.');
    case 'complaint_citizen':
      if (c === 'protect') { campaign.addAuthority(game, -3, 'укрыл сотрудника от прокуратуры'); applyEff(game, o, { loyalty: lg(o, 10) }); o.flags.protected = (o.flags.protected || 0) + 1; reveal(game, o, 'sadist'); everyone(game, (x) => { if (hasT(x, 'kind') || hasT(x, 'idealist')) applyEff(game, x, { morale: -3, loyalty: -2 }); }); return T('В прокуратуру ушла бумага: «Телесные повреждения получены при падении». Прокурор не поверил, но дело замяли. %s.dn% теперь вам обязан{|а}.'); }
      if (c === 'punish') { campaign.addAuthority(game, 1, 'наказал сотрудника'); reveal(game, o, 'sadist'); return reprimand(game, o.id, 'written').text; }
      campaign.addAuthority(game, 3, 'передал материалы в прокуратуру'); reveal(game, o, 'sadist'); fire(game, o.id, { silent: true });
      everyone(game, (x) => { if (hasT(x, 'honest') || hasT(x, 'idealist') || hasT(x, 'kind')) applyEff(game, x, { loyalty: lg(x, 4) }); else applyEff(game, x, { morale: -4, loyalty: -3 }); });
      return T('Материалы — в прокуратуре. %s.dn% уволен{|а}, дело возбуждено. Половина отделения считает, что вы сдали своего. Другая половина молчит.');
    case 'mole_activity': {
      const mole = byId(game, item.data.moleId);
      if (c === 'suspects') { const names = item.data.onShift.map((id) => byId(game, id)).filter(Boolean).map((x) => displayName(x)); if (mole) mole.hidden.exposure += 6; return `В ту ночь на смене были: ${names.join(', ')}.`; }
      if (c === 'audit') { if (mole) mole.hidden.exposure += 10; const fl = ownedFlags(game); return fl.armoryAlarm ? 'Ревизия: журналы сходятся, сигнализация срабатывала дважды — оба раза «случайно». Кто-то нервничает.' : 'Ревизия: журналы ведутся кое-как, ключ от оружейки висит на гвоздике в дежурке. Сейфы и сигнализация решили бы половину вопросов.'; }
      return 'Списали на совпадение. Совпадений становится многовато.';
    }
    case 'funeral':
      if (c === 'pay') { if (!economy.canAfford(game, 1500)) { everyone(game, (x) => applyEff(game, x, { morale: -2 })); return 'В кассе нет полутора миллионов. Скинулись всем отделением — по сто тысяч с человека. Хоронили всем отделением.'; } economy.addMoney(game, -1500, 'похороны сотрудника'); everyone(game, (x) => applyEff(game, x, { morale: 5, loyalty: lg(x, 4) })); return T('Хоронили с оркестром из ДК железнодорожников и залпом над могилой. На поминках дежурный плакал — впервые за двадцать лет.'); }
      if (c === 'visit') { everyone(game, (x) => applyEff(game, x, { loyalty: lg(x, 3) })); return T('Вы сидели на кухне у семьи %s.last_g% до ночи. Говорили мало. Наутро это знало всё отделение.'); }
      everyone(game, (x) => applyEff(game, x, { morale: -3, loyalty: -2 })); return 'Похороны — по линии управления: автобус с опозданием на час и венок «от коллектива». Ребята запомнили.';
    case 'binge_return':
      if (c === 'fire') { fire(game, o.id, { article: true }); return T('Уволен{|а} по статье за прогулы. Удостоверение %s.last% положил{|а} на стол молча.'); }
      if (c === 'treatment') return talk(game, o.id, 'treatment', { force: true }).text;
      if (c === 'written') return reprimand(game, o.id, 'written').text;
      applyEff(game, o, { loyalty: lg(o, 6), morale: 4 }); o.hidden.drinkLevel = Math.max(0, o.hidden.drinkLevel - 5); return T('«Последний раз». %s.dn% кивает так, будто верит в это сильнее вас.');
    case 'sleeping':
      if (c === 'verbal') return reprimand(game, o.id, 'verbal').text;
      if (c === 'let_sleep') { o.restUntil = nowAbs(game) + 120; return T('%s.dn% отправлен{|а} спать на два часа.'); }
      return 'Не видели. Дежурный тоже не видел. Никто ничего не видел.';
    case 'investigation': return resolveInvestigation(game, item, c);
    default: return 'Принято к сведению.';
  }
}

// ======================= действия командира =======================
export function displayName(o, c = 'n') {
  if (!o) return '';
  return `${rankCase(shortRank(o.rank), c)} ${declSurname(o.lastName, o.gender, c)}`;
}
function quit(game, o) {
  o.status = 'fired'; o.onShift = false; o.flags.quit = day(game);
  returnGear(game, o);
  for (const x of others(game, o)) if ((x.relations[o.id] || 0) > 40) applyEff(game, x, { morale: -4 });
  hist(game, o, 'Уволен по собственному желанию.'.replace('Уволен', fmt('Уволен{|а}', { s: o })));
  glog(game, F(game, '%s.dn% {уволился|уволилась} по собственному желанию.', o), 'staff');
  emit(game, 'staff:changed', { officerId: o.id, status: 'fired' });
}
function returnGear(game, o) { if (game.state.economy) economy.returnAll(game, o.id); }

export function reward(game, id, kind = 'thanks') {
  const o = byId(game, id); if (!o || !inService(o)) return fail('Некого поощрять.');
  const d = day(game);
  let text, eff;
  if (kind === 'bonus') {
    const cost = 250;
    if (!economy.canAfford(game, cost)) return fail(`В кассе нет ${money(cost)} на премию.`);
    economy.addMoney(game, -cost, 'премия ' + displayName(o, 'd'));
    eff = { morale: hasT(o, 'greedy') ? 18 : 12, loyalty: lg(o, 6), stress: -5 };
    o.promises = o.promises.filter((p) => p.kind !== 'bonus');
    text = F(game, 'Премия %sum% — %s.dn_d%. %react%', o, null, { sum: money(cost), react: F(game, R(game).pick(['Деньги исчезли во внутреннем кармане быстрее, чем вы закончили фразу.', '«Спасибо, товарищ %p.rank%. Детям — на зиму».', '«Служу Отечеству!» — без иронии. Почти.']), o) });
    const recent = o.record.misconduct.filter((m) => d - m.day <= 5).length;
    if (recent) everyone(game, (x) => { if (x !== o && (hasT(x, 'honest') || hasT(x, 'pedant'))) applyEff(game, x, { morale: -2, loyalty: -1 }); });
  } else if (kind === 'dayoff') {
    o.dayOffDay = d + 1;
    eff = { morale: 8, loyalty: lg(o, 3), stress: -4 };
    text = F(game, '%s.dn% получает отгул на завтра. «Вот это по-человечески».', o);
  } else {
    const n = o.record.rewards.filter((r) => r.kind === 'thanks' && d - r.day <= 14).length;
    let k = 1 / (1 + n);
    if (hasT(o, 'cynic')) k *= 0.5; if (hasT(o, 'ambitious')) k *= 1.5;
    eff = { morale: Math.round(6 * k), loyalty: Math.round(lg(o, 3 * k)) };
    text = n >= 2 ? F(game, 'Очередная благодарность в приказе %s.dn_d%. Бумага терпит; %s.last% — уже не очень впечатлён{|а}.', o) : F(game, 'Объявлена благодарность в приказе: %s.dn_d%. %react%', o, null, { react: hasT(o, 'cynic') ? F(game, '«Благодарность на хлеб не намажешь», — но в личное дело {подшил|подшила} аккуратно.', o) : 'Приятно. Даже в девяносто шестом.' });
  }
  applyEff(game, o, eff);
  o.record.rewards.push({ day: d, kind });
  hist(game, o, { bonus: 'Премия.', thanks: 'Благодарность в приказе.', dayoff: 'Отгул в поощрение.' }[kind] || 'Поощрение.');
  emit(game, 'staff:changed', { officerId: id });
  return { ok: true, text, effects: eff };
}

export function reprimand(game, id, kind = 'verbal') {
  const o = byId(game, id); if (!o || !inService(o)) return fail('Некого наказывать.');
  const d = day(game);
  const fair = o.record.misconduct.some((m) => d - m.day <= 3);
  const hero = o.record.rewards.some((r) => d - r.day <= 2) || o.injuries.length > 0;
  const k = fair ? 1 : hero ? 2.2 : 1.7;
  let eff, text;
  if (kind === 'written') {
    eff = { morale: -Math.round(6 * k), loyalty: Math.round(lg(o, fair ? -3 : -12)) };
    text = fair ? F(game, 'Выговор в личное дело %s.dn_d%. За дело — и %s.last% это знает.', o) : F(game, 'Выговор %s.dn_d% — без явного повода. %s.last% бледнеет: «За что, товарищ %p.rank%?»', o);
    if (fair) { o.hidden.drinkLevel = Math.max(0, o.hidden.drinkLevel - 6); o.hidden.corruption = Math.max(0, o.hidden.corruption - 4); }
  } else if (kind === 'fine') {
    eff = { morale: -Math.round(8 * k) - (hasT(o, 'greedy') ? 4 : 0), loyalty: Math.round(lg(o, fair ? -4 : -14)), corruption: 5 };
    economy.addMoney(game, 100, 'лишение премии');
    text = F(game, '%s.dn% лишен{|а} премии. Сто тысяч остались в кассе отделения; обида — в %s.last_p%.', o);
  } else {
    eff = { morale: -Math.round(2 * k), loyalty: Math.round(lg(o, fair ? -1 : -6)) };
    text = fair ? F(game, 'Устное замечание %s.dn_d%. Выслушал{|а}, кивнул{|а}.', o) : F(game, 'Замечание %s.dn_d% — непонятно за что. %s.last% промолчал{|а}, но запомнил{|а}.', o);
    if (fair) o.hidden.drinkLevel = Math.max(0, o.hidden.drinkLevel - 2);
  }
  applyEff(game, o, eff);
  o.record.reprimands.push({ day: d, kind, fair });
  if (!fair) for (const x of others(game, o)) { const r = x.relations[o.id] || 0; applyEff(game, x, { loyalty: r > 40 ? -4 : -1 }); }
  else for (const x of others(game, o)) if (hasT(x, 'pedant') || hasT(x, 'honest')) applyEff(game, x, { loyalty: 1 });
  hist(game, o, { written: 'Выговор.', fine: 'Лишение премии.', verbal: 'Замечание.' }[kind] + (fair ? '' : ' (без явного повода)'));
  emit(game, 'staff:changed', { officerId: id });
  return { ok: true, text, effects: eff, fair };
}

export function promote(game, id) {
  const o = byId(game, id); if (!o || !inService(o)) return fail('Некого повышать.');
  const d = day(game);
  const r = RANK_BY_ID[o.rankId];
  let [, hi] = ROLE_BY_ID[o.role].ranks;
  if (o.role === 'duty' && !r.officer) hi = 6;
  if (r.level >= hi) return fail(F(game, '%s.dn% — потолок по должности. Для следующего звания нужна другая должность.', o));
  const recent = list(game).filter((x) => x.record.promotions.some((p) => d - p.day <= 30)).length;
  if (recent >= 2) return fail('Управление не подпишет: два представления за месяц у вас уже было. «Вы там что, генералов растите?»');
  const next = RANKS[r.level + 1];
  const deserved = o.xp >= 150 + r.level * 40 || o.stats.daysServed >= 12 || o.stats.kills + o.stats.arrests >= 5;
  if (!deserved) campaign.addAuthority(game, -2, 'незаслуженное представление');
  o.rank = next.name; o.rankId = next.id; o.salary = next.salary + Math.min(15, o.serviceYears) * 8; o.position = positionTitle(o);
  const eff = { morale: hasT(o, 'ambitious') ? 25 : 15, loyalty: lg(o, hasT(o, 'ambitious') ? 15 : 10), stress: -5 };
  applyEff(game, o, eff);
  o.record.promotions.push({ day: d, rank: next.id });
  if (hasT(o, 'rookie') && next.level >= 3) removeTrait(game, o, 'rookie');
  const jealous = [];
  for (const x of others(game, o)) {
    if (hasT(x, 'ambitious') && x.xp >= o.xp - 30) { applyEff(game, x, { morale: -8, loyalty: -4 }); addRel(x, o, -20); jealous.push(displayName(x)); }
    else if ((x.relations[o.id] || 0) > 30) applyEff(game, x, { morale: 2 });
  }
  hist(game, o, `Присвоено звание «${next.name}».`);
  glog(game, F(game, 'Приказом начальника УВД %s.last_d% присвоено звание «%rk%».', o, null, { rk: next.full }), 'staff');
  emit(game, 'staff:changed', { officerId: id });
  let text = F(game, '%s.last_d% присвоено звание %rk%. Обмывать будут сегодня — звёздочку в стакан, по традиции.', o, null, { rk: `«${next.full}»` });
  if (!deserved) text += ' В отделе шепчутся, что «за красивые глаза».';
  if (jealous.length) text += ` Обойдённые недовольны: ${jealous.join(', ')}.`;
  return { ok: true, text, effects: eff };
}

export function changeRole(game, id, role) {
  const o = byId(game, id); if (!o || !inService(o) || !ROLE_BY_ID[role]) return fail('Перевод невозможен.');
  const [lo, hi] = ROLE_BY_ID[role].ranks;
  const lvl = RANK_BY_ID[o.rankId].level;
  if (lvl < lo && !(role === 'duty' && lvl >= 3)) return fail(F(game, 'Для должности «%r%» у %s.last_g% маловато звание.', o, null, { r: ROLE_BY_ID[role].name }));
  if (lvl > hi + 2) return fail('Капитана в постовые — это не перевод, это издевательство.');
  o.role = role; o.roleName = ROLE_BY_ID[role].name; o.schedule = ROLE_BY_ID[role].schedule; o.position = positionTitle(o);
  if (o.schedule === 'rotation' && o.shiftGroup < 0) o.shiftGroup = R(game).int(0, 2);
  if (o.schedule === 'weekdays') o.shiftGroup = -1;
  applyEff(game, o, { morale: -3 });
  hist(game, o, `Переведён на должность: ${o.position}.`.replace('Переведён', fmt('Переведен{|а}', { s: o })));
  return { ok: true, text: F(game, '%s.dn% переведен{|а} на должность: %pos%.', o, null, { pos: o.position }), effects: { morale: -3 } };
}

export function fire(game, id, opts = {}) {
  const o = byId(game, id); if (!o || !inService(o)) return fail('Увольнять некого.');
  if (o.status === 'task') return fail(F(game, '%s.dn% на выезде. Уволить по рации — это даже для девяносто шестого слишком.', o));
  const d = day(game);
  const written = o.record.reprimands.filter((r) => r.kind === 'written' && d - r.day <= 90).length;
  const article = opts.article || written >= 3 || o.record.misconduct.filter((m) => d - m.day <= 7).length >= 2;
  o.status = 'fired'; o.onShift = false; o.flags.firedDay = d; o.flags.firedArticle = article;
  returnGear(game, o);
  const firedRecently = list(game).filter((x) => x.status === 'fired' && x.flags.firedDay && d - x.flags.firedDay <= 30).length;
  if (firedRecently > 2) campaign.addAuthority(game, -2, 'текучка кадров');
  if (o.cand && o.cand.note === 'nephew') campaign.addAuthority(game, -6, 'уволил племянника из администрации');
  for (const x of others(game, o)) {
    const r = x.relations[o.id] || 0;
    if (r > 40) applyEff(game, x, { morale: -6, loyalty: lg(x, -4) });
    else if (r < -30) applyEff(game, x, { morale: 2 });
    else if (!article) applyEff(game, x, { morale: -1 });
  }
  if (o.hidden.mole && !o.flags.exposed) game.state.flags.b2_exMole = { officerId: o.id, gangId: o.hidden.gangId, day: d };
  if (o.flags.grudge || o.hidden.corruption > 60) game.state.flags.b2_grudge = { officerId: o.id, day: d };
  hist(game, o, article ? 'Уволен по статье.' : 'Уволен.');
  if (!opts.silent) glog(game, F(game, '%s.dn% уволен{|а}%a%.', o, null, { a: article ? ' по статье' : '' }), 'staff');
  emit(game, 'staff:changed', { officerId: id, status: 'fired' });
  return { ok: true, text: F(game, article ? '%s.dn% уволен{|а} по статье. Возражать нечего — в личном деле всё записано.' : '%s.dn% уволен{|а}. Сдал{|а} оружие и удостоверение, {ушёл|ушла}, не оглядываясь.', o), effects: {} };
}

export function hire(game, candidateId) {
  const s = game.state;
  const c = (s.candidates || []).find((x) => x.id === candidateId);
  if (!c) return fail('Кандидат уже ушёл — нашёл другое место или передумал.');
  const activeN = list(game).filter((o) => inService(o)).length;
  if (activeN >= MAX_STAFF) return fail(`Штат заполнен: ${MAX_STAFF} единиц по штатному расписанию. Кадры не пропустят.`);
  s.candidates.splice(s.candidates.indexOf(c), 1);
  c.status = 'home'; c.onShift = false; c.flags.hiredDay = day(game);
  if (c.schedule === 'rotation') { const counts = [0, 1, 2].map((g) => list(game).filter((o) => o.shiftGroup === g && inService(o)).length); c.shiftGroup = counts.indexOf(Math.min(...counts)); } else c.shiftGroup = -1;
  if (c.cand && c.cand.authorityBonus) campaign.addAuthority(game, c.cand.authorityBonus, 'взял племянника по звонку');
  for (const o of list(game)) { if (!inService(o)) continue; const v = Math.round(R(game).gauss(0, 12)); c.relations[o.id] = v; o.relations[c.id] = v; }
  s.staff.push(c);
  hist(game, c, 'Принят на службу в отделение.'.replace('Принят', fmt('Принят{|а}', { s: c })));
  glog(game, F(game, 'Принят{|а} на службу: %s.dn%, %pos%. Выходит со следующей смены.', c, null, { pos: c.position }), 'staff');
  emit(game, 'staff:changed', { officerId: c.id, status: 'hired' });
  return { ok: true, text: F(game, '%s.dn% зачислен{|а} в штат. Кадры оформят за день; снаряжение — выдать в оружейке.', c), officer: c, effects: {} };
}

export function sendLeave(game, id, days = 7) {
  const o = byId(game, id); if (!o || !inService(o)) return fail('Некого отправлять в отпуск.');
  if (o.status === 'task') return fail(F(game, '%s.dn% на выезде.', o));
  if (o.status === 'hospital') return fail(F(game, '%s.dn% в больнице — это и так не служба.', o));
  days = clamp(Math.round(days), 1, 30);
  o.status = 'leave'; o.onShift = false; o.leaveUntil = day(game) + days;
  const eff = { morale: Math.min(15, 5 + days), stress: -Math.min(30, days * 4) };
  applyEff(game, o, eff);
  const left = list(game).filter((x) => inService(x) && !['leave', 'hospital', 'missing'].includes(x.status)).length;
  if (left < 9) everyone(game, (x) => x !== o && x.status !== 'leave' && applyEff(game, x, { morale: -2 }));
  hist(game, o, `Отпуск на ${days} дн.`);
  emit(game, 'staff:changed', { officerId: id, status: 'leave' });
  return { ok: true, text: F(game, '%s.dn% в отпуске до %date%.', o, null, { date: calendar(o.leaveUntil, game.state.campaign && game.state.campaign.startDate).text }), effects: eff };
}

export function sendHospital(game, id) {
  const o = byId(game, id); if (!o || !inService(o)) return fail('Некого.');
  o.status = 'hospital'; o.onShift = false; o.flags.needsHospital = false;
  emit(game, 'staff:changed', { officerId: id, status: 'hospital' });
  return { ok: true, text: F(game, '%s.dn% {отправлен|отправлена} в горбольницу №2. Бинты и лекарства — свои, как обычно.', o), effects: {} };
}

export function setShift(game, id, on) {
  const o = byId(game, id); if (!o || !inService(o)) return fail('Нет такого сотрудника.');
  const d = day(game);
  if (on) {
    if (!canWork(o, d)) return fail(F(game, '%s.dn% сейчас не может выйти: %why%.', o, null, { why: o.status === 'leave' ? 'в отпуске' : o.status === 'hospital' ? 'в больнице' : o.cond.sick > 0 ? 'на больничном' : o.suspendedUntil ? 'отстранен' : 'отгул' }));
    if (o.onShift && o.status !== 'home') return { ok: true, text: F(game, '%s.dn% и так на смене.', o), effects: {} };
    o.onShift = true; o.overtime = true;
    if (o.status === 'home') {
      o.arriveAt = nowAbs(game) + R(game).int(35, 90);
      const pen = (hasT(o, 'family_man') ? -5 : -3) - (o.stats.consecutive >= 1 ? 2 : 0);
      applyEff(game, o, { morale: pen, loyalty: lg(o, -1) });
      return { ok: true, text: F(game, 'Дозвонились: %s.dn% будет через %m% минут. Голос — сонный и не очень радостный.', o, null, { m: Math.round((o.arriveAt - nowAbs(game)) / 5) * 5 }), effects: { morale: pen } };
    }
    return { ok: true, text: F(game, '%s.dn% остаётся на смене.', o), effects: {} };
  }
  if (!o.onShift) return { ok: true, text: F(game, '%s.dn% и так не на смене.', o), effects: {} };
  o.onShift = false; o.arriveAt = null;
  if (o.status === 'station') { o.status = 'home'; return { ok: true, text: F(game, '%s.dn% сдал{|а} оружие и {ушёл|ушла} домой.', o), effects: {} }; }
  if (o.status === 'task') { o.goingHome = -1; return { ok: true, text: F(game, '%s.dn% уйдёт домой, когда вернётся с выезда.', o), effects: {} }; }
  return { ok: true, text: F(game, '%s.dn% снят{|а} со смены.', o), effects: {} };
}
/** Запланировать выход на конкретный день (по умолчанию — завтра) */
export function planShift(game, id, on, d = day(game) + 1) {
  const o = byId(game, id); if (!o) return fail('Нет такого сотрудника.');
  o.planned = { day: d, on: !!on };
  return { ok: true, text: F(game, on ? '%s.dn% выйдет на смену %date%.' : '%s.dn% %date% отдыхает.', o, null, { date: calendar(d, game.state.campaign && game.state.campaign.startDate).text }), effects: {} };
}

export function applyInjury(game, id, severity = 1, cause = 'бой', opts = {}) {
  const o = byId(game, id); if (!o || o.status === 'dead') return fail('Некого.');
  const rng = R(game);
  severity = clamp(Math.round(severity), 1, 3);
  if (opts.taskId && o.injuries.some((i) => i.taskId === opts.taskId)) return { ok: true, text: '', effects: {}, duplicate: true };
  const name = opts.name || injuryName(rng, severity, cause);
  let daysLeft = injuryDays(rng, severity);
  const inj = { name, severity, daysLeft, cause, day: day(game), taskId: opts.taskId || null };
  o.injuries.push(inj);
  o.hp = clamp(o.hp - severity * 22, 5, o.maxHp);
  o.stats.wounds++;
  applyEff(game, o, { stress: 10 * severity * (1 - mod(o, 'stress_resist', { traitsOnly: true })), morale: -3 * severity });
  if (severity >= 2) { if (game.state.attack || o.status === 'task') o.flags.needsHospital = true; else { o.status = 'hospital'; o.onShift = false; } }
  for (const x of others(game, o)) if ((x.relations[o.id] || 0) > 40) applyEff(game, x, { stress: 4 * severity, morale: -2 });
  if (hasT(o, 'lucky') && severity === 1) reveal(game, o, 'lucky');
  hist(game, o, `Ранение: ${name}.`);
  const text = F(game, '%s.dn%: %inj%. %tail%', o, null, { inj: name, tail: severity >= 3 ? 'Состояние тяжёлое.' : severity === 2 ? `В больницу, недели на ${Math.max(1, Math.round(daysLeft / 7))}.` : 'Остаётся в строю.' });
  glog(game, text, 'staff');
  emit(game, 'staff:injured', { officerId: id, severity, name });
  return { ok: true, text, injury: inj, effects: {} };
}

export function kill(game, id, cause = 'погиб при исполнении') {
  const o = byId(game, id); if (!o || o.status === 'dead') return fail('Некого.');
  const wasTask = o.status === 'task' || !!game.state.attack;
  o.status = 'dead'; o.onShift = false; o.hp = 0; o.flags.death = { day: day(game), minute: game.state.time.minute, cause };
  if (game.state.economy) { if (wasTask && R(game).chance(0.4)) { o.equipment.weapon = 'none'; o.equipment.ammo = 0; } economy.returnAll(game, o.id); }
  for (const x of others(game, o)) {
    const r = x.relations[o.id] || 0;
    applyEff(game, x, { morale: r > 40 ? -15 : r < -30 ? -2 : -7, stress: (r > 40 ? 16 : 8) * (1 - mod(x, 'stress_resist', { traitsOnly: true })) });
    if (hasT(x, 'superstitious')) applyEff(game, x, { morale: -3 });
  }
  hist(game, o, 'Погиб при исполнении служебных обязанностей.'.replace('Погиб', fmt('Погиб{|ла}', { s: o })));
  const s = game.state; s.flags = s.flags || {};
  s.flags.b2_losses = (s.flags.b2_losses || 0) + 1;
  glog(game, F(game, '%s.dn% погиб{|ла}: %cause%.', o, null, { cause }), 'death');
  emit(game, 'staff:death', { officerId: id, cause });
  genEvent(game, 'funeral', o);
  return { ok: true, text: F(game, '%s.dn% погиб{|ла}. %cause%.', o, null, { cause: cap(cause) }), effects: {} };
}

export function reveal(game, o, traitId) {
  if (!o || !o.traits.includes(traitId) || o.knownTraits.includes(traitId)) return false;
  o.knownTraits.push(traitId);
  glog(game, F(game, 'Личное дело: %s.dn% — «%t%».', o, null, { t: TRAIT_BY_ID[traitId].name.toLowerCase() }), 'staff');
  return true;
}
function removeTrait(game, o, traitId) {
  o.traits = o.traits.filter((t) => t !== traitId); o.knownTraits = o.knownTraits.filter((t) => t !== traitId);
  if (traitId === 'drinker') { o.hidden.addiction = o.hidden.addiction === 'alcohol' ? null : o.hidden.addiction; o.hidden.drinkLevel = Math.min(o.hidden.drinkLevel, 15); }
}

// ======================= разговоры =======================
function speaksTruth(o, rng, guilt) {
  let p = 0.45 + (o.loyalty - 50) / 120 + mod(o, 'honesty') * 0.6 - guilt;
  if (o.cond.drunk > 0) p += 0.2;
  return rng.chance(clamp(p, 0.05, 0.97));
}
function tellLine(game, o, lying) {
  let p = lying ? 0.55 : hasT(o, 'nervous') ? 0.25 : 0.06;
  if (hasT(o, 'silent')) p -= 0.15; if (hasT(o, 'talker')) p += 0.1;
  return R(game).chance(clamp(p, 0, 1)) ? F(game, R(game).pick(TK.TELLS), o) : null;
}
function friendsEnemies(game, o) {
  const xs = others(game, o).map((x) => ({ x, r: o.relations[x.id] || 0 })).sort((a, b) => b.r - a.r);
  return { friend: xs[0] && xs[0].r > 35 ? xs[0].x : null, enemy: xs.length && xs[xs.length - 1].r < -30 ? xs[xs.length - 1].x : null };
}
function owedText(game) {
  const e = game.state.economy; const n = e && e.salary ? e.salary.owedMonths : 0;
  return n <= 0 ? null : n === 1 ? 'задерживают уже месяц' : `не платят ${n} месяца`;
}
function gangLine(game) {
  const gs = (game.state.city && game.state.city.gangs || []).filter((g) => g.status !== 'broken');
  if (!gs.length) return null;
  const g = gs.slice().sort((a, b) => (b.strength || 0) + (b.anger || 0) - (a.strength || 0) - (a.anger || 0))[0];
  const dist = (g.territory && g.territory[0] && DISTRICT_NAMES[g.territory[0]]) || 'Рынок';
  return { gang: `«${g.name.replace(/[«»]/g, '')}»`, district: dist, gangId: g.id };
}
function missingUpgrades(game) { const u = (game.state.economy && game.state.economy.upgrades) || {}; return Object.keys(TK.ADVICE).filter((k) => UPGRADES[k] && !u[k]); }
function kidVars(o, rng) {
  const school = o.family.children.filter((c) => c.age >= 7 && c.age <= 17);
  const c = school.length ? rng.pick(school) : o.family.children[0];
  if (!c) return {};
  const kid = c.g === 'f' ? 'дочь' : 'сын';
  return { kid, Kid: cap(kid), grade: clamp(c.age - 6, 1, 11), child: c };
}

const TALK = {
  how_are_you(game, o, rng, out) {
    const pool = o.cond.drunk > 0 ? TK.HOW.drunk : o.injuries.length ? TK.HOW.injured : o.fatigue > 75 ? TK.HOW.exhausted : o.stress > 65 ? TK.HOW.stressed
      : o.cond.hangover > 0 ? TK.HOW.hangover : o.morale < 30 ? TK.HOW.low : o.morale > 70 ? TK.HOW.high : TK.HOW.mid;
    const voice = ['silent', 'rookie', 'cynic', 'veteran', 'talker'].find((t) => hasT(o, t));
    const other = rng.pick(others(game, o)) || o;
    const useVoice = voice && pool === TK.HOW.mid && rng.chance(0.7);
    out.say(PF(game, useVoice ? TK.HOW_VOICE[voice] : pool, o, other));
    out.eff.morale = o.loyalty > 40 && !hasT(o, 'cynic') ? 2 : 1;
    if (o.cond.hangover > 0 || o.cond.drunk > 0) reveal(game, o, 'drinker');
    if (o.stress > 60) reveal(game, o, 'nervous');
    if (o.status === 'station' && o.fatigue > 50 && !o.restUntil) out.choice('go_rest');
    out.choice('pep_talk');
    if (o.status === 'station' && (o.fatigue > 75 || o.injuries.length || o.cond.drunk > 0)) out.choice('send_home');
  },
  family(game, o, rng, out) {
    if (hasT(o, 'silent') && o.loyalty < 60) { out.say(PF(game, TK.FAMILY.silent, o)); return; }
    const f = o.family, kv = kidVars(o, rng);
    let pool;
    if (o.flags.familyTrouble) pool = TK.FAMILY.trouble;
    else if (f.children.some((c) => c.g === 'm' && c.age >= 18 && c.age <= 20)) pool = TK.FAMILY.son_army;
    else if (f.status === 'married' && kv.child && kv.child.age >= 7 && kv.child.age <= 17) pool = TK.FAMILY.kids_school;
    else if (f.children.some((c) => c.age < 7) && ['married', 'divorced', 'single'].includes(f.status)) pool = TK.FAMILY.kids_small;
    else if (f.status === 'married') pool = TK.FAMILY.married_nokids;
    else if (f.status === 'divorced' || f.status === 'separated') pool = TK.FAMILY.divorced;
    else if (f.status === 'widowed') pool = TK.FAMILY.widowed;
    else pool = o.age < 35 ? TK.FAMILY.single_young : TK.FAMILY.single_old;
    if (pool === TK.FAMILY.kids_small) { const c = f.children.find((x) => x.age < 7); kv.Kid = c.g === 'f' ? 'Дочка' : 'Сын'; }
    out.say(PF(game, pool, o, null, { ...kv, trouble: o.flags.familyTrouble || '' }));
    out.eff.loyalty = lg(o, hasT(o, 'family_man') ? 3 : 2); out.eff.morale = 1;
    out.choice('offer_dayoff'); out.choice('offer_help');
    if (o.hidden.debt > 0 || owedText(game) || o.flags.familyTrouble) out.choice('lend_money');
  },
  work(game, o, rng, out) {
    if (hasT(o, 'rookie') && rng.chance(0.4)) { out.say(PF(game, TK.WORK.rookie, o)); out.choice('ask_advice'); return; }
    const cands = [];
    const e = game.state.economy;
    if (o.equipment.armor === 'none') cands.push('no_armor');
    if (!o.equipment.radio) cands.push('no_radio');
    if (e && (e.ammo['9x18'] || 0) < 120) cands.push('low_ammo');
    if (e && !e.upgrades.window_bars) cands.push('no_bars');
    if (e && !e.upgrades.steel_door) cands.push('no_door');
    if (e && !e.upgrades.roof_repair) cands.push('roof');
    if (e && e.supply && !e.supply.tea) cands.push('no_tea');
    if (e && e.supply && !e.supply.smokes && o.smoker) cands.push('no_smokes');
    if (owedText(game)) cands.push('salary', 'salary');
    if (o.stats.consecutive >= 2) cands.push('overwork', 'overwork');
    if (e && e.vehicles.some((v) => v.condition < 50)) cands.push('uaz');
    const gl = gangLine(game); if (gl) cands.push('gangs');
    const picks = rng.sample(cands, Math.min(cands.length, hasT(o, 'silent') ? 1 : hasT(o, 'talker') ? 3 : 2));
    const veh = e && e.vehicles.slice().sort((a, b) => a.condition - b.condition)[0];
    if (!picks.length) out.say(PF(game, TK.WORK.good, o));
    for (const k of picks) out.say(PF(game, TK.WORK[k], o, null, { owed: owedText(game) || '', vehicle: veh ? veh.name : 'УАЗ', gang: gl ? gl.gang : '', district: gl ? gl.district : '' }));
    out.eff.loyalty = lg(o, 1);
    out.choice('ask_advice'); out.choice('complaints');
  },
  ask_advice(game, o, rng, out) {
    const miss = missingUpgrades(game);
    const prefs = [];
    if (hasT(o, 'afghan') || hasT(o, 'chechnya') || hasT(o, 'veteran') || hasT(o, 'leader')) prefs.push('sandbags', 'window_bars', 'steel_door', 'panic_button', 'floodlight', 'armory_safe');
    if (hasT(o, 'pedant')) prefs.push('armory_safe', 'cctv');
    if (hasT(o, 'kind') || hasT(o, 'family_man')) prefs.push('tea', 'rest', 'coffee_maker', 'bunks');
    if (hasT(o, 'greedy') || hasT(o, 'cynic') || hasT(o, 'drinker')) prefs.push('pay');
    const e = game.state.economy;
    const needs = [];
    if (list(game).filter((x) => inService(x) && x.equipment.armor === 'none').length > 3) needs.push('armor');
    if (e && (e.ammo['9x18'] || 0) < 150) needs.push('ammo');
    if (list(game).filter((x) => inService(x) && !x.equipment.radio).length > 5) needs.push('radio');
    if (e && e.supply && (!e.supply.tea || !e.supply.smokes)) needs.push('tea');
    if (list(game).filter((x) => inService(x) && x.fatigue > 70).length >= 3) needs.push('rest');
    if (owedText(game)) needs.push('pay');
    const all = [...prefs.filter((k) => miss.includes(k) || needs.includes(k)), ...needs, ...miss];
    const k = all[0];
    if (k) { out.say(TK.ADVICE[k]); out.eff.hint = k; } else out.say(PF(game, TK.ADVICE.generic, o));
    out.eff.loyalty = lg(o, 2);
  },
  complaints(game, o, rng, out) {
    const d = day(game);
    const res = [];
    if (o.record.reprimands.some((r) => !r.fair && d - r.day <= 10)) res.push(['reprimand_unfair', null]);
    const passed = list(game).find((x) => x !== o && x.record.promotions.some((p) => d - p.day <= 14) && x.xp < o.xp);
    if (passed) res.push(['passed_over', passed]);
    if (o.stats.consecutive >= 2 || o.overtime) res.push(['overwork', null]);
    const { enemy } = friendsEnemies(game, o);
    if (enemy && enemy.shiftGroup === o.shiftGroup) res.push(['enemy', enemy]);
    if (owedText(game)) res.push(['salary', null]);
    if (!res.length) res.push(['none', null]);
    const [k, other] = hasT(o, 'silent') ? res[0] : rng.pick(res);
    out.say(PF(game, TK.COMPLAINTS[k], o, other));
    out.eff.loyalty = lg(o, k === 'none' ? 1 : 2); out.eff.stress = -2;
  },
  loyalty(game, o, rng, out) {
    const h = o.hidden;
    const guilty = h.mole || h.corruption > 55;
    if (hasT(o, 'silent') && !guilty) { out.say(PF(game, TK.LOYALTY.silent, o)); out.eff.loyalty = lg(o, 1); out.choice('trust'); return; }
    if (h.mole) {
      const confess = o.loyalty > 70 && h.guilt > 25 && (hasT(o, 'kind') || hasT(o, 'idealist') || hasT(o, 'religious') || hasT(o, 'family_man')) && rng.chance(0.5);
      if (confess) { const r = MOLE_REASONS.find((x) => x.id === h.moleReason) || MOLE_REASONS[0]; out.say(PF(game, TK.LOYALTY.mole_confess, o, null, { reason: r.confess })); exposeMole(game, o, 'confess'); out.eff.found = true; return; }
      out.say(PF(game, TK.LOYALTY.mole_lie, o)); out.lie();
      h.exposure += 2;
    } else if (h.corruption > 55) {
      if (speaksTruth(o, rng, 0.2)) { out.say(PF(game, TK.LOYALTY.corrupt_true, o)); reveal(game, o, 'greedy'); o.flags.admittedBribes = day(game); }
      else { out.say(PF(game, TK.LOYALTY.corrupt_lie, o)); out.lie(); }
    } else {
      const offended = o.loyalty < 40 || (owedText(game) && rng.chance(0.4));
      const pool = offended ? TK.LOYALTY.clean_offended : o.loyalty > 60 ? TK.LOYALTY.clean_loyal : TK.LOYALTY.clean_neutral;
      out.say(PF(game, pool, o));
      out.eff.loyalty = offended ? lg(o, -2) : lg(o, 1);
      if (hasT(o, 'honest') && o.loyalty > 55) reveal(game, o, 'honest');
    }
    out.choice('press'); out.choice('trust'); out.choice('ask_help_mole');
  },
  press(game, o, rng, out) {
    const h = o.hidden;
    if (h.mole) {
      const crack = rng.chance(clamp(0.08 + (-mod(o, 'courage')) * 0.3 + h.guilt / 200 + h.exposure / 300, 0.03, 0.5));
      if (crack) { const r = MOLE_REASONS.find((x) => x.id === h.moleReason) || MOLE_REASONS[0]; out.say(PF(game, TK.LOYALTY.mole_confess, o, null, { reason: r.confess })); exposeMole(game, o, 'confess'); out.eff.found = true; return; }
      out.say(PF(game, hasT(o, 'hothead') ? TK.PRESS.hothead : TK.PRESS.holds, o)); out.lie(); h.exposure += 3; out.eff.loyalty = lg(o, -3); return;
    }
    if (h.corruption > 55 && rng.chance(0.45 - mod(o, 'courage') * 0.3)) { out.say(PF(game, TK.PRESS.confess_corrupt, o)); reveal(game, o, 'greedy'); h.corruption = Math.max(0, h.corruption - 15); out.eff.loyalty = lg(o, -2); return; }
    if (hasT(o, 'hothead')) { out.say(PF(game, TK.PRESS.hothead, o)); out.eff.loyalty = lg(o, -10); out.eff.morale = -4; reveal(game, o, 'hothead'); return; }
    out.say(PF(game, h.corruption > 55 ? TK.PRESS.holds : TK.PRESS.offended, o)); if (h.corruption > 55) out.lie();
    out.eff.loyalty = lg(o, h.corruption > 55 ? -2 : -6); out.eff.morale = -2;
  },
  trust(game, o, rng, out) {
    const h = o.hidden;
    if (h.mole) {
      const soft = hasT(o, 'kind') || hasT(o, 'idealist') || hasT(o, 'religious') || hasT(o, 'family_man');
      out.say(PF(game, soft ? TK.TRUST.mole_guilt : TK.TRUST.mole_cold, o)); if (soft) h.guilt += 15; else h.exposure = Math.max(0, h.exposure - 3);
      out.eff.loyalty = lg(o, soft ? 6 : 2); return;
    }
    out.say(PF(game, TK.TRUST.clean, o)); out.eff.loyalty = lg(o, hasT(o, 'cynic') ? 2 : 5); out.eff.morale = 2;
  },
  ask_help_mole(game, o, rng, out) {
    if (o.hidden.mole) { out.say(PF(game, TK.HELP_MOLE.mole, o)); o.flags.watcher = day(game); out.lie(); return; }
    if ((hasT(o, 'cynic') || o.loyalty < 45) && !hasT(o, 'honest')) { out.say(PF(game, TK.HELP_MOLE.no, o)); out.eff.loyalty = lg(o, -1); return; }
    out.say(PF(game, TK.HELP_MOLE.yes, o)); o.flags.watcher = day(game); out.eff.loyalty = lg(o, 3);
  },
  rumors(game, o, rng, out) {
    const facts = rumorFacts(game, o, rng);
    if (!facts.length || (hasT(o, 'silent') && o.loyalty < 65)) { out.say(PF(game, TK.RUMOR.none, o)); return; }
    const n = hasT(o, 'talker') ? 3 : hasT(o, 'silent') ? 1 : 2;
    const s = game.state; if (!s.staffRumors) s.staffRumors = [];
    for (const fct of rng.sample(facts, Math.min(n, facts.length))) {
      out.say(fct.text);
      s.staffRumors.push({ day: day(game), fromId: o.id, aboutId: fct.aboutId || null, kind: fct.kind, text: fct.text });
    }
    if (s.staffRumors.length > 40) s.staffRumors.splice(0, s.staffRumors.length - 40);
  },
  drinking(game, o, rng, out) {
    const caught = o.record.misconduct.some((m) => m.kind === 'drunk' && day(game) - m.day <= 7) || o.cond.drunk > 0 || o.cond.hangover > 0;
    if (hasT(o, 'drinker')) {
      if (caught) { out.say(PF(game, TK.DRINK.drinker_caught, o)); reveal(game, o, 'drinker'); }
      else if (speaksTruth(o, rng, 0.15)) { out.say(PF(game, TK.DRINK.drinker_true, o)); reveal(game, o, 'drinker'); }
      else { out.say(PF(game, TK.DRINK.drinker_lie, o)); out.lie(); }
      out.choice('ultimatum'); out.choice('treatment');
    } else if (hasT(o, 'silent')) out.say(PF(game, TK.DRINK.silent, o));
    else {
      const drinkers = others(game, o).filter((x) => hasT(x, 'drinker'));
      const tell = drinkers.length && (o.loyalty > 55 || hasT(o, 'talker') || hasT(o, 'pedant')) && !hasT(o, 'kind');
      if (tell) { const x = rng.pick(drinkers); out.say(PF(game, TK.DRINK.sober_names, o, x)); out.eff.about = x.id; }
      else out.say(PF(game, TK.DRINK.sober_none, o));
    }
    out.choice('drink_together');
  },
  ultimatum(game, o, rng, out) {
    if (!hasT(o, 'drinker')) { out.say('Есть, товарищ майор. (Недоумённо пожимает плечами — пить {он|она} и не пил{|а}.)'.replace('майор', player(game).rank)); out.eff.loyalty = lg(o, -3); return; }
    if (hasT(o, 'hothead') && rng.chance(0.4)) { out.say(PF(game, TK.ULTIMATUM.angry, o)); out.eff.loyalty = lg(o, -6); out.eff.morale = -5; return; }
    const p = 0.25 + (o.skills.discipline - 50) / 150 + (o.loyalty - 50) / 150;
    if (rng.chance(clamp(p, 0.05, 0.8))) { out.say(PF(game, TK.ULTIMATUM.works, o)); o.hidden.drinkLevel = Math.max(0, o.hidden.drinkLevel - 22); out.eff.morale = -3; out.eff.loyalty = lg(o, 2); }
    else { out.say(PF(game, TK.ULTIMATUM.fails, o)); out.eff.morale = -5; out.eff.loyalty = lg(o, -3); o.hidden.drinkLevel = Math.max(0, o.hidden.drinkLevel - 5); }
  },
  treatment(game, o, rng, out, opts) {
    if (!hasT(o, 'drinker') && !opts.force) { out.say('Мне-то зачем, товарищ %p.rank%?'); return; }
    if (!opts.force && o.loyalty < 40 && rng.chance(0.5)) { out.say(PF(game, TK.TREATMENT.refuse, o)); out.eff.loyalty = lg(o, -4); return; }
    out.say(PF(game, TK.TREATMENT.ok, o));
    sendLeave(game, o.id, 10); o.flags.treatment = true;
    economy.addMoney(game, -150, 'лечение сотрудника в наркодиспансере');
    out.eff.loyalty = lg(o, 6);
  },
  drink_together(game, o, rng, out) {
    out.say(PF(game, hasT(o, 'drinker') || o.hidden.drinkLevel > 25 ? TK.DRINK_TOGETHER.ok : TK.DRINK_TOGETHER.sober, o));
    out.eff.loyalty = lg(o, 9); out.eff.morale = 6; out.eff.stress = -10; out.eff.minutes = 90;
    const s = game.state; s.flags = s.flags || {}; s.flags.b2_drankWithStaff = (s.flags.b2_drankWithStaff || 0) + 1;
    if (hasT(o, 'talker')) everyone(game, (x) => x !== o && hasT(x, 'pedant') && applyEff(game, x, { loyalty: -2 }));
    if (hasT(o, 'drinker')) o.hidden.drinkLevel = clamp(o.hidden.drinkLevel + 4, 0, 100);
  },
  money(game, o, rng, out) {
    const owed = owedText(game);
    let pool = o.hidden.debt > 0 ? TK.MONEY.debt : hasT(o, 'greedy') ? TK.MONEY.greedy : owed ? TK.MONEY.owed : (o.family.kids ? TK.MONEY.family : TK.MONEY.ok);
    if (pool === TK.MONEY.debt && !speaksTruth(o, rng, 0.1)) { pool = TK.MONEY.ok; out.lie(); }
    out.say(PF(game, pool, o, null, { owed: owed || '', spousejob: o.family.spouseJob ? (o.gender === 'm' ? 'работает — ' : 'работает — ') + o.family.spouseJob : 'тоже работает' }));
    if (pool === TK.MONEY.debt) reveal(game, o, 'gambler');
    out.choice('lend_money'); out.choice('promise_bonus');
  },
  lend_money(game, o, rng, out) {
    if (hasT(o, 'honest') && hasT(o, 'stubborn') || (o.hidden.debt === 0 && !owedText(game) && rng.chance(0.4) && !hasT(o, 'greedy'))) { out.say(PF(game, TK.LEND.proud, o)); out.eff.loyalty = lg(o, 3); return; }
    if (!economy.canAfford(game, 300)) { out.say(PF(game, TK.LEND.nomoney, o)); out.eff.loyalty = lg(o, 2); return; }
    economy.addMoney(game, -300, 'займ сотруднику'); o.debtToStation += 300;
    if (o.hidden.debt > 0) o.hidden.debt = Math.max(0, o.hidden.debt - 300);
    out.say(PF(game, hasT(o, 'greedy') ? TK.LEND.greedy : TK.LEND.ok, o));
    out.eff.loyalty = lg(o, 6); out.eff.morale = 4; out.eff.corruption = -6; out.eff.money = 0;
  },
  promise_bonus(game, o, rng, out) {
    o.promises.push({ kind: 'bonus', day: day(game), due: day(game) + 7 });
    out.say(PF(game, hasT(o, 'cynic') ? TK.PROMISE.cynic : TK.PROMISE.ok, o)); out.eff.morale = hasT(o, 'cynic') ? 1 : 4;
  },
  offer_dayoff(game, o, rng, out) { const r = reward(game, o.id, 'dayoff'); out.say('Спасибо, товарищ %p.rank%. Правда.'); out.note(r.text); },
  offer_help(game, o, rng, out) {
    out.say(PF(game, hasT(o, 'cynic') ? TK.FAMILY_HELP.cynic : TK.FAMILY_HELP.ok, o)); out.eff.loyalty = lg(o, 3);
    o.promises.push({ kind: 'help', day: day(game), due: null });
  },
  go_rest(game, o, rng, out) {
    if (o.status !== 'station') { out.say('Я не в отделении, товарищ %p.rank%.'); return; }
    const isDuty = o.role === 'duty' || o.flags.actingDuty === day(game);
    const dutyLeft = list(game).filter((x) => x !== o && present(x) && x.onShift && (x.role === 'duty' || x.flags.actingDuty === day(game))).length;
    if (isDuty && !dutyLeft) { out.say(PF(game, TK.REST.refuse, o)); out.eff.loyalty = lg(o, 1); return; }
    o.restUntil = nowAbs(game) + 120;
    out.say(PF(game, ownedFlags(game).bunks ? TK.REST.bunks : TK.REST.ok, o)); out.eff.loyalty = lg(o, 2);
  },
  pep_talk(game, o, rng, out) {
    const pool = hasT(o, 'cynic') ? TK.PEP.cynic : hasT(o, 'idealist') ? TK.PEP.idealist : o.loyalty < 35 ? TK.PEP.lowloyal : TK.PEP.ok;
    out.say(PF(game, pool, o));
    out.eff.morale = pool === TK.PEP.idealist ? 6 : pool === TK.PEP.ok ? 3 : pool === TK.PEP.cynic ? 0 : -1;
    if (pool === TK.PEP.ok) out.eff.stress = -3;
  },
  send_home(game, o, rng, out) { out.say(PF(game, o.injuries.length ? TK.SEND_HOME.hurt : TK.SEND_HOME.ok, o)); out.note(setShift(game, o.id, false).text); },
  past(game, o, rng, out) {
    const war = hasT(o, 'afghan') || hasT(o, 'chechnya');
    out.say(o.bio);
    if (war) out.choice('ask_war');
    out.eff.loyalty = lg(o, 1);
  },
  ask_war(game, o, rng, out) {
    const war = hasT(o, 'afghan') ? 'afghan' : hasT(o, 'chechnya') ? 'chechnya' : null;
    if (!war) { out.say('Я не воевал{|а}, товарищ %p.rank%. Бог миловал.'); return; }
    if (o.loyalty >= 55 && o.stress < 75) { out.say(PF(game, war === 'afghan' ? TK.PAST.war_open_afghan : TK.PAST.war_open_chechnya, o)); out.eff.stress = -10; out.eff.loyalty = lg(o, 4); }
    else { out.say(PF(game, TK.PAST.war_closed, o)); out.eff.loyalty = lg(o, -1); }
  },
  colleagues(game, o, rng, out) {
    const { friend, enemy } = friendsEnemies(game, o);
    if (!friend && !enemy) { out.say(PF(game, TK.COLLEAGUES.neutral, o)); return; }
    if (friend) out.say(PF(game, TK.COLLEAGUES.friend, o, friend, { why: o.relNotes[friend.id] || '' }).trim());
    if (enemy && (!hasT(o, 'silent') || o.loyalty > 60)) { out.say(PF(game, TK.COLLEAGUES.enemy, o, enemy, { why: o.relNotes[enemy.id] || '' }).trim()); out.choice('reconcile'); o.flags.reconcileWith = enemy.id; }
  },
  reconcile(game, o, rng, out) {
    const x = byId(game, o.flags.reconcileWith) || friendsEnemies(game, o).enemy;
    if (!x) { out.say('Да мы и не ссорились, товарищ %p.rank%.'); return; }
    const p = 0.3 + o.loyalty / 200 + (hasT(o, 'kind') ? 0.2 : 0) - (hasT(o, 'stubborn') || hasT(o, 'hothead') ? 0.2 : 0) - ((o.relations[x.id] || 0) < -60 ? 0.2 : 0);
    if (rng.chance(clamp(p, 0.05, 0.9))) { out.say(PF(game, TK.RECONCILE.works, o, x)); addRel(o, x, 20); addRel(x, o, 15); out.eff.loyalty = lg(o, 1); }
    else { out.say(PF(game, TK.RECONCILE.fails, o, x)); out.eff.loyalty = lg(o, -2); }
  },
};

function rumorFacts(game, sp, rng) {
  const res = [];
  const know = (base) => rng.chance(clamp(base + sp.skills.perception / 250 + (hasT(sp, 'talker') ? 0.25 : 0) + (hasT(sp, 'local') ? 0.1 : 0), 0, 0.95));
  const os = others(game, sp);
  for (const x of os) {
    if (hasT(x, 'drinker') && know(0.3)) res.push({ kind: 'drinker', aboutId: x.id, text: PF(game, TK.RUMOR.drinker, sp, x) });
    if (x.hidden.corruption > 55 && know(0.25)) res.push({ kind: 'corrupt', aboutId: x.id, text: PF(game, TK.RUMOR.corrupt, sp, x) });
    if (x.hidden.mole && x.hidden.tells.length && (hasT(sp, 'sharp') || sp.skills.perception > 60 || sp.flags.watcher) && know(0.2 + x.hidden.exposure / 200)) {
      const named = sp.loyalty > 60 && rng.chance(0.4);
      const tmpl = named ? TK.RUMOR.mole_tell[1] : TK.RUMOR.mole_tell[0];
      res.push({ kind: 'mole_tell', aboutId: named ? x.id : null, text: F(game, tmpl, sp, x, { tell: rng.pick(x.hidden.tells) }) });
    }
  }
  for (const a of os) for (const b of os) if (a.id < b.id && (a.relations[b.id] || 0) < -40 && know(0.3)) {
    res.push({ kind: 'conflict', aboutId: a.id, text: fmt(rng.pick(TK.RUMOR.conflict), { s: sp, o: a, x: b, p: player(game) }) });
  }
  const gl = gangLine(game);
  if (gl && know(0.4)) res.push({ kind: 'gang', text: PF(game, TK.RUMOR.gang, sp, null, { gang: gl.gang }) });
  const auth = game.state.campaign ? game.state.campaign.authority : 50;
  if (auth < 35 && know(0.4)) res.push({ kind: 'boss', text: PF(game, TK.RUMOR.boss_low, sp) });
  const avgL = os.length ? os.reduce((a, x) => a + x.loyalty, 0) / os.length : 50;
  if (avgL > 62 && know(0.4)) res.push({ kind: 'boss', text: PF(game, TK.RUMOR.boss_good, sp) });
  const avgM = os.length ? os.reduce((a, x) => a + x.morale, 0) / os.length : 50;
  if (avgM < 35 && know(0.5)) res.push({ kind: 'morale', text: PF(game, TK.RUMOR.morale_low, sp) });
  // ложные слухи: болтун привирает, «крот» переводит стрелки
  const clean = os.filter((x) => !x.hidden.mole && x.hidden.corruption < 45);
  if (clean.length && ((hasT(sp, 'talker') && rng.chance(0.3)) || (sp.hidden.mole && rng.chance(0.7)))) {
    const x = rng.pick(clean);
    res.push({ kind: 'false', aboutId: x.id, text: PF(game, TK.RUMOR.false, sp, x) });
  }
  return res;
}

/** Разговор. topic — базовые темы контракта + продолжения из result.choices. */
export function talk(game, id, topic, opts = {}) {
  const o = byId(game, id);
  if (!o) return { ok: false, topic, lines: [], text: 'Нет такого сотрудника.', effects: {}, choices: [] };
  const rng = R(game);
  const P = player(game);
  if (!TALK[topic]) return { ok: false, topic, lines: [], text: 'Об этом не говорят.', effects: {}, choices: [] };
  const allowedAway = o.status === 'hospital' && ['how_are_you', 'family', 'past', 'colleagues'].includes(topic);
  if (o.status !== 'station' && !allowedAway && !opts.force) {
    const t = F(game, TK.UNAVAILABLE[o.status] || TK.UNAVAILABLE.home, o);
    return { ok: false, topic, lines: [{ who: 'note', text: t }], text: t, effects: {}, choices: [] };
  }
  const d = day(game);
  const lines = [];
  const eff = { morale: 0, loyalty: 0, stress: 0, minutes: allowedAway ? 120 : 6 };
  const choices = [];
  const opener = TK.PLAYER_OPEN[topic] ? PF(game, TK.PLAYER_OPEN[topic], o) : F(game, TK.TOPICS[topic].label, o);
  lines.push({ who: 'player', text: opener });
  if (o.talkLog[topic] === d && !opts.force) {
    lines.push({ who: 'officer', text: PF(game, TK.REPEAT, o) });
    o.morale = clamp(o.morale - 1, 0, 100);
    return finishTalk(game, o, topic, lines, { morale: -1, minutes: 1 }, []);
  }
  o.talkLog[topic] = d;
  let lied = false;
  const out = {
    eff,
    say: (t) => lines.push({ who: 'officer', text: F(game, t, o) }),
    note: (t) => t && lines.push({ who: 'note', text: t }),
    lie: () => { lied = true; },
    choice: (tp) => { if (TK.TOPICS[tp] && o.talkLog[tp] !== d) choices.push({ topic: tp, label: F(game, TK.TOPICS[tp].label, o) }); },
  };
  TALK[topic](game, o, rng, out, opts);
  const t = tellLine(game, o, lied);
  if (t) lines.push({ who: 'note', text: t });
  const applied = {};
  for (const k of ['morale', 'loyalty', 'stress', 'corruption']) if (eff[k]) applied[k] = Math.round(eff[k] * 10) / 10;
  applyEff(game, o, applied);
  if (opts.force === undefined) void P;
  return finishTalk(game, o, topic, lines, { ...eff, ...applied }, choices);
}
function finishTalk(game, o, topic, lines, effects, choices) {
  const name = o.lastName;
  const text = lines.map((l) => (l.who === 'player' ? `— ${l.text}` : l.who === 'note' ? l.text : `${name}: — ${l.text}`)).join('\n');
  delete effects.corruption;
  return { ok: true, topic, lines, text, effects, choices };
}
export function talkTopics(game, id) {
  const o = byId(game, id); if (!o) return [];
  return Object.entries(TK.TOPICS).filter(([, v]) => v.base).map(([k, v]) => ({ topic: k, label: F(game, v.label, o), done: o.talkLog[k] === day(game) }));
}

// ======================= проверки на «крота» =======================
const INV_METHODS = {
  quick:        { name: 'Пробить по своим каналам', days: 0, cost: 0,   acc: 0.55, fp: 0.15 },
  surveillance: { name: 'Наружное наблюдение',      days: 3, cost: 400, acc: 0.82, fp: 0.06 },
  bait:         { name: '«Канарейка» — подбросить дезу', days: 2, cost: 0, acc: 0.9, fp: 0.03 },
};
export function investigate(game, id, method = 'surveillance', byOfficerId = null) {
  const o = byId(game, id); if (!o || !inService(o)) return { ok: false, text: 'Проверять некого.', found: false };
  const m = INV_METHODS[method] || INV_METHODS.surveillance;
  const s = game.state; if (!s.investigations) s.investigations = [];
  if (s.investigations.some((x) => x.officerId === id && !x.done)) return { ok: false, text: F(game, 'Проверка %s.last_g% уже идёт.', o), found: false };
  let cost = m.cost;
  let by = byOfficerId ? byId(game, byOfficerId) : list(game).filter((x) => x !== o && x.role === 'oper' && inService(x) && x.status !== 'missing').sort((a, b) => b.skills.investigation - a.skills.investigation)[0];
  if (method === 'surveillance' && !by) cost += 300; // нанять частника из бывших
  if (!economy.canAfford(game, cost)) return { ok: false, text: `На проверку нужно ${money(cost)} — в кассе столько нет.`, found: false };
  if (cost) economy.addMoney(game, -cost, 'оперативные расходы');
  const skill = by ? by.skills.investigation / 100 + mod(by, 'investigation') : 0.4;
  const inv = { id: uid('inv'), officerId: id, method, byId: by ? by.id : null, startDay: day(game), readyDay: day(game) + m.days, skill, done: false };
  if (m.days === 0) { const r = computeInvestigation(game, inv); return { ok: true, ...r }; }
  s.investigations.push(inv);
  if (method === 'bait') o.flags.baited = day(game);
  return { ok: true, pending: true, found: false, text: F(game, '%m%: проверка %s.dn_g% начата%by%. Результат — через %d% дн.%c%', o, by, { m: m.name, by: by ? F(game, ', ведёт %s.dn%', by) : '', d: m.days, c: cost ? ` Расходы: ${money(cost)}.` : '' }) };
}
function computeInvestigation(game, inv) {
  const rng = R(game);
  const o = byId(game, inv.officerId);
  const m = INV_METHODS[inv.method];
  inv.done = true;
  if (!o) return { text: 'Проверять уже некого.', found: false };
  const h = o.hidden;
  let acc = clamp(m.acc + (inv.skill - 0.5) * 0.3 + h.exposure / 250 - mod(o, 'secrecy', { traitsOnly: true }) * 0.25, 0.2, 0.97);
  if (inv.method === 'bait' && !h.gangId) acc *= 0.5;
  const fp = clamp(m.fp + (h.corruption > 55 ? 0.1 : 0), 0, 0.4);
  let verdict;
  if (h.mole) verdict = rng.chance(acc) ? 'mole' : (h.corruption > 55 && rng.chance(0.6) ? 'corrupt' : 'clean');
  else if (h.corruption > 55) verdict = rng.chance(acc) ? 'corrupt' : rng.chance(fp) ? 'mole' : 'clean';
  else verdict = rng.chance(fp) ? (rng.chance(0.5) ? 'mole' : 'corrupt') : 'clean';
  o.flags.checked = { day: day(game), method: inv.method, verdict };
  const by = inv.byId ? byId(game, inv.byId) : null;
  if (inv.method === 'bait' && !h.mole && rng.chance(0.15)) { applyEff(game, o, { loyalty: -15, morale: -8 }); o.flags.knowsChecked = true; }
  if (inv.method === 'surveillance' && rng.chance(h.mole ? 0.25 : 0.1) && !hasT(o, 'rookie')) o.flags.knowsChecked = true;
  const T = (s) => F(game, s, o, by);
  let text;
  if (verdict === 'mole') {
    const tell = h.tells.length ? rng.pick(h.tells) : 'встречается с людьми, с которыми милиционеру встречаться незачем';
    text = T(`Итог проверки: %s.dn% связан{|а} с бандой. ${inv.method === 'bait' ? 'Деза, которую {ему|ей} подбросили, через сутки «всплыла» у бандитов.' : `Установлено: ${tell}; дважды встречал{ся|ась} с неустановленными лицами у гаражей.`}`);
    if (h.mole) h.exposure += 30;
  } else if (verdict === 'corrupt') {
    text = T('Итог проверки: %s.dn% берёт — с ларёчников и коммерсантов, по мелочи. Связи с бандами не выявлено.');
    if (h.corruption > 55) reveal(game, o, 'greedy');
  } else {
    text = T('Итог проверки: за %s.dn_i% ничего не замечено. Живёт по средствам, лишнего не говорит.');
    if (hasT(o, 'honest')) reveal(game, o, 'honest');
  }
  if (o.flags.knowsChecked) text += F(game, ' Похоже, %s.last% догадал{ся|ась}, что за {ним|ней} следили.', o);
  const choices = verdict === 'mole' ? [ch('arrest', 'Задержать и оформить'), ch('turn', 'Перевербовать: гнать бандитам дезу'), ch('fire', 'Уволить без шума'), ch('watch', 'Пока наблюдать')]
    : verdict === 'corrupt' ? [ch('reprimand', 'Строгий выговор'), ch('fire', 'Уволить'), ch('ignore', 'Взяли на заметку')] : [ch('ok', 'Принято')];
  pushInbox(game, { source: 'staff', kind: 'investigation', officerId: o.id, data: { verdict, invId: inv.id }, title: F(game, 'Результат проверки: %s.dn%', o), text, choices, expires: expireIn(game, 48), autoChoice: choices[choices.length - 1].id });
  emit(game, 'staff:investigation', { officerId: o.id, verdict });
  return { text, found: verdict === 'mole', verdict };
}
function resolveInvestigation(game, item, c) {
  const o = byId(game, item.officerId);
  if (!o) return 'Поздно — человека уже нет.';
  const v = item.data.verdict;
  if (v === 'mole') {
    if (c === 'arrest') {
      const det = detainees.add(game, { person: { gender: o.gender, firstName: o.firstName, lastName: o.lastName, patronymic: o.patronymic }, age: o.age, charge: 'пособничество организованной преступной группе (ст. 17, 77 УК РСФСР)', gangId: o.hidden.gangId, archetype: 'excop', exOfficerId: o.id, danger: 35, cooperation: o.hidden.mole ? 45 : 20 });
      fire(game, o.id, { article: true, silent: true });
      if (o.hidden.mole) { o.flags.exposed = true; campaign.addAuthority(game, 6, 'разоблачил крота'); everyone(game, (x) => applyEff(game, x, { morale: -3, loyalty: lg(x, 4) })); }
      else { campaign.addAuthority(game, -10, 'арестовал невиновного сотрудника'); everyone(game, (x) => applyEff(game, x, { morale: -8, loyalty: -8 })); }
      return det ? F(game, '%s.dn% задержан{|а} прямо в дежурке. Снимали погоны молча. Теперь — камера ИВС.', o) : F(game, '%s.dn% уволен{|а} и задержан{|а}; мест в ИВС нет — увезли в соседний отдел.', o);
    }
    if (c === 'turn') {
      if (!o.hidden.mole) { applyEff(game, o, { loyalty: -20, morale: -10 }); o.flags.knowsChecked = true; return F(game, 'Вы вызвали %s.dn_a% и предложили «работать на два фронта». %s.last% смотрел{|а} непонимающе — {он|она} ни при чём. Теперь {он|она} знает, что вы {его|её} подозревали.', o); }
      const p = 0.5 + o.loyalty / 200 + (o.hidden.moleReason === 'debt' || o.hidden.moleReason === 'blackmail' ? 0.15 : 0);
      if (R(game).chance(p)) {
        o.flags.turned = day(game); o.flags.exposed = true;
        const s = game.state; s.flags.moleTurned = { officerId: o.id, gangId: o.hidden.gangId, day: day(game) };
        emit(game, 'staff:mole_turned', { officerId: o.id, gangId: o.hidden.gangId });
        applyEff(game, o, { loyalty: 15, stress: 20 });
        return F(game, '%s.dn% согласил{ся|ась}. Теперь банда будет получать то, что напишете вы. Рискованно — для обоих.', o);
      }
      o.status = 'missing'; o.onShift = false; o.missingUntil = null; o.flags.fled = day(game);
      return F(game, '%s.dn% выслушал{|а}, кивнул{|а} — и той же ночью исчез{|ла}. Квартира пустая, соседи ничего не видели.', o);
    }
    if (c === 'fire') { const r = fire(game, o.id, { article: false }); if (o.hidden.mole) o.flags.exposed = true; return r.text + ' Банда потеряла глаза в отделении — но не память.'; }
    return F(game, 'Наблюдение за %s.dn_i% продолжается.', o);
  }
  if (v === 'corrupt') {
    if (c === 'reprimand') { o.record.misconduct.push({ day: day(game), kind: 'bribes' }); o.hidden.corruption = Math.max(0, o.hidden.corruption - 20); return reprimand(game, o.id, 'written').text; }
    if (c === 'fire') { o.record.misconduct.push({ day: day(game), kind: 'bribes' }, { day: day(game), kind: 'bribes' }); return fire(game, o.id, { article: true }).text; }
    o.flags.onNotice = day(game); return 'Взяли на заметку. Папка в сейфе стала чуть толще.';
  }
  return 'Проверка закрыта.';
}
function exposeMole(game, o, how) {
  o.flags.exposed = true; o.hidden.exposure = 100;
  pushInbox(game, { source: 'staff', kind: 'investigation', officerId: o.id, data: { verdict: 'mole', how }, title: F(game, 'Признание: %s.dn%', o), text: F(game, '%s.dn% {признался|призналась}: работал{|а} на банду. Что делать?', o),
    choices: [ch('arrest', 'Задержать и оформить'), ch('turn', 'Перевербовать: гнать бандитам дезу'), ch('fire', 'Уволить без шума'), ch('watch', 'Дать время подумать')], expires: expireIn(game, 24), autoChoice: 'fire' });
}
/** Вероятность, что операция против банды утечёт к ней через «крота» (для города). */
export function leakRisk(game, gangId) {
  let r = 0;
  for (const o of list(game)) {
    const h = o.hidden;
    if (!h.mole || o.flags.turned || !inService(o) || o.status === 'missing') continue;
    if (gangId && h.gangId && h.gangId !== gangId) continue;
    r = Math.max(r, 0.35 + (o.onShift ? 0.25 : 0) + (['duty', 'oper'].includes(o.role) ? 0.15 : 0));
  }
  return clamp(r, 0, 0.85);
}
/** Сплочённость группы −1..1 (средние отношения + бонус лидера) */
export function cohesion(game, ids) {
  const os = ids.map((i) => byId(game, i)).filter(Boolean);
  if (os.length < 2) return 0;
  let sum = 0, n = 0;
  for (const a of os) for (const b of os) if (a !== b) { sum += a.relations[b.id] || 0; n++; }
  const lead = Math.max(0, ...os.map((o) => mod(o, 'leadership', { traitsOnly: true })));
  return clamp(sum / n / 100 + lead * 0.3, -1, 1);
}
/** Look для актора участка (ИИ C) */
export function actorLook(game, o) {
  const m = calendar(day(game), game.state.campaign && game.state.campaign.startDate).m;
  const winter = m >= 11 || m <= 3;
  return { uniform: winter ? 'militia_coat' : 'militia', gender: o.gender, skin: o.look.skin, hair: o.look.hair, hat: o.equipment.helmet ? 'helmet' : winter ? 'ushanka' : 'cap', armor: o.equipment.armor !== 'none', weapon: o.equipment.weapon || 'none', build: o.look.build };
}

// ======================= личное дело =======================
function bar(v) { const n = Math.round(v / 10); return '▮'.repeat(n) + '▯'.repeat(10 - n); }
export function describe(o, opts = {}) {
  if (!o) return '';
  const T = (s, vars) => fmt(s, { s: o, vars });
  const L = [];
  const roleSched = o.schedule === 'rotation' ? (o.shiftGroup >= 0 ? `смена ${SHIFT_NAMES[o.shiftGroup]}, сутки через двое` : 'сутки через двое') : 'пятидневка, ненормированный день';
  L.push(`ЛИЧНОЕ ДЕЛО № ${o.personalNo}`);
  L.push('────────────────────────────────────────');
  L.push(`${o.lastName.toUpperCase()} ${o.firstName} ${o.patronymic}`);
  L.push(`Звание: ${RANK_BY_ID[o.rankId] ? RANK_BY_ID[o.rankId].full : o.rank}`);
  L.push(`Должность: ${o.position} (${roleSched})`);
  L.push(T(`{Родился|Родилась}: ${o.birth.d} ${MONTHS_GEN[o.birth.m - 1]} ${o.birth.y} г. (${o.age} ${o.age % 10 === 1 && o.age !== 11 ? 'год' : [2, 3, 4].includes(o.age % 10) && ![12, 13, 14].includes(o.age) ? 'года' : 'лет'})`));
  L.push(`В органах внутренних дел с ${o.serviceSince} г.`);
  L.push(`В отделе зовут: «${o.nick}»`);
  L.push(`Приметы: ${o.look.text}`);
  L.push('');
  L.push('БИОГРАФИЯ');
  L.push(o.bio);
  L.push('');
  L.push('СЛУЖЕБНАЯ ХАРАКТЕРИСТИКА');
  L.push(officialCharacteristic(o));
  L.push('');
  L.push('ЛИЧНЫЕ КАЧЕСТВА (по наблюдениям начальника)');
  const shown = opts.full ? o.traits : o.knownTraits;
  for (const t of shown) L.push(`• ${TRAIT_BY_ID[t].name}${opts.full && !o.knownTraits.includes(t) ? ' [скрыто]' : ''} — ${TRAIT_BY_ID[t].desc}`);
  const hiddenN = o.traits.length - o.knownTraits.length;
  if (!opts.full && hiddenN > 0) L.push(T('• …ещё не всё о {нём|ней} известно.'));
  L.push('');
  L.push('ПОДГОТОВКА');
  for (const [k, n] of Object.entries(SKILL_NAMES)) L.push(`${n.padEnd(17, ' ')}${bar(o.skills[k])} ${o.skills[k]}`);
  L.push('');
  L.push('СОСТОЯНИЕ');
  const st = { station: 'в отделении', task: 'на выезде', home: 'дома', hospital: 'в больнице', dead: 'погиб', fired: 'уволен', missing: 'пропал', leave: 'в отпуске', candidate: 'кандидат' }[o.status] || o.status;
  L.push(T(`Статус: ${st === 'погиб' ? '{погиб|погибла}' : st === 'уволен' ? 'уволен{|а}' : st === 'пропал' ? '{пропал|пропала}' : st}${o.onShift ? ', на смене' : ''}${o.cond.drunk > 0 ? ', пьян{|а}' : o.cond.hangover > 0 ? ', с похмелья' : ''}${o.cond.sick > 0 ? ', на больничном' : ''}`));
  L.push(`Здоровье ${Math.round(o.hp)}/${o.maxHp} · Усталость ${Math.round(o.fatigue)} · Мораль ${Math.round(o.morale)} · Стресс ${Math.round(o.stress)} · Отношение к начальнику ${Math.round(o.loyalty)}`);
  L.push(`Травмы: ${o.injuries.length ? o.injuries.map((i) => `${i.name} (ещё ~${Math.ceil(i.daysLeft)} дн.)`).join('; ') : 'нет'}`);
  const e = o.equipment, eq = [];
  if (e.weapon !== 'none') eq.push(`${ITEMS[e.weapon] ? ITEMS[e.weapon].short : e.weapon} (${e.ammo} патр.)`);
  if (e.sidearm && e.sidearm !== 'none') eq.push(`${ITEMS[e.sidearm].short} (${e.sidearmAmmo} патр.)`);
  if (e.armorId) eq.push(ITEMS[e.armorId].name.toLowerCase().replace('бронежилет', 'бронежилет'));
  if (e.helmetId) eq.push(ITEMS[e.helmetId].short);
  if (e.radioId) eq.push(`рация ${ITEMS[e.radioId].short}`);
  for (const [k, n] of [['baton', 'ПР-73'], ['cuffs', 'наручники'], ['gas', '«Черёмуха»'], ['medkit', 'аптечка'], ['flashlight', 'фонарь']]) if (e[k]) eq.push(n);
  L.push(`Снаряжение: ${eq.length ? eq.join(', ') : 'ничего не выдано'}${e.illegal ? ' (есть незаконное!)' : ''}`);
  L.push('');
  L.push('СЕМЬЯ');
  const fstat = { married: G2(o, 'женат', 'замужем'), divorced: G2(o, 'разведён', 'разведена'), separated: G2(o, 'жена ушла', 'муж ушёл'), widowed: G2(o, 'вдовец', 'вдова'), single: G2(o, 'холост', 'не замужем') }[o.family.status];
  L.push(`${cap(fstat)}; ${kidsText(o.family.children)}.${o.family.spouseJob && o.family.status === 'married' ? ` ${o.gender === 'm' ? 'Жена' : 'Муж'}: ${o.family.spouseJob}.` : ''}`);
  L.push('');
  L.push('ПООЩРЕНИЯ И ВЗЫСКАНИЯ');
  const rw = o.record.rewards.length, rp = o.record.reprimands.filter((r) => r.kind === 'written').length;
  L.push(`Поощрений: ${rw}; выговоров: ${rp}; замечаний: ${o.record.reprimands.filter((r) => r.kind === 'verbal').length}.`);
  L.push('');
  L.push('ОТНОШЕНИЯ');
  if (opts.staff) {
    const rel = opts.staff.filter((x) => x !== o && o.relations[x.id] !== undefined).map((x) => ({ x, r: o.relations[x.id] }));
    const fr = rel.filter((a) => a.r >= 35).sort((a, b) => b.r - a.r).slice(0, 3);
    const en = rel.filter((a) => a.r <= -30).sort((a, b) => a.r - b.r).slice(0, 3);
    L.push(`Ладит: ${fr.length ? fr.map((a) => displayName(a.x) + (o.relNotes[a.x.id] ? ` (${o.relNotes[a.x.id].replace(/\.$/, '').toLowerCase()})` : '')).join('; ') : '—'}`);
    L.push(`Не ладит: ${en.length ? en.map((a) => displayName(a.x) + (o.relNotes[a.x.id] ? ` (${o.relNotes[a.x.id].replace(/\.$/, '').toLowerCase()})` : '')).join('; ') : '—'}`);
  } else L.push('—');
  L.push('');
  L.push(`СЛУЖБА В ОТДЕЛЕНИИ: смен ${o.stats.shifts}, задержаний ${o.stats.arrests}, ранений ${o.stats.wounds}, опыт ${Math.round(o.xp)}`);
  if (o.history.length) { L.push('Отметки:'); for (const h of o.history.slice(-5)) L.push(`  день ${h.day}: ${h.text}`); }
  if (opts.full) {
    const h = o.hidden;
    L.push('');
    L.push(`[СКРЫТО] коррупция ${h.corruption}; крот: ${h.mole ? `да (${(MOLE_REASONS.find((r) => r.id === h.moleReason) || {}).text}; банда ${h.gangId || '—'}; улики: ${h.tells.join('; ')})` : 'нет'}; зависимость: ${h.addiction || 'нет'}${h.debt ? `; долг ${money(h.debt)}` : ''}; тяга к выпивке ${h.drinkLevel}`);
  }
  return L.join('\n');
}
function G2(o, m, f) { return o.gender === 'f' ? f : m; }

// ======================= симуляция =======================
const attached = new WeakSet();
function attach(game) {
  if (!game.bus || attached.has(game.bus)) return;
  attached.add(game.bus);
  game.bus.on('task:depart', (p) => {
    if (!p) return;
    for (const id of p.officerIds || []) { const o = byId(game, id); if (o && inService(o)) { o.status = 'task'; o.taskId = p.taskId; o.restUntil = null; o.stats.tasks++; } }
  });
  game.bus.on('task:return', (p) => {
    if (!p) return;
    for (const id of p.officerIds || []) {
      const o = byId(game, id); if (!o || !inService(o)) continue;
      if ((p.dead || []).includes(id)) { if (o.status !== 'dead') kill(game, id, 'погиб на выезде'); continue; }
      if ((p.wounded || []).includes(id) && !o.injuries.some((i) => i.taskId === p.taskId)) applyInjury(game, id, R(game).chance(0.6) ? 1 : 2, 'выстрел', { taskId: p.taskId });
      o.taskId = null;
      if (o.status === 'task') o.status = o.flags.needsHospital ? 'hospital' : 'station';
      if (o.status === 'hospital') o.onShift = false;
      o.flags.needsHospital = false;
      o.xp += 6 * (1 + mod(o, 'xp_gain', { traitsOnly: true }));
      if (p.detainees && p.detainees.length) { o.stats.arrests += p.detainees.length / Math.max(1, (p.officerIds || []).length); applyEff(game, o, { morale: 2 }); }
      if (o.status === 'station' && (!o.onShift || o.goingHome === -1)) o.goingHome = nowAbs(game) + 30;
    }
  });
  game.bus.on('attack:start', () => {
    everyone(game, (o) => { if (o.status === 'station') { o.stats.attacks++; o.restUntil = null; if (o.cond.drunk > 0) o.cond.drunk = Math.min(o.cond.drunk, 60); } });
  });
  game.bus.on('attack:end', (p) => {
    const res = p && p.result;
    everyone(game, (o) => {
      const was = o.status === 'station';
      if (res === 'repelled') applyEff(game, o, { morale: was ? 8 : 4, loyalty: was ? lg(o, 3) : 0, stress: was ? 18 * (1 - mod(o, 'stress_resist', { traitsOnly: true })) : 4 });
      else applyEff(game, o, { morale: -10, stress: was ? 25 : 8 });
      if (was && hasT(o, 'coward') && R(game).chance(0.6)) reveal(game, o, 'coward');
      if (was) o.xp += 15;
      if (o.flags.needsHospital && o.status === 'station') { o.status = 'hospital'; o.onShift = false; o.flags.needsHospital = false; }
    });
  });
}

function inboxTick(game) {
  const s = game.state; if (!s.inbox) return;
  const t = nowAbs(game);
  for (const it of s.inbox) if (!it.answered && it.expires && absMin(it.expires) <= t) answer(game, it.id, it.autoChoice || (it.choices[it.choices.length - 1] || {}).id, { auto: true });
}

export function answer(game, itemId, choiceId, opts = {}) {
  const s = game.state;
  const it = (s.inbox || []).find((x) => x.id === itemId);
  if (!it) return fail('Бумага потерялась.');
  if (it.answered) return { ok: false, text: it.result || 'Уже решено.' };
  if (it.choices.length && !it.choices.some((c) => c.id === choiceId)) return fail('Такого решения нет.');
  it.answered = choiceId || 'ok';
  let text;
  try {
    if (it.source === 'detainees') text = detainees.resolveInbox(game, it, choiceId);
    else if (it.source === 'economy') text = economy.resolveInbox(game, it, choiceId);
    else if (it.source === 'campaign') text = campaign.resolveInbox(game, it, choiceId);
    else if (it.source === 'dept' && game.sim && game.sim.departments) text = game.sim.departments.answerPaper(game, it, choiceId);
    else if (['deputy', 'cases', 'spec'].includes(it.source) && game.sim && game.sim.departments) text = game.sim.departments.resolveInbox(game, it, choiceId);
    else if (['duty', 'docs'].includes(it.source) && game.sim && game.sim.duty) text = game.sim.duty.resolveInbox(game, it, choiceId);
    else if (it.officerId && !byId(game, it.officerId) && it.kind !== 'mole_activity') text = 'Решать уже не о ком.';
    else text = resolveStaffEvent(game, it, choiceId);
  } catch (e) { text = 'Решение принято.'; if (typeof console !== 'undefined') console.error('[inbox]', it.kind, e); }
  it.result = (opts.by === 'deputy' ? 'Решение зама: ' : opts.auto ? 'Без вашего решения: ' : '') + (text || 'Принято.'); if (opts.by) it.decidedBy = opts.by;
  glog(game, `${it.title}: ${it.result}`, 'inbox');
  emit(game, 'inbox:answered', { item: it });
  return { ok: true, text: it.result };
}

function rollEvents(game) {
  const rng = R(game);
  const s = game.state;
  const d = day(game);
  const st = list(game).filter((o) => inService(o) && o.status !== 'missing');
  let budget = rng.int(1, 3);
  const add = (kind, o, extra) => { if (budget <= 0 || pendingCount(game, kind, o && o.id) || pendingCount(game) >= 6) return; if (genEvent(game, kind, o, extra)) budget--; };
  const cal = calendar(d, s.campaign && s.campaign.startDate);
  for (const o of rng.shuffle(st)) {
    if (o.birth.m === cal.m && o.birth.d === cal.d && o.flags.bdayDay !== d) { o.flags.bdayDay = d; o.age++; add('birthday', o); }
    if (['station', 'home'].includes(o.status)) {
      if (o.morale < 22 && o.loyalty < 45 && rng.chance(0.25)) add('resignation', o);
      if (rng.chance(0.025 + (hasT(o, 'family_man') ? 0.015 : 0) + (o.stats.consecutive >= 2 ? 0.05 : 0))) add('dayoff_request', o);
      if ((o.hidden.debt > 0 || (hasT(o, 'greedy') && owedText(game))) && rng.chance(0.04)) add('asks_advance', o);
      if (rng.chance(0.008)) add('family_crisis', o);
      if (o.morale < 50 && (o.skills.shooting > 60 || o.skills.tactics > 55) && !hasT(o, 'rookie') && rng.chance(0.015)) add('transfer_offer', o);
      if ((hasT(o, 'afghan') || hasT(o, 'chechnya')) && o.stress > 60 && o.onShift && rng.chance(0.12)) add('flashback', o);
      if (o.onShift && (hasT(o, 'kind') || o.role === 'uchastkovy' || o.stats.arrests > 0) && rng.chance(0.02)) add('citizen_thanks', o);
      if (hasT(o, 'rookie') && o.onShift && rng.chance(0.04)) add('rookie_mistake', o);
      if ((hasT(o, 'sadist') || hasT(o, 'hothead')) && o.stats.tasks > 0 && rng.chance(hasT(o, 'sadist') ? 0.04 : 0.015)) add('complaint_citizen', o);
      const corrupt = o.hidden.corruption > 55;
      if ((corrupt && rng.chance(0.05)) || (!corrupt && rng.chance(0.005))) add('bribe_rumor', o, { truth: corrupt });
      if (o.hidden.mole && !o.flags.turned && rng.chance(0.045 + o.hidden.exposure / 1000)) add('mole_activity', o);
    }
  }
  // ссоры: пары на сегодняшней смене
  const onNow = st.filter((o) => o.onShift);
  for (const a of onNow) for (const b of onNow) if (a.id < b.id && (a.relations[b.id] || 0) < -35 && rng.chance(0.12)) add('quarrel', a, { other: b });
  // «смотрящие» докладывают
  for (const w of st.filter((o) => o.flags.watcher && d - o.flags.watcher >= 2 && o.flags.watcher !== -1)) {
    if (!rng.chance(0.35)) continue;
    w.flags.watcher = -1;
    const mole = st.find((o) => o.hidden.mole && o !== w && !o.flags.exposed);
    let target, honest = true;
    if (w.hidden.mole) { target = rng.pick(st.filter((o) => o !== w && !o.hidden.mole)); honest = false; }
    else if (mole && rng.chance(0.45 + w.skills.perception / 250 + (mole.shiftGroup === w.shiftGroup ? 0.15 : 0))) target = mole;
    else target = rng.chance(0.5) ? null : rng.pick(st.filter((o) => o !== w));
    const text = target ? F(game, '%s.dn% докладывает с глазу на глаз: «Присмотритесь к %o.dn_d%. %why%»', w, target, { why: target.hidden.mole && honest ? cap(fmt(rng.pick(target.hidden.tells), { s: target })) + '.' : 'Ничего конкретного, но что-то с [ним|ней] не так.' })
      : F(game, '%s.dn% докладывает: «Смотрел{|а}, слушал{|а}. Ничего не нашёл{|ла}, товарищ %p.rank%. Или наши крысы умнее меня»'.replace('нашёл{|ла}', '{нашёл|нашла}'), w);
    pushInbox(game, { source: 'staff', kind: 'note', officerId: w.id, title: 'Доклад с глазу на глаз', text: fmt(text, { s: w, o: target, p: player(game) }), choices: [ch('ok', 'Принято')], autoChoice: 'ok', expires: expireIn(game, 24) });
  }
}

function dailyCondition(game) {
  const rng = R(game);
  const d = day(game);
  const fl = ownedFlags(game);
  const m = calendar(d, game.state.campaign && game.state.campaign.startDate).m;
  const cold = m >= 10 || m <= 3;
  for (const o of list(game)) {
    if (!inService(o)) continue;
    // отпуск
    if (o.status === 'leave' && o.leaveUntil && d >= o.leaveUntil) {
      o.status = 'home'; o.leaveUntil = null;
      if (o.flags.treatment) { o.flags.treatment = false; if (rng.chance(0.6)) { removeTrait(game, o, 'drinker'); glog(game, F(game, '%s.dn% {вернулся|вернулась} из наркодиспансера. Говорят, не пьёт. Пока.', o), 'staff'); } else glog(game, F(game, '%s.dn% {вернулся|вернулась} с лечения. По глазам видно — ненадолго.', o), 'staff'); }
      if (o.flags.therapy) { o.flags.therapy = false; o.stress = Math.max(0, o.stress - 20); }
    }
    if (o.status === 'missing' && o.missingUntil && d >= o.missingUntil) { o.status = 'home'; o.missingUntil = null; genEvent(game, 'binge_return', o, { days: o.flags.bingeDays || 3 }); }
    if (o.suspendedUntil && d >= o.suspendedUntil) o.suspendedUntil = null;
    // травмы
    const healK = (1 + mod(o, 'heal_rate', { traitsOnly: true })) * (fl.medRoom ? 1.33 : 1) * (o.status === 'hospital' ? 1.2 : 1);
    for (const i of o.injuries) i.daysLeft -= healK;
    const healed = o.injuries.filter((i) => i.daysLeft <= 0);
    if (healed.length) { o.injuries = o.injuries.filter((i) => i.daysLeft > 0); hist(game, o, `Зажило: ${healed.map((i) => i.name).join(', ')}.`); }
    if (!o.injuries.length) o.hp = Math.min(o.maxHp, o.hp + 15); else o.hp = Math.min(o.maxHp - 5 * o.injuries.reduce((a, i) => a + i.severity, 0), o.hp + 5);
    if (o.status === 'hospital' && !o.injuries.some((i) => i.severity >= 2)) { o.status = 'home'; glog(game, F(game, '%s.dn% {выписан|выписана} из больницы.', o), 'staff'); }
    // болезни
    if (o.cond.sick > 0) { o.cond.sick--; if (!o.cond.sick) hist(game, o, 'Закрыт больничный.'); }
    else if (o.status !== 'hospital' && o.status !== 'task') {
      const p = 0.006 + (hasT(o, 'sick') ? 0.025 : 0) + (cold ? 0.006 : 0) + (cold && !fl.heating ? 0.008 : 0) + (!fl.roofOk ? 0.003 : 0) + (o.fatigue > 75 ? 0.01 : 0) + (o.age > 45 ? 0.004 : 0);
      if (rng.chance(p)) {
        o.cond.sick = rng.int(2, 6); if (o.status === 'station') o.status = 'home'; o.onShift = false;
        const what = injuryName(rng, hasT(o, 'sick') && rng.chance(0.3) ? 2 : 1, 'illness');
        glog(game, F(game, '%s.dn% {позвонил|позвонила}: %w%, больничный на %n% дн.', o, null, { w: what, n: o.cond.sick }), 'staff');
      }
    }
  }
}

function drunkCheck(game) {
  const rng = R(game);
  for (const o of list(game)) {
    if (!inService(o) || !o.onShift || o.status !== 'station') continue;
    const h = o.hidden;
    if (h.drinkLevel <= 10) continue;
    const p = (h.drinkLevel / 100) * 0.1 + Math.max(0, o.stress - 30) / 700 + (o.morale < 35 ? 0.04 : 0) - mod(o, 'discipline', { traitsOnly: true }) * 0.05 + (game.state.flags && game.state.flags.b2_holiday ? 0.08 : 0);
    if (rng.chance(clamp(p, 0, 0.35))) { o.cond.drunk = rng.int(150, 420); reveal(game, o, 'drinker'); genEvent(game, 'drunk_at_work', o); }
    else if (h.drinkLevel > 60 && o.stress > 55 && rng.chance(0.03)) {
      const n = rng.int(1, 3); o.status = 'missing'; o.onShift = false; o.missingUntil = day(game) + n; o.flags.bingeDays = n;
      reveal(game, o, 'drinker');
      glog(game, F(game, '%s.dn% не {пришёл|пришла} на смену. Дома говорят — «ушёл в себя». Все понимают, куда.'.replace('«ушёл в себя»', o.gender === 'f' ? '«ушла в себя»' : '«ушёл в себя»'), o), 'staff');
    }
  }
}

function dailyMorale(game) {
  for (const o of list(game)) {
    if (!inService(o) || o.status === 'missing') continue;
    const t = moraleTarget(game, o);
    const dec = mod(o, 'morale_decay', { traitsOnly: true });
    const k = t < o.morale ? 0.15 * (1 + dec) : 0.15 * (1 - dec * 0.5);
    o.morale = clamp(o.morale + (t - o.morale) * k, 0, 100);
    o.loyalty = clamp(o.loyalty + ((50 + (o.morale - 50) * 0.3) - o.loyalty) * 0.02, 0, 100);
    // коррупция
    const h = o.hidden;
    const dc = mod(o, 'corruptibility', { traitsOnly: true }) * 3 + (owedText(game) ? 1.5 : 0) + (o.morale < 30 ? 1 : 0) - 0.6 - (o.loyalty > 70 ? 0.5 : 0);
    h.corruption = clamp(h.corruption + dc * 0.5, 0, 100);
    if (h.mole && h.guilt > 0) h.guilt = Math.max(0, h.guilt - 1);
    // обещания
    for (const p of o.promises) if (p.due && day(game) > p.due && !p.broken) { p.broken = true; applyEff(game, o, { loyalty: lg(o, -10), morale: -8 }); hist(game, o, 'Обещанной премии так и не дали.'); }
    o.promises = o.promises.filter((p) => !p.broken && (!p.due || day(game) <= p.due + 1));
  }
}

function dailyXP(game) {
  const rng = R(game);
  const fl = ownedFlags(game);
  const d = day(game);
  for (const o of list(game)) {
    if (!inService(o)) continue;
    if (o.onShift && ['station', 'task', 'home'].includes(o.status)) {
      o.stats.daysServed++; o.stats.shifts++; o.stats.consecutive++;
      o.xp += 4 * (1 + mod(o, 'xp_gain', { traitsOnly: true }));
      if (o.flags.mentorId) { o.xp += 6; const mentor = byId(game, o.flags.mentorId); if (mentor && mentor.status === 'dead') o.flags.mentorId = null; }
    } else o.stats.consecutive = 0;
    // рост навыков: каждые 100 опыта — +2 к случайному профильному навыку
    const lvl = Math.floor(o.xp / 100);
    if (o.flags.skillLvl === undefined) o.flags.skillLvl = lvl;
    while (o.flags.skillLvl < lvl) {
      o.flags.skillLvl++;
      const pref = { pps: ['shooting', 'tactics', 'fitness'], oper: ['investigation', 'talk', 'perception'], duty: ['perception', 'talk', 'discipline'], uchastkovy: ['talk', 'investigation'], driver: ['driving', 'tactics'], guard: ['discipline', 'perception'], kinolog: ['perception', 'fitness'], sledovatel: ['investigation', 'talk', 'discipline'], spec: ['shooting', 'tactics', 'fitness'] }[o.role] || ['tactics'];
      const k = rng.pick(pref.concat(['tactics', 'perception']));
      o.skills[k] = clamp(o.skills[k] + rng.int(1, 3), 5, 95);
    }
    if (fl.rangeTraining && calendar(d, game.state.campaign && game.state.campaign.startDate).weekday === 2 && o.onShift && game.state.economy && (game.state.economy.ammo['9x18'] || 0) >= 10) {
      game.state.economy.ammo['9x18'] -= 10; o.skills.shooting = clamp(o.skills.shooting + 1, 5, 95);
    }
    if (hasT(o, 'rookie') && o.xp >= 260) { removeTrait(game, o, 'rookie'); glog(game, F(game, '%s.dn% больше не салага: в отделе это признали молча — перестали подкалывать.', o), 'staff'); hist(game, o, 'Перестал считаться салагой.'.replace('Перестал', fmt('Перестал{|а}', { s: o }))); }
    if (hasT(o, 'lazy') && o.stats.shifts >= 3) reveal(game, o, 'lazy');
    if (hasT(o, 'honest') && o.stats.shifts >= 8) reveal(game, o, 'honest');
    // «крот» сливает
    if (o.hidden.mole && !o.flags.turned && o.onShift && o.status !== 'missing') {
      o.hidden.exposure = clamp(o.hidden.exposure + rng.int(1, 4), 0, 100);
      const s = game.state; s.flags = s.flags || {};
      s.flags.b2_lastLeak = { day: d, gangId: o.hidden.gangId };
      emit(game, 'staff:leak', { officerId: o.id, gangId: o.hidden.gangId, day: d, info: { onShift: list(game).filter((x) => x.onShift && inService(x)).length, alert: s.defense ? s.defense.alert : 'normal' } });
    }
  }
}

function ensureState(game) {
  const s = game.state;
  if (!s.staff) s.staff = [];
  if (!s.candidates) s.candidates = [];
  if (!s.inbox) s.inbox = [];
  if (!s.flags) s.flags = {};
  if (!s.investigations) s.investigations = [];
  if (!s.staffRumors) s.staffRumors = [];
  if (!s.time) s.time = { day: 1, minute: 480 };
}
function resolveMoleGangs(game) {
  const gangs = game.state.city && game.state.city.gangs;
  if (!gangs || !gangs.length) return;
  for (const o of [...list(game), ...(game.state.candidates || [])]) if (o.hidden.mole && !o.hidden.gangId) o.hidden.gangId = R(game).pick(gangs).id;
}

// ======================= публичный объект =======================
export const staff = {
  init(game, n = 12) {
    ensureState(game);
    const rng = R(game);
    const s = game.state;
    const comp = ['duty_chief', 'duty_assist', 'oper', 'uchastkovy', 'driver', 'guard', 'pps', 'pps', 'pps', 'pps', 'pps', rng.chance(0.5) ? 'oper' : 'pps', 'secretary'];
    while (comp.length < n) comp.push(rng.pick(['pps', 'pps', 'oper', 'guard', 'driver']));
    comp.length = n;
    if (n >= 10) comp.push('sledovatel', 'spec', 'spec', 'spec', 'spec', 'spec'); // 1.1: следствие и спецподразделение
    const nf = rng.int(2, 3);
    const femW = { duty_assist: 3, oper: 2, guard: 1.5, pps: 1, uchastkovy: 1, duty_chief: 1, driver: 0.1, secretary: 0 };
    const femIdx = new Set();
    let guard = 0;
    while (femIdx.size < nf && guard++ < 100) { const i = rng.weighted(comp.map((c, k) => ({ k, w: femIdx.has(k) ? 0 : femW[c] || 0.5 }))).k; femIdx.add(i); }
    const ppsIdx = comp.map((c, k) => (c === 'pps' ? k : -1)).filter((k) => k >= 0);
    const rookies = new Set(rng.sample(ppsIdx, rng.int(1, 2)));
    const list12 = comp.map((c, k) => makeOfficer(game, rng, {
      role: c === 'duty_chief' || c === 'duty_assist' ? 'duty' : c, dutyChief: c === 'duty_chief', gender: c === 'secretary' ? 'f' : femIdx.has(k) ? 'f' : 'm', rookie: rookies.has(k),
    }));
    // гарантии состава: хотя бы один пьющий и один честный
    const ensureTrait = (t) => {
      if (list12.some((o) => hasT(o, t))) return;
      const cand = rng.shuffle(list12).find((o) => traitOk(TRAIT_BY_ID[t], o, o.traits.filter((x) => !['rookie', 'veteran', 'afghan', 'chechnya', 'family_man'].includes(x)).slice(0, 1).concat(o.traits.filter((x) => ['rookie', 'veteran', 'afghan', 'chechnya', 'family_man'].includes(x)))));
      if (!cand) return;
      const keep = cand.traits.filter((x) => ['rookie', 'veteran', 'afghan', 'chechnya', 'family_man'].includes(x));
      const rest = cand.traits.filter((x) => !keep.includes(x) && traitOk(TRAIT_BY_ID[t], cand, [x]));
      cand.traits = [...keep, ...rest.slice(0, 1), t].slice(0, 3);
      if (!cand.traits.includes(t)) cand.traits.push(t);
      cand.knownTraits = cand.traits.filter((x) => !TRAIT_BY_ID[x].hidden);
      if (t === 'drinker') { cand.hidden.addiction = 'alcohol'; cand.hidden.drinkLevel = rng.int(45, 75); }
      if (t === 'honest') cand.hidden.corruption = Math.min(cand.hidden.corruption, 10);
    };
    ensureTrait('drinker'); ensureTrait('honest');
    // «крот»
    const diff = s.difficulty || 'normal';
    const moleChance = (s.campaign && s.campaign.settings && s.campaign.settings.moleChance != null) ? s.campaign.settings.moleChance : diff === 'easy' ? 0.5 : diff === 'hard' ? 1 : 0.8;
    if (rng.chance(moleChance)) {
      const pool = list12.filter((o) => !hasT(o, 'honest') && !hasT(o, 'idealist') && !hasT(o, 'rookie'));
      const m = rng.weighted(pool, (o) => o.hidden.corruption + (hasT(o, 'greedy') ? 25 : 0) + (hasT(o, 'gambler') ? 30 : 0) + (hasT(o, 'drinker') ? 10 : 0) + 5);
      if (m) makeMole(game, rng, m);
    }
    genRelations(game, rng, list12);
    s.staff = list12;
    assignShiftGroups(game, list12);
    s.candidates = genCandidates(game, rng.int(3, 4));
    s.candidatesNextDay = day(game) + rng.int(4, 6);
    attach(game);
    if (game.state.economy) economy.autoIssueStart(game);
    startShift(game);
    return s.staff;
  },
  update(game, dtMin) {
    if (!game.state.staff || !dtMin) return;
    attach(game);
    const t = nowAbs(game);
    const minute = game.state.time.minute;
    const night = minute < 360;
    const siege = !!game.state.attack;
    const fl = ownedFlags(game);
    const hrs = dtMin / 60;
    for (const o of list(game)) {
      if (!inService(o) || o.status === 'missing' || o.status === 'candidate') continue;
      const c = o.cond;
      if (c.drunk > 0) { c.drunk -= dtMin; if (c.drunk <= 0) { c.drunk = 0; c.hangover = 240; } }
      else if (c.hangover > 0) c.hangover = Math.max(0, c.hangover - dtMin);
      if (o.arriveAt != null && t >= o.arriveAt) { o.arriveAt = null; if (o.status === 'home' && o.onShift) { o.status = 'station'; glog(game, F(game, '%s.dn% {прибыл|прибыла} в отделение.', o), 'staff'); emit(game, 'staff:arrived', { officerId: o.id }); } }
      if (o.schedule === 'weekdays' && o.onShift && !o.overtime && o.status === 'station' && minute >= 1200 && !siege && !(game.state.defense && game.state.defense.alert !== 'normal')) { o.status = 'home'; o.restUntil = null; }
      if (o.goingHome != null && o.goingHome >= 0 && o.status === 'station' && t >= o.goingHome) { o.goingHome = null; if (!o.onShift || o.flags.wasOff) o.status = 'home'; }
      if (o.returnAt != null && t >= o.returnAt) { o.returnAt = null; if (o.status === 'task' && o.taskId && String(o.taskId).startsWith('b2_')) { o.status = o.onShift ? 'station' : 'home'; o.taskId = null; } }
      const resting = o.restUntil != null && t < o.restUntil;
      if (o.restUntil != null && !resting) o.restUntil = null;
      let rate;
      switch (o.status) {
        case 'station': rate = siege ? 8 : resting ? -6 * (1 + (fl.bunks ? 0.25 : 0) + (fl.coffee ? 0.15 : 0)) : night ? 1.1 * (fl.bunks ? 0.5 : 1) : 1.9; break;
        case 'task': rate = night ? 3.6 : 3.2; break;
        case 'home': rate = -3.6; break;
        case 'leave': rate = -4.5; break;
        case 'hospital': rate = -2; break;
        default: rate = 0;
      }
      if (rate > 0) rate *= (1 + mod(o, 'fatigue_rate', { traitsOnly: true })) * (o.injuries.length ? 1.2 : 1) * (o.equipment.armor === 'heavy' && o.status === 'task' ? 1.25 : 1);
      o.fatigue = clamp(o.fatigue + rate * hrs, 0, 100);
      const sd = ['home', 'leave'].includes(o.status) ? -0.5 : o.status === 'hospital' ? -0.3 : -0.12;
      o.stress = clamp(o.stress + (siege && o.status === 'station' ? 6 * (1 - mod(o, 'stress_resist', { traitsOnly: true })) : sd) * hrs, 0, 100);
      if (o.status === 'station' && o.onShift && night && o.fatigue > 88 && !resting && o.flags.sleptDay !== game.state.time.day && R(game).chance(0.08 * hrs * (hasT(o, 'lazy') ? 2 : 1))) {
        o.flags.sleptDay = game.state.time.day; o.record.misconduct.push({ day: day(game), kind: 'sleep' }); genEvent(game, 'sleeping', o);
      }
    }
    inboxTick(game);
  },
  dayStart(game) {
    ensureState(game);
    attach(game);
    resolveMoleGangs(game);
    dailyCondition(game);
    startShift(game);
    drunkCheck(game);
    const s = game.state;
    // результаты проверок
    for (const inv of s.investigations) if (!inv.done && day(game) >= inv.readyDay) computeInvestigation(game, inv);
    s.investigations = s.investigations.filter((i) => !i.done || day(game) - i.readyDay < 10);
    // кандидаты
    s.candidates = (s.candidates || []).filter((c) => !c.cand || c.cand.expiresDay > day(game));
    if (day(game) >= (s.candidatesNextDay || 0) || s.candidates.length === 0) {
      s.candidates = s.candidates.concat(genCandidates(game, R(game).int(2, 4))).slice(-5);
      s.candidatesNextDay = day(game) + R(game).int(4, 6);
    }
    rollEvents(game);
    for (const o of list(game)) o.talkLog = {};
    emit(game, 'staff:dayStart', { onShift: list(game).filter((o) => o.onShift).map((o) => o.id) });
  },
  dayEnd(game) {
    ensureState(game);
    dailyXP(game);
    dailyMorale(game);
    // отношения внутри смены
    const on = list(game).filter((o) => o.onShift && inService(o));
    for (const a of on) for (const b of on) if (a !== b) addRel(a, b, (a.relations[b.id] || 0) > 0 ? 0.6 : -0.3);
  },
  mod, combatStats, cohesion, leakRisk, actorLook: (o, game) => actorLook(game, o),
  available(game) { return list(game).filter((o) => o.status === 'station' && o.onShift && !ROLE_BY_ID[o.role]?.civilian); },
  civilian(o) { return !!(o && ROLE_BY_ID[o.role] && ROLE_BY_ID[o.role].civilian); },
  ready(game) { const t = nowAbs(game); return list(game).filter((o) => o.status === 'station' && o.onShift && !ROLE_BY_ID[o.role]?.civilian && !(o.restUntil && t < o.restUntil) && !(o.cond.drunk > 0) && !o.injuries.some((i) => i.severity >= 2)); },
  setShift, planShift, autoSchedule, reward, reprimand, promote, changeRole, fire, hire, sendLeave, sendHospital,
  talk, talkTopics, investigate, applyInjury, kill, reveal,
  describe: (o, opts) => describe(o, opts), displayName,
  answer, inbox(game) { return (game.state.inbox || []).filter((x) => !x.answered); },
  moraleTarget, makeOfficer, pushInbox,
  get(game, id) { return byId(game, id); },
};
export default staff;
