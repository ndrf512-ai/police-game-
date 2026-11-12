// Процедурные текстуры в духе PS1: маленькие, с шумом, без фильтрации.
import { RNG } from '../core/rng.js';
import { ROOMS } from '../world/level.js';

export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') { try { const c = new OffscreenCanvas(w, h); c.getContext('2d'); return c; } catch (e) { /* fallthrough */ } }
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

/** Пиксельный шум с яркостью ±amp поверх текущего изображения */
function noise(ctx, w, h, rng, amp = 18, mono = true) {
  const im = ctx.getImageData(0, 0, w, h); const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * 2 * amp;
    if (mono) { d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    else { d[i] += (rng.next() - 0.5) * 2 * amp; d[i + 1] += (rng.next() - 0.5) * 2 * amp; d[i + 2] += (rng.next() - 0.5) * 2 * amp; }
  }
  ctx.putImageData(im, 0, 0);
}
function blotches(ctx, w, h, rng, n, col, rmin, rmax) {
  for (let k = 0; k < n; k++) {
    const x = rng.range(0, w), y = rng.range(0, h), r = rng.range(rmin, rmax);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    // повторить с переносом для бесшовности
    for (const [ox, oy] of [[w, 0], [-w, 0], [0, h], [0, -h]]) { ctx.save(); ctx.translate(ox, oy); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  }
}
function cracks(ctx, rng, n, w, h, col = 'rgba(40,35,30,0.5)') {
  ctx.strokeStyle = col; ctx.lineWidth = 1;
  for (let k = 0; k < n; k++) {
    let x = rng.range(0, w), y = rng.range(0, h); ctx.beginPath(); ctx.moveTo(x, y);
    const len = rng.int(4, 14); for (let s = 0; s < len; s++) { x += rng.range(-3, 3); y += rng.range(-1, 4); ctx.lineTo(x, y); }
    ctx.stroke();
  }
}

// ——— поверхности уровня (повторяющиеся) ———
export function genSurfaces() {
  const T = {};
  const rng = new RNG(1996);

  // Линолеум: рыже-коричневый, с ромбическим узором и протёртостями
  { const c = makeCanvas(64, 64), x = c.getContext('2d');
    x.fillStyle = rgb(122, 72, 48); x.fillRect(0, 0, 64, 64);
    x.strokeStyle = rgb(100, 58, 38); x.lineWidth = 1;
    for (let i = -64; i < 128; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 64, 64); x.stroke(); x.beginPath(); x.moveTo(i + 64, 0); x.lineTo(i, 64); x.stroke(); }
    blotches(x, 64, 64, rng, 5, 'rgba(170,130,100,0.25)', 6, 16);
    blotches(x, 64, 64, rng, 4, 'rgba(40,25,15,0.25)', 3, 9);
    x.fillStyle = 'rgba(60,35,20,0.6)'; x.fillRect(0, 31, 64, 1);
    noise(x, 64, 64, rng, 10); T.lino = c; }

  // Кафель пола: серо-бежевая плитка 8×8 px
  { const c = makeCanvas(64, 64), x = c.getContext('2d');
    x.fillStyle = rgb(90, 88, 84); x.fillRect(0, 0, 64, 64);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const v = 150 + rng.range(-12, 12) + ((i + j) % 2 ? 14 : 0);
      x.fillStyle = rgb(v, v - 6, v - 16); x.fillRect(i * 8 + 1, j * 8 + 1, 7, 7);
      if (rng.chance(0.07)) { x.strokeStyle = 'rgba(40,40,40,0.6)'; x.beginPath(); x.moveTo(i * 8 + 1, j * 8 + rng.int(1, 7)); x.lineTo(i * 8 + 8, j * 8 + rng.int(1, 7)); x.stroke(); }
    }
    blotches(x, 64, 64, rng, 4, 'rgba(70,55,30,0.25)', 4, 12);
    noise(x, 64, 64, rng, 8); T.tiles = c; }

  // Кафель стены (туалет): белый, крупнее
  { const c = makeCanvas(64, 64), x = c.getContext('2d');
    x.fillStyle = rgb(120, 125, 120); x.fillRect(0, 0, 64, 64);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const v = 200 + rng.range(-10, 8); x.fillStyle = rgb(v - 8, v, v - 4); x.fillRect(i * 16 + 1, j * 16 + 1, 15, 15); x.fillStyle = 'rgba(255,255,255,0.25)'; x.fillRect(i * 16 + 2, j * 16 + 2, 6, 2); }
    blotches(x, 64, 64, rng, 3, 'rgba(110,90,40,0.25)', 4, 10);
    noise(x, 64, 64, rng, 6); T.walltile = c; }

  // Бетон
  { const c = makeCanvas(64, 64), x = c.getContext('2d');
    x.fillStyle = rgb(112, 110, 104); x.fillRect(0, 0, 64, 64);
    blotches(x, 64, 64, rng, 10, 'rgba(70,68,62,0.35)', 4, 14);
    blotches(x, 64, 64, rng, 5, 'rgba(150,148,140,0.25)', 3, 10);
    cracks(x, rng, 4, 64, 64); noise(x, 64, 64, rng, 16); T.concrete = c; }

  // Мокрый асфальт с лужами (светлые пятна = отражения)
  { const c = makeCanvas(64, 64), x = c.getContext('2d');
    x.fillStyle = rgb(44, 45, 48); x.fillRect(0, 0, 64, 64);
    noise(x, 64, 64, rng, 14);
    blotches(x, 64, 64, rng, 4, 'rgba(110,120,135,0.35)', 6, 14);
    blotches(x, 64, 64, rng, 6, 'rgba(20,20,22,0.4)', 3, 8);
    cracks(x, rng, 3, 64, 64, 'rgba(15,15,15,0.6)'); T.asphalt = c; }

  // Тротуар — бетонные плиты
  { const c = makeCanvas(64, 64), x = c.getContext('2d');
    x.fillStyle = rgb(88, 88, 86); x.fillRect(0, 0, 64, 64);
    x.fillStyle = rgb(60, 60, 60); x.fillRect(0, 0, 64, 1); x.fillRect(0, 0, 1, 64); x.fillRect(32, 0, 1, 64);
    blotches(x, 64, 64, rng, 6, 'rgba(50,50,55,0.35)', 4, 12);
    cracks(x, rng, 5, 64, 64, 'rgba(30,30,30,0.6)'); noise(x, 64, 64, rng, 12); T.sidewalk = c; }

  // Грязь двора
  { const c = makeCanvas(64, 64), x = c.getContext('2d');
    x.fillStyle = rgb(62, 52, 40); x.fillRect(0, 0, 64, 64);
    blotches(x, 64, 64, rng, 8, 'rgba(40,32,24,0.5)', 4, 14);
    blotches(x, 64, 64, rng, 3, 'rgba(90,95,105,0.4)', 5, 10); // лужи
    for (let k = 0; k < 40; k++) { x.fillStyle = rgb(80 + rng.int(0, 30), 70, 50); x.fillRect(rng.int(0, 63), rng.int(0, 63), 1, 1); }
    noise(x, 64, 64, rng, 12); T.mud = c; }

  // Казённая масляная краска (низ стены, 1.5 м) — светло-серая, тонируется цветом вершин
  { const c = makeCanvas(64, 64), x = c.getContext('2d');
    x.fillStyle = rgb(200, 200, 200); x.fillRect(0, 0, 64, 64);
    blotches(x, 64, 64, rng, 6, 'rgba(255,255,255,0.25)', 6, 18);       // блики
    blotches(x, 64, 64, rng, 5, 'rgba(90,80,70,0.25)', 3, 10);          // грязь
    // потёки краски
    for (let k = 0; k < 6; k++) { const px = rng.int(0, 63); x.fillStyle = 'rgba(160,160,160,0.6)'; x.fillRect(px, 0, 1, rng.int(6, 30)); }
    // плинтус и полоса-бордюр сверху
    x.fillStyle = rgb(70, 60, 50); x.fillRect(0, 59, 64, 5);
    x.fillStyle = rgb(110, 105, 100); x.fillRect(0, 0, 64, 2);
    // царапины снизу (стулья, ботинки)
    for (let k = 0; k < 10; k++) { x.fillStyle = 'rgba(70,70,70,0.4)'; x.fillRect(rng.int(0, 60), rng.int(40, 57), rng.int(2, 7), 1); }
    noise(x, 64, 64, rng, 7); T.paint = c; }

  // Побелка (верх стены) с разводами от протечек
  { const c = makeCanvas(64, 64), x = c.getContext('2d');
    x.fillStyle = rgb(206, 204, 196); x.fillRect(0, 0, 64, 64);
    blotches(x, 64, 64, rng, 4, 'rgba(150,130,90,0.22)', 6, 18);
    blotches(x, 64, 64, rng, 8, 'rgba(170,170,165,0.3)', 3, 9);
    cracks(x, rng, 3, 64, 64, 'rgba(110,100,90,0.35)');
    noise(x, 64, 64, rng, 7); T.whitewash = c; }

  // Потолок
  { const c = makeCanvas(64, 64), x = c.getContext('2d');
    x.fillStyle = rgb(190, 188, 180); x.fillRect(0, 0, 64, 64);
    x.fillStyle = 'rgba(120,115,105,0.5)'; x.fillRect(0, 0, 64, 1); x.fillRect(0, 0, 1, 64);
    blotches(x, 64, 64, rng, 3, 'rgba(140,110,60,0.3)', 8, 20);
    cracks(x, rng, 2, 64, 64); noise(x, 64, 64, rng, 8); T.ceiling = c; }

  // Наружная стена: серая штукатурка, местами кирпич
  { const c = makeCanvas(64, 64), x = c.getContext('2d');
    x.fillStyle = rgb(118, 114, 108); x.fillRect(0, 0, 64, 64);
    blotches(x, 64, 64, rng, 6, 'rgba(80,78,74,0.4)', 6, 16);
    // облупившаяся штукатурка с кирпичом
    for (let k = 0; k < 2; k++) {
      const bx = rng.int(4, 40), by = rng.int(4, 40);
      for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) { x.fillStyle = rgb(120 + rng.int(-10, 10), 62, 48); x.fillRect(bx + i * 7 + (j % 2) * 3, by + j * 4, 6, 3); }
    }
    for (let k = 0; k < 8; k++) { x.fillStyle = 'rgba(40,40,45,0.35)'; x.fillRect(rng.int(0, 63), 0, 1, 64); } // потёки дождя
    noise(x, 64, 64, rng, 12); T.extwall = c; }

  // Бетонный забор ПО-2 (ромбики)
  { const c = makeCanvas(64, 64), x = c.getContext('2d');
    x.fillStyle = rgb(105, 103, 98); x.fillRect(0, 0, 64, 64);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { x.fillStyle = (i + j) % 2 ? 'rgba(80,78,72,0.6)' : 'rgba(130,128,120,0.4)'; x.beginPath(); x.moveTo(i * 8 + 4, j * 8); x.lineTo(i * 8 + 8, j * 8 + 4); x.lineTo(i * 8 + 4, j * 8 + 8); x.lineTo(i * 8, j * 8 + 4); x.fill(); }
    x.fillStyle = 'rgba(30,30,30,0.6)'; x.fillRect(0, 0, 1, 64);
    blotches(x, 64, 64, rng, 4, 'rgba(50,60,40,0.4)', 6, 14); // мох
    // граффити
    x.fillStyle = 'rgba(160,30,30,0.55)'; x.font = 'bold 12px monospace'; x.fillText(rng.pick(['ЦОЙ', 'КИНО', 'ДМБ', 'ЦСКА', 'АЛИСА']), 8, 40);
    noise(x, 64, 64, rng, 10); T.fence = c; }

  // Дверь деревянная (покрашенная, с филёнками). Текстура на всю дверь (u: ширина, v: высота)
  { const c = makeCanvas(32, 64), x = c.getContext('2d');
    x.fillStyle = rgb(120, 82, 52); x.fillRect(0, 0, 32, 64);
    x.strokeStyle = rgb(80, 52, 30); x.strokeRect(4.5, 5.5, 23, 22); x.strokeRect(4.5, 33.5, 23, 25);
    x.fillStyle = rgb(190, 170, 90); x.fillRect(25, 32, 3, 2); // ручка
    x.fillStyle = 'rgba(255,255,255,0.8)'; x.fillRect(9, 12, 14, 6); x.fillStyle = 'rgba(20,20,20,0.9)'; x.fillRect(10, 14, 12, 1); x.fillRect(10, 16, 9, 1); // табличка
    noise(x, 32, 64, rng, 10); T.door_wood = c; }
  { const c = makeCanvas(32, 64), x = c.getContext('2d');
    x.fillStyle = rgb(92, 98, 100); x.fillRect(0, 0, 32, 64);
    x.fillStyle = rgb(70, 74, 76); for (let j = 4; j < 64; j += 12) for (let i = 3; i < 32; i += 26) x.fillRect(i, j, 2, 2);
    x.fillStyle = rgb(40, 40, 40); x.fillRect(24, 30, 4, 6); blotches(x, 32, 64, rng, 4, 'rgba(120,60,30,0.35)', 3, 8);
    noise(x, 32, 64, rng, 10); T.door_steel = c; }

  // Стекло окна (тёмное, с разводами) — альфа-канал
  { const c = makeCanvas(32, 32), x = c.getContext('2d');
    x.fillStyle = 'rgba(70,85,100,0.42)'; x.fillRect(0, 0, 32, 32);
    for (let k = 0; k < 14; k++) { x.fillStyle = 'rgba(170,185,200,0.35)'; const px = rng.int(0, 31); x.fillRect(px, rng.int(0, 20), 1, rng.int(4, 14)); }
    x.fillStyle = 'rgba(200,210,220,0.2)'; x.fillRect(2, 2, 10, 2);
    T.glass = c; }
  // Решётка (alpha-test)
  { const c = makeCanvas(32, 32), x = c.getContext('2d');
    x.clearRect(0, 0, 32, 32); x.fillStyle = rgb(60, 60, 62);
    for (let i = 1; i < 32; i += 8) x.fillRect(i, 0, 2, 32);
    x.fillRect(0, 14, 32, 2); x.fillStyle = rgb(110, 110, 115); for (let i = 1; i < 32; i += 8) x.fillRect(i, 0, 1, 32);
    T.bars = c; }
  // Панельные дома вдали
  { const c = makeCanvas(64, 64), x = c.getContext('2d');
    x.fillStyle = rgb(48, 50, 56); x.fillRect(0, 0, 64, 64);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const lit = rng.chance(0.18); x.fillStyle = lit ? rgb(210, 170, 90 + rng.int(-20, 20)) : rgb(25, 27, 32); x.fillRect(i * 8 + 2, j * 8 + 2, 4, 4);
      if (lit && rng.chance(0.3)) { x.fillStyle = 'rgba(180,60,40,0.6)'; x.fillRect(i * 8 + 2, j * 8 + 2, 2, 4); } // штора
    }
    x.fillStyle = 'rgba(0,0,0,0.3)'; for (let j = 0; j < 8; j++) x.fillRect(0, j * 8 + 7, 64, 1);
    noise(x, 64, 64, rng, 8); T.panel = c; }
  // Дождевые капли (частицы) — вертикальная полоска
  { const c = makeCanvas(4, 16), x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, 16); g.addColorStop(0, 'rgba(180,190,210,0)'); g.addColorStop(1, 'rgba(200,210,230,0.7)'); x.fillStyle = g; x.fillRect(1, 0, 2, 16); T.rain = c; }
  // Белый пиксель (для нетекстурированного)
  { const c = makeCanvas(4, 4), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 4, 4); T.white = c; }
  return T;
}

// ——— атлас предметов (512×512), регионы по имени ———
export class Atlas {
  constructor(size = 512) { this.size = size; this.canvas = makeCanvas(size, size); this.ctx = this.canvas.getContext('2d'); this.regions = {}; this.cx = 0; this.cy = 0; this.rowH = 0; }
  /** выделить w×h пикселей и нарисовать fn(ctx, w, h) */
  add(name, w, h, fn) {
    if (this.cx + w > this.size) { this.cx = 0; this.cy += this.rowH + 1; this.rowH = 0; }
    const x = this.cx, y = this.cy; this.cx += w + 1; this.rowH = Math.max(this.rowH, h);
    const ctx = this.ctx; ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.translate(x, y); fn(ctx, w, h); ctx.restore();
    const s = this.size; const e = 0.25 / s; // поджатие против протекания соседей
    this.regions[name] = [x / s + e, y / s + e, (x + w) / s - e, (y + h) / s - e];
    return this.regions[name];
  }
  r(name) { return this.regions[name] || this.regions.white; }
}

function fillNoise(x, w, h, rng, base, amp = 12) { x.fillStyle = base; x.fillRect(0, 0, w, h); const im = x.getImageData(0, 0, w, h); const d = im.data; for (let i = 0; i < d.length; i += 4) { const n = (rng.next() - 0.5) * 2 * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; } x.putImageData(im, 0, 0); }

export function genPropAtlas() {
  const A = new Atlas(512); const rng = new RNG(77);
  A.add('white', 4, 4, (x) => { x.fillStyle = '#fff'; x.fillRect(0, 0, 4, 4); });
  A.add('wood', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(128, 86, 50), 8); x.strokeStyle = 'rgba(70,40,20,0.5)'; for (let j = 2; j < h; j += 5) { x.beginPath(); x.moveTo(0, j + rng.range(-1, 1)); x.bezierCurveTo(10, j + 2, 20, j - 2, 32, j); x.stroke(); } });
  A.add('wood_dark', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(76, 48, 30), 8); x.strokeStyle = 'rgba(40,20,10,0.5)'; for (let j = 2; j < h; j += 4) { x.beginPath(); x.moveTo(0, j); x.lineTo(32, j + rng.range(-1, 1)); x.stroke(); } });
  A.add('desk_top', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(110, 76, 46), 7); x.fillStyle = 'rgba(40,60,40,0.55)'; x.fillRect(6, 6, 20, 16); x.fillStyle = 'rgba(80,50,30,0.4)'; x.beginPath(); x.arc(24, 24, 3, 0, 7); x.fill(); });
  A.add('metal', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(120, 124, 120), 10); x.fillStyle = 'rgba(60,60,60,0.6)'; x.fillRect(0, 15, 32, 1); x.fillRect(14, 6, 4, 2); x.fillRect(14, 22, 4, 2); });
  A.add('metal_green', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(70, 92, 72), 8); x.fillStyle = rgb(170, 160, 120); x.beginPath(); x.arc(20, 14, 4, 0, 7); x.fill(); x.fillStyle = rgb(40, 40, 40); x.fillRect(8, 20, 6, 2); });
  A.add('metal_dark', 16, 16, (x, w, h) => fillNoise(x, w, h, rng, rgb(46, 48, 50), 8));
  A.add('fabric', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(110, 60, 50), 14); x.strokeStyle = 'rgba(60,30,25,0.5)'; for (let i = 0; i < 32; i += 4) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 32); x.stroke(); } });
  A.add('fabric_green', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(60, 80, 60), 14); });
  A.add('paper', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(210, 205, 185), 6); x.fillStyle = 'rgba(40,40,40,0.6)'; for (let j = 3; j < 16; j += 3) x.fillRect(2, j, rng.int(6, 12), 1); });
  A.add('cork', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(150, 110, 70), 18); for (let k = 0; k < 7; k++) { x.fillStyle = rng.pick(['#e8e4d0', '#f0e8b0', '#ddd']); const px = rng.int(1, 22), py = rng.int(1, 22); x.fillRect(px, py, rng.int(6, 10), rng.int(7, 10)); x.fillStyle = 'rgba(30,30,30,0.6)'; x.fillRect(px + 1, py + 2, 5, 1); x.fillRect(px + 1, py + 4, 4, 1); x.fillStyle = '#c33'; x.fillRect(px + 3, py, 1, 1); } });
  A.add('poster_wanted', 32, 40, (x, w, h) => { fillNoise(x, w, h, rng, rgb(220, 215, 195), 5); x.fillStyle = '#222'; x.font = 'bold 6px monospace'; x.fillText('РОЗЫСК', 4, 7); for (let i = 0; i < 2; i++) { x.fillStyle = rgb(90, 85, 80); x.fillRect(3 + i * 14, 10, 11, 13); x.fillStyle = rgb(160, 150, 140); x.fillRect(6 + i * 14, 12, 5, 6); } x.fillStyle = '#333'; for (let j = 27; j < 38; j += 3) x.fillRect(3, j, 26, 1); });
  A.add('calendar', 24, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(230, 228, 220), 4); x.fillStyle = rgb(70, 110, 160); x.fillRect(1, 1, 22, 12); x.fillStyle = '#fff'; x.fillRect(4, 4, 5, 5); x.fillStyle = '#c22'; x.font = 'bold 5px monospace'; x.fillText('1996', 5, 19); x.fillStyle = '#444'; for (let j = 21; j < 31; j += 2) for (let i = 2; i < 22; i += 3) x.fillRect(i, j, 2, 1); });
  A.add('emblem', 32, 40, (x, w, h) => { x.fillStyle = rgb(120, 90, 40); x.fillRect(0, 0, w, h); x.fillStyle = rgb(30, 40, 70); x.fillRect(3, 3, w - 6, h - 6); x.fillStyle = rgb(190, 160, 70); x.beginPath(); x.moveTo(16, 8); x.lineTo(26, 12); x.lineTo(24, 26); x.lineTo(16, 33); x.lineTo(8, 26); x.lineTo(6, 12); x.closePath(); x.fill(); x.fillStyle = rgb(150, 30, 30); x.beginPath(); x.moveTo(16, 12); x.lineTo(22, 15); x.lineTo(21, 24); x.lineTo(16, 28); x.lineTo(11, 24); x.lineTo(10, 15); x.closePath(); x.fill(); });
  A.add('flag', 16, 24, (x) => { x.fillStyle = '#ddd'; x.fillRect(0, 0, 16, 8); x.fillStyle = '#2a3f9a'; x.fillRect(0, 8, 16, 8); x.fillStyle = '#b22'; x.fillRect(0, 16, 16, 8); });
  A.add('sign_militia', 64, 16, (x, w, h) => { x.fillStyle = rgb(30, 50, 110); x.fillRect(0, 0, w, h); x.strokeStyle = '#ddd'; x.strokeRect(1.5, 1.5, w - 3, h - 3); x.fillStyle = '#eee'; x.font = 'bold 9px monospace'; x.fillText('МИЛИЦИЯ', 6, 11); });
  A.add('sign_otd', 48, 24, (x, w, h) => { x.fillStyle = rgb(160, 30, 30); x.fillRect(0, 0, w, h); x.fillStyle = '#e8d070'; x.font = 'bold 5px monospace'; x.fillText('ОТДЕЛЕНИЕ', 6, 8); x.fillText('МИЛИЦИИ', 9, 14); x.fillText('№ 14', 16, 20); });
  A.add('radio_front', 32, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(50, 52, 50), 6); x.fillStyle = rgb(90, 200, 110); x.fillRect(3, 3, 12, 5); x.fillStyle = '#111'; for (let i = 18; i < 30; i += 3) x.fillRect(i, 3, 2, 10); x.fillStyle = rgb(160, 160, 150); x.beginPath(); x.arc(8, 12, 2, 0, 7); x.fill(); });
  A.add('generator', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(150, 120, 40), 10); x.fillStyle = rgb(40, 40, 40); x.fillRect(4, 4, 24, 6); for (let i = 6; i < 26; i += 3) x.fillRect(i, 14, 1, 12); x.fillStyle = '#c22'; x.fillRect(24, 26, 4, 3); });
  A.add('fusebox', 16, 24, (x, w, h) => { fillNoise(x, w, h, rng, rgb(110, 115, 110), 8); x.fillStyle = '#ee0'; x.beginPath(); x.moveTo(8, 3); x.lineTo(12, 11); x.lineTo(4, 11); x.fill(); x.fillStyle = '#111'; x.fillRect(7, 6, 2, 3); });
  A.add('uaz', 64, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(200, 170, 50), 8); x.fillStyle = rgb(30, 60, 140); x.fillRect(0, 14, w, 6); x.fillStyle = '#eee'; x.font = 'bold 6px monospace'; x.fillText('МИЛИЦИЯ', 10, 19); x.fillStyle = rgb(60, 50, 30); x.fillRect(0, 30, w, 2); });
  A.add('uaz_window', 16, 16, (x) => { x.fillStyle = rgb(30, 38, 46); x.fillRect(0, 0, 16, 16); x.fillStyle = 'rgba(160,180,200,0.4)'; x.fillRect(2, 2, 3, 12); });
  A.add('tire', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(28, 28, 28), 6); x.fillStyle = rgb(70, 70, 70); x.fillRect(5, 5, 6, 6); });
  A.add('rust', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(100, 60, 36), 22); blotches(x, w, h, rng, 4, 'rgba(60,70,80,0.5)', 3, 8); });
  A.add('kiosk', 64, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(140, 140, 150), 8); x.fillStyle = rgb(240, 220, 120); x.fillRect(4, 8, 56, 14); x.fillStyle = '#c11'; x.font = 'bold 7px monospace'; x.fillText('ПИВО·СИГАРЕТЫ', 2, 6); x.fillStyle = rgb(50, 40, 30); for (let i = 6; i < 58; i += 7) { x.fillRect(i, 12, 4, 8); } x.fillStyle = '#2a2'; x.fillRect(8, 16, 3, 4); x.fillStyle = '#a22'; x.fillRect(22, 14, 3, 6); x.fillStyle = '#eee'; x.font = '5px monospace'; x.fillText('24 ЧАСА', 20, 29); });
  A.add('busstop', 32, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(90, 110, 120), 8); x.fillStyle = '#ddd'; x.fillRect(2, 2, 10, 5); x.fillStyle = '#222'; x.font = '5px monospace'; x.fillText('А', 5, 7); });
  A.add('tv_body', 16, 16, (x, w, h) => fillNoise(x, w, h, rng, rgb(55, 40, 30), 6));
  A.add('porcelain', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(205, 205, 200), 6); blotches(x, w, h, rng, 2, 'rgba(140,120,60,0.35)', 2, 4); });
  A.add('ammo_box', 32, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(70, 84, 52), 8); x.fillStyle = '#ddd'; x.font = '5px monospace'; x.fillText('5,45', 3, 9); x.fillStyle = '#222'; x.fillRect(22, 4, 6, 3); });
  A.add('gun_rack', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(60, 60, 58), 6); for (let i = 2; i < 30; i += 5) { x.fillStyle = rgb(30, 28, 26); x.fillRect(i, 4, 2, 24); x.fillStyle = rgb(90, 60, 35); x.fillRect(i, 20, 3, 8); x.fillStyle = rgb(20, 20, 20); x.fillRect(i - 1, 12, 4, 3); } });
  A.add('vest', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(60, 70, 60), 10); x.fillStyle = 'rgba(0,0,0,0.4)'; x.fillRect(3, 4, 10, 2); x.fillRect(3, 10, 10, 2); });
  A.add('black', 8, 8, (x) => { x.fillStyle = '#121212'; x.fillRect(0, 0, 8, 8); });
  A.add('red', 8, 8, (x) => { x.fillStyle = rgb(170, 30, 30); x.fillRect(0, 0, 8, 8); });
  A.add('blue_water', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(100, 140, 200), 10); x.fillStyle = 'rgba(255,255,255,0.4)'; x.fillRect(2, 2, 4, 10); });
  A.add('plant', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(50, 90, 40), 25); });
  A.add('pot', 8, 8, (x, w, h) => fillNoise(x, w, h, rng, rgb(140, 70, 40), 10));
  A.add('books', 32, 32, (x) => { for (let j = 0; j < 4; j++) { let i = 0; while (i < 32) { const bw = rng.int(2, 4); x.fillStyle = rgb(rng.int(40, 140), rng.int(30, 90), rng.int(20, 70)); x.fillRect(i, j * 8 + 1, bw, 7); i += bw; } x.fillStyle = rgb(80, 50, 30); x.fillRect(0, j * 8, 32, 1); } });
  A.add('files', 32, 32, (x) => { for (let j = 0; j < 4; j++) { x.fillStyle = rgb(130, 132, 128); x.fillRect(0, j * 8, 32, 8); x.fillStyle = rgb(80, 80, 80); x.fillRect(0, j * 8 + 7, 32, 1); x.fillStyle = '#ddd'; x.fillRect(12, j * 8 + 2, 8, 3); x.fillStyle = '#222'; x.fillRect(14, j * 8 + 5, 4, 1); } });
  A.add('safe', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(60, 80, 62), 8); x.fillStyle = rgb(170, 160, 120); x.beginPath(); x.arc(16, 12, 5, 0, 7); x.fill(); x.fillStyle = '#222'; x.beginPath(); x.arc(16, 12, 2, 0, 7); x.fill(); x.fillStyle = rgb(160, 150, 110); x.fillRect(12, 22, 8, 2); });
  A.add('lampshade', 16, 16, (x, w, h) => fillNoise(x, w, h, rng, rgb(40, 90, 50), 6));
  A.add('glow', 16, 16, (x) => { const g = x.createRadialGradient(8, 8, 0, 8, 8, 8); g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(1, 'rgba(255,240,200,0)'); x.fillStyle = g; x.fillRect(0, 0, 16, 16); });
  A.add('tube', 16, 4, (x) => { x.fillStyle = '#f4f2ea'; x.fillRect(0, 0, 16, 4); });
  A.add('keys', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(110, 80, 50), 6); x.fillStyle = '#cc9'; for (let j = 3; j < 14; j += 5) for (let i = 2; i < 14; i += 4) x.fillRect(i, j, 1, 3); });
  A.add('dumpster', 32, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(50, 70, 60), 12); blotches(x, w, h, rng, 3, 'rgba(100,60,30,0.5)', 2, 6); });
  A.add('barrel', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(40, 70, 110), 12); x.fillStyle = 'rgba(0,0,0,0.4)'; x.fillRect(0, 4, 16, 1); x.fillRect(0, 11, 16, 1); });
  A.add('typewriter', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(40, 50, 45), 6); x.fillStyle = '#ccc'; for (let j = 8; j < 15; j += 2) for (let i = 2; i < 14; i += 2) x.fillRect(i, j, 1, 1); });
  A.add('monitor_body', 16, 16, (x, w, h) => fillNoise(x, w, h, rng, rgb(180, 175, 160), 6));
  A.add('station_sign_blue', 16, 16, (x) => { x.fillStyle = rgb(30, 50, 110); x.fillRect(0, 0, 16, 16); });
  A.add('sofa_red', 32, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(120, 40, 36), 12); x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(15, 0, 2, 16); });
  A.add('fridge', 16, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(215, 215, 205), 5); x.fillStyle = '#999'; x.fillRect(12, 6, 2, 8); x.fillStyle = '#c33'; x.font = '4px monospace'; x.fillText('ЗИЛ', 3, 4); });
  A.add('mirror_frame', 8, 8, (x) => { x.fillStyle = rgb(170, 170, 160); x.fillRect(0, 0, 8, 8); });
  A.add('chess', 16, 16, (x) => { for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { x.fillStyle = (i + j) % 2 ? '#3a2a1a' : '#d8c8a0'; x.fillRect(i * 2, j * 2, 2, 2); } });
  A.add('tank', 32, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(150, 150, 140), 10); x.fillStyle = '#c22'; x.font = '5px monospace'; x.fillText('ОГНЕОПАСНО', 1, 10); });
  genBuildingTextures(A, rng);
  return A;
}

/** Текстуры предметов обстановки (v1.1: здание, двор, улица) */
function genBuildingTextures(A, rng) {
  const txtFit = (x, s, cx, y, maxW, px, bold = true) => { let f = px; do { x.font = `${bold ? 'bold ' : ''}${f}px monospace`; f -= 0.5; } while (f > 3 && x.measureText(s).width > maxW); x.textAlign = 'center'; x.fillText(s, cx, y); x.textAlign = 'left'; };
  // чугунная батарея: вертикальные рёбра секций
  A.add('radiator', 32, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(196, 190, 172), 6); for (let i = 0; i < w; i += 3) { x.fillStyle = 'rgba(60,55,45,0.55)'; x.fillRect(i, 1, 1, h - 2); } x.fillStyle = 'rgba(120,80,40,0.35)'; x.fillRect(0, h - 3, w, 3); blotches(x, w, h, rng, 2, 'rgba(110,70,30,0.4)', 1, 3); });
  // часы «Янтарь»: белый циферблат в чёрном ободе
  A.add('clock', 32, 32, (x) => { x.fillStyle = '#1a1a1a'; x.fillRect(0, 0, 32, 32); x.fillStyle = '#e8e4d6'; x.beginPath(); x.arc(16, 16, 14, 0, 7); x.fill(); x.fillStyle = '#222'; for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; x.fillRect(16 + Math.sin(a) * 12 - 0.5, 16 - Math.cos(a) * 12 - 0.5, k % 3 ? 1 : 2, k % 3 ? 1 : 2); } x.strokeStyle = '#111'; x.lineWidth = 2; x.beginPath(); x.moveTo(16, 16); x.lineTo(21, 12); x.stroke(); x.lineWidth = 1; x.beginPath(); x.moveTo(16, 16); x.lineTo(15, 5); x.stroke(); x.strokeStyle = '#b22'; x.beginPath(); x.moveTo(16, 16); x.lineTo(9, 23); x.stroke(); x.fillStyle = '#555'; x.font = '4px monospace'; x.fillText('ЯНТАРЬ', 9, 24); });
  // металлический шкаф для одежды/документов, серо-зелёный, две дверцы
  A.add('locker', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(110, 128, 112), 7); x.fillStyle = 'rgba(30,35,30,0.7)'; x.fillRect(15, 0, 2, h); x.fillRect(0, 0, w, 1); for (const dx of [3, 19]) for (let j = 3; j < 9; j += 2) x.fillRect(dx, j, 10, 1); x.fillStyle = rgb(170, 170, 160); x.fillRect(12, 15, 2, 4); x.fillRect(18, 15, 2, 4); x.fillStyle = '#ddd'; x.fillRect(5, 22, 6, 3); x.fillRect(21, 22, 6, 3); blotches(x, w, h, rng, 2, 'rgba(110,70,30,0.4)', 1, 3); });
  // пожарный щит
  A.add('fire_shield', 48, 40, (x, w, h) => { fillNoise(x, w, h, rng, rgb(170, 34, 30), 10); x.strokeStyle = '#eee'; x.strokeRect(1.5, 1.5, w - 3, h - 3); x.fillStyle = '#eee'; txtFit(x, 'ПОЖАРНЫЙ ЩИТ', 24, 8, 42, 6);
    x.fillStyle = '#333'; x.fillRect(6, 12, 2, 22); x.fillStyle = '#999'; x.fillRect(3, 12, 8, 5); // топор
    x.fillStyle = '#222'; x.fillRect(16, 11, 2, 24); x.fillRect(16, 11, 5, 2); // багор
    x.fillStyle = '#333'; x.fillRect(25, 12, 2, 22); x.fillStyle = '#888'; x.fillRect(23, 30, 6, 4); // лопата
    x.fillStyle = '#222'; x.fillRect(33, 12, 1, 22); x.fillRect(31, 12, 4, 1); /* лом */ });
  // плакаты
  A.add('poster_honor', 64, 44, (x, w, h) => { x.fillStyle = rgb(120, 24, 24); x.fillRect(0, 0, w, h); x.fillStyle = rgb(210, 170, 60); txtFit(x, 'ДОСКА ПОЧЁТА', 32, 8, 58, 7); x.fillRect(4, 10, w - 8, 1);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 5; i++) { const px = 4 + i * 12, py = 13 + j * 15; x.fillStyle = rgb(225, 220, 205); x.fillRect(px, py, 10, 13); x.fillStyle = rgb(90 + rng.int(-15, 15), 80, 70); x.fillRect(px + 2, py + 1, 6, 7); x.fillStyle = rgb(170, 140, 110); x.fillRect(px + 3, py + 2, 4, 4); x.fillStyle = '#333'; x.fillRect(px + 1, py + 10, 8, 1); } });
  A.add('poster_rules', 32, 44, (x, w, h) => { fillNoise(x, w, h, rng, rgb(222, 216, 196), 5); x.fillStyle = '#222'; txtFit(x, 'ПРАВИЛА', 16, 7, 28, 6); txtFit(x, 'внутреннего распорядка', 16, 12, 30, 4, false); x.fillStyle = '#444'; for (let j = 16; j < 41; j += 3) x.fillRect(3, j, rng.int(18, 26), 1); x.fillStyle = 'rgba(60,40,140,0.6)'; x.beginPath(); x.arc(24, 38, 3, 0, 7); x.fill(); blotches(x, w, h, rng, 1, 'rgba(150,120,60,0.3)', 3, 6); });
  A.add('poster_agit', 32, 44, (x, w, h) => { x.fillStyle = rgb(200, 190, 160); x.fillRect(0, 0, w, h); x.fillStyle = rgb(170, 30, 30); x.fillRect(0, 0, w, 14); x.fillStyle = '#f0e0a0'; txtFit(x, 'МИЛИЦИЯ', 16, 7, 28, 6); txtFit(x, 'НА СТРАЖЕ', 16, 12, 28, 4); x.fillStyle = rgb(40, 60, 110); x.fillRect(10, 18, 12, 14); x.fillRect(12, 32, 3, 8); x.fillRect(17, 32, 3, 8); x.fillStyle = rgb(210, 170, 130); x.fillRect(13, 14, 6, 5); x.fillStyle = rgb(40, 60, 110); x.fillRect(11, 13, 10, 2); x.fillStyle = '#b22'; x.fillRect(11, 14, 10, 1); x.fillStyle = '#222'; txtFit(x, 'ПОРЯДКА', 16, 43, 28, 4); });
  A.add('poster_ad', 32, 44, (x, w, h) => { x.fillStyle = rgb(240, 240, 235); x.fillRect(0, 0, w, h); x.fillStyle = rgb(30, 50, 140); x.fillRect(0, 0, w, 12); x.fillStyle = '#fff'; txtFit(x, 'ГОЛОСУЙ', 16, 9, 28, 6); x.fillStyle = '#c22'; txtFit(x, 'ИЛИ', 16, 20, 28, 5); txtFit(x, 'ПРОИГРАЕШЬ', 16, 27, 30, 5); x.fillStyle = rgb(30, 50, 140); x.fillRect(0, 34, w, 2); x.fillStyle = '#c22'; x.fillRect(0, 37, w, 2); x.fillStyle = 'rgba(80,80,80,0.5)'; x.fillRect(rng.int(2, 20), rng.int(14, 30), 8, 5); /* оборван */ blotches(x, w, h, rng, 2, 'rgba(90,80,60,0.35)', 3, 7); });
  // мусор: чёрные мешки, бутылка
  A.add('trash_bag', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(32, 36, 34), 10); x.fillStyle = 'rgba(160,170,170,0.35)'; x.fillRect(3, 3, 2, 6); x.fillRect(9, 2, 1, 5); });
  A.add('bottle', 8, 8, (x, w, h) => { fillNoise(x, w, h, rng, rgb(40, 90, 50), 10); x.fillStyle = 'rgba(200,230,200,0.5)'; x.fillRect(1, 1, 1, 6); });
  // пятна и лужи — с прозрачным фоном (рисуются с alpha-test)
  const blob = (x, w, h, col, n, rmin, rmax) => { x.clearRect(0, 0, w, h); x.fillStyle = col; for (let k = 0; k < n; k++) { x.beginPath(); x.ellipse(w / 2 + rng.range(-w / 5, w / 5), h / 2 + rng.range(-h / 5, h / 5), rng.range(rmin, rmax), rng.range(rmin, rmax) * 0.8, rng.range(0, 3), 0, 7); x.fill(); } };
  A.add('stain', 32, 32, (x, w, h) => { blob(x, w, h, 'rgba(58,44,28,1)', 6, 4, 10); x.fillStyle = 'rgba(30,22,14,1)'; for (let k = 0; k < 8; k++) x.fillRect(rng.int(8, 24), rng.int(8, 24), 2, 1); });
  A.add('stain_wall', 32, 32, (x, w, h) => { x.clearRect(0, 0, w, h); x.fillStyle = 'rgba(96,82,52,1)'; x.beginPath(); x.ellipse(16, 9, 12, 7, 0, 0, 7); x.fill(); for (let k = 0; k < 6; k++) { const px = rng.int(6, 26); x.fillRect(px, 9, 2, rng.int(10, 22)); } x.fillStyle = 'rgba(70,58,36,1)'; x.beginPath(); x.ellipse(16, 8, 7, 4, 0, 0, 7); x.fill(); });
  A.add('puddle', 32, 32, (x, w, h) => { blob(x, w, h, 'rgba(46,54,62,1)', 5, 6, 12); x.fillStyle = 'rgba(120,135,150,1)'; for (let k = 0; k < 5; k++) x.fillRect(rng.int(10, 22), rng.int(10, 22), rng.int(2, 5), 1); });
  // телефонная будка: стекло в красной раме, надпись «ТЕЛЕФОН»
  A.add('booth', 32, 64, (x, w, h) => { fillNoise(x, w, h, rng, rgb(150, 40, 34), 8); x.fillStyle = rgb(40, 50, 58); for (let j = 0; j < 3; j++) x.fillRect(3, 10 + j * 15, 26, 13); x.fillStyle = 'rgba(170,190,210,0.35)'; x.fillRect(5, 12, 2, 36); x.fillStyle = '#eee'; txtFit(x, 'ТЕЛЕФОН', 16, 7, 28, 5); x.fillStyle = 'rgba(30,30,30,0.6)'; x.fillRect(rng.int(4, 20), 30, 6, 4); /* граффити */ });
  A.add('bark', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(58, 52, 46), 16); x.fillStyle = 'rgba(25,22,20,0.6)'; for (let i = 1; i < w; i += 4) x.fillRect(i, 0, 1, h); });
  A.add('leaves', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(150, 110, 40), 30); for (let k = 0; k < 10; k++) { x.fillStyle = rng.pick(['#8a4a1a', '#a07020', '#5a4a2a']); x.fillRect(rng.int(0, 15), rng.int(0, 15), 2, 2); } });
  A.add('curtain', 16, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(150, 110, 70), 8); for (let i = 0; i < w; i += 4) { x.fillStyle = 'rgba(60,40,20,0.35)'; x.fillRect(i, 0, 1, h); x.fillStyle = 'rgba(230,200,150,0.25)'; x.fillRect(i + 2, 0, 1, h); } x.fillStyle = 'rgba(90,60,30,0.4)'; for (let j = 4; j < h; j += 8) x.fillRect(0, j, w, 1); });
  // ковровая дорожка: красная, с зелёной каймой (u — поперёк, v — вдоль)
  A.add('carpet', 32, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(130, 34, 34), 8); x.fillStyle = rgb(40, 80, 50); x.fillRect(0, 0, 3, h); x.fillRect(w - 3, 0, 3, h); x.fillStyle = rgb(190, 160, 90); x.fillRect(4, 0, 1, h); x.fillRect(w - 5, 0, 1, h); x.fillStyle = 'rgba(70,20,20,0.6)'; for (let j = 2; j < h; j += 8) { x.fillRect(12, j, 8, 1); x.fillRect(14, j + 2, 4, 1); } blotches(x, w, h, rng, 2, 'rgba(60,40,30,0.35)', 2, 5); });
  A.add('mat', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(36, 36, 36), 8); x.fillStyle = 'rgba(80,80,80,0.6)'; for (let j = 1; j < h; j += 3) x.fillRect(1, j, w - 2, 1); });
  A.add('radio_old', 32, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(92, 60, 36), 6); x.fillStyle = rgb(200, 190, 150); x.fillRect(2, 2, 18, 6); x.fillStyle = '#222'; for (let i = 3; i < 19; i += 3) x.fillRect(i, 3, 1, 4); x.fillStyle = '#c33'; x.fillRect(9, 2, 1, 6); x.fillStyle = rgb(60, 50, 40); for (let j = 9; j < 15; j += 2) x.fillRect(2, j, 18, 1); x.fillStyle = '#ccc'; x.beginPath(); x.arc(25, 6, 3, 0, 7); x.fill(); x.beginPath(); x.arc(25, 12, 2, 0, 7); x.fill(); });
  A.add('heater', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(214, 208, 190), 5); for (let i = 1; i < w; i += 3) { x.fillStyle = 'rgba(80,75,60,0.5)'; x.fillRect(i, 0, 1, h); } });
  A.add('map_district', 48, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(214, 206, 180), 5); x.strokeStyle = 'rgba(60,60,60,0.6)'; for (let k = 0; k < 9; k++) { x.beginPath(); x.moveTo(rng.int(0, w), 0); x.lineTo(rng.int(0, w), h); x.stroke(); x.beginPath(); x.moveTo(0, rng.int(0, h)); x.lineTo(w, rng.int(0, h)); x.stroke(); } x.fillStyle = 'rgba(80,120,160,0.6)'; x.fillRect(0, 22, w, 3); for (let k = 0; k < 7; k++) { x.fillStyle = rng.pick(['#c22', '#22c', '#c22']); x.fillRect(rng.int(2, w - 3), rng.int(2, h - 3), 2, 2); } x.fillStyle = '#222'; x.font = 'bold 4px monospace'; x.fillText('УЧАСТОК №14', 2, 5); });
  A.add('drawers', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(118, 80, 48), 7); x.fillStyle = 'rgba(40,24,12,0.7)'; for (let j = 5; j < h; j += 5) x.fillRect(0, j, w, 1); x.fillStyle = rgb(180, 170, 140); for (let j = 2; j < h; j += 5) x.fillRect(7, j, 3, 1); });
  A.add('urn', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(140, 138, 130), 14); x.fillStyle = 'rgba(60,60,60,0.5)'; x.fillRect(0, 3, w, 1); x.fillRect(0, 12, w, 1); });
  A.add('concrete_p', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(150, 148, 140), 14); blotches(x, w, h, rng, 2, 'rgba(70,70,65,0.4)', 2, 5); });
  A.add('pc_front', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(186, 180, 162), 5); x.fillStyle = '#101810'; x.fillRect(4, 3, 24, 19); x.fillStyle = rgb(80, 200, 100); x.fillRect(6, 5, 12, 1); for (let j = 8; j < 20; j += 3) x.fillRect(6, j, rng.int(6, 18), 1); x.fillRect(6, 20, 2, 1); x.fillStyle = '#333'; x.fillRect(22, 26, 5, 2); x.fillStyle = '#3c3'; x.fillRect(5, 27, 1, 1); });
  A.add('keyboard', 32, 8, (x, w, h) => { fillNoise(x, w, h, rng, rgb(170, 165, 150), 5); x.fillStyle = 'rgba(60,60,55,0.6)'; for (let j = 1; j < h; j += 2) for (let i = 1; i < w - 1; i += 2) x.fillRect(i, j, 1, 1); });
  A.add('container', 32, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(54, 84, 120), 10); for (let i = 0; i < w; i += 2) { x.fillStyle = 'rgba(20,30,40,0.35)'; x.fillRect(i, 0, 1, h); } blotches(x, w, h, rng, 5, 'rgba(120,64,30,0.6)', 1, 4); x.fillStyle = '#ddd'; x.font = '4px monospace'; x.fillText('MSKU', 2, 5); });
  // таблички на дверях — названия комнат из ROOMS
  for (const r of ROOMS) A.add('sign_' + r.id, 96, 24, (x, w, h) => { x.fillStyle = rgb(28, 40, 86); x.fillRect(0, 0, w, h); x.strokeStyle = rgb(200, 180, 110); x.strokeRect(1.5, 1.5, w - 3, h - 3); x.fillStyle = rgb(230, 215, 150); const nm = r.name.toUpperCase(); const sp = nm.length > 14 ? nm.lastIndexOf(' ') : -1; if (sp > 0) { txtFit(x, nm.slice(0, sp), w / 2, 11, w - 8, 9); txtFit(x, nm.slice(sp + 1), w / 2, 20, w - 8, 9); } else txtFit(x, nm, w / 2, 16, w - 8, 10); });
}
