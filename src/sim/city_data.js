// Статические данные симуляции города: склонения районов, группировки, типы заданий и их приказы, позывные.

/* ------------------------------------------------------------------ районы */
// Базовые данные (места, полигоны) — у агента A в DISTRICTS. Здесь — то, что нужно городу: падежи, дорога, достаток.
export const DISTRICT_INFO = {
  rynok: {
    forms: { nom: 'Рынок', prep: 'на Рынке', to: 'на Рынок', gen: 'Рынка', from: 'с Рынка' },
    travel: [6, 10], wealth: 5, crime: 55, trust: 30,
    color: 'ларьки, павильоны, челноки с клетчатыми сумками',
  },
  vokzal: {
    forms: { nom: 'Вокзал', prep: 'на Вокзале', to: 'на Вокзал', gen: 'Вокзала', from: 'с Вокзала' },
    travel: [8, 13], wealth: 4, crime: 60, trust: 25,
    color: 'приезжие, напёрсточники, пирожки, бомжи у тёплых решёток',
  },
  promzona: {
    forms: { nom: 'Промзона', prep: 'в Промзоне', to: 'в Промзону', gen: 'Промзоны', from: 'из Промзоны' },
    travel: [12, 18], wealth: 3, crime: 50, trust: 30,
    color: 'встающие заводы, гаражные кооперативы, склады',
  },
  cheremushki: {
    forms: { nom: 'Черёмушки', prep: 'в Черёмушках', to: 'в Черёмушки', gen: 'Черёмушек', from: 'из Черёмушек' },
    travel: [10, 15], wealth: 2, crime: 45, trust: 40,
    color: 'панельные девятиэтажки, школы, тёмные дворы',
  },
  centr: {
    forms: { nom: 'Центр', prep: 'в Центре', to: 'в Центр', gen: 'Центра', from: 'из Центра' },
    travel: [5, 8], wealth: 4, crime: 30, trust: 45,
    color: 'администрация, банки, коммерческие магазины',
  },
  chastnyi: {
    forms: { nom: 'Частный сектор', prep: 'в Частном секторе', to: 'в Частный сектор', gen: 'Частного сектора', from: 'из Частного сектора' },
    travel: [14, 20], wealth: 1, crime: 35, trust: 45,
    color: 'частные дома, дачи, грязь по колено',
  },
};
export const DISTRICT_IDS = ['rynok', 'vokzal', 'promzona', 'cheremushki', 'centr', 'chastnyi'];
export function dForm(id, form = 'nom') {
  const i = DISTRICT_INFO[id];
  return i ? i.forms[form] : (form === 'prep' ? 'в районе' : 'район');
}

/* ------------------------------------------------------------------ группировки */
export const GANG_TYPES = {
  sport: {
    label: 'спортсмены', aggression: 0.6, discipline: 0.5, skill: 0.9, morale: 0.55, surrender: 0.4, bribe: 0.5,
    racket: 1.2, drugs: 0.3, growth: 1.1, attackAt: 66, maxMembers: 45, tier: [1, 2], members: [18, 26],
    interest: { cheremushki: 1.4, rynok: 1.2, centr: 1.0, vokzal: 0.8, promzona: 0.7, chastnyi: 0.5 },
    uniform: 'bandit_track', hats: ['none', 'none', 'beanie'], pointKinds: ['bar', 'garage', 'office', 'shop', 'kiosk'],
    style: 'Братва в спортивных костюмах: «наезды» на ларьки, «стрелки», биты в багажниках «девяток». Стреляют редко, но всё чаще.',
  },
  afghan: {
    label: 'афганцы', aggression: 0.5, discipline: 0.9, skill: 1.35, morale: 0.75, surrender: 0.25, bribe: 0.3,
    racket: 0.9, drugs: 0.15, growth: 0.7, attackAt: 72, maxMembers: 28, tier: [2, 3], members: [10, 14],
    interest: { promzona: 1.4, vokzal: 1.1, centr: 1.0, rynok: 0.8, cheremushki: 0.7, chastnyi: 0.6 },
    uniform: 'bandit_camo', hats: ['none', 'beanie', 'cap'], pointKinds: ['office', 'garage', 'warehouse', 'factory'],
    style: 'Бывшие военные под вывеской фонда ветеранов. Дисциплина, автоматы, работают как подразделение. Опаснее всех в бою.',
  },
  thieves: {
    label: 'блатные', aggression: 0.3, discipline: 0.7, skill: 0.8, morale: 0.45, surrender: 0.75, bribe: 0.85,
    racket: 1.35, drugs: 0.5, growth: 0.9, attackAt: 82, maxMembers: 40, tier: [1, 2], members: [14, 22],
    interest: { rynok: 1.5, vokzal: 1.2, centr: 1.0, cheremushki: 0.7, promzona: 0.6, chastnyi: 0.6 },
    uniform: 'bandit_leather', hats: ['cap', 'cap', 'none'], pointKinds: ['bar', 'market', 'hostel', 'shop', 'flat'],
    style: 'Старая школа, «понятия», общак. С милицией предпочитают договариваться, а не воевать. Держат Рынок и напёрстки.',
  },
  drugs: {
    label: 'наркоторговцы', aggression: 0.45, discipline: 0.4, skill: 0.75, morale: 0.4, surrender: 0.5, bribe: 0.7,
    racket: 0.5, drugs: 1.7, growth: 1.2, attackAt: 70, maxMembers: 35, tier: [1, 2], members: [10, 16],
    interest: { vokzal: 1.4, chastnyi: 1.3, cheremushki: 1.1, promzona: 0.8, rynok: 0.8, centr: 0.6 },
    uniform: 'junkie', hats: ['none', 'beanie'], pointKinds: ['flat', 'hostel', 'dacha', 'station', 'garage'],
    style: 'Маковая соломка, «ханка», героин всё чаще. Притоны в общагах и на дачах. Вербуют из своих же клиентов.',
  },
  frostbitten: {
    label: 'отморозки', aggression: 0.95, discipline: 0.2, skill: 1.0, morale: 0.8, surrender: 0.1, bribe: 0.15,
    racket: 1.0, drugs: 0.6, growth: 1.3, attackAt: 50, maxMembers: 28, tier: [1, 2], members: [8, 12],
    interest: { promzona: 1.3, chastnyi: 1.3, cheremushki: 1.0, vokzal: 0.9, rynok: 0.8, centr: 0.6 },
    uniform: 'bandit_leather', hats: ['beanie', 'beanie', 'mask', 'none'], pointKinds: ['garage', 'warehouse', 'dacha', 'flat'],
    style: 'Беспредельщики без понятий и без тормозов. Непредсказуемы: могут уйти от наряда, а могут открыть огонь первыми.',
  },
};
export const GANG_ORDER = ['sport', 'afghan', 'thieves', 'drugs', 'frostbitten'];

// Названия с падежами: в официальном тексте — «группировка „Рыночные“», в эфире — «рыночные», «с рыночными».
export const GANG_NAMES = {
  sport: [
    { nom: 'Черёмушкинские', gen: 'Черёмушкинских', dat: 'Черёмушкинским', ins: 'Черёмушкинскими', people: 'черёмушкинские', peopleGen: 'черёмушкинских', peopleIns: 'черёмушкинскими', base: ['cheremushki', 'rynok'] },
    { nom: 'Олимпийцы', gen: 'Олимпийцев', dat: 'Олимпийцам', ins: 'Олимпийцами', people: 'олимпийцы', peopleGen: 'олимпийцев', peopleIns: 'олимпийцами', base: ['cheremushki', 'centr'] },
  ],
  afghan: [
    { nom: 'Афганское братство', gen: 'Афганского братства', dat: 'Афганскому братству', ins: 'Афганским братством', people: 'афганцы', peopleGen: 'афганцев', peopleIns: 'афганцами', base: ['promzona', 'vokzal'] },
    { nom: 'Шурави', gen: 'Шурави', dat: 'Шурави', ins: 'Шурави', people: 'афганцы', peopleGen: 'афганцев', peopleIns: 'афганцами', base: ['promzona', 'centr'] },
  ],
  thieves: [
    { nom: 'Рыночные', gen: 'Рыночных', dat: 'Рыночным', ins: 'Рыночными', people: 'рыночные', peopleGen: 'рыночных', peopleIns: 'рыночными', base: ['rynok', 'vokzal'] },
    { nom: 'Матвеевские', gen: 'Матвеевских', dat: 'Матвеевским', ins: 'Матвеевскими', people: 'матвеевские', peopleGen: 'матвеевских', peopleIns: 'матвеевскими', base: ['rynok', 'centr'] },
  ],
  drugs: [
    { nom: 'Вокзальные', gen: 'Вокзальных', dat: 'Вокзальным', ins: 'Вокзальными', people: 'вокзальные', peopleGen: 'вокзальных', peopleIns: 'вокзальными', base: ['vokzal', 'chastnyi'] },
    { nom: 'Аптекари', gen: 'Аптекарей', dat: 'Аптекарям', ins: 'Аптекарями', people: 'аптекари', peopleGen: 'аптекарей', peopleIns: 'аптекарями', base: ['vokzal', 'cheremushki'] },
  ],
  frostbitten: [
    { nom: 'Гаражные', gen: 'Гаражных', dat: 'Гаражным', ins: 'Гаражными', people: 'гаражные', peopleGen: 'гаражных', peopleIns: 'гаражными', base: ['promzona', 'chastnyi'] },
    { nom: 'Промзоновские', gen: 'Промзоновских', dat: 'Промзоновским', ins: 'Промзоновскими', people: 'промзоновские', peopleGen: 'промзоновских', peopleIns: 'промзоновскими', base: ['promzona', 'chastnyi'] },
  ],
};

export const LEADER_NICKS = {
  sport: ['Бык', 'Кабан', 'Шайба', 'Зубр', 'Бетон', 'Штанга', 'Борец', 'Тренер'],
  afghan: ['Прапор', 'Сапёр', 'Десант', 'Комбат', 'Кандагар', 'Разведчик'],
  thieves: ['Дед Матвей', 'Седой', 'Барин', 'Князь', 'Профессор', 'Монах'],
  drugs: ['Доктор', 'Аптекарь', 'Химик', 'Студент', 'Фармацевт', 'Кислый'],
  frostbitten: ['Бешеный', 'Шакал', 'Ржавый', 'Колун', 'Паяльник', 'Штырь'],
};
export const MEMBER_NICKS = {
  sport: ['Малой', 'Лысый', 'Бита', 'Гиря', 'Кот', 'Слон', 'Батон', 'Тюля', 'Толян', 'Серый', 'Пузо', 'Шкаф'],
  afghan: ['Танкист', 'Боцман', 'Сапёр', 'Связист', 'Медведь', 'Филин', 'Сыч', 'Кирпич', 'Старшина', 'Ворон'],
  thieves: ['Фикса', 'Гвоздь', 'Сиплый', 'Косой', 'Шнырь', 'Чирик', 'Грач', 'Карась', 'Хромой', 'Цемент'],
  drugs: ['Шприц', 'Фантик', 'Кислый', 'Ёрш', 'Пыж', 'Глыба', 'Хорь', 'Ласка', 'Гном', 'Студент'],
  frostbitten: ['Штопор', 'Тесак', 'Лом', 'Шрам', 'Клык', 'Волчара', 'Кощей', 'Махно', 'Бармалей', 'Пыж'],
};
export const LEADER_BIOS = {
  sport: [
    'бывший мастер спорта по вольной борьбе, держит качалку при ДК «Строитель»',
    'чемпион области по боксу восемьдесят восьмого года, после армии собрал своих',
    'бывший тренер детской секции; теперь «тренирует» ларёчников',
  ],
  afghan: [
    'бывший прапорщик ВДВ, два срока в Афганистане, председатель фонда ветеранов',
    'бывший командир разведвзвода, орден Красной Звезды; фонд ветеранов прикрывает дела',
    'капитан запаса, прошёл Панджшер; говорит тихо, приказы не повторяет',
  ],
  thieves: [
    'вор старой формации, четыре ходки, «смотрит» за Рынком с восемьдесят девятого',
    'авторитет, сидел ещё при Брежневе; живёт тихо, решает всё через людей',
    'держит общак, на людях — пенсионер с тростью и в шляпе',
  ],
  drugs: [
    'бывший провизор аптеки № 3, связи с проводниками дальних поездов',
    'недоучившийся химик, нигде не работает, ездит на новой «восьмёрке»',
    'бывший фарцовщик; товар возит через проводников, сам ничего в руки не берёт',
  ],
  frostbitten: [
    'дважды судим за разбой, вышел весной и собрал вокруг себя молодняк',
    'бывший водитель автобазы; бьёт первым, думает потом',
    'двадцать три года, из детдома; говорят, не боится ни бога, ни ментов, ни воров',
  ],
};
export const PERP_DESC = {
  sport: ['в спортивном костюме «Адидас», бритый затылок', 'в кожанке поверх спортивки, на шее цепь', 'здоровый, коротко стриженный, в кроссовках «Пума»', 'в малиновом пиджаке поверх тельняшки', 'в чёрной «косухе», сбитые костяшки'],
  afghan: ['в камуфляжной куртке, короткая стрижка, держится по-армейски', 'в бушлате, на руке наколка «ДРА»', 'сухой, жилистый, в берцах', 'в штормовке, двигается тихо, смотрит цепко'],
  thieves: ['в кепке-«аэродроме», на пальцах наколки-перстни', 'в пальто и шляпе, золотая фикса', 'худой, в телогрейке, синие от наколок руки', 'в кожаной куртке, с чётками'],
  drugs: ['худой, бледный, в куртке-«аляске»', 'с запавшими глазами, в грязном пуховике', 'нервный, всё время чешется, в вязаной шапке', 'хорошо одет, в дублёнке, при пейджере'],
  frostbitten: ['в чёрной вязаной шапке, взгляд стеклянный', 'в рваной кожанке, свежий шрам через бровь', 'лет восемнадцати, в спортивке, нож на шнурке', 'в армейских штанах и кедах, пьяный и злой'],
  none: ['мужчина лет сорока в засаленной куртке', 'парень в турецком свитере и кепке', 'небритый, в телогрейке', 'в джинсовой куртке-«варёнке»', 'в пуховике, лицо прячет в воротник'],
};

/* ------------------------------------------------------------------ позывные */
export const CALLSIGNS = {
  patrol: ['Сокол', 'Соколу'], guard: ['Берёза', 'Берёзе'], ambush: ['Филин', 'Филину'], raid: ['Гром', 'Грому'],
  investigate: ['Тайга', 'Тайге'], respond: ['Ястреб', 'Ястребу'], escort: ['Конвой', 'Конвою'], search: ['Кедр', 'Кедру'],
};
export const INFORMANT_ALIASES = ['Сверчок', 'Ласточка', 'Бухгалтер', 'Кузнечик', 'Дьячок', 'Почтальон', 'Тихий', 'Рыжик', 'Сорока', 'Мельник', 'Будильник', 'Школьник', 'Кочегар', 'Синица'];
export const INFORMANT_COVERS = {
  rynok: ['продавщица из павильона «Ника»', 'грузчик с овощного ряда', 'хозяин обменника', 'буфетчица из пельменной'],
  vokzal: ['носильщик', 'кассирша пригородных касс', 'таксист-«бомбила» с привокзальной площади', 'буфетчик из привокзального кафе'],
  promzona: ['сторож гаражного кооператива', 'слесарь с автобазы', 'кладовщик со склада', 'вахтёр заводской проходной'],
  cheremushki: ['дворник', 'продавщица из гастронома', 'пенсионерка с первого этажа', 'сантехник из ЖЭКа'],
  centr: ['официант из ресторана «Юбилейный»', 'охранник коммерческого банка', 'швейцар гостиницы', 'секретарша из администрации'],
  chastnyi: ['самогонщица с окраины', 'старик-пчеловод', 'тракторист из совхоза', 'фельдшер'],
};

/* ------------------------------------------------------------------ статьи (1996 г. — ещё УК РСФСР 1960 года) */
export const CHARGES = {
  attackPolice: 'посягательство на жизнь работника милиции (ст. 191.2 УК РСФСР)',
  resist: 'сопротивление работнику милиции (ст. 191.1 УК РСФСР)',
  weapon: 'незаконное ношение оружия (ст. 218 УК РСФСР)',
  drugs: 'незаконный оборот наркотиков (ст. 224 УК РСФСР)',
  racket: 'вымогательство (ст. 148 УК РСФСР)',
  banditry: 'бандитизм (ст. 77 УК РСФСР)',
  hooligan: 'злостное хулиганство (ст. 206 УК РСФСР)',
  petty: 'мелкое хулиганство (ст. 158 КоАП РСФСР)',
  drunk: 'появление в нетрезвом виде (ст. 162 КоАП РСФСР)',
  robbery: 'разбой (ст. 146 УК РСФСР)',
  murder: 'умышленное убийство (ст. 102 УК РСФСР)',
  bribe: 'дача взятки (ст. 174 УК РСФСР)',
  wanted: 'находился во всесоюзном розыске',
  kidnap: 'незаконное лишение свободы (ст. 126 УК РСФСР)',
};

/* ------------------------------------------------------------------ типы заданий и приказы */
const O_STANCE = {
  key: 'stance', label: 'Манера действий', type: 'select', default: 'normal', options: [
    { value: 'cautious', label: 'Осторожно', desc: 'Не лезть на рожон. При опасности — наблюдать и просить подкрепление.' },
    { value: 'normal', label: 'По обстановке', desc: 'Командир сам взвешивает риск.' },
    { value: 'aggressive', label: 'Жёстко', desc: 'Пресекать сразу, не дожидаясь подмоги. Больше задержаний — и больше ранений.' },
  ],
};
const O_FORCE = {
  key: 'force', label: 'Применение оружия', type: 'select', default: 'proportional', options: [
    { value: 'return_fire', label: 'Только в ответ', desc: 'Стрелять, только если стреляют в наряд. Меньше жертв среди граждан, выше риск для своих.' },
    { value: 'proportional', label: 'Соразмерно', desc: 'По закону: оружие — против вооружённых.' },
    { value: 'free', label: 'На поражение', desc: 'Огонь без предупреждения при угрозе. Своих бережёт, но будут трупы, жалобы и прокуратура.' },
  ],
};
const O_DETAIN = {
  key: 'detain', label: 'Задержания', type: 'select', default: 'serious', options: [
    { value: 'all', label: 'Всех нарушителей', desc: 'Пьяных, хулиганов, без документов — всех в отдел. Камеры заполнятся быстро.' },
    { value: 'serious', label: 'Только серьёзных', desc: 'Везти подозреваемых в тяжком и вооружённых. Мелочь — предупреждением.' },
    { value: 'none', label: 'Без задержаний', desc: 'Пресекать и разгонять, никого не везти. Камеры свободны, но безнаказанность видна всем.' },
  ],
};
const O_CALLS = { key: 'respondCalls', label: 'Принимать вызовы в районе', type: 'bool', default: true, desc: 'Наряд может сорваться на вызов поблизости, бросив основное.' };
const O_REPORT = {
  key: 'reportEvery', label: 'Докладывать', type: 'select', default: 60, options: [
    { value: 30, label: 'Каждые 30 минут', desc: 'Больше сведений, меньше тишины в эфире.' },
    { value: 60, label: 'Каждый час', desc: '' },
    { value: 120, label: 'Раз в два часа', desc: 'Командир не отвлекается на рацию.' },
  ],
};
const O_RETREAT = { key: 'retreatOnWounded', label: 'Отходить при тяжелораненом', type: 'bool', default: true, desc: 'Прекратить задание и вывозить раненого.' };
const durLabel = (m) => (m < 60 ? `${m} минут` : m % 60 === 0 ? `${m / 60} ч` : `${Math.floor(m / 60)} ч ${m % 60} мин`);
const O_DURATION = (def, list) => ({ key: 'durationMin', label: 'Продолжительность', type: 'select', default: def, options: list.map((m) => ({ value: m, label: durLabel(m), desc: '' })) });
const O_RETURNAT = { key: 'returnAt', label: 'Вернуться в отдел к', type: 'time', default: null, desc: 'Время прибытия в отдел (минута суток). Перекрывает продолжительность.' };
const O_NOTE = { key: 'note', label: 'Особые указания', type: 'text', default: '', desc: 'Записывается в журнал задания.' };

export const TASK_DEFS = [
  {
    id: 'patrol', name: 'Патрулирование', minOfficers: 1, maxOfficers: 4, needsPlace: false, needsTarget: false,
    vehicle: 'optional', roles: { preferred: ['pps', 'uchastkovy', 'kinolog'], required: null }, defaultDuration: 240,
    desc: 'Наряд обходит или объезжает район: пресекает, проверяет, показывает, что милиция есть. Пока он там — меньше преступлений, банды теряют влияние, люди начинают верить.',
    orderOptions: [
      { key: 'focus', label: 'Упор', type: 'select', default: 'visible', options: [
        { value: 'visible', label: 'На виду', desc: 'Ходить по людным местам. Сильнее всего отпугивает.' },
        { value: 'stealth', label: 'Скрытно', desc: 'В тени, без шума. Отпугивает слабо, но чаще берут с поличным.' },
        { value: 'checks', label: 'Проверка документов', desc: 'Останавливать подозрительных. Шанс найти разыскиваемых и стволы. Люди раздражаются.' },
        { value: 'kiosks', label: 'Проверка ларьков', desc: 'Говорить с продавцами. Сведения о рэкете, доверие торговцев. Злит тех, кто «доит» ларьки.' },
        { value: 'drunks', label: 'Пьяные и хулиганы', desc: 'Подбирать пьяных, гасить драки. Меньше бытовухи и поножовщины.' },
        { value: 'drugs', label: 'Наркотики', desc: 'Притоны, закладки, барыги. Злит наркоторговцев, может кончиться стычкой.' },
      ] },
      { key: 'route', label: 'Способ', type: 'select', default: 'foot', options: [
        { value: 'foot', label: 'Пешком', desc: 'Медленно, но всё видят и слышат. Ближе к людям.' },
        { value: 'car', label: 'На машине', desc: 'Нужен УАЗ. Охват шире, на вызов быстрее, но с людьми меньше контакта.' },
      ] },
      O_STANCE, O_FORCE, O_DETAIN, O_CALLS, O_REPORT, O_RETREAT,
      O_DURATION(240, [120, 240, 360, 480, 720]), O_RETURNAT, O_NOTE,
    ],
  },
  {
    id: 'guard', name: 'Охрана объекта', minOfficers: 1, maxOfficers: 4, needsPlace: true, needsTarget: false,
    vehicle: 'optional', roles: { preferred: ['pps', 'guard'], required: null }, defaultDuration: 360,
    desc: 'Пост у важного места — банка, школы, рынка — или охрана свидетеля. Пока наряд на месте, на объект почти не сунутся. Скучно, но надёжно.',
    orderOptions: [
      { key: 'posture', label: 'Как стоять', type: 'select', default: 'visible', options: [
        { value: 'visible', label: 'Открыто', desc: 'Пост на виду. Отпугивает, налётчики уходят.' },
        { value: 'hidden', label: 'Скрытно', desc: 'В машине, в подсобке. Если сунутся — возьмём, но могут успеть выстрелить.' },
      ] },
      O_STANCE, O_FORCE, O_DETAIN, { ...O_CALLS, default: false }, O_REPORT, O_RETREAT,
      O_DURATION(360, [120, 240, 360, 480, 720, 1440]), O_RETURNAT, O_NOTE,
    ],
  },
  {
    id: 'ambush', name: 'Засада', minOfficers: 2, maxOfficers: 5, needsPlace: false, needsTarget: true,
    vehicle: 'optional', roles: { preferred: ['pps', 'oper'], required: null }, defaultDuration: 360,
    desc: 'Ждать в укрытии по наводке: сделка, сходка, готовящийся налёт. Если наводка верная — берём с поличным. Если пустая — потерянная ночь. Если подставная — беда.',
    orderOptions: [
      { key: 'position', label: 'Позиция', type: 'select', default: 'close', options: [
        { value: 'close', label: 'Вплотную', desc: 'Взять быстро и всех. Выше шанс, что заметят.' },
        { value: 'far', label: 'С дистанции', desc: 'Наблюдать и брать на отходе. Не заметят, но кто-то уйдёт.' },
      ] },
      { key: 'trigger', label: 'Когда брать', type: 'select', default: 'on_sight', options: [
        { value: 'on_sight', label: 'Сразу', desc: 'Как только появятся.' },
        { value: 'wait_main', label: 'Ждать главного', desc: 'Дождаться старшего — больше шанс взять верхушку, но дольше сидеть и легче спалиться.' },
      ] },
      O_STANCE, O_FORCE, O_DETAIN, O_REPORT, O_RETREAT,
      O_DURATION(360, [180, 360, 480, 720]), O_NOTE,
    ],
  },
  {
    id: 'raid', name: 'Рейд на точку', minOfficers: 3, maxOfficers: 6, needsPlace: false, needsTarget: true,
    vehicle: 'optional', roles: { preferred: ['pps', 'oper', 'kinolog'], required: null }, defaultDuration: 120,
    desc: 'Налёт на притон, склад или штаб банды. Бьёт по банде больнее всего: люди, деньги, оружие, влияние. Но злит её — и может кончиться перестрелкой.',
    orderOptions: [
      { key: 'mode', label: 'Как входить', type: 'select', default: 'quiet', options: [
        { value: 'quiet', label: 'Тихо', desc: 'Внезапность. Меньше стрельбы, больше задержанных — если не предупредили.' },
        { value: 'loud', label: 'Громко', desc: 'С мегафоном и светом. Показать силу району: больше удар по влиянию, но банда успеет приготовиться.' },
      ] },
      { key: 'takeAlive', label: 'Брать живыми', type: 'bool', default: true, desc: 'Стрелять по ногам, не добивать. Больше задержанных и сведений, выше риск для своих.' },
      { key: 'timing', label: 'Время', type: 'select', default: 'now', options: [
        { value: 'now', label: 'Сразу по прибытии', desc: '' },
        { value: 'dawn', label: 'На рассвете (05:00)', desc: 'Спят, пьяные, тёпленькие. Ждать придётся в машине.' },
        { value: 'night', label: 'Ночью (01:00)', desc: 'Застать всех на месте. Темно — кто-то уйдёт.' },
      ] },
      O_STANCE, O_FORCE, O_DETAIN, O_REPORT, O_RETREAT, O_NOTE,
    ],
  },
  {
    id: 'investigate', name: 'Раскрытие', minOfficers: 1, maxOfficers: 3, needsPlace: false, needsTarget: true,
    vehicle: 'optional', roles: { preferred: ['oper', 'uchastkovy'], required: ['oper', 'uchastkovy'] }, defaultDuration: 360,
    desc: 'Опер работает по преступлению: осмотр места, обход квартир, свидетели, установление подозреваемого и задержание. Чем выше доверие людей — тем больше скажут.',
    orderOptions: [
      { key: 'approach', label: 'Метод', type: 'select', default: 'by_book', options: [
        { value: 'by_book', label: 'По закону', desc: 'Медленно и чисто.' },
        { value: 'pressure', label: 'Давить', desc: 'Быстрее, но люди озлобятся, а признание может оказаться липой.' },
        { value: 'agents', label: 'Через агентуру', desc: 'Сильно быстрее, если в районе есть информаторы. Можно засветить источник.' },
      ] },
      O_STANCE, O_FORCE, O_DETAIN, O_REPORT,
      O_DURATION(360, [180, 360, 480, 720]), O_RETURNAT, O_NOTE,
    ],
  },
  {
    id: 'respond', name: 'Выезд на вызов', minOfficers: 1, maxOfficers: 4, needsPlace: false, needsTarget: true,
    vehicle: 'optional', roles: { preferred: ['pps'], required: null }, defaultDuration: 90,
    desc: 'Срочный выезд к месту происшествия, пока оно ещё идёт, или на помощь своему наряду. Дорога решает всё.',
    orderOptions: [
      { key: 'siren', label: 'С сиреной', type: 'bool', default: true, desc: 'Быстрее доедем и спугнём — жертвам легче, но преступники успеют уйти.' },
      O_STANCE, O_FORCE, O_DETAIN, O_REPORT, O_RETREAT, O_NOTE,
    ],
  },
  {
    id: 'escort', name: 'Конвой / сопровождение', minOfficers: 2, maxOfficers: 4, needsPlace: false, needsTarget: true,
    vehicle: 'required', roles: { preferred: ['guard', 'pps', 'driver'], required: null }, defaultDuration: 120,
    desc: 'Доставка задержанных в СИЗО (освобождает камеры и снимает повод для налёта) или сопровождение ценностей банка (платят). На дороге могут встретить.',
    orderOptions: [
      { key: 'escortRoute', label: 'Маршрут', type: 'select', default: 'main', options: [
        { value: 'main', label: 'Основной дорогой', desc: 'Быстрее.' },
        { value: 'detour', label: 'Объездом', desc: 'Дольше, но перехватить труднее.' },
      ] },
      O_STANCE, O_FORCE, O_REPORT, O_NOTE,
    ],
  },
  {
    id: 'search', name: 'Розыск пропавшего', minOfficers: 1, maxOfficers: 4, needsPlace: false, needsTarget: true,
    vehicle: 'optional', roles: { preferred: ['kinolog', 'uchastkovy', 'pps'], required: null }, defaultDuration: 240,
    desc: 'Поиск пропавшего человека: дворы, подвалы, теплотрассы, больницы. Время работает против. Кинолог с собакой — большое подспорье.',
    orderOptions: [
      { key: 'area', label: 'Охват', type: 'select', default: 'narrow', options: [
        { value: 'narrow', label: 'Тщательно', desc: 'Медленно прочёсывать вокруг места, где видели в последний раз.' },
        { value: 'wide', label: 'Широко', desc: 'Больницы, вокзал, знакомые. Быстрее, если человек ушёл далеко.' },
      ] },
      O_STANCE, O_DETAIN, O_REPORT,
      O_DURATION(240, [120, 240, 360, 480]), O_RETURNAT, O_NOTE,
    ],
  },
];
export const TASK_DEF = Object.fromEntries(TASK_DEFS.map((d) => [d.id, d]));

/** вес присутствия на одного сотрудника, по типу задания */
export const PRESENCE_W = { patrol: 0.5, guard: 0.3, ambush: 0.05, raid: 0.9, investigate: 0.2, respond: 0.35, escort: 0.1, search: 0.3 };
export const FOCUS_PRESENCE = { visible: 1.25, stealth: 0.45, checks: 1.0, kiosks: 0.9, drunks: 1.0, drugs: 0.8 };

/* ------------------------------------------------------------------ прочее */
export const CHIEF_TITLES = ['начальник ГОВД', 'начальник городского управления'];
export const WEATHER = {
  9: ['моросит, +9', 'пасмурно, +11', 'дождь, +8'],
  10: ['дождь, +5', 'мокрый снег, +1', 'туман, +3', 'пасмурно, ветер, +4'],
  11: ['мокрый снег, −1', 'гололёд, −3', 'дождь со снегом, 0', 'метель, −6'],
  12: ['снег, −8', 'метель, −12', 'оттепель, слякоть, +1', 'мороз, −17'],
  1: ['мороз, −20', 'снег, −9', 'метель, −14'],
  2: ['снег, −7', 'оттепель, +1', 'метель, −11'],
  3: ['слякоть, +2', 'мокрый снег, 0', 'дождь, +4'],
};
// виды гражданских «точек» банды по месту
export const POINT_KIND_LABEL = { hideout: 'точка', stash: 'схрон', racket: 'место поборов' };
