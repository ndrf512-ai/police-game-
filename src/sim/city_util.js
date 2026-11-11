// Вспомогательное для симуляции города: ГСЧ, живущий в state.city (переживает сохранение),
// время и календарь, склонения и форматирование, безопасный вызов чужих модулей, помощники по сотрудникам.
import { RNG, clamp, lerp } from '../core/rng.js';
export { clamp, lerp };

export const DAY = 1440;
export const SHIFT_START = 8 * 60;

/* ------------------------------------------------------------------ ГСЧ */
// Модули sim не хранят состояния вне game.state, поэтому состояние ГСЧ — число в state.city.rngState.
// Сам объект RNG кэшируется по объекту state.city (после загрузки сохранения объект новый → новый ГСЧ из сохранённого состояния).
const rngCache = new WeakMap();
class StateRNG extends RNG {
  constructor(c) {
    super((c.rngSeed >>> 0) || 0x5eed1996);
    this.c = c;
    if (Number.isFinite(c.rngState)) this.s = c.rngState >>> 0;
  }
  next() { const v = super.next(); this.c.rngState = this.s; return v; }
}
export function R(game) {
  const c = game.state.city;
  let r = rngCache.get(c);
  if (!r) { r = new StateRNG(c); rngCache.set(c, r); }
  return r;
}
export function poisson(rng, lambda) {
  if (!(lambda > 0)) return 0;
  const L = Math.exp(-Math.min(lambda, 30));
  let k = 0, p = 1;
  do { k++; p *= rng.next(); } while (p > L && k < 60);
  return k - 1;
}
/** детерминированный id внутри сохранения */
export function nid(game, prefix) {
  const c = game.state.city;
  c.seq = (c.seq || 0) + 1;
  return `${prefix}_${c.seq.toString(36)}`;
}

/* ------------------------------------------------------------------ время */
export function absOf(t) { return (t.day - 1) * DAY + t.minute; }
export function absNow(game) {
  const t = game.state.time;
  return t && Number.isFinite(t.day) && Number.isFinite(t.minute) ? absOf(t) : SHIFT_START;
}
export function dmOf(abs) {
  const day = Math.floor(abs / DAY) + 1;
  const minute = ((abs % DAY) + DAY) % DAY;
  return { day, minute };
}
export function minuteOfDay(abs) { return ((abs % DAY) + DAY) % DAY; }
export function hourOf(abs) { return Math.floor(minuteOfDay(abs) / 60); }
export function shiftOf(abs) { return Math.floor((abs - SHIFT_START) / DAY); }
export function hhmm(min) {
  const m = ((Math.round(min) % DAY) + DAY) % DAY;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
export function isNight(abs) { const h = hourOf(abs); return h >= 22 || h < 6; }
/** ближайший будущий момент с заданной минутой суток */
export function nextAt(abs, minuteOfDayTarget) {
  const base = abs - minuteOfDay(abs) + minuteOfDayTarget;
  return base > abs ? base : base + DAY;
}
/** «сегодня/завтра около 23:00» относительно now */
export function whenPhrase(game, now, at) {
  const dNow = dmOf(now).day, dAt = dmOf(at).day;
  const h = hourOf(at);
  const t = hhmm(minuteOfDay(at));
  let day;
  if (dAt === dNow) day = h < 5 ? 'этой ночью' : h < 12 ? 'сегодня утром' : h < 17 ? 'сегодня днём' : 'сегодня вечером';
  else if (dAt === dNow + 1) day = h < 5 ? 'в ночь на завтра' : h < 12 ? 'завтра утром' : h < 17 ? 'завтра днём' : 'завтра вечером';
  else day = dateShort(game, dAt);
  return `${day}, около ${t}`;
}

/* ------------------------------------------------------------------ календарь */
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
export const WEEKDAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
export const WEEKDAYS_ACC = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'];
export function calendar(game, day) {
  const st = (game.state.city && game.state.city.calendar) || { y: 1996, m: 10, d: 14 };
  const dt = new Date(Date.UTC(st.y, st.m - 1, st.d + day - 1));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: (dt.getUTCDay() + 6) % 7 };
}
export function dateStr(game, day) { const c = calendar(game, day); return `${c.d} ${MONTHS_GEN[c.m - 1]} ${c.y} г.`; }
export function dateShort(game, day) {
  const c = calendar(game, day);
  return `${String(c.d).padStart(2, '0')}.${String(c.m).padStart(2, '0')}.${String(c.y % 100).padStart(2, '0')}`;
}
export function monthPrep(m) { return MONTHS_PREP[m - 1]; }
export function monthGen(m) { return MONTHS_GEN[m - 1]; }

/* ------------------------------------------------------------------ текст */
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
export function nw(n, one, few, many) { return `${n} ${plural(n, one, few, many)}`; }
const COLLECTIVE = ['никого', 'один', 'двое', 'трое', 'четверо', 'пятеро', 'шестеро', 'семеро'];
const COLLECTIVE_GEN = ['никого', 'одного', 'двоих', 'троих', 'четверых', 'пятерых', 'шестерых', 'семерых'];
/** «двое», «пятеро», «девять человек» */
export function collective(n) { return n < COLLECTIVE.length ? COLLECTIVE[n] : `${n} человек`; }
/** «у двоих», «пятерых» */
export function collectiveGen(n) { return n < COLLECTIVE_GEN.length ? COLLECTIVE_GEN[n] : `${n} человек`; }
const NUM_WORDS = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять'];
export function numWord(n) { return n >= 0 && n < NUM_WORDS.length ? NUM_WORDS[n] : String(n); }
export function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
export function lowerFirst(s) { return s ? s[0].toLowerCase() + s.slice(1) : ''; }
export function sentence(s) {
  s = (s || '').trim();
  if (!s) return '';
  s = cap(s);
  return /[.!?…»"]$/.test(s) ? s : s + '.';
}
export function joinList(arr) {
  const a = arr.filter(Boolean);
  if (a.length <= 1) return a[0] || '';
  return a.slice(0, -1).join(', ') + ' и ' + a[a.length - 1];
}
export function money(n) {
  const v = Math.round(n || 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (v < 0 ? '−' : '') + s + ' тыс. руб.';
}
// Для теста и отладки: подстановки, у которых не оказалось значения.
export const textIssues = [];
/**
 * Подстановка: {key} — переменная из vars; {он/она} — форма по роду говорящего (fem).
 */
export function fmt(tpl, vars = {}, fem = false) {
  if (Array.isArray(tpl)) tpl = tpl[0];
  return String(tpl)
    .replace(/\{([^{}]+)\}/g, (m, inner) => {
      if (inner.includes('/')) { const [a, b] = inner.split('/'); return fem ? b : a; }
      const v = vars[inner];
      if (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) {
        if (textIssues.length < 100) textIssues.push(`{${inner}} в «${String(tpl).slice(0, 70)}»`);
        return '';
      }
      return String(v);
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?:;…])/g, '$1')
    .replace(/([,.!?:;…])(?=[А-ЯЁA-Z«])/g, '$1 ')
    .replace(/\.\./g, '.')
    .trim();
}
/** проверка строки на мусор (для теста) */
export function badText(s) { return typeof s !== 'string' || /undefined|NaN|\[object|null\b|\{[^}]*\}/.test(s); }

/* ------------------------------------------------------------------ зависимости */
const warned = new Set();
function warnOnce(key, e) {
  if (warned.has(key)) return;
  warned.add(key);
  if (typeof console !== 'undefined') console.warn('[city] сбой в', key, e && e.message ? e.message : e);
}
/** функция чужого модуля game.sim[mod][fn] или null */
export function dep(game, mod, fn) {
  const m = game.sim && game.sim[mod];
  const f = m && m[fn];
  return typeof f === 'function' ? f.bind(m) : null;
}
export function callDep(game, mod, fn, ...args) {
  const f = dep(game, mod, fn);
  if (!f) return undefined;
  try { return f(...args); } catch (e) { warnOnce(`${mod}.${fn}`, e); return undefined; }
}
export function safeCall(key, f, ...args) {
  try { return f(...args); } catch (e) { warnOnce(key, e); return undefined; }
}
export function emit(game, ev, payload) {
  if (game.state.city && game.state.city.silent) return;
  if (game.bus && typeof game.bus.emit === 'function') game.bus.emit(ev, payload);
}
export function glog(game, text, kind = 'city') {
  if (game.state.city && game.state.city.silent) return;
  if (typeof game.log === 'function') safeCall('game.log', game.log.bind(game), text, kind);
}

/* ------------------------------------------------------------------ сотрудники */
export function staffList(game) { return Array.isArray(game.state.staff) ? game.state.staff : []; }
export function officer(game, id) { return staffList(game).find((o) => o.id === id) || null; }
export function isFem(o) { return !!o && o.gender === 'f'; }
export function sk(o, k) { const v = o && o.skills && o.skills[k]; return Number.isFinite(v) ? v : 50; }
export function num(v, d = 0) { return Number.isFinite(v) ? v : d; }

const RANK_SHORT = [
  ['старший лейтенант', 'ст. лейтенант'], ['младший лейтенант', 'мл. лейтенант'], ['старший сержант', 'ст. сержант'],
  ['младший сержант', 'мл. сержант'], ['старший прапорщик', 'ст. прапорщик'],
];
export function rankShort(r) {
  if (!r) return 'сотрудник';
  for (const [a, b] of RANK_SHORT) if (r === a) return b;
  return r;
}
const RANK_ORDER = ['рядовой', 'мл. сержант', 'сержант', 'ст. сержант', 'старшина', 'прапорщик', 'ст. прапорщик', 'мл. лейтенант', 'лейтенант', 'ст. лейтенант', 'капитан', 'майор', 'подполковник', 'полковник'];
export function rankIndex(r) {
  const s = rankShort(r || '');
  let best = 0;
  RANK_ORDER.forEach((x, i) => { if (s === x) best = i; });
  return best;
}
/** «ст. сержант Петров» */
export function oName(game, o) {
  if (!o) return 'сотрудник';
  const f = dep(game, 'staff', 'displayName');
  let s = null;
  if (f) { try { s = f(o); } catch (e) { s = null; } }
  if (typeof s !== 'string' || !s || badText(s)) s = `${rankShort(o.rank)} ${o.lastName || ''}`.trim();
  return s;
}
export function oLast(o) { return (o && o.lastName) || 'сотрудник'; }

// Запасная таблица модификаторов черт (если staff.mod не знает ключ или модуля нет).
const TRAIT_FALLBACK = {
  coward: { courage: -0.4, aggression: -0.2, caution: 0.3 },
  hothead: { aggression: 0.4, courage: 0.2, discipline: -0.2, caution: -0.3 },
  pedant: { discipline: 0.3, diligence: 0.2 },
  drinker: { discipline: -0.2, perception: -0.1, drink: 0.6 },
  honest: { greed: -0.5, honesty: 0.5 },
  greedy: { greed: 0.4, honesty: -0.3 },
  afghan: { courage: 0.3, tactics: 0.2, shooting: 0.1, aggression: 0.1 },
  chechnya: { courage: 0.25, tactics: 0.2, aggression: 0.15, cruelty: 0.1 },
  family_man: { courage: -0.1, caution: 0.2 },
  rookie: { tactics: -0.2, courage: -0.1, discipline: 0.1, perception: -0.1 },
  veteran: { tactics: 0.15, perception: 0.15, diligence: -0.1 },
  lucky: { luck: 0.3 },
  marksman: { shooting: 0.3 },
  talker: { talk: 0.2, stealth: -0.2 },
  silent: { stealth: 0.2, talk: -0.1 },
  sadist: { cruelty: 0.5, aggression: 0.3 },
  kind: { cruelty: -0.4, talk: 0.15, aggression: -0.15 },
  lazy: { diligence: -0.4, discipline: -0.1 },
  ambitious: { diligence: 0.3, courage: 0.1 },
  superstitious: { caution: 0.1 },
  athlete: { fitness: 0.2 },
  sick: { fitness: -0.3 },
  sharp: { perception: 0.3 },
  leader: { tactics: 0.2, morale: 0.2, discipline: 0.1, courage: 0.1 },
};
export function hasTrait(o, id) { return !!o && Array.isArray(o.traits) && o.traits.includes(id); }
export function tmod(game, o, key) {
  if (!o) return 0;
  const f = dep(game, 'staff', 'mod');
  if (f) {
    let v;
    try { v = f(o, key); } catch (e) { v = undefined; }
    if (typeof v === 'number' && Number.isFinite(v) && v !== 0) return v;
  }
  let s = 0;
  for (const t of o.traits || []) { const m = TRAIT_FALLBACK[t]; if (m && m[key]) s += m[key]; }
  return s;
}
export function isDown(o) { return !o || o.status === 'dead' || o.status === 'hospital' || num(o.hp, 100) <= 15; }

/**
 * Изменение морали/усталости/стресса/лояльности сотрудника.
 * CONTRACT-NEEDS: staff.adjust(game, id, {morale, fatigue, stress, loyalty, arrests, kills, history}) — если нет, меняем поля напрямую.
 */
export function adjustOfficer(game, o, patch) {
  if (!o) return;
  const f = dep(game, 'staff', 'adjust');
  if (f) { try { f(game, o.id, patch); return; } catch (e) { /* ниже — напрямую */ } }
  for (const k of ['morale', 'fatigue', 'stress', 'loyalty']) {
    if (Number.isFinite(patch[k])) o[k] = clamp(num(o[k], 50) + patch[k], 0, 100);
  }
  if (o.stats) {
    if (patch.arrests) o.stats.arrests = num(o.stats.arrests) + patch.arrests;
    if (patch.kills) o.stats.kills = num(o.stats.kills) + patch.kills;
  }
  if (patch.history && Array.isArray(o.history)) {
    o.history.push({ day: game.state.time ? game.state.time.day : 1, text: patch.history });
    if (o.history.length > 60) o.history.splice(0, o.history.length - 60);
  }
}
