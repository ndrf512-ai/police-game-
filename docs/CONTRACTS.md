# «Участок» — контракты подсистем (читать ВСЕМ агентам)

Игра: тактический симулятор начальника отделения милиции, Россия, осень 1996. Вид от первого лица по участку, реальное время с паузой. Город игрок НЕ видит — узнаёт о нём по рации, ТВ, звонкам, посетителям, задержанным, раненым. Мрачно, всегда пасмурно/дождь. Участок — тёплый островок безопасности.
Платформа: браузер (Android Chrome в первую очередь, горизонтальная ориентация, сенсорное управление) → потом APK через WebView. Чистый JavaScript ES-модули, **без внешних библиотек**. Весь текст игры — на русском. Сборка — esbuild в один HTML.

Язык и стиль: ES2020 модули, `export`. Никаких глобалов, кроме тех, что описаны. Не трогать чужие файлы — только свои. Если чего-то не хватает в чужом API — напиши мок у себя и оставь пометку `// CONTRACT-NEEDS:` в коде и в своём отчёте.

## Уже готово (можно импортировать)
- `src/core/rng.js` — `RNG` (seeded: next, range, int, chance, pick, weighted, shuffle, sample, gauss, fork), `uid(prefix)`, `clamp`, `lerp`.
- `src/core/bus.js` — `Bus` (on/once/emit).
- `src/core/names.js` — `randomPerson(rng, gender?)` → `{gender:'m'|'f', firstName, lastName, patronymic}`, `fullName`, `shortName`, `femSurname`, `randomNick(rng)`.
- `src/world/level.js` — планировка (ROOMS, DOORS, POINTS, PROPS, CELLS…). Метры, Y вверх, плоскость XZ. Здание x0..32, z0..20; юг (z>20) улица с двумя УАЗами; север (z<0) двор, чёрный ход; восточный проезд x32..37.5 соединяет улицу с воротами двора.
- `src/world/world.js` — `World`: `zoneAt(x,z)`, `zone(id)`, `zoneCenter(id)`, `randomPointInZone(id,rng)`, `zoneNeighbors(id)`, `findPath(x0,z0,x1,z1,{avoid})→[{x,z}]|null`, `isWalkable`, `lineOfSight`, `lineOfFire` (окна/решётки простреливаются), `raycast`, `coverBetween(ax,az,bx,bz)→0..1`, `coverPoints[]`, `findCover(x,z,threatX,threatZ,r,filter)`, `setBarricade(doorId,hp)`, `damageBarricade`, `removeBarricade`, `doors[]`, `setCellDoor(cellId,open)`, `points{}` (именованные точки, см. level.js), `actors[]`, `addActor/removeActor/actorById/actorsInZone/nearestActor`, `pointTaken(pointId)`, хуки `world.onSay(actor,text)`, `world.onDeath(actor,from,info)`.
- `src/world/actor.js` — `Actor`: поля `id, team('police'|'bandit'|'civil'|'prisoner'|'player'), officerId, personId, look, x,z,yaw, hp, alive, pose('stand'|'crouch'|'sit'|'lie'), anim, brain, data{}, speech, target, zone, claimedPoint, reservedCover`; методы `moveTo(x,z,{run,onArrive,stopDist})`, `goToPoint(pointId,{run,stand,onArrive})`, `stop()`, `moving`, `faceTo`, `turnTowards(yaw,dt)`, `say(text,dur)`, `playAnim(name,dur)`, `damage(amount,from,info)`, `die()`, `update(dt,ctx)`. Мозг: объект `{update(actor,dt,game), onDamage?(actor,amount,from,info), onDeath?(actor,from,info)}`.
  - `look`: `{uniform:'militia'|'militia_coat'|'omon'|'civil_m'|'civil_f'|'bandit_track'|'bandit_leather'|'bandit_camo'|'junkie'|'prisoner'|'medic', gender:'m'|'f', skin:0..3, hair:0..5, hat:'cap'|'ushanka'|'beanie'|'helmet'|'mask'|'none', armor:bool, weapon:'none'|'pm'|'aks74u'|'ks23'|'shotgun'|'knife'|'bat'|'tt', build:0.85..1.15}`
  - `anim` — вычисляется сам из позы/движения; разовые: `playAnim('shoot'|'hit'|'talk'|'drink'|'smoke'|'phone'|'write'|'punch'|'reload'|'wave'|'cuff', dur)`. `data.idleAnim` можно задать ('smoke','drink','talk','phone','write','guard').

## Время
1 реальная секунда = 1 игровая минута при скорости ×1. Скорости: 0 (пауза), 1, 3, 10. Во время боя максимум ×1.
`state.time = {day: 1.., minute: 0..1439}`. Смена: 08:00 развод → сутки → 08:00 итоги и новый день.
Подсистемы получают `dtMin` (игровые минуты) для симуляции города/персонала, а акторы — `dt` в секундах «игрового» времени (= realDt*speed).

## Объект `game` (src/game.js — пишет главный разработчик)
```
game.state        // всё сохраняемое состояние (JSON-сериализуемо!)
game.bus          // Bus
game.rng          // RNG (основной); подсистемы делают свой через game.rng.fork(n)
game.world        // World (только в браузере/симуляции участка)
game.sim.crimes   // модуль генератора преступлений (агент A)
game.sim.city     // модуль города (агент B1)
game.sim.staff    // персонал (агент B2)
game.sim.economy  // деньги/склад/снабжение (B2)
game.sim.detainees// задержанные (B2)
game.sim.campaign // режимы/цели (B2)
game.station      // ИИ жизни участка (агент C) — экземпляр
game.combat       // бой и оборона (агент D) — экземпляр
game.ui           // интерфейс (агент E)
game.audio        // звук (агент F)
game.player       // {x,z,yaw,pitch, actor, hp, weapon, ammo, crouch, gender} — контроллер игрока
game.paused, game.speed, game.setSpeed(n), game.togglePause()
game.timeStr()    // "Д3 14:05"
game.save(), game.load(), game.newGame(opts)
game.officer(id)  // state.staff.find
game.log(text, kind) // запись в журнал state.log + bus 'log'
```
Модули sim — **объекты с функциями**, принимающими `game` первым аргументом (без своего состояния вне `game.state`). Station/combat/ui/audio — классы-экземпляры (могут хранить несохраняемые рантайм-данные).

## Состояние `game.state` (кто владеет — тот создаёт и меняет; остальные читают или зовут API владельца)
```
state.version=1, state.seed, state.mode:'campaign'|'sandbox', state.difficulty:'easy'|'normal'|'hard'
state.player = {gender, firstName, lastName, patronymic, rank:'майор', hp:100}
state.time = {day, minute}
state.settings = {...}                    // UI
state.log = [{day,minute,text,kind}]      // общий журнал
state.flags = {}                          // любые флаги сюжета

// B2 — staff
state.staff = [Officer]
state.candidates = [Officer]              // кандидаты на найм
// B2 — economy
state.economy = {money, budgetPerWeek, inventory:{itemId:count}, ammo:{'9x18':n,'5.45x39':n,'12ga':n,'7.62x25':n}, fuel, deliveries:[{itemId,qty,arriveDay}], upgrades:{upgradeId:true}, vehicles:[{id:'uaz_1'|'uaz_2', name, condition 0..100, status:'station'|'task'|'repair'|'destroyed', taskId}]}
// B2 — detainees
state.detainees = [Detainee]
// B2 — campaign
state.campaign = {goalText, objectives:[{id,text,done,failed}], chapter, daysLimit|null, result:null|'win'|'lose', reason}
// B1 — city
state.city = {districts:[District], gangs:[Gang], tasks:[Task], crimes:[Crime(активные/недавние, ≤200)], informants:[...], offers:[...], intel:[...], news:[...], stats:{...}}
state.radio = [RadioMsg]                  // B1 владеет, остальные добавляют через game.sim.city.radio(game, msg)
// D — combat
state.defense = {alert:'normal'|'raised'|'siege', groups:[DefenseGroup], barricades:{doorId:hp}}
state.zones = {zoneId:{owner:'police'|'enemy'|'contested', control:-1..1}}
state.attackPlans = [{id, gangId, day, minute, size, tier, entry:'front'|'back'|'both', reason, warned}]
state.attack = null | {id, gangId, startedAt, phase, ...}
```

### Officer (B2)
```
{ id:'o_..', gender, firstName, lastName, patronymic, age, rank, role:'pps'|'oper'|'duty'|'uchastkovy'|'driver'|'guard'|'kinolog',
  traits:[traitId], skills:{shooting,tactics,perception,fitness,discipline,talk,investigation,driving}  // 0..100
  hp, fatigue, morale, stress, loyalty   // 0..100 (fatigue 100 = вымотан)
  hidden:{corruption, mole:false, gangId:null, addiction:null|'alcohol'|'gambling'}
  status:'station'|'task'|'home'|'hospital'|'dead'|'fired'|'missing'|'leave'
  onShift:bool, taskId:null, groupId:null,
  equipment:{weapon:'pm'|'aks74u'|'ks23'|'none', ammo:int, armor:'none'|'vest'|'heavy', helmet:bool, radio:bool},
  injuries:[{name, severity 1..3, daysLeft}], xp, stats:{arrests,kills,wounds,daysServed},
  bio, family:{married, kids, note}, look:{skin,hair,build,mustache,glasses},
  relations:{[officerId]: -100..100}, history:[{day,text}] }
```
TRAITS (B2 экспортирует `TRAITS` = [{id,name,desc,mods:{courage,aggression,discipline,...}}]). Минимум: coward(трус), hothead(горячий), pedant(педант), drinker(пьющий), honest(честный), greedy(жадный), afghan(ветеран Афгана), chechnya(прошёл Чечню), family_man(семьянин), rookie(салага), veteran(старый служака), lucky(везучий), marksman(снайпер), talker(болтун), silent(молчун), sadist(жестокий), kind(добряк), lazy(лентяй), ambitious(карьерист), superstitious(суеверный), athlete(спортсмен), sick(больной), sharp(глазастый), leader(прирождённый командир).
Помощник: `game.sim.staff.mod(officer, key)` → суммарный модификатор черт (например courage −0.4 у труса).

### Detainee (B2)
`{id, person:{gender,firstName,lastName,patronymic}, nick, age, look, charge, crimeId, gangId, danger 0..100, cooperation 0..100, health, intel:[intelId], status:'cell'|'released'|'transferred'|'escaped'|'dead', cell:'cell_1'|'cell_2'|'cell_3', arrivedDay, notes:[]}` — до 3 человек в камере.

### District (B1; базовые данные — агент A в `src/data/districts.js`)
Ровно 6 районов (id фиксированы): `rynok` (Рынок), `vokzal` (Вокзал), `promzona` (Промзона), `cheremushki` (Черёмушки — спальный район), `centr` (Центр), `chastnyi` (Частный сектор и дачи).
`{id, name, desc, mapPoly:[[x,y],..] (0..1 коорд. карты), labelPos:[x,y], places:[Place], crime 0..100, trust 0..100, influence:{gangId:0..100}, presence 0..100 (присутствие милиции сегодня), stats:{crimes,solved,today}}`
Place: `{id, name, prep (с предлогом: "на Центральном рынке"), kind:'kiosk'|'shop'|'bank'|'school'|'bar'|'flat'|'garage'|'warehouse'|'street'|'park'|'station'|'factory'|'market'|'dacha'|'hostel'|'church'|'office'|'hospital'..., guardable:bool, value 1..5}` — минимум 12 мест на район.

### Gang (B1)
`{id, name, type:'sport'|'afghan'|'thieves'|'drugs'|'frostbitten', leader:{person,nick,known:bool,status:'free'|'arrested'|'dead'}, members, strength 0..100, money, anger 0..100, weaponsTier 1..3, territory:[districtId], known 0..100, status:'active'|'broken', style:string}`
Пять группировок по типам (без национальных стереотипов): «спортсмены» (братва в спортивках), «афганцы» (бывшие военные, дисциплина и автоматы), «блатные/воры» (старая школа, понятия), «наркоторговцы», «отморозки» (беспредельщики, непредсказуемы).

### Crime (A генерирует, B1 хранит)
```
{ id, typeId, category:'violent'|'property'|'drugs'|'organized'|'public_order'|'economic'|'domestic'|'traffic'|'other', severity 1..5,
  title, districtId, place:Place, day, minute, perps:[{person, nick?, age, desc, armed:'none'|'knife'|'bat'|'pistol'|'rifle'|'shotgun', gangId|null}],
  victims:[{person, age, desc, condition:'ok'|'injured'|'serious'|'dead'}], witnesses:int, evidence:[string], loot:string|null,
  text:{dispatch, caller, news|null, details}, solvability 0..1, danger 0..1, gangId|null, inProgress:bool, durationMin,
  status:'new'|'responding'|'resolved'|'unsolved', tags:[] }
```

### Task — задание наряду в городе (B1)
```
{ id, type:'patrol'|'guard'|'ambush'|'raid'|'investigate'|'respond'|'escort'|'search',
  districtId, placeId|null, targetCrimeId|null, targetGangId|null,
  officerIds:[...], leaderId, vehicle:'uaz_1'|'uaz_2'|null,
  orders:{ stance:'cautious'|'normal'|'aggressive', force:'return_fire'|'proportional'|'free',
           detain:'all'|'serious'|'none', respondCalls:bool, reportEvery:30|60|120, retreatOnWounded:bool,
           returnAt:minuteOfDay|null, durationMin, focus:'visible'|'stealth'|'checks'|'kiosks'|'drunks'|'drugs'|..., note:string },
  phase:'departing'|'enroute'|'active'|'returning'|'done', createdAt:{day,minute}, elapsed, durationMin,
  results:{detainees:[],crimesPrevented:0,crimesSolved:0,wounded:[],killed:[],money:0,evidence:[],intel:[]}, log:[{day,minute,text}] }
```

### RadioMsg (B1)
`{id, day, minute, from:'dispatch'|officerId|'duty'|'unknown', fromName, callsign, text, kind:'info'|'request'|'alarm'|'chatter'|'report', taskId|null, choices:[{id,label}]|null, answered:null|choiceId, expires:{day,minute}|null, autoChoice:choiceId|null}`
Позывные нарядов: «Сокол-1», «Берёза-2»… Дежурный по городу — «Гранит», участок — «Заря».

## API модулей (точные имена!)

### A — `src/sim/crimes.js` + `src/data/districts.js` + `src/data/crime_types.js` (+ любые data-файлы `src/data/crime_*.js`)
```
export const DISTRICTS                       // базовые данные 6 районов с местами (см. District)
export const CRIME_TYPES                     // ≥ 70 типов
export function generateCrime(rng, ctx)      // ctx:{district, gangs, day, minute, heat?, typeId?, forceInProgress?} → Crime
export function outcomeText(rng, crime, outcome, leaderName) // outcome:'detained'|'escaped'|'shootout_win'|'shootout_loss'|'prevented'|'nothing'|'false_alarm'|'found_body'|'resolved_talk' → строка для рации
export function generateNews(rng, ctx)       // ctx:{day, city?, recentCrimes?, gangs?} → [{title, text, districtId|null, kind:'crime'|'politics'|'economy'|'weather'|'sport'|'culture'|'local', crimeId?}]
export function generateVisitor(rng, ctx)    // посетитель у окошка дежурного → {person, age, look, mood:'angry'|'scared'|'crying'|'drunk'|'calm'|'shifty', lines:[реплики], complaint, crime|null, isFake:bool, choices:[{id,label,effect}]}
export function generateCall(rng, ctx)       // звонок дежурному → {callerDesc, lines:[...], crime}
export function patrolEvent(rng, ctx)        // мелкое событие во время патруля → {text, kind, crime|null, choice?:{question, options:[{id,label}]}}
export function chatter(rng, ctx)            // фоновые реплики эфира/коллег → строка
```
Требование: огромная вариативность — комбинаторика шаблонов (тип × место × исполнители × жертвы × детали × осложнения × время суток × сезон), чтобы за 100 игровых дней почти ничего не повторялось. Атмосфера 90-х: ларьки, «крыши», ваучеры, челноки, видеосалоны, «Сникерсы», спирт «Рояль», малиновые пиджаки, задержки зарплат, пейджеры, «девятки», ваучерные фонды, МММ. Без чернухи ради чернухи, без глумления; мрачно и по-человечески.

### B1 — `src/sim/city.js`
```
export const city = {
  init(game),                        // создать districts (из DISTRICTS), gangs, начальные влияния
  update(game, dtMin),               // генерация преступлений по времени суток, симуляция нарядов, рации, влияния банд
  createTask(game, spec) → {ok, task|reason},   // spec = Task без служебных полей
  cancelTask(game, taskId),          // отозвать наряд (возвращаются)
  onDeparted(game, taskId), onReturned(game, taskId),  // вызывает ИИ участка, когда наряд дошёл до УАЗа/вернулся (если не вызовут за 6 игр. минут — сам)
  radio(game, msg) → msg,            // добавить сообщение (emit 'radio')
  answerRadio(game, msgId, choiceId),
  briefing(game) → {date, lines:[...], news:[...], hotspots:[{districtId, why}], intel:[...]},  // утренний развод
  daySummary(game) → {...},          // итоги суток (для UI)
  taskTypes() → [{id,name,desc,minOfficers,maxOfficers,needsPlace,needsTarget,orderOptions:[...]}], // для мастера заданий в UI
  validTargets(game, type, districtId) → [{id,name,desc}],
  estimate(game, spec) → {risk 0..1, effect:string, durationMin}, // подсказка в UI
}
```
Связь с участком через шину: `task:depart {taskId, officerIds, vehicle}`, `task:return {taskId, officerIds, wounded:[ids], detainees:[detIds], dead:[ids]}`, `crime:new {crime}`, `radio {msg}`, `visitor:arrive {visitor}`, `call:incoming {call}`, `attack:warning {plan}` (когда информатор предупредил). Когда влияние/злость банды велики — `game.combat.planAttack(game, gangId, reason)`.
Предложения взяток/«крыши»/давления начальства — `state.city.offers` + `bus 'offer' {offer}` где offer = `{id, from, title, text, choices:[{id,label,desc}], expires}`; ответ `city.answerOffer(game, offerId, choiceId)`.

### B2 — `src/sim/staff.js`, `src/sim/economy.js`, `src/sim/detainees.js`, `src/sim/campaign.js`, `src/data/items.js`
```
export const TRAITS, RANKS, ROLES
export const staff = {
  init(game, n=12), update(game, dtMin), dayStart(game), dayEnd(game),
  mod(officer, key) → number, available(game) → Officer[] (status 'station' и onShift),
  setShift(game, id, on), reward(game, id, kind:'bonus'|'thanks'|'dayoff'), reprimand(game, id, kind:'verbal'|'written'|'fine'),
  promote(game, id), fire(game, id), hire(game, candidateId), sendLeave(game, id, days), sendHospital(game,id),
  talk(game, id, topic:'how_are_you'|'family'|'work'|'loyalty'|'rumors'|'drinking') → {lines:[...], effects},
  investigate(game, id) → {text, found:bool},   // проверка на «крота»/коррупцию (время/деньги)
  applyInjury(game, id, severity, cause), kill(game, id, cause),
  describe(officer) → string, displayName(officer) → "ст. сержант Петров",
}
export const ITEMS, UPGRADES
export const economy = { init(game), dayStart(game), buy(game, itemId, qty) → {ok,reason}, buyUpgrade(game, id), issue(game, officerId, itemId) → {ok,reason}, unissue(game, officerId, slot), canAfford(game, cost), addMoney(game, amount, reason), weeklyBudget(game) }
export const detainees = { add(game, data) → Detainee|null, interrogate(game, id, approach:'soft'|'hard'|'deal'|'threat'|'cellmate') → {lines, intel, effects}, release(game,id), transfer(game,id), dayStart(game), freeCells(game) }
export const campaign = { init(game, mode), update(game), checkEnd(game) → null|{result, reason} }
```
Деньги — «тыс. руб.» (1996). Бюджет нищенский; зарплаты задерживают — мораль падает. Снабжение через звонок «в управление»/коммерсанту — доставка через N дней.

### C — `src/ai/station.js` (+ `src/ai/barks.js`)
```
export class StationAI {
  constructor(game)
  start()                       // заспавнить акторов персонала на смене, задержанных в камерах
  update(dt)                    // распорядок: дежурный за пультом, конвой у ИВС, оружейник, отдых (чай, ТВ, курилка, туалет, болтовня), реакция на посетителей, приём/выпуск нарядов (идут в оружейку → к УАЗу → исчезают; возвращаются из машины), конвой задержанных в камеры
  orderOfficer(officerId, order) // order: {type:'follow'|'goto'|'post'|'rest'|'home'|'duty'|'guard_cells'|'patrol_inside', pointId?, x?, z?}
  actorForOfficer(officerId) → Actor|null
  onPlayerTalk(actor) → [{id,label}]  // варианты, когда игрок подошёл к актору (UI отрисует)
  setCombatMode(on)             // передать акторов бою (game.combat) / вернуть
}
```
Подписки: `task:depart`, `task:return`, `visitor:arrive`, `call:incoming`, `day:start`, `day:end`, `detainee:new`. Реплики (барки) с характером, родом (она/он) и званиями; приветствие игрока: «Здравия желаю, товарищ майор». Для женщины-командира обращения те же («товарищ майор»), но реплики в 3-м лице — в женском роде («майор сказала…»).

### D — `src/ai/combat.js` (+ `src/ai/weapons.js`, `src/ai/doctrine.js`)
```
export const WEAPONS = {pm, aks74u, ks23, tt, shotgun, knife, bat, sawnoff, ...}  // {name, damage, rpm, spread, range, mag, ammoType, sound}
export const DOCTRINES   // описание опций для UI
export class Combat {
  constructor(game)
  planAttack(game, gangId, reason, opts?) → plan   // в state.attackPlans; время через 6–48 игр. часов
  update(dt)                     // старт атак по расписанию, бой, захват/контроль зон, конец боя
  createGroup(spec) / updateGroup(id, patch) / removeGroup(id)  // DefenseGroup = {id, name, leaderId, memberIds, zoneId, doctrine:{hold:'hold'|'fallback'|'counter'|'retake', fallbackAt:0.3, fallbackZone, roe:'free'|'return'|'hold_fire', priority:'nearest'|'armed'|'leader', protect:'none'|'cells'|'armory'|'generator'|'commander', note}}
  setAlert(level), placeBarricade(doorId), playerShoot(origin{x,y,z}, dir{x,y,z}, weaponId) → hit info, damagePlayer(amount)
  active → bool
}
```
Бандиты: отряды с командиром, роли (штурм, прикрытие, поджигатель, освободитель — идёт к камерам выпускать своих), мораль и отступление; разное поведение по типу банды. Полиция: командир группы сам расставляет бойцов по укрытиям зоны, держит/отходит/контратакует по доктрине с поправкой на черты. Генератор захвачен → `bus 'power' false` (свет гаснет). Захваченная оружейка → нет выдачи патронов. ИВС → бандиты открывают камеры (`world.setCellDoor`), задержанные бегут/присоединяются. Оккупация: если к концу штурма враги удерживают зоны, они остаются там, пока их не выбьют (группа с доктриной `retake`).
События: `attack:start {plan}`, `attack:end {result:'repelled'|'occupied'|'fallen', losses}`, `zone:changed {zoneId, owner}`, `shot {x,z, weapon, by}` (звук), `power {on}`.

### E — `src/ui/*` (+ `src/ui/style.css` как JS-строка в `src/ui/style.js`)
```
export class UI {
  constructor(game, rootEl)
  open(screenId, params), close(), top() → screenId|null, isBlocking() → bool (ввод от первого лица блокирован)
  toast(text, kind), dialog({title, text, portrait?, choices:[{label, desc?, onPick}]}), confirm(text) → Promise<bool>
  update(dt)                     // HUD каждый кадр
  setInteractPrompt(text|null)   // подсказка «Карта города», «Поговорить: сержант Петров»
}
```
Экраны (screenId): `menu`, `newgame`, `briefing`, `citymap` (районы, задания, мастер создания задания с детальными приказами), `personnel` (личные дела, действия), `officer` (карточка), `hiring`, `armory` (выдача снаряжения), `supply` (заказ по телефону), `stationplan` (схема участка: группы обороны, доктрины, баррикады, уровень тревоги), `detainees`, `interrogation`, `radio` (журнал эфира с ответами), `tv`, `visitor`, `offer`, `daysummary`, `pause`, `settings`, `notebook` (цели, журнал), `gameover`, `talk` (разговор с сотрудником).
Стиль: 90-е, советская канцелярия — бумага, машинопись (моноширинный), штампы, скрепки; рация — зелёный ЖК; ТВ — кинескоп. Крупные элементы для пальцев (≥44px), горизонтальная ориентация телефона 640×360 css-px минимум.
Зарезервированная зона под сенсорное управление (рисует главный разработчик в `#controls`): левая нижняя четверть — джойстик, правая нижняя — кнопки (действие, огонь, присесть, бег). HUD: верх — часы/день/скорость/пауза; левый верх — лента рации; центр — прицел и подсказка взаимодействия (над кнопкой действия).

### F — `src/engine/audio.js`
```
export class Audio { init() (по первому жесту), setListener(x,z,yaw), play(name,{x,z,vol,rate}), loop(name,{vol}) → handle{stop(),setVol()}, ambience({rain:0..1, hum:0..1, tv:0..1, power:bool, tension:0..1}), radioBurst(kind), setVolume(master,sfx,ambience) }
```
Только процедурный синтез WebAudio (без файлов). Имена звуков: shot_pm, shot_ak, shot_ks23, shot_tt, shot_sawnoff, ricochet, glass_break, step_lino, step_tile, step_concrete, step_wet, door_wood, door_steel, cell_door, phone_ring, phone_pickup, typewriter, radio_squelch, radio_static, kettle, thunder, hit_flesh, body_fall, punch, reload, empty_click, explosion_far, siren_far, dog_far, car_engine, car_door, ui_click, ui_paper, ui_stamp, generator_start, generator_stop, power_down, alarm_bell, scream_m, scream_f, glass_shards, crowd_murmur, footsteps_run.

## Сохранения
`game.state` целиком в `localStorage` (обёртка try/catch). Никаких функций, классов, циклических ссылок в state. Рантайм-объекты (акторы) восстанавливаются по state.

## Тесты
Каждый агент пишет `test/<своё>_test.mjs` (node) — генерирует много данных/симулирует дни и печатает примеры и статистику, проверяет отсутствие исключений и `undefined`/`NaN` в текстах. Запуск: `node test/xxx_test.mjs` из корня `/home/claude/militsiya` (package.json уже `type: module`).
