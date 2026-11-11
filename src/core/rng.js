// Детерминированный ГСЧ (mulberry32) + удобные помощники.
// Весь игровой код использует только его, чтобы сохранения и тесты были воспроизводимы.

export class RNG {
  constructor(seed = Date.now() >>> 0) {
    this.seed = seed >>> 0;
    this.s = this.seed || 0x9e3779b9;
  }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** float в [a,b) */
  range(a, b) { return a + (b - a) * this.next(); }
  /** int в [a,b] включительно */
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  /** взвешенный выбор: items = [{w, ...}] или (arr, weightFn) */
  weighted(arr, wf = (x) => x.w) {
    let sum = 0;
    for (const x of arr) sum += Math.max(0, wf(x));
    if (sum <= 0) return arr[0];
    let r = this.next() * sum;
    for (const x of arr) { r -= Math.max(0, wf(x)); if (r <= 0) return x; }
    return arr[arr.length - 1];
  }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  /** выбрать n разных */
  sample(arr, n) { return this.shuffle(arr).slice(0, n); }
  /** нормальное распределение (Бокс–Мюллер) */
  gauss(mean = 0, sd = 1) {
    const u = 1 - this.next(), v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** дочерний ГСЧ — для независимых подсистем */
  fork(salt = 1) { return new RNG((this.next() * 4294967296) ^ (salt * 2654435761)); }
  getState() { return this.s; }
  setState(s) { this.s = s >>> 0; }
}

let _uid = 1;
export function uid(prefix = 'id') { return prefix + '_' + (_uid++).toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
