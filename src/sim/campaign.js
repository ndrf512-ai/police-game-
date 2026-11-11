// Режимы игры: кампания (60 суток, осень 1996 — зима) и песочница. Авторитет у начальства, цели, сюжетные вехи, финал.
import { clamp } from '../core/rng.js';
import { pushInbox } from './staff.js';

const START_DATE = { y: 1996, m: 10, d: 14 }; // понедельник
const PRESETS = {
  easy:   { startMoney: 8000, budgetPerWeek: 3400, salaryDelayChance: 0.15, budgetDelayChance: 0.1,  moleChance: 0.5, gangAggression: 0.7,  attackFreq: 0.6 },
  normal: { startMoney: 5000, budgetPerWeek: 2600, salaryDelayChance: 0.3,  budgetDelayChance: 0.2,  moleChance: 0.8, gangAggression: 1.0,  attackFreq: 1.0 },
  hard:   { startMoney: 3000, budgetPerWeek: 1900, salaryDelayChance: 0.45, budgetDelayChance: 0.35, moleChance: 1.0, gangAggression: 1.3,  attackFreq: 1.35 },
};
const S = (game) => game.state.campaign;
const pl = (game) => game.state.player || {};
const F = (game, m, f) => (pl(game).gender === 'f' ? f : m);
const log = (game, t, k = 'story') => game.log?.(t, k);

// Сюжетные вехи кампании: day → событие во «входящих» (или запись в журнал)
const BEATS = [
  { day: 1, kind: 'intro' },
  { day: 3, kind: 'widow' },
  { day: 6, kind: 'first_check' },
  { day: 10, kind: 'vor_offer' },
  { day: 14, kind: 'salary_delay' },
  { day: 19, kind: 'journalist' },
  { day: 24, kind: 'governor' },
  { day: 30, kind: 'halfway' },
  { day: 36, kind: 'predecessor_case' },
  { day: 44, kind: 'omon_cut' },
  { day: 52, kind: 'last_push' },
  { day: 58, kind: 'final_warning' },
];

function brokenGangs(game) { return (game.state.city?.gangs || []).filter((g) => g.status === 'broken').length; }
function aliveStaff(game) { return (game.state.staff || []).filter((o) => !['dead', 'fired', 'missing'].includes(o.status)).length; }

export const campaign = {
  PRESETS, START_DATE,

  init(game, mode = 'campaign') {
    const s = game.state; const diff = s.difficulty || 'normal';
    const preset = { ...PRESETS[diff] || PRESETS.normal, ...(mode === 'sandbox' && s.sandbox ? s.sandbox : {}) };
    const p = pl(game);
    s.campaign = {
      mode, startDate: { ...START_DATE }, settings: preset, authority: 50, chapter: 1, result: null, reason: null,
      daysLimit: mode === 'campaign' ? 60 : null, beatsDone: {}, counters: { attacksRepelled: 0, attacksLost: 0, officersLost: 0 },
      goalText: mode === 'campaign'
        ? 'Продержаться 60 суток, разгромить не меньше трёх группировок из пяти и не сдать отделение.'
        : 'Свободная служба. Держите район столько, сколько сможете.',
      objectives: mode === 'campaign'
        ? [
          { id: 'survive', text: 'Продержаться 60 суток', done: false, failed: false, progress: '1 / 60' },
          { id: 'gangs', text: 'Разгромить три группировки', done: false, failed: false, progress: '0 / 3' },
          { id: 'station', text: 'Не допустить падения отделения', done: false, failed: false },
          { id: 'authority', text: 'Не потерять доверие управления', done: false, failed: false },
          { id: 'killer', text: 'Узнать, кто убил прежнего начальника', done: false, failed: false, optional: true },
        ]
        : [{ id: 'free', text: 'Свободная служба', done: false, failed: false }],
      intro: mode === 'campaign'
        ? `Октябрь 1996 года. Областной город Зареченск. Прежнего начальника отделения милиции №14, подполковника Громова, застрелили на крыльце участка — из проезжавшей «девятки», средь бела дня. Никого не нашли. Желающих занять его кабинет тоже не нашлось, и приказом по ГУВД сюда ${F(game, 'назначен', 'назначена')} майор ${p.lastName || ''}. Двенадцать человек личного состава, два УАЗа, пять банд на шесть районов. Зарплату обещают к ноябрю.`
        : `Зареченск, осень 1996-го. Отделение милиции №14 — ваше. Сроков нет, отчётов почти нет. Только район, люди и дождь.`,
    };
    s.flags = s.flags || {}; s.flags.authority = 50; if (s.flags.reputation == null) s.flags.reputation = 40;
    return s.campaign;
  },

  get authorityValue() { return 50; },
  authority(game) { return S(game)?.authority ?? 50; },
  addAuthority(game, delta, reason) {
    const c = S(game); if (!c || !delta) return c?.authority ?? 50;
    const before = c.authority;
    c.authority = clamp(c.authority + delta, 0, 100);
    game.state.flags = game.state.flags || {}; game.state.flags.authority = c.authority;
    const st = game.state.city?.stats?.day; if (st) st.authorityDelta = (st.authorityDelta || 0) + (c.authority - before);
    if (reason && Math.abs(delta) >= 3) log(game, `Авторитет у начальства ${delta > 0 ? 'вырос' : 'упал'} (${delta > 0 ? '+' : '−'}${Math.abs(delta)}): ${reason}.`, 'authority');
    game.bus?.emit?.('authority', { value: c.authority, delta, reason });
    return c.authority;
  },

  /** Вызывается в начале каждых суток */
  update(game) {
    const c = S(game); if (!c) return;
    const day = game.state.time.day;
    // синхронизация с флагом, который двигает город
    if (Number.isFinite(game.state.flags?.authority) && Math.abs(game.state.flags.authority - c.authority) > 0.01) c.authority = clamp(game.state.flags.authority, 0, 100);
    const o = (id) => c.objectives.find((x) => x.id === id);
    if (c.mode === 'campaign') {
      const bg = brokenGangs(game);
      if (o('survive')) o('survive').progress = `${Math.min(day, 60)} / 60`;
      if (o('gangs')) { o('gangs').progress = `${bg} / 3`; o('gangs').done = bg >= 3; }
      c.chapter = day < 15 ? 1 : day < 31 ? 2 : day < 46 ? 3 : 4;
      for (const b of BEATS) if (day >= b.day && !c.beatsDone[b.kind]) { c.beatsDone[b.kind] = day; this._beat(game, b.kind); }
    }
    // еженедельная оценка управления
    if (day > 1 && (day - 1) % 7 === 0) this._weekly(game);
  },

  _weekly(game) {
    const c = S(game); const st = game.state.city?.stats?.total || {};
    const prev = c.weekSnap || {}; const cur = { crimes: st.crimes || 0, solved: st.solved || 0, arrests: st.arrests || 0 };
    c.weekSnap = cur;
    const crimes = cur.crimes - (prev.crimes || 0), solved = cur.solved - (prev.solved || 0);
    const rate = crimes > 0 ? solved / crimes : 0;
    let d = 0; let text;
    if (rate >= 0.45) { d = 4; text = `Раскрываемость за неделю — ${Math.round(rate * 100)}%. В управлении довольны: «Можете же, когда хотите».`; }
    else if (rate >= 0.25) { d = 0; text = `Раскрываемость за неделю — ${Math.round(rate * 100)}%. В управлении промолчали. Это хороший знак.`; }
    else { d = -4; text = `Раскрываемость за неделю — ${Math.round(rate * 100)}%. Из управления звонили: «Вы там работать собираетесь или как?»`; }
    this.addAuthority(game, d, 'недельные показатели');
    pushInbox(game, { source: 'campaign', kind: 'weekly', title: 'Недельная сводка из ГУВД', text: `${text} Зарегистрировано: ${crimes}, раскрыто: ${solved}.`, choices: [] });
  },

  _beat(game, kind) {
    const p = pl(game); const day = game.state.time.day; const c = S(game);
    const exp = (d = 2) => ({ day: day + d, minute: 479 });
    switch (kind) {
      case 'intro':
        log(game, c.intro, 'story'); break;
      case 'widow':
        pushInbox(game, { source: 'campaign', kind, title: 'Письмо от вдовы Громова', text: `На столе конверт без марки. «${F(game, 'Уважаемый товарищ', 'Уважаемая товарищ')} майор. Муж говорил, что в отделении есть человек, который работает не на нас. Он собирался назвать фамилию, но не успел. Его записная книжка осталась в сейфе. Найдите того, кто это сделал. В.Г.»`,
          choices: [{ id: 'take', label: 'Открыть сейф и забрать книжку', desc: 'Начать собственное расследование' }, { id: 'report', label: 'Передать письмо в управление', desc: 'По инструкции. Авторитет +' }, { id: 'burn', label: 'Сжечь письмо', desc: 'Не лезть' }], autoChoice: 'take', expires: exp(3) }); break;
      case 'first_check':
        pushInbox(game, { source: 'campaign', kind, title: 'Проверка из управления', text: 'Завтра приедет проверяющий из ГУВД — полковник Зубов. Смотреть будет всё: журналы, оружейку, камеры. Дежурный намекает, что Зубов любит коньяк и не любит сюрпризы.',
          choices: [{ id: 'clean', label: 'Навести порядок своими силами', desc: 'Личный состав устанет, зато честно' }, { id: 'cognac', label: 'Накрыть стол (−150 тыс.)', desc: 'Проверка пройдёт гладко' }, { id: 'asis', label: 'Пусть смотрит как есть' }], autoChoice: 'asis', expires: exp(1) }); break;
      case 'vor_offer': {
        const g = (game.state.city?.gangs || []).find((x) => x.type === 'thieves' && x.status === 'active');
        if (!g) break;
        pushInbox(game, { source: 'campaign', kind, title: `Записка от «${g.leader.nick}»`, text: `В дежурку зашёл аккуратный старик, оставил записку и ушёл. «Начальник. Беспредел на районе не нужен ни тебе, ни мне. Отморозков и афганцев я тебе сдам сам — адреса, имена. Взамен мои люди работают тихо, а ты их не замечаешь. Подумай. ${g.leader.nick}».`,
          choices: [{ id: 'accept', label: 'Принять перемирие', desc: 'Наводки на другие банды. Блатные крепнут. Честные сотрудники не поймут' }, { id: 'refuse', label: 'Отказать', desc: 'Блатные обозлятся' }, { id: 'play', label: 'Согласиться для вида', desc: 'Наводки пойдут, но если вскроется — будет война' }], autoChoice: 'refuse', expires: exp(3), data: { gangId: g.id } }); break;
      }
      case 'salary_delay':
        pushInbox(game, { source: 'campaign', kind, title: 'Зарплаты не будет', text: 'Из бухгалтерии ГУВД: «Финансирование за октябрь не поступило. Выплаты переносятся ориентировочно на декабрь». Люди уже знают. В курилке тихо.',
          choices: [{ id: 'own', label: 'Раздать из кассы отделения по 100 тыс. каждому', desc: 'Сколько есть' }, { id: 'speech', label: 'Собрать людей и сказать правду' }, { id: 'nothing', label: 'Промолчать' }], autoChoice: 'nothing', expires: exp(2) }); break;
      case 'journalist':
        pushInbox(game, { source: 'campaign', kind, title: 'Корреспондент «ТВ-Заречье»', text: 'Съёмочная группа местного канала хочет сделать сюжет об отделении: «Милиция в осаде». Корреспондентка обещает «объективно».',
          choices: [{ id: 'allow', label: 'Пустить и рассказать как есть', desc: 'Доверие жителей +, начальство будет недовольно' }, { id: 'official', label: 'Дать официальный комментарий по бумажке' }, { id: 'deny', label: 'Не пускать' }], autoChoice: 'official', expires: exp(2) }); break;
      case 'governor':
        pushInbox(game, { source: 'campaign', kind, title: 'Выборы губернатора', text: 'Через неделю выборы. Из администрации «просят» выделить шесть человек на трое суток — охранять митинги действующего губернатора. Район на это время останется почти без нарядов.',
          choices: [{ id: 'give', label: 'Выделить людей', desc: 'Авторитет ++, районы просядут' }, { id: 'half', label: 'Дать троих' }, { id: 'refuse', label: 'Отказать: людей нет', desc: 'Авторитет −−' }], autoChoice: 'half', expires: exp(2) }); break;
      case 'halfway':
        log(game, `Тридцать суток. Половина срока. ${brokenGangs(game)} из трёх группировок разгромлено.`, 'story'); break;
      case 'predecessor_case':
        if (!c.flagsBook) break;
        pushInbox(game, { source: 'campaign', kind, title: 'Записная книжка Громова', text: 'Вы наконец разобрали почерк. На последней странице — номер «девятки», дата и одна строчка: «Свой. Смена Б. Проверить, с кем пьёт». Этого мало для ареста, но достаточно, чтобы начать проверку.',
          choices: [{ id: 'investigate', label: 'Проверить сотрудников негласно', desc: 'Используйте «Проверить» в личных делах' }, { id: 'wait', label: 'Ждать, пока сам ошибётся' }], autoChoice: 'investigate', expires: exp(4) }); break;
      case 'omon_cut':
        pushInbox(game, { source: 'campaign', kind, title: 'ОМОН отправляют в командировку', text: 'Сводный отряд областного ОМОНа уезжает на Кавказ. Тревожная кнопка теперь вызывает дежурный взвод ППС из центра — они приедут позже и их меньше. Рассчитывайте на себя.', choices: [] });
        game.state.flags.omonAway = true; break;
      case 'last_push':
        pushInbox(game, { source: 'campaign', kind, title: 'Оперативная информация', text: 'Источники в один голос говорят: уцелевшие группировки договариваются. Отделение №14 мешает всем. До конца месяца они попробуют решить вопрос разом.', choices: [] });
        for (const g of game.state.city?.gangs || []) if (g.status === 'active') g.anger = clamp((g.anger || 0) + 25, 0, 100); break;
      case 'final_warning':
        log(game, 'Двое суток до конца срока. Из управления передали: приказ о вашем переводе с повышением готов — если будет куда возвращаться.', 'story'); break;
      default: break;
    }
  },

  resolveInbox(game, it, choiceId) {
    const c = S(game); const fl = game.state.flags; const econ = game.state.economy; const staff = game.state.staff || [];
    const honest = (f) => { for (const o of staff) if ((o.traits || []).includes('honest') || (o.traits || []).includes('idealist')) f(o); };
    const all = (f) => { for (const o of staff) if (!['dead', 'fired'].includes(o.status)) f(o); };
    const adj = (o, k, d) => { o[k] = clamp((o[k] ?? 50) + d, 0, 100); };
    switch (it.kind) {
      case 'widow':
        if (choiceId === 'take') { c.flagsBook = true; return 'В сейфе, под стопкой протоколов, — потёртая записная книжка. Почерк мелкий, половина сокращениями. Разбираться придётся долго.'; }
        if (choiceId === 'report') { this.addAuthority(game, 3, 'действует по инструкции'); return 'Письмо ушло в управление. Ответа не было.'; }
        return 'Письмо сгорело в пепельнице. Запах стоял до вечера.';
      case 'first_check':
        if (choiceId === 'clean') { all((o) => { adj(o, 'fatigue', 12); }); this.addAuthority(game, 4, 'проверка без замечаний'); return 'Всю ночь мыли, подшивали и считали патроны. Зубов уехал без замечаний — и, кажется, слегка удивлённый.'; }
        if (choiceId === 'cognac') { if (econ && econ.money >= 150) { econ.money -= 150; this.addAuthority(game, 6, 'проверка прошла отлично'); honest((o) => adj(o, 'morale', -4)); return 'Зубов уехал довольный и с пакетом. В акте — «существенных недостатков не выявлено».'; } this.addAuthority(game, -3, 'замечания по проверке'); return 'Денег на стол не нашлось. Зубов уехал трезвый и злой.'; }
        this.addAuthority(game, -4, 'замечания по проверке'); return 'Зубов исписал три листа замечаний: журналы, решётки, небритый дежурный.';
      case 'vor_offer': {
        const g = (game.state.city?.gangs || []).find((x) => x.id === it.data?.gangId);
        if (!g) return 'Старика больше никто не видел.';
        if (choiceId === 'accept' || choiceId === 'play') {
          fl.truceThieves = choiceId; g.anger = clamp((g.anger || 0) - 30, 0, 100);
          const city = game.sim?.city; const others = (game.state.city?.gangs || []).filter((x) => x.id !== g.id && x.status === 'active');
          let n = 0; for (const og of others.slice(0, 2)) { if (city?.gangIntel?.(game, og, { revealed: true, source: 'truce', reliability: 0.85, kinds: ['hideout', 'stash'] })) n++; }
          if (choiceId === 'accept') honest((o) => { adj(o, 'morale', -8); adj(o, 'loyalty', -6); });
          return `Старик кивнул и вышел. К вечеру на столе лежал листок с адресами${n ? ` — ${n} ${n === 1 ? 'точка' : 'точки'} чужих группировок` : ''}.`;
        }
        g.anger = clamp((g.anger || 0) + 15, 0, 100); all((o) => adj(o, 'loyalty', 2)); return 'Вы порвали записку. Старик у двери усмехнулся: «Зря, начальник. Я дважды не предлагаю».';
      }
      case 'salary_delay':
        if (choiceId === 'own') { const n = staff.filter((o) => !['dead', 'fired'].includes(o.status)).length; const cost = n * 100; if (econ && econ.money >= cost) { econ.money -= cost; all((o) => { adj(o, 'morale', 10); adj(o, 'loyalty', 8); }); return `Раздали по сто тысяч — ${cost} тыс. из кассы. Люди молча расписались. Кто-то сказал «спасибо».`; } all((o) => adj(o, 'morale', -4)); return 'В кассе столько нет. Пообещали — и не смогли. Вышло хуже, чем если бы молчали.'; }
        if (choiceId === 'speech') { all((o) => { adj(o, 'morale', -2); adj(o, 'loyalty', 5); }); return 'Вы сказали как есть: денег нет и до декабря не будет. Никто не ушёл. Пока.'; }
        all((o) => { adj(o, 'morale', -8); adj(o, 'loyalty', -3); }); return 'Вы промолчали. Люди узнали сами — и запомнили, что от вас.';
      case 'journalist':
        if (choiceId === 'allow') { fl.reputation = clamp((fl.reputation ?? 40) + 8, 0, 100); for (const d of game.state.city?.districts || []) d.trust = clamp(d.trust + 3, 0, 100); this.addAuthority(game, -4, 'сюжет на ТВ без согласования'); return 'Сюжет вышел в вечерних новостях: облупленные стены, усталые лица, один УАЗ на ходу. Наутро в дежурку пришли три бабушки с пирожками.'; }
        if (choiceId === 'official') { this.addAuthority(game, 1, 'корректная работа с прессой'); return 'Вы зачитали с листа про «оперативную обстановку под контролем». Корреспондентка зевала.'; }
        fl.reputation = clamp((fl.reputation ?? 40) - 3, 0, 100); return 'Съёмочную группу не пустили. Сюжет всё равно вышел — снятый с улицы, под дождём: «Милиция прячется от народа».';
      case 'governor': {
        const n = choiceId === 'give' ? 6 : choiceId === 'half' ? 3 : 0;
        if (!n) { this.addAuthority(game, -8, 'отказ администрации перед выборами'); all((o) => adj(o, 'loyalty', 3)); return 'Вы отказали. В администрации это запомнили.'; }
        const pool = staff.filter((o) => o.status === 'station' || o.status === 'home').filter((o) => o.role === 'pps' || o.role === 'guard' || o.role === 'driver').slice(0, n);
        const until = (game.state.time.day + 3 - 1) * 1440 + 480;
        for (const o of pool) { o.status = 'task'; o.taskId = 'b2_governor'; o.returnAt = until; o.onShift = false; }
        this.addAuthority(game, n === 6 ? 8 : 4, 'люди на охране митингов');
        return `${pool.length} человек ушли в оцепление на трое суток. Вернутся злые, замёрзшие и с казёнными значками «За честные выборы».`;
      }
      case 'predecessor_case':
        if (choiceId === 'investigate') { fl.moleHint = true; return 'Вы закрыли книжку. Смена «Б». Кто-то из них каждый день здоровается с вами за руку.'; }
        return 'Вы решили ждать. Книжка вернулась в сейф.';
      default: return 'Принято к сведению.';
    }
  },

  /** Проверка конца игры. Возвращает null или {result:'win'|'lose', reason} (и пишет в state.campaign). */
  checkEnd(game) {
    const c = S(game); if (!c) return null;
    if (c.result) return null; // уже объявлено
    if (Number.isFinite(game.state.flags?.authority)) c.authority = game.state.flags.authority;
    const end = (result, reason) => { c.result = result; c.reason = reason; game.bus?.emit?.('campaign:end', { result, reason }); game.setSpeed?.(0); return { result, reason }; };
    const p = pl(game); const who = `Майор ${p.lastName || ''}`.trim();
    if ((game.player?.hp ?? 100) <= 0) return end('lose', `${who} ${F(game, 'погиб', 'погибла')} при исполнении служебных обязанностей. Отделение милиции №14 расформировано приказом по ГУВД.`);
    if (game.state.flags?.stationFallen) return end('lose', 'Отделение захвачено. К утру от него остались закопчённые стены. В сводке ГУВД — три строчки.');
    if (c.authority <= 0) return end('lose', `Приказом начальника ГУВД ${F(game, 'майор', 'майор')} ${p.lastName || ''} ${F(game, 'отстранён', 'отстранена')} от должности «за полную утрату управления личным составом и оперативной обстановкой».`);
    if (game.state.time.day > 2 && aliveStaff(game) < 3) return end('lose', 'В отделении не осталось людей. Кто погиб, кто написал рапорт, кто просто не вышел на смену. Последним вы выключили свет в дежурке сами.');
    if (c.mode === 'campaign') {
      const day = game.state.time.day; const bg = brokenGangs(game);
      const o = (id) => c.objectives.find((x) => x.id === id);
      if (day > 60) {
        if (o('survive')) o('survive').done = true; if (o('station')) o('station').done = true; if (o('authority')) o('authority').done = true;
        if (bg >= 3) return end('win', `Шестьдесят суток. ${bg} ${bg >= 5 ? 'группировок' : 'группировки'} разгромлено, отделение стоит. Приказ о переводе в областное управление подписан — с повышением. За окном всё тот же дождь, но на Колхозной площади снова торгуют без оглядки.`);
        return end('lose', `Шестьдесят суток вы продержались — но район так и остался под бандами (разгромлено ${bg} из трёх). Вас переводят «в распоряжение кадров». На ваше место уже ищут следующего.`);
      }
    }
    return null;
  },
};
export default campaign;
