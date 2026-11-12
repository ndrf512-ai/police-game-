// Снаряжение, расходники и улучшения участка (агент B2). Цены — тыс. руб. образца осени 1996.
// Каналы снабжения:
//   official   — заявка в управление (ХОЗУ/ОМТО УВД): дёшево или по безналу, но долго, частично и с отказами;
//   commercial — коммерсант/магазин «Охотник»/фирма «Спецснаб»: дороже, быстрее, за наличные;
//   black      — «левак»: прапорщик со склада части, барыга с Рынка. Дёшево и быстро, но риск:
//                кидок, брак, «засвеченный» ствол, слух в управлении, банда узнаёт, чем вы вооружены.

export const CHANNELS = {
  official:   { id: 'official',   name: 'Заявка в управление', desc: 'Дёшево, но долго. Могут урезать или отказать: «фондов нет».' },
  commercial: { id: 'commercial', name: 'Коммерсант',          desc: 'За наличные, через пару дней. Без вопросов — почти.' },
  black:      { id: 'black',      name: 'Левак',               desc: 'Дёшево и быстро. Кинут, подсунут брак или «засвеченный» ствол — тоже быстро.' },
};

// Боеприпасы. КС-23 стреляет 23-мм патронами — отдельный тип '23mm'.
export const AMMO_TYPES = {
  '9x18':    { name: '9×18 ПМ',        weapons: ['pm'] },
  '5.45x39': { name: '5,45×39',        weapons: ['aks74u'] },
  '12ga':    { name: '12-й калибр',    weapons: ['shotgun', 'sawnoff'] },
  '7.62x25': { name: '7,62×25 ТТ',     weapons: ['tt'] },
  '23mm':    { name: '23 мм «Шрапнель»', weapons: ['ks23'] },
};

// Стандартный носимый боекомплект при выдаче
export const WEAPON_LOADOUT = {
  pm:      { ammoType: '9x18',    load: 16, max: 24, mag: 8 },
  aks74u:  { ammoType: '5.45x39', load: 90, max: 120, mag: 30 },
  ks23:    { ammoType: '23mm',    load: 10, max: 15, mag: 3 },
  tt:      { ammoType: '7.62x25', load: 16, max: 24, mag: 8 },
  shotgun: { ammoType: '12ga',    load: 12, max: 20, mag: 6 },
  sawnoff: { ammoType: '12ga',    load: 8,  max: 12, mag: 2 },
};

// slot — куда выдаётся сотруднику (equipment): weapon|armor|helmet|radio|baton|cuffs|gas|medkit|flashlight
// pack — сколько единиц в одной позиции заказа (для патронов — патронов; для бензина — литров)
// price — {канал: цена за позицию} (нет ключа — по этому каналу не достать)
// days — {канал: [мин, макс]} дней доставки
export const ITEMS = {
  // ---------- Оружие ----------
  pm: { id: 'pm', name: 'Пистолет Макарова (ПМ)', short: 'ПМ', category: 'weapon', slot: 'weapon', weaponId: 'pm', ammoType: '9x18',
    price: { official: 1200, black: 800 }, days: { official: [5, 10], black: [1, 2] }, pack: 1, unit: 'шт.',
    desc: 'Табельный. Восемь патронов в магазине, надёжен, как утюг, и примерно так же точен дальше двадцати метров.' },
  aks74u: { id: 'aks74u', name: 'Автомат АКС-74У', short: 'АКС-74У', category: 'weapon', slot: 'weapon', weaponId: 'aks74u', ammoType: '5.45x39',
    price: { official: 2600, black: 1900 }, days: { official: [7, 14], black: [1, 3] }, pack: 1, unit: 'шт.', officialRefuse: 0.45,
    desc: '«Ксюха». Короткий, злой, громкий. В управлении выдают со слезами и под роспись в трёх журналах.' },
  ks23: { id: 'ks23', name: 'Карабин КС-23', short: 'КС-23', category: 'weapon', slot: 'weapon', weaponId: 'ks23', ammoType: '23mm',
    price: { official: 3000 }, days: { official: [7, 14] }, pack: 1, unit: 'шт.', officialRefuse: 0.35,
    desc: 'Специальный карабин 23 мм. Картечь «Шрапнель-25» на десяти метрах останавливает всё, включая «девятку».' },
  shotgun: { id: 'shotgun', name: 'Помповое ружьё ИЖ-81', short: 'ИЖ-81', category: 'weapon', slot: 'weapon', weaponId: 'shotgun', ammoType: '12ga',
    price: { commercial: 1800, black: 1200 }, days: { commercial: [1, 3], black: [1, 2] }, pack: 1, unit: 'шт.',
    desc: 'Гражданская «помпа» из магазина «Охотник». Официально — для охраны объекта, на деле — для всего.' },
  tt: { id: 'tt', name: 'Пистолет ТТ', short: 'ТТ', category: 'weapon', slot: 'weapon', weaponId: 'tt', ammoType: '7.62x25', illegal: true,
    price: { black: 600 }, days: { black: [0, 1] }, pack: 1, unit: 'шт.',
    desc: 'Любимец братвы: пробивает и машину, и бронежилет второго класса. Табельным не является — проверка найдёт, будет скандал.' },
  sawnoff: { id: 'sawnoff', name: 'Обрез двустволки', short: 'обрез', category: 'weapon', slot: 'weapon', weaponId: 'sawnoff', ammoType: '12ga', illegal: true,
    price: {}, days: {}, pack: 1, unit: 'шт.',
    desc: 'Изъятый вещдок. Два выстрела, грохот, дым. Выдавать — себе дороже.' },

  // ---------- Патроны ----------
  ammo_9x18: { id: 'ammo_9x18', name: 'Патроны 9×18 (пачка 16 шт.)', short: '9×18', category: 'ammo', ammoType: '9x18', pack: 16, unit: 'пачка',
    price: { official: 30, commercial: 45, black: 24 }, days: { official: [2, 5], commercial: [1, 2], black: [0, 1] },
    desc: 'Пистолетные. Без них ПМ — просто тяжёлая железка в кобуре.' },
  ammo_545: { id: 'ammo_545', name: 'Патроны 5,45×39 (30 шт.)', short: '5,45', category: 'ammo', ammoType: '5.45x39', pack: 30, unit: 'пачка',
    price: { official: 60, black: 40 }, days: { official: [3, 7], black: [0, 2] },
    desc: 'Автоматные. Один магазин — и тридцати патронов как не бывало.' },
  ammo_12ga: { id: 'ammo_12ga', name: 'Патроны 12-го калибра, картечь (10 шт.)', short: '12 к.', category: 'ammo', ammoType: '12ga', pack: 10, unit: 'пачка',
    price: { commercial: 40, black: 28 }, days: { commercial: [1, 2], black: [0, 1] },
    desc: 'Картечь 8,5 мм. Охотникам продают без вопросов, милиции — тоже.' },
  ammo_tt: { id: 'ammo_tt', name: 'Патроны 7,62×25 (16 шт.)', short: '7,62 ТТ', category: 'ammo', ammoType: '7.62x25', pack: 16, unit: 'пачка', illegal: true,
    price: { black: 35 }, days: { black: [0, 1] },
    desc: 'Для изъятых ТТ. Официально их у вас быть не может.' },
  ammo_23: { id: 'ammo_23', name: 'Патроны 23 мм «Шрапнель-25» (5 шт.)', short: '23 мм', category: 'ammo', ammoType: '23mm', pack: 5, unit: 'пачка',
    price: { official: 90 }, days: { official: [4, 9] },
    desc: 'Для КС-23. Каждый — как маленький снаряд.' },

  // ---------- Защита ----------
  zh81: { id: 'zh81', name: 'Бронежилет Ж-81', short: 'Ж-81', category: 'armor', slot: 'armor', armorClass: 'vest', protection: 0.35, weight: 5, stamina: -0.05,
    price: { official: 900, black: 600 }, days: { official: [5, 10], black: [1, 2] }, pack: 1, unit: 'шт.',
    desc: 'Армейский, советский. Держит осколки и пистолетную пулю на излёте. Лучше, чем ничего, — ненамного.' },
  kora: { id: 'kora', name: 'Бронежилет «Кора-Кулон»', short: '«Кора»', category: 'armor', slot: 'armor', armorClass: 'vest', protection: 0.5, weight: 7, stamina: -0.08,
    price: { official: 1600, commercial: 2200 }, days: { official: [6, 12], commercial: [2, 4] }, pack: 1, unit: 'шт.',
    desc: 'Милицейский. Держит ПМ и ТТ, если повезёт. Под бушлатом почти не видно.' },
  modul: { id: 'modul', name: 'Тяжёлый бронежилет «Модуль»', short: '«Модуль»', category: 'armor', slot: 'armor', armorClass: 'heavy', protection: 0.75, weight: 14, stamina: -0.25,
    price: { official: 4500, commercial: 6000 }, days: { official: [10, 18], commercial: [3, 6] }, pack: 1, unit: 'шт.',
    desc: 'Держит автоматную пулю. Весит как мешок картошки, бегать в нём — пытка, но живым остаться можно.' },
  helmet_ssh68: { id: 'helmet_ssh68', name: 'Каска СШ-68', short: 'СШ-68', category: 'helmet', slot: 'helmet', protection: 0.2,
    price: { official: 150, black: 100 }, days: { official: [3, 7], black: [1, 2] }, pack: 1, unit: 'шт.',
    desc: 'Стальная армейская каска. От пули — вряд ли, от кирпича и осколка — да.' },
  helmet_sfera: { id: 'helmet_sfera', name: 'Шлем «Сфера»', short: '«Сфера»', category: 'helmet', slot: 'helmet', protection: 0.45,
    price: { commercial: 3500 }, days: { commercial: [3, 6] }, pack: 1, unit: 'шт.',
    desc: 'Титановый шлем спецназа. Держит пистолетную пулю. Стоит как подержанные «Жигули».' },

  // ---------- Связь и спецсредства ----------
  radio_kenwood: { id: 'radio_kenwood', name: 'Рация «Кенвуд»', short: '«Кенвуд»', category: 'gear', slot: 'radio',
    price: { commercial: 1400, black: 900 }, days: { commercial: [2, 4], black: [1, 2] }, pack: 1, unit: 'шт.',
    desc: 'Японская, лёгкая, ловит из подвала. Мечта каждого наряда.' },
  radio_old: { id: 'radio_old', name: 'Рация «Виола» (старая)', short: '«Виола»', category: 'gear', slot: 'radio', poor: true,
    price: { official: 250 }, days: { official: [4, 8] }, pack: 1, unit: 'шт.',
    desc: 'Советская. Тяжёлая, хрипит, в низинах замолкает. Аккумулятор держит полсмены.' },
  baton_pr73: { id: 'baton_pr73', name: 'Палка резиновая ПР-73', short: 'ПР-73', category: 'gear', slot: 'baton',
    price: { official: 40 }, days: { official: [2, 5] }, pack: 1, unit: 'шт.',
    desc: 'В народе — «демократизатор». Убеждает быстро.' },
  cuffs: { id: 'cuffs', name: 'Наручники БР-С', short: 'наручники', category: 'gear', slot: 'cuffs',
    price: { official: 60, commercial: 80 }, days: { official: [2, 5], commercial: [1, 2] }, pack: 1, unit: 'шт.',
    desc: 'Без наручников задержанного везут, держа за шиворот. Иногда не довозят.' },
  gas_spray: { id: 'gas_spray', name: 'Баллончик «Черёмуха-10»', short: '«Черёмуха»', category: 'gear', slot: 'gas',
    price: { official: 25, commercial: 35 }, days: { official: [2, 5], commercial: [1, 2] }, pack: 1, unit: 'шт.',
    desc: 'Слезоточивый газ. Против пьяного — отлично, против ветра — плохо.' },
  gas_grenade: { id: 'gas_grenade', name: 'Граната «Черёмуха-6»', short: 'газ. граната', category: 'combat', consumable: true,
    price: { official: 120 }, days: { official: [4, 9] }, pack: 1, unit: 'шт.',
    desc: 'Слезоточивая граната. Брошенная в вестибюль, выкуривает оттуда любого, у кого нет противогаза.' },
  medkit: { id: 'medkit', name: 'Аптечка (бинты, жгут, анальгин)', short: 'аптечка', category: 'medical', slot: 'medkit',
    price: { official: 30, commercial: 50 }, days: { official: [2, 5], commercial: [1, 1] }, pack: 1, unit: 'шт.',
    desc: 'Жгут, два бинта, зелёнка, анальгин. Иногда этого хватает.' },
  flashlight: { id: 'flashlight', name: 'Фонарь с запасом батареек', short: 'фонарь', category: 'gear', slot: 'flashlight',
    price: { commercial: 45 }, days: { commercial: [1, 2] }, pack: 1, unit: 'шт.',
    desc: 'Китайский, на трёх «бочонках». Ночью во дворе и в подъезде — главное оружие.' },
  medicine: { id: 'medicine', name: 'Медикаменты для ИВС и раненых', short: 'медикаменты', category: 'medical', consumable: true,
    price: { official: 60, commercial: 80 }, days: { official: [3, 6], commercial: [1, 2] }, pack: 1, unit: 'коробка',
    desc: 'Перевязка, капельницы, сердечное, кое-что от ломки. Расходуется на раненых и больных задержанных.' },

  // ---------- Транспорт ----------
  fuel: { id: 'fuel', name: 'Бензин АИ-76 (канистра 20 л)', short: 'бензин', category: 'vehicle', pack: 20, unit: 'канистра',
    price: { commercial: 40, black: 28 }, days: { commercial: [0, 1], black: [0, 1] },
    desc: 'УАЗ ест семнадцать литров на сотню по городу и двадцать пять — по грязи. Левый — слит с бензовоза, иногда с водой.' },
  diesel: { id: 'diesel', name: 'Солярка для генератора (канистра 20 л)', short: 'солярка', category: 'vehicle', pack: 20, unit: 'канистра',
    price: { commercial: 36, black: 24 }, days: { commercial: [0, 1], black: [0, 1] },
    desc: 'Генератор жрёт пять литров в час. Без солярки, когда отрубят свет, участок ослепнет.' },
  parts: { id: 'parts', name: 'Запчасти для УАЗа (комплект)', short: 'запчасти', category: 'vehicle', pack: 1, unit: 'комплект',
    price: { official: 300, commercial: 450, black: 250 }, days: { official: [5, 12], commercial: [1, 3], black: [1, 2] },
    desc: 'Свечи, ремни, колодки, крестовина, бензонасос. На один серьёзный ремонт.' },

  // ---------- Быт и мораль ----------
  tea: { id: 'tea', name: 'Чай «со слоном» (пачка)', short: 'чай', category: 'morale', consumable: true, pack: 1, unit: 'пачка',
    price: { commercial: 8 }, days: { commercial: [0, 1] },
    desc: 'Индийский, со слоном. Без чая ночная смена превращается в каторгу.' },
  sugar: { id: 'sugar', name: 'Сахар (1 кг)', short: 'сахар', category: 'morale', consumable: true, pack: 1, unit: 'кг',
    price: { commercial: 5 }, days: { commercial: [0, 1] },
    desc: 'Рафинад или песок — что дали.' },
  cigarettes: { id: 'cigarettes', name: 'Сигареты «Прима» (блок)', short: 'сигареты', category: 'morale', consumable: true, pack: 1, unit: 'блок',
    price: { commercial: 25, black: 18 }, days: { commercial: [0, 1], black: [0, 1] },
    desc: 'Курят почти все. Когда курево кончается, кончается и терпение.' },
  coffee: { id: 'coffee', name: 'Кофе растворимый (банка)', short: 'кофе', category: 'morale', consumable: true, pack: 1, unit: 'банка',
    price: { commercial: 30 }, days: { commercial: [0, 1] },
    desc: 'Импортный, в жестяной банке. Помогает дожить до утра.' },
  ration: { id: 'ration', name: 'Сухпаёк (коробка, 10 порций)', short: 'сухпаёк', category: 'morale', consumable: true, pack: 10, unit: 'коробка',
    price: { official: 15, commercial: 22 }, days: { official: [2, 5], commercial: [0, 1] },
    desc: 'Тушёнка, галеты, концентрат каши. Кормить задержанных положено по закону, сотрудников — по совести.' },
  paper: { id: 'paper', name: 'Бумага и лента для машинки', short: 'бумага', category: 'office', consumable: true, pack: 1, unit: 'пачка',
    price: { official: 12, commercial: 20 }, days: { official: [2, 4], commercial: [0, 1] },
    desc: 'Пачка бумаги и красящая лента для «Ятрани». Кончится — оформлять задержанных будет не на чем.' },
  cognac: { id: 'cognac', name: 'Коньяк «Белый аист»', short: 'коньяк', category: 'gift', consumable: true, pack: 1, unit: 'бутылка',
    price: { commercial: 60 }, days: { commercial: [0, 1] },
    desc: 'Для проверяющих из управления. Официально — для протирки оптики.' },

  // ---------- Хозяйство здания (sim/building.js: идут в дело сами на утреннем разводе или вручную) ----------
  cleaning: { id: 'cleaning', name: 'Моющие и хозтовары (ящик)', short: 'хозтовары', category: 'building', consumable: true, pack: 1, unit: 'ящик',
    price: { official: 15, commercial: 25 }, days: { official: [2, 5], commercial: [0, 1] },
    desc: 'Хлорка, «Пемолюкс», тряпки, мыло, туалетная бумага. Без этого участок за неделю превращается в вокзальный сортир.' },
  paint: { id: 'paint', name: 'Краска и стройматериалы', short: 'краска', category: 'building', consumable: true, pack: 1, unit: 'комплект',
    price: { official: 40, commercial: 60 }, days: { official: [3, 7], commercial: [1, 2] },
    desc: 'Зелёная масляная краска для панелей, побелка, шпаклёвка, петли и замки. Порядок в здании.' },
  tech_parts: { id: 'tech_parts', name: 'Запчасти к оргтехнике', short: 'запчасти (оргтехника)', category: 'building', consumable: true, pack: 1, unit: 'комплект',
    price: { commercial: 70, black: 45 }, days: { commercial: [1, 3], black: [0, 1] },
    desc: 'Лента и каретка для «Ятрани», телефонные трубки, провод, паяльник мастера. Чинит машинку и телефон дежурки.' },
  bulbs: { id: 'bulbs', name: 'Лампы дневного света и стартеры', short: 'лампы', category: 'building', consumable: true, pack: 1, unit: 'коробка',
    price: { official: 20, commercial: 30 }, days: { official: [2, 5], commercial: [0, 1] },
    desc: 'Коробка ЛБ-40, стартеры, пробки. Без них проводка искрит и свет гаснет в самый неподходящий момент.' },
};
export const ITEM_LIST = Object.values(ITEMS);

// Улучшения участка.
// flags — что выставляется в state.economy.flags после установки (читают бой, ИИ участка и UI):
//   windowsBarred:bool        — решётки на окнах (окна 'W' → как 'B': простреливаются, но не пролезть)
//   frontDoorHp:int           — прочность главного входа (дерево ≈150)
//   backDoorHp:int            — прочность чёрного хода (по умолчанию ≈300, сталь без засова)
//   gateHp:int                — ворота двора
//   sandbags:[pointId]        — мешки с песком: доп. укрытия (cover≈0.7) у этих точек
//   dutyArmored:bool          — бронеплиты в дежурке: укрытие 0.9 у пульта, окошко не простреливается
//   cameras:[zoneId]          — камеры: видно на мониторах дежурки, раннее предупреждение о штурме
//   generatorReliable:bool    — капремонт генератора: запускается сразу, не глохнет
//   emergencyLights:bool      — аварийное освещение при отключении электричества
//   omonLink:{delayMin}       — тревожная кнопка: ОМОН через delayMin минут после тревоги
//   backupPhone:bool          — радиотелефон: связь с «Гранитом», даже если перерезали провод
//   yardLight:bool            — прожектор во двор: ночью двор видно (perception ночью +)
//   yardWire:bool             — колючка на заборе: через забор не перелезть, только ворота
//   armoryAlarm:bool, armoryDoorHp:int — сейфы и сигнализация в оружейке (крот не украдёт, штурм дольше)
//   cellDoorHp:int            — усиленные замки ИВС: открыть камеры дольше (сек. работы бандита ×)
//   medRoom:bool              — медпункт: раненые стабилизируются, заживление быстрее
//   dog:bool                  — служебная собака: раннее предупреждение во дворе, поиск
//   rangeTraining:bool        — договор с тиром: еженедельная стрельба, рост навыка, расход патронов
//   roofOk:bool, heating:bool, coffee:bool, tvNew:bool, bunks:bool — быт (мораль/усталость/болезни)
//   radioRepeater:bool        — ретранслятор: рации нарядов не пропадают в районах
//   loopholes:bool            — бойницы в стене дежурки на улицу (точки огня без выхода наружу)
// comfort — прибавка к целевой морали всего состава; fatigueRest — ускорение отдыха на смене (0..1)
export const UPGRADES = {
  window_bars: { id: 'window_bars', name: 'Решётки на окна', category: 'defense', price: 900, days: 2, channel: 'commercial',
    flags: { windowsBarred: true },
    desc: 'Сварные решётки на все окна первого этажа. Стрелять через них можно, лезть — нет.',
    effectText: 'Через окна не проникнуть. Окна по-прежнему простреливаются.' },
  steel_door: { id: 'steel_door', name: 'Стальная входная дверь', category: 'defense', price: 1400, days: 2, channel: 'commercial',
    flags: { frontDoorHp: 600 },
    desc: 'Вместо крашеной деревянной — стальная, с двумя ригелями. Сварщик с завода, оплата наличными.',
    effectText: 'Главный вход держит в четыре раза дольше.' },
  back_door_bolt: { id: 'back_door_bolt', name: 'Засов и уголок на чёрный ход', category: 'defense', price: 250, days: 1, channel: 'commercial',
    flags: { backDoorHp: 800 },
    desc: 'Приварить уголок, поставить засов из арматуры. Через чёрный ход теперь только с автогеном.',
    effectText: 'Чёрный ход почти не выбить.' },
  gate_steel: { id: 'gate_steel', name: 'Стальные ворота во двор', category: 'defense', price: 1100, days: 3, channel: 'commercial',
    flags: { gateHp: 700 },
    desc: 'Вместо ржавой сетки на уголках — листовое железо. УАЗ проходит, «девятка» на таран — нет.',
    effectText: 'Двор закрыт от машин и пеших через ворота.' },
  yard_wire: { id: 'yard_wire', name: 'Колючая проволока по забору', category: 'defense', price: 300, days: 1, channel: 'black',
    flags: { yardWire: true },
    desc: 'Моток «колючки», списанный с воинской части. Через забор двора больше не лазят.',
    effectText: 'Во двор — только через ворота.' },
  sandbags: { id: 'sandbags', name: 'Мешки с песком', category: 'defense', price: 200, days: 1, channel: 'official',
    flags: { sandbags: ['post_front_lobby', 'post_lobby_bench', 'post_duty_window', 'post_corridor_c'] },
    desc: 'Сорок мешков с песком из карьера. Баррикада у входа и в вестибюле, позиция у окна дежурки.',
    effectText: 'Новые укрытия в вестибюле, коридоре и у окна дежурки.' },
  duty_armor: { id: 'duty_armor', name: 'Бронеплиты в дежурной части', category: 'defense', price: 2200, days: 3, channel: 'black',
    flags: { dutyArmored: true },
    desc: 'Листы брони с разобранного БТР: под стойку дежурного и на окошко. Достал знакомый прапорщик — не спрашивайте где.',
    effectText: 'Дежурный за пультом почти неуязвим, окошко не простреливается.' },
  loopholes: { id: 'loopholes', name: 'Бойницы в стене дежурки', category: 'defense', price: 400, days: 2, channel: 'commercial', requires: ['duty_armor'],
    flags: { loopholes: true },
    desc: 'Две узкие бойницы на улицу, закрытые стальными заслонками. Крыльцо и УАЗы под прицелом изнутри.',
    effectText: 'Из дежурки можно вести огонь по улице, не выходя.' },
  cctv: { id: 'cctv', name: 'Камеры наблюдения (чёрно-белые)', category: 'comms', price: 2600, days: 4, channel: 'commercial',
    flags: { cameras: ['street', 'yard', 'ivs', 'alley'] },
    desc: 'Четыре камеры и два чёрно-белых монитора в дежурку. Картинка мутная, но машину у крыльца разглядеть можно.',
    effectText: 'Улица, двор, проезд и ИВС на мониторах. Штурм замечают раньше.' },
  generator_overhaul: { id: 'generator_overhaul', name: 'Капремонт генератора', category: 'power', price: 1200, days: 3, channel: 'commercial',
    flags: { generatorReliable: true },
    desc: 'Перебрать дизель, поменять стартер и аккумулятор. Теперь заводится с первого раза, а не с пятого и с матом.',
    effectText: 'Генератор включается сразу и не глохнет (нужна солярка).' },
  emergency_lights: { id: 'emergency_lights', name: 'Аварийное освещение', category: 'power', price: 500, days: 2, channel: 'commercial',
    flags: { emergencyLights: true },
    desc: 'Аккумуляторные светильники в коридоре, дежурке и у камер. Когда гаснет свет — не гаснет совсем.',
    effectText: 'При отключении питания коридоры и ИВС тускло освещены.' },
  panic_button: { id: 'panic_button', name: 'Тревожная кнопка (связь с ОМОНом)', category: 'comms', price: 1500, days: 5, channel: 'official',
    flags: { omonLink: { delayMin: 25 } },
    desc: 'Прямая линия на пульт ОМОНа. Нажал — и через двадцать пять минут, если дороги не перекрыты, приедут.',
    effectText: 'Подкрепление ОМОНа через 25 минут после тревоги.' },
  omon_friend: { id: 'omon_friend', name: 'Договорённость с командиром ОМОНа', category: 'comms', price: 800, days: 1, channel: 'black', requires: ['panic_button'],
    flags: { omonLink: { delayMin: 15 } },
    desc: 'Баня, рыбалка и ящик коньяка для командира роты ОМОНа. Теперь на ваш вызов едут первыми.',
    effectText: 'ОМОН приезжает через 15 минут.' },
  backup_phone: { id: 'backup_phone', name: 'Радиотелефон «Алтай»', category: 'comms', price: 1300, days: 3, channel: 'commercial',
    flags: { backupPhone: true },
    desc: 'Если перережут телефонный провод — связь с «Гранитом» останется.',
    effectText: 'Связь с городом при обрыве линии.' },
  radio_repeater: { id: 'radio_repeater', name: 'Ретранслятор на крышу', category: 'comms', price: 1800, days: 4, channel: 'commercial',
    flags: { radioRepeater: true },
    desc: 'Антенна и ретранслятор: наряды на Промзоне и в Частном секторе больше не пропадают из эфира.',
    effectText: 'Рации нарядов не теряют связь в дальних районах.' },
  floodlight: { id: 'floodlight', name: 'Прожектор во двор', category: 'defense', price: 350, days: 1, channel: 'commercial',
    flags: { yardLight: true },
    desc: 'Прожектор с автобазы на углу крыши. Ночью двор и ворота как на ладони.',
    effectText: 'Ночью двор освещён: нападающих видно издалека.' },
  armory_safe: { id: 'armory_safe', name: 'Сейфы и сигнализация в оружейке', category: 'defense', price: 1100, days: 3, channel: 'official',
    flags: { armoryAlarm: true, armoryDoorHp: 900 },
    desc: 'Новые оружейные шкафы, вторая решётка и сигнализация на пульт дежурного.',
    effectText: 'Из оружейки не украсть; штурмом её брать вдвое дольше.' },
  ivs_locks: { id: 'ivs_locks', name: 'Новые замки и засовы в ИВС', category: 'defense', price: 600, days: 2, channel: 'official',
    flags: { cellDoorHp: 2.5 },
    desc: 'Врезные замки и амбарные засовы на камеры. Ключи — только у конвойного и дежурного.',
    effectText: 'Бандиты открывают камеры в 2,5 раза дольше, побеги реже.' },
  med_room: { id: 'med_room', name: 'Медпункт', category: 'comfort', price: 900, days: 2, channel: 'commercial',
    flags: { medRoom: true },
    desc: 'Кушетка, стерилизатор, капельница, шкаф с лекарствами в бывшей кладовке.',
    effectText: 'Раненые стабилизируются, травмы заживают на треть быстрее.' },
  dog: { id: 'dog', name: 'Служебная собака', category: 'defense', price: 700, days: 3, channel: 'official',
    flags: { dog: true },
    desc: 'Немецкая овчарка по кличке Джульбарс из питомника УВД. Нужен кинолог — или хотя бы тот, кто её кормит.',
    effectText: 'Раннее предупреждение во дворе, поиск по следу. С кинологом — сильнее.' },
  range_deal: { id: 'range_deal', name: 'Договор с тиром ДОСААФ', category: 'training', price: 600, days: 1, channel: 'commercial',
    flags: { rangeTraining: true },
    desc: 'Раз в неделю — стрельбы в тире ДОСААФ. Патроны свои.',
    effectText: 'Раз в неделю стрельбы: растёт меткость. Расходует патроны 9×18.' },
  roof_repair: { id: 'roof_repair', name: 'Ремонт крыши', category: 'comfort', price: 1600, days: 4, channel: 'commercial', comfort: 3,
    flags: { roofOk: true },
    desc: 'Крыша течёт над дежуркой и комнатой отдыха. В дождь вёдра, в мороз сосульки, в щитке — замыкания.',
    effectText: 'Не течёт: мораль выше, меньше замыканий и простуд.' },
  heating: { id: 'heating', name: 'Ремонт отопления', category: 'comfort', price: 1300, days: 3, channel: 'commercial', comfort: 2, winterComfort: 5,
    flags: { heating: true },
    desc: 'Поменять батареи, промыть стояк, поставить масляные обогреватели в дежурку и ИВС.',
    effectText: 'Зимой тепло: мораль, меньше больничных, задержанные не болеют.' },
  coffee_maker: { id: 'coffee_maker', name: 'Кофеварка в комнату отдыха', category: 'comfort', price: 350, days: 1, channel: 'commercial', comfort: 3, fatigueRest: 0.15,
    flags: { coffee: true },
    desc: 'Импортная капельная кофеварка. Подарок от коммерсанта — или покупка, если вы честный.',
    effectText: 'Мораль, отдых на смене эффективнее.' },
  tv_new: { id: 'tv_new', name: 'Новый телевизор', category: 'comfort', price: 1500, days: 1, channel: 'commercial', comfort: 2,
    flags: { tvNew: true },
    desc: '«Самсунг» с пультом вместо «Рекорда», который включается ударом кулака.',
    effectText: 'Мораль. Новости и сериалы без ряби.' },
  bunks: { id: 'bunks', name: 'Койки в комнату отдыха', category: 'comfort', price: 400, days: 1, channel: 'official', comfort: 2, fatigueRest: 0.25,
    flags: { bunks: true },
    desc: 'Две армейские двухъярусные койки с матрасами. Ночная смена сможет поспать по очереди.',
    effectText: 'Ночью усталость на смене растёт вдвое медленнее.' },
};
UPGRADES.cleaner = { id: 'cleaner', name: 'Уборщица (тётя Валя)', category: 'comfort', price: 150, days: 1, channel: 'commercial', comfort: 1,
  flags: { cleaner: true },
  desc: 'Пенсионерка с соседней улицы: моет полы каждый день, гоняет курильщиков и посетителей в грязной обуви. Подённо — 8 тыс. в день из кассы.',
  effectText: 'Чистота в здании держится сама; хозтовары расходуются экономнее.' };
export const UPGRADE_LIST = Object.values(UPGRADES);

// Базовые значения флагов (без улучшений)
export const BASE_FLAGS = {
  windowsBarred: false, frontDoorHp: 150, backDoorHp: 300, gateHp: 200, sandbags: [], dutyArmored: false, cameras: [],
  generatorReliable: false, emergencyLights: false, omonLink: null, backupPhone: false, yardLight: false, yardWire: false,
  armoryAlarm: false, armoryDoorHp: 400, cellDoorHp: 1, medRoom: false, dog: false, rangeTraining: false,
  roofOk: false, heating: false, coffee: false, tvNew: false, bunks: false, radioRepeater: false, loopholes: false, cleaner: false,
};
