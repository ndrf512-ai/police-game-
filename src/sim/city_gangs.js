// Группировки: рост, деньги, вербовка, войны за районы, злость на милицию, планирование налётов.
// Информаторы и разведданные (intel) — тоже здесь: они живут вокруг банд.
import { randomPerson, fullName } from '../core/names.js';
import { R, clamp, num, poisson, nid, absNow, dmOf, minuteOfDay, hhmm, whenPhrase, emit, glog, cap, collective, sentence } from './city_util.js';
import { GANG_TYPES, GANG_ORDER, GANG_NAMES, LEADER_NICKS, MEMBER_NICKS, LEADER_BIOS, PERP_DESC, INFORMANT_ALIASES, INFORMANT_COVERS, DISTRICT_IDS, dForm } from './city_data.js';
import { C, dist, gang, activeGangs, gT, gn, gFormal, infSum, addEvent, bump, trust, day, placePrep, info } from './city_core.js';
import { dutySay, pick } from './city_radio.js';

/* ------------------------------------------------------------------ создание */
export function createGangs(game) {
  const rng = R(game);
  const c = C(game);
  const used = new Set();
  c.gangs = GANG_ORDER.map((type) => {
    const T = GANG_TYPES[type];
    const nm = rng.pick(GANG_NAMES[type]);
    const { base, ...forms } = nm;
    const person = randomPerson(rng, 'm');
    const g = {
      id: 'g_' + type, name: nm.nom, type, forms,
      leader: { person, nick: rng.pick(LEADER_NICKS[type]), age: rng.int(type === 'thieves' ? 52 : 27, type === 'thieves' ? 66 : 44), known: type === 'thieves', status: 'free', bio: rng.pick(LEADER_BIOS[type]) },
      deputy: { person: randomPerson(rng, 'm'), nick: rng.pick(MEMBER_NICKS[type]), age: rng.int(24, 40) },
      formerLeaders: [],
      members: rng.int(T.members[0], T.members[1]), strength: 0, money: rng.int(1500, 6000), anger: rng.int(8, 22),
      weaponsTier: rng.int(T.tier[0], T.tier[1]), territory: base.slice(), known: type === 'thieves' ? 45 : rng.int(12, 28),
      status: 'active', style: T.style, cohesion: rng.int(62, 80), points: [], base: base.slice(),
      lastAttackDay: -99, leaderlessDays: 0, stats: { arrested: 0, killed: 0, raids: 0 },
    };
    // точки: штаб, схрон, места поборов
    const mk = (kind, dId, known) => {
      const d = dist(game, dId);
      if (!d) return;
      const pref = d.places.filter((p) => T.pointKinds.includes(p.kind) && !used.has(p.id));
      const pool = pref.length ? pref : d.places.filter((p) => !used.has(p.id) && p.kind !== 'school' && p.kind !== 'church');
      if (!pool.length) return;
      const p = rng.pick(pool);
      used.add(p.id);
      g.points.push({ id: nid(game, 'gp'), kind, placeId: p.id, districtId: dId, known, raidedDay: -99 });
    };
    mk('hideout', base[0], type === 'thieves');
    mk('stash', rng.chance(0.5) ? base[1] : base[0], false);
    mk('racket', base[0], true);
    if (T.racket > 1) mk('racket', base[1], true);
    recalc(g);
    return g;
  });
  // начальное влияние
  for (const d of c.districts) {
    d.influence = {};
    for (const g of c.gangs) {
      const T = gT(g);
      let v = g.base[0] === d.id ? rng.int(30, 42) : g.base[1] === d.id ? rng.int(14, 24) : Math.max(0, Math.round((T.interest[d.id] || 0.5) * rng.int(0, 8) - 2));
      d.influence[g.id] = v;
    }
    normalizeInfluence(d);
  }
}

export function recalc(g) {
  const tierMul = [0, 0.8, 1.0, 1.25][g.weaponsTier] || 1;
  const leaderMul = g.leader.status === 'free' ? 1 : g.leader.status === 'arrested' ? 0.75 : 0.62;
  g.strength = Math.round(clamp(g.members * 2.2 * tierMul * (0.5 + g.cohesion / 200) * leaderMul, 0, 100));
  return g.strength;
}
export function normalizeInfluence(d) {
  const s = infSum(d);
  if (s > 100) for (const k in d.influence) d.influence[k] = Math.round((d.influence[k] * 100 / s) * 10) / 10;
}

/* ------------------------------------------------------------------ удары по банде */
/** итог действий милиции против банды: arrested/killed — число людей, money — изъято */
export function gangHit(game, gangId, hit) {
  const g = gang(game, gangId);
  if (!g) return;
  const lost = num(hit.arrested) + num(hit.killed);
  g.members = Math.max(0, g.members - lost);
  g.stats.arrested += num(hit.arrested);
  g.stats.killed += num(hit.killed);
  if (hit.money) g.money = Math.max(0, g.money - hit.money);
  g.anger = clamp(g.anger + num(hit.arrested) * 4 + num(hit.killed) * 8 + num(hit.anger), 0, 100);
  g.known = clamp(g.known + num(hit.known, lost * 2), 0, 100);
  g.cohesion = clamp(g.cohesion - lost * 1.5 - num(hit.cohesion), 0, 100);
  if (hit.districtId) {
    const d = dist(game, hit.districtId);
    if (d) {
      d.influence[g.id] = Math.max(0, num(d.influence[g.id]) - num(hit.influence, lost * 1.5));
      const acc = d.dayAcc;
      acc.arrests[g.id] = num(acc.arrests[g.id]) + lost;
    }
  }
  if (hit.weapons && g.weaponsTier > 1 && R(game).chance(hit.weapons)) g.weaponsTier--;
  recalc(g);
}
export function leaderCaught(game, g, how) {
  if (!g || g.leader.status !== 'free') return;
  g.leader.status = how;
  g.leader.known = true;
  g.leaderlessDays = 0;
  g.anger = clamp(g.anger + 30, 0, 100);
  g.cohesion = clamp(g.cohesion - 20, 0, 100);
  recalc(g);
  addEvent(game, { districtId: g.base[0], weight: 9, kind: 'police', text: `${how === 'dead' ? 'Убит' : 'Задержан'} лидер группировки «${g.name}» ${g.leader.person.lastName} по кличке «${g.leader.nick}».` });
  glog(game, `Лидер «${g.name}» «${g.leader.nick}» ${how === 'dead' ? 'убит' : 'задержан'}.`, 'important');
}

/* ------------------------------------------------------------------ сутки */
export function policeWeakness(game) {
  const c = C(game);
  let s = 0;
  for (const d of c.districts) s += num(d.presenceAvg);
  return 1 - clamp(s / c.districts.length / 28, 0, 1);
}

/** суточный пересчёт районов и банд (вызывается в 08:00) */
export function cityDaily(game) {
  const rng = R(game);
  const c = C(game);
  // районы
  for (const d of c.districts) {
    const acc = d.dayAcc;
    const P = acc.minutes ? acc.presenceSum / acc.minutes : 0;
    d.presenceAvg = Math.round(P * 10) / 10;
    d.neglect = P < 6 ? num(d.neglect) + 1 : Math.max(0, num(d.neglect) - (P > 20 ? 3 : 1));
    // доверие
    let dt = (P - 15) * 0.05 + acc.solved * 0.7 - acc.ignored * 1.2 - acc.brutality * 2 - Math.min(d.neglect, 6) * 0.5;
    dt += (40 - d.trust) * 0.02;
    trust(game, d.id, clamp(dt, -6, 5));
    // уровень преступности
    const target = num(d.baseCrime, 45) + infSum(d) * 0.3 - P * 0.35 - (d.trust - 40) * 0.12 + Math.min(d.neglect, 7) * 2.5;
    d.crime = Math.round(clamp(d.crime + (target - d.crime) * 0.22 + rng.gauss(0, 1), 5, 100) * 10) / 10;
    // влияние банд
    for (const g of c.gangs) {
      let i = num(d.influence[g.id]);
      if (g.status !== 'active') { d.influence[g.id] = Math.round(i * 0.7 * 10) / 10; continue; }
      const T = gT(g);
      const interest = (T.interest[d.id] || 0.6) * (g.base.includes(d.id) ? 1.2 : 1);
      let growth = 2.4 * T.growth * interest * (g.strength / 50) * Math.max(-0.4, 1 - P / 40) * (1 + 0.12 * Math.min(d.neglect, 5)) * (1 - (d.trust - 40) / 220);
      if (i < 3 && growth > 0) growth = g.strength > 38 && rng.chance(0.2 * interest) ? growth + 2 : 0;
      const supp = P * 0.06 + num(acc.raids[g.id]) * 5 + num(acc.arrests[g.id]) * 0.8;
      i = clamp(i + growth - supp + rng.gauss(0, 0.5), 0, 100);
      d.influence[g.id] = Math.round(i * 10) / 10;
    }
    normalizeInfluence(d);
  }
  const weak = policeWeakness(game);
  // банды
  for (const g of c.gangs) {
    if (g.status !== 'active') continue;
    const T = gT(g);
    let isum = 0, income = 0;
    for (const d of c.districts) {
      const i = num(d.influence[g.id]);
      isum += i;
      income += (i / 100) * info(d.id).wealth * 300 * (T.racket * 0.6 + T.drugs * 0.4) / 1.1;
      income += num(d.dayAcc.gangCrimes[g.id]) * 40;
    }
    g.money = Math.round(g.money + income * rng.range(0.8, 1.2) - g.members * 12);
    if (g.money < 0) { g.money = 0; g.cohesion = clamp(g.cohesion - 5, 0, 100); g.members = Math.max(0, g.members - rng.int(0, 2)); }
    // вербовка: безработица, безнаказанность
    const rate = (0.25 + isum / 120) * T.growth * (g.cohesion / 80) * (g.money > g.members * 30 ? 1 : 0.4) * (1 + 0.5 * weak);
    const cap1 = Math.round(T.maxMembers * (1 + isum / 300));
    g.members = Math.min(cap1, g.members + poisson(rng, rate));
    // оружие
    const cost = [0, 9000, 16000, 999999][g.weaponsTier];
    if (g.money > cost * 1.3 && rng.chance(0.2)) {
      g.money -= cost; g.weaponsTier++;
      g.rumorWeapons = true;
    }
    // сплочённость и смена лидера
    g.cohesion = clamp(g.cohesion + (g.leader.status === 'free' ? (75 - g.cohesion) * 0.1 : (45 - g.cohesion) * 0.1), 0, 100);
    recalc(g);
    if (g.leader.status !== 'free') {
      g.leaderlessDays++;
      if (g.strength < 18 || g.members < 4) { breakGang(game, g); continue; }
      if (g.leaderlessDays >= 3) promoteDeputy(game, g);
    } else if (g.members < 3) { breakGang(game, g); continue; }
    // злость: остывает, но безнаказанность делает наглее
    g.anger -= g.strength < 25 ? 2.5 : 1.5;
    if (weak > 0.45 && g.strength > 42) g.anger += (g.strength - 42) * 0.07 * weak + T.aggression * 1.3;
    g.anger += heldMembers(game, g.id) * 1.5;
    g.anger = clamp(g.anger, 0, 100);
    g.territory = c.districts.filter((d) => num(d.influence[g.id]) >= 25).map((d) => d.id);
    recalc(g);
  }
  c.stats.history.push({ day: game.state.time ? game.state.time.day : 1, influence: Object.fromEntries(c.gangs.map((g) => [g.id, Math.round(c.districts.reduce((s, d) => s + num(d.influence[g.id]), 0))])), strength: Object.fromEntries(c.gangs.map((g) => [g.id, g.strength])), crime: Math.round(c.districts.reduce((s, d) => s + d.crime, 0) / c.districts.length), trust: Math.round(c.districts.reduce((s, d) => s + d.trust, 0) / c.districts.length) });
  if (c.stats.history.length > 120) c.stats.history.splice(0, c.stats.history.length - 120);
}

function promoteDeputy(game, g) {
  g.formerLeaders.push({ ...g.leader });
  g.leader = { person: g.deputy.person, nick: g.deputy.nick, age: g.deputy.age, known: false, status: 'free', bio: 'бывший правая рука прежнего, рвётся доказать, что не хуже' };
  const rng = R(game);
  g.deputy = { person: randomPerson(rng, 'm'), nick: rng.pick(MEMBER_NICKS[g.type]), age: rng.int(22, 38) };
  g.leaderlessDays = 0;
  g.anger = clamp(g.anger + 10, 0, 100);
  g.cohesion = clamp(g.cohesion + 10, 0, 100);
  recalc(g);
  addEvent(game, { districtId: g.base[0], weight: 5, kind: 'gang', text: `По оперативным данным, у группировки «${g.name}» новый главный — по кличке «${g.leader.nick}». Личность не установлена.` });
}
function breakGang(game, g) {
  g.status = 'broken';
  g.strength = Math.min(g.strength, 10);
  addEvent(game, { districtId: g.base[0], weight: 10, kind: 'police', text: `Группировка «${g.name}» фактически разгромлена: верхушка за решёткой, остатки разбегаются или уходят к другим.` });
  glog(game, `Группировка «${g.name}» разгромлена.`, 'important');
  // остатки уходят к самой сильной соседней
  const heir = activeGangs(game).sort((a, b) => b.strength - a.strength)[0];
  if (heir) { heir.members += Math.floor(g.members / 2); recalc(heir); }
  g.members = 0;
  C(game).intel.forEach((i) => { if (i.gangId === g.id && !i.used) i.expires = absNow(game); });
}

/** сколько людей банды сидит в камерах участка */
export function heldMembers(game, gangId, leaderOnly = false) {
  const c = C(game);
  const det = Array.isArray(game.state.detainees) ? game.state.detainees : [];
  let n = 0;
  for (const h of c.captivesHeld) {
    if (h.gangId !== gangId || (leaderOnly && !h.leader)) continue;
    const d = det.find((x) => x.id === h.detId);
    if (d && d.status === 'cell') n++;
  }
  return n;
}

/* ------------------------------------------------------------------ разборки между бандами */
export function planClashes(game) {
  const rng = R(game);
  const c = C(game);
  const now = absNow(game);
  let planned = 0;
  for (const d of rng.shuffle(c.districts)) {
    const gs = activeGangs(game).filter((g) => num(d.influence[g.id]) >= 12);
    for (let a = 0; a < gs.length; a++) for (let b = a + 1; b < gs.length; b++) {
      const A = gs[a], B = gs[b];
      const key = [A.id, B.id].sort().join('|');
      c.tension[key] = clamp(num(c.tension[key]) * 0.85 + Math.min(d.influence[A.id], d.influence[B.id]) / 12, 0, 100);
      const p = clamp(0.04 + c.tension[key] / 220 + (gT(A).aggression + gT(B).aggression) / 14, 0, 0.45) * (num(d.presenceAvg) > 30 ? 0.6 : 1);
      if (planned < 2 && rng.chance(p)) {
        planned++;
        const at = now - minuteOfDay(now) + (rng.chance(0.75) ? 22 * 60 + rng.int(0, 400) : 14 * 60 + rng.int(0, 400));
        c.schedule.push({ at: at > now ? at : now + rng.int(60, 600), kind: 'clash', a: A.id, b: B.id, districtId: d.id });
      }
    }
  }
}

export function genGangPerp(game, g, opts = {}) {
  const rng = R(game);
  const type = g ? g.type : 'none';
  const tier = g ? g.weaponsTier : 1;
  const armedTab = tier >= 3 ? [['rifle', 40], ['pistol', 35], ['shotgun', 20], ['knife', 5]]
    : tier === 2 ? [['pistol', 45], ['knife', 15], ['bat', 10], ['shotgun', 20], ['rifle', 10]]
      : [['none', 25], ['knife', 25], ['bat', 20], ['pistol', 25], ['shotgun', 5]];
  let armed = rng.weighted(armedTab, (x) => (type === 'afghan' && x[0] === 'rifle' ? x[1] * 2 : x[1]))[0];
  if (opts.armed) armed = opts.armed;
  const isLeader = !!opts.leader && g && g.leader.status === 'free';
  return {
    person: isLeader ? g.leader.person : randomPerson(rng, 'm'),
    nick: isLeader ? g.leader.nick : rng.pick(MEMBER_NICKS[g ? g.type : 'sport']),
    age: isLeader ? g.leader.age : rng.int(17, 38), desc: rng.pick(PERP_DESC[type] || PERP_DESC.none), armed,
    gangId: g ? g.id : null, leader: isLeader,
  };
}

export function resolveClash(game, ev) {
  const rng = R(game);
  const A = gang(game, ev.a), B = gang(game, ev.b), d = dist(game, ev.districtId);
  if (!A || !B || !d || A.status !== 'active' || B.status !== 'active') return null;
  const sA = A.strength * gT(A).skill * (0.5 + num(d.influence[A.id]) / 100) * rng.range(0.6, 1.4);
  const sB = B.strength * gT(B).skill * (0.5 + num(d.influence[B.id]) / 100) * rng.range(0.6, 1.4);
  const W = sA >= sB ? A : B, L = W === A ? B : A;
  const firearms = Math.max(A.weaponsTier, B.weaponsTier) >= 2 || rng.chance(0.4);
  const dead = firearms ? poisson(rng, 0.5 + 0.3 * Math.max(A.weaponsTier, B.weaponsTier) + (A.type === 'frostbitten' || B.type === 'frostbitten' ? 0.4 : 0)) : poisson(rng, 0.25);
  const wounded = rng.int(1, 3) + (firearms ? 1 : 0);
  const deadL = Math.min(dead, Math.ceil(dead * 0.7)), deadW = dead - deadL;
  L.members = Math.max(0, L.members - deadL - rng.int(0, 2));
  W.members = Math.max(0, W.members - deadW);
  L.cohesion = clamp(L.cohesion - 8, 0, 100);
  const shift = rng.int(5, 12);
  d.influence[L.id] = Math.max(0, num(d.influence[L.id]) - shift);
  d.influence[W.id] = num(d.influence[W.id]) + Math.round(shift * 0.7);
  normalizeInfluence(d);
  recalc(A); recalc(B);
  bump(game, 'clashes');
  const kinds = ['garage', 'warehouse', 'bar', 'street', 'park', 'factory', 'market'];
  const pl = rng.pick(d.places.filter((p) => kinds.includes(p.kind))) || rng.pick(d.places);
  const what = firearms ? 'перестрелка' : 'массовая драка с применением бит и ножей';
  const perps = [genGangPerp(game, A), genGangPerp(game, B), genGangPerp(game, rng.chance(0.5) ? A : B)];
  const victims = [];
  for (let i = 0; i < dead; i++) victims.push({ person: randomPerson(rng, 'm'), age: rng.int(19, 35), desc: 'член преступной группировки', condition: 'dead' });
  for (let i = 0; i < Math.min(wounded, 3); i++) victims.push({ person: randomPerson(rng, 'm'), age: rng.int(18, 35), desc: 'доставлен в больницу с ранением', condition: 'serious' });
  const deadTxt = dead ? `${dead === 1 ? 'Один погибший' : `Погибших — ${dead}`}, раненых — ${wounded}` : `Раненых — ${wounded}, погибших нет`;
  const title = firearms ? 'Перестрелка между группировками' : 'Массовая драка между группировками';
  const known = A.known > 25 && B.known > 25;
  const text = {
    dispatch: firearms ? `${placePrep(pl)} перестрелка, много людей, слышны очереди.` : `${placePrep(pl)} массовая драка, человек двадцать, с битами.`,
    caller: 'Жители соседних домов звонят наперебой.',
    news: `${cap(dForm(d.id, 'prep'))} ${placePrep(pl)} произошла ${what}. ${deadTxt}.`,
    details: known ? `По оперативным данным, ${gFormal(A, 'nom')} и ${gFormal(B, 'nom')} делят ${dForm(d.id)}.` : 'Участники разъехались до приезда милиции. Свидетели молчат.',
  };
  return {
    clash: true, A, B, W, L, d, place: pl, dead, wounded, firearms,
    crimeSpec: {
      typeId: 'gang_clash', category: 'organized', severity: dead ? 5 : 4, title, districtId: d.id, place: pl,
      perps, victims, witnesses: rng.int(0, 3), evidence: firearms ? ['гильзы 7,62 и 9 мм', 'следы протекторов'] : ['обломок биты', 'кровь на асфальте'],
      text, solvability: 0.25, danger: firearms ? 0.8 : 0.5, gangId: W.id, tags: ['gang_war'],
    },
    eventText: `${hhmm(minuteOfDay(absNow(game)))} — ${placePrep(pl)} ${what}${known ? ` между группировками «${A.name}» и «${B.name}»` : ' между неустановленными группами'}. ${deadTxt}.`,
  };
}

/* ------------------------------------------------------------------ налёты на участок */
export function considerAttacks(game, forceGangId = null) {
  const rng = R(game);
  const c = C(game);
  if (c.silent) return;
  if (!game.combat || typeof game.combat.planAttack !== 'function') return;
  const today = game.state.time ? game.state.time.day : 1;
  const plans = Array.isArray(game.state.attackPlans) ? game.state.attackPlans : [];
  const diff = { easy: 0.6, normal: 1, hard: 1.35 }[game.state.difficulty] || 1;
  const weak = policeWeakness(game);
  let made = 0;
  for (const g of rng.shuffle(activeGangs(game))) {
    if (made >= 1) break;
    if (forceGangId && g.id !== forceGangId) continue;
    const T = gT(g);
    if (g.strength < (g.type === 'frostbitten' ? 22 : 28)) continue;
    if (plans.some((p) => p.gangId === g.id && !p.done && !p.resolved)) continue;
    if (today - g.lastAttackDay < 6) continue;
    const leaderHeld = heldMembers(game, g.id, true);
    const held = heldMembers(game, g.id);
    let p = 0, reason = '', code = '';
    if (leaderHeld) { p += 0.4; reason = `отбить своего главаря «${g.leader.nick}» из ИВС`; code = 'free_leader'; }
    else if (held >= 2) { p += 0.12; reason = `освободить своих людей из камер`; code = 'free_members'; }
    if (g.anger >= T.attackAt) { p += 0.2 + (g.anger - T.attackAt) / 60; if (!code) { reason = 'месть милиции'; code = 'revenge'; } }
    if (g.strength >= 58 && weak > 0.6) { p += 0.1 + (g.strength - 58) / 200; if (!code) { reason = 'показать району, кто здесь хозяин'; code = 'impunity'; } }
    if (!code) continue;
    if (!rng.chance(clamp(p * diff, 0, 0.85))) continue;
    launchAttack(game, g, reason, code);
    made++;
  }
}
export function launchAttack(game, g, reason, code) {
  const c = C(game);
  let plan = null;
  try {
    plan = game.combat.planAttack(game, g.id, reason, { code, strength: g.strength, members: g.members, weaponsTier: g.weaponsTier, gangType: g.type, anger: g.anger });
  } catch (e) { if (typeof console !== 'undefined') console.warn('[city] combat.planAttack', e); }
  if (!plan) return null;
  g.lastAttackDay = game.state.time ? game.state.time.day : 1;
  bump(game, 'attacksPlanned');
  c.attackLog.push({ day: g.lastAttackDay, gangId: g.id, reason, code, planId: plan.id || null });
  if (c.attackLog.length > 40) c.attackLog.shift();
  scheduleWarning(game, g, plan);
  return plan;
}
function planAbs(plan) { return Number.isFinite(plan.day) && Number.isFinite(plan.minute) ? (plan.day - 1) * 1440 + plan.minute : null; }
function scheduleWarning(game, g, plan) {
  const rng = R(game);
  const c = C(game);
  const now = absNow(game);
  const at = planAbs(plan);
  if (at === null || at - now < 90) return;
  const infs = c.informants.filter((i) => i.status === 'active' && (i.gangId === g.id || g.base.includes(i.districtId)));
  const best = infs.sort((a, b) => b.reliability - a.reliability)[0];
  let src = null;
  if (best && rng.chance(0.35 + best.reliability * 0.45)) src = best.id;
  else {
    const t = g.base.reduce((s, id) => s + num((dist(game, id) || {}).trust, 30), 0) / g.base.length;
    if (rng.chance(clamp((t - 35) / 120, 0, 0.3))) src = 'anon';
  }
  if (!src) return;
  const when = now + Math.floor(rng.range(0.15, 0.8) * (at - now - 60));
  c.schedule.push({ at: when, kind: 'warning', gangId: g.id, planId: plan.id, src });
}
export function fireWarning(game, ev) {
  const g = gang(game, ev.gangId);
  const plans = Array.isArray(game.state.attackPlans) ? game.state.attackPlans : [];
  const plan = plans.find((p) => p.id === ev.planId);
  if (!g || !plan || plan.warned) return;
  const now = absNow(game);
  const at = planAbs(plan);
  if (at !== null && at <= now) return;
  plan.warned = true;
  const inf = C(game).informants.find((i) => i.id === ev.src);
  const size = Number.isFinite(plan.size) ? `человек ${plan.size}` : `человек ${Math.max(5, Math.round(g.members / 2))}`;
  const arms = g.weaponsTier >= 3 ? 'с автоматами' : g.weaponsTier === 2 ? 'со стволами' : 'с битами и обрезами';
  const when = at !== null ? whenPhrase(game, now, at) : 'на днях';
  const entry = plan.entry === 'back' ? ' Пойдут, говорит, со двора.' : plan.entry === 'both' ? ' Хотят зайти и с улицы, и со двора.' : '';
  const text = inf
    ? `Товарищ майор! Звонил «${inf.alias}»: ${gn(g, 'people')} собираются к нам — ${when}, ${size}, ${arms}.${entry} Причина — ${plan.reason || 'месть'}.`
    : `Товарищ майор, звонок, голос женский, не представилась: «Передайте майору — к вам придут ${when}. ${cap(gn(g, 'people'))}, ${arms}». И повесила трубку.`;
  dutySay(game, text, 'alarm');
  addIntel(game, { kind: 'attack', gangId: g.id, districtId: null, text: `Ожидается налёт ${gn(g, 'peopleGen')} на отдел: ${when}, ${size}, ${arms}.`, reliability: inf ? inf.reliability : 0.5, revealed: true, source: inf ? 'informant' : 'anonymous', expires: at !== null ? at + 120 : now + 2880 });
  emit(game, 'attack:warning', { plan });
  glog(game, `Предупреждение о налёте ${gn(g, 'peopleGen')}: ${when}.`, 'alarm');
}

/* ------------------------------------------------------------------ разведданные */
const INTEL_OPENS = { hideout: ['raid'], stash: ['raid'], suspect: ['raid', 'ambush'], meeting: ['ambush'], deal: ['ambush'], robbery: ['ambush', 'guard'], witness: ['guard'], leader: [], attack: [], wanted: [], racket: ['ambush'] };
export function addIntel(game, spec) {
  const c = C(game);
  const now = absNow(game);
  const it = {
    id: nid(game, 'in'), kind: spec.kind, gangId: spec.gangId || null, districtId: spec.districtId || null, placeId: spec.placeId || null,
    crimeId: spec.crimeId || null, pointId: spec.pointId || null, text: spec.text, day: dmOf(now).day, minute: dmOf(now).minute,
    expires: spec.expires || now + 3 * 1440, window: spec.window || null, reliability: num(spec.reliability, 0.6), fake: !!spec.fake,
    revealed: spec.revealed !== false, used: false, source: spec.source || 'informant', opens: INTEL_OPENS[spec.kind] || [], data: spec.data || null,
  };
  c.intel.push(it);
  if (c.intel.length > 80) {
    const keep = c.intel.filter((i) => !i.used && i.expires > now);
    c.intel = keep.length > 80 ? keep.slice(-80) : keep;
  }
  if (it.revealed) onReveal(game, it);
  return it;
}
function onReveal(game, it) {
  const g = gang(game, it.gangId);
  if (it.kind === 'leader' && g) g.leader.known = true;
  if ((it.kind === 'hideout' || it.kind === 'stash') && g && it.pointId) {
    const p = g.points.find((x) => x.id === it.pointId);
    if (p) p.known = true;
  }
  if (g) g.known = clamp(g.known + 4, 0, 100);
  // настоящая наводка на налёт — в расписание
  if (it.kind === 'robbery' && it.window && !it.fake && !it.scheduled) {
    it.scheduled = true;
    C(game).schedule.push({ at: it.window.from + R(game).int(0, Math.max(1, it.window.to - it.window.from - 10)), kind: 'gangop', op: 'robbery', intelId: it.id, gangId: it.gangId, districtId: it.districtId, placeId: it.placeId });
  }
}
/** CONTRACT-EXTRA: открыть скрытые сведения (зовёт detainees.interrogate, когда задержанный «поплыл») */
export function revealIntel(game, intelId, source = 'interrogation') {
  const it = C(game).intel.find((i) => i.id === intelId);
  if (!it) return null;
  if (!it.revealed) { it.revealed = true; it.source = source; it.day = dmOf(absNow(game)).day; onReveal(game, it); }
  return it;
}

/**
 * Сгенерировать сведение о банде. revealed=false — для задержанных (раскроется на допросе).
 */
export function gangIntel(game, g, opts = {}) {
  const rng = R(game);
  const now = absNow(game);
  if (!g) return null;
  const kinds = opts.kinds || ['hideout', 'stash', 'meeting', 'deal', 'robbery', 'leader'];
  const w = { hideout: 3, stash: 2, meeting: g.leader.status === 'free' ? 1.5 : 0.3, deal: g.type === 'drugs' ? 3 : 0.8, robbery: g.type === 'thieves' ? 0.6 : 1.4, leader: g.leader.known ? 0 : 1.5 };
  const kind = rng.weighted(kinds.map((k) => ({ k, w: num(w[k], 1) })), (x) => x.w).k;
  const fake = rng.chance(1 - num(opts.reliability, 0.7)) && kind !== 'leader';
  const base = { gangId: g.id, reliability: num(opts.reliability, 0.7), fake, revealed: opts.revealed !== false, source: opts.source || 'informant' };
  const hdr = opts.prefix || '';
  if (kind === 'hideout' || kind === 'stash') {
    const pts = g.points.filter((p) => p.kind === kind || (kind === 'hideout' && p.kind === 'racket'));
    const pt = rng.pick(pts.length ? pts : g.points);
    if (!pt) return null;
    const d = dist(game, pt.districtId);
    const p = d && d.places.find((x) => x.id === pt.placeId);
    if (!p) return null;
    const what = kind === 'stash' ? rng.pick(['оружие', 'стволы и патроны', g.type === 'drugs' ? 'товар и деньги' : 'обрезы и гранаты']) : rng.pick(['деньги', 'общак', 'людей человек пять-шесть по вечерам']);
    return addIntel(game, { ...base, kind, districtId: d.id, placeId: p.id, pointId: pt.id, expires: now + 6 * 1440, text: sentence(`${hdr}${kind === 'stash' ? 'Схрон' : 'Точка'} ${gn(g, 'peopleGen')} — ${placePrep(p)} (${dForm(d.id)}). Там ${what}`) });
  }
  if (kind === 'leader') {
    const L = g.leader;
    return addIntel(game, { ...base, kind, fake: false, expires: now + 30 * 1440, text: sentence(`${hdr}Главный у ${gn(g, 'peopleGen')} — ${fullName(L.person)}, ${L.age} лет, кличка «${L.nick}»: ${L.bio}`) });
  }
  // со временем: сходка, сделка, налёт
  const dId = rng.pick(g.territory.length ? g.territory : g.base);
  const d = dist(game, dId);
  const kindsPl = kind === 'robbery' ? ['bank', 'shop', 'kiosk', 'office', 'market'] : ['bar', 'garage', 'warehouse', 'park', 'dacha', 'station', 'hostel'];
  const pool = d.places.filter((p) => kindsPl.includes(p.kind));
  const p = rng.pick(pool.length ? pool : d.places);
  const from = now + rng.int(5, 30) * 60;
  const window = { from, to: from + rng.int(60, 150) };
  const when = whenPhrase(game, now, from);
  let text;
  if (kind === 'meeting') text = `${hdr}Сходка ${gn(g, 'peopleGen')} ${when} ${placePrep(p)}. Будет сам «${g.leader.nick}».`;
  else if (kind === 'deal') text = `${hdr}${g.type === 'drugs' ? 'Передача партии товара' : 'Покупка оружия'} ${when} ${placePrep(p)}, люди ${gn(g, 'peopleGen')}.`;
  else text = `${hdr}${cap(gn(g, 'people'))} готовят налёт на «${p.name}» (${placePrep(p)}) — ${when}.`;
  return addIntel(game, { ...base, kind, districtId: dId, placeId: p.id, window, expires: window.to + 30, text, data: { leaderPresent: kind === 'meeting' ? rng.chance(0.75) : rng.chance(0.15) } });
}

/* ------------------------------------------------------------------ информаторы */
export function addInformant(game, data = {}) {
  const rng = R(game);
  const c = C(game);
  const dId = data.districtId || rng.pick(DISTRICT_IDS);
  const d = dist(game, dId);
  const tg = data.gangId || (d ? (activeGangs(game).sort((a, b) => num(d.influence[b.id]) - num(d.influence[a.id]))[0] || {}).id : null);
  const used = new Set(c.informants.map((i) => i.alias));
  const alias = rng.pick(INFORMANT_ALIASES.filter((a) => !used.has(a))) || `Источник-${c.informants.length + 1}`;
  const inf = {
    id: nid(game, 'inf'), alias, person: data.person || randomPerson(rng), cover: data.cover || rng.pick(INFORMANT_COVERS[dId] || INFORMANT_COVERS.centr),
    districtId: dId, gangId: tg || null, reliability: clamp(num(data.reliability, rng.range(0.45, 0.85)), 0.1, 0.95), source: data.source || 'trust',
    recruitedDay: game.state.time ? game.state.time.day : 1, status: 'active', tips: 0, lastTipDay: -9, detaineeId: data.detaineeId || null,
  };
  c.informants.push(inf);
  addEvent(game, { districtId: dId, weight: 4, kind: 'police', text: `Завербован новый источник — «${alias}» (${inf.cover}, ${dForm(dId, 'nom')}).` });
  return inf;
}
export function informantsDaily(game) {
  const rng = R(game);
  const c = C(game);
  const today = game.state.time ? game.state.time.day : 1;
  for (const inf of c.informants) {
    if (inf.status !== 'active') continue;
    const g = gang(game, inf.gangId);
    if (!g || g.status !== 'active') { if (rng.chance(0.1)) inf.status = 'retired'; continue; }
    if (today - inf.lastTipDay < 1 || !rng.chance(0.28 + inf.reliability * 0.15)) continue;
    // подача сведений — днём в удобный час
    c.schedule.push({ at: absNow(game) + rng.int(60, 600), kind: 'tip', infId: inf.id });
    inf.lastTipDay = today;
  }
  // добровольцы из доверяющих районов
  for (const d of c.districts) {
    if (d.trust >= 58 && !c.informants.some((i) => i.status === 'active' && i.districtId === d.id) && rng.chance((d.trust - 50) / 300)) {
      addInformant(game, { districtId: d.id, source: 'trust', reliability: rng.range(0.5, 0.8) });
    }
  }
}
export function fireTip(game, ev) {
  const rng = R(game);
  const c = C(game);
  const inf = c.informants.find((i) => i.id === ev.infId);
  if (!inf || inf.status !== 'active') return;
  const g = gang(game, inf.gangId);
  if (!g || g.status !== 'active') return;
  // риск провала источника
  const burn = 0.025 + g.anger / 2500 + (moleFor(game, g.id) ? 0.05 : 0) + inf.tips * 0.004;
  if (rng.chance(burn)) { burnInformant(game, inf, g); return; }
  const it = gangIntel(game, g, { reliability: inf.reliability, source: 'informant', revealed: true });
  if (!it) return;
  inf.tips++;
  bump(game, 'tips');
  dutySay(game, `Товарищ майор, звонил «${inf.alias}». ${it.text}`, 'info');
}
export function burnInformant(game, inf, g) {
  const rng = R(game);
  inf.status = rng.chance(0.55) ? 'dead' : 'burned';
  const d = dist(game, inf.districtId);
  if (inf.status === 'dead') {
    C(game).schedule.push({ at: absNow(game) + rng.int(30, 300), kind: 'ownCrime', spec: {
      typeId: 'informant_murder', category: 'violent', severity: 5, title: 'Убийство', districtId: inf.districtId,
      place: d ? rng.pick(d.places) : null, perps: [genGangPerp(game, g)], victims: [{ person: inf.person, age: 40, desc: inf.cover, condition: 'dead' }],
      witnesses: 0, evidence: ['записка во рту: «стукачам»'], text: { dispatch: `обнаружено тело: ${inf.cover}.`, caller: 'Звонят соседи.', news: null, details: 'На теле следы побоев. Похоже на расправу.' },
      solvability: 0.2, danger: 0.4, gangId: g.id, tags: ['informant'],
    } });
    trust(game, inf.districtId, -4);
  }
  addEvent(game, { districtId: inf.districtId, weight: 6, kind: 'police', text: inf.status === 'dead' ? `Источник «${inf.alias}» убит. Похоже, ${gn(g, 'people')} вычислили.` : `Источник «${inf.alias}» перестал выходить на связь: похоже, его раскрыли.` });
}
/** есть ли «крот» этой банды среди сотрудников, кто сейчас на смене или в наряде */
export function moleFor(game, gangId) {
  return (game.state.staff || []).find((o) => o.hidden && o.hidden.mole && o.hidden.gangId === gangId && o.status !== 'dead' && o.status !== 'fired' && o.status !== 'hospital') || null;
}
