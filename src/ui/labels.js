// Русские подписи перечислений, описание приказов и доктрин, запасные справочники.
// Если соответствующий модуль даёт свои справочники (TRAITS, ITEMS, DOCTRINES, taskTypes) — используются они.

import { ROOMS, OUTDOOR } from '../world/level.js';

export const STATION_NAME = 'ОТДЕЛЕНИЕ МИЛИЦИИ № 14';
export function cityName(game) { return game?.state?.city?.name || 'Н-ска'; }
export function headerLine(game) { return `ГУВД г. ${cityName(game)} · ${STATION_NAME}`; }

// ——— персонал ———
export const ROLE_NAMES = {
  pps: 'Патрульно-постовая служба', oper: 'Оперуполномоченный', duty: 'Дежурный', uchastkovy: 'Участковый инспектор',
  driver: 'Водитель', guard: 'Конвой ИВС', kinolog: 'Кинолог',
};
export const ROLE_SHORT = { pps: 'ППС', oper: 'опер', duty: 'дежурный', uchastkovy: 'участковый', driver: 'водитель', guard: 'конвой', kinolog: 'кинолог' };
export const RANK_SHORT = {
  'рядовой': 'ряд.', 'младший сержант': 'мл. с-т', 'сержант': 'с-т', 'старший сержант': 'ст. с-т', 'старшина': 'ст-на',
  'прапорщик': 'пр-к', 'старший прапорщик': 'ст. пр-к', 'младший лейтенант': 'мл. л-т', 'лейтенант': 'л-т',
  'старший лейтенант': 'ст. л-т', 'капитан': 'к-н', 'майор': 'м-р', 'подполковник': 'п/п-к',
};
export const RANK_IDS = {
  private: 'рядовой', jr_sergeant: 'младший сержант', sergeant: 'сержант', sr_sergeant: 'старший сержант', starshina: 'старшина',
  praporshchik: 'прапорщик', sr_praporshchik: 'старший прапорщик', jr_lieutenant: 'младший лейтенант', lieutenant: 'лейтенант',
  sr_lieutenant: 'старший лейтенант', captain: 'капитан', major: 'майор', lt_colonel: 'подполковник',
};
export const RANK_ORDER = ['рядовой', 'младший сержант', 'сержант', 'старший сержант', 'старшина', 'прапорщик', 'старший прапорщик', 'младший лейтенант', 'лейтенант', 'старший лейтенант', 'капитан', 'майор', 'подполковник'];
export function rankName(r) { if (!r) return ''; if (typeof r === 'object') return r.name || r.id || ''; return RANK_IDS[r] || r; }
export function rankShort(r) { const n = rankName(r); return RANK_SHORT[n] || n; }

const ST = {
  station: ['на участке', 'на участке'], task: ['на задании', 'на задании'], home: ['дома', 'дома'],
  hospital: ['в больнице', 'в больнице'], dead: ['погиб', 'погибла'], fired: ['уволен', 'уволена'],
  missing: ['пропал без вести', 'пропала без вести'], leave: ['в отпуске', 'в отпуске'],
};
export function statusName(s, gender) { const v = ST[s]; return v ? v[gender === 'f' ? 1 : 0] : (s || '—'); }
export const STATUS_TONE = { station: 'ok', task: 'blue', home: 'dim', hospital: 'bad', dead: 'dead', fired: 'dim', missing: 'bad', leave: 'dim' };

export const SKILL_NAMES = {
  shooting: 'Огневая подготовка', tactics: 'Тактика', perception: 'Наблюдательность', fitness: 'Физподготовка',
  discipline: 'Дисциплина', talk: 'Работа с людьми', investigation: 'Розыск и следствие', driving: 'Вождение',
};
export const SKILL_SHORT = { shooting: 'Стр', tactics: 'Так', perception: 'Наб', fitness: 'Физ', discipline: 'Дис', talk: 'Общ', investigation: 'Рзс', driving: 'Вжд' };

/** Запасной справочник черт (если staff.TRAITS недоступен). good: true — достоинство, false — недостаток, null — смешанное */
export const TRAITS_FALLBACK = [
  { id: 'coward', name: 'Трус', good: false, desc: 'Под огнём теряется, первым отходит. Зато не полезет туда, откуда не вернётся.' },
  { id: 'hothead', name: 'Горячий', good: null, desc: 'Вспыльчив, лезет вперёд, легко хватается за оружие. Смел, но рискует нарядом.' },
  { id: 'pedant', name: 'Педант', good: true, desc: 'Бумаги в порядке, протоколы без ошибок. Медлителен, но дела доводит до суда.' },
  { id: 'drinker', name: 'Пьющий', good: false, desc: 'Выпивает. Иногда опаздывает, иногда приходит с запахом. Может сорваться.' },
  { id: 'honest', name: 'Честный', good: true, desc: 'Взяток не берёт и не покрывает. С «крышами» не договаривается — ни за что.' },
  { id: 'greedy', name: 'Жадный', good: false, desc: 'Любит деньги. Склонен брать «на лапу» и подрабатывать на стороне.' },
  { id: 'afghan', name: 'Ветеран Афгана', good: true, desc: 'Прошёл Афганистан. Спокоен под огнём, хорошо стреляет. Бывают тяжёлые ночи.' },
  { id: 'chechnya', name: 'Прошёл Чечню', good: null, desc: 'Командировка в Чечню. Опыт боя есть, нервы — уже не те. Пьёт или молчит.' },
  { id: 'family_man', name: 'Семьянин', good: true, desc: 'Жена, дети. Осторожен, не рискует понапрасну. Тяжело переносит задержки зарплаты.' },
  { id: 'rookie', name: 'Салага', good: false, desc: 'Только из учебки. Многого не знает, легко пугается, но быстро учится.' },
  { id: 'veteran', name: 'Старый служака', good: true, desc: 'Двадцать лет в органах. Знает район и людей, но устаёт быстрее молодых.' },
  { id: 'lucky', name: 'Везучий', good: true, desc: 'Пули обходят стороной. Объяснить никто не может.' },
  { id: 'marksman', name: 'Снайпер', good: true, desc: 'Отличный стрелок. Попадает с первого выстрела.' },
  { id: 'talker', name: 'Болтун', good: null, desc: 'Язык без костей. Разговорит кого угодно, но и лишнего сболтнёт.' },
  { id: 'silent', name: 'Молчун', good: null, desc: 'Говорит мало, по делу. Не выдаст, но и душу не откроет.' },
  { id: 'sadist', name: 'Жестокий', good: false, desc: 'Любит «работать руками». На допросах результат есть, жалоб и проблем — больше.' },
  { id: 'kind', name: 'Добряк', good: null, desc: 'Жалеет людей. Его любят жители, но жуликам он тоже верит.' },
  { id: 'lazy', name: 'Лентяй', good: false, desc: 'Работает, только когда смотрят. Быстро «отдыхает» на посту.' },
  { id: 'ambitious', name: 'Карьерист', good: null, desc: 'Хочет звёзд на погоны. Старается на виду, может подсидеть.' },
  { id: 'superstitious', name: 'Суеверный', good: null, desc: 'Верит в приметы. Чёрная кошка через дорогу — и наряд уже нервничает.' },
  { id: 'athlete', name: 'Спортсмен', good: true, desc: 'Бывший спортсмен. Вынослив, быстро бегает, крепок в рукопашной.' },
  { id: 'sick', name: 'Больной', good: false, desc: 'Здоровье подводит. Чаще берёт больничный, быстрее устаёт.' },
  { id: 'sharp', name: 'Глазастый', good: true, desc: 'Замечает то, мимо чего проходят другие. Находит улики и засады.' },
  { id: 'leader', name: 'Прирождённый командир', good: true, desc: 'Люди за ним идут. Наряд под его началом держится лучше.' },
];
const GOOD_TRAITS = new Set(TRAITS_FALLBACK.filter((t) => t.good === true).map((t) => t.id));
const BAD_TRAITS = new Set(TRAITS_FALLBACK.filter((t) => t.good === false).map((t) => t.id));
export function traitTone(id) { return GOOD_TRAITS.has(id) ? 'good' : BAD_TRAITS.has(id) ? 'bad' : 'mixed'; }

// ——— снаряжение ———
export const WEAPON_NAMES = {
  pm: 'ПМ', aks74u: 'АКС-74У', ks23: 'КС-23', tt: 'ТТ', shotgun: 'ружьё', sawnoff: 'обрез', knife: 'нож', bat: 'бита', none: 'без оружия',
};
export const WEAPON_FULL = {
  pm: 'Пистолет Макарова', aks74u: 'Автомат АКС-74У', ks23: 'Карабин КС-23', tt: 'Пистолет ТТ', shotgun: 'Охотничье ружьё',
  sawnoff: 'Обрез', knife: 'Нож', bat: 'Бита', none: 'Без оружия',
};
export const WEAPON_AMMO = { pm: '9x18', aks74u: '5.45x39', ks23: '12ga', tt: '7.62x25', shotgun: '12ga' };
export const ARMOR_NAMES = { none: 'без бронежилета', vest: 'бронежилет', heavy: 'тяжёлый бронежилет' };
export const AMMO_NAMES = { '9x18': '9×18 (ПМ)', '5.45x39': '5,45×39 (АКС)', '12ga': '23 мм / 12 кал. (КС-23)', '7.62x25': '7,62×25 (ТТ)' };
export const ARMED_NAMES = { none: 'без оружия', knife: 'нож', bat: 'бита', pistol: 'пистолет', rifle: 'автомат', shotgun: 'обрез/ружьё' };

/** Запасной каталог (если economy.ITEMS недоступен) */
export const ITEMS_FALLBACK = [
  { id: 'pm', name: 'Пистолет ПМ', kind: 'weapon', price: 900, days: 3, desc: 'Табельный 9 мм. Надёжен, слабоват против бронежилета.' },
  { id: 'aks74u', name: 'Автомат АКС-74У', kind: 'weapon', price: 2600, days: 5, desc: '«Ксюха». Плотный огонь на короткой дистанции.' },
  { id: 'ks23', name: 'Карабин КС-23', kind: 'weapon', price: 2100, days: 6, desc: 'Спецкарабин 23 мм. Останавливает любого, вышибает двери.' },
  { id: 'vest', name: 'Бронежилет 6Б2', kind: 'armor', price: 1400, days: 4, desc: 'Защищает от пистолетных пуль и осколков.' },
  { id: 'heavy', name: 'Бронежилет «Кора-Кулон»', kind: 'armor', price: 3200, days: 7, desc: 'Тяжёлый, держит автоматную пулю. Утомляет.' },
  { id: 'helmet', name: 'Шлем «Сфера»', kind: 'helmet', price: 1100, days: 5, desc: 'Титановый шлем для штурмовых групп.' },
  { id: 'radio', name: 'Рация «Кайра»', kind: 'radio', price: 700, days: 4, desc: 'Носимая рация. Без неё наряд докладывает с телефона-автомата.' },
  { id: 'ammo_9x18', name: 'Патроны 9×18, 16 шт.', kind: 'ammo', ammoType: '9x18', pack: 16, price: 40, days: 2 },
  { id: 'ammo_545', name: 'Патроны 5,45×39, 30 шт.', kind: 'ammo', ammoType: '5.45x39', pack: 30, price: 90, days: 3 },
  { id: 'ammo_12', name: 'Патроны КС-23, 10 шт.', kind: 'ammo', ammoType: '12ga', pack: 10, price: 120, days: 4 },
  { id: 'fuel', name: 'Бензин АИ-76, 100 л', kind: 'fuel', price: 260, days: 1 },
  { id: 'medkit', name: 'Аптечка АИ-2', kind: 'medical', price: 90, days: 2 },
  { id: 'cuffs', name: 'Наручники БР-С', kind: 'gear', price: 60, days: 2 },
];
export const ITEM_KIND_NAMES = {
  weapon: 'Оружие', armor: 'Бронезащита', helmet: 'Шлемы', radio: 'Связь', ammo: 'Боеприпасы', fuel: 'Горючее',
  medical: 'Медицина', gear: 'Спецсредства', vehicle: 'Транспорт', repair: 'Ремонт', food: 'Быт', other: 'Прочее',
};
export const UPGRADES_FALLBACK = [
  { id: 'bars_windows', name: 'Решётки на окна', price: 1800, days: 3, desc: 'Через окна первого этажа не залезть. Стрелять сквозь решётку — можно.' },
  { id: 'steel_front', name: 'Стальная входная дверь', price: 2400, days: 4, desc: 'Главный вход выдержит намного дольше.' },
  { id: 'cameras', name: 'Видеонаблюдение', price: 5200, days: 6, desc: 'Камеры по периметру и в коридоре. На схеме участка видно противника.' },
  { id: 'generator2', name: 'Ремонт генератора', price: 1500, days: 2, desc: 'Аварийный свет держится дольше, генератор не глохнет.' },
  { id: 'cell_locks', name: 'Новые замки камер', price: 900, days: 2, desc: 'Задержанных сложнее освободить.' },
  { id: 'alarm', name: 'Тревожная кнопка на пульт ГУВД', price: 1200, days: 3, desc: 'При нападении подкрепление приедет быстрее.' },
];

// ——— город ———
export const DISTRICT_NAMES = { rynok: 'Рынок', vokzal: 'Вокзал', promzona: 'Промзона', cheremushki: 'Черёмушки', centr: 'Центр', chastnyi: 'Частный сектор' };
export const GANG_TYPES = { sport: 'спортсмены', afghan: 'афганцы', thieves: 'блатные', drugs: 'наркоторговцы', frostbitten: 'отморозки' };
export const GANG_COLORS = { sport: '#2f5fa8', afghan: '#5d6b2c', thieves: '#5b2d6e', drugs: '#1f7a72', frostbitten: '#1b1b1b' };
export const CRIME_CATS = {
  violent: 'насильственное', property: 'имущественное', drugs: 'наркотики', organized: 'организованная преступность',
  public_order: 'общественный порядок', economic: 'экономическое', domestic: 'бытовое', traffic: 'ДТП', other: 'прочее',
};
export const CRIME_STATUS = { new: 'новое', responding: 'выехали', resolved: 'раскрыто', unsolved: 'не раскрыто' };
export const MOOD_NAMES = { angry: 'зол', scared: 'напуган', crying: 'в слезах', drunk: 'пьян', calm: 'спокоен', shifty: 'бегающий взгляд' };
export const MOOD_NAMES_F = { angry: 'зла', scared: 'напугана', crying: 'в слезах', drunk: 'пьяна', calm: 'спокойна', shifty: 'бегающий взгляд' };

// ——— задания ———
export const TASK_TYPES_FALLBACK = [
  { id: 'patrol', name: 'Патрулирование', desc: 'Пройти район, показать присутствие, пресекать мелочь. Снижает преступность и повышает доверие.', minOfficers: 2, maxOfficers: 4, needsPlace: false, needsTarget: false },
  { id: 'guard', name: 'Охрана объекта', desc: 'Выставить пост у конкретного места: банк, рынок, школа, ларьки.', minOfficers: 1, maxOfficers: 3, needsPlace: true, needsTarget: false },
  { id: 'ambush', name: 'Засада', desc: 'Скрытно ждать преступников там, где их ждут. Требует терпения и наводки.', minOfficers: 2, maxOfficers: 5, needsPlace: true, needsTarget: false },
  { id: 'raid', name: 'Рейд / облава', desc: 'Жёсткая проверка точки: притон, точка сбыта, «база» группировки.', minOfficers: 3, maxOfficers: 6, needsPlace: true, needsTarget: false },
  { id: 'investigate', name: 'Расследование', desc: 'Работа по преступлению: опрос свидетелей, улики, розыск подозреваемых.', minOfficers: 1, maxOfficers: 3, needsPlace: false, needsTarget: true },
  { id: 'respond', name: 'Выезд на происшествие', desc: 'Срочно выехать на вызов: драка, кража, стрельба.', minOfficers: 2, maxOfficers: 4, needsPlace: false, needsTarget: true },
  { id: 'escort', name: 'Сопровождение', desc: 'Конвой задержанного, инкассаторов или свидетеля.', minOfficers: 2, maxOfficers: 4, needsPlace: true, needsTarget: false },
  { id: 'search', name: 'Розыск', desc: 'Найти человека: подозреваемого, пропавшего, свидетеля.', minOfficers: 2, maxOfficers: 4, needsPlace: false, needsTarget: true },
];
export const PHASE_NAMES = { departing: 'сборы', enroute: 'в пути', active: 'на месте', returning: 'возвращается', done: 'завершено' };

/** Общие приказы (ключи — по контракту Task.orders) */
export const ORDERS_GENERAL = [
  { key: 'stance', label: 'Манера действий', def: 'normal', options: [
    { id: 'cautious', label: 'Осторожно', desc: 'Не лезть на рожон, при угрозе ждать подкрепления или отходить.' },
    { id: 'normal', label: 'По уставу', desc: 'Действовать по обстановке и по уставу.' },
    { id: 'aggressive', label: 'Жёстко', desc: 'Давить, преследовать, задерживать любой ценой. Быстрее, но опаснее.' },
  ] },
  { key: 'force', label: 'Применение оружия', def: 'proportional', options: [
    { id: 'return_fire', label: 'Только в ответ', desc: 'Огонь — только если по наряду уже стреляют.' },
    { id: 'proportional', label: 'Соразмерно', desc: 'По закону: окрик, предупредительный, затем на поражение по вооружённым.' },
    { id: 'free', label: 'По усмотрению', desc: 'Старший решает сам. Меньше риска для наряда — больше вопросов от прокуратуры.' },
  ] },
  { key: 'detain', label: 'Задерживать', def: 'serious', options: [
    { id: 'all', label: 'Всех подозрит.', desc: 'Тащить в отделение всех подозрительных. Камеры заполнятся быстро.' },
    { id: 'serious', label: 'По тяжким', desc: 'Задерживать по серьёзным составам, мелочь — протокол на месте.' },
    { id: 'none', label: 'Никого', desc: 'Только наблюдать и докладывать. Не спугнуть.' },
  ] },
];
export const ORDERS_DETAIL = [
  { key: 'respondCalls', label: 'Откликаться на вызовы по пути', type: 'bool', def: true, desc: 'Если дежурный передаст вызов рядом — наряд поедет.' },
  { key: 'reportEvery', label: 'Доклад по рации', def: 60, options: [
    { id: 30, label: 'каждые 30 мин' }, { id: 60, label: 'каждый час' }, { id: 120, label: 'раз в 2 часа' },
  ] },
  { key: 'retreatOnWounded', label: 'Раненый — немедленный отход', type: 'bool', def: true, desc: 'Если кого-то ранят, наряд прекращает задание и везёт раненого.' },
];
/** Дополнительные детали (пишутся в orders.details) */
export const ORDER_DETAILS = [
  { key: 'siren', label: 'Сирена и маячок', def: 'urgent', options: [
    { id: 'always', label: 'всегда' }, { id: 'urgent', label: 'по срочным' }, { id: 'never', label: 'не включать' },
  ] },
  { key: 'dress', label: 'Форма одежды', def: 'uniform', options: [
    { id: 'uniform', label: 'форменная' }, { id: 'civil', label: 'в штатском' },
  ] },
  { key: 'route', label: 'Маршрут', def: 'main', options: [
    { id: 'main', label: 'главные улицы' }, { id: 'yards', label: 'дворы, подворотни' }, { id: 'random', label: 'непредсказуемо' },
  ] },
  { key: 'people', label: 'Работа с населением', def: 'talk', options: [
    { id: 'none', label: 'не отвлекаться' }, { id: 'talk', label: 'опрашивать' }, { id: 'informants', label: 'выйти на осведомителей' },
  ] },
  { key: 'pursuit', label: 'Преследование', def: 'district', options: [
    { id: 'none', label: 'не преследовать' }, { id: 'district', label: 'в пределах района' }, { id: 'far', label: 'до конца' },
  ] },
  { key: 'warning', label: 'Предупредительный выстрел', def: true, type: 'bool' },
  { key: 'cuffs', label: 'Наручники', def: 'resist', options: [
    { id: 'always', label: 'на всех' }, { id: 'resist', label: 'на сопротивляющихся' },
  ] },
  { key: 'vehicleUse', label: 'Машина', def: 'near', options: [
    { id: 'near', label: 'водитель у машины' }, { id: 'patrol', label: 'объезд на машине' }, { id: 'drop', label: 'высадить и уехать' },
  ] },
  { key: 'backup', label: 'Подкрепление', def: 'critical', options: [
    { id: 'early', label: 'просить сразу' }, { id: 'critical', label: 'только в крайнем случае' }, { id: 'never', label: 'справляться сами' },
  ] },
  { key: 'radioSilence', label: 'Радиомолчание (только экстренное)', def: false, type: 'bool' },
  { key: 'alcohol', label: 'Изымать спиртное у ларьков без лицензии', def: false, type: 'bool' },
  { key: 'docs', label: 'Проверка документов у приезжих', def: false, type: 'bool' },
];
/** Специфичные для типа задания (если taskTypes() не задаёт свои orderOptions) */
export const TYPE_ORDERS = {
  patrol: [{ key: 'focus', label: 'Упор при патрулировании', def: 'visible', options: [
    { id: 'visible', label: 'Присутствие', desc: 'Ходить на виду: жители спокойнее, мелкие воришки разбегаются.' },
    { id: 'stealth', label: 'Скрытно', desc: 'Без лишнего шума, ловить на горячем.' },
    { id: 'checks', label: 'Проверка документов', desc: 'Тормошить приезжих и подозрительных.' },
    { id: 'kiosks', label: 'Ларьки', desc: 'Проверить ларьки и точки — кто платит «крыше», кто торгует палёной водкой.' },
    { id: 'drunks', label: 'Пьяные', desc: 'Собирать пьяных и хулиганов. Камеры заполнятся.' },
    { id: 'drugs', label: 'Наркотики', desc: 'Притоны, закладки, «точки» на дискотеках.' },
    { id: 'cars', label: 'Автотранспорт', desc: 'Проверять машины без номеров и угнанные «девятки».' },
  ] }],
  guard: [{ key: 'focus', label: 'Как охранять', def: 'post', options: [
    { id: 'post', label: 'Пост у входа', desc: 'Стоять на виду — отпугивает, но и стрелять будут сначала по вам.' },
    { id: 'perimeter', label: 'Обход', desc: 'Обходить объект по периметру.' },
    { id: 'hidden', label: 'Скрытно внутри', desc: 'Сидеть внутри и ждать гостей.' },
  ] }],
  ambush: [{ key: 'focus', label: 'Тактика засады', def: 'take', options: [
    { id: 'take', label: 'Брать сразу', desc: 'Задержать при попытке.' },
    { id: 'follow', label: 'Проследить', desc: 'Дать уйти и проследить до логова. Рискованно, но выведет на банду.' },
    { id: 'photo', label: 'Только наблюдать', desc: 'Запомнить лица и машины, ничего не предпринимать.' },
  ] }],
  raid: [{ key: 'focus', label: 'Вход', def: 'knock', options: [
    { id: 'knock', label: 'Постучать', desc: 'Представиться, предъявить. Успеют спустить в унитаз, но без пальбы.' },
    { id: 'quiet', label: 'Тихо', desc: 'Подойти незаметно, войти под видом сантехника.' },
    { id: 'storm', label: 'Штурм', desc: 'Выбить дверь и войти с оружием. Быстро и опасно.' },
  ] }],
  investigate: [{ key: 'focus', label: 'Упор следствия', def: 'witnesses', options: [
    { id: 'witnesses', label: 'Свидетели', desc: 'Обойти соседей, найти очевидцев.' },
    { id: 'evidence', label: 'Улики', desc: 'Осмотр места, следы, отпечатки.' },
    { id: 'suspects', label: 'Подозреваемые', desc: 'Сразу трясти известных по району.' },
    { id: 'informants', label: 'Осведомители', desc: 'Поспрашивать «своих» людей.' },
  ] }],
  respond: [{ key: 'focus', label: 'На месте', def: 'secure', options: [
    { id: 'secure', label: 'Пресечь и задержать', desc: 'Главное — остановить и взять.' },
    { id: 'help', label: 'Помощь пострадавшим', desc: 'Сначала люди, потом преступники.' },
    { id: 'chase', label: 'Преследование', desc: 'Не дать уйти, гнаться за подозреваемыми.' },
  ] }],
  escort: [{ key: 'focus', label: 'Порядок сопровождения', def: 'tight', options: [
    { id: 'tight', label: 'Плотно', desc: 'Не отходить от охраняемого ни на шаг.' },
    { id: 'scout', label: 'С разведкой', desc: 'Один впереди проверяет маршрут.' },
  ] }],
  search: [{ key: 'focus', label: 'Где искать', def: 'canvass', options: [
    { id: 'canvass', label: 'Поквартирный обход', desc: 'Медленно, но надёжно.' },
    { id: 'stations', label: 'Вокзалы, рынки', desc: 'Там, где проще затеряться.' },
    { id: 'hideouts', label: 'Притоны и «малины»', desc: 'Где прячутся свои.' },
    { id: 'relatives', label: 'Родня и знакомые', desc: 'К кому он мог пойти.' },
  ] }],
};
export const DURATIONS = [
  { id: 60, label: '1 ч' }, { id: 120, label: '2 ч' }, { id: 240, label: '4 ч' }, { id: 360, label: '6 ч' }, { id: 480, label: '8 ч' }, { id: 720, label: '12 ч' },
];
export const RETURN_AT = [
  { id: 'none', label: 'по выполнении' }, { id: 720, label: 'к 12:00' }, { id: 960, label: 'к 16:00' }, { id: 1200, label: 'к 20:00' },
  { id: 0, label: 'к 00:00' }, { id: 240, label: 'к 04:00' }, { id: 470, label: 'к разводу (07:50)' },
];

// ——— оборона ———
export const ALERT_LEVELS = [
  { id: 'normal', label: 'Обычный режим', desc: 'Обычный распорядок: дежурный за пультом, остальные по делам. Оружие — в оружейке.' },
  { id: 'raised', label: 'Повышенная готовность', desc: 'Все при оружии, посты заняты, на улицу без нужды не выходить. Люди устают быстрее.' },
  { id: 'siege', label: 'Осада', desc: 'Двери на запор, группы обороны на позициях, посетителей не пускать. Сильно выматывает.' },
];
export const DOCTRINE_FALLBACK = [
  { key: 'hold', label: 'Задача группы', def: 'hold', options: [
    { id: 'hold', label: 'Держать', desc: 'Удерживать зону до последнего. Не отходить без приказа.' },
    { id: 'fallback', label: 'Держать и отойти', desc: 'Держать, а при больших потерях отойти в запасную зону.' },
    { id: 'counter', label: 'Контратаковать', desc: 'Отбрасывать противника активными вылазками при первой возможности.' },
    { id: 'retake', label: 'Отбить зону', desc: 'Выдвинуться и выбить противника из занятой зоны.' },
  ] },
  { key: 'fallbackAt', label: 'Отход, когда в строю', def: 0.3, options: [
    { id: 0.7, label: '70%', desc: 'Беречь людей: отходить при первых потерях.' },
    { id: 0.5, label: 'половина', desc: 'Отходить, если выбыла половина группы.' },
    { id: 0.3, label: '30%', desc: 'Держаться, пока есть кому держать.' },
    { id: 0, label: 'не отходить', desc: 'Стоять насмерть.' },
  ] },
  { key: 'fallbackZone', label: 'Куда отходить', def: null, type: 'zone' },
  { key: 'roe', label: 'Огонь', def: 'free', options: [
    { id: 'free', label: 'По готовности', desc: 'Стрелять по любому вооружённому противнику.' },
    { id: 'return', label: 'Только в ответ', desc: 'Не начинать первыми. Шанс, что пройдут мимо.' },
    { id: 'hold_fire', label: 'Не стрелять', desc: 'Себя не выдавать до команды. Для засад внутри здания.' },
  ] },
  { key: 'priority', label: 'Цели в первую очередь', def: 'nearest', options: [
    { id: 'nearest', label: 'Ближайшие', desc: 'Кто ближе — тот опаснее.' },
    { id: 'armed', label: 'Вооружённые', desc: 'Сначала автоматчики и стрелки.' },
    { id: 'leader', label: 'Главарь', desc: 'Выбить командира — остальные дрогнут.' },
  ] },
  { key: 'protect', label: 'Прикрывать', def: 'none', options: [
    { id: 'none', label: '—', desc: 'Только своя зона.' },
    { id: 'cells', label: 'ИВС', desc: 'Не дать освободить задержанных.' },
    { id: 'armory', label: 'Оружейку', desc: 'Без оружейки не будет патронов.' },
    { id: 'generator', label: 'Генератор', desc: 'Без генератора погаснет свет.' },
    { id: 'commander', label: 'Командира', desc: 'Прикрывать вас лично.' },
  ] },
];
export const DOCTRINE_DETAILS = [
  { key: 'posture', label: 'Положение', def: 'cover', options: [
    { id: 'cover', label: 'из-за укрытий' }, { id: 'kneel', label: 'с колена' }, { id: 'prone', label: 'лёжа' },
  ] },
  { key: 'spread', label: 'Расстановка', def: 'wide', options: [
    { id: 'tight', label: 'плотно, у двери' }, { id: 'wide', label: 'рассредоточенно' },
  ] },
  { key: 'reload', label: 'Перезарядка', def: 'staggered', options: [
    { id: 'staggered', label: 'поочерёдно' }, { id: 'free', label: 'по готовности' },
  ] },
  { key: 'wounded', label: 'Раненых', def: 'evac', options: [
    { id: 'evac', label: 'выносить в тыл' }, { id: 'stay', label: 'оставаться на позиции' },
  ] },
  { key: 'pursue', label: 'Преследовать отходящих', def: false, type: 'bool' },
  { key: 'shout', label: 'Окрик перед огнём', def: true, type: 'bool' },
  { key: 'saveAmmo', label: 'Беречь патроны', def: false, type: 'bool' },
  { key: 'doors', label: 'Держать двери закрытыми', def: true, type: 'bool' },
  { key: 'lights', label: 'Погасить свет в зоне', def: false, type: 'bool' },
];
export const ZONES = [...ROOMS, ...OUTDOOR].map((r) => ({ id: r.id, name: r.name, indoor: !!ROOMS.find((x) => x.id === r.id) }));
export function zoneName(id) { return ZONES.find((z) => z.id === id)?.name || id || '—'; }
export const OWNER_NAMES = { police: 'наша', enemy: 'противник', contested: 'бой' };
export const ATTACK_RESULT = { repelled: 'Нападение отбито', occupied: 'Противник удерживает часть здания', fallen: 'Отделение пало' };

export const POST_NAMES = {
  post_front_lobby: 'Вестибюль, у входа', post_lobby_bench: 'Вестибюль, у скамеек', post_duty_window: 'Дежурка, у окна',
  post_corridor_w: 'Коридор, запад', post_corridor_c: 'Коридор, центр', post_corridor_e: 'Коридор, восток',
  post_generator: 'Генераторная', post_armory: 'Оружейная', post_ivs: 'ИВС', post_office: 'Кабинет начальника',
  post_rest_window: 'Комната отдыха, окно', post_porch: 'Крыльцо', post_yard: 'Двор',
};
export const STATION_ORDERS = [
  { id: 'follow', label: 'За мной', desc: 'Следовать за вами по участку.' },
  { id: 'post', label: 'Занять пост', desc: 'Встать на пост и не уходить.', needsPoint: true },
  { id: 'duty', label: 'Дежурить', desc: 'Сесть за пульт дежурного.' },
  { id: 'guard_cells', label: 'Охранять ИВС', desc: 'Сидеть у камер, следить за задержанными.' },
  { id: 'patrol_inside', label: 'Обход здания', desc: 'Ходить по коридорам и проверять двери.' },
  { id: 'rest', label: 'Отдыхать', desc: 'Чай, диван, телевизор. Снимает усталость.' },
  { id: 'home', label: 'Домой', desc: 'Отпустить домой до следующей смены.' },
];

// ——— допрос, разговор ———
export const APPROACHES = [
  { id: 'soft', label: 'По-хорошему', desc: 'Чай, сигарета, разговор по душам.' },
  { id: 'hard', label: 'Давить', desc: 'Громко, долго, без сна. Может «поплыть» — или замкнуться.' },
  { id: 'deal', label: 'Сделка', desc: 'Пообещать смягчение за сведения.' },
  { id: 'threat', label: 'Угрожать', desc: '«Посадим к блатным», «найдём родню». Работает на слабых.' },
  { id: 'cellmate', label: 'Подсадной', desc: 'Подсадить в камеру «своего» человека. Займёт время.' },
];
export const TALK_TOPICS = [
  { id: 'how_are_you', label: 'Как служба?', q: (o) => `— Как служится, ${o.lastName}?` },
  { id: 'family', label: 'О семье', q: () => '— Как дома, как семья?' },
  { id: 'work', label: 'О работе', q: () => '— Что думаешь о том, как у нас дела в отделении?' },
  { id: 'loyalty', label: 'Начистоту', q: () => '— Скажи прямо: мне можно на тебя положиться?' },
  { id: 'rumors', label: 'Слухи', q: () => '— Что говорят в отделении? Что слышно на районе?' },
  { id: 'drinking', label: 'Про выпивку', q: (o) => o.gender === 'f' ? '— От тебя опять пахло. Это последний раз?' : '— От тебя опять несло. Это последний раз?' },
];
export const REWARDS = [
  { id: 'thanks', label: 'Благодарность', desc: 'Объявить благодарность перед строем. Бесплатно.' },
  { id: 'bonus', label: 'Премия', desc: 'Денежная премия из фонда отделения.' },
  { id: 'dayoff', label: 'Отгул', desc: 'Выходной вне графика. Снимает усталость.' },
];
export const REPRIMANDS = [
  { id: 'verbal', label: 'Замечание', desc: 'Устно, с глазу на глаз.' },
  { id: 'written', label: 'Выговор', desc: 'Выговор с занесением в личное дело.' },
  { id: 'fine', label: 'Лишить премии', desc: 'Удержание из зарплаты (которую и так задерживают).' },
];
export const LEAVE_DAYS = [3, 7, 14];

export const EFFECT_NAMES = {
  morale: 'мораль', loyalty: 'лояльность', fatigue: 'усталость', stress: 'стресс', hp: 'здоровье', trust: 'доверие',
  money: 'деньги', cooperation: 'сотрудничество', danger: 'опасность', health: 'здоровье', corruption: 'коррупция', relations: 'отношения',
};
export const LOG_KINDS = { info: 'событие', combat: 'бой', staff: 'кадры', money: 'финансы', crime: 'преступление', radio: 'эфир', good: 'успех', bad: 'беда', task: 'наряд', detainee: 'ИВС' };

// ——— нормализация чужих справочников ———
/** Найти справочник по имени у модулей game */
export function gameData(game, name) {
  return game?.data?.[name] ?? game?.sim?.staff?.[name] ?? game?.sim?.economy?.[name] ?? game?.combat?.[name]
    ?? game?.combat?.constructor?.[name] ?? game?.sim?.city?.[name] ?? game?.sim?.detainees?.[name] ?? null;
}
function toArr(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  return Object.keys(x).map((k) => ({ id: k, ...(typeof x[k] === 'object' ? x[k] : { name: String(x[k]) }) }));
}
export function traitsList(game) {
  const t = toArr(gameData(game, 'TRAITS'));
  if (!t.length) return TRAITS_FALLBACK;
  return t.map((x) => ({ ...TRAITS_FALLBACK.find((f) => f.id === x.id), ...x }));
}
export function traitInfo(game, id) {
  return traitsList(game).find((t) => t.id === id) || TRAITS_FALLBACK.find((t) => t.id === id) || { id, name: id, desc: '' };
}
/** Цена и срок поставки: в данных они заданы по каналам ({official, commercial, black}); покупка идёт по самому дешёвому легальному каналу */
function cheapestChannel(price) {
  if (!price || typeof price !== 'object') return null;
  const legal = Object.keys(price).filter((c) => c !== 'black' && typeof price[c] === 'number');
  const pool = legal.length ? legal : Object.keys(price).filter((c) => typeof price[c] === 'number');
  return pool.length ? pool.sort((a, b) => price[a] - price[b])[0] : null;
}
function itemPrice(x) {
  const p = x.price ?? x.cost ?? 0;
  if (typeof p === 'number') return p;
  const ch = cheapestChannel(p); return ch ? Number(p[ch]) || 0 : 0;
}
function itemDays(x) {
  const d = x.deliveryDays ?? x.days ?? x.delivery ?? null;
  if (d == null || typeof d === 'number') return d;
  if (Array.isArray(d)) return Number(d[d.length - 1]) || null;
  if (typeof d === 'object') { const ch = cheapestChannel(x.price) || Object.keys(d)[0]; const r = d[ch] ?? Object.values(d)[0]; return Array.isArray(r) ? Number(r[r.length - 1]) || null : (typeof r === 'number' ? r : null); }
  return null;
}
export function normItem(x) {
  const kind = x.kind || x.slot || x.type || x.category || 'other';
  return {
    ...x, id: x.id, name: x.name || x.title || x.id, kind,
    price: itemPrice(x), days: itemDays(x), desc: x.desc || x.description || '',
  };
}
export function itemsList(game) {
  const raw = toArr(gameData(game, 'ITEMS'));
  return (raw.length ? raw : ITEMS_FALLBACK).map(normItem);
}
export function upgradesList(game) {
  const raw = toArr(gameData(game, 'UPGRADES'));
  return (raw.length ? raw : UPGRADES_FALLBACK).map(normItem);
}
export function itemName(game, id) { return itemsList(game).find((i) => i.id === id)?.name || WEAPON_FULL[id] || ARMOR_NAMES[id] || id; }

/** Привести описание опций (из DOCTRINES или orderOptions) к виду [{key,label,options,def,type,desc}] */
export function normOptionDefs(src) {
  if (!src) return [];
  const list = Array.isArray(src) ? src : Object.keys(src).map((k) => ({ key: k, ...(typeof src[k] === 'object' && !Array.isArray(src[k]) ? src[k] : { options: src[k] }) }));
  return list.filter((d) => d && typeof d === 'object').map((d) => {
    let opts = d.options ?? d.values ?? d.choices ?? null;
    if (opts && !Array.isArray(opts)) opts = Object.keys(opts).map((k) => ({ id: k, ...(typeof opts[k] === 'object' ? opts[k] : { label: String(opts[k]) }) }));
    if (opts) opts = opts.map((o) => (typeof o === 'object' ? { id: o.id ?? o.value, label: o.label ?? o.name ?? String(o.id ?? o.value), desc: o.desc ?? o.description ?? '' } : { id: o, label: String(o) }));
    return { key: d.key ?? d.id, label: d.label ?? d.name ?? d.key ?? d.id, desc: d.desc ?? '', def: d.def ?? d.default ?? (opts ? opts[0]?.id : null), type: d.type ?? (opts ? 'enum' : 'bool'), options: opts };
  }).filter((d) => d.key);
}

/** Доктрины обороны: из game.combat (DOCTRINES), дополненные запасным описанием */
export function doctrineDefs(game) {
  const src = normOptionDefs(gameData(game, 'DOCTRINES'));
  if (!src.length) return DOCTRINE_FALLBACK;
  const byKey = new Map(src.map((d) => [d.key, d]));
  const out = DOCTRINE_FALLBACK.map((f) => {
    const s = byKey.get(f.key); if (!s) return f;
    byKey.delete(f.key);
    return { ...f, ...s, options: s.options?.length ? s.options.map((o) => ({ ...(f.options?.find((x) => String(x.id) === String(o.id)) || {}), ...o, desc: o.desc || f.options?.find((x) => String(x.id) === String(o.id))?.desc || '' })) : f.options };
  });
  return [...out, ...byKey.values()].filter((d) => d.key !== 'note' && (d.type === 'bool' || d.type === 'zone' || (Array.isArray(d.options) && d.options.length)));
}
