// «Участок» — звуковой движок (агент F). Весь звук — процедурный синтез, без звуковых файлов.
//
// Как устроено:
//  • Каждый звук — функция-генератор на чистом JS (шум, биквады, модальные резонаторы, формантный голос),
//    рендерится в Float32Array один раз (лениво при первом play или в фоне после init) → AudioBuffer → кэш.
//    У звуков по несколько вариантов + джиттер скорости, чтобы не было «пулемётных» повторов.
//  • Граф: голоса → [расстояние → lowpass (воздух/за спиной/за стеной) → StereoPanner] → шины sfx/ambience/radio
//    → master → DynamicsCompressor (лимитер) → выход. Реверберация — два конволвера с сгенерированными импульсами
//    (внутри здания / на улице), выбор по положению источника.
//  • Пул голосов с приоритетами, кап одновременных копий одного звука, все ноды отключаются по onended.
//  • Без init() всё молча ничего не делает (play → null, loop → «отложенный» хэндл, который заиграет после init).
//
// API (см. docs/CONTRACTS.md, раздел F):
//   const audio = new Audio({ lowPower?, maxVoices?, mirror?, prewarm?, tinnitus?, context? })
//   audio.init()                       — в обработчике первого жеста (создаёт/будит AudioContext). Можно звать на каждый тап.
//   audio.autoInit(el=window)          — сам повесит init на первый pointerdown/keydown/touchend
//   audio.setListener(x, z, yaw)       — yaw как у Actor: вперёд = (sin yaw, cos yaw)
//   audio.setOcclusionFn(fn)           — fn(x, z, listenerX, listenerZ) → 0..1 (0 — прямая слышимость, 1 — за толстыми стенами)
//                                         готовая: occlusionFromWorld(world)
//   audio.play(name, {x, z, vol, rate, delay}) → {stop()} | null
//   audio.loop(name, {x, z, vol, rate, delay, fadeIn}) → {stop(fade), setVol(v), setPos(x,z), setRate(r), playing}
//   audio.ambience({rain, hum, tv, power, tension, indoor, window, city, night, storm})  — частичное обновление, плавно
//        indoor/window: null|undefined → считаются сами по позиции слушателя и окнам из level.js
//   audio.radioBurst('open'|'close'|'static'|'alarm', {vol, x, z})
//   audio.radioVoice(durationSec, {female, urgent, vol, bursts=true, x, z}) → {stop(), duration, startsIn}
//   audio.setVolume(master, sfx, ambience, radio)   — 0..1, undefined = не менять
//   audio.bindBus(bus, game, {shots, power, radio, tension}) — необязательные подписки на 'shot','power','radio','attack:*'
//   audio.onThunder = ({flashIn, soundIn, near}) => {...}  — хук для вспышки молнии в рендере
//   audio.update(dt), suspend(), resume(), dispose(), has(name), names
//
import { RNG } from '../core/rng.js';
import { WINDOWS, PROPS, ROOMS } from '../world/level.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampv = (v, a, b) => (v < a ? a : v > b ? b : v);

// ═════════════════════════════ DSP-инструменты ═════════════════════════════

/** Биквад RBJ (lp/hp/bp/pk/notch) */
class BQ {
  constructor(sr) { this.sr = sr; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.b0 = 1; this.b1 = this.b2 = this.a1 = this.a2 = 0; }
  set(type, f, q = 0.707, gain = 0) {
    const sr = this.sr; f = clampv(f, 8, sr * 0.45);
    const w = TAU * f / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'pk') { const A = Math.pow(10, gain / 40); b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; }
    else { b0 = 1; b1 = -2 * c; b2 = 1; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  p(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}
/** Резонатор Клатта (единичное усиление на DC) — для каскадного формантного синтеза */
class KR {
  constructor(sr) { this.sr = sr; this.y1 = this.y2 = 0; this.A = 1; this.B = this.C = 0; }
  set(F, BW) {
    const T = 1 / this.sr; F = Math.min(F, this.sr * 0.45);
    this.C = -Math.exp(-TAU * BW * T); this.B = 2 * Math.exp(-Math.PI * BW * T) * Math.cos(TAU * F * T); this.A = 1 - this.B - this.C;
  }
  p(x) { const y = this.A * x + this.B * this.y1 + this.C * this.y2; this.y2 = this.y1; this.y1 = y; return y; }
}
const mk = (sr, sec) => new Float32Array(Math.max(1, Math.ceil(sr * sec)));
function filt(a, sr, type, f, q = 0.707, g = 0) { const b = new BQ(sr).set(type, f, q, g); for (let i = 0; i < a.length; i++) a[i] = b.p(a[i]); return a; }
function addAt(out, src, i0, g = 1) { const n = Math.min(src.length, out.length - i0); for (let k = Math.max(0, -i0); k < n; k++) out[i0 + k] += src[k] * g; return out; }
function peakOf(d) { let p = 0; const chs = Array.isArray(d) ? d : [d]; for (const a of chs) for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > p) p = v; } return p; }
function rmsOf(d) { let s = 0, n = 0; const chs = Array.isArray(d) ? d : [d]; for (const a of chs) { for (let i = 0; i < a.length; i++) s += a[i] * a[i]; n += a.length; } return Math.sqrt(s / Math.max(1, n)); }
function scale(d, g) { const chs = Array.isArray(d) ? d : [d]; for (const a of chs) for (let i = 0; i < a.length; i++) a[i] *= g; return d; }
function norm(d, peak = 0.9) { const p = peakOf(d); if (p > 1e-9 && isFinite(p)) scale(d, peak / p); return d; }
function normRMS(d, target, maxPeak = 0.97) { const r = rmsOf(d); if (r > 1e-9) scale(d, target / r); const p = peakOf(d); if (p > maxPeak) scale(d, maxPeak / p); return d; }
function saturate(a, drive) { const k = Math.tanh(drive); for (let i = 0; i < a.length; i++) a[i] = Math.tanh(a[i] * drive) / k; return a; }
function fade(a, sr, fin = 0.002, fout = 0.02) {
  const ni = Math.min(a.length, Math.ceil(fin * sr)), no = Math.min(a.length, Math.ceil(fout * sr));
  for (let i = 0; i < ni; i++) a[i] *= i / ni;
  for (let i = 0; i < no; i++) a[a.length - 1 - i] *= i / no;
  return a;
}
/** Периодический материал: хвост за L сворачивается в начало (идеально бесшовная петля) */
function circularize(a, L) { const out = new Float32Array(L); for (let i = 0; i < a.length; i++) out[i % L] += a[i]; return out; }
/** Случайная текстура: равномощностной кроссфейд хвоста на начало. a.length = L + X */
function loopify(a, L) {
  const X = a.length - L, out = a.slice(0, L);
  for (let i = 0; i < X; i++) { const t = i / X; out[i] = a[i] * Math.sin(t * Math.PI / 2) + a[L + i] * Math.cos(t * Math.PI / 2); }
  return out;
}
function echoes(a, sr, list) {
  const src = a.slice();
  for (const [t, g, f] of list) {
    const d = Math.round(t * sr), b = new BQ(sr).set('lp', f || 3000, 0.7);
    for (let i = 0; i + d < a.length; i++) a[i + d] += g * b.p(src[i]);
  }
  return a;
}
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
/** Шумовая вспышка с огибающей и фильтрами; amp ≈ уровень независимо от полосы (компенсация) */
function burst(out, sr, R, t0, o) {
  const amp = o.amp ?? 1, tau = o.tau ?? 0.01, atk = o.atk ?? 0.0004, hold = o.hold ?? 0;
  const i0 = Math.max(0, Math.floor(t0 * sr));
  const len = Math.min(out.length - i0, Math.ceil((atk + hold + tau * (o.tail ?? 7)) * sr));
  if (len <= 0) return out;
  const fs = []; let comp = 1; const ny = sr / 2;
  if (o.hp) { fs.push(new BQ(sr).set('hp', o.hp, 0.7)); comp *= Math.sqrt(ny / Math.max(200, ny - o.hp)); }
  if (o.lp) { fs.push(new BQ(sr).set('lp', o.lp, 0.7)); comp *= Math.sqrt(ny / Math.min(ny, o.lp)); }
  if (o.bp) { const q = o.q ?? 1; fs.push(new BQ(sr).set('bp', o.bp, q)); comp *= Math.sqrt(ny / Math.min(ny, o.bp / q)); }
  if (o.raw) comp = 1;
  comp = Math.min(comp, 12);
  const nA = atk * sr, nH = (atk + hold) * sr, kT = 1 / (tau * sr);
  for (let k = 0; k < len; k++) {
    const e = k < nA ? k / nA : k < nH ? 1 : Math.exp(-(k - nH) * kT);
    let x = (R.next() * 2 - 1) * e;
    for (let f = 0; f < fs.length; f++) x = fs[f].p(x);
    out[i0 + k] += x * amp * comp;
  }
  return out;
}
/** Синус с падением высоты (удар, «бум») */
function thump(out, sr, t0, f0, f1, tau, amp, o = {}) {
  const i0 = Math.max(0, Math.floor(t0 * sr)), len = Math.min(out.length - i0, Math.ceil(tau * 8 * sr));
  const pt = o.ptau ?? tau * 0.4, atk = o.atk ?? 0.0012, h2 = o.h2 ?? 0;
  let ph = 0;
  for (let k = 0; k < len; k++) {
    const t = k / sr, f = f1 + (f0 - f1) * Math.exp(-t / pt);
    ph += TAU * f / sr;
    out[i0 + k] += (Math.sin(ph) + h2 * Math.sin(2 * ph)) * (t < atk ? t / atk : 1) * Math.exp(-t / tau) * amp;
  }
  return out;
}
/** Затухающая синусоида (рекурсивный осциллятор) */
function ping(out, sr, t0, f, tau, amp) {
  if (f >= sr * 0.47 || f <= 0 || !amp) return out;
  const w = TAU * f / sr, r = Math.exp(-1 / (tau * sr)), c = 2 * r * Math.cos(w), r2 = r * r;
  const i = Math.max(0, Math.round(t0 * sr)), n = Math.min(out.length, i + Math.ceil(tau * sr * 7));
  let a = 0, b = amp * r * Math.sin(w);
  if (i + 1 < n) out[i + 1] += b;
  for (let k = i + 2; k < n; k++) { const y = c * b - r2 * a; out[k] += y; a = b; b = y; }
  return out;
}
function pingsModes(out, sr, t0, list, amp) { for (const [f, tau, a] of list) ping(out, sr, t0, f, tau, a * amp); return out; }
/** Банк модальных резонаторов, возбуждаемый сигналом exc */
function modes(exc, sr, list, out) {
  out = out || new Float32Array(exc.length);
  for (const [f, tau, amp] of list) {
    if (f >= sr * 0.47) continue;
    const r = Math.exp(-1 / (tau * sr)), w = TAU * f / sr, a1 = 2 * r * Math.cos(w), a2 = r * r, b = Math.sin(w) * amp;
    let y1 = 0, y2 = 0;
    for (let i = 0; i < exc.length; i++) { const y = b * exc[i] + a1 * y1 - a2 * y2; y2 = y1; y1 = y; out[i] += y; }
  }
  return out;
}
/** Чирп (капля, пузырь): частота растёт f0→f1 */
function chirp(out, sr, t0, f0, f1, tau, amp) {
  const i0 = Math.max(0, Math.floor(t0 * sr)), n = Math.min(out.length - i0, Math.ceil(tau * 7 * sr));
  let ph = 0;
  for (let k = 0; k < n; k++) {
    const t = k / sr, f = f0 + (f1 - f0) * (1 - Math.exp(-t / (tau * 1.5)));
    ph += TAU * f / sr;
    out[i0 + k] += Math.sin(ph) * Math.exp(-t / tau) * amp * (t < 0.0005 ? t / 0.0005 : 1);
  }
  return out;
}
/** Песок/крошка: редкие импульсы через ВЧ */
function grit(out, sr, R, t0, dur, amp, dens = 2500, hp = 2200) {
  const i0 = Math.floor(t0 * sr), n = Math.min(out.length - i0, Math.ceil(dur * sr));
  if (n <= 0) return out;
  const tmp = new Float32Array(n), p = dens / sr;
  for (let k = 0; k < n; k++) if (R.next() < p) tmp[k] = (R.next() * 2 - 1) * Math.exp(-k / (n * 0.4));
  filt(tmp, sr, 'hp', hp, 0.7);
  return addAt(out, tmp, i0, amp);
}
/** Мокрый зернистый шум (брызги, хлюпанье) */
function wet(out, sr, R, t0, dur, amp, f0 = 2600, f1 = 2600, q = 0.6) {
  const i0 = Math.floor(t0 * sr), n = Math.min(out.length - i0, Math.ceil(dur * sr * 1.8));
  if (n <= 0) return out;
  const b = new BQ(sr), h = new BQ(sr).set('hp', 500, 0.7);
  let g = 0, gT = 0, cnt = 0;
  for (let k = 0; k < n; k++) {
    const t = k / sr;
    if ((k & 15) === 0) b.set('bp', f1 + (f0 - f1) * Math.exp(-t / (dur * 0.5)), q);
    if (--cnt <= 0) { cnt = (0.0006 + R.next() * 0.003) * sr; gT = R.next() * R.next(); }
    g += (gT - g) * 0.25;
    const e = t < 0.003 ? t / 0.003 : Math.exp(-(t - 0.003) / (dur * 0.4));
    out[i0 + k] += h.p(b.p((R.next() * 2 - 1) * e * g)) * amp * 4;
  }
  return out;
}
/** Скрип (stick-slip): поезд импульсов с блуждающей частотой через резонансы */
function creak(out, sr, R, t0, dur, o) {
  const n = Math.ceil(dur * sr), exc = new Float32Array(n);
  let t = 0, rate = o.r0; const wob = R.range(1.5, 4.5), wph = R.next() * TAU;
  while (t < dur) {
    const x = t / dur;
    const target = o.r0 + (o.r1 - o.r0) * x + (o.r1 - o.r0) * 0.35 * Math.sin(wph + TAU * wob * t);
    rate += (target - rate) * 0.15 + (R.next() * 2 - 1) * o.r0 * 0.07;
    rate = Math.max(12, rate);
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, x * 1.04)), 0.7) * (0.6 + 0.4 * R.next());
    const i = Math.floor(t * sr); if (i < n) exc[i] += env;
    t += 1 / rate;
  }
  const res = norm(modes(exc, sr, o.modes), 1);
  return addAt(out, res, Math.floor(t0 * sr), o.amp);
}
/** Полосовой шум со сдвигом частоты и огибающей sin (взмах, шорох) */
function sweepNoise(out, sr, R, t0, dur, f0, f1, q, amp) {
  const i0 = Math.floor(t0 * sr), n = Math.min(out.length - i0, Math.ceil(dur * sr)); const b = new BQ(sr);
  for (let k = 0; k < n; k++) {
    const x = k / n; if ((k & 15) === 0) b.set('bp', f0 + (f1 - f0) * x, q);
    out[i0 + k] += b.p(R.next() * 2 - 1) * Math.sin(Math.PI * x) * amp * 3;
  }
  return out;
}
function softClipCurve(drive, n = 1024) { const c = new Float32Array(n), k = Math.tanh(drive); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * drive) / k; } return c; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ═════════════════════════════ Оружие ═════════════════════════════
// Параметры: blast (шумовой хлопок с закрывающимся фильтром), body (низкий шумовой «поп»), thump (синус с падением),
// tail (собственный раскат), crack (сверхзвуковая N-волна), peaks (EQ), echo, drive (насыщение), mech (механика).
const GUN = {
  pm: { dur: 0.8, atk: 0.0003, bT: 0.010, bA: 1, lS: 8000, lE: 1400, lT: 0.010, bnF: 650, bnT: 0.03, bnA: 0.45, thF0: 240, thF1: 100, thT: 0.028, thA: 0.5,
    tA: 0.10, tT: 0.11, tL0: 1800, tL1: 500, peaks: [[1100, 1.0, 4], [3200, 1.5, -3]], echo: [], drive: 2.0, mech: 'pistol' },
  tt: { dur: 0.9, atk: 0.0002, bT: 0.013, bA: 1.1, lS: 12000, lE: 2000, lT: 0.009, bnF: 850, bnT: 0.025, bnA: 0.35, thF0: 220, thF1: 95, thT: 0.024, thA: 0.42,
    tA: 0.14, tT: 0.15, tL0: 2400, tL1: 650, crack: 0.8, crackDur: 0.00035, peaks: [[2600, 1.2, 5]], echo: [[0.05, 0.1, 2500]], drive: 2.8, mech: 'pistol' },
  ak: { dur: 1.5, atk: 0.0002, bT: 0.018, bA: 1.2, lS: 15000, lE: 2500, lT: 0.015, bnF: 1000, bnT: 0.045, bnA: 0.45, thF0: 175, thF1: 70, thT: 0.032, thA: 0.5,
    tA: 0.26, tT: 0.30, tL0: 3000, tL1: 500, crack: 1.0, crackDur: 0.00025, peaks: [[3000, 1, 6], [1200, 0.8, 3]],
    echo: [[0.065, 0.22, 2400], [0.15, 0.14, 1700], [0.27, 0.09, 1200], [0.42, 0.05, 900]], drive: 3.4, mech: 'rifle' },
  ks23: { dur: 2.2, atk: 0.0008, bT: 0.035, bA: 0.9, lS: 6000, lE: 650, lT: 0.028, bnF: 380, bnT: 0.11, bnA: 0.75, thF0: 120, thF1: 38, thT: 0.085, thA: 1.1, h2: 0.4,
    tA: 0.30, tT: 0.55, tL0: 900, tL1: 200, peaks: [[170, 0.9, 4], [2500, 1, -4]], echo: [[0.09, 0.3, 800], [0.2, 0.2, 600], [0.36, 0.12, 450]], drive: 4, mech: null },
  sawnoff: { dur: 1.7, atk: 0.0005, bT: 0.028, bA: 1.2, lS: 10000, lE: 1300, lT: 0.02, bnF: 650, bnT: 0.065, bnA: 0.6, thF0: 140, thF1: 55, thT: 0.05, thA: 0.75, h2: 0.25,
    tA: 0.22, tT: 0.40, tL0: 1500, tL1: 380, peaks: [[700, 0.8, 5], [2000, 1, 2]], echo: [[0.075, 0.22, 1500], [0.18, 0.13, 1000]], drive: 4.5, mech: null },
  shotgun: { dur: 1.9, atk: 0.0006, bT: 0.03, bA: 1.0, lS: 8000, lE: 1000, lT: 0.022, bnF: 500, bnT: 0.08, bnA: 0.65, thF0: 130, thF1: 48, thT: 0.065, thA: 0.9, h2: 0.3,
    tA: 0.25, tT: 0.45, tL0: 1200, tL1: 300, peaks: [[400, 0.9, 3]], echo: [[0.08, 0.24, 1200], [0.19, 0.15, 800]], drive: 3.8, mech: null },
};
function casing(out, sr, R, t, amp, steel = false) {
  let dt = R.range(0.07, 0.12), a = amp; const f = steel ? R.range(3800, 4600) : R.range(5200, 6400);
  for (let k = 0, n = R.int(2, 4); k < n; k++) {
    pingsModes(out, sr, t, [[f * R.range(0.97, 1.03), 0.03, 1], [f * 1.55, 0.02, 0.6], [f * 2.1, 0.012, 0.3]], a);
    t += dt; dt *= 0.6; a *= 0.55;
  }
  return out;
}
function genShot(sr, R, P) {
  const v = (x, d = 0.1) => x * (1 + (R.next() * 2 - 1) * d);
  const out = mk(sr, P.dur), N = out.length;
  const bT = v(P.bT), lT = v(P.lT), lS = v(P.lS), lE = v(P.lE), atk = P.atk || 0.0003;
  const fA = new BQ(sr), fB = new BQ(sr), bodyF = new BQ(sr).set('lp', v(P.bnF), 0.8), tailF = new BQ(sr), tailF2 = new BQ(sr);
  const thF0 = v(P.thF0), thF1 = v(P.thF1), thT = v(P.thT), tT = v(P.tT, 0.15);
  const bnComp = Math.sqrt(sr / 2 / P.bnF), tComp = Math.sqrt(sr / 2 / P.tL0);
  let ph = 0, roll = 1, rollT = 1, rollN = 0;
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    if ((i & 15) === 0) {
      const fc = lE + (lS - lE) * Math.exp(-t / lT);
      fA.set('lp', fc, 0.7); fB.set('lp', fc * 1.3, 0.6);
      if (P.tA) { const ft = P.tL1 + (P.tL0 - P.tL1) * Math.exp(-t / (tT * 0.7)); tailF.set('lp', ft, 0.6); tailF2.set('lp', ft * 1.2, 0.6); }
      if (--rollN <= 0) { rollN = (0.02 + R.next() * 0.05) * sr / 16; rollT = 0.35 + R.next() * 0.9; }
      roll += (rollT - roll) * 0.25;
    }
    const n = R.next() * 2 - 1;
    const eb = t < atk ? t / atk : Math.exp(-(t - atk) / bT);
    let y = fB.p(fA.p(n * eb)) * P.bA;
    y += bodyF.p(n * Math.exp(-t / P.bnT)) * P.bnA * bnComp;
    const f = thF1 + (thF0 - thF1) * Math.exp(-t / (thT * 0.45));
    ph += TAU * f / sr;
    y += (Math.sin(ph) + (P.h2 || 0) * Math.sin(2 * ph + 0.5)) * Math.min(1, t / 0.0008) * Math.exp(-t / thT) * P.thA;
    if (P.tA) y += tailF2.p(tailF.p(n)) * P.tA * tComp * (1 - Math.exp(-t / 0.012)) * Math.exp(-t / tT) * roll;
    out[i] = y;
  }
  if (P.crack) {
    const L = Math.max(3, Math.round(sr * P.crackDur)), off = Math.round(sr * 0.0002);
    for (let k = 0; k < L; k++) out[off + k] += P.crack * (1 - 2 * k / (L - 1));
  }
  filt(out, sr, 'hp', 32, 0.7);
  for (const [f, q, g] of P.peaks || []) filt(out, sr, 'pk', v(f, 0.06), q, g);
  norm(out, 1); saturate(out, P.drive);
  if (P.echo && P.echo.length) echoes(out, sr, P.echo.map(([t, g, f]) => [v(t, 0.15), g, f]));
  if (P.mech === 'pistol') {
    const t0 = R.range(0.014, 0.022);
    pingsModes(out, sr, t0, [[R.range(2900, 3300), 0.006, 1], [R.range(4500, 5000), 0.004, 0.6], [R.range(6600, 7200), 0.003, 0.4]], 0.05);
    pingsModes(out, sr, t0 + R.range(0.012, 0.02), [[R.range(2300, 2600), 0.008, 1], [R.range(3800, 4200), 0.005, 0.5]], 0.045);
    casing(out, sr, R, R.range(0.36, 0.55), 0.025);
  } else if (P.mech === 'rifle') {
    pingsModes(out, sr, R.range(0.025, 0.035), [[R.range(1700, 1900), 0.012, 1], [R.range(2500, 2800), 0.008, 0.6], [R.range(4000, 4300), 0.005, 0.4]], 0.06);
    casing(out, sr, R, R.range(0.4, 0.6), 0.02, true);
  }
  return fade(norm(out, 0.95), sr, 0, 0.03);
}
/** Далёкий выстрел: почти одно эхо от домов */
function genFarShot(sr, R, rifle) {
  const out = mk(sr, 2.6);
  thump(out, sr, 0, rifle ? 160 : 130, 60, 0.03, 0.7);
  burst(out, sr, R, 0, { amp: 1, tau: rifle ? 0.012 : 0.016, lp: rifle ? 1800 : 1100 });
  const src = out.slice(0, Math.ceil(0.15 * sr));
  let t = R.range(0.12, 0.25);
  for (let k = 0; k < R.int(4, 7); k++) {
    const g = R.range(0.25, 0.6) * Math.exp(-t * 1.2);
    const b = new BQ(sr).set('lp', 1100 - t * 300, 0.7), d = Math.floor(t * sr);
    for (let i = 0; i < src.length && d + i < out.length; i++) out[d + i] += b.p(src[i]) * g;
    t += R.range(0.1, 0.35);
  }
  burst(out, sr, R, 0.05, { amp: 0.25, tau: 0.6, lp: 500, atk: 0.08 });
  return fade(norm(filt(out, sr, 'hp', 70, 0.7), 0.9), sr, 0, 0.3);
}
function genRicochet(sr, R) {
  const out = mk(sr, 0.9);
  burst(out, sr, R, 0, { amp: 0.7, tau: 0.002, hp: 2000 });
  pingsModes(out, sr, 0, [[R.range(2500, 3500), 0.01, 1], [R.range(5000, 6500), 0.006, 0.6]], 0.15);
  const t0 = 0.008, dur = R.range(0.35, 0.65), f0 = R.range(2600, 4200), f1 = f0 * R.range(0.28, 0.45);
  const tumble = R.range(25, 60), depth = R.range(0.2, 0.6), bp = new BQ(sr);
  let ph = 0;
  for (let i = Math.floor(t0 * sr), n = Math.min(out.length, i + Math.ceil(dur * sr * 1.3)); i < n; i++) {
    const t = i / sr - t0, x = t / dur, f = f1 + (f0 - f1) * Math.exp(-x * 2.2);
    ph += TAU * f * (1 + 0.004 * Math.sin(TAU * tumble * t)) / sr;
    if ((i & 15) === 0) bp.set('bp', f, 6);
    const env = Math.min(1, t / 0.012) * Math.exp(-x * 2.5) * (1 - depth * 0.5 * (1 + Math.sin(TAU * tumble * t)));
    out[i] += (Math.sin(ph) * 0.5 + bp.p(R.next() * 2 - 1) * 2.5) * env * 0.6;
  }
  return fade(norm(filt(out, sr, 'hp', 300, 0.7), 0.9), sr, 0, 0.05);
}
function genGlassBreak(sr, R) {
  const out = mk(sr, 2.2);
  thump(out, sr, 0, 160, 80, 0.03, 0.5);
  burst(out, sr, R, 0, { amp: 1.0, tau: 0.012, hp: 600 });
  burst(out, sr, R, 0.002, { amp: 0.5, tau: 0.09, hp: 2500 });
  for (let k = 0, n = R.int(55, 80); k < n; k++) {
    const t = Math.pow(R.next(), 2.2) * 0.9;
    ping(out, sr, t, R.range(1800, 9500), R.range(0.008, 0.06), R.range(0.05, 0.3) * (1 - t * 0.6));
    if (R.chance(0.3)) burst(out, sr, R, t, { amp: 0.15, tau: 0.002, hp: 4000 });
  }
  for (let k = 0, n = R.int(25, 45); k < n; k++) {
    const t = 0.25 + R.next() * 1.1, a = R.range(0.04, 0.18) * (1.2 - t * 0.5);
    ping(out, sr, t, R.range(2500, 8000), R.range(0.006, 0.03), a);
    ping(out, sr, t, R.range(4000, 11000), R.range(0.004, 0.015), a * 0.6);
    burst(out, sr, R, t, { amp: a * 0.8, tau: 0.0015, hp: 3000 });
  }
  return fade(norm(filt(out, sr, 'hp', 120, 0.7), 0.9), sr, 0, 0.1);
}
function genGlassShards(sr, R) {
  const out = mk(sr, 0.8);
  grit(out, sr, R, 0, 0.12, 0.5, 3000, 2500);
  burst(out, sr, R, 0, { amp: 0.3, tau: 0.03, bp: 3500, q: 0.8 });
  for (let k = 0, n = R.int(14, 24); k < n; k++) {
    const t = Math.pow(R.next(), 1.6) * 0.55, a = R.range(0.05, 0.25);
    ping(out, sr, t, R.range(3000, 10000), R.range(0.005, 0.03), a);
    if (R.chance(0.4)) burst(out, sr, R, t, { amp: a, tau: 0.001, hp: 4000 });
  }
  return fade(norm(filt(out, sr, 'hp', 400, 0.7), 0.9), sr, 0, 0.05);
}

// ═════════════════════════════ Шаги ═════════════════════════════
function stepHit(out, sr, R, t0, amp, surf, heel) {
  if (surf === 'lino') {
    burst(out, sr, R, t0, { amp, tau: R.range(0.005, 0.009), lp: R.range(900, 1400) });
    thump(out, sr, t0, R.range(140, 170), R.range(90, 110), 0.016, amp * 0.5);
    burst(out, sr, R, t0 + 0.004, { amp: amp * 0.08, tau: 0.025, bp: 2200, q: 0.8 });
    if (heel && R.chance(0.15)) chirp(out, sr, t0 + R.range(0.02, 0.05), R.range(1800, 2500), R.range(2600, 3400), 0.01, amp * 0.05);
  } else if (surf === 'tile') {
    burst(out, sr, R, t0, { amp, tau: R.range(0.0018, 0.003), bp: R.range(2200, 3200), q: 1.3 });
    burst(out, sr, R, t0, { amp: amp * 0.5, tau: 0.006, lp: 1500 });
    ping(out, sr, t0, R.range(3300, 4600), 0.012, amp * 0.08);
    ping(out, sr, t0, R.range(1700, 2100), 0.02, amp * 0.05);
    thump(out, sr, t0, 170, 120, 0.01, amp * 0.3);
  } else if (surf === 'concrete') {
    burst(out, sr, R, t0, { amp, tau: R.range(0.006, 0.01), bp: R.range(700, 1100), q: 0.8 });
    grit(out, sr, R, t0, R.range(0.04, 0.08), amp * 0.3, 2200, 2500);
    thump(out, sr, t0, 150, 100, 0.014, amp * 0.4);
  } else {
    burst(out, sr, R, t0, { amp: amp * 0.7, tau: 0.009, lp: 800 });
    thump(out, sr, t0, 130, 90, 0.015, amp * 0.35);
    wet(out, sr, R, t0 + 0.003, R.range(0.05, 0.09), amp * 0.6, R.range(2200, 3200), R.range(1400, 2000));
    for (let k = 0, n = R.int(1, 4); k < n; k++) chirp(out, sr, t0 + R.range(0.01, 0.07), R.range(900, 1800), R.range(2200, 4200), R.range(0.004, 0.009), amp * R.range(0.05, 0.15));
  }
}
function genStep(sr, R, surf) {
  const out = mk(sr, surf === 'wet' ? 0.42 : 0.3);
  const heel = 0.003, toe = heel + R.range(0.04, 0.085), a = R.range(0.8, 1);
  stepHit(out, sr, R, heel, a, surf, true);
  stepHit(out, sr, R, toe, a * R.range(0.3, 0.6), surf, false);
  if (surf === 'wet') wet(out, sr, R, toe + R.range(0.12, 0.2), 0.04, 0.15, 3000, 2000);
  return fade(norm(filt(out, sr, 'hp', 60, 0.7), 0.9), sr, 0, 0.02);
}
function genRun(sr, R) {
  const out = mk(sr, 2.3); let t = 0.02;
  for (let k = 0; k < 7; k++) {
    const surf = R.chance(0.5) ? 'concrete' : 'lino', a = (k % 2 ? 0.85 : 1) * R.range(0.85, 1);
    stepHit(out, sr, R, t, a * 1.2, surf, true);
    stepHit(out, sr, R, t + R.range(0.025, 0.04), a * 0.4, surf, false);
    for (let j = 0; j < 3; j++) ping(out, sr, t + R.range(0.005, 0.05), R.range(4000, 7000), 0.02, 0.04);
    t += R.range(0.27, 0.31);
  }
  return fade(norm(filt(out, sr, 'hp', 60, 0.7), 0.9), sr, 0, 0.05);
}

// ═════════════════════════════ Двери ═════════════════════════════
function genDoorWood(sr, R, mode = 'both') {
  const open = mode !== 'close', close = mode !== 'open';
  const out = mk(sr, open && close ? 1.7 : open ? 1.1 : 0.6);
  let t = 0.005;
  if (open) {
    burst(out, sr, R, t, { amp: 0.25, tau: 0.002, bp: R.range(2200, 2800), q: 1.2 });
    pingsModes(out, sr, t, [[R.range(2300, 2700), 0.009, 1], [R.range(3600, 4000), 0.006, 0.6], [R.range(5100, 5600), 0.004, 0.3]], 0.12);
    t += R.range(0.05, 0.1);
    burst(out, sr, R, t, { amp: 0.45, tau: 0.003, bp: 1700, q: 1.2 });
    pingsModes(out, sr, t, [[1900, 0.012, 1], [3100, 0.007, 0.5]], 0.1);
    pingsModes(out, sr, t + 0.004, [[R.range(160, 200), 0.05, 1], [R.range(320, 370), 0.035, 0.6], [R.range(600, 700), 0.025, 0.4]], 0.18);
    if (R.chance(0.8)) creak(out, sr, R, t + R.range(0.04, 0.1), R.range(0.35, 0.75), { r0: R.range(80, 150), r1: R.range(150, 320), amp: R.range(0.35, 0.6),
      modes: [[R.range(480, 560), 0.03, 1], [R.range(1050, 1250), 0.022, 0.7], [R.range(1800, 2100), 0.018, 0.45], [R.range(2800, 3100), 0.012, 0.3]] });
    if (close) t = R.range(0.95, 1.15);
  }
  if (close) {
    const s = open ? t : 0.01;
    burst(out, sr, R, s, { amp: 0.8, tau: 0.016, lp: 650 });
    thump(out, sr, s, 115, 72, 0.045, 0.75);
    pingsModes(out, sr, s, [[R.range(170, 200), 0.08, 1], [R.range(310, 360), 0.055, 0.6], [R.range(590, 690), 0.035, 0.4], [R.range(1100, 1250), 0.02, 0.2]], 0.4);
    const tl = s + R.range(0.006, 0.014);
    burst(out, sr, R, tl, { amp: 0.4, tau: 0.002, bp: 3000, q: 1 });
    pingsModes(out, sr, tl, [[R.range(2700, 3100), 0.007, 1], [R.range(4200, 4600), 0.005, 0.5]], 0.15);
    if (R.chance(0.3)) for (let k = 0; k < 3; k++) ping(out, sr, s + 0.01 + k * 0.012, R.range(2800, 4200), 0.02, 0.03);
  }
  return fade(norm(filt(out, sr, 'hp', 50, 0.7), 0.9), sr, 0, 0.05);
}
function genDoorSteel(sr, R, mode = 'both') {
  const open = mode !== 'close', close = mode !== 'open';
  const out = mk(sr, open && close ? 2.9 : open ? 1.7 : 1.4);
  let t = 0.005;
  if (open) {
    burst(out, sr, R, t, { amp: 0.4, tau: 0.004, bp: 1200, q: 0.9 });
    pingsModes(out, sr, t, [[R.range(850, 950), 0.09, 1], [R.range(1400, 1520), 0.07, 0.7], [R.range(2250, 2400), 0.05, 0.5], [R.range(3300, 3500), 0.03, 0.3]], 0.22);
    t += R.range(0.1, 0.18);
    burst(out, sr, R, t, { amp: 0.3, tau: 0.05, bp: R.range(1300, 1800), q: 2.2, atk: 0.01 });
    pingsModes(out, sr, t + 0.07, [[R.range(700, 800), 0.06, 1], [R.range(1250, 1350), 0.05, 0.6], [2050, 0.03, 0.4]], 0.3);
    t += 0.12;
    creak(out, sr, R, t, R.range(0.5, 0.9), { r0: R.range(35, 55), r1: R.range(60, 95), amp: R.range(0.5, 0.75),
      modes: [[R.range(190, 230), 0.06, 1], [R.range(430, 500), 0.05, 0.8], [R.range(720, 800), 0.04, 0.5], [R.range(1250, 1400), 0.03, 0.35], [R.range(2000, 2300), 0.02, 0.2]] });
    if (close) t += R.range(0.9, 1.1);
  }
  if (close) {
    const s = open ? t : 0.01;
    thump(out, sr, s, 80, 52, 0.12, 1.0, { h2: 0.3 });
    burst(out, sr, R, s, { amp: 0.9, tau: 0.025, lp: 900 });
    const plate = [[R.range(130, 150), 0.4, 1], [R.range(225, 245), 0.33, 0.8], [R.range(380, 405), 0.27, 0.6], [R.range(505, 530), 0.22, 0.5],
      [R.range(790, 830), 0.16, 0.4], [R.range(1150, 1220), 0.12, 0.3], [R.range(1700, 1780), 0.09, 0.2], [R.range(2500, 2700), 0.06, 0.12]];
    const exc = new Float32Array(Math.ceil(1.2 * sr)); exc[0] = 1;
    for (let k = 0, n = R.int(3, 6); k < n; k++) exc[Math.floor((0.03 + k * R.range(0.02, 0.05)) * sr)] += R.range(0.1, 0.35) * (1 - k * 0.12);
    addAt(out, norm(modes(exc, sr, plate), 1), Math.floor(s * sr), 0.55);
    pingsModes(out, sr, s + 0.02, [[R.range(1800, 2000), 0.02, 1], [R.range(3000, 3200), 0.012, 0.5]], 0.25);
    burst(out, sr, R, s + 0.02, { amp: 0.35, tau: 0.003, bp: 2400, q: 1 });
  }
  return fade(norm(filt(out, sr, 'hp', 40, 0.7), 0.92), sr, 0, 0.08);
}
function genCellDoor(sr, R, mode = 'both') {
  const open = mode !== 'close', close = mode !== 'open';
  const out = mk(sr, open && close ? 3.3 : open ? 2.0 : 1.7);
  const bars = [];
  for (let b = 0; b < 5; b++) { const f = R.range(210, 480); bars.push([f, R.range(0.5, 0.9), 1], [f * 2.756, R.range(0.3, 0.5), 0.6], [f * 5.404, R.range(0.15, 0.3), 0.35], [f * 8.933, R.range(0.08, 0.15), 0.2]); }
  const lock = [[R.range(1900, 2200), 0.025, 1], [R.range(3300, 3600), 0.015, 0.6], [R.range(5000, 5400), 0.01, 0.3]];
  const rattle = (s, a0, nHits) => {
    const exc = new Float32Array(Math.ceil(1.6 * sr)); exc[0] = 1; let tt = 0.025, a = 0.5;
    for (let k = 0; k < nHits; k++) { exc[Math.floor(tt * sr)] += a * R.range(0.7, 1); tt += R.range(0.02, 0.06); a *= 0.62; }
    addAt(out, norm(modes(exc, sr, bars), 1), Math.floor(s * sr), a0);
  };
  let t = 0.01;
  if (open) {
    burst(out, sr, R, t, { amp: 0.15, tau: 0.04, bp: 3200, q: 2.5, atk: 0.01 });
    grit(out, sr, R, t, 0.08, 0.06, 900, 2500);
    t += R.range(0.14, 0.22);
    for (let k = 0; k < 2; k++) { pingsModes(out, sr, t, lock, 0.22); burst(out, sr, R, t, { amp: 0.3, tau: 0.002, bp: 2600, q: 1.2 }); t += R.range(0.16, 0.24); }
    pingsModes(out, sr, t, [[R.range(750, 850), 0.06, 1], [R.range(1250, 1350), 0.045, 0.7], [R.range(2000, 2200), 0.03, 0.4]], 0.45);
    burst(out, sr, R, t, { amp: 0.5, tau: 0.004, bp: 1500, q: 1 });
    t += R.range(0.1, 0.16);
    const sw = R.range(0.45, 0.8);
    creak(out, sr, R, t, sw, { r0: R.range(140, 220), r1: R.range(250, 420), amp: 0.4, modes: [[R.range(850, 950), 0.025, 1], [R.range(1600, 1800), 0.02, 0.7], [R.range(2500, 2800), 0.015, 0.4]] });
    rattle(t + sw, 0.3, R.int(2, 4)); // решётка дошла до упора
    if (close) t += sw + R.range(0.4, 0.6);
  }
  if (close) {
    const s = open ? t : 0.01;
    rattle(s, 0.75, R.int(4, 7));
    burst(out, sr, R, s, { amp: 0.8, tau: 0.006, hp: 900 });
    thump(out, sr, s, 110, 70, 0.04, 0.35);
    pingsModes(out, sr, s + R.range(0.03, 0.06), lock, 0.35);
    burst(out, sr, R, s + 0.04, { amp: 0.35, tau: 0.003, bp: 2200, q: 1 });
  }
  return fade(norm(filt(out, sr, 'hp', 60, 0.7), 0.92), sr, 0, 0.1);
}

// ═════════════════════════════ Телефон, машинка ═════════════════════════════
const bellModes = (f, tm = 1) => [[f, 0.32 * tm, 1], [f * 2.37, 0.2 * tm, 0.55], [f * 4.16, 0.12 * tm, 0.32], [f * 6.21, 0.08 * tm, 0.18]];
/** Советский звонок: молоточек 25 Гц попеременно бьёт по двум чашкам разной высоты. Каденция 1 с звонка / 4 с паузы. */
function genPhoneRing(sr, R, total = 1.7, ring = 1.0) {
  const N = Math.ceil(total * sr), exA = new Float32Array(N), exB = new Float32Array(N), clk = new Float32Array(N);
  const fA = R.range(1300, 1420), fB = fA * R.range(1.15, 1.22), rate = 25, n = Math.round(ring * rate);
  for (let k = 0; k < n; k++) {
    const ramp = Math.min(1, (k + 1) / 2.5) * (k > n - 2 ? 0.7 : 1);
    const ta = 0.004 + k / rate + R.range(-0.0005, 0.0005), tb = ta + 0.5 / rate + R.range(-0.0007, 0.0007);
    exA[Math.round(ta * sr)] += ramp * R.range(0.85, 1); exB[Math.round(tb * sr)] += ramp * R.range(0.75, 0.95);
    clk[Math.round(ta * sr)] += 1; clk[Math.round(tb * sr)] += 1;
  }
  const out = modes(exA, sr, bellModes(fA)); modes(exB, sr, bellModes(fB, 0.9), out);
  norm(out, 1);
  addAt(out, filt(clk, sr, 'hp', 3500, 0.7), 0, 0.08);
  const bz = new BQ(sr).set('lp', 700, 0.7);
  for (let i = 0, m = Math.min(N, Math.ceil((ring + 0.01) * sr)); i < m; i++) {
    const s = Math.sin(TAU * 25 * i / sr);
    out[i] += bz.p(Math.max(0, s - 0.6) * (R.next() * 0.6 + 0.4)) * 0.25;
  }
  return fade(norm(filt(out, sr, 'hp', 300, 0.7), 0.9), sr, 0, 0.05);
}
function genPhonePickup(sr, R, hang = false) {
  const out = mk(sr, 0.6), t0 = 0.01;
  burst(out, sr, R, t0, { amp: hang ? 0.9 : 0.6, tau: hang ? 0.012 : 0.007, lp: 1800 });
  pingsModes(out, sr, t0, [[R.range(380, 450), 0.03, 1], [R.range(900, 1050), 0.02, 0.6], [R.range(1700, 1950), 0.012, 0.4]], hang ? 0.5 : 0.35);
  const tk = t0 + (hang ? 0.02 : R.range(0.03, 0.06));
  pingsModes(out, sr, tk, [[R.range(3200, 3700), 0.004, 1], [5200, 0.003, 0.5]], 0.25);
  pingsModes(out, sr, tk + 0.002, bellModes(R.range(1300, 1420), 0.6), hang ? 0.12 : 0.07); // «дзынь» звонка от рычага
  if (!hang) pingsModes(out, sr, tk + R.range(0.08, 0.14), [[1600, 0.005, 1], [2600, 0.003, 0.5]], 0.12);
  return fade(norm(filt(out, sr, 'hp', 150, 0.7), 0.9), sr, 0, 0.03);
}
/** Дисковый номеронабиратель: завод с трещоткой, возврат с регулятором, 10 импульсов/с */
function genPhoneDial(sr, R) {
  const d = R.int(1, 10), wind = 0.12 + d * 0.045;
  const out = mk(sr, 0.1 + wind + 0.15 + d * 0.1 + 0.3);
  let t = 0.02;
  for (let k = 0, nr = Math.floor(wind * 38); k < nr; k++) pingsModes(out, sr, t + k / 38 + R.range(0, 0.003), [[R.range(2400, 2800), 0.003, 1], [4100, 0.002, 0.4]], 0.06);
  burst(out, sr, R, t, { amp: 0.05, tau: 0.05, hold: wind * 0.8, bp: 900, q: 0.8, atk: 0.02 });
  t += wind + R.range(0.05, 0.15);
  const ret = d * 0.1 + 0.06, fA = R.range(1300, 1420);
  burst(out, sr, R, t, { amp: 0.12, tau: 0.03, hold: ret, bp: R.range(320, 420), q: 3, atk: 0.01 });
  for (let k = 0; k < d; k++) {
    const tp = t + 0.03 + k * 0.1;
    pingsModes(out, sr, tp, [[R.range(1700, 1900), 0.004, 1], [R.range(2900, 3200), 0.003, 0.5]], 0.25);
    burst(out, sr, R, tp, { amp: 0.15, tau: 0.0015, hp: 2000 });
    pingsModes(out, sr, tp + 0.001, bellModes(fA, 0.3), 0.012);
  }
  const te = t + ret + 0.02;
  pingsModes(out, sr, te, [[R.range(500, 600), 0.02, 1], [1300, 0.01, 0.5]], 0.3);
  burst(out, sr, R, te, { amp: 0.25, tau: 0.004, lp: 2000 });
  return fade(norm(filt(out, sr, 'hp', 150, 0.7), 0.9), sr, 0, 0.03);
}
/** Телефонный тон 425 Гц (гудок/занято) */
function genTone(sr, R, busy) {
  const L = busy ? Math.round(0.7 * sr) : sr, out = new Float32Array(L);
  for (let i = 0; i < L; i++) { const t = i / sr; if (busy && t >= 0.35) break; out[i] = Math.sin(TAU * 425 * t) + 0.08 * Math.sin(TAU * 850 * t); }
  if (busy) fade(out.subarray(0, Math.round(0.35 * sr)), sr, 0.003, 0.003);
  return norm(saturate(out, 1.3), 0.7);
}
function genTwKey(sr, R, kind) {
  const out = mk(sr, kind === 'return' ? 0.9 : kind === 'bell' ? 0.9 : 0.16);
  if (kind === 'char') {
    burst(out, sr, R, 0, { amp: 0.06, tau: 0.004, bp: 1800, q: 0.7 });
    const ts = R.range(0.006, 0.012);
    burst(out, sr, R, ts, { amp: 1, tau: R.range(0.0012, 0.002), hp: R.range(2000, 3000) });
    burst(out, sr, R, ts, { amp: 0.6, tau: 0.004, bp: R.range(1200, 1700), q: 1 });
    pingsModes(out, sr, ts, [[R.range(190, 240), 0.025, 1], [R.range(430, 520), 0.02, 0.7], [R.range(1050, 1250), 0.012, 0.5], [R.range(2600, 3000), 0.006, 0.3]], 0.35);
    pingsModes(out, sr, ts + R.range(0.018, 0.026), [[R.range(3800, 4600), 0.004, 1], [R.range(6000, 7000), 0.003, 0.5]], 0.18);
    burst(out, sr, R, ts + R.range(0.05, 0.075), { amp: 0.18, tau: 0.003, bp: 1400, q: 1 });
  } else if (kind === 'space') {
    burst(out, sr, R, 0, { amp: 0.5, tau: 0.008, lp: 900 });
    pingsModes(out, sr, 0, [[R.range(150, 190), 0.03, 1], [R.range(380, 440), 0.02, 0.6]], 0.3);
    pingsModes(out, sr, 0.02, [[R.range(3800, 4600), 0.004, 1], [6500, 0.003, 0.5]], 0.15);
  } else if (kind === 'bell') {
    pingsModes(out, sr, 0.005, [[R.range(2350, 2550), 0.35, 1], [R.range(5600, 6000), 0.18, 0.4], [R.range(8200, 8800), 0.08, 0.2]], 0.5);
    burst(out, sr, R, 0.005, { amp: 0.1, tau: 0.001, hp: 4000 });
  } else {
    pingsModes(out, sr, 0, [[R.range(900, 1100), 0.02, 1], [R.range(2000, 2300), 0.012, 0.5]], 0.3);
    for (let k = 0; k < 2; k++) pingsModes(out, sr, 0.04 + k * 0.035, [[R.range(2600, 3000), 0.006, 1], [4500, 0.004, 0.5]], 0.25);
    const slide = R.range(0.3, 0.45);
    burst(out, sr, R, 0.06, { amp: 0.18, tau: 0.05, hold: slide * 0.7, bp: R.range(700, 1000), q: 0.8, atk: 0.03 });
    for (let t = 0.07; t < 0.06 + slide; t += R.range(0.012, 0.02)) ping(out, sr, t, R.range(3500, 4500), 0.003, 0.04);
    const te = 0.06 + slide;
    thump(out, sr, te, 160, 100, 0.03, 0.6);
    pingsModes(out, sr, te, [[R.range(180, 220), 0.05, 1], [R.range(400, 460), 0.03, 0.6], [R.range(900, 1000), 0.02, 0.4]], 0.5);
    burst(out, sr, R, te, { amp: 0.5, tau: 0.004, bp: 1500, q: 0.8 });
  }
  return fade(norm(filt(out, sr, 'hp', 80, 0.7), 0.9), sr, 0, 0.02);
}
function genTypewriter(sr, R) {
  const out = mk(sr, 4.4); let t = 0.05;
  const add = (kind, at, a) => addAt(out, genTwKey(sr, R, kind), Math.floor(at * sr), a);
  while (t < 2.9) {
    for (let c = 0, wl = R.int(2, 9); c < wl && t < 2.9; c++) { add('char', t, R.range(0.75, 1)); t += R.range(0.07, 0.17) * (R.chance(0.1) ? 2 : 1); }
    add('space', t, 0.7); t += R.range(0.1, 0.22);
    if (R.chance(0.08)) t += R.range(0.3, 0.6);
  }
  add('bell', t, 0.5);
  for (let c = 0; c < 3; c++) { add('char', t, 0.9); t += R.range(0.08, 0.15); }
  add('return', t + 0.15, 1);
  return norm(out, 0.9);
}

// ═════════════════════════════ Рация ═════════════════════════════
function genRadioOpen(sr, R) {
  const out = mk(sr, 0.22);
  pingsModes(out, sr, 0.002, [[R.range(1100, 1400), 0.004, 1], [R.range(2500, 3000), 0.003, 0.5]], 0.6); // тангента
  burst(out, sr, R, 0.002, { amp: 0.6, tau: 0.002, hp: 1500 });
  burst(out, sr, R, 0.012, { amp: 0.35, tau: 0.04, hold: 0.06, bp: 1800, q: 0.5, atk: 0.02 });
  return fade(norm(saturate(norm(out, 1), 1.8), 0.85), sr, 0, 0.03);
}
function genSquelch(sr, R) {
  const out = mk(sr, 0.4), d = R.range(0.16, 0.26), b = new BQ(sr).set('bp', R.range(1500, 2100), 0.55);
  pingsModes(out, sr, 0.001, [[R.range(1000, 1300), 0.004, 1]], 0.4);
  for (let i = 0, n = Math.ceil(d * sr); i < n; i++) {
    const t = i / sr, e = Math.min(1, t / 0.004) * (0.75 + 0.25 * Math.sin(TAU * 17 * t)) * (t > d - 0.004 ? (d - t) / 0.004 : 1);
    out[i + 40] += b.p(R.next() * 2 - 1) * e * 3;
  }
  pingsModes(out, sr, d + 0.004, [[R.range(900, 1200), 0.003, 1], [2400, 0.002, 0.4]], 0.5);
  return fade(norm(saturate(norm(out, 1), 2), 0.85), sr, 0, 0.01);
}
function genStatic(sr, R) {
  const D = R.range(0.9, 1.4), out = mk(sr, D), b = new BQ(sr).set('bp', 1500, 0.5);
  let g = 1, gT = 1, cnt = 0, ph = 0;
  const hf0 = R.range(600, 1100), hf1 = R.range(900, 1600), het = R.chance(0.6);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    if (--cnt <= 0) { cnt = sr * R.range(0.02, 0.08); gT = R.range(0.3, 1.1); }
    g += (gT - g) * 0.004;
    let y = b.p(R.next() * 2 - 1) * g * 2.5;
    if (R.next() < 0.002) y += (R.next() * 2 - 1) * 2;
    if (het) { ph += TAU * (hf0 + (hf1 - hf0) * t / D) / sr; y += Math.sin(ph) * 0.12; }
    out[i] = y;
  }
  return fade(norm(saturate(norm(filt(out, sr, 'hp', 300, 0.7), 1), 2.2), 0.8), sr, 0.02, 0.06);
}
/** Тревожный вызов эфира: двухтональный сигнал + треск */
function genRadioAlarm(sr, R) {
  const out = mk(sr, 1.7), f1 = 1100, f2 = 1450;
  for (let k = 0; k < 8; k++) {
    const t0 = 0.05 + k * 0.17, f = k % 2 ? f2 : f1, i0 = Math.floor(t0 * sr);
    for (let i = 0, n = Math.floor(0.15 * sr); i < n; i++) { const t = i / sr, e = Math.min(1, t / 0.004, (0.15 - t) / 0.004); out[i0 + i] += (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 3 * f * t)) * e * 0.5; }
  }
  burst(out, sr, R, 0, { amp: 0.15, tau: 0.3, hold: 1.2, bp: 1800, q: 0.5 });
  return fade(norm(saturate(norm(filt(out, sr, 'hp', 300, 0.7), 1), 2), 0.85), sr, 0.005, 0.05);
}

// ═════════════════════════════ Быт участка ═════════════════════════════
/** Чайник со свистком на плитке: гул нагрева → пузыри → свисток → сняли с огня */
function genKettle(sr, R, loopMode = false) {
  const D = loopMode ? 4.6 : 9.0, out = mk(sr, D);
  const lp = new BQ(sr).set('lp', 260, 0.7), bp = new BQ(sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr, heat = loopMode ? 1 : Math.min(1, t / 5.5);
    if ((i & 31) === 0) bp.set('bp', 500 + 700 * heat + 120 * Math.sin(t * 1.7), 2.2);
    const w = R.next() * 2 - 1;
    const off = !loopMode && t > 8.2 ? Math.max(0, 1 - (t - 8.2) / 0.8) : 1;
    out[i] = (lp.p(w) * (0.15 + 0.6 * heat * heat) * 4 + bp.p(w) * (0.05 + 0.5 * heat * heat * heat) * 3) * off;
  }
  if (!loopMode) for (let k = 0, n = R.int(4, 8); k < n; k++) ping(out, sr, R.range(0.2, 3), R.range(2500, 4500), 0.006, 0.08);
  let t = loopMode ? 0 : 2.5; const tEnd = loopMode ? D : 8.3;
  while (t < tEnd) {
    const dens = loopMode ? 55 : 5 + 60 * Math.min(1, (t - 2.5) / 3);
    chirp(out, sr, t, R.range(250, 600), R.range(700, 1600), R.range(0.005, 0.012), R.range(0.05, 0.15));
    t += -Math.log(1 - R.next() * 0.999) / dens;
  }
  const ws = loopMode ? 0 : R.range(5.4, 6.0), we = loopMode ? D + 1 : 8.2, fw = R.range(1900, 2400), wbp = new BQ(sr).set('bp', fw, 12);
  let ph = 0;
  for (let i = Math.floor(ws * sr); i < out.length; i++) {
    const ta = i / sr, tt = ta - ws;
    let f = fw * (loopMode ? 1 : 0.82 + 0.18 * (1 - Math.exp(-tt / 0.35))) * (1 + 0.006 * Math.sin(TAU * 5.5 * tt));
    if (ta > we) f *= 1 - 0.25 * (ta - we);
    ph += TAU * f / sr;
    let a = (loopMode ? 0.6 : Math.min(1, tt / 0.6)) * (0.85 + 0.15 * Math.sin(TAU * 3.1 * tt + 1));
    if (ta > we) a *= Math.max(0, 1 - (ta - we) / 0.6);
    out[i] += (Math.sin(ph) * 0.35 + wbp.p(R.next() * 2 - 1) * 3) * a * 0.5;
  }
  filt(out, sr, 'hp', 60, 0.7);
  return loopMode ? norm(loopify(out, Math.floor((D - 0.6) * sr)), 0.85) : fade(norm(out, 0.9), sr, 0.2, 0.2);
}
function genSpoonGlass(sr, R) {
  const out = mk(sr, 1.5); let t = 0.02;
  for (let k = 0, n = R.int(3, 6); k < n; k++) {
    const a = R.range(0.4, 1);
    pingsModes(out, sr, t, [[R.range(2400, 2700), 0.18, 1], [R.range(5900, 6400), 0.09, 0.5], [R.range(8800, 9400), 0.05, 0.25]], a * 0.4); // стакан
    pingsModes(out, sr, t, [[R.range(1700, 1900), 0.12, 1], [R.range(3900, 4200), 0.06, 0.4]], a * 0.15); // подстаканник
    t += R.range(0.15, 0.28);
  }
  sweepNoise(out, sr, R, 0, t, 800, 1400, 1, 0.04);
  return fade(norm(filt(out, sr, 'hp', 500, 0.7), 0.85), sr, 0, 0.1);
}
function genMatch(sr, R) {
  const out = mk(sr, 1.0);
  grit(out, sr, R, 0.01, 0.12, 0.35, 2500, 2000);
  burst(out, sr, R, 0.01, { amp: 0.35, tau: 0.03, hold: 0.06, bp: 3000, q: 0.8, atk: 0.01 });
  burst(out, sr, R, 0.1, { amp: 0.6, tau: 0.25, lp: 2500, atk: 0.015 }); // вспышка серы
  grit(out, sr, R, 0.1, 0.5, 0.15, 300, 2500);
  return fade(norm(filt(out, sr, 'hp', 200, 0.7), 0.85), sr, 0, 0.1);
}
function genKeys(sr, R) {
  const out = mk(sr, 0.8);
  for (let k = 0, n = R.int(8, 14); k < n; k++) { const t = R.next() * 0.45; ping(out, sr, t, R.range(2500, 7000), R.range(0.03, 0.08), R.range(0.1, 0.35)); burst(out, sr, R, t, { amp: 0.1, tau: 0.001, hp: 3000 }); }
  return fade(norm(filt(out, sr, 'hp', 1200, 0.7), 0.85), sr, 0, 0.08);
}
function genCuffs(sr, R) {
  const out = mk(sr, 0.7); let t = 0.02;
  pingsModes(out, sr, t, [[R.range(1900, 2200), 0.05, 1], [R.range(3300, 3700), 0.03, 0.5]], 0.4);
  t += 0.05;
  for (let k = 0, n = R.int(6, 10); k < n; k++) { pingsModes(out, sr, t, [[R.range(3500, 4500), 0.004, 1], [R.range(6000, 7000), 0.003, 0.5]], 0.35); t += R.range(0.015, 0.025); }
  for (let k = 0; k < 4; k++) ping(out, sr, t + R.range(0, 0.2), R.range(2000, 4500), 0.03, 0.1);
  return fade(norm(filt(out, sr, 'hp', 800, 0.7), 0.85), sr, 0, 0.05);
}
function genWhistle(sr, R) {
  const bl = R.chance(0.5) ? [[0.01, R.range(0.25, 0.4)], [R.range(0.5, 0.65), R.range(0.6, 1.0)]] : [[0.01, R.range(0.8, 1.3)]];
  const last = bl[bl.length - 1], out = mk(sr, last[0] + last[1] + 0.2);
  for (const [t0, d] of bl) {
    const f = R.range(2700, 3200), tr = R.range(22, 35), b = new BQ(sr).set('bp', f, 4), i0 = Math.floor(t0 * sr);
    let ph = 0;
    for (let i = 0, n = Math.ceil(d * sr); i < n; i++) {
      const t = i / sr, e = Math.min(1, t / 0.015, (d - t) / 0.04);
      ph += f * (1 + 0.035 * Math.sin(TAU * tr * t)) / sr;
      out[i0 + i] += (Math.sin(TAU * ph) + 0.15 * Math.sin(2 * TAU * ph) + b.p(R.next() * 2 - 1) * 0.9) * e * (0.7 + 0.3 * Math.sin(TAU * tr * t));
    }
  }
  return fade(norm(out, 0.85), sr, 0.002, 0.03);
}
function genLampFlicker(sr, R) {
  const out = mk(sr, 0.9); let t = 0.02;
  for (let k = 0, n = R.int(2, 4); k < n; k++) {
    const d = R.range(0.04, 0.12), i0 = Math.floor(t * sr);
    ping(out, sr, t, R.range(2800, 3400), 0.005, 0.4);
    for (let i = 0, m = Math.ceil(d * sr); i < m; i++) { const s = Math.sin(TAU * 100 * i / sr); out[i0 + i] += (Math.sign(s) * Math.pow(Math.abs(s), 0.25) * 0.4 + (R.next() * 2 - 1) * 0.1) * Math.min(1, (m - i) / 200); }
    t += d + R.range(0.05, 0.2);
  }
  return fade(norm(filt(filt(out, sr, 'hp', 250, 0.7), sr, 'lp', 4000, 0.7), 0.8), sr, 0, 0.03);
}
function genDrip(sr, R) {
  const out = mk(sr, 0.35);
  chirp(out, sr, 0.005, R.range(700, 1300), R.range(1800, 3500), R.range(0.006, 0.012), 0.8);
  burst(out, sr, R, 0.005, { amp: 0.2, tau: 0.003, bp: 2500, q: 0.8 });
  echoes(out, sr, [[0.04, 0.25, 3000], [0.09, 0.12, 2000]]);
  return norm(out, 0.8);
}
/** Кинескоп: размагничивание «бдумм», треск высокого, шум */
function genTvOn(sr, R) {
  const out = mk(sr, 1.1);
  pingsModes(out, sr, 0.005, [[R.range(1200, 1500), 0.006, 1]], 0.4);
  for (let i = Math.floor(0.02 * sr), n = Math.floor(0.8 * sr); i < n; i++) { const t = i / sr - 0.02; out[i] += (Math.sin(TAU * 50 * t) * 0.6 + Math.sin(TAU * 100 * t) * 0.5) * Math.exp(-t / 0.18) * (0.7 + 0.3 * Math.sin(TAU * 9 * t)); }
  grit(out, sr, R, 0.03, 0.3, 0.4, 600, 3000);
  burst(out, sr, R, 0.25, { amp: 0.3, tau: 0.2, hold: 0.3, hp: 600, atk: 0.05 });
  return fade(norm(filt(out, sr, 'hp', 40, 0.7), 0.85), sr, 0, 0.15);
}
function genTvOff(sr, R) {
  const out = mk(sr, 0.6);
  pingsModes(out, sr, 0.005, [[R.range(1000, 1300), 0.008, 1], [2600, 0.004, 0.5]], 0.5);
  thump(out, sr, 0.008, 90, 50, 0.05, 0.6);
  let ph = 0;
  for (let i = Math.floor(0.01 * sr), n = Math.floor(0.3 * sr); i < n; i++) { const t = i / sr - 0.01; ph += TAU * (2400 * Math.exp(-t / 0.05) + 150) / sr; out[i] += Math.sin(ph) * 0.12 * Math.exp(-t / 0.08); }
  grit(out, sr, R, 0.01, 0.15, 0.2, 800, 3000);
  return fade(norm(out, 0.8), sr, 0, 0.05);
}
function genStamp(sr, R) {
  const out = mk(sr, 0.5);
  thump(out, sr, 0.004, 115, 80, 0.04, 1);
  pingsModes(out, sr, 0.004, [[R.range(170, 200), 0.06, 1], [R.range(400, 450), 0.04, 0.6], [R.range(740, 800), 0.03, 0.4]], 0.4);
  burst(out, sr, R, 0.004, { amp: 0.5, tau: 0.006, bp: 2000, q: 0.6 });
  burst(out, sr, R, 0.006, { amp: 0.2, tau: 0.02, lp: 600 });
  return fade(norm(filt(out, sr, 'hp', 50, 0.7), 0.9), sr, 0, 0.05);
}
function genPaper(sr, R) {
  const D = R.range(0.3, 0.55), out = mk(sr, D + 0.05), b = new BQ(sr).set('bp', R.range(2800, 4200), 0.5), l = new BQ(sr).set('lp', 1200, 0.7);
  let g = 0, gT = 0, cnt = 0;
  for (let i = 0, n = Math.ceil(D * sr); i < n; i++) {
    const x = i / n, env = Math.pow(Math.sin(Math.PI * Math.pow(x, 0.7)), 1.2);
    if (--cnt <= 0) { cnt = sr * R.range(0.002, 0.007); gT = R.chance(0.3) ? R.range(0.6, 1) : R.range(0.05, 0.3); }
    g += (gT - g) * 0.3;
    const w = R.next() * 2 - 1;
    out[i] = (b.p(w) * 3 * g + l.p(w) * 1.2) * env;
  }
  return fade(norm(out, 0.8), sr, 0.005, 0.03);
}
function genUiClick(sr, R) {
  const out = mk(sr, 0.08);
  burst(out, sr, R, 0, { amp: 1, tau: 0.0012, bp: R.range(2800, 3300), q: 1 });
  ping(out, sr, 0, R.range(1400, 1600), 0.006, 0.25);
  ping(out, sr, 0, 420, 0.01, 0.12);
  return fade(norm(out, 0.7), sr, 0, 0.01);
}

// ═════════════════════════════ Тела, удары, оружие в руках ═════════════════════════════
function genHitFlesh(sr, R) {
  const out = mk(sr, 0.4);
  thump(out, sr, 0, R.range(130, 170), R.range(55, 70), 0.03, 1, { h2: 0.2 });
  burst(out, sr, R, 0, { amp: 0.8, tau: 0.01, bp: R.range(700, 1100), q: 0.8 });
  wet(out, sr, R, 0.004, 0.07, 0.45, 1800, 400, 0.8);
  burst(out, sr, R, 0, { amp: 0.12, tau: 0.02, hp: 3500 });
  return fade(norm(filt(out, sr, 'hp', 50, 0.7), 0.9), sr, 0, 0.03);
}
function genBodyFall(sr, R) {
  const out = mk(sr, 1.4);
  burst(out, sr, R, 0, { amp: 0.12, tau: 0.06, bp: 2500, q: 0.7, atk: 0.04 });
  const t1 = R.range(0.07, 0.12);
  thump(out, sr, t1, 100, 62, 0.05, 0.55); burst(out, sr, R, t1, { amp: 0.5, tau: 0.02, lp: 700 });
  const t2 = t1 + R.range(0.16, 0.3);
  thump(out, sr, t2, 85, 45, 0.09, 1, { h2: 0.3 }); burst(out, sr, R, t2, { amp: 0.9, tau: 0.035, lp: 550 }); burst(out, sr, R, t2, { amp: 0.25, tau: 0.012, bp: 1500, q: 0.8 });
  for (let k = 0, n = R.int(3, 6); k < n; k++) pingsModes(out, sr, t2 + R.range(0.005, 0.12), [[R.range(2000, 4500), 0.012, 1], [R.range(5000, 7000), 0.006, 0.5]], R.range(0.04, 0.1));
  if (R.chance(0.5)) { const tw = t2 + R.range(0.04, 0.1); pingsModes(out, sr, tw, [[R.range(950, 1150), 0.05, 1], [R.range(1800, 2050), 0.035, 0.6], [R.range(3000, 3300), 0.02, 0.4]], 0.22); burst(out, sr, R, tw, { amp: 0.3, tau: 0.004, bp: 1500, q: 1 }); }
  const t3 = t2 + R.range(0.18, 0.35); thump(out, sr, t3, 110, 70, 0.03, 0.25); burst(out, sr, R, t3, { amp: 0.25, tau: 0.015, lp: 800 });
  burst(out, sr, R, t2 + 0.05, { amp: 0.08, tau: 0.15, bp: 2000, q: 0.6, atk: 0.02 });
  return fade(norm(filt(out, sr, 'hp', 35, 0.7), 0.9), sr, 0, 0.1);
}
function genPunch(sr, R) {
  const out = mk(sr, 0.45);
  sweepNoise(out, sr, R, 0, 0.07, 400, 1800, 1.2, 0.12);
  const t = R.range(0.06, 0.08);
  burst(out, sr, R, t, { amp: 0.9, tau: 0.004, bp: R.range(1500, 2500), q: 0.7 });
  thump(out, sr, t, R.range(150, 180), 80, 0.03, 1);
  burst(out, sr, R, t, { amp: 0.6, tau: 0.014, lp: 900 });
  burst(out, sr, R, t + 0.002, { amp: 0.15, tau: 0.02, hp: 3000 });
  return fade(norm(filt(out, sr, 'hp', 50, 0.7), 0.9), sr, 0, 0.03);
}
function genReload(sr, R, kind) {
  const P = (t, list, a) => pingsModes(out, sr, t, list.map(([f, tau, w]) => [f * R.range(0.95, 1.05), tau, w ?? 1]), a);
  const out = mk(sr, kind === 'ak' ? 1.8 : kind === 'ks23' ? 2.0 : 1.4);
  if (kind === 'pm') {
    P(0.02, [[3000, 0.005], [4600, 0.004, 0.6]], 0.25); burst(out, sr, R, 0.02, { amp: 0.3, tau: 0.002, bp: 2800, q: 1 });
    burst(out, sr, R, 0.06, { amp: 0.15, tau: 0.02, hold: 0.04, bp: 2400, q: 2, atk: 0.005 });
    const ti = R.range(0.45, 0.6);
    burst(out, sr, R, ti, { amp: 0.6, tau: 0.005, bp: 1300, q: 1 }); P(ti, [[1500, 0.02], [2500, 0.015, 0.7], [3800, 0.01, 0.5]], 0.4); P(ti + 0.02, [[3400, 0.004]], 0.3);
    const ts = ti + R.range(0.3, 0.42);
    burst(out, sr, R, ts, { amp: 0.25, tau: 0.02, hold: 0.03, bp: 3000, q: 1.5, atk: 0.005 }); P(ts + 0.05, [[2800, 0.006], [4300, 0.004, 0.6]], 0.3);
    const tf = ts + R.range(0.1, 0.16);
    P(tf, [[1300, 0.03], [2100, 0.022, 0.7], [3400, 0.015, 0.5], [5200, 0.01, 0.3]], 0.7); burst(out, sr, R, tf, { amp: 0.6, tau: 0.004, bp: 1800, q: 1 });
  } else if (kind === 'ak') {
    P(0.02, [[2600, 0.006]], 0.25);
    P(0.08, [[900, 0.03], [1600, 0.02, 0.7], [2700, 0.015, 0.5]], 0.4); burst(out, sr, R, 0.08, { amp: 0.2, tau: 0.03, bp: 1800, q: 1.5 });
    const ti = R.range(0.6, 0.75);
    P(ti, [[2400, 0.006]], 0.2);
    P(ti + 0.1, [[800, 0.04], [1400, 0.03, 0.8], [2300, 0.02, 0.5], [3600, 0.012, 0.3]], 0.7); burst(out, sr, R, ti + 0.1, { amp: 0.7, tau: 0.006, bp: 1200, q: 1 });
    const tc = ti + R.range(0.45, 0.6);
    burst(out, sr, R, tc, { amp: 0.25, tau: 0.03, hold: 0.05, bp: 2200, q: 1.5, atk: 0.005 }); P(tc + 0.07, [[2400, 0.008]], 0.3);
    const tf = tc + R.range(0.12, 0.18);
    P(tf, [[1000, 0.04], [1700, 0.03, 0.8], [2800, 0.02, 0.5], [4200, 0.012, 0.3]], 0.8); burst(out, sr, R, tf, { amp: 0.8, tau: 0.005, bp: 1500, q: 1 });
    ping(out, sr, tf, R.range(2900, 3300), 0.06, 0.06);
  } else {
    let t = 0.05;
    for (let k = 0; k < 2; k++) {
      burst(out, sr, R, t, { amp: 0.3, tau: 0.01, lp: 1800 }); P(t + 0.03, [[2200, 0.01], [3500, 0.006, 0.6]], 0.3); P(t + 0.03, [[600, 0.02], [1200, 0.012, 0.6]], 0.25);
      t += R.range(0.35, 0.45);
    }
    t += 0.2;
    burst(out, sr, R, t, { amp: 0.35, tau: 0.03, hold: 0.08, bp: 1500, q: 1.5, atk: 0.005 }); P(t + 0.12, [[700, 0.04], [1250, 0.03, 0.8], [2100, 0.02, 0.5]], 0.6); burst(out, sr, R, t + 0.12, { amp: 0.6, tau: 0.005, bp: 1100, q: 1 });
    t += R.range(0.28, 0.35);
    burst(out, sr, R, t, { amp: 0.35, tau: 0.03, hold: 0.07, bp: 1700, q: 1.5, atk: 0.005 }); P(t + 0.1, [[750, 0.045], [1300, 0.035, 0.8], [2200, 0.02, 0.5]], 0.75); burst(out, sr, R, t + 0.1, { amp: 0.7, tau: 0.005, bp: 1200, q: 1 });
  }
  return fade(norm(filt(out, sr, 'hp', 150, 0.7), 0.85), sr, 0, 0.05);
}
function genEmptyClick(sr, R) {
  const out = mk(sr, 0.15);
  pingsModes(out, sr, 0.002, [[R.range(2600, 3000), 0.004, 1], [R.range(4400, 4900), 0.003, 0.6]], 0.6);
  burst(out, sr, R, 0.002, { amp: 0.4, tau: 0.001, hp: 3000 });
  ping(out, sr, 0.002, 600, 0.006, 0.15);
  return fade(norm(out, 0.8), sr, 0, 0.01);
}
function genCasingSolo(sr, R) { const out = mk(sr, 0.5); casing(out, sr, R, 0.01, 1, R.chance(0.4)); return fade(norm(out, 0.8), sr, 0, 0.03); }
function genHeartbeat(sr, R) {
  const out = mk(sr, 0.8);
  thump(out, sr, 0.01, 65, 42, 0.06, 1, { h2: 0.35 }); thump(out, sr, 0.29, 60, 40, 0.07, 0.7, { h2: 0.35 });
  return fade(norm(saturate(norm(filt(out, sr, 'lp', 250, 0.7), 1), 1.6), 0.85), sr, 0, 0.05);
}
function genTinnitus(sr, R) {
  const out = mk(sr, 3), f = R.range(3900, 4500);
  for (let i = 0; i < out.length; i++) { const t = i / sr; out[i] = (Math.sin(TAU * f * t) + 0.2 * Math.sin(TAU * f * 1.51 * t)) * Math.min(1, t / 0.05) * Math.exp(-t / 0.9); }
  return norm(out, 0.6);
}

// ═════════════════════════════ Голосовой тракт (формантный синтез) ═════════════════════════════
const VOW = { a: [760, 1280, 2550], o: [540, 900, 2450], u: [340, 760, 2300], e: [500, 1780, 2550], i: [290, 2250, 2950], y: [340, 1500, 2350] };
const VW = [['a', 5], ['o', 3], ['e', 3], ['i', 3], ['u', 1], ['y', 1]];
const CONS = [['', 4], ['t', 8], ['k', 5], ['p', 4], ['d', 4], ['b', 2], ['g', 2], ['s', 7], ['sh', 2], ['f', 1], ['h', 1], ['v', 5], ['z', 2], ['zh', 1], ['m', 5], ['n', 8], ['l', 6], ['r', 6], ['ch', 2], ['ts', 1]];
const SYLN = [{ n: 1, w: 2 }, { n: 2, w: 4 }, { n: 3, w: 4 }, { n: 4, w: 1.5 }];
function consSegs(c, R, rt) {
  const d = (x) => x / rt;
  switch (c) {
    case 't': case 'k': case 'p': return [{ d: d(R.range(0.035, 0.055)) }, { d: d(0.012), nz: 0.9, nf: c === 't' ? 4200 : c === 'k' ? 2200 : 900, nq: c === 'p' ? 0.8 : 1.3 }, { d: d(0.018), nz: 0.3, nf: 1600, nq: 0.6, voi: 0.15 }];
    case 'd': case 'b': case 'g': return [{ d: d(0.03), voi: 0.22, F: [250, 700, 2200] }, { d: d(0.01), voi: 0.4, nz: 0.4, nf: c === 'd' ? 3500 : c === 'g' ? 1900 : 800, nq: 1 }];
    case 's': return [{ d: d(R.range(0.07, 0.1)), nz: 0.55, nf: 6000, nq: 2.2 }];
    case 'sh': return [{ d: d(0.085), nz: 0.65, nf: 2700, nq: 1.8 }];
    case 'f': return [{ d: d(0.07), nz: 0.2, nf: 4000, nq: 0.8 }];
    case 'h': return [{ d: d(0.06), nz: 0.3, nf: 1500, nq: 0.6, asp: 1 }];
    case 'z': return [{ d: d(0.07), voi: 0.4, nz: 0.35, nf: 5500, nq: 2, F: [250, 1600, 2600] }];
    case 'zh': return [{ d: d(0.075), voi: 0.4, nz: 0.35, nf: 2600, nq: 1.8, F: [280, 1700, 2500] }];
    case 'v': return [{ d: d(0.05), voi: 0.55, nz: 0.08, nf: 3000, nq: 0.8, F: [300, 1100, 2300] }];
    case 'ch': return [{ d: d(0.03) }, { d: d(0.06), nz: 0.65, nf: 3200, nq: 1.6 }];
    case 'ts': return [{ d: d(0.03) }, { d: d(0.06), nz: 0.6, nf: 5800, nq: 2 }];
    case 'm': return [{ d: d(0.06), voi: 0.5, F: [260, 1000, 2200] }];
    case 'n': return [{ d: d(0.055), voi: 0.5, F: [260, 1500, 2500] }];
    case 'l': return [{ d: d(0.05), voi: 0.72, F: [360, 1050, 2500] }];
    case 'r': return [{ d: d(0.055), voi: 0.68, F: [420, 1300, 2500], tr: 1 }];
    default: return [];
  }
}
/** Речеподобное бормотание без слов: слоги CV(C), ударения, деклинация тона, вопросительные подъёмы */
function genSpeech(sr, R, o = {}) {
  const fem = !!o.female, fs = fem ? 1.17 : 1;
  const base = o.f0 || (fem ? R.range(185, 230) : R.range(98, 135));
  const rt = (o.rate || 1) * R.range(0.92, 1.08), target = o.dur || R.range(1.2, 3.0);
  const segs = [{ d: 0.04 }]; let T = 0.04;
  const push = (s) => { segs.push(s); T += s.d; };
  while (T < target) {
    const ns = R.weighted(SYLN).n, st = R.int(0, ns - 1);
    for (let k = 0; k < ns; k++) {
      for (const s of consSegs(R.weighted(CONS, (x) => x[1])[0], R, rt)) push(s);
      const v = R.weighted(VW, (x) => x[1])[0], stressed = k === st;
      push({ d: (stressed ? R.range(0.11, 0.17) : R.range(0.055, 0.095)) / rt, voi: stressed ? 1 : 0.72, F: VOW[v].map((f) => f * fs * R.range(0.96, 1.04)), acc: stressed ? 1 : 0 });
      if (R.chance(0.12)) for (const s of consSegs(R.pick(['n', 't', 's', 'm', 'l', 'r', 'k']), R, rt)) push(s);
    }
    if (R.chance(0.3)) push({ d: R.range(0.03, 0.08) / rt });
    if (T > target * 0.4 && R.chance(0.08)) push({ d: R.range(0.15, 0.28) });
  }
  push({ d: 0.07 });
  const question = R.chance(0.12), N = Math.ceil(T * sr), out = new Float32Array(N);
  const k1 = new KR(sr), k2 = new KR(sr), k3 = new KR(sr), nb = new BQ(sr), bw = fem ? 1.2 : 1;
  let F1 = 500 * fs, F2 = 1500 * fs, F3 = 2500 * fs, voi = 0, nz = 0, acc = 0, ph = 0, f0 = base, jit = 0, si = 0, segEnd = segs[0].d, nfKey = -1;
  const aF = 1 - Math.exp(-16 / (0.016 * sr)), aA = 1 - Math.exp(-1 / (0.005 * sr)), aAcc = 1 - Math.exp(-16 / (0.08 * sr));
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    while (t >= segEnd && si < segs.length - 1) { si++; segEnd += segs[si].d; }
    const s = segs[si];
    if ((i & 15) === 0) {
      if (s.F) { F1 += (s.F[0] - F1) * aF; F2 += (s.F[1] - F2) * aF; F3 += (s.F[2] - F3) * aF; }
      k1.set(F1, 75 * bw); k2.set(F2, 100 * bw); k3.set(F3, 150 * bw);
      if (s.nz) { const key = s.nf * 10 + s.nq; if (key !== nfKey) { nb.set('bp', s.nf, s.nq); nfKey = key; } }
      acc += ((s.acc || 0) - acc) * aAcc;
      jit += (R.next() * 2 - 1) * 0.006 - jit * 0.08;
      const x = t / T;
      f0 = base * (1.12 - 0.24 * x) * (1 + 0.16 * acc) * (1 + jit) * (question && x > 0.8 ? 1 + (x - 0.8) * 1.6 : 1);
    }
    const sv = (s.voi || 0) * (s.tr ? 0.55 + 0.45 * Math.sin(TAU * 27 * t) : 1);
    voi += (sv - voi) * aA; nz += ((s.nz || 0) - nz) * aA;
    const dt = f0 / sr; ph += dt; if (ph >= 1) ph -= 1;
    const w = R.next() * 2 - 1;
    const src = (2 * ph - 1 - blep(ph, dt)) * voi + w * (voi * 0.05 + (s.asp ? nz * 0.5 : 0));
    out[i] = k3.p(k2.p(k1.p(src))) * 0.12 + nb.p(w) * nz * 0.9;
  }
  return fade(norm(filt(out, sr, 'hp', 90, 0.7), 0.9), sr, 0.008, 0.02);
}
/** Крик: высокий тон с шероховатостью (субгармоника), дыхание, форманты «а» */
function genScream(sr, R, female) {
  const kind = R.pick(['pain', 'terror', 'cry']);
  const D = kind === 'pain' ? R.range(0.6, 0.9) : kind === 'terror' ? R.range(1.3, 1.8) : R.range(1.0, 1.5);
  const out = mk(sr, D + 0.1), base = female ? R.range(480, 650) : R.range(230, 330);
  const peak = kind === 'terror' ? R.range(1.5, 1.8) : R.range(1.25, 1.5), fm = female ? 1.18 : 1;
  const k1 = new KR(sr), k2 = new KR(sr), k3 = new KR(sr), k4 = new KR(sr);
  const vib = R.range(5, 7), rough = R.range(0.2, 0.4);
  let ph = 0, jit = 0, f0 = base;
  for (let i = 0, n = Math.ceil(D * sr); i < n; i++) {
    const t = i / sr, x = t / D;
    if ((i & 15) === 0) {
      let c;
      if (kind === 'pain') c = x < 0.1 ? x / 0.1 : 1 - 0.6 * (x - 0.1) / 0.9;
      else if (kind === 'terror') c = x < 0.4 ? x / 0.4 : x < 0.85 ? 1 : 1 - 2.5 * (x - 0.85);
      else c = 0.6 + 0.4 * Math.sin(Math.PI * x) - 0.25 * Math.max(0, Math.sin(TAU * 2.5 * t));
      jit += (R.next() * 2 - 1) * 0.004 - jit * 0.05;
      f0 = base * (1 + (peak - 1) * clamp01(c)) * (1 + jit) * (1 + 0.025 * Math.sin(TAU * vib * t));
      k1.set((kind === 'cry' ? 850 : 950) * fm * (1 - 0.1 * x), 140); k2.set(1450 * fm, 170); k3.set(2750 * fm, 260); k4.set(3700 * fm, 320);
    }
    const dt = f0 / sr; ph += dt; if (ph >= 1) ph -= 1;
    const src = (2 * ph - 1 - blep(ph, dt)) * (1 + rough * Math.sin(TAU * f0 * 0.5 * t)) + (R.next() * 2 - 1) * 0.15;
    let env = x < 0.05 ? x / 0.05 : x > 0.8 ? (1 - x) / 0.2 : 1;
    if (kind === 'cry') env *= 0.65 + 0.35 * Math.abs(Math.sin(TAU * 2.5 * t + 0.5));
    out[i] = k4.p(k3.p(k2.p(k1.p(src)))) * env;
  }
  filt(out, sr, 'hp', 150, 0.7);
  return fade(norm(saturate(norm(out, 1), 2.2), 0.9), sr, 0.005, 0.05);
}
function genBark(sr, R, f0, big) {
  const d = R.range(0.1, 0.17) * (big ? 1.2 : 1), out = mk(sr, d + 0.02);
  const k1 = new KR(sr), k2 = new KR(sr), k3 = new KR(sr), nb = new BQ(sr).set('bp', 1200, 0.8);
  k1.set(big ? 700 : 850, 120); k2.set(big ? 1300 : 1600, 180); k3.set(2600, 300);
  let ph = 0;
  for (let k = 0, n = Math.ceil(d * sr); k < n; k++) {
    const t = k / sr, x = t / d, f = f0 * (x < 0.2 ? 1 + 0.25 * x / 0.2 : 1.25 - 0.45 * (x - 0.2) / 0.8);
    ph += f / sr; ph -= Math.floor(ph);
    const env = x < 0.08 ? x / 0.08 : Math.pow(1 - (x - 0.08) / 0.92, 1.5);
    out[k] = (k3.p(k2.p(k1.p((2 * ph - 1) * (1 + 0.35 * Math.sin(TAU * f * 0.5 * t))))) * 0.15 + nb.p(R.next() * 2 - 1) * 0.5) * env;
  }
  return norm(out, 1);
}
function genDogFar(sr, R) {
  const out = mk(sr, 5.5);
  const dog = (t, f0, amp, n) => { const big = f0 < 420; for (let k = 0; k < n; k++) { addAt(out, genBark(sr, R, f0 * R.range(0.95, 1.05), big), Math.floor(t * sr), amp * R.range(0.75, 1)); t += R.range(0.22, 0.5); } return t; };
  let t = dog(0.05, R.range(330, 560), 1, R.int(2, 5));
  if (R.chance(0.5)) dog(t + R.range(0.8, 1.6), R.range(330, 560), 0.9, R.int(1, 3));
  if (R.chance(0.4)) dog(R.range(1.5, 3), R.range(300, 600), 0.4, R.int(2, 4));
  filt(out, sr, 'lp', 1700, 0.7); filt(out, sr, 'hp', 200, 0.7);
  echoes(out, sr, [[0.14, 0.3, 1000], [0.33, 0.15, 800]]);
  return fade(norm(out, 0.85), sr, 0, 0.3);
}
function genCrowFar(sr, R) {
  const out = mk(sr, 3);
  let t = 0.05;
  for (let c = 0, n = R.int(2, 4); c < n; c++) {
    const d = R.range(0.25, 0.35), f0 = R.range(450, 600), i0 = Math.floor(t * sr);
    const k1 = new KR(sr), k2 = new KR(sr), k3 = new KR(sr); k1.set(1000, 200); k2.set(1600, 250); k3.set(2500, 300);
    let ph = 0;
    for (let k = 0, m = Math.ceil(d * sr); k < m; k++) {
      const x = k / m; ph += f0 * (1 - 0.2 * x) / sr; ph -= Math.floor(ph);
      const env = Math.min(1, x / 0.1) * Math.pow(1 - x, 0.8);
      out[i0 + k] += k3.p(k2.p(k1.p((2 * ph - 1) * (0.5 + R.next())))) * env * 0.2;
    }
    t += d + R.range(0.15, 0.4);
  }
  filt(out, sr, 'lp', 3000, 0.7);
  echoes(out, sr, [[0.18, 0.25, 1500]]);
  return fade(norm(out, 0.85), sr, 0, 0.2);
}
/** Гомон толпы: 5–7 голосов вразнобой, иногда кто-то повышает голос */
function genCrowd(sr, R, D) {
  const out = mk(sr, D);
  for (let v = 0, nv = R.int(5, 7); v < nv; v++) {
    const fem = R.chance(0.4), loud = R.chance(0.2);
    let t = R.range(0, 0.8);
    while (t < D - 0.5) {
      const ph = genSpeech(sr, R, { female: fem, dur: R.range(0.8, 2.2), rate: loud ? 1.15 : 1, f0: (fem ? R.range(190, 240) : R.range(100, 150)) * (loud ? 1.3 : 1) });
      addAt(out, ph, Math.floor(t * sr), R.range(0.35, 0.8) * (loud ? 1.3 : 1));
      t += ph.length / sr + R.range(0.2, 1.2);
    }
  }
  filt(out, sr, 'lp', 3500, 0.7);
  echoes(out, sr, [[0.03, 0.3, 2500], [0.07, 0.2, 2000]]);
  return out;
}

// ═════════════════════════════ Улица и город ═════════════════════════════
function genThunder(sr, R, near) {
  const D = R.range(6.5, 9.5), N = Math.ceil(D * sr), L = new Float32Array(N), Rt = new Float32Array(N);
  const rolls = []; let tt = near ? 0.05 : R.range(0.1, 0.6);
  for (let k = 0, nr = R.int(3, 6); k < nr; k++) { rolls.push({ t: tt, a: R.range(0.5, 1) * (k === 0 && near ? 1 : 0.85), atk: R.range(0.15, 0.7), dec: R.range(0.6, 2.2) }); tt += R.range(0.4, 1.6); }
  const NB = Math.ceil(N / 64) + 1, env = new Float32Array(NB), cut = new Float32Array(NB);
  let cw = 0.5;
  for (let b = 0; b < NB; b++) {
    const t = b * 64 / sr; let e = 0;
    for (const r of rolls) { const x = t - r.t; if (x > 0) e += r.a * (x < r.atk ? Math.pow(x / r.atk, 1.5) : Math.exp(-(x - r.atk) / r.dec)); }
    env[b] = e * Math.min(1, (D - t) / 1.2);
    cw += (R.next() - 0.5) * 0.08; cw = clampv(cw, 0, 1); cut[b] = 120 + 300 * cw * Math.min(1, e);
  }
  for (const ch of [L, Rt]) {
    const l1 = new BQ(sr), l2 = new BQ(sr), bp = new BQ(sr).set('bp', 320, 0.7); let br = 0;
    for (let i = 0; i < N; i++) {
      const b = i >> 6, w = R.next() * 2 - 1;
      if ((i & 63) === 0) { l1.set('lp', cut[b], 0.7); l2.set('lp', cut[b] * 1.4, 0.6); }
      br = (br + 0.02 * w) / 1.02;
      ch[i] = (l2.p(l1.p(br * 12)) + bp.p(w) * 0.8) * env[b];
    }
    if (near) {
      for (let k = 0, n = R.int(6, 14); k < n; k++) burst(ch, sr, R, R.next() * 0.35, { amp: R.range(0.5, 1.4), tau: R.range(0.004, 0.02), hp: 500 });
      thump(ch, sr, 0.02, 60, 32, 0.5, 1.2, { h2: 0.4 });
    }
    saturate(norm(ch, 1), 1.4);
  }
  return fade(norm([L, Rt], 0.9), sr, 0.01, 0.4);
}
function genExplosionFar(sr, R) {
  const out = mk(sr, 5.5);
  thump(out, sr, 0.01, 70, 28, 0.35, 1, { h2: 0.35 });
  burst(out, sr, R, 0.01, { amp: 0.8, tau: 0.25, lp: 500, atk: 0.01 });
  burst(out, sr, R, 0.01, { amp: 0.4, tau: 0.04, lp: 1500 });
  burst(out, sr, R, 0.2, { amp: 0.4, tau: 1.2, lp: 220, atk: 0.3 });
  echoes(out, sr, [[0.35, 0.4, 400], [0.8, 0.25, 300], [1.4, 0.15, 250]]);
  return fade(norm(saturate(norm(filt(out, sr, 'hp', 25, 0.7), 1), 1.5), 0.9), sr, 0, 0.6);
}
/** СГУ милицейской машины где-то в районе: «вой» или «квакушка», блуждающая громкость, эхо дворов */
function genSiren(sr, R) {
  const D = R.range(7, 10), out = mk(sr, D), wail = R.chance(0.7);
  const T = wail ? R.range(1.4, 2.4) : R.range(0.22, 0.32), fLo = R.range(560, 680), fHi = fLo * R.range(1.9, 2.2);
  const pts = []; for (let t = 0; t <= D + 1; t += 0.8) pts.push(R.range(0.3, 1));
  const lp = new BQ(sr), lp2 = new BQ(sr), dp = R.next() * TAU;
  let ph = 0, a = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr, x = (t % T) / T;
    const sw = wail ? 0.5 - 0.5 * Math.cos(TAU * x) : (x < 0.5 ? x * 2 : (1 - x) * 2);
    ph += (fLo + (fHi - fLo) * sw) * (1 + 0.012 * Math.sin(TAU * t / D * 1.3 + dp)) / sr; ph -= Math.floor(ph);
    const k = t / 0.8, j = Math.floor(k), aw = pts[j] + (pts[j + 1] - pts[j]) * (k - j);
    a = aw * Math.min(1, t / 1.5, (D - t) / 2);
    if ((i & 31) === 0) { lp.set('lp', 800 + 1000 * a, 0.7); lp2.set('lp', 1000 + 1000 * a, 0.6); }
    out[i] = lp2.p(lp.p(Math.sin(TAU * ph) + 0.3 * Math.sin(3 * TAU * ph) + 0.15 * Math.sin(5 * TAU * ph))) * a;
  }
  echoes(out, sr, [[0.11, 0.35, 1200], [0.26, 0.22, 900], [0.47, 0.12, 700]]);
  return fade(norm(out, 0.85), sr, 0.05, 0.3);
}
function genTrainFar(sr, R) {
  const D = 10, out = mk(sr, D);
  const ts = R.range(0.8, 2), hd = R.range(1.5, 2.5), f1 = R.range(300, 360), f2 = f1 * 1.19;
  const l = new BQ(sr).set('lp', 1100, 0.7); let p1 = 0, p2 = 0;
  for (let i = Math.floor(ts * sr), n = Math.floor((ts + hd) * sr); i < n; i++) {
    const t = i / sr - ts, e = Math.min(1, t / 0.25, (hd - t) / 0.4);
    p1 += f1 / sr; p2 += f2 / sr; p1 -= Math.floor(p1); p2 -= Math.floor(p2);
    out[i] += l.p((2 * p1 - 1) + (2 * p2 - 1) * 0.8) * e * 0.6;
  }
  for (let t = 0.3; t < D - 0.5; t += R.range(0.95, 1.05)) {
    const a = Math.sin(Math.PI * t / D) * 0.5;
    for (const dt of [0, 0.11]) { burst(out, sr, R, t + dt, { amp: a, tau: 0.02, lp: 900 }); thump(out, sr, t + dt, 120, 80, 0.03, a * 0.6); }
  }
  burst(out, sr, R, 0.2, { amp: 0.15, tau: 1, hold: D - 3, lp: 400, atk: 2 });
  echoes(out, sr, [[0.2, 0.3, 800], [0.5, 0.15, 600]]);
  return fade(norm(filt(out, sr, 'hp', 60, 0.7), 0.85), sr, 0.5, 1);
}
/** Машина проезжает по мокрому асфальту: шипение шин + мотор с допплером */
function genCarPass(sr, R) {
  const D = R.range(4, 5.5), out = mk(sr, D), tc = D * R.range(0.45, 0.55), w = R.range(0.6, 1.0), fe = R.range(35, 55);
  const b = new BQ(sr), hp = new BQ(sr).set('hp', 1800, 0.7), el = new BQ(sr).set('lp', 400, 0.7);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr, x = (t - tc) / w, a = 1 / (1 + x * x), dop = 1 + 0.06 * Math.tanh(-x * 1.5);
    if ((i & 31) === 0) b.set('bp', 1800 * dop, 0.6);
    const n = R.next() * 2 - 1;
    ph += fe * dop / sr;
    const eng = Math.sin(TAU * ph) + 0.5 * Math.sin(2 * TAU * ph) + 0.3 * Math.sin(3 * TAU * ph + 1);
    out[i] = (b.p(n) * 2.2 + hp.p(n) * 0.6 * (0.5 + R.next()) + el.p(eng) * 0.5) * a * Math.min(1, t / 0.3, (D - t) / 0.3);
  }
  return fade(norm(out, 0.85), sr, 0.1, 0.2);
}
/** Двигатель (УАЗ / дизель-генератор): импульсы вспышек через резонансы выпуска */
function engineRender(sr, R, D, rateFn, ampFn, o) {
  const N = Math.ceil(D * sr), exc = new Float32Array(N), mech = new Float32Array(N);
  let t = 0.01;
  while (t < D) {
    const r = rateFn(t); if (r <= 0.3) { t += 0.05; continue; }
    const a = ampFn(t) * (R.chance(o.miss || 0) ? 0.2 : R.range(0.8, 1.1)), i = Math.floor(t * sr);
    if (i < N) { exc[i] += a; mech[i] += a * (o.knock || 0.2) * R.range(0.5, 1); }
    t += (1 / r) * (1 + (R.next() * 2 - 1) * (o.jit || 0.04));
  }
  const out = modes(exc, sr, o.modes);
  norm(out, 1);
  filt(mech, sr, 'hp', 1500, 0.7);
  addAt(out, modes(mech, sr, [[2300, 0.004, 1], [3700, 0.003, 0.6]]), 0, 0.5);
  return out;
}
const UAZ_MODES = [[85, 0.025, 1], [175, 0.02, 0.7], [410, 0.012, 0.4], [900, 0.006, 0.2]];
const DIESEL_MODES = [[55, 0.05, 1], [120, 0.03, 0.8], [260, 0.02, 0.5], [600, 0.01, 0.3]];
function genCarEngine(sr, R) {
  const D = 8, idle = R.range(24, 28);
  const rate = (t) => t < 1.05 ? 0 : t < 1.4 ? 10 + 30 * (t - 1.05) / 0.35 : t < 3 ? idle + 14 * Math.exp(-(t - 1.4) / 0.5) : t < 5 ? idle : idle + 30 * (1 - Math.exp(-(t - 5) / 1.2));
  const amp = (t) => (t < 5 ? 1 : Math.max(0.05, 1 - (t - 5) / 3.2));
  const out = engineRender(sr, R, D, rate, amp, { modes: UAZ_MODES, knock: 0.15, jit: 0.05, miss: 0.04 });
  let ph = 0; const gb = new BQ(sr).set('bp', 1200, 1);
  for (let i = 0, n = Math.floor(1.1 * sr); i < n; i++) {
    const t = i / sr, comp = 0.6 + 0.4 * Math.sin(TAU * 6.5 * t), f = 140 + 60 * Math.min(1, t / 0.4);
    ph += f * (0.9 + 0.1 * comp) / sr; ph -= Math.floor(ph);
    out[i] += ((2 * ph - 1) * 0.25 + gb.p(R.next() * 2 - 1) * 0.6) * comp * Math.min(1, t / 0.05);
  }
  burst(out, sr, R, 5, { amp: 0.25, tau: 0.8, hold: 1.5, bp: 2000, q: 0.5, atk: 0.8 });
  const l = new BQ(sr);
  for (let i = Math.floor(5 * sr); i < out.length; i++) { if ((i & 31) === 0) l.set('lp', 6000 - 5000 * clamp01((i / sr - 5) / 3), 0.7); out[i] = l.p(out[i]); }
  return fade(norm(filt(out, sr, 'hp', 40, 0.7), 0.9), sr, 0, 0.5);
}
function genCarIdle(sr, R) {
  const L = 2.4, r = 26, D = L + 0.4;
  const out = engineRender(sr, R, D, () => r, () => 1, { modes: UAZ_MODES, knock: 0.15, jit: 0.04 });
  burst(out, sr, R, 0, { amp: 0.05, tau: 1, hold: D, bp: 1200, q: 0.8 });
  return norm(loopify(filt(out, sr, 'hp', 40, 0.7), Math.floor(L * sr)), 0.85);
}
function genCarDoor(sr, R) {
  const out = mk(sr, 1.0);
  pingsModes(out, sr, 0.005, [[R.range(2300, 2700), 0.005, 1]], 0.2);
  const s = R.range(0.1, 0.16);
  thump(out, sr, s, 95, 75, 0.06, 1);
  burst(out, sr, R, s, { amp: 0.7, tau: 0.02, lp: 1200 });
  pingsModes(out, sr, s, [[R.range(300, 330), 0.12, 1], [R.range(500, 540), 0.1, 0.8], [R.range(850, 900), 0.08, 0.6], [R.range(1300, 1360), 0.06, 0.4], [R.range(2050, 2150), 0.05, 0.25]], 0.45);
  burst(out, sr, R, s + 0.008, { amp: 0.4, tau: 0.004, bp: 2000, q: 1 });
  for (let k = 0; k < 3; k++) ping(out, sr, s + 0.01 + k * 0.015, R.range(3200, 4200), 0.02, 0.05);
  return fade(norm(filt(out, sr, 'hp', 50, 0.7), 0.9), sr, 0, 0.05);
}
function genGenerator(sr, R, mode) {
  if (mode === 'run') {
    const L = 3, D = L + 0.4;
    const out = engineRender(sr, R, D, () => 25, () => 1, { modes: DIESEL_MODES, knock: 0.35, jit: 0.02 });
    burst(out, sr, R, 0, { amp: 0.08, tau: 1, hold: D, bp: 800, q: 1 });
    for (let i = 0; i < out.length; i++) out[i] += Math.sin(TAU * 400 * i / sr) * 0.02;
    return norm(loopify(filt(out, sr, 'hp', 35, 0.7), Math.floor(L * sr)), 0.85);
  }
  if (mode === 'start') {
    const D = 5;
    const rate = (t) => t < 1.4 ? 0 : t < 2.6 ? 4 + 21 * (t - 1.4) / 1.2 : t < 3.5 ? 25 + 3 * Math.sin(Math.PI * (t - 2.6) / 0.9) : 25;
    const out = engineRender(sr, R, D, rate, (t) => (t < 2.6 ? 1.2 : 1), { modes: DIESEL_MODES, knock: 0.35, jit: 0.04, miss: 0.08 });
    let ph = 0;
    for (let i = 0, n = Math.floor(1.45 * sr); i < n; i++) {
      const t = i / sr, comp = 0.55 + 0.45 * Math.sin(TAU * 4 * t);
      ph += 180 * (0.85 + 0.15 * comp) / sr; ph -= Math.floor(ph);
      out[i] += (2 * ph - 1) * 0.3 * comp * Math.min(1, t / 0.05) + (R.next() * 2 - 1) * 0.05 * comp;
    }
    burst(out, sr, R, 2.5, { amp: 0.08, tau: 1, hold: 2.5, bp: 800, q: 1, atk: 0.5 });
    return fade(norm(filt(out, sr, 'hp', 35, 0.7), 0.9), sr, 0, 0.6);
  }
  const D = 4.5;
  const out = engineRender(sr, R, D, (t) => (t < 3.3 ? 25 * Math.exp(-t / 1.1) : 0), (t) => Math.max(0.2, 1 - t / 4), { modes: DIESEL_MODES, knock: 0.3, jit: 0.06, miss: 0.1 });
  thump(out, sr, 3.35, 70, 45, 0.08, 0.5);
  pingsModes(out, sr, 3.36, [[R.range(600, 700), 0.05, 1], [R.range(1100, 1250), 0.03, 0.5]], 0.25);
  burst(out, sr, R, 0, { amp: 0.08, tau: 1.2, bp: 800, q: 1 });
  return fade(norm(filt(out, sr, 'hp', 35, 0.7), 0.9), sr, 0, 0.3);
}
/** Свет отрубился: щелчок автомата, гул дросселей умирает со спадом тона, тики стартёров */
function genPowerDown(sr, R) {
  const out = mk(sr, 2.0);
  burst(out, sr, R, 0.005, { amp: 0.9, tau: 0.004, bp: 1500, q: 1 });
  pingsModes(out, sr, 0.005, [[R.range(650, 750), 0.04, 1], [R.range(1800, 2000), 0.02, 0.5]], 0.6);
  thump(out, sr, 0.005, 150, 110, 0.03, 0.4);
  const hz = [[100, 1], [200, 0.5], [300, 0.35], [400, 0.15], [500, 0.1]];
  for (let i = 0, n = Math.floor(1.4 * sr); i < n; i++) {
    const t = i / sr, f = 1 - 0.15 * (1 - Math.exp(-t / 0.4)); let y = 0;
    for (const [h, a] of hz) y += Math.sin(TAU * h * f * t) * a;
    out[i] += y * 0.25 * Math.exp(-t / 0.3);
  }
  for (let k = 0, n = R.int(2, 4); k < n; k++) ping(out, sr, R.range(0.05, 0.6), R.range(3000, 5000), 0.01, 0.15);
  thump(out, sr, R.range(0.08, 0.15), 60, 40, 0.05, 0.3);
  grit(out, sr, R, 0.08, 0.2, 0.15, 500, 3000);
  return fade(norm(out, 0.9), sr, 0, 0.3);
}
/** Звонок громкого боя: молоток ~20 Гц по чаше */
function genAlarmBell(sr, R, loopLen = 0) {
  const total = loopLen ? loopLen + 1.2 : 3.4, ringEnd = loopLen || 2.8, N = Math.ceil(total * sr), exc = new Float32Array(N), rate = 20;
  for (let t = 0.003; t < ringEnd; t += 1 / rate) exc[Math.round(t * sr)] += R.range(0.85, 1);
  const f = R.range(1000, 1100);
  const out = modes(exc, sr, [[f, 0.6, 1], [f * 2.21, 0.35, 0.6], [f * 3.4, 0.22, 0.45], [f * 4.75, 0.15, 0.3], [f * 6.3, 0.1, 0.2]]);
  norm(out, 1);
  addAt(out, filt(exc.slice(), sr, 'hp', 3000, 0.7), 0, 0.05);
  const bz = new BQ(sr).set('lp', 2500, 0.7);
  for (let i = 0, n = Math.floor(ringEnd * sr); i < n; i++) out[i] += bz.p(Math.sin(TAU * rate * i / sr) > 0.3 ? 0.08 : -0.02);
  filt(out, sr, 'hp', 300, 0.7);
  return loopLen ? norm(circularize(out, Math.round(loopLen * sr)), 0.85) : fade(norm(out, 0.85), sr, 0, 0.2);
}

// ═════════════════════════════ ТВ: заставки ═════════════════════════════
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
function synthNote(out, sr, t0, dur, f, inst, amp) {
  const rel = inst === 'pad' ? 0.6 : inst === 'brass' ? 0.12 : 0.25, i0 = Math.floor(t0 * sr);
  const n = Math.min(out.length - i0, Math.ceil((dur + rel * 4) * sr));
  const lp = new BQ(sr); let ph = 0, ph2 = 0, mp = 0;
  for (let k = 0; k < n; k++) {
    const t = k / sr, on = t < dur, rl = on ? 1 : Math.exp(-(t - dur) / rel);
    let y = 0;
    if (inst === 'brass') {
      const e = Math.min(1, t / 0.03) * (0.8 + 0.2 * Math.exp(-t / 0.1)) * rl;
      if ((k & 15) === 0) lp.set('lp', f * (2 + 6 * e), 0.8);
      ph += f / sr; ph -= Math.floor(ph); ph2 += f * 1.004 / sr; ph2 -= Math.floor(ph2);
      y = lp.p((2 * ph - 1) + (2 * ph2 - 1)) * e * 0.5;
    } else if (inst === 'square') {
      ph += f / sr; ph -= Math.floor(ph);
      y = (ph < 0.5 ? 1 : -1) * Math.min(1, t / 0.005) * (0.6 + 0.4 * Math.exp(-t / 0.08)) * rl * 0.4;
    } else if (inst === 'ep' || inst === 'bell' || inst === 'xylo') {
      const ratio = inst === 'ep' ? 1 : inst === 'bell' ? 3.5 : 4, I = (inst === 'ep' ? 2.2 : 3) * Math.exp(-t / (inst === 'xylo' ? 0.03 : 0.25));
      mp += f * ratio / sr; ph += f / sr;
      y = Math.sin(TAU * ph + I * Math.sin(TAU * mp)) * Math.min(1, t / 0.002) * Math.exp(-t / (inst === 'ep' ? 0.8 : inst === 'bell' ? 0.9 : 0.25)) * (on ? 1 : rl);
    } else if (inst === 'pad') {
      if ((k & 31) === 0) lp.set('lp', 1600, 0.7);
      ph += f / sr; ph -= Math.floor(ph); ph2 += f * 1.006 / sr; ph2 -= Math.floor(ph2);
      y = lp.p((2 * ph - 1) + (2 * ph2 - 1)) * Math.min(1, t / 0.4) * rl * 0.35;
    } else {
      ph += f / sr; ph -= Math.floor(ph);
      y = (Math.sin(TAU * ph) + 0.25 * (2 * ph - 1)) * Math.min(1, t / 0.005) * Math.exp(-t / 0.4) * rl;
    }
    out[i0 + k] += y * amp;
  }
}
function drum(out, sr, R, t0, kind, amp) {
  if (kind === 'kick') thump(out, sr, t0, 130, 48, 0.12, amp);
  else if (kind === 'snare') { burst(out, sr, R, t0, { amp: amp * 0.7, tau: 0.06, bp: 1800, q: 0.7 }); thump(out, sr, t0, 200, 170, 0.05, amp * 0.4); }
  else if (kind === 'hat') burst(out, sr, R, t0, { amp: amp * 0.4, tau: 0.015, hp: Math.min(6000, sr * 0.3) });
  else { thump(out, sr, t0, 95, 85, 0.5, amp); burst(out, sr, R, t0, { amp: amp * 0.4, tau: 0.08, lp: 300 }); }
}
function genJingle(sr, R, kind) {
  const minor = kind === 'serial' || (kind === 'news' && R.chance(0.6)), root = 48 + R.int(0, 7);
  const sc = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const deg = (d) => root + sc[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  const chord = (d) => [deg(d), deg(d + 2), deg(d + 4)];
  const D = { news: 4.2, ad: 4.4, weather: 6.5, serial: 7, sport: 3.8, kids: 4.2 }[kind] || 4, out = mk(sr, D + 0.8);
  if (kind === 'news') {
    const b = 60 / R.range(100, 116), prog = minor ? [0, 5, 2, 6, 0] : [0, 5, 3, 4, 0];
    prog.forEach((d, k) => { const t = 0.1 + k * b, len = k === prog.length - 1 ? b * 2.5 : b * 0.7; for (const m of chord(d)) synthNote(out, sr, t, len, mtof(m), 'brass', 0.35); synthNote(out, sr, t, len, mtof(deg(d + 7)), 'brass', 0.25); drum(out, sr, R, t, 'timp', k === prog.length - 1 ? 0.9 : 0.6); });
    for (let k = 0; k < 8; k++) drum(out, sr, R, 0.1 + 4 * b + k * 0.06, 'timp', 0.25);
  } else if (kind === 'ad') {
    const b = 60 / R.range(132, 150), pent = [0, 1, 2, 4, 5];
    for (let k = 0; k < 16; k++) { const t = 0.05 + k * b / 2; if (R.chance(0.85)) synthNote(out, sr, t, b * 0.4, mtof(deg(7 + R.pick(pent) + (k > 11 ? 2 : 0))), 'square', 0.3); drum(out, sr, R, t, 'hat', 0.5); if (k % 2 === 0) { drum(out, sr, R, t, 'kick', 0.7); synthNote(out, sr, t, b * 0.45, mtof(deg(k < 8 ? 0 : k < 12 ? 3 : 4) - 12), 'bass', 0.5); } }
    for (const m of chord(0)) synthNote(out, sr, 0.05 + 8 * b, b * 1.5, mtof(m + 12), 'square', 0.2);
  } else if (kind === 'weather') {
    const b = 60 / R.range(78, 88);
    [0, 3, 0, 4].forEach((d, k) => { const t = 0.1 + k * b * 1.5; [deg(d), deg(d + 2), deg(d + 4), deg(d + 6)].forEach((m, j) => synthNote(out, sr, t + j * 0.08, b * 1.3, mtof(m), 'ep', 0.25)); synthNote(out, sr, t, b * 1.4, mtof(deg(d) - 12), 'bass', 0.35); synthNote(out, sr, t + b * 0.75, b * 0.6, mtof(deg(d + 7 + R.int(0, 4))), 'ep', 0.3); });
  } else if (kind === 'serial') {
    const b = 60 / 70;
    [0, 3, 5, 4].forEach((d, k) => { const t = 0.1 + k * b * 2; for (const m of chord(d)) synthNote(out, sr, t, b * 2, mtof(m), 'pad', 0.3); synthNote(out, sr, t + b * 0.5, b, mtof(deg(d + 7 + R.pick([0, 2, 4]))), 'bell', 0.25); });
  } else if (kind === 'sport') {
    const b = 60 / R.range(145, 160);
    for (let k = 0; k < 8; k++) drum(out, sr, R, 0.05 + k * b / 4, 'snare', 0.4 + k * 0.05);
    [0, 2, 4, 7].forEach((d, k) => { const t = 0.05 + 2 * b + k * b / 2; synthNote(out, sr, t, b * 0.4, mtof(deg(d + 7)), 'brass', 0.4); drum(out, sr, R, t, 'kick', 0.7); });
    for (const m of chord(7)) synthNote(out, sr, 0.05 + 4 * b, b * 2, mtof(m), 'brass', 0.35);
    drum(out, sr, R, 0.05 + 4 * b, 'snare', 0.8);
  } else {
    const b = 60 / R.range(120, 135);
    for (let k = 0; k < 12; k++) { const t = 0.05 + k * b / 2; synthNote(out, sr, t, b * 0.3, mtof(deg(7 + R.pick([0, 2, 4, 5, 7]))), 'xylo', 0.4); if (k % 2 === 0) synthNote(out, sr, t, b * 0.4, mtof(deg(k % 4 ? 4 : 0) - 12), 'bass', 0.35); }
  }
  return fade(norm(filt(out, sr, 'hp', 120, 0.7), 0.85), sr, 0.005, 0.3);
}

// ═════════════════════════════ Фоновые текстуры (бесшовные петли) ═════════════════════════════
function genRainBed(sr, R) {
  const L = Math.floor(4.0 * sr), N = L + Math.floor(0.4 * sr), chans = [];
  for (let c = 0; c < 2; c++) {
    const a = new Float32Array(N), hp = new BQ(sr).set('hp', 350, 0.6), lp = new BQ(sr).set('lp', 8000, 0.6), lpL = new BQ(sr).set('lp', 220, 0.7);
    let b0 = 0, b1 = 0, b2 = 0, br = 0, g = 1, gT = 1, cnt = 0;
    for (let i = 0; i < N; i++) {
      const w = R.next() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      br = (br + 0.02 * w) / 1.02;
      if (--cnt <= 0) { cnt = sr * R.range(0.15, 0.6); gT = R.range(0.8, 1.15); }
      g += (gT - g) * 0.00005;
      a[i] = (lp.p(hp.p((b0 + b1 + b2 + w * 0.1848) * 0.18)) + lpL.p(br) * 1.2) * g;
    }
    chans.push(loopify(a, L));
  }
  return normRMS(chans, 0.16);
}
function genRainDrops(sr, R) {
  const L = Math.floor(5.3 * sr), N = L + Math.floor(0.3 * sr), chans = [];
  for (let c = 0; c < 2; c++) {
    const a = new Float32Array(N);
    for (const gr of [{ f: 3200, q: 1.2, d: 350, a: 0.5 }, { f: 6500, q: 1.0, d: 500, a: 0.35 }, { f: 1400, q: 1.5, d: 80, a: 0.7 }]) {
      if (gr.f > sr * 0.45) continue;
      const tmp = new Float32Array(N), p = gr.d / sr;
      for (let i = 0; i < N; i++) if (R.next() < p) tmp[i] = (R.next() * 2 - 1) * R.next() * R.next();
      filt(tmp, sr, 'bp', gr.f, gr.q); addAt(a, tmp, 0, gr.a * 6);
    }
    let t = 0; while (t < N / sr - 0.05) { chirp(a, sr, t, R.range(900, 1800), R.range(2000, 4500), R.range(0.003, 0.008), R.range(0.05, 0.2)); t += -Math.log(1 - R.next() * 0.999) / 22; }
    chans.push(loopify(a, L));
  }
  return normRMS(chans, 0.12);
}
/** Капли по жестяному отливу/подоконнику — серии с почти постоянным периодом (с карниза) */
function genSill(sr, R, dense) {
  const Ls = dense ? 5.9 : 7.3, dens = dense ? 5 : 1.8, L = Math.floor(Ls * sr), a = new Float32Array(L + Math.floor(0.5 * sr));
  let t = 0.05;
  while (t < Ls) {
    const k = R.next(), amp = R.range(0.3, 1);
    if (k < 0.55) { pingsModes(a, sr, t, [[R.range(1100, 1500), 0.012, 1], [R.range(2300, 2900), 0.008, 0.6], [R.range(3800, 4600), 0.005, 0.3]], amp * 0.5); burst(a, sr, R, t, { amp: amp * 0.4, tau: 0.0015, bp: 3000, q: 0.8 }); }
    else if (k < 0.85) { chirp(a, sr, t, R.range(700, 1200), R.range(1500, 3000), R.range(0.005, 0.01), amp * 0.4); burst(a, sr, R, t, { amp: amp * 0.2, tau: 0.003, bp: 2000, q: 0.7 }); }
    else { thump(a, sr, t, 400, 250, 0.01, amp * 0.25); burst(a, sr, R, t, { amp: amp * 0.6, tau: 0.004, bp: 1600, q: 0.9 }); }
    t += R.chance(0.6) ? R.range(0.25, 0.5) / dens * 2 : -Math.log(1 - R.next() * 0.999) / dens;
  }
  return norm(circularize(a, L), 0.8);
}
/** Гул ламп дневного света: 100 Гц + гармоники + дребезг дросселя; ровно 1 с — бесшовно */
function genHum(sr, R) {
  const N = sr, a = new Float32Array(N), hs = [[50, 0.12], [100, 1], [200, 0.45], [300, 0.3], [400, 0.12], [500, 0.08], [600, 0.05], [700, 0.04], [900, 0.03], [1100, 0.02]];
  const phs = hs.map(() => R.next() * TAU);
  for (let i = 0; i < N; i++) {
    const t = i / sr; let y = 0;
    for (let k = 0; k < hs.length; k++) y += hs[k][1] * Math.sin(TAU * hs[k][0] * t + phs[k]);
    const s = Math.sin(TAU * 100 * t + 0.3);
    a[i] = y + Math.sign(s) * Math.max(0, Math.abs(s) - 0.85) * 0.6 + (R.next() * 2 - 1) * 0.006;
  }
  return normRMS(a, 0.15);
}
function genCityBed(sr, R) {
  const L = Math.floor(11 * sr), N = L + Math.floor(sr), chans = [];
  for (let c = 0; c < 2; c++) {
    const a = new Float32Array(N), l = new BQ(sr).set('lp', 160, 0.7), b = new BQ(sr).set('bp', 450, 0.5), h = new BQ(sr).set('bp', 1800, 0.4);
    let br = 0, g = 0.5, gT = 0.5, cnt = 0, g2 = 0.3, g2T = 0.3;
    for (let i = 0; i < N; i++) {
      const w = R.next() * 2 - 1; br = (br + 0.02 * w) / 1.02;
      if (--cnt <= 0) { cnt = sr * R.range(1, 4); gT = R.range(0.2, 1); g2T = R.range(0.1, 0.5); }
      g += (gT - g) * 0.00003; g2 += (g2T - g2) * 0.00003;
      a[i] = l.p(br) * 3 + b.p(w) * g * 0.8 + h.p(w) * g2 * 0.4;
    }
    chans.push(loopify(a, L));
  }
  return normRMS(chans, 0.1);
}
/** Тёмный дрон напряжения: низкие детюненные пилы (ре, ля, фа, тритон), металлические призвуки, ветер */
function genDrone(sr, R) {
  const Ls = 12, L = Math.floor(Ls * sr), N = L + Math.floor(sr), q = (f) => Math.round(f * Ls) / Ls, chans = [];
  const notes = [[36.71, 0.6], [55.0, 0.5], [73.42, 0.35], [87.31, 0.22], [103.83, 0.12]];
  for (let c = 0; c < 2; c++) {
    const a = new Float32Array(N), osc = notes.map(([f, am], k) => ({ f: q(f * (1 + (c ? 0.003 : -0.003) * (k + 1))), am, ph: R.next(), lf: (k % 3 + 1) / Ls, lp: R.next() * TAU }));
    const lp = new BQ(sr).set('lp', 500, 0.7), wb = new BQ(sr), exc = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = i / sr; let y = 0;
      for (const o of osc) { o.ph += o.f / sr; o.ph -= Math.floor(o.ph); y += (2 * o.ph - 1) * o.am * (0.6 + 0.4 * Math.sin(TAU * o.lf * t + o.lp)); }
      if ((i & 63) === 0) wb.set('bp', 500 + 300 * Math.sin(TAU * t / Ls * 2 + c), 1.5);
      const w = R.next() * 2 - 1; exc[i] = w * 0.002;
      a[i] = lp.p(y) + wb.p(w) * 0.25;
    }
    const met = norm(modes(exc, sr, [[233, 1.2, 1], [377, 1.0, 0.8], [611, 0.8, 0.6], [987, 0.6, 0.4]]), 1);
    for (let i = 0; i < N; i++) a[i] += met[i] * 0.12 * (0.5 + 0.5 * Math.sin(TAU * i / sr / Ls * 3 + c * 2));
    chans.push(loopify(a, L));
  }
  return normRMS(chans, 0.2);
}
function genNoiseLoop(sr, R, f, q, buzz) {
  const L = Math.floor(2 * sr), N = L + Math.floor(0.2 * sr), a = new Float32Array(N), b = new BQ(sr).set('bp', f, q);
  for (let i = 0; i < N; i++) { let y = b.p(R.next() * 2 - 1) * 3; if (buzz) y *= 0.8 + 0.2 * Math.sin(TAU * 50 * i / sr); if (R.next() < 0.0008) y += (R.next() * 2 - 1) * 1.5; a[i] = y; }
  return normRMS(loopify(a, L), 0.22);
}
/** Импульсные характеристики: 'in' — кабинеты/коридоры с кафелем, 'out' — улица между пятиэтажками */
function genIR(sr, R, kind, short) {
  const indoor = kind === 'in', D = indoor ? (short ? 0.6 : 0.85) : (short ? 1.0 : 1.5), N = Math.ceil(D * sr), ch = [new Float32Array(N), new Float32Array(N)];
  const bands = (a, list, pre, amp) => {
    for (const b of list) {
      const f = new BQ(sr).set(b.type, b.f, b.q || 0.7), comp = b.type === 'lp' ? Math.sqrt(sr / 2 / b.f) : b.type === 'bp' ? Math.sqrt(sr / 2 / (b.f / (b.q || 0.7))) : 1;
      for (let i = 0; i < N; i++) { const t = i / sr - pre; if (t < 0) continue; a[i] += f.p(R.next() * 2 - 1) * Math.min(1, t / 0.006) * Math.exp(-t / b.tau) * amp * comp * 0.3; }
    }
  };
  for (const a of ch) {
    if (indoor) {
      for (let k = 0; k < 12; k++) { const t = 0.003 + R.next() * 0.032; a[Math.floor(t * sr)] += (R.chance(0.5) ? 1 : -1) * R.range(0.25, 0.7) * (1 - t * 12); }
      bands(a, [{ type: 'lp', f: 500, tau: 0.16 }, { type: 'bp', f: 1500, q: 0.6, tau: 0.12 }, { type: 'hp', f: 3500, tau: 0.055 }], 0.008, 0.6);
    } else {
      for (let k = 0, n = R.int(6, 9); k < n; k++) { const t = R.range(0.04, 0.45); burst(a, sr, R, t, { amp: R.range(0.2, 0.55) * (1 - t * 1.3), tau: 0.004, lp: 2200 - t * 2000 }); }
      bands(a, [{ type: 'lp', f: 700, tau: 0.34 }, { type: 'bp', f: 1600, q: 0.7, tau: 0.2 }, { type: 'hp', f: 3500, tau: 0.07 }], 0.015, 0.35);
    }
    fade(a, sr, 0, 0.05);
  }
  return ch;
}

// ═════════════════════════════ Таблица звуков ═════════════════════════════
// n — вариантов; sr: 'hi' (≈48k) | 'lo' (½) | 'vlo' (16k); vol — микс; ref/max/roll — затухание с расстоянием;
// rev — посыл в реверберацию; prio — приоритет в пуле; maxInst — копий одновременно; jit — разброс скорости;
// bus: sfx | radio | city (далёкий город: глушится в помещении) | amb; loop — буфер для loop(); proc — процедурная петля.
const S = {};
function def(name, o) { S[name] = Object.assign({ n: 1, sr: 'hi', vol: 0.8, ref: 2, max: 60, roll: 1, rev: 0.3, prio: 2, maxInst: 4, jit: 0.04, bus: 'sfx', cat: 'sfx' }, o); }
const shot = (P, big) => ({ gen: (sr, R) => genShot(sr, R, P), n: 3, vol: 1, ref: 6, max: 650, rev: 0.6, prio: 5, maxInst: 6, jit: 0.03, cat: 'shot', big });
def('shot_pm', shot(GUN.pm)); def('shot_tt', shot(GUN.tt)); def('shot_ak', shot(GUN.ak, true)); def('shot_ks23', shot(GUN.ks23, true));
def('shot_sawnoff', shot(GUN.sawnoff, true)); def('shot_shotgun', shot(GUN.shotgun, true));
def('ricochet', { gen: genRicochet, n: 3, vol: 0.55, ref: 3, max: 120, rev: 0.4, prio: 3 });
def('glass_break', { gen: genGlassBreak, n: 2, vol: 0.9, ref: 3, max: 150, rev: 0.5, prio: 4 });
def('glass_shards', { gen: genGlassShards, n: 3, vol: 0.5, ref: 1.5, max: 30, rev: 0.3 });
for (const [s, v, r] of [['lino', 0.32, 0.15], ['tile', 0.35, 0.35], ['concrete', 0.34, 0.25], ['wet', 0.36, 0.12]])
  def('step_' + s, { gen: (sr, R) => genStep(sr, R, s), n: 5, vol: v, ref: 1.2, max: 24, roll: 1.3, rev: r, prio: 1, maxInst: 5, jit: 0.06, cat: 'step' });
def('footsteps_run', { gen: genRun, n: 2, vol: 0.45, ref: 1.5, max: 35, roll: 1.2, rev: 0.25, proc: 'run' });
for (const [base, g, v, ref, max, rev] of [['door_wood', genDoorWood, 0.6, 2, 40, 0.35], ['door_steel', genDoorSteel, 0.8, 2.5, 60, 0.45], ['cell_door', genCellDoor, 0.85, 2.5, 60, 0.5]]) {
  def(base, { gen: (sr, R) => g(sr, R, 'both'), n: 2, vol: v, ref, max, rev, prio: 3 });
  def(base + '_open', { gen: (sr, R) => g(sr, R, 'open'), n: 2, vol: v, ref, max, rev, prio: 3 });
  def(base + '_close', { gen: (sr, R) => g(sr, R, 'close'), n: 2, vol: v, ref, max, rev, prio: 3 });
}
def('phone_ring', { gen: (sr, R) => genPhoneRing(sr, R), n: 2, vol: 0.7, ref: 2, max: 45, rev: 0.3, prio: 4, maxInst: 2, jit: 0.005, loop: '_phone_ring_loop' });
def('_phone_ring_loop', { gen: (sr, R) => genPhoneRing(sr, R, 5.0, 1.0), vol: 0.7, ref: 2, max: 45, rev: 0.3 });
def('phone_pickup', { gen: (sr, R) => genPhonePickup(sr, R, false), n: 2, vol: 0.5, ref: 1.5, max: 20, rev: 0.2 });
def('phone_hangup', { gen: (sr, R) => genPhonePickup(sr, R, true), n: 2, vol: 0.55, ref: 1.5, max: 20, rev: 0.2 });
def('phone_dial', { gen: genPhoneDial, n: 4, vol: 0.45, ref: 1.2, max: 15, rev: 0.15, jit: 0.01 });
def('dial_tone', { gen: (sr, R) => genTone(sr, R, false), sr: 'lo', vol: 0.25, ref: 0.5, max: 4, rev: 0, jit: 0 });
def('busy_tone', { gen: (sr, R) => genTone(sr, R, true), sr: 'lo', vol: 0.25, ref: 0.5, max: 4, rev: 0, jit: 0 });
def('typewriter', { gen: genTypewriter, n: 2, vol: 0.5, ref: 1.5, max: 28, rev: 0.25, proc: 'typewriter' });
def('_tw_key', { gen: (sr, R) => genTwKey(sr, R, 'char'), n: 6, vol: 0.5 });
def('_tw_space', { gen: (sr, R) => genTwKey(sr, R, 'space'), n: 3, vol: 0.45 });
def('_tw_bell', { gen: (sr, R) => genTwKey(sr, R, 'bell'), n: 2, vol: 0.4, jit: 0.01 });
def('_tw_return', { gen: (sr, R) => genTwKey(sr, R, 'return'), n: 2, vol: 0.55 });
def('radio_squelch', { gen: genSquelch, n: 3, vol: 0.55, bus: 'radio', ref: 1.5, max: 25, rev: 0.1, prio: 4 });
def('radio_static', { gen: genStatic, n: 3, vol: 0.45, bus: 'radio', ref: 1.5, max: 25, rev: 0.1, prio: 3, loop: '_radio_hiss' });
def('_radio_open', { gen: genRadioOpen, n: 3, vol: 0.5, bus: 'radio', ref: 1.5, max: 25, rev: 0.1, prio: 4 });
def('_radio_alarm', { gen: genRadioAlarm, vol: 0.55, bus: 'radio', ref: 1.5, max: 30, rev: 0.1, prio: 4, jit: 0 });
def('_radio_hiss', { gen: (sr, R) => genNoiseLoop(sr, R, 1800, 0.5, false), sr: 'vlo', vol: 0.3, bus: 'radio' });
def('kettle', { gen: (sr, R) => genKettle(sr, R, false), sr: 'lo', vol: 0.5, ref: 1.2, max: 18, rev: 0.2, loop: '_kettle_loop' });
def('_kettle_loop', { gen: (sr, R) => genKettle(sr, R, true), sr: 'lo', vol: 0.45, ref: 1.2, max: 18, rev: 0.2 });
def('spoon_glass', { gen: genSpoonGlass, n: 2, vol: 0.35, ref: 1, max: 12, rev: 0.15 });
def('thunder', { gen: (sr, R, i) => genThunder(sr, R, i % 2 === 0), n: 4, sr: 'lo', vol: 0.95, bus: 'city', ref: 40, max: 5000, rev: 0, prio: 3, maxInst: 3 });
def('hit_flesh', { gen: genHitFlesh, n: 3, vol: 0.6, ref: 1.5, max: 30, rev: 0.2, prio: 3 });
def('body_fall', { gen: genBodyFall, n: 3, vol: 0.7, ref: 2, max: 40, rev: 0.35, prio: 3 });
def('punch', { gen: genPunch, n: 3, vol: 0.6, ref: 1.5, max: 25, rev: 0.2, prio: 3 });
def('reload', { gen: (sr, R, i) => genReload(sr, R, ['pm', 'ak', 'ks23'][i % 3]), n: 3, vol: 0.55, ref: 1.5, max: 25, rev: 0.2 });
def('reload_pm', { gen: (sr, R) => genReload(sr, R, 'pm'), n: 2, vol: 0.55, ref: 1.5, max: 25, rev: 0.2 });
def('reload_ak', { gen: (sr, R) => genReload(sr, R, 'ak'), n: 2, vol: 0.6, ref: 1.5, max: 25, rev: 0.2 });
def('reload_ks23', { gen: (sr, R) => genReload(sr, R, 'ks23'), n: 2, vol: 0.6, ref: 1.5, max: 25, rev: 0.2 });
def('empty_click', { gen: genEmptyClick, n: 2, vol: 0.5, ref: 1, max: 12, rev: 0.1, prio: 3 });
def('shell_casing', { gen: genCasingSolo, n: 3, vol: 0.3, ref: 1, max: 12, rev: 0.15, prio: 1, maxInst: 6 });
def('explosion_far', { gen: genExplosionFar, n: 2, sr: 'lo', vol: 1, bus: 'city', ref: 40, max: 8000, rev: 0, prio: 4 });
def('siren_far', { gen: genSiren, n: 3, sr: 'lo', vol: 0.5, bus: 'city', ref: 30, max: 3000, rev: 0 });
def('dog_far', { gen: genDogFar, n: 4, sr: 'lo', vol: 0.5, bus: 'city', ref: 20, max: 2000, rev: 0 });
def('train_far', { gen: genTrainFar, n: 2, sr: 'lo', vol: 0.45, bus: 'city', ref: 40, max: 5000, rev: 0 });
def('crow_far', { gen: genCrowFar, n: 3, sr: 'lo', vol: 0.4, bus: 'city', ref: 15, max: 1500, rev: 0 });
def('car_pass', { gen: genCarPass, n: 3, sr: 'lo', vol: 0.5, bus: 'city', ref: 10, max: 1500, rev: 0 });
def('_far_shot', { gen: (sr, R) => genFarShot(sr, R, false), n: 3, sr: 'lo', vol: 0.6, bus: 'city', rev: 0 });
def('_far_ak', { gen: (sr, R) => genFarShot(sr, R, true), n: 3, sr: 'lo', vol: 0.55, bus: 'city', rev: 0 });
def('car_engine', { gen: genCarEngine, sr: 'lo', vol: 0.8, ref: 3, max: 120, rev: 0.3, prio: 3, loop: 'car_idle' });
def('car_idle', { gen: genCarIdle, sr: 'lo', vol: 0.7, ref: 3, max: 100, rev: 0.25 });
def('car_door', { gen: genCarDoor, n: 3, vol: 0.75, ref: 2.5, max: 60, rev: 0.35, prio: 3 });
def('ui_click', { gen: genUiClick, n: 3, vol: 0.35, rev: 0, prio: 2, maxInst: 3, jit: 0.05 });
def('ui_paper', { gen: genPaper, n: 4, vol: 0.4, rev: 0, prio: 2, maxInst: 3 });
def('ui_stamp', { gen: genStamp, n: 2, vol: 0.6, rev: 0.1, prio: 2 });
def('generator_start', { gen: (sr, R) => genGenerator(sr, R, 'start'), sr: 'lo', vol: 0.8, ref: 2.5, max: 50, rev: 0.4, prio: 3, loop: 'generator_run' });
def('generator_run', { gen: (sr, R) => genGenerator(sr, R, 'run'), sr: 'lo', vol: 0.7, ref: 2.5, max: 50, rev: 0.35 });
def('generator_stop', { gen: (sr, R) => genGenerator(sr, R, 'stop'), sr: 'lo', vol: 0.8, ref: 2.5, max: 50, rev: 0.4, prio: 3 });
def('power_down', { gen: genPowerDown, vol: 0.8, ref: 4, max: 80, rev: 0.3, prio: 4 });
def('alarm_bell', { gen: (sr, R) => genAlarmBell(sr, R, 0), vol: 0.75, ref: 3, max: 120, rev: 0.4, prio: 4, maxInst: 2, jit: 0, loop: '_alarm_loop' });
def('_alarm_loop', { gen: (sr, R) => genAlarmBell(sr, R, 2.0), vol: 0.75, ref: 3, max: 120, rev: 0.4 });
def('scream_m', { gen: (sr, R) => genScream(sr, R, false), n: 3, sr: 'lo', vol: 0.75, ref: 3, max: 120, rev: 0.4, prio: 4, jit: 0.06 });
def('scream_f', { gen: (sr, R) => genScream(sr, R, true), n: 3, sr: 'lo', vol: 0.75, ref: 3, max: 120, rev: 0.4, prio: 4, jit: 0.06 });
def('crowd_murmur', { gen: (sr, R) => fade(norm(genCrowd(sr, R, 4.5), 0.85), sr, 0.4, 0.6), sr: 'vlo', vol: 0.55, ref: 3, max: 60, rev: 0.3, loop: '_crowd_loop' });
def('_crowd_loop', { gen: (sr, R) => norm(loopify(genCrowd(sr, R, 9), Math.floor(8 * sr)), 0.85), sr: 'vlo', vol: 0.55, ref: 3, max: 60, rev: 0.3 });
def('whistle', { gen: genWhistle, n: 2, vol: 0.7, ref: 3, max: 150, rev: 0.4, prio: 3 });
def('cuffs', { gen: genCuffs, n: 2, vol: 0.5, ref: 1, max: 15, rev: 0.15 });
def('keys', { gen: genKeys, n: 3, vol: 0.35, ref: 1, max: 15, rev: 0.15 });
def('match', { gen: genMatch, n: 2, vol: 0.35, ref: 1, max: 10, rev: 0.1 });
def('tv_on', { gen: genTvOn, sr: 'lo', vol: 0.5, ref: 1.5, max: 25, rev: 0.2 });
def('tv_off', { gen: genTvOff, sr: 'lo', vol: 0.5, ref: 1.5, max: 25, rev: 0.2 });
def('lamp_flicker', { gen: genLampFlicker, n: 2, sr: 'lo', vol: 0.3, ref: 1.5, max: 14, rev: 0.2, prio: 1 });
def('drip', { gen: genDrip, n: 3, vol: 0.3, ref: 1, max: 12, rev: 0.2, prio: 1 });
def('heartbeat', { gen: genHeartbeat, sr: 'lo', vol: 0.5, bus: 'amb', rev: 0, prio: 1, maxInst: 2, jit: 0.01 });
def('_tinnitus', { gen: genTinnitus, vol: 0.18, rev: 0, prio: 1, maxInst: 1, jit: 0.02 });
// фоновые текстуры и ТВ (внутренние)
def('_rain_bed', { gen: genRainBed }); def('_rain_drops', { gen: genRainDrops });
def('_sill', { gen: (sr, R, i) => genSill(sr, R, i === 1), n: 2 });
def('_hum', { gen: genHum }); def('_city_bed', { gen: genCityBed, sr: 'lo' }); def('_drone', { gen: genDrone, sr: 'lo' });
def('_tv_static', { gen: (sr, R) => genNoiseLoop(sr, R, 3000, 0.4, true), sr: 'vlo' });
for (const k of ['news', 'ad', 'weather', 'serial', 'sport', 'kids']) def('_jingle_' + k, { gen: (sr, R) => genJingle(sr, R, k), n: 2, sr: 'vlo' });
def('_speech_m', { gen: (sr, R) => genSpeech(sr, R, { female: false }), n: 10, sr: 'vlo', vol: 1 });
def('_speech_f', { gen: (sr, R) => genSpeech(sr, R, { female: true }), n: 10, sr: 'vlo', vol: 1 });

const SILL_PROF = { ref: 1.2, max: 14, roll: 1.2, rev: 0 };
const TV_PROF = { ref: 1.5, max: 30, roll: 1.1, rev: 0.2 };
const RADIO_SPK = { ref: 1.5, max: 25, roll: 1, rev: 0.15 };

/** Имена звуков из контракта (все обязаны существовать) */
export const CONTRACT_SOUNDS = ['shot_pm', 'shot_ak', 'shot_ks23', 'shot_tt', 'shot_sawnoff', 'ricochet', 'glass_break', 'step_lino', 'step_tile', 'step_concrete', 'step_wet',
  'door_wood', 'door_steel', 'cell_door', 'phone_ring', 'phone_pickup', 'typewriter', 'radio_squelch', 'radio_static', 'kettle', 'thunder', 'hit_flesh', 'body_fall', 'punch',
  'reload', 'empty_click', 'explosion_far', 'siren_far', 'dog_far', 'car_engine', 'car_door', 'ui_click', 'ui_paper', 'ui_stamp', 'generator_start', 'generator_stop',
  'power_down', 'alarm_bell', 'scream_m', 'scream_f', 'glass_shards', 'crowd_murmur', 'footsteps_run'];
/** Все публичные имена (контракт + дополнительные) */
export const SOUND_NAMES = Object.keys(S).filter((n) => n[0] !== '_');
/** Оружие (WEAPONS агента D) → звук выстрела */
export const WEAPON_SOUND = { pm: 'shot_pm', tt: 'shot_tt', aks74u: 'shot_ak', ak: 'shot_ak', ak74: 'shot_ak', akm: 'shot_ak', ks23: 'shot_ks23', sawnoff: 'shot_sawnoff', obrez: 'shot_sawnoff', shotgun: 'shot_shotgun' };
/** Метаданные звука (для тестов/инструментов) */
export function soundInfo(name) { const s = S[name]; return s ? { n: s.n, sr: s.sr, vol: s.vol, bus: s.bus, ref: s.ref, max: s.max, loop: s.loop || null, proc: s.proc || null } : null; }

const seedFor = (name, idx, salt) => (hashStr(name) ^ Math.imul(idx + 1, 0x9e3779b1) ^ salt) >>> 0;
const srFor = (k, hi, lo) => (k === 'hi' ? hi : k === 'lo' ? lo : 16000);
const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
/** Отрендерить звук в массив без WebAudio (для тестов в node) → {data: Float32Array | [L, R], sr} */
export function renderSound(name, idx = 0, srHi = 48000, srLo = 24000, salt = 0) {
  const s = S[name]; if (!s) return null;
  const i = ((idx % s.n) + s.n) % s.n, sr = srFor(s.sr, srHi, srLo);
  return { data: s.gen(sr, new RNG(seedFor(name, i, salt)), i), sr };
}

/** Окклюзия по сетке мира: стены глушат, окна — частично, соседние через дверь комнаты слышно лучше */
export function occlusionFromWorld(world) {
  if (!world || typeof world.toCell !== 'function' || typeof world.at !== 'function') return null;
  return (x, z, lx, lz) => {
    const dx = x - lx, dz = z - lz, len = Math.hypot(dx, dz);
    if (len < 0.3) return 0;
    const n = Math.min(400, Math.ceil(len / 0.25));
    let walls = 0, glass = 0, inW = false, inG = false, li = -1, lj = -1;
    for (let k = 1; k < n; k++) {
      const [i, j] = world.toCell(lx + dx * k / n, lz + dz * k / n);
      if (i === li && j === lj) continue; li = i; lj = j;
      const c = world.at(i, j), solid = c === '#' || c === 'O' || c === ' ', gl = c === 'W';
      if (solid && !inW) walls++; if (gl && !inG) glass++;
      inW = solid; inG = gl;
    }
    let o = walls ? 1 - Math.pow(0.4, Math.min(walls, 4)) : 0;
    if (glass) o = 1 - (1 - o) * 0.6;
    if (walls && typeof world.zoneAt === 'function' && typeof world.zoneNeighbors === 'function') {
      const za = world.zoneAt(lx, lz), zb = world.zoneAt(x, z);
      if (za !== zb && world.zoneNeighbors(za).some((q) => q.zone === zb)) o = Math.min(o, 0.42);
    }
    return o;
  };
}
function defaultGeometry() {
  const rooms = Array.isArray(ROOMS) ? ROOMS : [];
  const inside = (x, z) => { for (const r of rooms) if (x >= r.rect[0] && x <= r.rect[2] && z >= r.rect[1] && z <= r.rect[3]) return true; return false; };
  let x0 = 0, z0 = 0, x1 = 32, z1 = 20;
  if (rooms.length) { x0 = Math.min(...rooms.map((r) => r.rect[0])); z0 = Math.min(...rooms.map((r) => r.rect[1])); x1 = Math.max(...rooms.map((r) => r.rect[2])); z1 = Math.max(...rooms.map((r) => r.rect[3])); }
  const windows = (Array.isArray(WINDOWS) ? WINDOWS : []).map((w) => ({ x: (w[0] + w[2]) / 2, z: (w[1] + w[3]) / 2 }))
    .filter((w) => Math.abs(w.x - x0) < 0.8 || Math.abs(w.x - x1) < 0.8 || Math.abs(w.z - z0) < 0.8 || Math.abs(w.z - z1) < 0.8);
  const props = Array.isArray(PROPS) ? PROPS : [], tv = props.find((p) => p.type === 'tv');
  return { inside, windows, tv: tv ? { x: tv.x, z: tv.z } : { x: 9, z: 17.5 }, flicker: props.filter((p) => p.type === 'lamp_ceiling_flicker').map((p) => ({ x: p.x, z: p.z })), street: { z: z1 + 6, x0: x0 - 80, x1: x1 + 80 } };
}
function guessFemale(m, game) {
  try { const o = game && typeof game.officer === 'function' ? game.officer(m.from) : null; if (o && o.gender) return o.gender === 'f'; } catch (e) { /* нет данных */ }
  const last = String(m.fromName || '').trim().split(/\s+/).pop() || '';
  if (/(ова|ева|ёва|ина|ына|ская|цкая)$/i.test(last)) return true;
  if (m.from === 'dispatch') return hashStr(String(m.day || 0)) % 3 === 0; // дежурная по городу бывает женщиной — стабильно на сутки
  return false;
}

class LoopHandle {
  constructor(A, name, o) { this.A = A; this.name = name; this.o = o; this.s = S[name]; this.vol = o.vol ?? 1; this.x = o.x; this.z = o.z; this.rate = o.rate ?? 1; this.started = false; this.stopped = false; this.g = null; this.em = null; this.src = null; this.proc = null; }
  get playing() { return this.started && !this.stopped; }
  stop(fade = 0.25) { if (this.stopped) return; this.stopped = true; this.A._stopLoop(this, fade); }
  setVol(v, t = 0.08) { this.vol = Math.max(0, +v || 0); if (this.g && !this.stopped) this.g.gain.setTargetAtTime(this.vol * this.s.vol, this.A.ctx.currentTime, t); return this; }
  setPos(x, z) { if (!Number.isFinite(x) || !Number.isFinite(z)) return this; this.x = x; this.z = z; if (this.started && !this.stopped) this.A._loopPos(this); return this; }
  setRate(r) { this.rate = +r || 1; if (this.src) this.src.playbackRate.setTargetAtTime(this.rate, this.A.ctx.currentTime, 0.1); return this; }
}

// ═════════════════════════════ Звуковой движок ═════════════════════════════
export class Audio {
  constructor(opts = {}) {
    this.opts = opts;
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    this.lowPower = opts.lowPower ?? /Android|iPhone|iPad|Mobile/i.test(ua);
    this.maxVoices = opts.maxVoices ?? (this.lowPower ? 18 : 32);
    this.mirror = !!opts.mirror;
    this.ctx = null; this.ready = false; this.failed = false; this.offline = false;
    this.L = { x: 16, z: 12, yaw: 0 };
    this.vol = { master: 0.9, sfx: 1, ambience: 0.85, radio: 0.9 };
    this.amb = { rain: 0, hum: 0, tv: 0, power: true, tension: 0, indoor: null, window: null, city: 0.5, night: 0, storm: null };
    this.geom = defaultGeometry();
    this.occlFn = null; this.onThunder = null;
    this.rng = new RNG((opts.seed ?? ((Date.now() ^ Math.floor(Math.random() * 4294967296)) >>> 0)) >>> 0);
    this.salt = this.rng.int(0, 0xffff);
    this.cache = new Map(); this._lastVar = new Map();
    this.voices = []; this.loops = new Set(); this.emitters = new Set(); this.procs = new Set(); this.layers = {};
    this._rq = []; this._rqMap = new Map(); this._rqTimer = null;
    this._radioUntil = 0; this._autoIndoor = 0; this._autoWin = 0; this._nearWin = null; this._winE = { occT: -1 };
    this._cityNext = 0; this._thNext = 0; this._humNext = 0; this._flickNext = 0; this._pulseNext = 0; this._lastTinn = -9;
    this._luMs = 0; this._luPending = false; this._tickMs = 0; this._warned = new Set(); this.tv = null; this.sillEm = null;
    this._calcAuto();
  }
  get names() { return SOUND_NAMES.slice(); }
  get enabled() { return this.ready; }
  has(name) { return !!S[name]; }

  // ——— жизненный цикл ———
  /** Создать/разбудить AudioContext. Звать из обработчика жеста; повторные вызовы дешёвые. */
  init(context) {
    if (this.ctx) { this._resume(); return true; }
    if (this.failed && !context) return false;
    try {
      let ctx = context || this.opts.context || null;
      if (!ctx) {
        const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
        if (!AC) { this.failed = true; return false; }
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
      }
      this.ctx = ctx;
      this.offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
      this.srHi = Math.min(ctx.sampleRate, 48000); this.srLo = Math.round(this.srHi / 2);
      this._build();
      this.ready = true;
      this._applyVolumes(true);
      this._calcAuto();
      this._applyAmb(true);
      for (const h of this.loops) if (!h.started && !h.stopped) this._startLoop(h);
      if (!this.offline) {
        this._resume(); this._unlock();
        this._timer = setInterval(() => this._tick(), 90);
        if (typeof document !== 'undefined' && document.addEventListener) {
          this._vis = () => {
            if (!this.ctx) return;
            if (document.hidden) { if (this.ctx.state === 'running') { this._hidSusp = true; this.ctx.suspend().catch(() => {}); } }
            else if (this._hidSusp) { this._hidSusp = false; this._resume(); }
          };
          document.addEventListener('visibilitychange', this._vis);
        }
        if (this.opts.prewarm !== false) this._prewarm();
      }
      return true;
    } catch (e) {
      console.warn('[audio] init failed:', e);
      this.ctx = null; this.ready = false; this.failed = !context;
      return false;
    }
  }
  /** Повесить init() на первый жест пользователя */
  autoInit(target = typeof window !== 'undefined' ? window : null) {
    if (!target || !target.addEventListener) return;
    const evs = ['pointerdown', 'touchend', 'keydown', 'mousedown'];
    const fn = () => { this.init(); if (this.ctx && this.ctx.state === 'running') evs.forEach((e) => target.removeEventListener(e, fn, true)); };
    evs.forEach((e) => target.addEventListener(e, fn, true));
  }
  suspend() { this._userSusp = true; if (this.ctx && !this.offline) this.ctx.suspend().catch(() => {}); }
  resume() { this._userSusp = false; this._resume(); }
  _resume() { const c = this.ctx; if (c && !this.offline && !this._userSusp && c.state !== 'running' && c.state !== 'closed') { try { c.resume().catch(() => {}); } catch (e) { /* ignore */ } } }
  _unlock() { try { const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination); s.start(0); s.onended = () => s.disconnect(); } catch (e) { /* ignore */ } }
  dispose() {
    clearInterval(this._timer); clearTimeout(this._rqTimer); this._rq = []; this._rqMap.clear();
    if (this._vis && typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._vis);
    this.stopAll(0.01);
    if (this.ctx && !this.offline) this.ctx.close().catch(() => {});
    this.ready = false; this.ctx = null;
  }
  stopAll(fade = 0.1) {
    if (!this.ready) { this.loops.clear(); return; }
    for (const v of this.voices.slice()) this._stopVoice(v, fade);
    for (const h of [...this.loops]) h.stop(fade);
  }

  // ——— громкость ———
  /** 0..1 каждая; undefined/null — не менять. Внутри перцептивная кривая (квадрат). */
  setVolume(master, sfx, ambience, radio) {
    const v = this.vol, f = (x, d) => (x == null || !Number.isFinite(+x) ? d : clamp01(+x));
    v.master = f(master, v.master); v.sfx = f(sfx, v.sfx); v.ambience = f(ambience, v.ambience); v.radio = f(radio, v.radio);
    this._applyVolumes(false);
  }
  setMuted(m) { this._muted = !!m; this._applyVolumes(false); }
  _applyVolumes(imm) {
    if (!this.ready) return;
    const now = this.ctx.currentTime, P = (p, x) => (imm ? p.setValueAtTime(x, now) : p.setTargetAtTime(x, now, 0.05));
    P(this.master.gain, this.vol.master * this.vol.master * (this._muted ? 0 : 1));
    P(this.sfxBus.gain, this.vol.sfx * this.vol.sfx); P(this.ambBus.gain, this.vol.ambience * this.vol.ambience); P(this.radioBus.gain, this.vol.radio * this.vol.radio);
  }

  // ——— слушатель и геометрия ———
  setListener(x, z, yaw = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.L.x = x; this.L.z = z; this.L.yaw = Number.isFinite(yaw) ? yaw : 0;
    if (!this.ready) { this._calcAuto(); return; }
    const t = nowMs();
    if (!this.offline && t - this._luMs < 30) { this._luPending = true; return; }
    this._luMs = t; this._luPending = false;
    for (const e of this.emitters) this._updEmitter(e);
    const pi = this._autoIndoor, pw = this._autoWin, pn = this._nearWin;
    this._calcAuto();
    if (pi !== this._autoIndoor || Math.abs(pw - this._autoWin) > 0.04 || pn !== this._nearWin) this._applyAmb(false);
  }
  /** fn(x, z, listenerX, listenerZ) → 0..1. null — по умолчанию (внутри/снаружи здания). */
  setOcclusionFn(fn) { this.occlFn = typeof fn === 'function' ? fn : null; for (const e of this.emitters) e.occT = -1; this._winE.occT = -1; }
  /** Переопределить геометрию: {inside(x,z), windows:[{x,z}], tv:{x,z}, flicker:[{x,z}], street:{z,x0,x1}} */
  setGeometry(g = {}) { Object.assign(this.geom, g); this._calcAuto(); if (this.ready) this._applyAmb(false); }
  setTvPos(x, z) { this.geom.tv = { x, z }; if (this.tv) { this.tv.em.x = x; this.tv.em.z = z; this._updEmitter(this.tv.em); } }
  _calcAuto() {
    const L = this.L, g = this.geom;
    this._autoIndoor = g.inside(L.x, L.z) ? 1 : 0;
    let best = 0, near = null, nd = Infinity;
    for (const w of g.windows) { const d = Math.hypot(w.x - L.x, w.z - L.z); if (d < nd) { nd = d; near = w; } }
    if (near) { best = clamp01(1 - (nd - 1) / 6); if (best > 0 && this._autoIndoor) best *= 1 - 0.8 * this._occl(near.x, near.z, this._winE); }
    this._autoWin = best; this._nearWin = near;
  }

  // ——— одиночные звуки ———
  /** play(name, {x, z, vol, rate, delay}) → {stop(fade), playing, duration} | null */
  play(name, o = {}) {
    if (!this.ready) return null;
    const s = S[name];
    if (!s) { if (!this._warned.has(name)) { this._warned.add(name); console.warn('[audio] неизвестный звук:', name); } return null; }
    try {
      const c = this.ctx, now = c.currentTime, t0 = now + Math.max(0, +o.delay || 0), vol = (o.vol ?? 1) * s.vol;
      const pos = Number.isFinite(o.x) && Number.isFinite(o.z);
      let sp = null;
      if (pos) { sp = this._spatial(o.x, o.z, s, null); if (sp.g * vol < 0.0012 && sp.wi + sp.wo < 0.01) return null; }
      if (!this._admit(name, s)) return null;
      const buf = this._getBuf(name); if (!buf) return null;
      const src = c.createBufferSource(); src.buffer = buf;
      const rate = (o.rate ?? 1) * (1 + (this.rng.next() * 2 - 1) * s.jit);
      src.playbackRate.value = rate;
      const g = this._G(vol); src.connect(g);
      const v = { name, s, src, g, t0, prio: s.prio, em: null, extra: null, dead: false, dying: false, end: t0 + buf.duration / rate };
      if (pos) { v.em = this._emitter(o.x, o.z, s, this._bus(s)); g.connect(v.em.input); }
      else if (s.bus === 'city') { const p = this._mkPan(); p.set((this.rng.next() * 2 - 1) * 0.7); g.connect(p.node); p.node.connect(this.cityIn); v.extra = [p.node]; }
      else g.connect(this._bus(s));
      src.onended = () => this._release(v);
      src.start(t0);
      this.voices.push(v);
      if (s.cat === 'shot') this._shotFx(s, pos ? sp.g : 1, t0);
      return { stop: (f = 0.05) => this._stopVoice(v, f), get playing() { return !v.dead; }, duration: buf.duration / rate };
    } catch (e) { console.warn('[audio] play', name, e); return null; }
  }
  _admit(name, s) {
    const now = this.ctx.currentTime;
    let live = 0, same = 0, oldest = null, victim = null;
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v.end < now - 0.5) { this._release(v); continue; }
      if (v.dying) continue;
      live++;
      if (v.name === name) { same++; if (!oldest || v.t0 < oldest.t0) oldest = v; }
      if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.t0 < victim.t0)) victim = v;
    }
    if (same >= s.maxInst && oldest) { this._stopVoice(oldest, 0.03); live--; if (victim === oldest) victim = null; }
    if (live >= this.maxVoices) { if (victim && victim.prio <= s.prio) this._stopVoice(victim, 0.03); else return false; }
    return true;
  }
  _stopVoice(v, f = 0.05) {
    if (v.dying || v.dead) return; v.dying = true;
    const now = this.ctx.currentTime;
    try { const p = v.g.gain; p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); p.linearRampToValueAtTime(0, now + f); v.src.stop(now + f + 0.01); } catch (e) { this._release(v); }
    v.end = Math.min(v.end, now + f + 0.02);
  }
  _release(v) {
    if (v.dead) return; v.dead = true;
    const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1);
    try { v.src.onended = null; v.src.disconnect(); } catch (e) { /* */ }
    try { v.g.disconnect(); } catch (e) { /* */ }
    if (v.extra) for (const n of v.extra) try { n.disconnect(); } catch (e) { /* */ }
    this._freeEmitter(v.em);
  }
  _shotFx(s, loud, t) {
    if (loud > 0.3) this._duck(Math.min(0.55, loud * 0.45), 0.1, t);
    const now = this.ctx.currentTime;
    if (s.big && loud > 0.85 && this.opts.tinnitus !== false && now - this._lastTinn > 2.5) { this._lastTinn = now; this.play('_tinnitus', { vol: loud, delay: t - now + 0.05 }); }
  }
  _duck(depth, hold, t) { const p = this.ambDuck.gain, at = Math.max(t ?? 0, this.ctx.currentTime); p.cancelScheduledValues(at); p.setTargetAtTime(1 - depth, at, 0.008); p.setTargetAtTime(1, at + hold, 0.7); }

  // ——— петли ———
  /** loop(name, {x, z, vol, rate, delay, fadeIn, surface}) → {stop(fade), setVol(v), setPos(x,z), setRate(r), playing}. До init — отложен. */
  loop(name, o = {}) {
    const h = new LoopHandle(this, name, o);
    if (!S[name]) { if (!this._warned.has(name)) { this._warned.add(name); console.warn('[audio] неизвестный звук:', name); } h.stopped = true; return h; }
    this.loops.add(h);
    if (this.ready) this._startLoop(h);
    return h;
  }
  _startLoop(h) {
    if (h.started || h.stopped) return;
    try {
      const s = h.s, c = this.ctx, t0 = c.currentTime + Math.max(0, +h.o.delay || 0);
      h.started = true; h.g = this._G(0);
      if (Number.isFinite(h.x) && Number.isFinite(h.z)) { h.em = this._emitter(h.x, h.z, s, this._bus(s)); h.g.connect(h.em.input); } else h.g.connect(this._bus(s));
      h.g.gain.setValueAtTime(0, t0); h.g.gain.linearRampToValueAtTime(h.vol * s.vol, t0 + Math.max(0.02, h.o.fadeIn ?? 0.05));
      if (s.proc) { h.proc = { kind: s.proc, next: t0, st: {} }; this.procs.add(h); return; }
      const bn = s.loop || h.name, b = this._getBuf(bn, 0); if (!b) return;
      const src = c.createBufferSource(); src.buffer = b; src.loop = true; src.playbackRate.value = h.rate;
      src.connect(h.g); src.start(t0, h.o.offset ?? 0); h.src = src;
    } catch (e) { console.warn('[audio] loop', h.name, e); }
  }
  _stopLoop(h, fade) {
    if (!h.started || !this.ready) { this.loops.delete(h); return; }
    const now = this.ctx.currentTime, f = Math.max(0.01, fade);
    try { const p = h.g.gain; p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); p.linearRampToValueAtTime(0, now + f); } catch (e) { /* */ }
    this.procs.delete(h);
    if (h.src) { h.src.onended = () => this._freeLoop(h); try { h.src.stop(now + f + 0.03); } catch (e) { this._freeLoop(h); } }
    else if (this.offline) this._freeLoop(h);
    else setTimeout(() => this._freeLoop(h), (f + 1.5) * 1000);
  }
  _freeLoop(h) { if (h._freed) return; h._freed = true; try { if (h.src) h.src.disconnect(); h.g.disconnect(); } catch (e) { /* */ } this._freeEmitter(h.em); this.loops.delete(h); }
  _loopPos(h) {
    if (h.em) { h.em.x = h.x; h.em.z = h.z; this._updEmitter(h.em); return; }
    try { h.g.disconnect(); h.em = this._emitter(h.x, h.z, h.s, this._bus(h.s)); h.g.connect(h.em.input); } catch (e) { /* */ }
  }
  _procStep(h, t) {
    const R = this.rng, st = h.proc.st;
    if (h.proc.kind === 'run') {
      const surf = h.o.surface || st.surf || (st.surf = R.pick(['concrete', 'lino', 'tile']));
      st.k = (st.k || 0) + 1;
      this._sub(h, S['step_' + surf] ? 'step_' + surf : 'step_concrete', t, R.range(0.9, 1.15) * (st.k % 2 ? 0.85 : 1), 1.08);
      return R.range(0.27, 0.32) / (h.rate || 1);
    }
    if (st.col == null) { st.col = R.int(0, 30); st.word = R.int(2, 8); }
    if (st.ret) { st.ret = false; st.col = 0; this._sub(h, '_tw_return', t, 1); return R.range(0.9, 1.6); }
    if (st.word > 0) {
      this._sub(h, '_tw_key', t, R.range(0.7, 1)); st.word--; st.col++;
      if (st.col === 56) this._sub(h, '_tw_bell', t + 0.03, 0.7);
      if (st.col >= 62) { st.ret = true; st.word = 0; return R.range(0.25, 0.5); }
      return R.range(0.075, 0.16) * (R.chance(0.08) ? 2.5 : 1);
    }
    this._sub(h, '_tw_space', t, 0.8); st.col++; st.word = R.int(1, 9);
    if (R.chance(0.06)) return R.range(1.2, 4.0);
    if (R.chance(0.025)) st.ret = true;
    return R.range(0.12, 0.25);
  }
  _sub(h, name, t, vol = 1, rate = 1) {
    if (!h.g) return;
    const b = this._getBuf(name); if (!b) return;
    const c = this.ctx, s = c.createBufferSource(), g = this._G(vol * S[name].vol / (h.s.vol || 1));
    s.buffer = b; s.playbackRate.value = rate * (1 + this.rng.range(-0.03, 0.03));
    s.connect(g); g.connect(h.g); s.onended = () => { try { s.disconnect(); g.disconnect(); } catch (e) { /* */ } };
    s.start(Math.max(t, c.currentTime));
  }

  // ——— атмосфера ———
  /** Частичное обновление: {rain, hum, tv, power, tension, indoor, window, city, night, storm}. Переходы плавные. */
  ambience(p = {}) {
    if (!p || typeof p !== 'object') return;
    for (const k of Object.keys(p)) if (k in this.amb) this.amb[k] = k === 'power' ? p[k] !== false : p[k];
    if (this.ready) this._applyAmb(false);
  }
  _applyAmb(imm) {
    if (!this.ready) return;
    const a = this.amb, now = this.ctx.currentTime;
    const indoor = a.indoor == null ? this._autoIndoor : clamp01(+a.indoor), win = a.window == null ? this._autoWin : clamp01(+a.window);
    const o = clamp01(1 - indoor * (1 - 0.55 * win)); // «открытость» к улице
    const T = (p, v, tau) => { if (imm) { p.cancelScheduledValues(now); p.setValueAtTime(v, now); } else p.setTargetAtTime(v, now, tau); };
    const r = clamp01(+a.rain || 0);
    this._layer('rainBed', '_rain_bed', 0, this.rainIn, Math.pow(r, 1.3) * 0.95, 1.2, imm);
    this._layer('rainDrops', '_rain_drops', 0, this.rainIn, r > 0 ? (0.35 + 0.65 * r) * Math.min(1, r * 3) * 0.7 : 0, 1.2, imm);
    T(this.rainLP.frequency, 600 * Math.pow(16000 / 600, Math.pow(o, 1.3)), 0.25);
    T(this.rainGain.gain, 0.2 + 0.8 * o, 0.25);
    if (this._nearWin && r > 0) {
      if (!this.sillEm) { this.sillEm = this._emitter(this._nearWin.x, this._nearWin.z, SILL_PROF, this.ambBus); this.sillLP.connect(this.sillEm.input); }
      else if (this.sillEm.x !== this._nearWin.x || this.sillEm.z !== this._nearWin.z) { this.sillEm.x = this._nearWin.x; this.sillEm.z = this._nearWin.z; this._updEmitter(this.sillEm); }
    }
    this._layer('sillA', '_sill', 0, this.sillLP, r > 0 ? Math.min(1, r * 4) * 0.6 : 0, 1.0, imm);
    this._layer('sillB', '_sill', 1, this.sillLP, r * r * 0.5, 1.0, imm);
    T(this.sillLP.frequency, indoor > 0.5 ? 3500 : 12000, 0.2);
    const hum = a.power ? clamp01(+a.hum || 0) : 0;
    this._layer('hum', '_hum', 0, this.humFlut, hum * 0.2, a.power ? 0.6 : 0.06, imm);
    this._tvSet(a.power ? clamp01(+a.tv || 0) : 0, !a.power);
    const city = clamp01(a.city == null ? 0.5 : +a.city);
    this._layer('cityBed', '_city_bed', 0, this.cityIn, city > 0 ? (0.3 + 0.7 * city) * 0.35 : 0, 1.5, imm);
    T(this.cityLP.frequency, 650 * Math.pow(14000 / 650, Math.pow(o, 1.2)), 0.25);
    T(this.cityGain.gain, 0.35 + 0.65 * o, 0.25);
    const te = clamp01(+a.tension || 0);
    this._layer('drone', '_drone', 0, this.droneLP, Math.pow(te, 1.4) * 0.6, 2, imm);
    T(this.droneLP.frequency, 160 + 2400 * Math.pow(te, 1.6), 1.5);
    this._outness = o;
  }
  _layer(key, name, idx, dest, vol, tau, imm) {
    let L = this.layers[key]; const now = this.ctx.currentTime;
    if (!L) { if (vol <= 0.0005) return; L = this.layers[key] = { g: this._G(0), src: null, zeroAt: 0, tau, want: 0, pending: false }; L.g.connect(dest); }
    L.want = vol; L.tau = tau;
    if (vol > 0.0005) {
      L.zeroAt = 0;
      if (!L.src && !L.pending) {
        L.pending = true;
        this._queue(name, idx, (b) => {
          L.pending = false;
          if (L.src || L.want <= 0.0005 || !this.ready) return;
          const s = this.ctx.createBufferSource(); s.buffer = b; s.loop = true; s.connect(L.g);
          s.start(this.ctx.currentTime + 0.005, this.rng.next() * b.duration * 0.95); L.src = s;
          L.g.gain.setTargetAtTime(L.want, this.ctx.currentTime, Math.min(L.tau, 0.8));
        }, true);
      }
    } else if (L.src && !L.zeroAt) L.zeroAt = now;
    if (imm && L.src) { L.g.gain.cancelScheduledValues(now); L.g.gain.setValueAtTime(vol, now); } else L.g.gain.setTargetAtTime(vol, now, tau);
  }
  _storm() { const a = this.amb; return a.storm != null ? clamp01(+a.storm) : clamp01((clamp01(+a.rain || 0) - 0.55) / 0.45); }

  // ——— ТВ ———
  _tvSet(level, cut) {
    const now = this.ctx.currentTime;
    if (level > 0.001) { if (!this.tv) this._tvStart(); this.tv.offAt = 0; this.tv.vol.gain.setTargetAtTime(level * 0.9, now, 0.15); }
    else if (this.tv && !this.tv.offAt) {
      this.tv.offAt = now; this.tv.vol.gain.setTargetAtTime(0, now, cut ? 0.015 : 0.05);
      if (!cut) this.play('tv_off', { x: this.geom.tv.x, z: this.geom.tv.z, vol: 0.7 });
    }
  }
  _tvStart() {
    const now = this.ctx.currentTime, p = this.geom.tv;
    const tv = { in: this._G(1), hp: this._F('highpass', 200, 0.7), pk: this._F('peaking', 2500, 1, 4), lp: this._F('lowpass', 5200, 0.7), vol: this._G(0), srcs: new Set(), plan: [], next: now + 0.7, offAt: 0 };
    tv.em = this._emitter(p.x, p.z, TV_PROF, this.ambBus);
    tv.in.connect(tv.hp); tv.hp.connect(tv.pk); tv.pk.connect(tv.lp); tv.lp.connect(tv.vol); tv.vol.connect(tv.em.input);
    this.tv = tv;
    this.play('tv_on', { x: p.x, z: p.z, vol: 0.6 });
    this._tvPlay('_tv_static', now + 0.2, 0.2, 1, 0.5);
  }
  _tvStop() {
    const tv = this.tv; if (!tv) return; this.tv = null;
    for (const s of tv.srcs) try { s.onended = null; s.stop(); s.disconnect(); } catch (e) { /* */ }
    for (const n of [tv.in, tv.hp, tv.pk, tv.lp, tv.vol]) try { n.disconnect(); } catch (e) { /* */ }
    this._freeEmitter(tv.em);
  }
  _tvPlay(name, t, vol = 1, rate = 1, dur = 0) {
    const tv = this.tv; if (!tv) return 0;
    const b = this._getBuf(name); if (!b) return 0;
    const s = this.ctx.createBufferSource(), g = this._G(vol);
    s.buffer = b; s.playbackRate.value = rate; s.connect(g); g.connect(tv.in);
    let len = b.duration / rate;
    if (dur > 0) { if (dur > len) s.loop = true; len = dur; g.gain.setValueAtTime(vol, t + Math.max(0, dur - 0.3)); g.gain.linearRampToValueAtTime(0, t + dur); s.stop(t + dur + 0.02); }
    s.onended = () => { tv.srcs.delete(s); try { s.disconnect(); g.disconnect(); } catch (e) { /* */ } };
    tv.srcs.add(s); s.start(t);
    return len;
  }
  _tvPlan() {
    const R = this.rng, P = [], A = R.chance(0.5) ? 'f' : 'm', B = A === 'f' ? 'm' : 'f';
    const k = R.weighted([{ k: 'news', w: 3 }, { k: 'ad', w: 2 }, { k: 'serial', w: 2 }, { k: 'talk', w: 2 }, { k: 'sport', w: 1 }, { k: 'weather', w: 1 }, { k: 'kids', w: 0.6 }]).k;
    const sp = (g, rate = 1, vol = 1) => P.push({ t: 'speech', g, rate: rate * R.range(0.95, 1.05), vol });
    const pa = (a, b) => P.push({ t: 'pause', d: R.range(a, b) });
    if (k === 'news') { P.push({ t: 'jingle', k: 'news' }); pa(0.2, 0.4); for (let i = R.int(6, 12); i > 0; i--) { sp(A); pa(0.15, 0.5); if (R.chance(0.15)) { sp(B, 1.05, 0.8); pa(0.2, 0.4); } } }
    else if (k === 'ad') { P.push({ t: 'jingle', k: 'ad' }); sp(R.pick(['m', 'f']), 1.18); pa(0.05, 0.15); sp(R.pick(['m', 'f']), 1.18); P.push({ t: 'jingle', k: 'ad', vol: 0.7 }); }
    else if (k === 'serial') { P.push({ t: 'jingle', k: 'serial', vol: 0.6 }); for (let i = R.int(6, 12); i > 0; i--) { sp(i % 2 ? A : B, R.range(0.9, 1.04)); pa(0.3, 1.4); } }
    else if (k === 'talk') { for (let i = R.int(8, 14); i > 0; i--) { sp(R.chance(0.6) ? 'm' : 'f', R.range(0.94, 1.06)); pa(0.2, 0.9); } }
    else if (k === 'sport') { P.push({ t: 'jingle', k: 'sport' }, { t: 'bed', name: '_crowd_loop', vol: 0.35, d: 24 }); for (let i = R.int(8, 14); i > 0; i--) { sp('m', 1.22); pa(0.05, 0.3); } }
    else if (k === 'weather') { P.push({ t: 'jingle', k: 'weather', vol: 0.7 }, { t: 'bed', name: '_jingle_weather', vol: 0.2, d: 14 }); for (let i = R.int(3, 5); i > 0; i--) { sp('f'); pa(0.2, 0.5); } }
    else { P.push({ t: 'jingle', k: 'kids' }); for (let i = R.int(3, 6); i > 0; i--) { sp(R.chance(0.7) ? 'f' : 'm', 1.12); pa(0.2, 0.6); } }
    pa(0.5, 1.2);
    return P;
  }
  _tvTick(now, until) {
    const tv = this.tv; if (!tv) return;
    if (tv.offAt) { if (now - tv.offAt > 0.5 || this.offline) this._tvStop(); return; }
    if (tv.next < now - 0.5) tv.next = now + 0.1;
    let g = 0;
    while (tv.next < until && g++ < 64) {
      if (!tv.plan.length) tv.plan = this._tvPlan();
      const it = tv.plan.shift(); let d = 0;
      if (it.t === 'pause') d = it.d;
      else if (it.t === 'jingle') d = this._tvPlay('_jingle_' + it.k, tv.next, it.vol ?? 0.8);
      else if (it.t === 'speech') d = this._tvPlay(it.g === 'f' ? '_speech_f' : '_speech_m', tv.next, it.vol ?? 1, it.rate ?? 1);
      else if (it.t === 'bed') this._tvPlay(it.name, tv.next, it.vol, 1, it.d);
      tv.next += d;
    }
  }

  // ——— далёкий город ———
  _cityTick(now, until) {
    const a = this.amb, city = clamp01(a.city == null ? 0.5 : +a.city), te = clamp01(+a.tension || 0), R = this.rng;
    if (city > 0) {
      if (!this._cityNext || this._cityNext < now - 1) this._cityNext = now + R.range(2, 8);
      let g = 0;
      while (this._cityNext < until && g++ < 4) { this._cityEvent(this._cityNext, te); this._cityNext += R.range(0.3, 1.7) * 16 / (0.25 + city * 1.2) * (1 - 0.4 * te); }
    } else this._cityNext = 0;
    const st = this._storm();
    if (st > 0.01) {
      if (!this._thNext || this._thNext < now - 1) this._thNext = now + R.range(6, 25) / (0.3 + st);
      let g = 0;
      while (this._thNext < until && g++ < 4) { this._thunder(this._thNext, st); this._thNext += R.range(18, 70) / (0.3 + st); }
    } else this._thNext = 0;
  }
  _cityEvent(t, te) {
    const R = this.rng, n = clamp01(+this.amb.night || 0), az = R.range(-Math.PI, Math.PI);
    const ev = R.weighted([{ k: 'siren', w: 1 + te }, { k: 'dog', w: 1.2 * (0.6 + n) }, { k: 'car', w: 1.6 * (1 - 0.6 * n) }, { k: 'shot', w: 0.22 + te * 1.2 + n * 0.2 },
      { k: 'burst', w: 0.08 + te }, { k: 'train', w: 0.35 }, { k: 'crow', w: 0.5 * (1 - n) * (1 - this._storm()) }, { k: 'boom', w: 0.02 + te * 0.15 }]).k;
    if (ev === 'car') return this._carPass(t);
    if (ev === 'shot') { let tt = t; for (let i = R.int(1, 3); i > 0; i--) { this._farPlay('_far_shot', tt, az, R.range(0.4, 0.8)); tt += R.range(0.3, 1.2); } return; }
    if (ev === 'burst') { let tt = t; for (let b = R.int(1, 3); b > 0; b--) { for (let i = R.int(3, 7); i > 0; i--) { this._farPlay('_far_ak', tt, az, R.range(0.45, 0.7)); tt += 0.085 + R.range(-0.006, 0.006); } tt += R.range(0.4, 1.5); } return; }
    this._farPlay({ siren: 'siren_far', dog: 'dog_far', train: 'train_far', crow: 'crow_far', boom: 'explosion_far' }[ev], t, az, R.range(0.5, 1));
  }
  _sideOf(x, z) {
    const L = this.L, dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz) || 1, fz = Math.cos(L.yaw), fx = Math.sin(L.yaw);
    return ((dx * -fz + dz * fx) / d) * (this.mirror ? -1 : 1);
  }
  _farPlay(name, t, az, vol = 1, idx) {
    const b = this._getBuf(name, idx); if (!b) return;
    const c = this.ctx, s = c.createBufferSource(), g = this._G(vol * S[name].vol), p = this._mkPan();
    s.buffer = b; s.playbackRate.value = 1 + this.rng.range(-0.04, 0.04);
    p.set(clampv(this._sideOf(this.L.x + Math.sin(az) * 100, this.L.z + Math.cos(az) * 100) * 0.75, -1, 1));
    s.connect(g); g.connect(p.node); p.node.connect(this.cityIn);
    s.onended = () => { try { s.disconnect(); g.disconnect(); p.node.disconnect(); } catch (e) { /* */ } };
    s.start(Math.max(t, c.currentTime));
  }
  _carPass(t) {
    const b = this._getBuf('car_pass'); if (!b) return;
    const c = this.ctx, st = this.geom.street, L = this.L, s = c.createBufferSource(), p = this._mkPan(), dir = this.rng.chance(0.5) ? 1 : -1;
    const g = this._G(S.car_pass.vol * this.rng.range(0.6, 1) * clampv(10 / Math.max(10, Math.abs(L.z - st.z)), 0.2, 1));
    s.buffer = b; s.connect(g); g.connect(p.node); p.node.connect(this.cityIn);
    const t0 = Math.max(t, c.currentTime), dur = b.duration;
    if (p.param) for (let k = 0; k <= 6; k++) { const v = clampv(this._sideOf(L.x + dir * (k / 6 - 0.5) * 80, st.z) * 0.85, -1, 1); if (k === 0) p.param.setValueAtTime(v, t0); else p.param.linearRampToValueAtTime(v, t0 + dur * k / 6); }
    s.onended = () => { try { s.disconnect(); g.disconnect(); p.node.disconnect(); } catch (e) { /* */ } };
    s.start(t0);
  }
  _thunder(t, st) {
    const R = this.rng, near = R.chance(0.15 + st * 0.3), delay = near ? R.range(0.05, 0.5) : R.range(1.5, 6), now = this.ctx.currentTime;
    if (typeof this.onThunder === 'function') { try { this.onThunder({ flashIn: Math.max(0, t - now), soundIn: Math.max(0, t - now) + delay, near, intensity: st }); } catch (e) { console.warn(e); } }
    this._farPlay('thunder', t + delay, R.range(-Math.PI, Math.PI), near ? 1 : R.range(0.55, 0.85), near ? R.pick([0, 2]) : R.pick([1, 3]));
  }
  _humTick(now, until) {
    const L = this.layers.hum; if (!L || !L.src || L.want <= 0.0005) return;
    if (now >= this._humNext) { this.humFlut.gain.setTargetAtTime(this.rng.range(0.82, 1.08), now, this.rng.range(0.1, 0.6)); this._humNext = now + this.rng.range(0.3, 1.8); }
    if (this.geom.flicker.length) {
      if (!this._flickNext || this._flickNext < now - 1) this._flickNext = now + this.rng.range(5, 20);
      if (this._flickNext < until) { const f = this.rng.pick(this.geom.flicker); this.play('lamp_flicker', { x: f.x, z: f.z, vol: this.rng.range(0.4, 0.9) * L.want / 0.2, delay: this._flickNext - now }); this._flickNext += this.rng.range(8, 40); }
    }
  }
  _tensionTick(now, until) {
    const te = clamp01(+this.amb.tension || 0);
    if (te < 0.55) { this._pulseNext = 0; return; }
    if (!this._pulseNext || this._pulseNext < now - 0.5) this._pulseNext = now + 0.1;
    let g = 0;
    while (this._pulseNext < until && g++ < 8) { this.play('heartbeat', { vol: (te - 0.5) * 1.4, delay: this._pulseNext - now }); this._pulseNext += 60 / (58 + 50 * te); }
  }

  // ——— рация ———
  /** 'open' — тангента и несущая, 'close' — хвост шумоподавителя, 'static' — треск, 'alarm' — тревожный вызов */
  radioBurst(kind = 'open', o = {}) {
    const name = { open: '_radio_open', close: 'radio_squelch', static: 'radio_static', alarm: '_radio_alarm' }[kind] || 'radio_squelch';
    return this.play(name, o);
  }
  /** Речеподобное бормотание по рации на durationSec (под текст в ленте). Сообщения встают в очередь эфира. */
  radioVoice(durationSec = 2, o = {}) {
    const dur = clampv(+durationSec || 2, 0.3, 30), dummy = { stop() {}, duration: dur, startsIn: 0, playing: false };
    if (!this.ready) return dummy;
    try {
      const c = this.ctx, now = c.currentTime, R = this.rng, bursts = o.bursts !== false;
      if (this._radioUntil - now > (o.maxQueue ?? 10)) return dummy; // эфир забит — не копим отставание от текста
      let t = Math.max(now + 0.03, this._radioUntil + 0.15);
      const start = t, pos = Number.isFinite(o.x) && Number.isFinite(o.z);
      const em = pos ? this._emitter(o.x, o.z, RADIO_SPK, this.radioBus) : null;
      const chain = pos ? this._radioChain(em.input) : null, direct = pos ? em.input : this.radioBus;
      const vg = this._G((o.vol ?? 1) * 0.9); vg.connect(pos ? chain.input : this.radio.input);
      const srcs = [], nodes = [vg];
      const at = (b, when, gain, dest, rate = 1, stopAt = 0, loop = false) => {
        const s = c.createBufferSource(), g = this._G(gain); s.buffer = b; s.loop = loop; s.playbackRate.value = rate;
        s.connect(g); g.connect(dest); s.start(when);
        if (stopAt) { g.gain.setValueAtTime(gain, Math.max(when, stopAt - 0.03)); g.gain.linearRampToValueAtTime(0, stopAt); s.stop(stopAt + 0.01); }
        s.onended = () => { try { s.disconnect(); g.disconnect(); } catch (e) { /* */ } };
        srcs.push(s); return g;
      };
      const vb = (o.vol ?? 1);
      if (bursts) { const b = this._getBuf('_radio_open'); if (b) at(b, t, S._radio_open.vol * vb, direct); t += 0.12; }
      const end = t + dur;
      const hb = this._getBuf('_radio_hiss');
      if (hb) { const hg = at(hb, t, 0, vg, 1, 0, true); hg.gain.setValueAtTime(0, t); hg.gain.linearRampToValueAtTime(0.06, t + 0.05); hg.gain.setValueAtTime(0.06, end); hg.gain.linearRampToValueAtTime(0, end + 0.03); srcs[srcs.length - 1].stop(end + 0.05); }
      const pool = o.female ? '_speech_f' : '_speech_m', base = (o.urgent ? 1.12 : 1) * R.range(0.97, 1.03);
      let tt = t + 0.04, guard = 0;
      while (tt < end - 0.2 && guard++ < 40) {
        const b = this._getBuf(pool); if (!b) break;
        const rate = base * R.range(0.97, 1.03), len = b.duration / rate;
        at(b, tt, 1, vg, rate, tt + len > end ? end : 0);
        tt += len + R.range(0.06, 0.25);
      }
      if (o.bad || R.chance(0.2)) { // провалы связи
        let td = t + R.range(0.2, 0.6);
        for (let k = R.int(1, 2); k > 0 && td < end - 0.3; k--) { const d = R.range(0.05, 0.15); vg.gain.setValueAtTime(vg.gain.value, td); vg.gain.linearRampToValueAtTime(0.12, td + 0.02); vg.gain.setValueAtTime(0.12, td + d); vg.gain.linearRampToValueAtTime((o.vol ?? 1) * 0.9, td + d + 0.02); td += d + R.range(0.4, 1.2); }
      }
      if (bursts) { const b = this._getBuf('radio_squelch'); if (b) at(b, end + 0.01, S.radio_squelch.vol * vb, direct); }
      const total = end + (bursts ? 0.3 : 0.05);
      this._radioUntil = total;
      const free = () => { for (const n of nodes) try { n.disconnect(); } catch (e) { /* */ } if (chain) for (const n of chain.nodes) try { n.disconnect(); } catch (e) { /* */ } this._freeEmitter(em); };
      if (!this.offline) setTimeout(free, (total - now) * 1000 + 600);
      let stopped = false;
      return {
        duration: total - now, startsIn: start - now, get playing() { return !stopped && c.currentTime < total; },
        stop: () => {
          if (stopped) return; stopped = true;
          const n2 = c.currentTime;
          for (const s of srcs) try { s.stop(n2 + 0.03); } catch (e) { /* */ }
          vg.gain.cancelScheduledValues(n2); vg.gain.setTargetAtTime(0, n2, 0.01);
          if (this._radioUntil === total) this._radioUntil = n2;
          if (bursts && n2 >= start) this.radioBurst('close', pos ? { x: o.x, z: o.z } : {});
        },
      };
    } catch (e) { console.warn('[audio] radioVoice', e); return dummy; }
  }

  // ——— интеграция с игрой (необязательно) ———
  /** Подписки на шину: 'shot' {x,z,weapon,sound?}, 'power' {on}, 'radio' {msg}, 'attack:start/end'. Возвращает функцию отписки. */
  bindBus(bus, game = null, opt = {}) {
    if (!bus || typeof bus.on !== 'function') return () => {};
    const on = (k) => opt[k] !== false, offs = [];
    if (on('shots')) offs.push(bus.on('shot', (p) => { if (!p) return; const name = p.sound && S[p.sound] ? p.sound : WEAPON_SOUND[p.weapon] || 'shot_pm'; this.play(name, Number.isFinite(p.x) ? { x: p.x, z: p.z } : {}); }));
    if (on('power')) offs.push(bus.on('power', (p) => { const v = typeof p === 'boolean' ? p : !(p && p.on === false); if (!v && this.amb.power) this.play('power_down'); this.ambience({ power: v }); }));
    if (on('radio')) offs.push(bus.on('radio', (p) => {
      const m = (p && p.msg) || p; if (!m || typeof m.text !== 'string') return;
      const urgent = m.kind === 'alarm'; if (urgent) this.radioBurst('alarm');
      this.radioVoice(clampv(m.text.length * 0.055, 0.9, 7), { female: guessFemale(m, game), urgent });
    }));
    if (on('tension')) {
      offs.push(bus.on('attack:start', () => this.ambience({ tension: Math.max(0.85, +this.amb.tension || 0) })));
      offs.push(bus.on('attack:end', () => this.ambience({ tension: 0.2 })));
    }
    return () => offs.forEach((f) => { try { if (f) f(); } catch (e) { /* */ } });
  }
  /** Звать из игрового цикла (необязательно): надёжнее setInterval, когда вкладку троттлят */
  update() { if (this.ready && nowMs() - this._tickMs > 60) this._tick(); }

  // ——— внутреннее: граф ———
  _G(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  _F(type, f, q = 0.707, gain) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; if (gain != null) b.gain.value = gain; return b; }
  _build() {
    const c = this.ctx, lim = (this.limiter = c.createDynamicsCompressor());
    lim.threshold.value = -6; lim.knee.value = 4; lim.ratio.value = 14; lim.attack.value = 0.002; lim.release.value = 0.2;
    this.master = this._G(0); this.master.connect(lim); lim.connect(c.destination);
    this.sfxBus = this._G(1); this.sfxBus.connect(this.master);
    this.ambBus = this._G(1); this.ambDuck = this._G(1); this.ambBus.connect(this.ambDuck); this.ambDuck.connect(this.master);
    this.radioBus = this._G(1); this.radioBus.connect(this.master);
    const sr = c.sampleRate;
    this.revInSend = this._G(1); this.revOutSend = this._G(1);
    this.convIn = c.createConvolver(); this.convIn.buffer = this._toBuf(genIR(sr, new RNG(7701), 'in', this.lowPower), sr);
    this.convOut = c.createConvolver(); this.convOut.buffer = this._toBuf(genIR(sr, new RNG(7702), 'out', this.lowPower), sr);
    this.revInRet = this._G(0.55); this.revOutRet = this._G(0.5);
    this.revInSend.connect(this.convIn); this.convIn.connect(this.revInRet); this.revInRet.connect(this.sfxBus);
    this.revOutSend.connect(this.convOut); this.convOut.connect(this.revOutRet); this.revOutRet.connect(this.sfxBus);
    this.radio = this._radioChain(this.radioBus);
    this.cityIn = this._G(1); this.cityLP = this._F('lowpass', 12000, 0.5); this.cityGain = this._G(1);
    this.cityIn.connect(this.cityLP); this.cityLP.connect(this.cityGain); this.cityGain.connect(this.ambBus);
    this.rainIn = this._G(1); this.rainLP = this._F('lowpass', 16000, 0.5); this.rainGain = this._G(0.5);
    this.rainIn.connect(this.rainLP); this.rainLP.connect(this.rainGain); this.rainGain.connect(this.ambBus);
    this.humFlut = this._G(1); this.humFlut.connect(this.ambBus);
    this.droneLP = this._F('lowpass', 200, 0.6); this.droneLP.connect(this.ambBus);
    this.sillLP = this._F('lowpass', 12000, 0.5);
  }
  _radioChain(dest) {
    const inp = this._G(1), hp = this._F('highpass', 380, 0.7), pk = this._F('peaking', 1700, 0.9, 5), lp = this._F('lowpass', 2900, 0.9), sh = this.ctx.createWaveShaper();
    sh.curve = softClipCurve(2.5); sh.oversample = 'none';
    inp.connect(hp); hp.connect(pk); pk.connect(sh); sh.connect(lp); lp.connect(dest);
    return { input: inp, nodes: [inp, hp, pk, sh, lp] };
  }
  _bus(s) { return s.bus === 'radio' ? this.radioBus : s.bus === 'city' ? this.cityIn : s.bus === 'amb' ? this.ambBus : this.sfxBus; }
  _mkPan() {
    const c = this.ctx;
    if (c.createStereoPanner) { const n = c.createStereoPanner(); return { node: n, param: n.pan, set: (v, t) => (t == null ? n.pan.setValueAtTime(v, c.currentTime) : n.pan.setTargetAtTime(v, t, 0.04)) }; }
    const n = c.createPanner(); n.panningModel = 'equalpower'; n.rolloffFactor = 0;
    return { node: n, param: null, set: (v) => { const a = v * Math.PI / 2; if (n.positionX) { n.positionX.value = Math.sin(a); n.positionZ.value = -Math.cos(a); } else n.setPosition(Math.sin(a), 0, -Math.cos(a)); } };
  }
  _toBuf(d, sr) {
    const chs = Array.isArray(d) ? d : [d], b = this.ctx.createBuffer(chs.length, chs[0].length, sr);
    chs.forEach((a, i) => { if (b.copyToChannel) b.copyToChannel(a, i); else b.getChannelData(i).set(a); });
    return b;
  }
  /** Пространство: расстояние, панорама, воздух, «за спиной» глуше, окклюзия, посылы в реверб (внутри/снаружи) */
  _spatial(x, z, s, e) {
    const L = this.L, dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
    const fx = Math.sin(L.yaw), fz = Math.cos(L.yaw);
    let rx = -fz, rz = fx; if (this.mirror) { rx = -rx; rz = -rz; }
    let side = 0, front = 1; if (d > 1e-3) { side = (dx * rx + dz * rz) / d; front = (dx * fx + dz * fz) / d; }
    let g = Math.pow(s.ref / Math.max(s.ref, d), s.roll);
    const fm = d > s.max * 0.6 ? clamp01((s.max - d) / (s.max * 0.4)) : 1; g *= fm;
    let lp = 20000 / (1 + d / 45);
    if (front < 0) { lp *= 1 + front * 0.4; g *= 1 + front * 0.1; }
    const o = this._occl(x, z, e);
    if (o > 0) { lp = Math.min(lp, 16000 * Math.pow(0.025, o)); g *= 1 - 0.55 * o; }
    const wet = s.rev * (0.3 + 0.7 * Math.sqrt(g)) * fm * (1 + 0.3 * o), inside = this.geom.inside(x, z);
    return { g, pan: clampv(side * 0.85 * clamp01(d / 0.6), -1, 1), lp: clampv(lp, 180, 20000), wi: inside ? wet : wet * 0.12, wo: inside ? wet * 0.12 : wet, d };
  }
  _occl(x, z, e) {
    const L = this.L, now = this.ctx ? this.ctx.currentTime : 0;
    if (e && e.occT >= 0 && now - e.occT < 0.15 && e.ox === x && e.oz === z && Math.abs(e.olx - L.x) + Math.abs(e.olz - L.z) < 0.35) return e.occ;
    let o = 0;
    try { o = this.occlFn ? +this.occlFn(x, z, L.x, L.z) || 0 : this.geom.inside(x, z) !== this.geom.inside(L.x, L.z) ? 0.6 : 0; } catch (err) { o = 0; }
    o = clamp01(o);
    if (e) { e.occ = o; e.occT = now; e.ox = x; e.oz = z; e.olx = L.x; e.olz = L.z; }
    return o;
  }
  _emitter(x, z, s, dest) {
    const e = { x, z, s, input: this._G(0), lp: this._F('lowpass', 20000, 0.5), pan: this._mkPan(), sendI: null, sendO: null, occT: -1, occ: 0, last: null };
    e.input.connect(e.lp); e.lp.connect(e.pan.node); e.pan.node.connect(dest);
    if (s.rev > 0) { e.sendI = this._G(0); e.sendO = this._G(0); e.lp.connect(e.sendI); e.lp.connect(e.sendO); e.sendI.connect(this.revInSend); e.sendO.connect(this.revOutSend); }
    this._updEmitter(e, true); this.emitters.add(e);
    return e;
  }
  _freeEmitter(e) { if (!e) return; this.emitters.delete(e); for (const n of [e.input, e.lp, e.pan.node, e.sendI, e.sendO]) if (n) try { n.disconnect(); } catch (err) { /* */ } }
  _updEmitter(e, imm) {
    const sp = this._spatial(e.x, e.z, e.s, e), l = e.last;
    if (!imm && l && Math.abs(l.g - sp.g) < 0.003 + l.g * 0.03 && Math.abs(l.pan - sp.pan) < 0.02 && Math.abs(l.lp - sp.lp) < l.lp * 0.05) return sp;
    const now = this.ctx.currentTime, P = (p, v) => (imm ? p.setValueAtTime(v, now) : p.setTargetAtTime(v, now, 0.04));
    P(e.input.gain, sp.g); P(e.lp.frequency, sp.lp); e.pan.set(sp.pan, imm ? null : now);
    if (e.sendI) { P(e.sendI.gain, sp.wi); P(e.sendO.gain, sp.wo); }
    e.last = sp;
    return sp;
  }

  // ——— внутреннее: кэш буферов и фоновый рендер ———
  _slot(name) { let a = this.cache.get(name); if (!a) { a = new Array(S[name].n).fill(null); this.cache.set(name, a); } return a; }
  _render(name, idx) {
    const s = S[name], sr = srFor(s.sr, this.srHi, this.srLo);
    let d;
    try { d = s.gen(sr, new RNG(seedFor(name, idx, this.salt)), idx); if (!d || !(Array.isArray(d) ? d[0].length : d.length)) throw new Error('пустой буфер'); }
    catch (e) { console.warn('[audio] render failed', name, e); d = new Float32Array(64); }
    return this._toBuf(d, sr);
  }
  _getBuf(name, idx) {
    const s = S[name]; if (!s) return null;
    const arr = this._slot(name);
    if (idx != null) { const i = ((idx % s.n) + s.n) % s.n; if (!arr[i]) arr[i] = this._render(name, i); return arr[i]; }
    const ready = []; for (let i = 0; i < arr.length; i++) if (arr[i]) ready.push(i);
    if (!ready.length) { const i = this.rng.int(0, s.n - 1); arr[i] = this._render(name, i); ready.push(i); }
    if (ready.length < s.n) this._queue(name);
    let k = this.rng.int(0, ready.length - 1);
    if (ready.length > 1 && ready[k] === this._lastVar.get(name)) k = (k + 1) % ready.length;
    this._lastVar.set(name, ready[k]);
    return arr[ready[k]];
  }
  _queue(name, idx, cb, front = false) {
    const s = S[name]; if (!s) return;
    const arr = this._slot(name), list = idx != null ? [((idx % s.n) + s.n) % s.n] : [...Array(s.n).keys()];
    for (const i of list) {
      if (arr[i]) { if (cb) cb(arr[i]); continue; }
      const key = name + '#' + i; let job = this._rqMap.get(key);
      if (!job) { job = { name, i, cbs: [] }; this._rqMap.set(key, job); if (front) this._rq.unshift(job); else this._rq.push(job); }
      else if (front) { const p = this._rq.indexOf(job); if (p > 0) { this._rq.splice(p, 1); this._rq.unshift(job); } }
      if (cb) job.cbs.push(cb);
    }
    if (this.offline) { this._drain(Infinity); return; }
    if (!this._rqTimer && this._rq.length) this._rqTimer = setTimeout(() => this._pump(), 30);
  }
  _pump() { this._rqTimer = null; this._drain(this.lowPower ? 6 : 10); if (this._rq.length && this.ctx) this._rqTimer = setTimeout(() => this._pump(), this.lowPower ? 40 : 20); }
  _drain(budgetMs) {
    const t0 = nowMs();
    while (this._rq.length && nowMs() - t0 < budgetMs) {
      const job = this._rq.shift(); this._rqMap.delete(job.name + '#' + job.i);
      const arr = this._slot(job.name);
      if (!arr[job.i]) arr[job.i] = this._render(job.name, job.i);
      for (const cb of job.cbs) try { cb(arr[job.i]); } catch (e) { console.warn('[audio]', e); }
    }
  }
  _prewarm() {
    const first = ['ui_click', 'ui_paper', 'ui_stamp', 'step_lino', 'step_tile', 'step_concrete', 'step_wet', 'door_wood', 'phone_ring', 'phone_pickup', '_radio_open', 'radio_squelch',
      '_radio_hiss', '_tw_key', '_tw_space', 'shot_pm', 'shot_ak', 'door_steel', 'cell_door', '_speech_m', '_speech_f', 'hit_flesh', 'ricochet'];
    for (const n of first) this._queue(n, 0);
    for (const n of first) this._queue(n);
    for (const n of SOUND_NAMES) if (!n.endsWith('_open') && !n.endsWith('_close')) this._queue(n, 0);
  }

  // ——— внутреннее: планировщик ———
  _tick() {
    if (!this.ready) return;
    this._tickMs = nowMs();
    if (!this.offline && this.ctx.state !== 'running') return;
    this._schedule(this.ctx.currentTime + 0.4);
  }
  /** Запланировать всё процедурное до момента until (сек. времени контекста). В тестах с OfflineAudioContext можно звать напрямую. */
  _schedule(until) {
    const now = this.ctx.currentTime;
    try {
      for (const h of this.procs) { const p = h.proc; if (p.next < now - 0.25) p.next = now + 0.02; let g = 0; while (p.next < until && g++ < 400) p.next += Math.max(0.02, this._procStep(h, p.next)); }
      this._cityTick(now, until); this._tvTick(now, until); this._humTick(now, until); this._tensionTick(now, until);
      for (const k in this.layers) { const L = this.layers[k]; if (L.src && L.zeroAt && now - L.zeroAt > L.tau * 6 + 0.5) { try { L.src.stop(); L.src.disconnect(); } catch (e) { /* */ } L.src = null; L.zeroAt = 0; } }
      for (const e of this.emitters) if (now - e.occT > 0.15) this._updEmitter(e);
      if (this._luPending) this.setListener(this.L.x, this.L.z, this.L.yaw);
      for (let i = this.voices.length - 1; i >= 0; i--) if (this.voices[i] && this.voices[i].end < now - 1) this._release(this.voices[i]);
    } catch (e) { console.warn('[audio] tick', e); }
  }
}
