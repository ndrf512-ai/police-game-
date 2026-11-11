// Задержанные: камеры ИВС (3 камеры × 3 места), допросы, 72 часа, освобождение, этап в СИЗО.
import { uid, clamp } from '../core/rng.js';
import { pushInbox } from './staff.js';

const CELLS = ['cell_1', 'cell_2', 'cell_3'];
const PER_CELL = 3;
const R = (game) => game.rng;
const list = (game) => game.state.detainees || (game.state.detainees = []);
const inCells = (game) => list(game).filter((d) => d.status === 'cell');
const byId = (game, id) => list(game).find((d) => d.id === id) || null;
const fem = (d) => (d.person?.gender || d.gender) === 'f';
const nameOf = (d) => `${d.person.lastName} ${d.person.firstName[0]}.${d.person.patronymic ? d.person.patronymic[0] + '.' : ''}${d.nick ? ` («${d.nick}»)` : ''}`;
const emit = (game, ev, p) => game.bus?.emit?.(ev, p);
const log = (game, t, k = 'detainee') => game.log?.(t, k);
const city = (game) => game.sim?.city;
const gangOf = (game, d) => (d.gangId ? (game.state.city?.gangs || []).find((g) => g.id === d.gangId) : null);

function freeCell(game) {
  const cnt = Object.fromEntries(CELLS.map((c) => [c, 0]));
  for (const d of inCells(game)) if (cnt[d.cell] !== undefined) cnt[d.cell]++;
  // опасных стараемся не сажать вместе: берём наименее заполненную
  const best = CELLS.slice().sort((a, b) => cnt[a] - cnt[b])[0];
  return cnt[best] < PER_CELL ? best : null;
}
function bestInterrogator(game, officerId) {
  const staff = game.state.staff || [];
  if (officerId) { const o = staff.find((x) => x.id === officerId); if (o) return o; }
  const avail = staff.filter((o) => o.status === 'station' && o.onShift);
  return avail.sort((a, b) => ((b.skills?.investigation || 0) + (b.skills?.talk || 0) * 0.5 + (b.role === 'oper' ? 25 : 0)) - ((a.skills?.investigation || 0) + (a.skills?.talk || 0) * 0.5 + (a.role === 'oper' ? 25 : 0)))[0] || null;
}

// Реплики задержанных по типу и исходу
const SAY = {
  silent: ['Ничего не знаю. Адвоката давай.', 'Начальник, ты меня с кем-то путаешь.', 'Я всё сказал: шёл мимо.', '(молчит и смотрит в стену)', 'Протокол без меня пиши.'],
  thieves_no: ['Мне с тобой говорить не по понятиям, начальник.', 'Я своё отсижу. А ты спи теперь вполглаза.', 'Не трать чай, гражданин начальник.'],
  afghan_no: ['Фамилия, год рождения. Больше ничего не услышишь.', 'Я под Кандагаром и не такое слышал.'],
  scared: ['Не бейте только… Я скажу, скажу!', 'Меня же свои убьют, если узнают…', 'Дайте закурить… Руки трясутся.'],
  deal: ['Отпустишь — будет тебе разговор. По рукам?', 'Мне сидеть нельзя, у меня мать больная. Говори, чего надо.', 'Ладно, начальник. Только я тебе не стукач, запомни. Просто… взаимовыгодно.'],
  talk: ['Пиши, начальник…', 'Ладно. Всё равно узнаете.', 'Только чтоб в протокол не я это сказал.', 'Слушай сюда, повторять не буду.'],
  lie: ['Да точно тебе говорю! Чтоб я сдох.', 'Сам слышал, своими ушами.', 'Информация — верняк.'],
  hard_break: ['Хватит! Хватит… Скажу.', 'Всё, всё, начальник… Пиши.'],
  hard_hold: ['Бей. Мне не привыкать.', 'Я на тебя жалобу прокурору напишу. С побоями.', '(сплёвывает кровь и улыбается)'],
  threat_ok: ['Ты… ты этого не сделаешь. Ладно. Ладно!', 'Не надо в общую… Скажу.'],
  threat_no: ['Пугай кого другого.', 'Я таких, как ты, с десяток пережил.'],
  cellmate: ['…а «подсадной» ночью вернулся довольный: клиент разговорился.', '…сокамерник под утро постучал в дверь: есть что рассказать.'],
  cellmate_fail: ['…«подсадного» раскусили за час. Вернулся с разбитой губой.', '…всю ночь молчал. Чует.'],
};

export const detainees = {
  CELLS, PER_CELL,
  freeCells(game) { return CELLS.length * PER_CELL - inCells(game).length; },
  get(game, id) { return byId(game, id); },
  inCells,

  /** Принять задержанного. Возвращает Detainee или null (мест нет). */
  add(game, data = {}) {
    const cell = freeCell(game);
    if (!cell) { log(game, 'В ИВС нет мест: задержанного пришлось отправить в городской изолятор.', 'detainee'); return null; }
    const rng = R(game); const t = game.state.time;
    const person = data.person || { gender: 'm', firstName: 'Неизвестный', lastName: 'Неустановленный', patronymic: '' };
    const gender = person.gender || data.gender || 'm';
    const d = {
      id: uid('det'), person, nick: data.nick || null, age: data.age || rng.int(19, 45), gender,
      look: data.look || { uniform: gender === 'f' ? 'civil_f' : 'civil_m', gender, skin: rng.int(0, 3), hair: rng.int(0, 5), hat: 'none', weapon: 'none', build: 1 },
      charge: data.charge || 'мелкое хулиганство', crimeId: data.crimeId || null, gangId: data.gangId || null,
      danger: clamp(data.danger ?? 25, 0, 100), cooperation: clamp(data.cooperation ?? 40, 0, 100), health: clamp(data.health ?? 90, 1, 100),
      intel: (data.intel || []).slice(), status: 'cell', cell, arrivedDay: t.day, arrivedMin: Math.floor(t.minute), notes: (data.notes || []).slice(),
      leader: !!data.leader, role: data.role || (data.gangId ? 'member' : 'civil'), taskId: data.taskId || null, arrestedBy: data.arrestedBy || null,
      interrogations: 0, lastInterDay: 0, beaten: 0, papers: false, fed: true, warned72: false,
    };
    d.look.weapon = 'none'; d.look.armor = false;
    list(game).push(d);
    emit(game, 'detainee:new', { detainee: d });
    log(game, `В ИВС ${fem(d) ? 'помещена' : 'помещён'} ${nameOf(d)}: ${d.charge}.`, 'detainee');
    return d;
  },

  adjust(game, id, delta = {}) {
    const d = byId(game, id); if (!d) return null;
    if (delta.cooperation) d.cooperation = clamp(d.cooperation + delta.cooperation, 0, 100);
    if (delta.health) d.health = clamp(d.health + delta.health, 0, 100);
    if (delta.danger) d.danger = clamp(d.danger + delta.danger, 0, 100);
    return d;
  },

  /**
   * Допрос. approach: soft | hard | deal | threat | cellmate
   * → {ok, lines:[{who:'officer'|'detainee'|'note', text}], intel:[IntelItem], effects:{}, text}
   */
  interrogate(game, id, approach = 'soft', officerId = null) {
    const d = byId(game, id);
    if (!d || d.status !== 'cell') return { ok: false, lines: [], intel: [], effects: {}, text: 'Задержанного нет в камере.' };
    const rng = R(game); const day = game.state.time.day;
    if (d.lastInterDay === day && d.interrogations >= 2 && approach !== 'cellmate') return { ok: false, lines: [], intel: [], effects: {}, text: 'Сегодня его уже дважды водили на допрос. Больше — только хуже будет.' };
    const o = bestInterrogator(game, officerId);
    if (!o && approach !== 'cellmate') return { ok: false, lines: [], intel: [], effects: {}, text: 'Допрашивать некому: на участке нет свободных сотрудников.' };
    const g = gangOf(game, d); const gt = g?.type;
    const skill = o ? (o.skills?.investigation || 40) * 0.6 + (o.skills?.talk || 40) * 0.4 : 40;
    const hasT = (t) => !!o && (o.traits || []).includes(t);
    const lines = []; const effects = {}; const got = [];
    const flags = game.state.flags || (game.state.flags = {});
    const say = (who, text) => lines.push({ who, text });
    const on = o ? `${o.rank ? o.rank + ' ' : ''}${o.lastName}` : 'Опер';
    d.interrogations++; d.lastInterDay = day;
    let p = 0; let lieP = 0.08 + (100 - d.cooperation) / 500;
    const resist = (gt === 'thieves' ? 30 : gt === 'afghan' ? 26 : gt === 'frostbitten' ? 12 : gt === 'drugs' ? -8 : 0) + (d.leader ? 22 : 0) + d.danger * 0.12;
    switch (approach) {
      case 'soft':
        say('officer', rng.pick(['Чай будешь? Сигарету? Давай по-человечески.', 'Садись. Никто тебя бить не собирается. Рассказывай, как дошёл до жизни такой.', 'Ты же не дурак. Давай подумаем, как тебе помочь.']));
        p = (d.cooperation + skill * 0.55 - resist) / 100 * (hasT('talker') || hasT('kind') ? 1.2 : 1); d.cooperation = clamp(d.cooperation + 4, 0, 100); break;
      case 'hard':
        say('officer', rng.pick(['Дверь закрой. Сейчас будем разговаривать по-другому.', 'Ты, я вижу, по-хорошему не понимаешь.', 'Встать! Лицом к стене!']));
        p = (30 + skill * 0.3 + (100 - d.danger) * 0.35 - resist * 0.6) / 100 * (hasT('sadist') ? 1.25 : 1) * (hasT('kind') ? 0.6 : 1);
        d.beaten++; d.health = clamp(d.health - rng.int(8, 22), 0, 100); d.cooperation = clamp(d.cooperation - 12, 0, 100); lieP += 0.18;
        effects.brutality = 1; flags.brutality = (flags.brutality || 0) + 1; break;
      case 'deal':
        say('officer', rng.pick(['Есть вариант. Ты мне — я тебе. Выйдешь сегодня.', 'Слушай предложение: рассказываешь всё — оформляю как свидетеля.', 'Мне нужен не ты. Мне нужны те, кто над тобой.']));
        p = (45 + d.cooperation * 0.5 + skill * 0.25 - (gt === 'thieves' ? 35 : 0) - (d.leader ? 40 : 0)) / 100; break;
      case 'threat':
        say('officer', rng.pick(['Могу оформить так, что поедешь по тяжёлой статье. Лет на восемь.', 'Знаешь, что с такими, как ты, делают в общей камере СИЗО? Я могу устроить.', 'А если на районе узнают, что ты уже всех сдал? Я ведь могу и слух пустить.']));
        p = (25 + skill * 0.4 + (100 - d.danger) * 0.4 - resist * 0.8) / 100; d.cooperation = clamp(d.cooperation - 6, 0, 100); lieP += 0.1; break;
      case 'cellmate': {
        const cost = 40; const econ = game.state.economy;
        if (econ && econ.money < cost) return { ok: false, lines: [], intel: [], effects: {}, text: 'На «подсадного» нужны деньги — хотя бы на чай и сигареты. В кассе пусто.' };
        if (econ) { econ.money -= cost; effects.money = -cost; }
        say('note', 'В камеру подсадили «своего» человека — за пачку чая, блок сигарет и обещание закрыть глаза на его дело.');
        p = (40 + (100 - d.danger) * 0.2 - resist * 0.5 + (gt === 'thieves' ? -15 : 10)) / 100; lieP = 0.05; d.interrogations--; break;
      }
      default: break;
    }
    p = clamp(p, 0.03, 0.92);
    const success = rng.chance(p);
    if (approach === 'hard') {
      if (d.health <= 0) {
        d.status = 'dead'; d.health = 0;
        say('note', `${nameOf(d)} ${fem(d) ? 'потеряла' : 'потерял'} сознание и не ${fem(d) ? 'очнулась' : 'очнулся'}. Скорая констатировала смерть.`);
        game.sim?.campaign?.addAuthority?.(game, -15, 'смерть задержанного на допросе'); flags.reputation = clamp((flags.reputation ?? 50) - 10, 0, 100);
        emit(game, 'detainee:dead', { detainee: d }); log(game, `Задержанный ${nameOf(d)} умер после допроса. Будет проверка прокуратуры.`, 'important');
        pushInbox(game, { source: 'detainees', kind: 'death_check', title: 'Прокуратура: смерть в ИВС', text: `По факту смерти задержанного ${nameOf(d)} начата проверка. Следователь прокуратуры спрашивает, кто вёл допрос.`, choices: [{ id: 'name', label: `Назвать: ${on}`, desc: 'Сотрудника, скорее всего, уволят и посадят' }, { id: 'cover', label: 'Оформить как сердечный приступ', desc: 'Авторитет −, честные сотрудники не простят' }], autoChoice: 'cover', expires: { day: day + 2, minute: 600 }, data: { officerId: o?.id, detId: d.id } });
        return { ok: true, lines, intel: [], effects, text: 'Допрос закончился смертью задержанного.', dead: true };
      }
      if (rng.chance(0.18 + d.beaten * 0.1)) { d.complaint = true; say('note', 'Задержанный потребовал прокурора и бумагу — писать жалобу на побои.'); }
      for (const x of game.state.staff || []) if ((x.traits || []).includes('honest') && x.status === 'station') x.morale = clamp((x.morale ?? 60) - 3, 0, 100);
    }
    if (!success) {
      const pool = approach === 'hard' ? SAY.hard_hold : approach === 'threat' ? SAY.threat_no : approach === 'cellmate' ? SAY.cellmate_fail : gt === 'thieves' ? SAY.thieves_no : gt === 'afghan' ? SAY.afghan_no : SAY.silent;
      say(approach === 'cellmate' ? 'note' : 'detainee', rng.pick(pool));
      return { ok: true, lines, intel: [], effects, text: 'Ничего не добились.' };
    }
    say(approach === 'cellmate' ? 'note' : 'detainee', rng.pick(approach === 'hard' ? SAY.hard_break : approach === 'threat' ? SAY.threat_ok : approach === 'deal' ? SAY.deal : approach === 'cellmate' ? SAY.cellmate : d.danger < 35 ? SAY.scared : SAY.talk));
    // раскрываем скрытые сведения
    const hidden = d.intel.slice(); const n = approach === 'deal' ? Math.min(hidden.length, 2) : 1;
    for (let k = 0; k < n && hidden.length; k++) {
      const iid = hidden.shift(); d.intel = d.intel.filter((x) => x !== iid);
      const it = city(game)?.revealIntel?.(game, iid, 'interrogation') || (game.state.city?.intel || []).find((x) => x.id === iid);
      if (it) { if (rng.chance(lieP) && !it.fake) { it.fake = true; it.reliability = Math.min(it.reliability ?? 0.6, 0.3); } got.push(it); say('detainee', it.text || 'Называет адрес и имена.'); }
    }
    if (!got.length) {
      // сведений о банде нет — признание по делу
      if (!d.confessed) { d.confessed = true; d.papers = true; say('detainee', rng.pick(['Ну было. Пиши: признаю.', 'Моё. Я взял. Только напиши, что сам пришёл.', 'Признаю. Пил, не помню половины, но признаю.'])); effects.confession = true; if (d.crimeId) { const cr = (game.state.city?.crimes || []).find((c) => c.id === d.crimeId); if (cr && cr.status !== 'resolved') { cr.status = 'resolved'; effects.solved = true; } } game.sim?.campaign?.addAuthority?.(game, 1, 'раскрытие'); }
      else say('detainee', rng.pick(['Больше ничего не знаю, начальник. Честно.', 'Я всё рассказал. Хоть режь.']));
    }
    if (approach === 'deal') {
      // сделка: выходит на свободу, может стать информатором
      d.status = 'released'; d.releasedDay = day; effects.released = true;
      if (g && rng.chance(0.6)) { const inf = city(game)?.addInformant?.(game, { gangId: g.id, districtId: g.base?.[0], source: 'deal', reliability: rng.range(0.45, 0.8) }); if (inf) { effects.informant = inf.alias; say('note', `Завербован источник «${inf.alias}».`); } }
      emit(game, 'detainee:released', { detainee: d, reason: 'deal' });
      for (const x of game.state.staff || []) if ((x.traits || []).includes('honest') && x.id === d.arrestedBy) x.morale = clamp((x.morale ?? 60) - 6, 0, 100);
    }
    return { ok: true, lines, intel: got, effects, text: got.length ? 'Есть информация.' : effects.confession ? 'Признание получено.' : 'Заговорил, но нового мало.' };
  },

  release(game, id, reason = 'released') {
    const d = byId(game, id); if (!d || d.status !== 'cell') return { ok: false, text: 'Нет такого задержанного.' };
    d.status = 'released'; d.releasedDay = game.state.time.day;
    const g = gangOf(game, d);
    if (g && d.danger > 50 && !d.papers) { game.sim?.campaign?.addAuthority?.(game, -2, 'отпустил бандита'); if (g.anger != null) g.anger = clamp(g.anger - 6, 0, 100); }
    emit(game, 'detainee:released', { detainee: d, reason });
    log(game, `${nameOf(d)} ${fem(d) ? 'отпущена' : 'отпущен'} из ИВС.`, 'detainee');
    return { ok: true, text: `${nameOf(d)} ${fem(d) ? 'вышла' : 'вышел'} на свободу.` };
  },
  /** Этап в СИЗО (оформлен): авторитет растёт, банда злится. */
  transfer(game, id) {
    const d = byId(game, id); if (!d || d.status !== 'cell') return { ok: false, text: 'Нет такого задержанного.' };
    d.status = 'transferred'; d.transferDay = game.state.time.day;
    const g = gangOf(game, d);
    game.sim?.campaign?.addAuthority?.(game, d.leader ? 8 : d.danger > 50 ? 2 : 1, d.leader ? 'главарь банды отправлен в СИЗО' : 'дело передано следствию');
    if (g) { g.anger = clamp((g.anger || 0) + (d.leader ? 10 : 3), 0, 100); if (g.stats) g.stats.arrested = (g.stats.arrested || 0) + 1; }
    emit(game, 'detainee:transferred', { detainee: d });
    log(game, `${nameOf(d)} ${fem(d) ? 'этапирована' : 'этапирован'} в СИЗО.`, 'detainee');
    return { ok: true, text: `${nameOf(d)} — в СИЗО. Дело ушло следователю.` };
  },
  escape(game, id) {
    const d = byId(game, id); if (!d) return null;
    d.status = 'escaped'; emit(game, 'detainee:escaped', { detainee: d });
    game.sim?.campaign?.addAuthority?.(game, d.leader ? -8 : -3, 'побег задержанного');
    log(game, `${nameOf(d)} ${fem(d) ? 'сбежала' : 'сбежал'}.`, 'important');
    return d;
  },
  kill(game, id, cause = 'погиб') { const d = byId(game, id); if (!d) return null; d.status = 'dead'; d.health = 0; emit(game, 'detainee:dead', { detainee: d, cause }); return d; },

  /** Время содержания, часов */
  hoursHeld(game, d) { const t = game.state.time; return ((t.day - d.arrivedDay) * 1440 + (t.minute - (d.arrivedMin || 480))) / 60; },

  dayStart(game) {
    const rng = R(game); const day = game.state.time.day; const S = game.state;
    // чистим старые записи
    S.detainees = list(game).filter((d) => d.status === 'cell' || day - (d.releasedDay || d.transferDay || d.arrivedDay) < 6);
    const cells = inCells(game);
    const food = (S.economy?.inventory?.rations ?? S.economy?.inventory?.food ?? 1) > 0;
    for (const d of cells) {
      const h = this.hoursHeld(game, d);
      d.health = clamp(d.health + (food ? 2 : -4) - (d.beaten ? 2 : 0), 1, 100);
      d.cooperation = clamp(d.cooperation + (h > 24 ? 3 : 1) - (d.leader ? 2 : 0), 0, 100); // сидеть тяжело — сговорчивее
      // 72 часа
      if (h >= 48 && !d.warned72) {
        d.warned72 = true;
        pushInbox(game, { source: 'detainees', kind: 'hours72', title: `Истекают 72 часа: ${nameOf(d)}`, text: `${nameOf(d)} содержится третьи сутки (${d.charge}). По закону — предъявлять обвинение и этапировать в СИЗО либо отпускать.${d.papers ? ' Материал собран.' : ' Материала на арест пока мало.'}`,
          choices: [{ id: 'transfer', label: 'Оформить и этапировать в СИЗО', desc: d.papers || d.danger > 55 ? 'Материала хватит' : 'Материала мало — прокурор может завернуть' }, { id: 'release', label: 'Отпустить' }, { id: 'hold', label: 'Держать дальше, без бумаг', desc: 'Незаконно. Риск жалобы и проверки' }],
          autoChoice: d.papers || d.danger > 55 ? 'transfer' : 'release', expires: { day: day + 1, minute: 479 }, data: { detId: d.id } });
      }
      if (h > 96 && !d.papers && rng.chance(0.3)) { game.sim?.campaign?.addAuthority?.(game, -3, 'незаконное содержание под стражей'); d.complaint = true; }
      // звонок сверху
      if (d.gangId && !d.called && h > 12 && rng.chance(d.leader ? 0.45 : 0.08)) {
        d.called = true; const g = gangOf(game, d);
        pushInbox(game, { source: 'detainees', kind: 'call_above', title: 'Звонок «сверху»', text: `Звонили из администрации. Вежливо, но настойчиво: задержанный ${nameOf(d)} — «уважаемый человек, меценат, произошло недоразумение». Просят отпустить до вечера.${g ? ` Все знают, что он из «${g.name}».` : ''}`,
          choices: [{ id: 'obey', label: 'Отпустить', desc: 'Авторитет у начальства +, мораль честных −' }, { id: 'refuse', label: 'Отказать', desc: 'Авторитет −, банда злее, но люди уважают' }, { id: 'stall', label: 'Потянуть время: «оформляем»' }],
          autoChoice: 'stall', expires: { day, minute: 1200 }, data: { detId: d.id } });
      }
      // адвокат
      if (d.complaint && !d.lawyer && rng.chance(0.4)) { d.lawyer = true; pushInbox(game, { source: 'detainees', kind: 'lawyer', title: `Адвокат по делу ${nameOf(d)}`, text: `В дежурке сидит адвокат в дорогом пальто. Требует свидания с подзащитным и копию протокола. Грозит жалобой в прокуратуру на побои.`, choices: [{ id: 'allow', label: 'Допустить к задержанному' }, { id: 'deny', label: 'Не пускать: «следственные действия»', desc: 'Жалоба почти гарантирована' }], autoChoice: 'allow', expires: { day, minute: 1080 }, data: { detId: d.id } }); }
    }
    // драки в переполненных камерах
    for (const c of CELLS) {
      const inC = cells.filter((d) => d.cell === c && d.status === 'cell');
      if (inC.length >= 3 && rng.chance(0.25)) { const v = rng.pick(inC); v.health = clamp(v.health - rng.int(5, 15), 1, 100); log(game, `Ночью в камере №${c.slice(-1)} была драка. ${nameOf(v)} с разбитым лицом.`, 'detainee'); }
    }
    if (cells.length && !food) log(game, 'Задержанных нечем кормить: на складе нет продуктов.', 'detainee');
  },

  resolveInbox(game, it, choiceId) {
    const d = byId(game, it.data?.detId); const rng = R(game);
    const C = game.sim?.campaign;
    switch (it.kind) {
      case 'hours72':
        if (!d || d.status !== 'cell') return 'Вопрос снят.';
        if (choiceId === 'transfer') { if (!d.papers && d.danger <= 55 && rng.chance(0.45)) { this.release(game, d.id, 'prosecutor'); C?.addAuthority?.(game, -1, 'прокурор не дал санкцию'); return 'Прокурор санкцию не дал: материала мало. Пришлось отпустить.'; } return this.transfer(game, d.id).text; }
        if (choiceId === 'release') return this.release(game, d.id).text;
        d.illegal = true; d.complaint = d.complaint || rng.chance(0.5); return 'Оставлен в камере без санкции. Если всплывёт — будет проверка.';
      case 'call_above': {
        if (!d || d.status !== 'cell') return 'Вопрос снят.';
        const g = gangOf(game, d);
        if (choiceId === 'obey') { this.release(game, d.id, 'call'); C?.addAuthority?.(game, 4, 'пошёл навстречу администрации'); for (const x of game.state.staff || []) if ((x.traits || []).includes('honest')) x.morale = clamp((x.morale ?? 60) - 8, 0, 100); return 'Отпущен «по звонку». В курилке об этом говорят вполголоса.'; }
        if (choiceId === 'refuse') { C?.addAuthority?.(game, -5, 'отказал администрации'); if (g) g.anger = clamp((g.anger || 0) + 8, 0, 100); for (const x of game.state.staff || []) x.loyalty = clamp((x.loyalty ?? 50) + 3, 0, 100); return 'Вы отказали. На том конце долго молчали, потом повесили трубку.'; }
        return 'Вы сослались на оформление. Перезвонят.';
      }
      case 'lawyer':
        if (choiceId === 'allow') { if (d) { d.cooperation = clamp(d.cooperation - 15, 0, 100); } return 'Адвокат час говорил с подзащитным. Тот теперь знает, что отвечать: ничего.'; }
        C?.addAuthority?.(game, -2, 'жалоба адвоката'); return 'Адвокат ушёл, хлопнув дверью. Жалоба будет.';
      case 'death_check': {
        const o = (game.state.staff || []).find((x) => x.id === it.data?.officerId);
        if (choiceId === 'name' && o) { game.sim?.staff?.fire?.(game, o.id, { silent: true }); C?.addAuthority?.(game, 2, 'не стал покрывать'); return `${o.lastName} отстранён, дело передано в прокуратуру.`; }
        C?.addAuthority?.(game, -4, 'смерть в ИВС замята'); for (const x of game.state.staff || []) if ((x.traits || []).includes('honest')) { x.morale = clamp((x.morale ?? 60) - 10, 0, 100); x.loyalty = clamp((x.loyalty ?? 50) - 8, 0, 100); }
        return 'В заключении написали: острая сердечная недостаточность.';
      }
      default: return 'Принято.';
    }
  },
};
export default detainees;
