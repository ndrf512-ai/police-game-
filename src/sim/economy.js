// Хозяйство отделения (агент B2): касса (тыс. руб. 1996), бюджет, зарплаты, склад и оружейка, поставки
// по трём каналам, улучшения участка, выдача снаряжения, УАЗы. Состояние — только в game.state.economy.
import { clamp, uid } from '../core/rng.js';
import { ITEMS, ITEM_LIST, UPGRADES, UPGRADE_LIST, BASE_FLAGS, WEAPON_LOADOUT, AMMO_TYPES, CHANNELS } from '../data/items.js';
import { fmt, calendar, money, declSurname, rankCase, shortRank, nWord } from '../data/staff_lang.js';
import { campaign } from './campaign.js';
import { pushInbox, glog } from './staff.js';

export { ITEMS, UPGRADES, ITEM_LIST, UPGRADE_LIST, CHANNELS, AMMO_TYPES, WEAPON_LOADOUT };

const R = (game) => game.rng;
const day = (game) => game.state.time.day;
const E = (game) => game.state.economy;
const fail = (reason) => ({ ok: false, reason, text: reason });
function settings(game) { return (game.state.campaign && game.state.campaign.settings) || presetFor(game.state.difficulty); }
function presetFor(d) { return d === 'easy' ? { startMoney: 8000, budgetPerWeek: 3400, salaryDelayChance: 0.15, budgetDelayChance: 0.1 } : d === 'hard' ? { startMoney: 3000, budgetPerWeek: 1900, salaryDelayChance: 0.45, budgetDelayChance: 0.35 } : { startMoney: 5000, budgetPerWeek: 2600, salaryDelayChance: 0.3, budgetDelayChance: 0.2 }; }
function dateText(game, d) { return calendar(d, game.state.campaign && game.state.campaign.startDate).text; }
function officer(game, id) { return (game.state.staff || []).find((o) => o.id === id) || null; }
function dn(o, c = 'n') { return `${rankCase(shortRank(o.rank), c)} ${declSurname(o.lastName, o.gender, c)}`; }
const inService = (o) => o.status !== 'dead' && o.status !== 'fired';

const SLOT_FIELDS = { armor: 'armorId', helmet: 'helmetId', radio: 'radioId' };
const BOOL_SLOTS = { baton: 'baton_pr73', cuffs: 'cuffs', gas: 'gas_spray', medkit: 'medkit', flashlight: 'flashlight' };
const LONG_GUNS = ['aks74u', 'ks23', 'shotgun', 'sawnoff'];

function computeFlags(e) {
  const f = JSON.parse(JSON.stringify(BASE_FLAGS));
  for (const id of Object.keys(e.upgrades)) {
    const u = UPGRADES[id]; if (!u || !e.upgrades[id]) continue;
    for (const [k, v] of Object.entries(u.flags)) {
      if (k === 'omonLink') f.omonLink = !f.omonLink || v.delayMin < f.omonLink.delayMin ? { ...v } : f.omonLink;
      else if (Array.isArray(v)) f[k] = [...new Set([...(f[k] || []), ...v])];
      else if (typeof v === 'number') f[k] = Math.max(f[k] || 0, v);
      else f[k] = v;
    }
  }
  f.generatorFuelHours = Math.floor((e.diesel || 0) / 5);
  f.armoryStock = { ...e.ammo };
  return f;
}
function refreshFlags(game) { const e = E(game); e.flags = computeFlags(e); return e.flags; }

function ledger(game, amount, reason) {
  const e = E(game);
  e.ledger.push({ day: day(game), amount: Math.round(amount), reason, balance: Math.round(e.money) });
  if (e.ledger.length > 80) e.ledger.splice(0, e.ledger.length - 80);
}

function newVehicle(rng, id, n) {
  const quirks = ['плохо заводится в сырость', 'тянет влево на торможении', 'печка не греет, зато дверь не закрывается', 'бензонасос стучит, как дятел', 'левая фара светит в небо'];
  return { id, name: `УАЗ-469 № ${n}`, plate: `${n} ${rng.pick(['ВЛА', 'КМА', 'НОМ'])}`, condition: rng.int(55, 78), fuel: rng.int(25, 50), maxFuel: 78, km: rng.int(140, 260) * 1000, status: 'station', taskId: null, quirk: rng.pick(quirks), repairUntil: null };
}

export const economy = {
  init(game) {
    const rng = R(game);
    const st = settings(game);
    const s = game.state;
    s.economy = {
      money: st.startMoney ?? 5000, budgetPerWeek: st.budgetPerWeek ?? 2600, nextBudgetDay: day(game) + 7, budgetPending: [],
      inventory: {
        pm: 2, aks74u: 2, ks23: 1, shotgun: 0, tt: 0, sawnoff: 0,
        zh81: 4, kora: 1, modul: 0, helmet_ssh68: 4, helmet_sfera: 0, radio_kenwood: 1, radio_old: 4,
        baton_pr73: 8, cuffs: 6, gas_spray: 4, gas_grenade: 2, medkit: 3, flashlight: 3, medicine: 2,
        parts: 1, tea: 3, sugar: 2, cigarettes: 2, coffee: 0, ration: 30, paper: 3, cognac: 0,
      },
      ammo: { '9x18': 480, '5.45x39': 300, '12ga': 0, '7.62x25': 0, '23mm': 15 },
      fuel: 120, diesel: 40,
      deliveries: [], upgrades: {}, upgradeOrders: [],
      vehicles: [newVehicle(rng, 'uaz_1', rng.int(1000, 4999)), newVehicle(rng, 'uaz_2', rng.int(5000, 9999))],
      salary: { nextDay: Math.max(2, 14 - (day(game) - 1)), owedMonths: s.difficulty === 'hard' ? 1 : 0, lastPaidDay: null },
      ledger: [], blackHeat: 0, supply: { tea: true, smokes: true, food: true }, consumeAcc: {}, evidence: {}, flags: {}, startIssued: false,
    };
    // PM для всех стартовых сотрудников — кладём в оружейку столько, сколько людей
    s.economy.inventory.pm += (s.staff || []).filter(inService).length || 12;
    refreshFlags(game);
    if (s.staff && s.staff.length) economy.autoIssueStart(game);
    return s.economy;
  },

  /** Выдать стартовое снаряжение составу (если оба модуля уже инициализированы) */
  autoIssueStart(game) {
    const e = E(game); if (!e || e.startIssued || !(game.state.staff || []).length) return;
    e.startIssued = true;
    const st = game.state.staff.filter(inService);
    for (const o of st) economy.issue(game, o.id, 'pm', { silent: true });
    const pps = st.filter((o) => o.role === 'pps').sort((a, b) => b.skills.shooting - a.skills.shooting);
    for (const o of pps.slice(0, 2)) economy.issue(game, o.id, 'aks74u', { silent: true });
    for (const o of pps.slice(0, 4)) economy.issue(game, o.id, 'zh81', { silent: true });
    const lead = st.filter((o) => ['pps', 'oper'].includes(o.role)).sort((a, b) => b.skills.tactics - a.skills.tactics);
    if (lead[0]) economy.issue(game, lead[0].id, 'radio_kenwood', { silent: true });
    for (const o of lead.slice(1, 5)) economy.issue(game, o.id, 'radio_old', { silent: true });
    for (const o of pps.concat(st.filter((x) => x.role === 'guard'))) { economy.issue(game, o.id, 'baton_pr73', { silent: true }); economy.issue(game, o.id, 'cuffs', { silent: true }); }
    for (const o of pps.slice(0, 3)) economy.issue(game, o.id, 'gas_spray', { silent: true });
    const kora = st.find((o) => o.role === 'oper'); if (kora) economy.issue(game, kora.id, 'kora', { silent: true });
  },

  canAfford(game, cost) { const e = E(game); return !!e && e.money >= cost; },
  addMoney(game, amount, reason = '') {
    const e = E(game); if (!e || !amount) return e ? e.money : 0;
    e.money = Math.round((e.money + amount) * 10) / 10;
    ledger(game, amount, reason);
    if (game.bus) game.bus.emit('money', { money: e.money, delta: amount, reason });
    return e.money;
  },
  weeklyBudget(game) { const e = E(game); return { amount: e.budgetPerWeek, nextDay: e.nextBudgetDay, nextDate: dateText(game, e.nextBudgetDay), pending: e.budgetPending.slice() }; },

  /** Цена позиции по каналу */
  price(itemId, channel) { const it = ITEMS[itemId]; return it && it.price[channel] != null ? it.price[channel] : null; },
  channelsFor(itemId) { const it = ITEMS[itemId]; return it ? Object.keys(it.price) : []; },

  /** Заказ: qty — число позиций (пачек/канистр/штук). channel: official|commercial|black (по умолчанию — самый дешёвый законный). */
  buy(game, itemId, qty = 1, channel = null) {
    const e = E(game); const it = ITEMS[itemId];
    if (!it) return fail('Такого товара нет.');
    qty = Math.max(1, Math.round(qty));
    const legal = Object.keys(it.price).filter((c) => c !== 'black');
    channel = channel || (legal.length ? legal.sort((a, b) => it.price[a] - it.price[b])[0] : 'black');
    if (it.price[channel] == null) return fail(`«${it.name}» по каналу «${CHANNELS[channel] ? CHANNELS[channel].name : channel}» не достать.`);
    const cost = it.price[channel] * qty;
    if (!economy.canAfford(game, cost)) return fail(`Нужно ${money(cost)}, в кассе — ${money(e.money)}.`);
    const rng = R(game);
    const [a, b] = it.days[channel] || [1, 3];
    let days = rng.int(a, b);
    if (channel === 'official' && rng.chance(0.25)) days += rng.int(2, 5);
    const arriveDay = day(game) + Math.max(0, days);
    economy.addMoney(game, -cost, `заказ: ${it.short} ×${qty} (${CHANNELS[channel].name.toLowerCase()})`);
    const del = { id: uid('dl'), itemId, qty, channel, cost, orderDay: day(game), arriveDay };
    e.deliveries.push(del);
    if (channel === 'black') e.blackHeat = clamp(e.blackHeat + 6 * Math.sqrt(qty) + (it.category === 'weapon' ? 10 : 0), 0, 100);
    const when = days <= 0 ? 'сегодня к вечеру' : `к ${dateText(game, arriveDay)}`;
    const how = { official: 'Заявка ушла в управление. Обещали', commercial: 'Коммерсант обещал привезти', black: 'Человек с Рынка сказал: будет' }[channel];
    return { ok: true, text: `${how} ${when}: ${it.name} ×${qty}. Заплачено ${money(cost)}.`, arriveDay, cost, delivery: del };
  },

  buyUpgrade(game, id) {
    const e = E(game); const u = UPGRADES[id];
    if (!u) return fail('Такого улучшения нет.');
    if (e.upgrades[id]) return fail(`«${u.name}» уже есть.`);
    if (e.upgradeOrders.some((x) => x.id === id)) return fail(`«${u.name}» уже заказано.`);
    for (const r of u.requires || []) if (!e.upgrades[r]) return fail(`Сначала нужно: «${UPGRADES[r].name}».`);
    if (!economy.canAfford(game, u.price)) return fail(`Нужно ${money(u.price)}, в кассе — ${money(e.money)}.`);
    economy.addMoney(game, -u.price, `улучшение: ${u.name}`);
    const doneDay = day(game) + u.days;
    e.upgradeOrders.push({ id, doneDay, orderDay: day(game) });
    if (u.channel === 'black') e.blackHeat = clamp(e.blackHeat + 12, 0, 100);
    return { ok: true, text: `«${u.name}»: работы начнутся завтра, закончат к ${dateText(game, doneDay)}. ${money(u.price)} — наличными, без квитанции.`, doneDay };
  },

  /** Выдать сотруднику предмет со склада. opts.silent — без журнала. */
  issue(game, officerId, itemId, opts = {}) {
    const e = E(game); const o = officer(game, officerId); const it = ITEMS[itemId];
    if (!o || !inService(o)) return fail('Нет такого сотрудника.');
    if (!it) return fail('Такого предмета нет.');
    if (o.status === 'task') return fail(`${dn(o)} на выезде — выдать нечего и некому.`);
    if (game.state.zones && game.state.zones.armory && game.state.zones.armory.owner === 'enemy') return fail('Оружейка захвачена. Выдавать нечего.');
    const eq = o.equipment;
    const warn = [];
    if (it.category === 'ammo') {
      const cur = [eq.weapon, eq.sidearm].filter((w) => w && w !== 'none' && WEAPON_LOADOUT[w] && WEAPON_LOADOUT[w].ammoType === it.ammoType);
      if (!cur.length) return fail(`У ${dn(o, 'g')} нет оружия под ${AMMO_TYPES[it.ammoType].name}.`);
      const got = economy.rearm(game, officerId);
      return got > 0 ? { ok: true, text: `${cap1(dn(o, 'd'))} выдано ${nWord(got, 'патрон', 'патрона', 'патронов')}.` } : fail('Патронов на складе нет — или боекомплект уже полный.');
    }
    if ((e.inventory[itemId] || 0) < 1) return fail(`На складе нет: ${it.name}.`);
    if (it.slot === 'weapon') {
      if (eq.weapon === itemId) return fail(`${dn(o)} уже вооружен${o.gender === 'f' ? 'а' : ''}: ${it.short}.`);
      const isLong = LONG_GUNS.includes(itemId);
      if (isLong && eq.weapon === 'pm') { eq.sidearm = 'pm'; eq.sidearmAmmo = eq.ammo; eq.weapon = 'none'; eq.ammo = 0; }
      else if (eq.weapon !== 'none') economy.unissue(game, officerId, 'weapon', { silent: true });
      if (!isLong && eq.sidearm !== 'none') economy.unissue(game, officerId, 'sidearm', { silent: true });
      e.inventory[itemId]--;
      eq.weapon = itemId; eq.ammo = 0;
      const lo = WEAPON_LOADOUT[itemId];
      const take = Math.min(lo.load, e.ammo[lo.ammoType] || 0);
      e.ammo[lo.ammoType] = (e.ammo[lo.ammoType] || 0) - take; eq.ammo = take;
      if (take < lo.load) warn.push(take ? `патронов хватило только на ${take}` : 'патронов нет совсем — оружие пустое');
      if (it.illegal) { eq.illegal = true; warn.push('ствол незаконный — если найдёт проверка, будет скандал'); }
      if (eq.sidearm === 'pm') warn.push('ПМ остаётся вторым стволом');
    } else if (SLOT_FIELDS[it.slot]) {
      const f = SLOT_FIELDS[it.slot];
      if (eq[f] === itemId) return fail(`Уже выдано: ${it.short}.`);
      if (eq[f]) economy.unissue(game, officerId, it.slot, { silent: true });
      e.inventory[itemId]--;
      eq[f] = itemId;
      if (it.slot === 'armor') { eq.armor = it.armorClass; if (it.armorClass === 'heavy') warn.push('в «Модуле» не побегаешь'); }
      if (it.slot === 'helmet') eq.helmet = true;
      if (it.slot === 'radio') { eq.radio = true; if (it.poor) warn.push('«Виола» хрипит и садится к утру'); }
    } else if (BOOL_SLOTS[it.slot]) {
      if (eq[it.slot]) return fail(`Уже выдано: ${it.short}.`);
      e.inventory[itemId]--; eq[it.slot] = true;
    } else return fail(`«${it.name}» сотруднику не выдаётся — это расходник склада.`);
    refreshFlags(game);
    const text = `${cap1(dn(o, 'd'))} выдано: ${it.short}${eq.weapon === itemId && eq.ammo ? ` и ${nWord(eq.ammo, 'патрон', 'патрона', 'патронов')}` : ''}.${warn.length ? ' ' + cap1(warn.join('; ')) + '.' : ''}`;
    if (!opts.silent && game.bus) game.bus.emit('equipment', { officerId, itemId });
    return { ok: true, text };
  },

  /** Сдать на склад: slot = weapon|sidearm|armor|helmet|radio|baton|cuffs|gas|medkit|flashlight|all */
  unissue(game, officerId, slot, opts = {}) {
    const e = E(game); const o = officer(game, officerId);
    if (!o) return fail('Нет такого сотрудника.');
    const eq = o.equipment;
    const back = [];
    const doSlot = (sl) => {
      if (sl === 'weapon' || sl === 'sidearm') {
        const w = sl === 'weapon' ? eq.weapon : eq.sidearm; if (!w || w === 'none') return;
        const lo = WEAPON_LOADOUT[w];
        const am = sl === 'weapon' ? eq.ammo : eq.sidearmAmmo;
        if (lo) e.ammo[lo.ammoType] = (e.ammo[lo.ammoType] || 0) + am;
        e.inventory[w] = (e.inventory[w] || 0) + 1; back.push(ITEMS[w] ? ITEMS[w].short : w);
        if (sl === 'weapon') { eq.weapon = 'none'; eq.ammo = 0; if (eq.sidearm !== 'none') { eq.weapon = eq.sidearm; eq.ammo = eq.sidearmAmmo; eq.sidearm = 'none'; eq.sidearmAmmo = 0; } }
        else { eq.sidearm = 'none'; eq.sidearmAmmo = 0; }
        eq.illegal = [eq.weapon, eq.sidearm].some((x) => ITEMS[x] && ITEMS[x].illegal);
      } else if (SLOT_FIELDS[sl]) {
        const f = SLOT_FIELDS[sl]; if (!eq[f]) return;
        e.inventory[eq[f]] = (e.inventory[eq[f]] || 0) + 1; back.push(ITEMS[eq[f]].short); eq[f] = null;
        if (sl === 'armor') eq.armor = 'none'; if (sl === 'helmet') eq.helmet = false; if (sl === 'radio') eq.radio = false;
      } else if (BOOL_SLOTS[sl]) {
        if (!eq[sl]) return;
        if (sl !== 'gas' && sl !== 'medkit' || R(game).chance(0.7)) e.inventory[BOOL_SLOTS[sl]] = (e.inventory[BOOL_SLOTS[sl]] || 0) + 1;
        eq[sl] = false; back.push(ITEMS[BOOL_SLOTS[sl]].short);
      }
    };
    if (slot === 'all') { doSlot('weapon'); doSlot('weapon'); for (const s of ['armor', 'helmet', 'radio', ...Object.keys(BOOL_SLOTS)]) doSlot(s); }
    else doSlot(slot);
    refreshFlags(game);
    if (!back.length) return fail('Сдавать нечего.');
    return { ok: true, text: `${cap1(dn(o))} сдал${o.gender === 'f' ? 'а' : ''} на склад: ${back.join(', ')}.` };
  },
  returnAll(game, officerId) { return economy.unissue(game, officerId, 'all', { silent: true }); },

  /** Дозарядить носимый боекомплект до стандартного. Возвращает число выданных патронов. */
  rearm(game, officerId) {
    const e = E(game); const o = officer(game, officerId); if (!o || !e) return 0;
    if (game.state.zones && game.state.zones.armory && game.state.zones.armory.owner === 'enemy') return 0;
    let got = 0;
    for (const [wk, ak] of [['weapon', 'ammo'], ['sidearm', 'sidearmAmmo']]) {
      const w = o.equipment[wk]; const lo = WEAPON_LOADOUT[w]; if (!lo) continue;
      const need = Math.max(0, lo.load - o.equipment[ak]);
      const take = Math.min(need, e.ammo[lo.ammoType] || 0);
      e.ammo[lo.ammoType] -= take; o.equipment[ak] += take; got += take;
    }
    refreshFlags(game);
    return got;
  },
  /** Бой: списать патроны у сотрудника. Возвращает сколько реально было. */
  consumeAmmo(game, officerId, n = 1, slot = 'weapon') {
    const o = officer(game, officerId); if (!o) return 0;
    const k = slot === 'sidearm' ? 'sidearmAmmo' : 'ammo';
    const use = Math.min(n, o.equipment[k]); o.equipment[k] -= use; return use;
  },
  /** Списать расходник со склада (аптечки, гранаты, медикаменты, сухпаёк). Возвращает списанное. */
  consume(game, itemId, n = 1) {
    const e = E(game); if (!e) return 0;
    const have = e.inventory[itemId] || 0; const use = Math.min(have, n); e.inventory[itemId] = have - use; return use;
  },
  stock(game, itemId) { const e = E(game); return e ? e.inventory[itemId] || 0 : 0; },
  generatorHours(game) { const e = E(game); return e ? Math.floor(e.diesel / 5) : 0; },
  /** Генератор работает dtMin минут — списать солярку. Возвращает false, если кончилась. */
  burnDiesel(game, dtMin) { const e = E(game); if (!e) return false; e.diesel = Math.max(0, e.diesel - (5 * dtMin) / 60); return e.diesel > 0; },

  // ---- вещдоки ----
  addSeized(game, itemId, n = 1, note = '') {
    const e = E(game); if (!e || !ITEMS[itemId]) return;
    e.evidence[itemId] = (e.evidence[itemId] || 0) + n;
    glog(game, `В комнату вещдоков: ${ITEMS[itemId].name}${n > 1 ? ' ×' + n : ''}${note ? ' — ' + note : ''}.`, 'economy');
  },
  /** Оприходовать изъятое в оружейку (незаконно, риск при проверке) */
  legalizeSeized(game, itemId) {
    const e = E(game); if (!e || !(e.evidence[itemId] > 0)) return fail('Таких вещдоков нет.');
    e.evidence[itemId]--; e.inventory[itemId] = (e.inventory[itemId] || 0) + 1; e.illegalStock = (e.illegalStock || 0) + 1;
    return { ok: true, text: `${ITEMS[itemId].name} перекочевал из вещдоков в оружейку. В журнале — «утилизирован». Если проверка заглянет — вопросов будет много.` };
  },
  surrenderSeized(game, itemId) {
    const e = E(game); if (!e || !(e.evidence[itemId] > 0)) return fail('Таких вещдоков нет.');
    e.evidence[itemId]--; campaign.addAuthority(game, 1, 'сдал изъятое оружие');
    return { ok: true, text: `${ITEMS[itemId].name} сдан в ЭКЦ УВД. В управлении отметили.` };
  },

  // ---- транспорт ----
  vehicle(game, id) { return E(game).vehicles.find((v) => v.id === id) || null; },
  useVehicle(game, id, km = 30) {
    const v = economy.vehicle(game, id); if (!v) return null;
    const rng = R(game);
    v.km += km; v.fuel = Math.max(0, v.fuel - km * 0.2);
    v.condition = clamp(v.condition - km * rng.range(0.03, 0.08), 0, 100);
    let breakdown = null;
    if (v.condition < 35 && rng.chance((35 - v.condition) / 120)) { breakdown = rng.pick(['заглох и не заводится', 'пробил колесо', 'потёк радиатор', 'отказали тормоза — встал в кювет']); v.condition = Math.max(0, v.condition - 8); }
    return { fuel: v.fuel, condition: v.condition, breakdown };
  },
  damageVehicle(game, id, amount = 5, what = '') {
    const e = E(game); if (!e) return;
    const v = id ? economy.vehicle(game, id) : R(game).pick(e.vehicles.filter((x) => x.status !== 'destroyed'));
    if (!v) return;
    v.condition = clamp(v.condition - amount, 0, 100);
    if (v.condition <= 0 && amount >= 40) v.status = 'destroyed';
    if (what) glog(game, `${v.name}: ${what}. Состояние — ${Math.round(v.condition)}%.`, 'economy');
  },
  refuel(game, id) {
    const e = E(game); const v = economy.vehicle(game, id); if (!v) return fail('Нет такой машины.');
    const need = Math.max(0, v.maxFuel - v.fuel); const take = Math.min(need, e.fuel);
    if (take <= 0) return fail(e.fuel <= 0 ? 'Бензина в канистрах нет.' : 'Бак полный.');
    e.fuel -= take; v.fuel += take;
    return { ok: true, text: `${v.name} заправлен: +${Math.round(take)} л. В канистрах осталось ${Math.round(e.fuel)} л.` };
  },
  /** mode: 'parts' — своими силами (нужен комплект запчастей и водитель), 'service' — в автосервис за деньги */
  repairVehicle(game, id, mode = 'parts') {
    const e = E(game); const v = economy.vehicle(game, id); if (!v) return fail('Нет такой машины.');
    if (v.status === 'destroyed') return fail(`${v.name} сгорел. Чинить нечего.`);
    if (v.status === 'task') return fail(`${v.name} на выезде.`);
    if (v.status === 'repair') return fail(`${v.name} уже в ремонте.`);
    if (mode === 'parts') {
      if ((e.inventory.parts || 0) < 1) return fail('Запчастей нет.');
      const drv = (game.state.staff || []).filter((o) => inService(o) && ['station', 'home'].includes(o.status)).sort((a, b) => b.skills.driving - a.skills.driving)[0];
      e.inventory.parts--; v.status = 'repair'; v.repairUntil = day(game) + 1;
      v.repairGain = 25 + Math.round((drv ? drv.skills.driving : 40) / 3);
      return { ok: true, text: `${v.name} — на яму. ${drv ? dn(drv) + ' обещает' : 'Обещают'} к утру.` };
    }
    const cost = Math.round((100 - v.condition) * 18);
    if (!economy.canAfford(game, cost)) return fail(`Автосервис просит ${money(cost)}. Столько нет.`);
    economy.addMoney(game, -cost, `ремонт ${v.name}`);
    v.status = 'repair'; v.repairUntil = day(game) + 2; v.repairGain = 100;
    return { ok: true, text: `${v.name} — в автосервисе «У Ашота» на два дня. ${money(cost)}.` };
  },

  /** Аванс из кассы при задержке зарплаты: fraction — доля месячного фонда */
  payAdvance(game, fraction = 0.3) {
    const e = E(game); const st = (game.state.staff || []).filter(inService);
    const fund = st.reduce((a, o) => a + (o.salary || 700), 0);
    const cost = Math.round(fund * fraction);
    if (!economy.canAfford(game, cost)) return fail(`Аванс ${Math.round(fraction * 100)}% — это ${money(cost)}. В кассе столько нет.`);
    economy.addMoney(game, -cost, 'аванс личному составу из кассы');
    for (const o of st) { o.morale = clamp(o.morale + 6 + fraction * 20, 0, 100); o.loyalty = clamp(o.loyalty + 4, 0, 100); }
    e.salary.advanceDay = day(game);
    return { ok: true, text: `Выдан аванс из кассы — ${money(cost)} на всех. Люди расписывались в ведомости и не верили.` };
  },

  dayStart(game) {
    const e = E(game); if (!e) return;
    const rng = R(game);
    const d = day(game);
    const st = settings(game);
    // поставки
    for (const del of e.deliveries.filter((x) => x.arriveDay <= d)) arrive(game, del);
    e.deliveries = e.deliveries.filter((x) => x.arriveDay > d);
    // улучшения
    for (const u of e.upgradeOrders.filter((x) => x.doneDay <= d)) {
      e.upgrades[u.id] = true;
      glog(game, `Готово: ${UPGRADES[u.id].name}. ${UPGRADES[u.id].effectText}`, 'economy');
      if (game.bus) game.bus.emit('upgrade:done', { id: u.id });
    }
    e.upgradeOrders = e.upgradeOrders.filter((x) => x.doneDay > d);
    // бюджет
    for (const b of e.budgetPending.filter((x) => x.arriveDay <= d)) { economy.addMoney(game, b.amount, 'бюджет (с задержкой)'); glog(game, `Пришёл задержанный бюджет: ${money(b.amount)}.`, 'economy'); }
    e.budgetPending = e.budgetPending.filter((x) => x.arriveDay > d);
    if (d >= e.nextBudgetDay) {
      e.nextBudgetDay += 7;
      const cut = game.state.flags && game.state.flags.b2_budgetCut ? 0.7 : 1;
      const amount = Math.round(e.budgetPerWeek * cut * rng.range(0.85, 1.05) / 10) * 10;
      if (rng.chance(st.budgetDelayChance ?? 0.2)) {
        const late = rng.int(2, 6); const part = rng.chance(0.4) ? Math.round(amount * rng.range(0.5, 0.8) / 10) * 10 : amount;
        e.budgetPending.push({ amount: part, arriveDay: d + late });
        pushInbox(game, { source: 'economy', kind: 'budget_delay', title: 'Бюджет задержали', text: `Звонок из финчасти УВД: недельные ${money(amount)} «пока не пришли из области». Обещают ${part < amount ? `${money(part)} ` : ''}через ${late} дн.`, choices: [{ id: 'call', label: 'Позвонить начальнику УВД, надавить' }, { id: 'wait', label: 'Ждать' }], data: { amount: part }, expires: { day: d + 1, minute: 480 }, autoChoice: 'wait' });
      } else { economy.addMoney(game, amount, 'недельный бюджет'); glog(game, `Пришёл недельный бюджет: ${money(amount)}.`, 'economy'); }
    }
    // зарплата
    const sal = e.salary;
    if (d >= sal.nextDay) {
      sal.nextDay += 30;
      const forced = game.state.flags && game.state.flags.salaryDelayUntil && d < game.state.flags.salaryDelayUntil;
      if (forced || rng.chance(st.salaryDelayChance ?? 0.3)) {
        sal.owedMonths++;
        glog(game, sal.owedMonths > 1 ? `Зарплату снова не дали. Должны уже за ${sal.owedMonths} месяца.` : 'Зарплату задержали: «денег из области нет».', 'economy');
        if (game.bus) game.bus.emit('salary', { paid: false, owedMonths: sal.owedMonths });
      } else paySalary(game, rng.chance(0.5) ? sal.owedMonths + 1 : 1);
    } else if (sal.owedMonths > 0 && !(game.state.flags && game.state.flags.salaryDelayUntil > d) && rng.chance(0.04)) paySalary(game, 1, true);
    // расход быта
    const on = (game.state.staff || []).filter((o) => o.onShift && inService(o));
    const use = (id, perDay) => { e.consumeAcc[id] = (e.consumeAcc[id] || 0) + perDay; const n = Math.floor(e.consumeAcc[id]); e.consumeAcc[id] -= n; if (n <= 0) return (e.inventory[id] || 0) > 0; const got = economy.consume(game, id, n); return got >= n; };
    const tea = use('tea', Math.max(0.3, on.length / 8));
    const sugar = use('sugar', Math.max(0.2, on.length / 12));
    const smokes = use('cigarettes', on.filter((o) => o.smoker).length / 9);
    if ((e.inventory.coffee || 0) > 0) use('coffee', 0.25);
    const was = e.supply;
    e.supply = { tea: tea && sugar, smokes, food: (e.inventory.ration || 0) > 0 };
    if (was.tea && !e.supply.tea) glog(game, 'Кончились чай и сахар. Ночная смена пьёт кипяток.', 'economy');
    if (was.smokes && !e.supply.smokes) glog(game, 'Кончилось курево. Курят «стрельнутые» у задержанных.', 'economy');
    // машины
    for (const v of e.vehicles) {
      if (v.status === 'repair' && v.repairUntil && d >= v.repairUntil) { v.status = 'station'; v.condition = clamp(v.condition + (v.repairGain || 25), 0, 100); v.repairUntil = null; glog(game, `${v.name} вышел из ремонта: ${Math.round(v.condition)}%.`, 'economy'); }
      const drv = on.some((o) => o.role === 'driver');
      if (v.status === 'station' && drv && v.fuel < 50 && e.fuel > 0) { const take = Math.min(v.maxFuel - v.fuel, e.fuel); e.fuel -= take; v.fuel += take; }
    }
    if (e.fuel < 40) glog(game, `Бензина в канистрах — ${Math.round(e.fuel)} л. На выезды хватит ненадолго.`, 'economy');
    e.blackHeat = Math.max(0, e.blackHeat - 4);
    refreshFlags(game);
  },

  resolveInbox(game, item, c) {
    const rng = R(game); const e = E(game);
    switch (item.kind) {
      case 'budget_delay':
        if (c === 'call') {
          const auth = game.state.campaign ? game.state.campaign.authority : 50;
          if (rng.chance(clamp(auth / 100, 0.1, 0.9))) { const p = e.budgetPending.find((x) => x.amount === item.data.amount) || e.budgetPending[0]; if (p) p.arriveDay = day(game) + 1; return 'Начальник УВД выругался, но позвонил в финчасть. Деньги будут завтра.'; }
          campaign.addAuthority(game, -1, 'надоедает начальству');
          return '«Майор, у меня таких, как вы, сорок отделений. Ждите». Гудки.';
        }
        return 'Ждём. Как всегда.';
      case 'scam':
        if (c === 'find') {
          const oper = (game.state.staff || []).find((o) => o.role === 'oper' && inService(o));
          if (oper && rng.chance(0.35 + oper.skills.investigation / 250)) { const back = Math.round(item.data.cost * 0.7); economy.addMoney(game, back, 'вернули с барыги'); return `${dn(oper)} нашёл барыгу в пивной на Вокзале. Вернул ${money(back)} — остальное тот «уже пропил». Синяк под глазом у барыги — тоже возврат.`; }
          return 'Барыгу не нашли. На Рынке пожимают плечами: «Какой ещё Гоша?»';
        }
        return 'Списали. Урок дорогой, но наглядный.';
      case 'traced':
        if (c === 'surrender') { campaign.addAuthority(game, -2, 'засвеченный ствол'); e.inventory[item.data.itemId] = Math.max(0, (e.inventory[item.data.itemId] || 0) - 1); return 'Ствол сдан в ЭКЦ с объяснительной «изъят у неустановленного лица». В управлении поморщились.'; }
        if (c === 'destroy') { e.inventory[item.data.itemId] = Math.max(0, (e.inventory[item.data.itemId] || 0) - 1); return 'Ночью ствол утопили в пруду за Промзоной. Деньги — туда же.'; }
        e.illegalStock = (e.illegalStock || 0) + 1; return 'Оставили. Номер сбит напильником, в журнале — «ремонт». Если всплывёт — всплывёт громко.';
      default: return 'Принято.';
    }
  },
  refreshFlags,
};

function paySalary(game, months, partial = false) {
  const e = E(game); const sal = e.salary;
  const paid = Math.min(months, sal.owedMonths + 1);
  sal.owedMonths = Math.max(0, sal.owedMonths + 1 - paid - (partial ? 0 : 0));
  if (partial) sal.owedMonths = Math.max(0, sal.owedMonths - 0); // частичная выплата долга уже учтена выше
  sal.lastPaidDay = day(game);
  const st = (game.state.staff || []).filter(inService);
  for (const o of st) {
    o.morale = clamp(o.morale + 6 + paid * 3, 0, 100);
    if (o.debtToStation > 0) {
      const honest = o.traits.includes('honest') || o.traits.includes('pedant');
      const share = honest ? 1 : o.traits.includes('greedy') || o.traits.includes('gambler') ? (R(game).chance(0.5) ? 0 : 0.5) : 0.8;
      const back = Math.round(o.debtToStation * share);
      if (back > 0) { economy.addMoney(game, back, `возврат долга: ${dn(o)}`); o.debtToStation -= back; }
    }
  }
  glog(game, partial ? `Выдали зарплату за один месяц из долга. Осталось должны: ${nWord(sal.owedMonths, 'месяц', 'месяца', 'месяцев')}.` : `Выдали зарплату${paid > 1 ? ` — сразу за ${paid} месяца` : ''}. В отделении праздник: в буфете кончились пирожки.`, 'economy');
  if (game.bus) game.bus.emit('salary', { paid: true, owedMonths: sal.owedMonths });
}

function arrive(game, del) {
  const e = E(game); const it = ITEMS[del.itemId]; const rng = R(game);
  let qty = del.qty;
  let note = '';
  if (del.channel === 'official') {
    if (it.officialRefuse && rng.chance(it.officialRefuse)) { economy.addMoney(game, del.cost, `возврат: отказ управления (${it.short})`); glog(game, `Управление отказало в «${it.name}»: «Фондов нет, лимит исчерпан». Деньги вернули на счёт.`, 'economy'); return; }
    if (qty > 1 && rng.chance(0.25)) { const cut = Math.max(1, Math.floor(qty * rng.range(0.5, 0.8))); economy.addMoney(game, Math.round((del.cost / qty) * (qty - cut)), 'возврат за недопоставку'); note = ` Вместо ${qty} привезли ${cut}: «остальное — в следующем квартале».`; qty = cut; }
  }
  if (del.channel === 'black') {
    const heat = e.blackHeat / 100;
    const roll = rng.next();
    if (roll < 0.08 + heat * 0.1) {
      pushInbox(game, { source: 'economy', kind: 'scam', title: 'Кинули', text: `«Левая» поставка — ${it.name} ×${del.qty} — не пришла. Барыга с Рынка исчез вместе с ${money(del.cost)}.`, data: { cost: del.cost }, choices: [{ id: 'find', label: 'Отправить опера найти барыгу' }, { id: 'forget', label: 'Списать на опыт' }], expires: { day: day(game) + 1, minute: 480 }, autoChoice: 'forget' });
      return;
    }
    if (roll < 0.2 + heat * 0.1) { const bad = Math.max(1, Math.round(qty * rng.range(0.2, 0.5))); qty -= it.category === 'weapon' ? 0 : bad; note = it.category === 'weapon' ? ' Ствол с раковинами в стволе — стреляет, но криво.' : ` Часть — брак: ${bad} из ${del.qty} никуда не годятся.`; }
    if (it.category === 'weapon' && rng.chance(0.15 + heat * 0.2)) {
      pushInbox(game, { source: 'economy', kind: 'traced', title: 'Засвеченный ствол', text: `Оперативник по своим каналам пробил номер «левого» ${it.short}: ствол проходит по делу о двойном убийстве на трассе в прошлом году. Если его найдут в вашей оружейке — объяснять будете вы.`, data: { itemId: del.itemId }, choices: [{ id: 'surrender', label: 'Сдать в ЭКЦ как изъятый' }, { id: 'destroy', label: 'Избавиться тихо' }, { id: 'keep', label: 'Оставить — номер сбит' }], expires: { day: day(game) + 2, minute: 480 }, autoChoice: 'keep' });
    }
    if (rng.chance(0.06 + heat * 0.15)) { campaign.addAuthority(game, -2, 'слухи о левых закупках'); note += ' В управлении пошёл слух о ваших «левых» закупках.'; }
    if (rng.chance(0.1) && game.bus) game.bus.emit('gang:intel', { kind: 'armament', itemId: del.itemId, qty });
  }
  if (qty <= 0) { glog(game, `Поставка «${it.name}» пришла, но вся — брак.${note}`, 'economy'); return; }
  if (it.category === 'ammo') e.ammo[it.ammoType] = (e.ammo[it.ammoType] || 0) + qty * it.pack;
  else if (del.itemId === 'fuel') e.fuel += qty * it.pack;
  else if (del.itemId === 'diesel') e.diesel += qty * it.pack;
  else e.inventory[del.itemId] = (e.inventory[del.itemId] || 0) + qty * (del.itemId === 'ration' ? it.pack : 1);
  glog(game, `Привезли: ${it.name} ×${qty}.${note}`, 'economy');
  if (game.bus) game.bus.emit('delivery', { itemId: del.itemId, qty, channel: del.channel });
}
function cap1(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
void fmt;
export default economy;
