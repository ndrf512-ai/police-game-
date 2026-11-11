// Город: сборка подсистем (районы, банды, преступления, наряды, эфир) в один объект `city` по контракту.
import { clamp, num, absNow, dmOf, hourOf, minuteOfDay, shiftOf, R, nid, safeCall, emit, glog, cap, calendar, dateStr as cityDate, WEEKDAYS, staffList } from './city_util.js';
import { C, dist, gang, activeGangs, liveTasks, newDayStats, districtShiftReset, authority as addAuthority, reputation as addReputation, trust as addTrust, staffMorale, isHonest, infSum, topGang, bump } from './city_core.js';
import { PRESENCE_W, FOCUS_PRESENCE, WEATHER, dForm } from './city_data.js';
import { createGangs, cityDaily, planClashes, resolveClash, considerAttacks, launchAttack, fireWarning, informantsDaily, fireTip, revealIntel, gangIntel, addInformant, gangHit, addIntel } from './city_gangs.js';
import { tickCrimes, hourlyCity, expireLive, planPaydays, fireVisitor, morningNews, ownCrime, spawnCrime } from './city_crime.js';
import { radio, answerRadio, expireRadio, dutySay, dispatchSay } from './city_radio.js';
import { taskTypes, createTask, cancelTask, onDeparted, onReturned, stepTask, validTargets, estimate, autoTask } from './city_tasks.js';
import { gangOp, hearClash } from './city_leader.js';

const START = { y: 1996, m: 10, d: 14 };
const safe = (key, f, ...a) => safeCall('city.' + key, f, ...a);

/* ------------------------------------------------------------------ присутствие милиции */
function presenceTick(game, dtMin) {
  const c = C(game);
  const acc = {}; const cov = {};
  for (const t of liveTasks(game)) {
    if (t.phase !== 'active') continue;
    const n = (t.officerIds || []).filter((id) => !(t.rt && t.rt.out && t.rt.out[id])).length; if (!n) continue;
    const w = (PRESENCE_W[t.type] ?? 0.3) * (FOCUS_PRESENCE[t.orders?.focus] ?? 1) * Math.pow(n, 0.8) * 14 * (t.vehicle ? 1.2 : 1);
    acc[t.districtId] = (acc[t.districtId] || 0) + w;
    if (t.type === 'guard') cov[t.districtId] = (cov[t.districtId] || 0) + 0.25 + 0.12 * n; else if (t.type === 'ambush') cov[t.districtId] = (cov[t.districtId] || 0) + 0.1;
  }
  for (const d of c.districts) {
    d.presence = Math.round(clamp(acc[d.id] || 0, 0, 100) * 10) / 10; d.cover = clamp(cov[d.id] || 0, 0, 1);
    if (!d.dayAcc) districtShiftReset(d);
    d.dayAcc.presenceSum += d.presence * dtMin; d.dayAcc.minutes += dtMin;
  }
}

/* ------------------------------------------------------------------ предложения (взятки, «крыша», начальство) */
function pushOffer(game, o) {
  const c = C(game); const t = game.state.time;
  const offer = { id: nid(game, 'of'), day: t.day, minute: Math.floor(t.minute), answered: null, result: null, expires: { day: t.day + 1, minute: 480 }, data: {}, ...o };
  c.offers.push(offer); if (c.offers.length > 30) c.offers.splice(0, c.offers.length - 30);
  emit(game, 'offer', { offer }); glog(game, `Предложение: ${offer.title}.`, 'offer');
  return offer;
}
function offersDaily(game) {
  const rng = R(game); const c = C(game); const day = game.state.time.day; const f = game.state.flags || (game.state.flags = {});
  if (c.offers.some((o) => !o.answered)) return;
  if (day < 2 || !rng.chance(0.42)) return;
  const kinds = [];
  const gs = activeGangs(game).filter((g) => g.strength > 20);
  if (gs.length) kinds.push('gang_bribe', 'gang_bribe');
  kinds.push('roof', 'quota', 'sponsor');
  if (num(f.authority, 50) < 40) kinds.push('quota');
  const kind = rng.pick(kinds);
  if (kind === 'gang_bribe') {
    const g = rng.pick(gs); const dId = g.base[0]; const d = dist(game, dId); const sum = rng.pick([300, 400, 500, 700]);
    pushOffer(game, { kind, from: `«${g.name}»`, title: 'Конверт от уважаемых людей', data: { gangId: g.id, districtId: dId, sum },
      text: `В дежурку зашёл вежливый молодой человек в кожаной куртке и оставил конверт «для начальника лично». В конверте — ${sum} тысяч и записка: «Товарищ майор, ${dForm(dId, 'prep')} у нас всё спокойно. Незачем ребятам зря бензин жечь. Недельку отдохните — будет ещё столько же». Все знают, что ${d ? d.name : 'этот район'} держат «${g.name}».`,
      choices: [{ id: 'take', label: `Взять и неделю не посылать наряды ${dForm(dId, 'to')}`, desc: `+${sum} тыс. сейчас и столько же через неделю. Банда окрепнет. Честные сотрудники узнают` }, { id: 'take_cheat', label: 'Взять — и работать как работали', desc: 'Деньги останутся. Банда очень обидится' }, { id: 'refuse', label: 'Вернуть конверт', desc: 'Банда запомнит' }, { id: 'report', label: 'Оформить как попытку дачи взятки', desc: 'Авторитет у начальства +. Банда обозлится' }] });
  } else if (kind === 'roof') {
    const d = rng.pick(c.districts); const sum = rng.pick([150, 200, 250]);
    pushOffer(game, { kind, from: 'коммерсант', title: 'Просьба об «охране»', data: { districtId: d.id, sum },
      text: `Владелец трёх ларьков и кафе ${dForm(d.id, 'prep')} просит о встрече. «Товарищ майор, мне всё равно кому-то платить. Бандитам — ${sum * 2}. Вам буду платить ${sum} в неделю, а ваши ребята пусть заезжают ко мне раз в день. Все так делают. Вам же людей кормить нечем».`,
      choices: [{ id: 'accept', label: 'Согласиться', desc: `+${sum} тыс. в неделю. Это и есть «крыша». Репутация −, банда района злится` }, { id: 'legal', label: '«Пишите заявление — возьмём вымогателей с поличным»', desc: 'Наводка на рэкет. Риск' }, { id: 'refuse', label: 'Отказать' }] });
  } else if (kind === 'quota') {
    pushOffer(game, { kind, from: 'ГУВД', title: 'Звонок из управления', data: {},
      text: `Звонил заместитель начальника ГУВД. «Майор, у тебя раскрываемость — как у сельского участкового. К концу недели жду цифры. Как ты их сделаешь — мне без разницы. Бомжей оформи, отказные напиши. Все так делают». Трубку положил, не дожидаясь ответа.`,
      choices: [{ id: 'pad', label: 'Сделать цифры: отказные, «явки с повинной»', desc: 'Авторитет ++. Доверие людей −, честные сотрудники увидят' }, { id: 'honest', label: 'Работать как есть', desc: 'Авторитет −' }, { id: 'push', label: 'Выжать из людей всё: переработки, выходные', desc: 'Раскрытий больше, усталость и мораль хуже' }] });
  } else if (kind === 'sponsor') {
    pushOffer(game, { kind, from: 'директор завода', title: 'Шефская помощь', data: {},
      text: `Директор «Химмаша» предлагает «шефскую помощь»: двести литров бензина и ящик тушёнки для личного состава. Взамен просит, чтобы наряд почаще стоял у заводоуправления — рабочие четвёртый месяц без зарплаты и «настроения нехорошие».`,
      choices: [{ id: 'accept', label: 'Принять помощь', desc: '+бензин, мораль +. Но вы теперь охраняете директора от его же рабочих' }, { id: 'refuse', label: 'Отказаться' }] });
  }
}
function answerOffer(game, offerId, choiceId) {
  const c = C(game); const o = c.offers.find((x) => x.id === offerId); if (!o || o.answered) return { ok: false, text: 'Предложение уже неактуально.' };
  const f = game.state.flags || (game.state.flags = {}); const econ = game.state.economy; const day = game.state.time.day; const rng = R(game);
  const money = (n, why) => { if (game.sim?.economy?.addMoney) safe('addMoney', () => game.sim.economy.addMoney(game, n, why)); else if (econ) econ.money += n; };
  const honest = (d) => staffMorale(game, isHonest, d, 'решения начальника');
  let text = 'Принято.';
  o.answered = choiceId || 'none';
  const g = gang(game, o.data.gangId); const d = dist(game, o.data.districtId);
  switch (o.kind) {
    case 'gang_bribe':
      if (choiceId === 'take') { money(o.data.sum, 'конверт'); f.noPatrol = f.noPatrol || {}; f.noPatrol[o.data.districtId] = { until: day + 7, gangId: o.data.gangId, sum: o.data.sum }; honest(-6); addReputation(game, -3); if (g) g.anger = clamp(g.anger - 15, 0, 100); f.corruption = num(f.corruption) + 2; text = `Конверт лёг в сейф. Неделю наряды ${dForm(o.data.districtId, 'to')} не ездят. К вечеру об этом знало всё отделение.`; }
      else if (choiceId === 'take_cheat') { money(o.data.sum, 'конверт'); if (g) g.anger = clamp(g.anger + 30, 0, 100); f.corruption = num(f.corruption) + 1; honest(-2); text = 'Деньги вы взяли. Наряды поехали как обычно. Вежливый молодой человек больше не улыбается.'; }
      else if (choiceId === 'report') { addAuthority(game, 4, 'оформил попытку дачи взятки'); if (g) g.anger = clamp(g.anger + 18, 0, 100); honest(4); text = 'Конверт ушёл в прокуратуру вместе с рапортом. В управлении удивились. На районе — тоже.'; }
      else { if (g) g.anger = clamp(g.anger + 8, 0, 100); honest(2); text = 'Конверт вернули тем же курьером. Он пожал плечами: «Как знаете».'; }
      break;
    case 'roof':
      if (choiceId === 'accept') { f.roofs = (f.roofs || []).concat({ districtId: o.data.districtId, sum: o.data.sum, since: day }); money(o.data.sum, '«охрана» коммерсанта'); addReputation(game, -4); honest(-5); f.corruption = num(f.corruption) + 2; const tg = d ? topGang(game, d) : null; if (tg) tg.anger = clamp(tg.anger + 10, 0, 100); text = `Теперь отделение получает ${o.data.sum} тысяч в неделю. В ведомости это называется «спонсорская помощь».`; }
      else if (choiceId === 'legal') { const tg = d ? topGang(game, d) : null; if (tg) { safe('gangIntel', gangIntel, game, tg, { revealed: true, source: 'statement', reliability: 0.8, kinds: ['racket', 'hideout'] }); tg.anger = clamp(tg.anger + 5, 0, 100); } addTrust(game, o.data.districtId, 2); text = 'Коммерсант долго мялся, но заявление написал. Есть время и место следующего «сбора».'; }
      else { text = 'Коммерсант вздохнул и ушёл платить бандитам.'; addTrust(game, o.data.districtId, -1); }
      break;
    case 'quota':
      if (choiceId === 'pad') { addAuthority(game, 7, 'показатели выросли'); honest(-6); for (const x of c.districts) x.trust = clamp(x.trust - 1.5, 0, 100); f.padded = num(f.padded) + 1; text = 'К пятнице раскрываемость выросла на двадцать процентов. Трое бомжей «сознались» в кражах, которых не помнят. В управлении довольны.'; }
      else if (choiceId === 'push') { for (const s of staffList(game)) if (s.status === 'station' || s.status === 'task') { s.fatigue = clamp(num(s.fatigue) + 18, 0, 100); s.morale = clamp(num(s.morale, 60) - 5, 0, 100); } addAuthority(game, 3, 'личный состав работает на износ'); f.pushWeek = day + 5; text = 'Отгулы отменены. Опера ночуют в кабинете. Цифры пойдут — вопрос, какой ценой.'; }
      else { addAuthority(game, -5, 'показатели не выросли'); honest(3); text = 'Вы ничего не стали рисовать. В управлении это запомнили. В отделении — тоже.'; }
      break;
    case 'sponsor':
      if (choiceId === 'accept') { if (econ) { econ.fuel = num(econ.fuel) + 200; for (const v of econ.vehicles || []) v.fuel = Math.min(v.maxFuel || 78, num(v.fuel) + 40); } staffMorale(game, null, 3, 'тушёнка от шефов'); f.sponsorPlant = day + 10; addTrust(game, 'promzona', -2); text = 'Бензин слили в бочку, тушёнку разделили по сменам. Рабочие у проходной смотрят на ваш УАЗ без симпатии.'; }
      else { addTrust(game, 'promzona', 1); text = 'Вы отказались. Директор обиделся и позвонил в управление.'; addAuthority(game, -1, 'жалоба директора'); }
      break;
    default: break;
  }
  o.result = text; glog(game, `${o.title}: ${text}`, 'offer'); emit(game, 'offer:answered', { offer: o });
  return { ok: true, text };
}
function offersTick(game) {
  const c = C(game); const t = game.state.time; const f = game.state.flags || {};
  for (const o of c.offers) if (!o.answered && o.expires && (t.day > o.expires.day || (t.day === o.expires.day && t.minute >= o.expires.minute))) { answerOffer(game, o.id, o.kind === 'quota' ? 'honest' : 'refuse'); }
  // нарушение договорённости «не патрулировать»
  if (f.noPatrol) for (const [dId, np] of Object.entries(f.noPatrol)) {
    if (t.day > np.until) { if (!np.broken) { const econ = game.state.economy; if (econ) econ.money += np.sum; glog(game, `Вторая половина «за спокойствие» ${dForm(dId, 'prep')} — ${np.sum} тыс. — в сейфе.`, 'offer'); } delete f.noPatrol[dId]; continue; }
    if (!np.broken && liveTasks(game).some((x) => x.districtId === dId && x.phase === 'active' && x.type !== 'respond')) { np.broken = true; const g = gang(game, np.gangId); if (g) g.anger = clamp(g.anger + 25, 0, 100); glog(game, `Наряд появился ${dForm(dId, 'prep')} вопреки договорённости. «${g ? g.name : 'Они'}» считают, что их кинули.`, 'important'); }
  }
}
function weeklyRoof(game) {
  const f = game.state.flags || {}; const day = game.state.time.day; const econ = game.state.economy;
  for (const r of f.roofs || []) if ((day - r.since) % 7 === 0 && day !== r.since && econ) { econ.money += r.sum; glog(game, `«Спонсорская помощь» от коммерсанта: +${r.sum} тыс.`, 'offer'); }
}

/* ------------------------------------------------------------------ итоги суток и сводка */
function buildSummary(game, atRoll = false) {
  const c = C(game); const s = c.stats.day; const t = game.state.time;
  const ev = (s.events || []).slice().sort((a, b) => b.weight - a.weight);
  const byDistrict = {};
  for (const d of c.districts) { const b = s.byDistrict[d.id] || {}; byDistrict[d.id] = { crimes: num(b.crimes), solved: num(b.solved), arrests: num(b.arrests), presence: Math.round(d.dayAcc && d.dayAcc.minutes ? d.dayAcc.presenceSum / d.dayAcc.minutes : 0) }; }
  return {
    day: Math.max(1, t.minute >= 480 && !atRoll ? t.day : t.day - 1),
    crimes: num(s.crimes) - num(s.latent), solved: num(s.solved), prevented: num(s.prevented), arrests: num(s.arrests),
    wounded: num(s.policeWounded), killed: num(s.policeKilled), civiliansKilled: num(s.civiliansKilled), banditsKilled: num(s.banditsKilled),
    tasks: num(s.tasks), calls: num(s.calls), intel: num(s.tips), trustDelta: Math.round(num(s.reputationDelta) * 10) / 10,
    lines: ev.slice(0, 7).map((e) => e.text), byDistrict,
  };
}
function setWeather(game) { const c = C(game); const m = calendar(game, game.state.time.day).m; c.weather = R(game).pick(WEATHER[m] || WEATHER[11]); }
function rollover(game) {
  const c = C(game); const sh = shiftOf(absNow(game)); if (c.lastRollShift === sh) return false;
  c.lastSummary = buildSummary(game, true); c.lastEvents = (c.stats.day.events || []).slice(); c.lastRollShift = sh;
  safe('cityDaily', cityDaily, game); safe('planClashes', planClashes, game); safe('informantsDaily', informantsDaily, game);
  const day = game.state.time.day; const diff = game.state.difficulty || 'normal';
  // первая атака — «проверка нового начальника», чтобы оборона участка не осталась за кадром
  const firstBy = diff === 'easy' ? 6 : diff === 'hard' ? 3 : 4;
  if (!c.attackLog.length && day >= firstBy && game.combat?.planAttack) { const g = activeGangs(game).sort((a, b) => b.strength - a.strength).find((x) => x.type !== 'drugs') || activeGangs(game)[0]; if (g) safe('launchAttack', launchAttack, game, g, 'показать новому начальнику, кто в городе хозяин', 'welcome'); }
  else safe('considerAttacks', considerAttacks, game);
  safe('planPaydays', planPaydays, game);
  c.stats.day = newDayStats(sh);
  for (const d of c.districts) { districtShiftReset(d); if (d.stats) d.stats.today = 0; }
  setWeather(game); safe('morningNews', morningNews, game); safe('weeklyRoof', weeklyRoof, game); safe('offersDaily', offersDaily, game);
  // уборка
  const now = absNow(game);
  c.tasks = c.tasks.filter((t) => t.phase !== 'done' || now - num(t.rt?.doneAt, now) < 2880).slice(-60);
  c.intel = c.intel.filter((i) => !(i.expires && i.expires < now - 1440));
  return true;
}
function briefing(game) {
  const c = C(game); const t = game.state.time; const now = absNow(game);
  const ev = (c.lastEvents && c.lastEvents.length ? c.lastEvents : c.stats.day.events || []).slice().sort((a, b) => b.weight - a.weight);
  const lines = ev.slice(0, 9).map((e) => e.text);
  const S = c.lastSummary;
  if (S && (S.crimes || S.solved)) lines.unshift(`За сутки зарегистрировано преступлений: ${S.crimes}, раскрыто: ${S.solved}, задержано: ${S.arrests}.${S.wounded ? ` Ранено сотрудников: ${S.wounded}.` : ''}${S.killed ? ` Погибло сотрудников: ${S.killed}.` : ''}`);
  if (t.day === 1) lines.unshift('Отделение принято по акту. Предыдущий начальник, подполковник Громов, убит 9 октября на крыльце здания. Дело не раскрыто.');
  const hot = c.districts.map((d) => { const tg = topGang(game, d); const score = d.crime + num(d.neglect) * 6 + infSum(d) * 0.2; const why = []; if (d.crime >= 55) why.push(`высокий уровень преступности (${Math.round(d.crime)})`); if (num(d.neglect) >= 2) why.push(`нарядов не было ${d.neglect} сут.`); if (tg && num(d.influence[tg.id]) >= 30) why.push(`район держат «${tg.name}»`); if (d.trust < 25) why.push('население милиции не доверяет'); if (num(d.stats?.today) >= 4) why.push('всплеск за сутки'); return { districtId: d.id, score, why: why.join('; ') }; }).filter((x) => x.why).sort((a, b) => b.score - a.score).slice(0, 3).map(({ districtId, why }) => ({ districtId, why: cap(why) + '.' }));
  const intel = c.intel.filter((i) => i.revealed && !i.used && (!i.expires || i.expires > now)).slice(-5).map((i) => i.text);
  for (const p of game.state.attackPlans || []) if (p.warned && !p.done && !p.resolved) { const g = gang(game, p.gangId); intel.unshift(`Источник предупреждает: «${g ? g.name : 'неизвестные'}» готовят нападение на отделение.`); }
  for (const o of c.offers) if (!o.answered) intel.push(`Ждёт решения: ${o.title}.`);
  const inbox = (game.state.inbox || []).filter((x) => !x.answered && x.choices && x.choices.length).length; if (inbox) intel.push(`На столе в кабинете — бумаги на подпись: ${inbox}.`);
  const cal = calendar(game, t.day);
  return { date: cityDate(game, t.day), weekday: WEEKDAYS[cal.wd], weather: c.weather, lines, hotspots: hot, intel, news: c.news.filter((n) => n.day === t.day || n.day === t.day - 1).slice(-6) };
}

/* ------------------------------------------------------------------ посетители: решение */
function answerVisitor(game, v, choiceId, by = 'player') {
  if (!v || v._answered) return null; v._answered = true;
  const ch = (v.choices || []).find((x) => x.id === choiceId); const e = (ch && ch.effect) || {};
  const c = C(game); const f = game.state.flags || (game.state.flags = {}); const rng = R(game);
  const dId = v.crime?.districtId || rng.pick(c.districts).id; const econ = game.state.economy;
  if (e.trust) addTrust(game, dId, e.trust);
  if (e.reputation) addReputation(game, e.reputation);
  if (e.authority) addAuthority(game, e.authority, 'работа с заявителями');
  if (e.money && econ) { econ.money += e.money; }
  if (e.moraleHonest) staffMorale(game, isHonest, e.moraleHonest * 2, 'как начальник говорит с людьми');
  if (e.moraleAll) staffMorale(game, null, e.moraleAll, 'благодарность жителей');
  if (e.corrupt) f.corruption = num(f.corruption) + e.corrupt;
  if (e.brutality) { const d = dist(game, dId); if (d?.dayAcc) d.dayAcc.brutality += e.brutality; }
  const cr = v.crime && v.crime.id ? c.crimes.find((x) => x.id === v.crime.id) : null;
  if (e.drop && cr && cr.status !== 'resolved') { cr.status = 'unsolved'; cr.dropped = true; c.stats.day.crimes = Math.max(0, num(c.stats.day.crimes) - 1); }
  if (e.task && cr && cr.status !== 'resolved') {
    const roles = e.task === 'investigate' ? ['oper', 'uchastkovy'] : e.task === 'search' ? ['kinolog', 'uchastkovy', 'pps'] : ['pps', 'uchastkovy'];
    const r = safe('autoTask', autoTask, game, e.task, { districtId: cr.districtId, targetCrimeId: cr.id, n: e.task === 'investigate' ? 1 : 2, roles });
    if (!r || !r.ok) dutySay(game, `Товарищ майор, по заявлению «${v.complaint}» отправить некого${r && r.reason ? `: ${r.reason}` : ''}. Материал лежит у меня.`, 'info');
  }
  if (e.intel) { const d = dist(game, dId); const tg = d ? topGang(game, d, 1) : null; if (tg) safe('gangIntel', gangIntel, game, tg, { revealed: true, source: 'visitor', reliability: e.intel === 'weak' ? 0.4 : 0.75, kinds: e.intel === 'racket' ? ['racket', 'hideout'] : ['hideout', 'stash', 'meeting'] }); }
  if (e.informant && rng.chance(e.informant)) safe('addInformant', addInformant, game, { districtId: dId, source: 'visitor', reliability: rng.range(0.5, 0.8) });
  if (e.anger) { const d = dist(game, dId); const tg = d ? topGang(game, d, 1) : null; if (tg) tg.anger = clamp(tg.anger + e.anger, 0, 100); }
  if (e.scout) {
    const p = (game.state.attackPlans || []).find((x) => x.gangId === v.scoutGangId && !x.done && !x.resolved); const g = gang(game, v.scoutGangId);
    if (e.scout === 'caught') { if (p) { p.warned = true; emit(game, 'attack:warning', { plan: p }); } dutySay(game, `Товарищ майор, «посетитель» раскололся за пять минут. Его послали посмотреть, сколько нас. ${g ? `Это «${g.name}».` : ''} Они придут.`, 'alarm'); }
    else if (e.scout === 'fooled' && p) { p.size = Math.max(3, Math.round(num(p.size, 6) * 1.25)); p.delayed = true; if (Number.isFinite(p.minute)) { p.day = num(p.day, game.state.time.day) + 1; } }
    else if (e.scout === 'told' && p) { p.scouted = true; }
  }
  if (e.detainDrunk && game.sim?.detainees?.add) safe('detAdd', () => game.sim.detainees.add(game, { person: v.person, age: v.age, look: v.look, charge: 'появление в нетрезвом виде', danger: 5, cooperation: 80 }));
  return { ok: true };
}

/* ------------------------------------------------------------------ шаг времени */
function minuteTick(game, now) {
  const c = C(game);
  for (const t of liveTasks(game)) safe('stepTask', stepTask, game, t, now);
  if (c.schedule.length) {
    const due = c.schedule.filter((e) => e.at <= now); if (due.length) c.schedule = c.schedule.filter((e) => e.at > now);
    for (const ev of due) {
      switch (ev.kind) {
        case 'clash': { const res = safe('resolveClash', resolveClash, game, ev); if (res) for (const t of liveTasks(game)) if (t.phase === 'active' && t.districtId === ev.districtId) safe('hearClash', hearClash, game, t, res); break; }
        case 'warning': safe('fireWarning', fireWarning, game, ev); break;
        case 'gangop': safe('gangOp', gangOp, game, ev); break;
        case 'tip': safe('fireTip', fireTip, game, ev); break;
        case 'ownCrime': safe('ownCrime', ownCrime, game, ev.spec, ev.opts || {}); break;
        case 'visitor': if (!game.combat?.active) safe('fireVisitor', fireVisitor, game, ev); break;
        default: break;
      }
    }
  }
  safe('expireRadio', expireRadio, game, now); safe('expireLive', expireLive, game, now);
  presenceTick(game, 1);
  const mod = minuteOfDay(now);
  if (mod % 60 === 0) { safe('tickCrimes', tickCrimes, game, now); safe('hourlyCity', hourlyCity, game, now); safe('offersTick', offersTick, game); if (mod % 360 === 0) setWeather(game); }
  if (mod === 480) rollover(game);
}

export const city = {
  init(game) {
    const s = game.state; const D = game.sim?.crimes?.DISTRICTS || [];
    s.city = {
      name: 'Зареченск', calendar: { ...START }, rngSeed: (game.rng.next() * 4294967296) >>> 0, seq: 0,
      districts: D.map((d) => ({ ...JSON.parse(JSON.stringify(d)), baseCrime: d.crime, influence: {}, presence: 0, cover: 0, presenceAvg: 0, neglect: 0, stats: { crimes: 0, solved: 0, today: 0 } })),
      gangs: [], tasks: [], crimes: [], live: [], captivesHeld: [], schedule: [], intel: [], informants: [], offers: [], news: [], pendingMsgs: [], paydays: [],
      moleHints: 0, weather: '', ledger: [], hiddenLog: [], tension: {}, attackLog: [], stats: { day: newDayStats(0), total: {}, history: [] }, lastMin: null, lastRollShift: 0, lastSummary: null, lastEvents: [],
    };
    if (!Array.isArray(s.radio)) s.radio = [];
    for (const d of s.city.districts) districtShiftReset(d);
    safe('createGangs', createGangs, game); safe('planPaydays', planPaydays, game); setWeather(game); safe('morningNews', morningNews, game);
    s.city.lastMin = Math.floor(absNow(game));
    return s.city;
  },
  /** dtMin — игровые минуты */
  update(game, dtMin) {
    const c = game.state.city; if (!c || !(dtMin > 0)) return;
    const now = Math.floor(absNow(game)); if (c.lastMin == null || now < c.lastMin) c.lastMin = now;
    if (now - c.lastMin > 45) c.lastMin = now - 45; // после долгого простоя не догоняем всё
    let guard = 0; while (c.lastMin < now && guard++ < 45) { c.lastMin++; minuteTick(game, c.lastMin); }
  },
  dayEnd(game) { return rollover(game); },
  daySummary(game) { const c = C(game); if (!c) return null; rollover(game); const fresh = c.lastSummary && absNow(game) - ((c.lastRollShift * 1440) + 480) < 600; return fresh ? c.lastSummary : buildSummary(game); },
  briefing, taskTypes, validTargets, estimate,
  createTask(game, spec) { return createTask(game, spec); },
  cancelTask, onDeparted, onReturned, radio, answerRadio,
  answerOffer, answerVisitor, pushOffer,
  revealIntel, gangIntel, addInformant, gangHit, addIntel,
  planAttackNow(game, gangId, reason = 'учения') { const g = gang(game, gangId) || activeGangs(game)[0]; return g ? launchAttack(game, g, reason, 'debug') : null; },
  spawnCrime(game, districtId, typeId, inProgress = true) { const d = dist(game, districtId) || C(game).districts[0]; return safe('spawnCrime', spawnCrime, game, d, Math.floor(absNow(game)), { typeId, forceInProgress: inProgress }); },
  dutySay, dispatchSay,
};
export default city;
