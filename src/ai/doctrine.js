// «Участок» — доктрины групп обороны, уровни тревоги, тактики банд (агент D).
// Всё, что нужно UI для экрана «Схема участка», + профили ИИ банд.

/** Зоны участка с падежами для реплик и UI. */
export const ZONE_INFO = {
  office:    { name: 'Кабинет начальника', short: 'кабинет',      to: 'в кабинет',       at: 'в кабинете',      indoor: true },
  opers:     { name: 'Кабинет оперов',     short: 'оперская',     to: 'к операм',        at: 'у оперов',        indoor: true },
  armory:    { name: 'Оружейная комната',  short: 'оружейка',     to: 'к оружейке',      at: 'в оружейке',      indoor: true },
  ivs:       { name: 'ИВС (камеры)',       short: 'ИВС',          to: 'к ИВС',           at: 'в ИВС',           indoor: true },
  generator: { name: 'Генераторная',       short: 'генераторная', to: 'в генераторную',  at: 'в генераторной',  indoor: true },
  corridor:  { name: 'Коридор',            short: 'коридор',      to: 'в коридор',       at: 'в коридоре',      indoor: true },
  toilet:    { name: 'Туалет',             short: 'туалет',       to: 'в туалет',        at: 'в туалете',       indoor: true },
  rest:      { name: 'Комната отдыха',     short: 'комната отдыха', to: 'в комнату отдыха', at: 'в комнате отдыха', indoor: true },
  lobby:     { name: 'Вестибюль',          short: 'вестибюль',    to: 'в вестибюль',     at: 'в вестибюле',     indoor: true },
  duty:      { name: 'Дежурная часть',     short: 'дежурка',      to: 'в дежурку',       at: 'в дежурке',       indoor: true },
  street:    { name: 'Улица у входа',      short: 'улица',        to: 'на улицу',        at: 'на улице',        indoor: false },
  yard:      { name: 'Двор',               short: 'двор',         to: 'во двор',         at: 'во дворе',        indoor: false },
  alley:     { name: 'Проезд',             short: 'проезд',       to: 'в проезд',        at: 'в проезде',       indoor: false },
};
export const INDOOR_ZONES = Object.keys(ZONE_INFO).filter((z) => ZONE_INFO[z].indoor);
export function zoneLabel(id, kind = 'name') { const z = ZONE_INFO[id]; return z ? (z[kind] || z.name) : (id || '—'); }

/** Ключевые помещения для опции «стеречь» */
export const PROTECT_ZONES = { cells: 'ivs', armory: 'armory', generator: 'generator', commander: null, none: null };

/**
 * Описание опций доктрины для UI. Каждое поле — {name, desc, options:[{id, name, desc}]} либо тип ввода.
 * DefenseGroup.doctrine = {hold, fallbackAt, fallbackZone, roe, priority, protect, note, + уточнения}
 */
export const DOCTRINES = {
  hold: {
    name: 'Задача группы',
    desc: 'Главный приказ командиру группы. Дальше он действует сам: расставляет людей, назначает секторы, решает по обстановке.',
    options: [
      { id: 'hold', name: 'Держать рубеж', desc: 'Стоять в своём помещении до последнего. Командир не отводит людей сам; дрогнуть могут только отдельные слабые духом.' },
      { id: 'fallback', name: 'Отходить при потерях', desc: 'Держать помещение, а при заданных потерях организованно, прикрывая друг друга, отойти на запасной рубеж и держаться там.' },
      { id: 'counter', name: 'Активная оборона', desc: 'Держать помещение и контратаковать, когда враг ослаб, дрогнул или отходит. Преследуют до крыльца, не дальше.' },
      { id: 'retake', name: 'Отбить помещение', desc: 'Выбить противника из указанного помещения. Командир сам выбирает дверь, ставит прикрытие, решает, кто входит первым, и при неудаче отводит людей и пробует снова.' },
    ],
    default: 'hold',
  },
  fallbackAt: {
    name: 'Порог отхода',
    desc: 'Доля выбывших (убитые, тяжелораненые, сбежавшие), при которой группа отходит. Работает при задаче «Отходить при потерях»; при «Отбить помещение» — порог отказа от штурма.',
    options: [
      { id: 0.2, name: 'Первый же раненый', desc: 'Беречь людей любой ценой.' },
      { id: 0.3, name: 'Треть группы', desc: 'Разумный порог.' },
      { id: 0.5, name: 'Половина группы', desc: 'Держаться, пока есть кому.' },
      { id: 0.7, name: 'Почти все', desc: 'Отходить, только когда держать уже некем.' },
    ],
    default: 0.3,
  },
  fallbackZone: {
    name: 'Запасной рубеж',
    desc: 'Куда отходить. «Сам решит» — командир выберет ближайшее своё помещение подальше от противника, по возможности то, что поручено стеречь.',
    type: 'zone',
    options: [{ id: null, name: 'Сам решит', desc: 'Выбор командира по обстановке.' }, ...INDOOR_ZONES.map((z) => ({ id: z, name: ZONE_INFO[z].name, desc: '' }))],
    default: null,
  },
  roe: {
    name: 'Огонь',
    desc: 'Правила открытия огня.',
    options: [
      { id: 'free', name: 'Огонь по готовности', desc: 'Стрелять по любому вооружённому противнику в зоне видимости.' },
      { id: 'return', name: 'Только ответный', desc: 'Не стрелять первыми: только по тем, кто уже стрелял, ломает двери или лезет внутрь. Важно при переговорах.' },
      { id: 'hold_fire', name: 'Подпустить и в упор', desc: 'Затаиться и молчать, пока враг не подойдёт на несколько шагов или не обнаружит засаду, — тогда огонь всей группой разом. Горячие головы могут не выдержать.' },
    ],
    default: 'free',
  },
  priority: {
    name: 'Приоритет целей',
    desc: 'По кому бить в первую очередь.',
    options: [
      { id: 'nearest', name: 'Ближайшие', desc: 'Кто ближе — тот и опаснее.' },
      { id: 'armed', name: 'Самые опасные', desc: 'Автоматчики, гранатомётчики, поджигатели, обрезы вблизи.' },
      { id: 'leader', name: 'Главарь', desc: 'Выбить командира отряда — остальные могут побежать.' },
    ],
    default: 'nearest',
  },
  protect: {
    name: 'Стеречь',
    desc: 'Что группа прикрывает в первую очередь. Часть людей встанет у объекта, по прорывающимся к нему — огонь в первую очередь, отход от объекта — только в крайнем случае.',
    options: [
      { id: 'none', name: 'Ничего особого', desc: 'Только своё помещение.' },
      { id: 'cells', name: 'Камеры ИВС', desc: 'Не дать выпустить задержанных.' },
      { id: 'armory', name: 'Оружейку', desc: 'Не дать добраться до оружия и патронов.' },
      { id: 'generator', name: 'Генератор', desc: 'Без генератора и щитка — темнота и мёртвые камеры наблюдения.' },
      { id: 'commander', name: 'Командира', desc: 'Держаться рядом с вами и прикрывать.' },
    ],
    default: 'none',
  },
  aid: {
    name: 'Раненые',
    desc: 'Помогать ли раненым товарищам во время боя.',
    options: [
      { id: 'safe', name: 'Когда можно', desc: 'Перевязывать, если рядом нет огня.' },
      { id: 'always', name: 'Всегда', desc: 'Вытаскивать своих даже под огнём.' },
      { id: 'never', name: 'После боя', desc: 'Никто не покидает позицию.' },
    ],
    default: 'safe',
  },
  gas: {
    name: '«Черёмуха»',
    desc: 'Разрешить применять слезоточивые гранаты со склада при штурме и обороне.',
    options: [{ id: true, name: 'Разрешено', desc: '' }, { id: false, name: 'Запрещено', desc: '' }],
    default: true,
  },
  barricade: {
    name: 'Баррикадировать',
    desc: 'Командир сам заваливает мебелью двери своего помещения, ведущие наружу, при объявлении осады.',
    options: [{ id: true, name: 'Да', desc: '' }, { id: false, name: 'Нет', desc: '' }],
    default: false,
  },
  posts: { name: 'Посты', desc: 'Необязательно: конкретные точки (post_*), которые командир займёт в первую очередь.', type: 'points', default: [] },
  watch: { name: 'Секторы', desc: 'Необязательно: двери/окна (id), за которыми следить особо.', type: 'doors', default: [] },
  note: { name: 'Примечание', desc: 'Свободный текст приказа (для журнала).', type: 'text', default: '' },
};

export const DOCTRINE_FIELDS = ['hold', 'fallbackAt', 'fallbackZone', 'roe', 'priority', 'protect', 'aid', 'gas', 'barricade', 'posts', 'watch', 'note'];

export function defaultDoctrine() {
  const d = {};
  for (const k of DOCTRINE_FIELDS) { const v = DOCTRINES[k].default; d[k] = Array.isArray(v) ? [] : v; }
  return d;
}

/** Привести доктрину к допустимым значениям (от UI может прийти что угодно). */
export function normalizeDoctrine(src = {}) {
  const d = defaultDoctrine();
  if (!src || typeof src !== 'object') return d;
  const pick = (k) => { const opts = DOCTRINES[k].options; if (src[k] === undefined) return; if (!opts || opts.some((o) => o.id === src[k])) d[k] = src[k]; };
  ['hold', 'roe', 'priority', 'protect', 'aid'].forEach(pick);
  if (typeof src.fallbackAt === 'number' && isFinite(src.fallbackAt)) d.fallbackAt = Math.max(0.05, Math.min(0.95, src.fallbackAt));
  if (src.fallbackZone === null || ZONE_INFO[src.fallbackZone]) d.fallbackZone = src.fallbackZone ?? null;
  if (typeof src.gas === 'boolean') d.gas = src.gas;
  if (typeof src.barricade === 'boolean') d.barricade = src.barricade;
  if (Array.isArray(src.posts)) d.posts = src.posts.filter((p) => typeof p === 'string').slice(0, 8);
  if (Array.isArray(src.watch)) d.watch = src.watch.filter((p) => typeof p === 'string' || typeof p === 'number').slice(0, 8);
  if (typeof src.note === 'string') d.note = src.note.slice(0, 300);
  return d;
}

const optName = (k, v) => (DOCTRINES[k].options.find((o) => o.id === v) || {}).name || String(v);
/** Человеческое описание приказа: «Держать вестибюль. При потере трети — отход в коридор. Огонь: только ответный.» */
export function describeDoctrine(group) {
  const d = normalizeDoctrine(group && group.doctrine);
  const zone = zoneLabel(group && group.zoneId, 'short');
  const parts = [];
  if (d.hold === 'retake') parts.push(`Отбить ${zone}`);
  else if (d.hold === 'counter') parts.push(`Активно оборонять ${zone}, контратаковать`);
  else parts.push(`Держать ${zone}`);
  if (d.hold === 'fallback') parts.push(`при потерях «${optName('fallbackAt', d.fallbackAt).toLowerCase()}» — отход ${d.fallbackZone ? zoneLabel(d.fallbackZone, 'to') : 'по решению командира'}`);
  parts.push(`огонь: ${optName('roe', d.roe).toLowerCase()}`);
  if (d.priority !== 'nearest') parts.push(`цели: ${optName('priority', d.priority).toLowerCase()}`);
  if (d.protect !== 'none') parts.push(`стеречь: ${optName('protect', d.protect).toLowerCase()}`);
  if (d.note) parts.push(d.note);
  return parts.join('; ') + '.';
}

/** Уровни тревоги */
export const ALERT_LEVELS = {
  normal: { name: 'Обычный режим', desc: 'Участок живёт своей жизнью. При нападении люди застигнуты врасплох: кто пьёт чай, кто в туалете.', reaction: 2.2, perception: 0.65 },
  raised: { name: 'Усиление', desc: 'Все при оружии и настороже, держатся ближе к своим помещениям. Реакция быстрее, но люди устают.', reaction: 0.9, perception: 0.9 },
  siege:  { name: 'Осада', desc: 'Группы обороны на постах, двери заперты и заставлены. Посетителей не пускают. Долго так не простоишь: усталость и нервы.', reaction: 0.35, perception: 1.0 },
};

/** Роли бандитов (для отладки/UI разведки) */
export const BANDIT_ROLES = {
  leader:    { name: 'Главарь', desc: 'Ведёт отряд, решает, когда ломиться и когда уходить.' },
  assault:   { name: 'Штурм', desc: 'Ломает двери и врывается внутрь.' },
  support:   { name: 'Прикрытие', desc: 'Из укрытий на улице держит окна под огнём.' },
  liberator: { name: 'Освободитель', desc: 'Прорывается к ИВС и открывает камеры.' },
  arsonist:  { name: 'Поджигатель', desc: 'Кидает бутылки с бензином в окна.' },
  sniper:    { name: 'Стрелок', desc: 'Бьёт из карабина с крыши киоска через окна.' },
  freed:     { name: 'Освобождённый', desc: 'Выпущенный из камеры, дерётся чем придётся.' },
};

/**
 * Профили группировок. skill — меткость 0..1; disc — дисциплина (бой по укрытиям, порядок отхода);
 * morale — стартовый боевой дух; breakAt — порог отступления; routAt — бегство;
 * surrender — склонность сдаваться; weapons[tier] — веса оружия; grenade/molotov — шанс на человека.
 */
export const GANG_TACTICS = {
  afghan: {
    name: '«Афганцы»', look: 'bandit_camo', hats: ['none', 'beanie', 'mask'],
    skill: [0.55, 0.75], disc: 0.85, courage: 0.75, aggression: 0.55, morale: 0.82, breakAt: 0.32, routAt: 0.14, surrender: 0.05,
    weapons: { 1: { tt: 3, pm: 3, shotgun: 2, aks74u: 1 }, 2: { aks74u: 4, tt: 2, pm: 2, shotgun: 1 }, 3: { aks74u: 7, rifle: 1, tt: 1 } },
    melee: 'knife', grenade: [0.08, 0.22, 0.38], molotov: [0, 0, 0], armor: [0, 0.15, 0.4],
    entry: { front: 0.25, back: 0.25, both: 0.5 }, sizeMul: 0.8,
    roles: { support: 0.3, liberator: 0.12, arsonist: 0, sniper: 0.12 },
    tactic: 'Дисциплинированно: подавляют окна, обходят с двух сторон, режут свет, перед входом — граната.',
    stealth: true, bounding: true, cutPower: true, parley: false,
  },
  sport: {
    name: '«Спортсмены»', look: 'bandit_track', hats: ['none', 'none', 'beanie'],
    skill: [0.3, 0.5], disc: 0.35, courage: 0.7, aggression: 0.85, morale: 0.72, breakAt: 0.38, routAt: 0.2, surrender: 0.2,
    weapons: { 1: { bat: 5, knife: 2, tt: 2, sawnoff: 1 }, 2: { bat: 3, tt: 3, pm: 2, sawnoff: 2, shotgun: 1 }, 3: { tt: 3, sawnoff: 2, aks74u: 2, bat: 2, pm: 1 } },
    melee: 'bat', grenade: [0, 0, 0.05], molotov: [0, 0.03, 0.05], armor: [0, 0, 0.1],
    entry: { front: 0.7, back: 0.15, both: 0.15 }, sizeMul: 1.2,
    roles: { support: 0.12, liberator: 0.1, arsonist: 0, sniper: 0 },
    tactic: 'Нахрапом: толпой к главному входу, ломают двери и лезут врукопашную.',
    stealth: false, bounding: false, cutPower: false, parley: false,
  },
  thieves: {
    name: '«Блатные»', look: 'bandit_leather', hats: ['none', 'cap', 'none'],
    skill: [0.38, 0.55], disc: 0.6, courage: 0.55, aggression: 0.45, morale: 0.64, breakAt: 0.4, routAt: 0.2, surrender: 0.3,
    weapons: { 1: { tt: 3, knife: 3, sawnoff: 2, pm: 1 }, 2: { tt: 4, pm: 2, sawnoff: 2, shotgun: 1 }, 3: { tt: 3, pm: 2, aks74u: 2, sawnoff: 1 } },
    melee: 'knife', grenade: [0, 0, 0.05], molotov: [0, 0, 0], armor: [0, 0.05, 0.1],
    entry: { front: 0.8, back: 0.1, both: 0.1 }, sizeMul: 0.9,
    roles: { support: 0.2, liberator: 0.3, arsonist: 0, sniper: 0 },
    tactic: 'Сначала разговор: ультиматум по рации — «выдайте нашего, и уйдём». Если штурм — рвутся к камерам и уходят со своими.',
    stealth: true, bounding: false, cutPower: false, parley: true,
  },
  drugs: {
    name: '«Наркоторговцы»', look: 'junkie', hats: ['none', 'beanie'],
    skill: [0.22, 0.4], disc: 0.3, courage: 0.35, aggression: 0.5, morale: 0.48, breakAt: 0.5, routAt: 0.3, surrender: 0.45,
    weapons: { 1: { knife: 4, tt: 2, sawnoff: 1 }, 2: { tt: 3, knife: 2, shotgun: 2, pm: 1 }, 3: { tt: 3, aks74u: 2, shotgun: 2 } },
    melee: 'knife', grenade: [0, 0, 0], molotov: [0, 0.05, 0.08], armor: [0, 0, 0],
    entry: { front: 0.3, back: 0.5, both: 0.2 }, sizeMul: 0.8,
    roles: { support: 0.25, liberator: 0.25, arsonist: 0.05, sniper: 0 },
    tactic: 'Трусливо: стреляют издалека, при первых потерях разбегаются.',
    stealth: true, bounding: false, cutPower: false, parley: false,
  },
  frostbitten: {
    name: '«Отморозки»', look: 'bandit_leather', hats: ['mask', 'beanie', 'none'],
    skill: [0.3, 0.55], disc: 0.2, courage: 0.85, aggression: 0.95, morale: 0.7, breakAt: 0.3, routAt: 0.12, surrender: 0.05,
    weapons: { 1: { sawnoff: 3, bat: 2, tt: 2, knife: 1 }, 2: { sawnoff: 3, tt: 2, shotgun: 2, aks74u: 1 }, 3: { aks74u: 3, sawnoff: 2, shotgun: 2, tt: 1 } },
    melee: 'bat', grenade: [0, 0.05, 0.12], molotov: [0.3, 0.4, 0.45], armor: [0, 0, 0.05],
    entry: { front: 0.4, back: 0.3, both: 0.3 }, sizeMul: 1.0,
    roles: { support: 0.15, liberator: 0.1, arsonist: 0.3, sniper: 0 },
    tactic: 'Непредсказуемо: поджигают, добивают раненых, могут сдаться понарошку.',
    stealth: false, bounding: false, cutPower: false, parley: false, chaotic: true,
  },
};
export const GANG_TYPES = Object.keys(GANG_TACTICS);
export function gangTactics(type) { return GANG_TACTICS[type] || GANG_TACTICS.sport; }
