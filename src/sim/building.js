// Состояние здания отделения (v1.1, пп. 5/9/11.6 ТЗ): чистота, порядок, оборудование, хозяйственный запас и поломки.
// Каждые сутки здание изнашивается: люди, посетители, задержанные, бои, стрельба, погода. Восстанавливается
// хозтоварами со склада (товары категории «Хозяйство» в снабжении), уборщицей (улучшение) и субботником.
// Эффекты: целевая мораль состава (staff.moraleTarget читает state.building.moraleMod), доверие районов,
// неисправный телефон теряет часть звонков (city_crime), неисправная проводка изредка гасит свет,
// машинка — отчёты от руки (авторитет), раз в неделю — оценка управления.
// Состояние: state.building = { clean, order, equipment, supplies (0..100), broken:{typewriter,phone,light}, ... }
// Шина: 'building:changed' {conds, ...} — рендер перестраивает «условные» предметы (мусор, пятна, протечки).
import { clamp } from '../core/rng.js';
import { campaign } from './campaign.js';
import { trust } from './city_core.js';
import { glog } from './staff.js';

const B = (game) => game.state.building;
const day = (game) => game.state.time.day;
const absMin = (game) => game.state.time.day * 1440 + game.state.time.minute;
const inService = (o) => o && o.status !== 'dead' && o.status !== 'fired';
const r1 = (v) => Math.round(v * 10) / 10;

/** Хозтовары: эффект одной единицы со склада */
export const SUPPLY_ITEMS = {
  cleaning: { short: 'хозтовары', clean: 14, order: 2, supply: 12 },
  paint: { short: 'краска', order: 18, equipment: 4, clean: 3, supply: 10 },
  tech_parts: { short: 'запчасти к оргтехнике', equipment: 12, fixes: ['typewriter', 'phone'], supply: 10 },
  bulbs: { short: 'лампы', equipment: 6, fixes: ['light'], supply: 8 },
};
export const BROKEN_NAMES = { typewriter: 'пишущая машинка', phone: 'телефон дежурной части', light: 'проводка и освещение' };
const CLEANER_WAGE = 8; // тыс. руб. в день

function emptyToday() { return { visitors: 0, fights: 0, deaths: 0, shots: 0, glass: 0, detainees: 0, lostCalls: 0 }; }
function ensure(game) {
  const s = game.state; if (!s) return null;
  if (!s.building || typeof s.building !== 'object') s.building = {};
  const b = s.building;
  for (const [k, v] of Object.entries({ clean: 68, order: 62, equipment: 58, supplies: 30, moraleMod: 0 })) if (typeof b[k] !== 'number' || !isFinite(b[k])) b[k] = v;
  if (!b.broken || typeof b.broken !== 'object') b.broken = {};
  for (const k of Object.keys(BROKEN_NAMES)) b.broken[k] = !!b.broken[k];
  if (!b.today || typeof b.today !== 'object') b.today = emptyToday();
  for (const [k, v] of Object.entries(emptyToday())) if (typeof b.today[k] !== 'number') b.today[k] = v;
  if (!Array.isArray(b.conds)) b.conds = computeConds(b);
  if (!Array.isArray(b.history)) b.history = [];
  if (typeof b.weekDay !== 'number') b.weekDay = day(game) + 7;
  if (b.outageUntil === undefined) b.outageUntil = null;
  if (b.lastSubbotnik === undefined) b.lastSubbotnik = null;
  if (typeof b.lastNote !== 'string') b.lastNote = '';
  return b;
}
function computeConds(b) {
  const c = [];
  if (b.clean < 60) c.push('dirty');
  if (b.clean < 35) c.push('filthy');
  if (b.equipment < 45) c.push('leak');
  return c;
}
function syncConds(game, force = false) {
  const b = B(game); const c = computeConds(b);
  const changed = c.join(',') !== (b.conds || []).join(',');
  b.conds = c;
  if ((changed || force) && game.bus) game.bus.emit('building:changed', { conds: c.slice(), clean: Math.round(b.clean), order: Math.round(b.order), equipment: Math.round(b.equipment) });
}
function adj(b, k, d) { b[k] = r1(clamp(b[k] + d, 0, 100)); }
function staffMorale(game, d) { for (const o of game.state.staff || []) if (inService(o)) o.morale = clamp((o.morale ?? 50) + d, 0, 100); }
function inBuilding(x, z) { return typeof x === 'number' && typeof z === 'number' && x > -0.5 && x < 32 && z > -0.5 && z < 20; }
function wetWeather(game) { const w = String(game.state.city?.weather || ''); return /дожд|снег|слякот|морос|оттепел|метел/.test(w); }
function ecoFlags(game) { return game.state.economy?.flags || {}; }
function stock(game, id) { return game.state.economy?.inventory?.[id] || 0; }
function takeStock(game, id) { const inv = game.state.economy?.inventory; if (!inv || !(inv[id] > 0)) return false; inv[id]--; return true; }
function recalcSupplies(game) { const b = B(game); let s = 0; for (const [id, it] of Object.entries(SUPPLY_ITEMS)) s += stock(game, id) * it.supply; b.supplies = clamp(Math.round(s), 0, 100); return b.supplies; }

/** Применить единицу хозтовара (уже снятую со склада) */
function applyItem(game, id, k = 1) {
  const b = B(game); const it = SUPPLY_ITEMS[id]; if (!it) return [];
  for (const key of ['clean', 'order', 'equipment']) if (it[key]) adj(b, key, it[key] * k);
  const fixed = [];
  for (const f of it.fixes || []) if (b.broken[f]) { b.broken[f] = false; fixed.push(f); break; }
  return fixed;
}

const attached = new WeakSet();
function attach(game) {
  const bus = game.bus; if (!bus || typeof bus.on !== 'function' || attached.has(bus)) return;
  attached.add(bus);
  const T = () => (game.state && game.state.building ? game.state.building.today : null);
  bus.on('visitor:arrive', () => { const t = T(); if (t) t.visitors++; });
  bus.on('attack:end', () => { const t = T(); if (t) t.fights++; });
  bus.on('shot', (e) => { const t = T(); if (t && e && inBuilding(e.x, e.z)) t.shots++; });
  bus.on('hit', (e) => { const t = T(); if (t && e && e.kind === 'glass') t.glass++; });
  bus.on('actor:death', (e) => { const t = T(); const a = e && e.actor; if (t && a && inBuilding(a.x, a.z)) t.deaths++; });
  bus.on('detainee:new', () => { const t = T(); if (t) t.detainees++; });
}

export const building = {
  SUPPLY_ITEMS, BROKEN_NAMES,
  init(game) {
    const b = ensure(game); attach(game);
    // стартовый запас хозтоваров на складе (один раз, в т.ч. для старых сохранений)
    const inv = game.state.economy?.inventory;
    if (inv && !b.seeded) { b.seeded = true; inv.cleaning = (inv.cleaning || 0) + 3; inv.bulbs = (inv.bulbs || 0) + 1; inv.paint = (inv.paint || 0) + 1; }
    recalcSupplies(game); b.conds = computeConds(b); return b; },
  ensure,
  get(game) { return ensure(game); },
  conds(game) { const b = ensure(game); return b ? b.conds.slice() : []; },
  /** Общая оценка 0..100 */
  overall(game) { const b = ensure(game); return b ? Math.round((b.clean + b.order + b.equipment) / 3) : 50; },
  brokenList(game) { const b = ensure(game); return b ? Object.keys(BROKEN_NAMES).filter((k) => b.broken[k]) : []; },

  /** Поминутно (dtMin — игровые минуты). Дёшево: работа раз в 5 минут. */
  update(game, dtMin) {
    if (!game.state) return; attach(game);
    const b = ensure(game);
    if ((this._acc = (this._acc || 0) + dtMin) < 5) return;
    const step = this._acc; this._acc = 0;
    const now = absMin(game); const fl = game.state.flags || {};
    // неисправная проводка: свет гаснет на пару минут
    if (b.outageUntil != null && now >= b.outageUntil) {
      b.outageUntil = null;
      if (fl.power === false && !game.combat?.active) setPower(game, true, 'электрик');
    } else if (b.broken.light && b.outageUntil == null && fl.power !== false && !game.combat?.active && !game.state.attack && game.rng.chance(step / 900)) {
      b.outageUntil = now + game.rng.int(2, 4);
      setPower(game, false, 'проводка');
      glog(game, 'Опять выбило пробки — проводка на участке ни к чёрту. Нужны лампы и стартеры, электрик просит хотя бы коробку.', 'economy');
    }
    if ((this._sup = (this._sup || 0) + step) >= 60) { this._sup = 0; recalcSupplies(game); }
  },

  /** 08:00, итоги суток: износ за прошедший день */
  dayEnd(game) {
    const b = ensure(game); if (!b) return;
    const t = b.today; const staff = (game.state.staff || []).filter(inService);
    const present = staff.filter((o) => o.status === 'station' || o.onShift).length;
    const cells = (game.state.detainees || []).filter((d) => d.status === 'cell').length;
    const wet = wetWeather(game); const roof = !!ecoFlags(game).roofOk;
    const dClean = 1.5 + present * 0.2 + t.visitors * 0.35 + cells * 0.4 + t.detainees * 0.3 + t.fights * 8 + Math.min(15, t.deaths * 2.5) + (wet ? 2.5 : 0);
    const dOrder = 1.0 + t.visitors * 0.15 + cells * 0.2 + t.fights * 7 + Math.min(5, t.shots * 0.04);
    const dEquip = 0.8 + present * 0.08 + t.fights * 5 + Math.min(8, t.shots * 0.08) + Math.min(6, t.glass) + (wet && !roof ? 1.5 : 0);
    adj(b, 'clean', -dClean); adj(b, 'order', -dOrder); adj(b, 'equipment', -dEquip);
    b.history.push({ day: day(game) - 1, clean: Math.round(b.clean), order: Math.round(b.order), equipment: Math.round(b.equipment), visitors: t.visitors, fights: t.fights, lostCalls: t.lostCalls });
    if (b.history.length > 14) b.history.splice(0, b.history.length - 14);
    b.lastWear = { clean: r1(dClean), order: r1(dOrder), equipment: r1(dEquip) };
    b.today = emptyToday();
  },

  /** 08:00, новый день: уборка, ремонт из запасов, поломки, эффекты */
  dayStart(game) {
    const b = ensure(game); if (!b) return; attach(game);
    const notes = []; const rng = game.rng; const d = day(game);
    recalcSupplies(game);
    // дежурные сами метут полы, пока есть чем
    adj(b, 'clean', b.supplies > 15 ? 3 : 1);
    // уборщица
    const fl = ecoFlags(game);
    if (fl.cleaner) {
      const eco = game.sim?.economy;
      const money = game.state.economy?.money ?? 0;
      if (money >= CLEANER_WAGE) {
        try { eco?.addMoney ? eco.addMoney(game, -CLEANER_WAGE, 'уборщица, подённо') : (game.state.economy.money -= CLEANER_WAGE); } catch (e) { console.error('[building] wage', e); }
        adj(b, 'clean', 7); adj(b, 'order', 2);
        if (b.clean < 90 && takeStock(game, 'cleaning')) { applyItem(game, 'cleaning', 1.3); }
      } else notes.push('уборщица не вышла — в кассе нечем платить');
    }
    // хозтовары со склада идут в дело сами (завхоз)
    if (b.clean < 80 && takeStock(game, 'cleaning')) applyItem(game, 'cleaning');
    if (b.order < 70 && takeStock(game, 'paint')) applyItem(game, 'paint');
    if ((b.broken.typewriter || b.broken.phone || b.equipment < 55) && takeStock(game, 'tech_parts')) { const f = applyItem(game, 'tech_parts'); for (const x of f) notes.push(`починили: ${BROKEN_NAMES[x]}`); }
    if ((b.broken.light || b.equipment < 50) && takeStock(game, 'bulbs')) { const f = applyItem(game, 'bulbs'); for (const x of f) notes.push(`починили: ${BROKEN_NAMES[x]}`); }
    recalcSupplies(game);
    // поломки: чем хуже оборудование — тем чаще
    if (d > 2) {
      for (const k of Object.keys(BROKEN_NAMES)) {
        if (b.broken[k]) continue;
        let p = clamp((66 - b.equipment) / 160, 0.01, 0.35);
        if (k === 'light' && wetWeather(game) && !fl.roofOk) p += 0.05;
        if (rng.chance(p)) { b.broken[k] = true; notes.push(`сломалось: ${BROKEN_NAMES[k]}`); glog(game, { typewriter: 'Сломалась пишущая машинка: западает «ы», каретка не возвращается. Протоколы пишут от руки.', phone: 'Телефон в дежурной части хрипит и рвёт связь. Часть звонков до участка не доходит.', light: 'Проводка искрит, стартеры ламп гудят. Свет может пропасть в любую минуту.' }[k], 'economy'); }
      }
    }
    // эффекты: мораль, доверие, авторитет
    const avg = (b.clean + b.order) / 2;
    b.moraleMod = r1(clamp((avg - 50) / 8, -6, 4));
    if (avg < 35) { staffMorale(game, -2); notes.push('люди жалуются на грязь и разруху'); }
    const dists = game.state.city?.districts || [];
    if (b.clean < 40) { for (const ds of dists) { try { trust(game, ds.id, -0.4); } catch (e) { /* */ } } notes.push('посетители уходят с плохим впечатлением'); }
    else if (b.clean > 75 && b.order > 70) { for (const ds of dists) { try { trust(game, ds.id, 0.15); } catch (e) { /* */ } } }
    if (b.broken.typewriter && d > 1) { try { campaign.addAuthority(game, -1, 'отчёты в управление написаны от руки'); } catch (e) { /* */ } }
    // недельная оценка
    if (d >= b.weekDay) {
      b.weekDay = d + 7;
      const all = this.overall(game);
      if (all >= 70) { try { campaign.addAuthority(game, 3, 'образцовый порядок в отделении'); } catch (e) { /* */ } staffMorale(game, 3); notes.push('управление отметило порядок в отделении'); glog(game, 'Проверяющий из УВД прошёлся по участку и не нашёл к чему придраться. Авторитет вырос, люди довольны.', 'authority'); }
      else if (all <= 32) { try { campaign.addAuthority(game, -3, 'грязь и разруха в отделении'); } catch (e) { /* */ } notes.push('управление недовольно состоянием здания'); glog(game, 'Проверяющий из УВД записал: «Помещения в антисанитарном состоянии, оргтехника неисправна». Авторитет упал.', 'authority'); }
    }
    b.lastNote = notes.join('; ');
    syncConds(game, true);
  },

  /** Звонок в дежурку: дойдёт ли (при сломанном телефоне — половина теряется). Вызывать с rng города. */
  phoneLost(game, rng) {
    const b = B(game); if (!b || !b.broken || !b.broken.phone) return false;
    if ((rng || game.rng).chance(0.5)) { b.today.lostCalls = (b.today.lostCalls || 0) + 1; return true; }
    return false;
  },

  /** Пустить в дело единицу хозтовара со склада вручную */
  use(game, itemId) {
    const b = ensure(game); const it = SUPPLY_ITEMS[itemId];
    if (!it) return { ok: false, reason: 'Это не хозтовар.' };
    if (!takeStock(game, itemId)) return { ok: false, reason: `На складе нет: ${it.short}.` };
    const fixed = applyItem(game, itemId);
    recalcSupplies(game); syncConds(game);
    const txt = { cleaning: 'Вымыли полы, оттёрли стены в вестибюле, вынесли мусор.', paint: 'Подкрасили панели, заделали дыры в стенах, повесили двери на петли.', tech_parts: 'Мастер покопался в оргтехнике.', bulbs: 'Электрик поменял лампы и стартеры.' }[itemId];
    return { ok: true, text: `${txt}${fixed.length ? ' Починили: ' + fixed.map((f) => BROKEN_NAMES[f]).join(', ') + '.' : ''}` };
  },

  /** Субботник: свободные на участке берутся за тряпки (раз в сутки) */
  subbotnik(game) {
    const b = ensure(game); const d = day(game);
    if (b.lastSubbotnik === d) return { ok: false, reason: 'Сегодня уже убирались.' };
    if (game.combat?.active) return { ok: false, reason: 'Не до уборки.' };
    const ppl = (game.state.staff || []).filter((o) => inService(o) && o.status === 'station');
    if (ppl.length < 2) return { ok: false, reason: 'На участке почти никого — убирать некому.' };
    b.lastSubbotnik = d;
    const k = Math.min(1, ppl.length / 6) * (b.supplies > 10 || stock(game, 'cleaning') > 0 ? 1 : 0.5);
    adj(b, 'clean', 18 * k); adj(b, 'order', 8 * k);
    for (const o of ppl) { o.fatigue = clamp((o.fatigue ?? 20) + 8, 0, 100); o.morale = clamp((o.morale ?? 50) - (o.traits?.includes('lazy') ? 4 : 1), 0, 100); }
    syncConds(game);
    return { ok: true, text: `Субботник: ${ppl.length} чел. полдня мыли, мели и выносили хлам.${k < 1 ? ' Без моющих — больше развезли грязь, чем отмыли.' : ''} Люди устали и ворчат.` };
  },

  /** Рекомендации для экрана «Здание» */
  recommendations(game) {
    const b = ensure(game); const fl = ecoFlags(game); const R = [];
    if (b.clean < 55) R.push(stock(game, 'cleaning') ? 'Пустить в дело хозтовары со склада или устроить субботник.' : 'Заказать моющие и хозтовары.');
    if (b.clean < 60 && !fl.cleaner) R.push('Нанять уборщицу (Снабжение → Улучшения): чистота держится сама, 8 тыс. в день.');
    if (b.order < 55) R.push(stock(game, 'paint') ? 'Пустить в дело краску со склада.' : 'Заказать краску и стройматериалы: облупленные стены злят и людей, и начальство.');
    if (b.broken.phone) R.push('Телефон дежурки неисправен — половина звонков теряется. Нужны запчасти к оргтехнике.');
    if (b.broken.typewriter) R.push('Машинка сломана — отчёты от руки, управление недовольно. Нужны запчасти к оргтехнике.');
    if (b.broken.light) R.push('Проводка искрит, свет гаснет. Нужны лампы и стартеры.');
    if (b.equipment < 45 && !fl.roofOk) R.push('Крыша течёт и губит оборудование — подумайте о ремонте крыши.');
    if (b.supplies < 15) R.push('Хозяйственный запас на нуле — без него всё быстро приходит в упадок.');
    if (!R.length) R.push('Здание в приличном состоянии. Держите запас хозтоваров на складе.');
    return R;
  },

  /** Строка для утренней сводки */
  briefingLine(game) {
    const b = ensure(game); if (!b) return '';
    const word = (v) => (v >= 75 ? 'хорошо' : v >= 55 ? 'терпимо' : v >= 35 ? 'плохо' : 'отвратительно');
    const br = this.brokenList(game).map((k) => BROKEN_NAMES[k]);
    return `Здание: чистота — ${word(b.clean)} (${Math.round(b.clean)}), порядок — ${word(b.order)} (${Math.round(b.order)}), оборудование — ${word(b.equipment)} (${Math.round(b.equipment)}).${br.length ? ' Неисправно: ' + br.join(', ') + '.' : ''}${b.lastNote ? ' ' + b.lastNote[0].toUpperCase() + b.lastNote.slice(1) + '.' : ''}`;
  },
};

function setPower(game, on, by) {
  try {
    if (game.combat?.setPower) game.combat.setPower(on, by);
    else { const fl = game.state.flags || (game.state.flags = {}); if ((fl.power !== false) === on) return; fl.power = on; game.bus?.emit('power', { on, by }); }
  } catch (e) { console.error('[building] power', e); }
}

export default building;
