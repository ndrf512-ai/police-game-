// Вспомогательное для ИИ участка: время суток, имена «по-свойски», доп. точки, геометрия камер.
import { clamp } from '../core/rng.js';

export const HALF_PI = Math.PI / 2;

/** Детерминированное число 0..1 из строки (устойчивые «привычки» сотрудника). */
export function hash01(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100003) / 100003;
}

export const isNight = (m) => m >= 22 * 60 || m < 6 * 60;
export const isDeepNight = (m) => m >= 60 && m < 5 * 60 + 30;
/** 0..1 — насколько сейчас «спальное» время */
export function nightFactor(m) {
  if (m >= 60 && m < 330) return 1;
  if (m < 60) return 0.75;
  if (m >= 330 && m < 400) return 0.5;
  if (m >= 22 * 60) return 0.35 + (m - 22 * 60) / 120 * 0.4;
  return 0;
}
/** 'morning' | 'day' | 'evening' | 'night' */
export function timeOfDay(m) {
  if (m < 6 * 60) return 'night';
  if (m < 12 * 60) return 'morning';
  if (m < 18 * 60) return 'day';
  if (m < 22 * 60) return 'evening';
  return 'night';
}
export function hhmm(m) {
  const mm = ((Math.floor(m) % 1440) + 1440) % 1440;
  return String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0');
}
export const yawTo = (ax, az, bx, bz) => Math.atan2(bx - ax, bz - az);
export const dist = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);

export const OUTDOOR_ZONES = new Set(['street', 'yard', 'alley']);

// ——— звания ———
const RANK_SHORT = [
  [/^старший\s+/, 'ст. '], [/^младший\s+/, 'мл. '],
];
export function rankShort(rank) {
  let r = String(rank || 'сержант').toLowerCase();
  for (const [re, s] of RANK_SHORT) r = r.replace(re, s);
  return r;
}
export function displayName(o) {
  if (!o) return 'сотрудник';
  return `${rankShort(o.rank)} ${o.lastName}`;
}

// ——— имена «по-свойски» ———
const DIM_M = {
  'Александр': 'Саня', 'Алексей': 'Лёха', 'Анатолий': 'Толик', 'Андрей': 'Андрюха', 'Антон': 'Тоха', 'Аркадий': 'Аркаша',
  'Борис': 'Боря', 'Вадим': 'Вадик', 'Валентин': 'Валёк', 'Валерий': 'Валера', 'Василий': 'Вася', 'Виктор': 'Витёк',
  'Виталий': 'Виталик', 'Владимир': 'Вова', 'Владислав': 'Влад', 'Вячеслав': 'Славик', 'Геннадий': 'Гена', 'Георгий': 'Жора',
  'Григорий': 'Гриша', 'Денис': 'Дэн', 'Дмитрий': 'Димон', 'Евгений': 'Женька', 'Егор': 'Егорка', 'Иван': 'Ваня',
  'Игорь': 'Игорёк', 'Илья': 'Илюха', 'Кирилл': 'Киря', 'Константин': 'Костя', 'Леонид': 'Лёня', 'Максим': 'Макс',
  'Михаил': 'Миша', 'Николай': 'Коля', 'Олег': 'Олежка', 'Павел': 'Паша', 'Пётр': 'Петя', 'Роман': 'Ромка',
  'Руслан': 'Руся', 'Семён': 'Сёма', 'Сергей': 'Серёга', 'Станислав': 'Стас', 'Степан': 'Стёпа', 'Тимур': 'Тимур',
  'Фёдор': 'Федя', 'Юрий': 'Юрка', 'Ярослав': 'Ярик', 'Эдуард': 'Эдик', 'Артём': 'Тёма', 'Глеб': 'Глеб', 'Лев': 'Лёва', 'Матвей': 'Мотя',
};
const DIM_F = {
  'Анна': 'Аня', 'Алла': 'Алла', 'Валентина': 'Валя', 'Вера': 'Вера', 'Галина': 'Галя', 'Дарья': 'Даша', 'Елена': 'Лена',
  'Екатерина': 'Катя', 'Жанна': 'Жанна', 'Зинаида': 'Зина', 'Ирина': 'Ира', 'Инна': 'Инна', 'Кристина': 'Кристина',
  'Лариса': 'Лара', 'Людмила': 'Люда', 'Любовь': 'Люба', 'Марина': 'Марина', 'Мария': 'Маша', 'Надежда': 'Надя',
  'Наталья': 'Наташа', 'Нина': 'Нина', 'Ольга': 'Оля', 'Оксана': 'Оксана', 'Светлана': 'Света', 'Софья': 'Соня',
  'Тамара': 'Тома', 'Татьяна': 'Таня', 'Юлия': 'Юля', 'Яна': 'Яна', 'Алёна': 'Алёна', 'Евгения': 'Женя',
  'Виктория': 'Вика', 'Римма': 'Римма', 'Раиса': 'Рая', 'Полина': 'Поля',
};
const PATRO_SHORT = {
  'Александрович': 'Саныч', 'Михайлович': 'Михалыч', 'Павлович': 'Палыч', 'Петрович': 'Петрович', 'Ильич': 'Ильич',
  'Фёдорович': 'Фёдорыч', 'Константинович': 'Константиныч', 'Тимофеевич': 'Тимофеич', 'Георгиевич': 'Георгич',
  'Игоревич': 'Игоревич', 'Дмитриевич': 'Дмитрич', 'Николаевич': 'Николаич',
};
/** Сокращённое отчество для мужчин: Иванович → Иваныч, Сергеевич → Сергеич */
export function patroShort(p) {
  if (!p) return '';
  if (PATRO_SHORT[p]) return PATRO_SHORT[p];
  if (/евич$/.test(p)) return p.replace(/евич$/, 'ич');
  if (/ович$/.test(p)) return p.replace(/ович$/, 'ыч');
  return p;
}
/** Как его/её зовут сослуживцы: «Серёга», «Михалыч», «Люда», «Тамара Петровна». */
export function colloquial(p, age = 35, traits = []) {
  if (!p || !p.firstName) return 'друг';
  const old = age >= 45 || traits.includes('veteran');
  if (p.gender === 'f') return old ? `${p.firstName} ${p.patronymic}` : (DIM_F[p.firstName] || p.firstName);
  if (old) return patroShort(p.patronymic) || p.firstName;
  return DIM_M[p.firstName] || p.firstName;
}

/** «двое», «трое»… для доклада дежурного */
export function peopleCount(n) {
  const w = ['никого', 'один человек', 'двое', 'трое', 'четверо', 'пятеро', 'шестеро', 'семеро', 'восемь человек', 'девять человек'];
  return w[n] || `${n} человек`;
}

// ——— дополнительные точки участка (виртуальные, не в level.js). id начинается с 'v_' ———
// kind: stand | seat | lie | smoke | window | counter | cellfront | spot
export const SPOTS = {
  // окна (смотреть на дождь)
  v_win_corr_w:  { x: 0.9, z: 12.0, yaw: -HALF_PI, kind: 'window', zone: 'corridor' },
  v_win_corr_e:  { x: 31.1, z: 11.4, yaw: HALF_PI, kind: 'window', zone: 'corridor' },
  v_win_lobby:   { x: 12.0, z: 19.2, yaw: 0, kind: 'window', zone: 'lobby' },
  v_win_duty:    { x: 28.2, z: 19.1, yaw: 0, kind: 'window', zone: 'duty' },
  v_win_opers:   { x: 10.0, z: 0.9, yaw: Math.PI, kind: 'window', zone: 'opers' },
  // доп. места для курения (рядом с уже курящими)
  v_smoke_3:     { x: 19.3, z: 21.9, yaw: -0.4, kind: 'smoke', zone: 'street' },
  v_smoke_4:     { x: 13.3, z: 21.7, yaw: 0.4, kind: 'smoke', zone: 'street' },
  v_smoke_y2:    { x: 27.3, z: -1.1, yaw: 0.9, kind: 'smoke', zone: 'yard' },
  // переодевание в комнате отдыха
  v_change_1:    { x: 5.5, z: 17.9, yaw: -HALF_PI, kind: 'stand', zone: 'rest' },
  v_change_2:    { x: 7.4, z: 17.4, yaw: 0, kind: 'stand', zone: 'rest' },
  v_change_3:    { x: 8.4, z: 16.7, yaw: HALF_PI, kind: 'stand', zone: 'rest' },
  // комната отдыха — постоять с кружкой
  v_rest_stand_1:{ x: 6.4, z: 16.6, yaw: -2.4, kind: 'stand', zone: 'rest' },
  v_rest_stand_2:{ x: 7.6, z: 15.4, yaw: Math.PI, kind: 'stand', zone: 'rest' },
  // туалет — очередь
  v_toilet_wait: { x: 2.0, z: 12.9, yaw: Math.PI, kind: 'stand', zone: 'corridor' },
  // двор — укромные места
  v_yard_hide:   { x: 14.0, z: -5.7, yaw: 0, kind: 'stand', zone: 'yard' },
  v_yard_dog:    { x: 5.0, z: -3.0, yaw: Math.PI, kind: 'stand', zone: 'yard' },
  // оружейка: стойка выдачи (3 окна) и «заначка»
  v_counter_1:   { x: 14.3, z: 8.4, yaw: Math.PI, kind: 'counter', zone: 'armory' },
  v_counter_3:   { x: 16.6, z: 8.4, yaw: Math.PI, kind: 'counter', zone: 'armory' },
  v_armory_hide: { x: 16.3, z: 3.2, yaw: HALF_PI, kind: 'stand', zone: 'armory' },
  // у камер (снаружи решётки)
  v_cellfront_1: { x: 19.5, z: 5.5, yaw: Math.PI, kind: 'cellfront', zone: 'ivs' },
  v_cellfront_2: { x: 22.5, z: 5.5, yaw: Math.PI, kind: 'cellfront', zone: 'ivs' },
  v_cellfront_3: { x: 25.5, z: 5.5, yaw: Math.PI, kind: 'cellfront', zone: 'ivs' },
  v_ivs_wait_1:  { x: 21.0, z: 7.4, yaw: Math.PI, kind: 'stand', zone: 'ivs' },
  v_ivs_wait_2:  { x: 22.2, z: 7.6, yaw: Math.PI, kind: 'stand', zone: 'ivs' },
  v_ivs_wait_3:  { x: 23.4, z: 7.4, yaw: Math.PI, kind: 'stand', zone: 'ivs' },
  // у машин
  v_car_1:       { x: 13.6, z: 25.0, yaw: -HALF_PI, kind: 'stand', zone: 'street' },
  v_car_2:       { x: 24.6, z: 25.0, yaw: -HALF_PI, kind: 'stand', zone: 'street' },
  // вестибюль — постоять в очереди
  v_lobby_1:     { x: 14.0, z: 17.6, yaw: HALF_PI, kind: 'stand', zone: 'lobby' },
  v_lobby_2:     { x: 18.6, z: 15.6, yaw: HALF_PI, kind: 'stand', zone: 'lobby' },
  v_lobby_3:     { x: 19.4, z: 18.6, yaw: HALF_PI, kind: 'stand', zone: 'lobby' },
  v_lobby_4:     { x: 13.6, z: 15.4, yaw: HALF_PI, kind: 'stand', zone: 'lobby' },
  // дежурка — постоять у пульта (разговор с дежурным, звонок домой)
  v_duty_side:   { x: 25.6, z: 15.4, yaw: -2.2, kind: 'stand', zone: 'duty' },
  // лёжа: диван, лавки (позиции на мебели — непроходимые клетки, это нормально для лежащих)
  v_sofa_lie:    { x: 6.5, z: 19.0, yaw: HALF_PI, kind: 'lie', zone: 'rest', y: 0.42, needs: ['tv_sofa_1', 'tv_sofa_2'], approach: 'tv_sofa_1' },
  v_bench_lie:   { x: 12.0, z: 10.45, yaw: HALF_PI, kind: 'lie', zone: 'corridor', y: 0.4, needs: ['corridor_bench'], approach: 'corridor_bench' },
  v_lobby_lie_1: { x: 10.5, z: 16.5, yaw: 0, kind: 'lie', zone: 'lobby', y: 0.4, needs: ['visitor_bench_1', 'visitor_bench_2'], approach: 'visitor_bench_1' },
  v_lobby_lie_2: { x: 10.5, z: 18.8, yaw: 0, kind: 'lie', zone: 'lobby', y: 0.4, needs: ['visitor_bench_3', 'visitor_bench_4'], approach: 'visitor_bench_3' },
  // огнетушитель
  v_fire_ext:    { x: 0.8, z: 12.6, yaw: -HALF_PI, kind: 'stand', zone: 'corridor' },
};

/** Маршрут обхода участка изнутри */
export const PATROL_ROUTE = [
  'post_corridor_w', 'v_win_corr_w', 'post_office', 'post_corridor_c', 'post_armory', 'post_ivs', 'post_corridor_e',
  'post_generator', 'back_door_in', 'post_corridor_e', 'station_plan', 'post_duty_window', 'post_front_lobby', 'front_door_in', 'post_lobby_bench',
];

/** Русские названия мест для приказов/интерфейса */
export const PLACE_NAMES = {
  post_front_lobby: 'Вестибюль, у входа', post_lobby_bench: 'Вестибюль, у скамеек', post_duty_window: 'Дежурка, у окна',
  post_corridor_w: 'Коридор, западный конец', post_corridor_c: 'Коридор, центр', post_corridor_e: 'Коридор, восточный конец',
  post_generator: 'Генераторная', post_armory: 'Оружейная', post_ivs: 'ИВС, у камер', post_office: 'Кабинет начальника',
  post_rest_window: 'Комната отдыха, у окна', post_porch: 'Крыльцо', post_yard: 'Двор', front_door_in: 'Главный вход',
  back_door_in: 'Чёрный ход', duty_desk: 'Пульт дежурного', ivs_guard: 'Пост конвоя', armory_clerk: 'Окно выдачи оружия',
};

// ——— камеры ИВС ———
const CELL_DEF = {
  cell_1: { x0: 18.0, x1: 20.5, cx: 19.5 },
  cell_2: { x0: 21.0, x1: 23.5, cx: 22.5 },
  cell_3: { x0: 24.0, x1: 26.5, cx: 25.5 },
};
export const CELL_IDS = ['cell_1', 'cell_2', 'cell_3'];
/** Геометрия камеры: внутренний прямоугольник и «места» внутри */
export function cellGeom(cellId) {
  const c = CELL_DEF[cellId] || CELL_DEF.cell_1;
  const { x0, x1, cx } = c;
  return {
    id: cellId, x0, x1, z0: 1.25, z1: 3.85, cx,
    front: 'v_cellfront_' + cellId.slice(-1),
    slots: {
      bunk_lie: { x: cx, z: 0.72, yaw: HALF_PI, pose: 'lie', y: 0.45 },
      bunk_sit_1: { x: cx - 0.55, z: 1.5, yaw: 0, pose: 'sit' },
      bunk_sit_2: { x: cx + 0.45, z: 1.5, yaw: 0, pose: 'sit' },
      floor: { x: x0 + 0.35, z: 3.0, yaw: HALF_PI, pose: 'sit', floor: true },
      bars_1: { x: cx - 0.7, z: 3.7, yaw: 0, pose: 'stand' },
      bars_2: { x: cx + 0.3, z: 3.7, yaw: 0, pose: 'stand' },
      corner: { x: x1 - 0.3, z: 2.6, yaw: -HALF_PI, pose: 'stand' },
    },
  };
}
/** Внутри ли точка камеры (за решёткой) */
export function inCell(cellId, x, z) {
  const g = cellGeom(cellId);
  return x >= g.x0 - 0.05 && x <= g.x1 + 0.05 && z >= 0 && z <= 3.95;
}
export function cellOfPos(x, z) {
  for (const id of CELL_IDS) if (inCell(id, x, z)) return id;
  return null;
}

/** Длительность показа реплики по длине */
export const speechDur = (text) => clamp(1.8 + String(text).length * 0.055, 2.2, 7.5);
