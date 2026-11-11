// «Участок» — оружие, боеприпасы, броня, ранения (агент D).
// Чистые данные + небольшие помощники. Без состояния.

/** Классы пробития: от них зависит работа бронежилета и каски. */
export const AMMO_TYPES = {
  '9x18':    { name: '9×18 ПМ',            cls: 'pistol' },
  '7.62x25': { name: '7,62×25 ТТ',         cls: 'pistol_ap' },
  '5.45x39': { name: '5,45×39',            cls: 'rifle' },
  '12ga':    { name: '12 калибр, картечь', cls: 'pellet' },
  '23mm':    { name: '23 мм «Шрапнель-25»', cls: 'pellet' },   // CONTRACT-NEEDS: в state.economy.ammo нет '23mm' — берём из '12ga'
  '7.62x39': { name: '7,62×39',            cls: 'rifle' },
};

/**
 * Огнестрельное и холодное оружие.
 * damage — урон одной пули/дробины по корпусу без брони; pellets — сколько дробин;
 * spread — базовое угловое СКО (рад) у среднего стрелка; range — эффективная дальность (м);
 * cadence — пауза ИИ между прицельными выстрелами (с); burst — очередь [min,max];
 * rpm — темп (для очередей и игрока); mag — ёмкость; reload — время перезарядки (с);
 * jam — вероятность задержки на выстрел; breach — урон баррикаде за удар/выстрел;
 * suppress — подавляющий эффект близкого промаха; danger — оценка опасности для выбора цели.
 * look — значение actor.look.weapon (рендер знает только pm/aks74u/ks23/shotgun/knife/bat/tt/none).
 */
export const WEAPONS = {
  pm: {
    id: 'pm', name: 'ПМ', full: 'Пистолет Макарова', kind: 'pistol', look: 'pm', sound: 'shot_pm',
    damage: 30, pellets: 1, spread: 0.019, range: 25, maxRange: 50, cadence: 0.55, burst: [1, 2], rpm: 90,
    mag: 8, ammoType: '9x18', reload: 2.0, jam: 0.002, breach: 4, suppress: 0.18, danger: 1.5, aimTime: 0.45, recoil: 0.004,
  },
  tt: {
    id: 'tt', name: 'ТТ', full: 'Пистолет Токарева (китайская копия)', kind: 'pistol', look: 'tt', sound: 'shot_tt',
    damage: 33, pellets: 1, spread: 0.021, range: 28, maxRange: 55, cadence: 0.55, burst: [1, 2], rpm: 90,
    mag: 8, ammoType: '7.62x25', reload: 2.1, jam: 0.03, breach: 5, suppress: 0.2, danger: 1.7, aimTime: 0.45, recoil: 0.005,
  },
  aks74u: {
    id: 'aks74u', name: 'АКС-74У', full: 'Автомат Калашникова складной укороченный', kind: 'auto', look: 'aks74u', sound: 'shot_ak',
    damage: 36, pellets: 1, spread: 0.017, range: 60, maxRange: 120, cadence: 0.9, burst: [2, 5], rpm: 700,
    mag: 30, ammoType: '5.45x39', reload: 2.7, jam: 0.0015, breach: 6, suppress: 0.32, danger: 3.2, aimTime: 0.5, recoil: 0.009,
  },
  ks23: {
    id: 'ks23', name: 'КС-23', full: 'Карабин специальный 23 мм', kind: 'shotgun', look: 'ks23', sound: 'shot_ks23',
    damage: 13, pellets: 10, spread: 0.036, range: 25, maxRange: 50, cadence: 1.25, burst: [1, 1], rpm: 40,
    mag: 3, ammoType: '23mm', reload: 3.6, jam: 0.004, breach: 70, suppress: 0.45, danger: 2.8, aimTime: 0.55, recoil: 0.02,
    altAmmo: 'cheremukha',
  },
  shotgun: {
    id: 'shotgun', name: 'Ружьё', full: 'Охотничье двуствольное ружьё ИЖ-27', kind: 'shotgun', look: 'shotgun', sound: 'shot_sawnoff',
    damage: 11, pellets: 9, spread: 0.04, range: 22, maxRange: 45, cadence: 0.8, burst: [1, 1], rpm: 120,
    mag: 2, ammoType: '12ga', reload: 3.0, jam: 0.004, breach: 40, suppress: 0.42, danger: 2.5, aimTime: 0.5, recoil: 0.02,
  },
  sawnoff: {
    id: 'sawnoff', name: 'Обрез', full: 'Обрез двуствольного ружья', kind: 'shotgun', look: 'shotgun', sound: 'shot_sawnoff',
    damage: 11, pellets: 9, spread: 0.075, range: 10, maxRange: 30, cadence: 0.45, burst: [1, 1], rpm: 200,
    mag: 2, ammoType: '12ga', reload: 2.8, jam: 0.006, breach: 45, suppress: 0.45, danger: 2.4, aimTime: 0.3, recoil: 0.03,
  },
  rifle: {
    id: 'rifle', name: 'Карабин', full: 'Самозарядный карабин СКС с оптикой', kind: 'rifle', look: 'aks74u', sound: 'shot_ak',
    damage: 58, pellets: 1, spread: 0.007, range: 90, maxRange: 150, cadence: 2.0, burst: [1, 1], rpm: 40,
    mag: 10, ammoType: '7.62x39', reload: 3.2, jam: 0.003, breach: 6, suppress: 0.3, danger: 3.0, aimTime: 1.4, recoil: 0.01,
  },
  knife: {
    id: 'knife', name: 'Нож', full: 'Финка', kind: 'melee', look: 'knife', sound: null,
    damage: 26, cut: true, reachM: 1.25, rate: 1.0, breach: 3, danger: 0.9,
  },
  bat: {
    id: 'bat', name: 'Бита', full: 'Бейсбольная бита', kind: 'melee', look: 'bat', sound: null,
    damage: 21, blunt: true, reachM: 1.5, rate: 0.9, breach: 13, danger: 0.8,
  },
  fists: {
    id: 'fists', name: 'Кулаки', full: 'Голые руки', kind: 'melee', look: 'none', sound: null,
    damage: 8, blunt: true, reachM: 1.05, rate: 1.1, breach: 4, danger: 0.3,
  },
};

/** Метательное: гранаты, бутылки, газ. */
export const THROWABLES = {
  rgd5: {
    id: 'rgd5', name: 'РГД-5', full: 'Ручная граната наступательная', kind: 'frag',
    range: 26, fuse: 3.6, lethalR: 2.6, woundR: 9, damage: 110, breach: 260,
  },
  molotov: {
    id: 'molotov', name: 'Коктейль Молотова', full: 'Бутылка с бензином и фитилём', kind: 'fire',
    range: 17, fuse: 0, fireR: 1.7, fireT: 32, damage: 9, breach: 0,
  },
  cheremukha: {
    id: 'cheremukha', name: '«Черёмуха»', full: 'Слезоточивая граната «Черёмуха-6»', kind: 'gas',
    range: 22, fuse: 1.2, gas: 1.0, breach: 0,
  },
};

/** Ключи склада, под которыми может лежать «Черёмуха» и противогазы (B2 ещё не зафиксировал id). */
export const GAS_ITEM_IDS = ['cheremukha', 'gas_grenade', 'teargas', 'cheremukha6'];
export const GASMASK_ITEM_IDS = ['gasmask', 'gas_mask'];

/** Силуэт по позе: высота, границы зон по высоте, полуширина. */
export const SHAPES = {
  stand:  { h: 1.76, head: 1.52, torso: 0.92, half: 0.21, arm: 0.29, aim: 1.28, eye: 1.62, muzzle: 1.42 },
  crouch: { h: 1.22, head: 0.98, torso: 0.52, half: 0.22, arm: 0.29, aim: 0.9, eye: 1.1, muzzle: 1.0 },
  ducked: { h: 0.95, head: 0.76, torso: 0.4, half: 0.22, arm: 0.27, aim: 0.72, eye: 0.85, muzzle: 0.8 },
  sit:    { h: 1.3, head: 1.06, torso: 0.6, half: 0.22, arm: 0.29, aim: 0.95, eye: 1.18, muzzle: 1.05 },
  lie:    { h: 0.38, head: 0.3, torso: 0.12, half: 0.42, arm: 0.48, aim: 0.22, eye: 0.3, muzzle: 0.28 },
};

export const ZONE_MUL = { head: 2.3, torso: 1.0, arm: 0.55, leg: 0.65 };
export const ZONE_NAMES = { head: 'в голову', torso: 'в корпус', arm: 'в руку', leg: 'в ногу' };

/** Высота низких укрытий: мебель и баррикада. */
export const LOW_COVER_H = 0.86;
export const BARRICADE_H = 1.12;

export function getWeapon(id) { return WEAPONS[id] || WEAPONS.fists; }
export function isFirearm(w) { return !!w && w.kind !== 'melee'; }
export function ammoClass(w) { return w && w.ammoType ? (AMMO_TYPES[w.ammoType]?.cls || 'pistol') : (w && w.cut ? 'cut' : 'blunt'); }
/** Значение look.weapon, которое умеет рисовать рендер */
export function lookWeapon(id) { return (WEAPONS[id] && WEAPONS[id].look) || 'none'; }

/**
 * Защита брони. armor:'none'|'vest'|'heavy', helmet:bool, zone, cls (класс пробития)
 * → {mul — множитель урона, blunt — заброневая травма, stopped — пуля не прошла, ricochet}
 */
const VEST = { pistol: 0.12, pistol_ap: 0.45, rifle: 0.72, pellet: 0.1, cut: 0.35, blunt: 0.8, frag: 0.3, fire: 1 };
const HEAVY = { pistol: 0.04, pistol_ap: 0.12, rifle: 0.36, pellet: 0.04, cut: 0.15, blunt: 0.7, frag: 0.12, fire: 1 };
const HELMET = { pistol: 0.3, pistol_ap: 0.55, rifle: 0.8, pellet: 0.2, cut: 0.4, blunt: 0.45, frag: 0.3, fire: 1 };
export function armorFactor(armor, helmet, zone, cls, rng) {
  if (zone === 'torso' && armor && armor !== 'none') {
    const mul = (armor === 'heavy' ? HEAVY : VEST)[cls] ?? 1;
    return { mul, blunt: mul < 0.5 ? (cls === 'pistol' || cls === 'pellet' ? 5 : 8) : 0, stopped: mul < 0.5 };
  }
  if (zone === 'head' && helmet) {
    const mul = HELMET[cls] ?? 1;
    const ricochet = (cls === 'pistol' || cls === 'pellet') && rng && rng.chance(0.35);
    return { mul: ricochet ? 0 : mul, blunt: ricochet ? 4 : 0, stopped: mul < 0.5 || ricochet, ricochet };
  }
  return { mul: 1, blunt: 0, stopped: false };
}

/** Падение урона с дистанцией */
export function falloff(w, dist) {
  if (!w || w.kind === 'melee') return 1;
  if (w.kind === 'shotgun') return dist <= w.range * 0.4 ? 1 : Math.max(0.25, 1 - (dist - w.range * 0.4) / (w.range * 1.4));
  if (dist <= w.range) return 1;
  return Math.max(0.55, 1 - (dist - w.range) / (w.maxRange * 1.5));
}

/** Оценка опасности носителя (для приоритета «вооружённые») */
export function dangerScore(weaponId, extra = {}) {
  let s = getWeapon(weaponId).danger || 1;
  if (extra.grenades) s += 2.2;
  if (extra.molotovs) s += 1.8;
  return s;
}

/** Описание оружия для UI / журнала */
export function weaponLabel(id) { const w = WEAPONS[id] || THROWABLES[id]; return w ? w.name : 'без оружия'; }
