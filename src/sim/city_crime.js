// Преступность города: темп по району и времени суток, учёт заявленного/латентного, вызовы «в процессе»,
// звонки и посетители дежурной части, ориентировки, пропавшие, утренние новости.
import { randomPerson, fullName } from '../core/names.js';
import { R, clamp, num, nid, absNow, dmOf, hourOf, minuteOfDay, calendar, emit, cap, sentence, lowerFirst, callDep, dep, safeCall, fmt, isNight, collective, badText } from './city_util.js';
import { DISTRICT_INFO, dForm, PERP_DESC } from './city_data.js';
import { C, dist, gang, activeGangs, crime as crimeById, liveTasks, addEvent, bump, dayD, infSum, maxInf, topGang, trust, placeLite, placePrep, gn } from './city_core.js';
import { radio, dispatchSay, dutySay, registerHandler, pick, say } from './city_radio.js';
import { T, CHOICE_LABEL } from './city_text.js';
import { addIntel } from './city_gangs.js';
import { leaderSeesCrime, leaderTakesCall, takeCall } from './city_leader.js';
import { autoTask } from './city_tasks.js';

const CRIMES_CAP = 200;
const HOUR_SHAPE = [1.0, 0.9, 0.8, 0.6, 0.4, 0.3, 0.4, 0.6, 0.8, 0.9, 1.0, 1.0, 1.0, 1.0, 1.0, 1.1, 1.2, 1.4, 1.6, 1.8, 1.9, 1.9, 1.7, 1.3];
const HOUR_SUM = HOUR_SHAPE.reduce((a, b) => a + b, 0);
// суточный ритм по категориям: ночью тяжелее, утром бытовуха и кражи (находят), вечером пьянки
const CAT_W = {
  night: { violent: 1.6, property: 1.3, organized: 1.7, drugs: 1.3, public_order: 0.9, domestic: 0.8, economic: 0.3, traffic: 0.9, other: 0.8 },
  morning: { violent: 0.5, property: 1.4, organized: 0.6, drugs: 0.6, public_order: 0.5, domestic: 1.3, economic: 1.2, traffic: 1.3, other: 1.0 },
  day: { violent: 0.7, property: 1.3, organized: 1.0, drugs: 0.9, public_order: 0.8, domestic: 0.8, economic: 1.5, traffic: 1.2, other: 1.0 },
  evening: { violent: 1.1, property: 1.0, organized: 1.0, drugs: 1.1, public_order: 1.7, domestic: 1.5, economic: 0.6, traffic: 1.0, other: 0.9 },
};
function bucket(h) { return h >= 23 || h < 6 ? 'night' : h < 11 ? 'morning' : h < 17 ? 'day' : 'evening'; }

/* ------------------------------------------------------------------ календарь: выходные и зарплата */
export function isPayday(game, dayN) {
  const c = C(game);
  return Array.isArray(c.paydays) && c.paydays.includes(dayN);
}
export function planPaydays(game) {
  // завод платит, когда есть деньги: раз-два в месяц, с задержками
  const rng = R(game);
  const c = C(game);
  const today = game.state.time ? game.state.time.day : 1;
  c.paydays = (c.paydays || []).filter((d) => d >= today - 1);
  const last = c.paydays.length ? Math.max(...c.paydays) : today - rng.int(5, 15);
  if (last < today + 3) c.paydays.push(Math.max(today + 1, last + rng.int(9, 20)));
}
function dayMul(game, now, d) {
  const dm = dmOf(now);
  const cal = calendar(game, dm.day);
  const h = hourOf(now);
  let m = [0.9, 0.95, 1, 1, 1.12, 1.25, 1.05][cal.wd];
  if (cal.wd === 4 && h >= 17) m *= 1.15; // пятница вечер
  if (cal.wd === 6 && h < 6) m *= 1.25;   // ночь на воскресенье
  const workers = d.id === 'promzona' || d.id === 'cheremushki' || d.id === 'chastnyi';
  const pd = isPayday(game, dm.day) && h >= 15 || isPayday(game, dm.day - 1) && h < 5;
  if (pd && workers) m *= 1.35;
  return m;
}

/* ------------------------------------------------------------------ темп */
export function crimeRate(game, d, now) {
  const h = hourOf(now);
  const daily = 1.2 + num(d.crime, 40) / 100 * 5.5;
  const gangMul = 1 + infSum(d) / 180;
  const pres = 1 - 0.35 * num(d.presence) / 100;
  const inst = 1 - 0.45 * clamp(num(d.cover), 0, 1);
  return daily * HOUR_SHAPE[h] / HOUR_SUM * dayMul(game, now, d) * gangMul * pres * inst;
}
export function tickCrimes(game, now) {
  const rng = R(game);
  for (const d of C(game).districts) {
    if (rng.next() < crimeRate(game, d, now)) spawnCrime(game, d, now);
  }
}

/* ------------------------------------------------------------------ нормализация */
export function normPerson(rng, p, gender) {
  const ok = p && typeof p === 'object' && p.lastName && p.firstName;
  return ok ? { gender: p.gender || 'm', firstName: p.firstName, lastName: p.lastName, patronymic: p.patronymic || '' } : randomPerson(rng, gender);
}
export function normalizeCrime(game, raw, d, now) {
  const rng = R(game);
  const cr = raw && typeof raw === 'object' ? raw : {};
  const t = dmOf(now);
  if (!cr.id) cr.id = nid(game, 'cr');
  cr.typeId = cr.typeId || 'unknown';
  cr.category = cr.category || 'other';
  cr.severity = clamp(Math.round(num(cr.severity, 2)), 1, 5);
  cr.title = typeof cr.title === 'string' && cr.title ? cr.title : 'Происшествие';
  cr.districtId = cr.districtId || (d && d.id) || 'centr';
  const dd = d || dist(game, cr.districtId);
  if (!cr.place || typeof cr.place !== 'object' || !cr.place.id) cr.place = dd && dd.places.length ? rng.pick(dd.places) : { id: 'street', name: 'улица', prep: 'на улице', kind: 'street', value: 1 };
  if (!cr.place.prep) cr.place = { ...cr.place, prep: placePrep(cr.place) };
  if (!Number.isFinite(cr.day)) cr.day = t.day;
  if (!Number.isFinite(cr.minute)) cr.minute = t.minute;
  cr.perps = (Array.isArray(cr.perps) ? cr.perps : []).map((p) => ({
    ...p, person: normPerson(rng, p && p.person, 'm'), age: num(p && p.age, rng.int(18, 45)),
    desc: (p && p.desc) || rng.pick(PERP_DESC.none), armed: (p && p.armed) || 'none', gangId: p && p.gangId !== undefined ? p.gangId : cr.gangId || null,
  }));
  cr.victims = (Array.isArray(cr.victims) ? cr.victims : []).map((v) => ({ ...v, person: normPerson(rng, v && v.person), age: num(v && v.age, 40), desc: (v && v.desc) || '', condition: (v && v.condition) || 'ok' }));
  cr.witnesses = Math.max(0, Math.round(num(cr.witnesses, rng.int(0, 3))));
  cr.evidence = Array.isArray(cr.evidence) ? cr.evidence.filter((x) => typeof x === 'string') : [];
  cr.loot = typeof cr.loot === 'string' ? cr.loot : null;
  const tx = cr.text && typeof cr.text === 'object' ? cr.text : {};
  const good = (s) => typeof s === 'string' && s.trim() && !badText(s);
  cr.text = {
    dispatch: good(tx.dispatch) ? tx.dispatch : `${lowerFirst(cr.title)} ${cr.place.prep}.`,
    caller: good(tx.caller) ? tx.caller : '',
    news: good(tx.news) ? tx.news : null,
    details: good(tx.details) ? tx.details : '',
  };
  cr.solvability = clamp(num(cr.solvability, 0.4), 0, 1);
  cr.danger = clamp(num(cr.danger, cr.severity / 5), 0, 1);
  cr.gangId = cr.gangId || null;
  cr.inProgress = !!cr.inProgress;
  cr.durationMin = num(cr.durationMin, cr.inProgress ? 10 + cr.severity * 6 : 0);
  cr.status = cr.status || 'new';
  cr.tags = Array.isArray(cr.tags) ? cr.tags : [];
  return cr;
}

/* ------------------------------------------------------------------ рождение преступления */
function genCrime(game, d, now, opts) {
  const rng = R(game);
  const f = dep(game, 'crimes', 'generateCrime');
  if (!f) return null;
  const dm = dmOf(now);
  const h = hourOf(now);
  const b = bucket(h);
  const cal = calendar(game, dm.day);
  const heat = clamp((num(d.crime) + maxInf(d)) / 200 + (isNight(now) ? 0.15 : 0), 0, 1);
  const ctx = {
    district: d, gangs: activeGangs(game), day: dm.day, minute: dm.minute, heat, typeId: opts.typeId, forceInProgress: opts.forceInProgress,
    hour: h, weekday: cal.wd, payday: isPayday(game, dm.day), presence: num(d.presence), trust: num(d.trust), timeOfDay: b,
  };
  let cr = null;
  for (let i = 0; i < 3; i++) {
    cr = safeCall('crimes.generateCrime', f, rng, ctx);
    if (!cr || opts.typeId) break;
    let w = CAT_W[b][cr.category] || 1;
    const sev = num(cr.severity, 2);
    w *= b === 'night' ? 0.7 + 0.15 * sev : b === 'morning' ? 1.2 - 0.1 * sev : 1;
    if (ctx.payday && (cr.category === 'domestic' || cr.category === 'public_order')) w *= 1.4;
    if ((cal.wd === 4 || cal.wd === 5) && b !== 'morning' && (cr.category === 'public_order' || cr.category === 'violent')) w *= 1.2;
    if (rng.chance(clamp(w / 1.9, 0.15, 1))) break;
  }
  return cr;
}

export function spawnCrime(game, d, now, opts = {}) {
  const rng = R(game);
  const c = C(game);
  const raw = genCrime(game, d, now, opts);
  if (!raw) return null;
  const cr = normalizeCrime(game, raw, d, now);
  // приписать банде, если похоже на её работу
  if (!cr.gangId && (cr.category === 'organized' || cr.category === 'drugs' || (cr.category === 'property' && cr.severity >= 3) || cr.category === 'economic')) {
    const gs = activeGangs(game);
    const s = gs.reduce((a, g) => a + num(d.influence[g.id]), 0);
    if (s > 0 && rng.chance(Math.min(0.85, s / 100))) {
      const g = rng.weighted(gs, (x) => num(d.influence[x.id]) * (cr.category === 'drugs' ? (x.type === 'drugs' ? 4 : 0.3) : 1));
      cr.gangId = g.id;
      for (const p of cr.perps) if (!p.gangId) p.gangId = g.id;
    }
  }
  // охраняемый объект: на него почти не суются
  const guard = liveTasks(game).find((t) => t.phase === 'active' && t.type === 'guard' && t.placeId && t.placeId === cr.place.id && cr.category !== 'domestic');
  if (guard && rng.chance(guard.orders.posture === 'hidden' ? 0.35 : 0.8)) {
    guard.results.crimesPrevented++;
    guard.rt.tally.deterred = num(guard.rt.tally.deterred) + 1;
    guard.rt.notes.push(`У объекта крутились подозрительные, при виде наряда ушли`);
    bump(game, 'prevented');
    return null;
  }
  if (cr.gangId) d.dayAcc.gangCrimes[cr.gangId] = num(d.dayAcc.gangCrimes[cr.gangId]) + cr.severity;
  bump(game, 'crimes', 1, d.id);
  d.dayAcc.crimes++;
  d.stats.crimes = num(d.stats.crimes) + 1;
  d.stats.today = num(d.stats.today) + 1;
  if (cr.severity >= 4) bump(game, 'severe', 1, d.id);
  if (cr.victims.some((v) => v.condition === 'dead')) bump(game, 'murders');
  // заявят ли?
  const dead = cr.victims.some((v) => v.condition === 'dead');
  const pRep = cr.inProgress ? 0.5 + num(d.trust) / 100 * 0.45 : 0.3 + num(d.trust) / 100 * 0.55 + cr.severity * 0.06 + (dead ? 0.5 : 0);
  if (!opts.forceReport && !rng.chance(clamp(pRep, 0, 1))) {
    bump(game, 'latent', 1, d.id);
    d.dayAcc.latent = num(d.dayAcc.latent) + 1;
    return null;
  }
  const source = cr.inProgress ? 'dispatch' : rng.chance(0.3) ? 'call' : rng.chance(0.3) ? 'visitor' : 'report';
  registerCrime(game, cr, source);
  if (cr.inProgress) handleLive(game, cr, now);
  else afterReport(game, cr, source, now);
  return cr;
}

export function registerCrime(game, cr, source) {
  const c = C(game);
  cr.reported = true;
  cr.source = source;
  cr.reportedAt = absNow(game);
  c.crimes.push(cr);
  if (c.crimes.length > CRIMES_CAP) pruneCrimes(game);
  if (cr.severity >= 3 || cr.victims.some((v) => v.condition === 'dead')) {
    addEvent(game, { districtId: cr.districtId, weight: cr.severity + (cr.victims.some((v) => v.condition === 'dead') ? 3 : 0), kind: 'crime', crimeId: cr.id, text: crimeLine(game, cr), detail: cr.text.details || null });
  }
  emit(game, 'crime:new', { crime: cr });
  return cr;
}
export function crimeLine(game, cr) {
  const dm = { day: cr.day, minute: cr.minute };
  const hh = String(Math.floor(dm.minute / 60)).padStart(2, '0') + ':' + String(dm.minute % 60).padStart(2, '0');
  const dead = cr.victims.filter((v) => v.condition === 'dead').length;
  const hurt = cr.victims.filter((v) => v.condition === 'serious' || v.condition === 'injured').length;
  let tail = '';
  if (dead) tail = dead === 1 ? ' Есть погибший.' : ` Погибших — ${dead}.`;
  else if (hurt) tail = hurt === 1 ? ' Пострадавший госпитализирован.' : ` Пострадавших — ${hurt}.`;
  if (cr.loot) tail += ` Похищено: ${cr.loot}.`;
  return `${hh} — ${cap(cr.title)} ${cr.place.prep}.${tail}`.replace(/\.\./g, '.');
}
function pruneCrimes(game) {
  const c = C(game);
  const busy = new Set();
  for (const t of liveTasks(game)) if (t.targetCrimeId) busy.add(t.targetCrimeId);
  for (const id of c.live) busy.add(id);
  // сначала — раскрытые и старые мелкие
  const score = (cr) => (cr.status === 'resolved' ? 0 : cr.status === 'unsolved' ? 1 : 2) * 1000 + cr.severity * 100 + (cr.day * 1440 + cr.minute) / 1e4;
  const cand = c.crimes.filter((x) => !busy.has(x.id)).sort((a, b) => score(a) - score(b));
  const drop = new Set(cand.slice(0, c.crimes.length - CRIMES_CAP + 10).map((x) => x.id));
  c.crimes = c.crimes.filter((x) => !drop.has(x.id));
}

/* ------------------------------------------------------------------ заявления, звонки, посетители */
function afterReport(game, cr, source, now) {
  const rng = R(game);
  const d = dist(game, cr.districtId);
  if (source === 'call') {
    const call = callDep(game, 'crimes', 'generateCall', rng, { district: d, gangs: activeGangs(game), day: cr.day, minute: cr.minute, crime: cr, heat: num(d.crime) / 100 });
    if (call && typeof call === 'object') { call.crime = cr; bump(game, 'calls'); emit(game, 'call:incoming', { call }); }
  } else if (source === 'visitor') {
    const h = hourOf(now);
    const at = h >= 8 && h < 20 ? now + rng.int(20, 120) : now + ((8 - h + 24) % 24) * 60 + rng.int(10, 180);
    C(game).schedule.push({ at, kind: 'visitor', crimeId: cr.id, districtId: cr.districtId });
  }
  // тяжкое — Гранит требует опергруппу
  if (cr.severity >= 4) {
    const opers = availableCount(game, ['oper']);
    const msg = radio(game, {
      from: 'dispatch', fromName: 'Дежурный по городу', callsign: 'Гранит', kind: 'request',
      text: fmt(pick(game, T.dispatchInfo), { Prep: cap(dForm(cr.districtId, 'prep')), prep: dForm(cr.districtId, 'prep'), dispatch: sentence(cr.text.dispatch) }),
      choices: [{ id: 'send_oper', label: opers ? 'Отправить опера' : 'Отправить опера (свободных нет)' }, { id: 'later', label: 'Позже' }],
      autoChoice: 'later', expires: dmOf(now + 30), meta: { type: 'oper', crimeId: cr.id },
    });
    return msg;
  }
  return null;
}
export function availableCount(game, roles = null) {
  const f = dep(game, 'staff', 'available');
  let list = f ? safeCall('staff.available', f, game) : null;
  if (!Array.isArray(list)) list = (game.state.staff || []).filter((o) => o.status === 'station' && o.onShift !== false);
  return list.filter((o) => o.role !== 'duty' && (!roles || roles.includes(o.role))).length;
}

/* ------------------------------------------------------------------ «в процессе»: вызов */
function handleLive(game, cr, now) {
  const rng = R(game);
  const c = C(game);
  cr.endsAt = now + clamp(Math.round(num(cr.durationMin, 20)), 5, 120);
  c.live.push(cr.id);
  const here = liveTasks(game).filter((t) => t.phase === 'active' && t.districtId === cr.districtId && !t.rt.enc && !t.rt.sub);
  // наряд оказался рядом
  for (const t of rng.shuffle(here)) {
    let p = 0.06;
    if (t.type === 'patrol') p = t.orders.focus === 'stealth' ? 0.35 : t.orders.route === 'car' ? 0.3 : 0.22;
    if (t.type === 'guard') p = t.placeId === cr.place.id ? 0.95 : 0.06;
    if (t.type === 'search' || t.type === 'investigate') p = 0.08;
    if (rng.chance(p)) { cr.status = 'responding'; cr.assignedTaskId = t.id; leaderSeesCrime(game, t, cr); return; }
  }
  bump(game, 'calls');
  const disp = sentence(cr.text.dispatch);
  // патруль в районе сам берёт вызов
  for (const t of here) {
    if (t.type !== 'patrol' || !t.orders.respondCalls) continue;
    if (leaderTakesCall(game, t, cr)) {
      dispatchSay(game, fmt(pick(game, T.dispatchCall), { Prep: cap(dForm(cr.districtId, 'prep')), dispatch: disp }), 'info');
      bump(game, 'callsAnswered');
      takeCall(game, t, cr);
      return;
    }
  }
  if (cr.severity <= 1) {
    dispatchSay(game, `Гранит, для сведения: ${dForm(cr.districtId, 'prep')} ${lowerFirst(disp)}`, 'info');
    return;
  }
  // решение за игроком
  const choices = [];
  if (availableCount(game)) choices.push({ id: 'send_station', label: CHOICE_LABEL.send_station });
  for (const t of liveTasks(game).filter((x) => x.phase === 'active' && (x.type === 'patrol' || x.type === 'guard') && !x.rt.enc && !x.rt.sub).slice(0, 2)) {
    choices.push({ id: 'redirect:' + t.id, label: `Перенаправить ${t.rt.callsign} (${dForm(t.districtId, 'nom')})` });
  }
  choices.push({ id: 'ignore', label: CHOICE_LABEL.ignore });
  const ttl = clamp(cr.endsAt - now - 2, 3, 10);
  const viaPhone = rng.chance(0.35);
  let text;
  if (viaPhone) {
    const call = callDep(game, 'crimes', 'generateCall', rng, { district: dist(game, cr.districtId), gangs: activeGangs(game), day: cr.day, minute: cr.minute, crime: cr, heat: 0.5 });
    if (call && typeof call === 'object') { call.crime = cr; emit(game, 'call:incoming', { call }); }
    const caller = call && typeof call.callerDesc === 'string' && !badText(call.callerDesc) ? sentence(call.callerDesc) : '';
    text = fmt(pick(game, T.dutyCall), { caller, dispatch: disp, prep: dForm(cr.districtId, 'prep') });
  } else {
    text = fmt(pick(game, T.dispatchCall), { Prep: cap(dForm(cr.districtId, 'prep')), dispatch: disp });
  }
  const msg = { kind: 'request', text, choices, autoChoice: 'ignore', expires: dmOf(now + ttl), meta: { type: 'call', crimeId: cr.id } };
  if (viaPhone) dutySay(game, text, 'request', msg); else dispatchSay(game, text, 'request', msg);
}

/** истекшие «в процессе» — никто не приехал */
export function expireLive(game, now) {
  const c = C(game);
  if (!c.live.length) return;
  c.live = c.live.filter((id) => {
    const cr = crimeById(game, id);
    if (!cr) return false;
    if (now < num(cr.endsAt, now)) return true;
    cr.inProgress = false;
    if (cr.status === 'new') {
      cr.status = 'unsolved';
      const d = dist(game, cr.districtId);
      if (d) d.dayAcc.ignored++;
      bump(game, 'callsIgnored');
      trust(game, cr.districtId, -0.4 * cr.severity);
      if (cr.severity >= 3) addEvent(game, { districtId: cr.districtId, weight: cr.severity, kind: 'ignored', crimeId: cr.id, text: `${cap(cr.title)} ${cr.place.prep}: наряд не выезжал — некого было послать. Преступники скрылись.` });
    }
    return false;
  });
}

/* ------------------------------------------------------------------ свои преступления (разборки, расправы, пропажи) */
export function ownCrime(game, spec, opts = {}) {
  const d = dist(game, spec.districtId);
  const cr = normalizeCrime(game, { ...spec }, d, absNow(game));
  bump(game, 'crimes', 1, cr.districtId);
  if (d) { d.dayAcc.crimes++; d.stats.crimes = num(d.stats.crimes) + 1; d.stats.today = num(d.stats.today) + 1; }
  if (cr.severity >= 4) bump(game, 'severe', 1, cr.districtId);
  if (cr.victims.some((v) => v.condition === 'dead')) bump(game, 'murders');
  if (opts.report === false) { bump(game, 'latent', 1, cr.districtId); return cr; }
  registerCrime(game, cr, opts.source || 'report');
  if (opts.dispatch !== false && cr.severity >= 4) afterReport(game, cr, 'report', absNow(game));
  return cr;
}

/* ------------------------------------------------------------------ каждый час: посетители, эфир, ориентировки, пропавшие */
export function hourlyCity(game, now) {
  const rng = R(game);
  const c = C(game);
  const h = hourOf(now);
  const avgTrust = c.districts.reduce((s, d) => s + num(d.trust), 0) / c.districts.length;
  // посетитель «с улицы» (жалобы, заявления, свои дела)
  if (h >= 9 && h <= 20 && rng.chance(0.22 * (0.5 + avgTrust / 100))) c.schedule.push({ at: now + rng.int(1, 55), kind: 'visitor', districtId: rng.pick(c.districts).id });
  // разговорный эфир
  const busy = liveTasks(game).filter((t) => t.phase === 'active');
  if (rng.chance(busy.length ? 0.3 : 0.08)) chatter(game, busy);
  // ориентировка
  if ((h === 9 || h === 21) && rng.chance(0.35)) orientir(game);
  // пропал человек
  if (rng.chance(0.022)) missingCase(game, now);
  for (const cr of c.crimes) if (cr.missing && cr.status !== 'resolved') evolveMissing(game, cr, now);
}

function chatter(game, busy) {
  const rng = R(game);
  const t = busy.length ? rng.pick(busy) : null;
  const ext = callDep(game, 'crimes', 'chatter', rng, { day: dmOf(absNow(game)).day, minute: dmOf(absNow(game)).minute, gangs: activeGangs(game), tasks: busy.length });
  const g = rng.pick(activeGangs(game));
  const vars = { cs: t ? t.rt.callsign : 'Сокол-2', street: rng.pick(['Вокзальной', 'Ленина', 'Заводской', 'Мира', 'Советской', 'Строителей']), nick: g ? g.leader.nick : 'Шайба', gangGen: g ? gn(g, 'peopleGen') : 'рыночных', veh: 'второй УАЗ' };
  const text = typeof ext === 'string' && ext.trim() && !badText(ext) && rng.chance(0.6) ? ext : fmt(rng.pick(T.chatter), vars);
  radio(game, { from: 'unknown', fromName: 'Эфир', callsign: '', text, kind: 'chatter' });
}

function orientir(game) {
  const rng = R(game);
  const c = C(game);
  const cand = c.crimes.filter((x) => x.status !== 'resolved' && x.severity >= 3 && x.perps.length && !x.wanted && !x.missing);
  if (!cand.length) return;
  const cr = rng.pick(cand);
  const p = cr.perps[0];
  cr.wanted = true;
  const ageTxt = `${p.age} ${p.age % 10 === 1 && p.age !== 11 ? 'год' : [2, 3, 4].includes(p.age % 10) && ![12, 13, 14].includes(p.age) ? 'года' : 'лет'}`;
  const text = fmt(T.orientir, { name: fullName(p.person), age: ageTxt, desc: p.desc, title: cr.title });
  dispatchSay(game, text, 'info');
  addIntel(game, { kind: 'wanted', crimeId: cr.id, districtId: null, gangId: p.gangId || null, text: `Ориентировка: ${fullName(p.person)}, ${ageTxt}, ${p.desc}. По делу: ${cr.title}.`, reliability: 1, source: 'dispatch', expires: absNow(game) + 5 * 1440, data: { perpIndex: 0 } });
}

/* ------------------------------------------------------------------ пропавшие */
const MISSING_KINDS = [
  { w: 3, who: 'child', fates: { lost: 35, friend: 30, ran_away: 15, accident: 10, dead: 5, kidnapped: 5 } },
  { w: 2, who: 'elder', fates: { lost: 50, hospital: 20, dead: 20, friend: 10 } },
  { w: 3, who: 'man', fates: { drunk_friend: 40, hospital: 15, kidnapped: 15, dead: 15, ran_away: 15 } },
  { w: 2, who: 'girl', fates: { friend: 40, ran_away: 30, hospital: 10, kidnapped: 10, dead: 10 } },
];
export function missingCase(game, now) {
  const rng = R(game);
  const c = C(game);
  if (c.crimes.filter((x) => x.missing && x.status !== 'resolved').length >= 3) return null;
  const d = rng.weighted(c.districts, (x) => (x.id === 'cheremushki' ? 3 : x.id === 'chastnyi' ? 2 : 1));
  const k = rng.weighted(MISSING_KINDS, (x) => x.w);
  const gender = k.who === 'girl' ? 'f' : k.who === 'elder' ? (rng.chance(0.5) ? 'f' : 'm') : k.who === 'child' ? (rng.chance(0.5) ? 'f' : 'm') : 'm';
  const person = randomPerson(rng, gender);
  const age = k.who === 'child' ? rng.int(6, 12) : k.who === 'elder' ? rng.int(68, 84) : k.who === 'girl' ? rng.int(14, 17) : rng.int(28, 50);
  const fate = rng.weighted(Object.entries(k.fates), (x) => x[1])[0];
  const pl = rng.pick(d.places);
  const f = gender === 'f';
  const who = k.who === 'child' ? (f ? `дочь, ${age} лет` : `сын, ${age} лет`) : k.who === 'elder' ? (f ? `мать, ${age} лет, память плохая` : `отец, ${age} лет, после инсульта`) : k.who === 'girl' ? `дочь, ${age} лет` : `муж, ${age} лет`;
  const reporter = k.who === 'man' ? 'жена' : k.who === 'elder' ? (rng.chance(0.5) ? 'дочь' : 'сын') : 'мать';
  const lastSeen = k.who === 'child' ? `ушёл в школу и не вернулся`.replace('ушёл', f ? 'ушла' : 'ушёл').replace('вернулся', f ? 'вернулась' : 'вернулся')
    : k.who === 'elder' ? (f ? 'вышла в магазин в халате и пропала' : 'вышел за хлебом и пропал')
      : k.who === 'girl' ? 'ушла вечером «к подруге», телефон у подруги не отвечает'
        : rng.pick(['поехал отдавать долг и пропал', 'ушёл с получкой и не вернулся', 'поехал «по делам» на Рынок и пропал']);
  const title = k.who === 'child' ? 'Пропал ребёнок' : 'Пропал человек';
  const spec = {
    typeId: 'missing_person', category: 'other', severity: k.who === 'child' ? 4 : 3, title, districtId: d.id, place: pl,
    perps: [], victims: [{ person, age, desc: who, condition: 'ok' }], witnesses: rng.int(0, 2), evidence: ['фотография'],
    text: { dispatch: `заявление о пропаже: ${who}, ${lastSeen}.`, caller: `Заявитель — ${reporter}.`, news: null, details: `Последний раз видели ${pl.prep}.` },
    solvability: 0.6, danger: fate === 'kidnapped' ? 0.6 : 0.1, gangId: null, tags: ['missing'],
    missing: { who: k.who, person, age, gender, fate, since: now, reporter, lastSeen, returnAt: ['friend', 'drunk_friend', 'ran_away'].includes(fate) ? now + rng.int(12, 60) * 60 : null },
  };
  if (fate === 'kidnapped') {
    const g = topGang(game, d, 5) || rng.pick(activeGangs(game));
    if (g) { spec.gangId = g.id; spec.missing.gangId = g.id; }
  }
  const cr = ownCrime(game, spec, { source: 'visitor', dispatch: false });
  const pron = f ? 'её' : 'его';
  dutySay(game, `Товарищ майор, в дежурке ${reporter === 'мать' || reporter === 'жена' || reporter === 'дочь' ? 'женщина, плачет' : 'мужчина, весь серый'}: ${who}, ${lastSeen}. Искать ${pron} будем?`, 'request', {
    choices: [{ id: 'search_now', label: CHOICE_LABEL.search_now }, { id: 'later', label: 'Принять заявление, искать позже' }],
    autoChoice: 'later', expires: dmOf(now + 20), meta: { type: 'missing', crimeId: cr.id },
  });
  return cr;
}
function evolveMissing(game, cr, now) {
  const rng = R(game);
  const m = cr.missing;
  if (m.returnAt && now >= m.returnAt && cr.status !== 'resolved') {
    cr.status = 'resolved';
    cr.selfResolved = true;
    const f = m.gender === 'f';
    addEvent(game, { districtId: cr.districtId, weight: 2, kind: 'crime', crimeId: cr.id, text: `${m.person.firstName} ${m.person.lastName}, ${m.age}, ${f ? 'вернулась' : 'вернулся'} домой ${f ? 'сама' : 'сам'}${m.fate === 'drunk_friend' ? ' — неделю гулял у знакомого' : m.fate === 'ran_away' ? ' — ' + (f ? 'сбегала' : 'сбегал') + ' из дома' : ''}. Розыск прекращён.` });
    return;
  }
  const age = now - m.since;
  if ((m.fate === 'lost' || m.fate === 'accident') && age > 18 * 60 && rng.chance(0.03)) m.fate = 'dead';
  if (m.fate === 'kidnapped' && age > 48 * 60 && rng.chance(0.02)) m.fate = 'dead';
}

/* ------------------------------------------------------------------ посетитель */
export function fireVisitor(game, ev) {
  const rng = R(game);
  const c = C(game);
  const d = dist(game, ev.districtId) || rng.pick(c.districts);
  const cr = ev.crimeId ? crimeById(game, ev.crimeId) : null;
  const now = absNow(game);
  const recent = c.crimes.filter((x) => x.districtId === d.id && now - (x.day * 1440 + x.minute - 1440) < 2880).slice(-5);
  const plans = Array.isArray(game.state.attackPlans) ? game.state.attackPlans.filter((p) => !p.done && !p.resolved) : [];
  const scout = plans.length && rng.chance(0.25) ? plans[0].gangId : null;
  const ctx = { day: dmOf(now).day, minute: dmOf(now).minute, district: d, gangs: activeGangs(game), trust: d.trust, recentCrimes: recent, crime: cr, scoutGangId: scout, fake: !!scout };
  const v = callDep(game, 'crimes', 'generateVisitor', rng, ctx);
  if (!v || typeof v !== 'object') return;
  if (cr) v.crime = cr;
  else if (v.crime && !v.isFake) {
    const ncr = normalizeCrime(game, v.crime, d, now);
    if (!crimeById(game, ncr.id)) {
      bump(game, 'crimes', 1, d.id); d.dayAcc.crimes++;
      registerCrime(game, ncr, 'visitor');
      v.crime = ncr;
    }
  }
  if (scout) { v.scoutGangId = scout; v.isFake = true; }
  emit(game, 'visitor:arrive', { visitor: v });
}

/* ------------------------------------------------------------------ новости */
export function morningNews(game) {
  const rng = R(game);
  const c = C(game);
  const now = absNow(game);
  const recent = c.crimes.filter((x) => now - (x.day - 1) * 1440 - x.minute < 1500).sort((a, b) => b.severity - a.severity).slice(0, 12);
  const news = callDep(game, 'crimes', 'generateNews', rng, { day: dmOf(now).day, city: { districts: c.districts.map((d) => ({ id: d.id, name: d.name, crime: d.crime, trust: d.trust })), authority: num((game.state.flags || {}).authority, 50) }, recentCrimes: recent, gangs: activeGangs(game) });
  const list = Array.isArray(news) ? news.filter((n) => n && typeof n.title === 'string' && !badText(n.title) && !badText(n.text || '')) : [];
  for (const n of list) n.day = dmOf(now).day;
  c.news = c.news.concat(list).slice(-30);
  return list;
}

/* ------------------------------------------------------------------ ответы на запросы дежурного/Гранита */
registerHandler('call', (game, msg, choice, auto) => {
  const cr = crimeById(game, msg.meta.crimeId);
  if (!cr || cr.status !== 'new' || !cr.inProgress) return;
  if (choice === 'send_station') {
    const r = autoTask(game, 'respond', { districtId: cr.districtId, targetCrimeId: cr.id, n: cr.severity >= 4 ? 3 : 2 });
    if (!r.ok) dutySay(game, `Товарищ майор, отправить некого: ${r.reason}.`, 'info');
    else bump(game, 'callsAnswered');
  } else if (choice.startsWith('redirect:')) {
    const t = C(game).tasks.find((x) => x.id === choice.slice(9));
    if (t && t.phase === 'active' && !t.rt.enc && !t.rt.sub) { say(game, t, `${t.rt.callsign} принял{/а}, выдвигаемся ${dForm(cr.districtId, 'to')}.`); takeCall(game, t, cr); bump(game, 'callsAnswered'); }
  } else if (!auto) {
    dispatchSay(game, `Гранит понял: у Зари людей нет. Ищем у соседей.`, 'info');
  }
});
registerHandler('oper', (game, msg, choice) => {
  const cr = crimeById(game, msg.meta.crimeId);
  if (!cr || choice !== 'send_oper' || cr.status === 'resolved') return;
  const r = autoTask(game, 'investigate', { districtId: cr.districtId, targetCrimeId: cr.id, n: 1, roles: ['oper', 'uchastkovy'] });
  if (!r.ok) dutySay(game, `Товарищ майор, свободных оперов нет: ${r.reason}.`, 'info');
});
registerHandler('missing', (game, msg, choice) => {
  const cr = crimeById(game, msg.meta.crimeId);
  if (!cr || choice !== 'search_now' || cr.status === 'resolved') return;
  const r = autoTask(game, 'search', { districtId: cr.districtId, targetCrimeId: cr.id, n: 2, roles: ['kinolog', 'uchastkovy', 'pps'] });
  if (!r.ok) dutySay(game, `Товарищ майор, искать некому: ${r.reason}.`, 'info');
});
