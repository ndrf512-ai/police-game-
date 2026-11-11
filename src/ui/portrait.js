// Процедурные портреты 48×56 в духе PS1: свой растеризатор, освещение по нормали эллипсоида,
// упорядоченный дизеринг (Байер 4×4), квантование цвета до 15 бит. Детерминированы по seed.
//
// portraitSpec(src, extra) — нормализует Officer / Detainee / посетителя / игрока в спецификацию
// portraitURL(spec) → dataURL (кешируется)
// portraitImg(src|spec, {scale, cls, kind}) → <img> с пиксельным масштабом

import { RNG } from '../core/rng.js';
import { hashStr } from './dom.js';

export const PW = 48, PH = 56;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bay = (x, y) => BAYER[((y & 3) << 2) | (x & 3)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const SKIN = [[238, 204, 178], [222, 178, 146], [196, 148, 112], [152, 106, 76]];
const HAIR = {
  black: [30, 27, 26], dark: [56, 40, 30], brown: [88, 60, 38], light: [138, 104, 66], blonde: [198, 166, 104],
  red: [132, 64, 34], grey: [132, 130, 126], white: [186, 184, 178], burgundy: [104, 34, 44], platinum: [222, 208, 170],
};
const LIGHT = (() => { const v = [-0.45, -0.55, 0.72]; const l = Math.hypot(...v); return v.map((x) => x / l); })();

class Buf {
  constructor() { this.d = new Uint8ClampedArray(PW * PH * 4); this.mask = new Uint8Array(PW * PH); }
  put(x, y, c, a = 1) {
    x |= 0; y |= 0; if (x < 0 || y < 0 || x >= PW || y >= PH || !c) return;
    const i = (y * PW + x) * 4, d = this.d;
    if (a >= 1) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; }
    else { d[i] = d[i] + (c[0] - d[i]) * a; d[i + 1] = d[i + 1] + (c[1] - d[i + 1]) * a; d[i + 2] = d[i + 2] + (c[2] - d[i + 2]) * a; d[i + 3] = 255; }
  }
  get(x, y) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= PW || y >= PH) return [0, 0, 0]; const i = (y * PW + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2]]; }
  /** эллипс с шейдером (x,y,nx,ny) → цвет|null */
  ellipse(cx, cy, rx, ry, sh, tag = 0) {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry; if (nx * nx + ny * ny > 1) continue;
      const c = typeof sh === 'function' ? sh(x, y, nx, ny) : sh; if (c) { this.put(x, y, c, c[3] ?? 1); if (tag && x >= 0 && y >= 0 && x < PW && y < PH) this.mask[y * PW + x] = tag; }
    }
  }
  rect(x0, y0, w, h, sh) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const c = typeof sh === 'function' ? sh(x, y) : sh; if (c) this.put(x, y, c, c[3] ?? 1); }
  }
  /** многоугольник (чётно-нечётное правило по центрам пикселей) */
  poly(pts, sh) {
    let y0 = Infinity, y1 = -Infinity; for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      const yc = y + 0.5, xs = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xa, ya] = pts[i], [xb, yb] = pts[j];
        if ((ya > yc) !== (yb > yc)) xs.push(xa + (yc - ya) / (yb - ya) * (xb - xa));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) { const c = typeof sh === 'function' ? sh(x, y) : sh; if (c) this.put(x, y, c, c[3] ?? 1); }
    }
  }
}

function mul(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
/** Освещённый цвет с дизерингом: k 0..1.2, lv — число ступеней */
function lit(c, k, x, y, lv = 5) {
  const q = Math.floor(clamp(k, 0, 1.25) * lv + bay(x, y)) / lv;
  const shadow = [c[0] * 0.38 + 6, c[1] * 0.34 + 6, c[2] * 0.42 + 14];
  const hi = [Math.min(255, c[0] * 1.14 + 8), Math.min(255, c[1] * 1.12 + 8), Math.min(255, c[2] * 1.1 + 6)];
  return q <= 1 ? mix(shadow, c, q) : mix(c, hi, (q - 1) / 0.25);
}
function ndl(nx, ny) { const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)); return Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]); }

/** Нормализовать источник в спецификацию портрета */
export function portraitSpec(src = {}, extra = {}) {
  const look = src.look || {};
  const person = src.person || src;
  const gender = extra.gender || look.gender || person.gender || src.gender || 'm';
  const key = src.id || src.personId || `${person.lastName || ''}${person.firstName || ''}${person.patronymic || ''}` || JSON.stringify(look);
  const seed = hashStr(key);
  const isOfficer = !!(src.role || src.rank || src.skills);
  let uniform = look.uniform || extra.uniform || (isOfficer ? 'militia' : gender === 'f' ? 'civil_f' : 'civil_m');
  const kind = extra.kind || (src.charge != null || src.cell ? 'detainee' : isOfficer ? 'officer' : 'visitor');
  if (kind === 'detainee' && !look.uniform) uniform = 'prisoner';
  const rng = new RNG(seed);
  const age = src.age ?? person.age ?? extra.age ?? 25 + rng.int(0, 30);
  const hpLow = (src.hp != null && src.hp < 55) || (src.health != null && src.health < 55) || (src.injuries && src.injuries.length > 0);
  return {
    seed, gender, age, kind, uniform,
    skin: clamp(look.skin ?? rng.int(0, 2), 0, 3), hair: ((look.hair ?? rng.int(0, 5)) % 6 + 6) % 6,
    build: look.build ?? 1, mustache: look.mustache ?? (gender === 'm' && rng.chance(0.3)), glasses: look.glasses ?? rng.chance(0.12),
    beard: look.beard ?? ((uniform === 'junkie' || uniform === 'prisoner' || uniform.startsWith('bandit')) && gender === 'm' && rng.chance(0.55)),
    hat: extra.hat ?? (look.hat && look.hat !== 'none' ? look.hat : (kind === 'officer' && extra.cap) ? 'cap' : 'none'),
    rank: src.rank || extra.rank || null, injured: extra.injured ?? hpLow, bruise: extra.bruise ?? (kind === 'detainee' && (src.health ?? 100) < 70),
    tired: extra.tired ?? ((src.fatigue ?? 0) > 75), dead: src.status === 'dead', mood: extra.mood || src.mood || null,
    hairColor: look.hairColor || null, formal: !!extra.formal, plate: extra.plate ?? (kind === 'detainee'),
  };
}

const _cache = new Map();
export function portraitURL(spec) {
  const key = JSON.stringify(spec);
  let u = _cache.get(key);
  if (u) return u;
  const cv = document.createElement('canvas'); cv.width = PW; cv.height = PH;
  drawPortraitTo(cv, spec);
  u = cv.toDataURL();
  if (_cache.size > 400) _cache.clear();
  _cache.set(key, u);
  return u;
}

/** <img> портрета. src — Officer/Detainee/… или готовая спецификация (spec.seed есть) */
export function portraitImg(src, opts = {}) {
  const spec = src && src.seed != null && src.uniform ? src : portraitSpec(src, opts);
  const scale = opts.scale ?? 1;
  const img = document.createElement('img');
  img.className = 'pix portrait' + (opts.cls ? ' ' + opts.cls : '') + (spec.dead ? ' dead' : '');
  img.alt = ''; img.draggable = false;
  img.width = Math.round(PW * scale); img.height = Math.round(PH * scale);
  img.src = portraitURL(spec);
  return img;
}

export function drawPortraitTo(canvas, spec) {
  const b = new Buf();
  const rng = new RNG(spec.seed || 1);
  const f = spec.gender === 'f';
  const bw = clamp(spec.build || 1, 0.85, 1.15);
  const skin = SKIN[spec.skin | 0] || SKIN[0];
  // цвет волос
  let hairC;
  if (spec.hairColor && HAIR[spec.hairColor]) hairC = HAIR[spec.hairColor];
  else if (spec.age >= 58) hairC = rng.chance(0.5) ? HAIR.white : HAIR.grey;
  else {
    const pool = f ? ['dark', 'brown', 'light', 'blonde', 'burgundy', 'platinum', 'black', 'red'] : ['black', 'dark', 'brown', 'brown', 'light', 'blonde', 'red', 'dark'];
    hairC = HAIR[rng.pick(pool)];
  }
  const greyMix = spec.age >= 46 && spec.age < 58 ? 0.35 : 0;
  const hairAt = (x, y, k) => { let c = hairC; if (greyMix && bay(x * 3 + 1, y * 5) < greyMix) c = HAIR.grey; return lit(c, k * (0.93 + 0.14 * bay(x, y * 3 + (x >> 1))), x, y, 4); };

  // ——— фон ———
  const bg = spec.kind;
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    let c;
    if (bg === 'detainee') { c = mix([128, 122, 108], [92, 88, 78], y / PH); if (y % 7 === 3) c = mul(c, 0.78); if (y % 7 === 3 && x % 12 < 3) c = [210, 205, 190]; }
    else if (bg === 'visitor') { const r = Math.hypot(x - 30, y - 10) / 50; c = mix([96, 88, 70], [38, 35, 30], clamp(r, 0, 1)); }
    else if (bg === 'anchor') { c = mix([44, 78, 128], [14, 28, 54], y / PH); if ((x + y) % 11 === 0 && y < 30) c = mix(c, [120, 160, 210], 0.35); }
    else if (bg === 'dark') { c = mix([42, 44, 48], [18, 19, 22], y / PH); }
    else { const r = Math.hypot(x - 24, y - 22) / 40; c = mix([182, 186, 186], [112, 118, 122], clamp(r, 0, 1)); }
    b.put(x, y, lit(c, 0.95, x, y, 6));
  }

  const cx = 24, headCY = 25, rx = 10 * bw * (f ? 0.94 : 1), ry = 12.6;
  const jawRx = (f ? 7.4 : 8.6) * bw, jawCY = 31.5, jawRy = f ? 7.6 : 8.2;
  const hat = spec.hat || 'none';
  const hs = spec.hair;
  const masked = hat === 'mask';

  // ——— волосы сзади (длинные причёски) ———
  if (!masked && hat !== 'helmet') {
    if (f && (hs === 0 || hs === 2 || hs === 4)) {
      const bottom = hs === 2 ? 54 : hs === 4 ? 42 : 40;
      const wide = hs === 4 ? 15.5 : hs === 2 ? 12.5 : 12.4;
      b.ellipse(cx, 23, wide, 15, (x, y, nx, ny) => hairAt(x, y, 0.55 + 0.4 * ndl(nx, ny * 0.6)));
      b.poly([[cx - wide + 0.5, 23], [cx + wide - 0.5, 23], [cx + wide - 1.5 + (hs === 2 ? 1 : 0), bottom], [cx - wide + 1.5 - (hs === 2 ? 1 : 0), bottom]], (x, y) => hairAt(x, y, 0.42 + 0.25 * (1 - (y - 23) / 30)));
      if (hs === 4) for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2; b.ellipse(cx + Math.cos(a) * 14, 24 + Math.sin(a) * 14, 2.2, 2.2, (x, y, nx, ny) => hairAt(x, y, 0.45 + 0.5 * ndl(nx, ny))); }
    }
    if (!f && hs === 4) b.rect(cx - 9, 34, 18, 10, (x, y) => hairAt(x, y, 0.45));
    if (f && hs === 1 && hat === 'none') b.ellipse(cx, 10.5, 5, 4.2, (x, y, nx, ny) => hairAt(x, y, 0.3 + 0.8 * ndl(nx, ny)));
  }

  // ——— одежда ———
  drawTorso(b, spec, rng, bw, f);

  // ——— шея ———
  const nw = f ? 4.2 : 5.2 * bw;
  b.poly([[cx - nw, 34], [cx + nw, 34], [cx + nw + 0.6, 45], [cx - nw - 0.6, 45]], (x, y) => {
    const k = 0.55 + 0.25 * (1 - Math.abs(x + 0.5 - cx) / (nw + 1)) - (y < 41 ? 0.22 * (1 - (y - 34) / 7) : 0);
    return lit(skin, k, x, y, 4);
  });
  redrawCollar(b, spec, rng, bw, f);

  // ——— уши ———
  if (!masked) for (const s of [-1, 1]) b.ellipse(cx + s * (rx + 0.2), 27, 1.7, 2.8, (x, y, nx, ny) => lit(skin, 0.55 + 0.3 * ndl(nx * s * -1, ny), x, y, 4));

  // ——— голова ———
  const inHead = (x, y) => {
    const ax = (x + 0.5 - cx) / rx, ay = (y + 0.5 - headCY) / ry;
    const jx = (x + 0.5 - cx) / jawRx, jy = (y + 0.5 - jawCY) / jawRy;
    return ax * ax + ay * ay <= 1 || (jx * jx + jy * jy <= 1 && y > headCY);
  };
  for (let y = 10; y < 42; y++) for (let x = 10; x < 38; x++) {
    if (!inHead(x, y)) continue;
    const nx = (x + 0.5 - cx) / (rx + 0.6), ny = (y + 0.5 - 27) / 15;
    let k = 0.2 + 0.95 * ndl(nx, ny);
    let c = skin;
    if (masked) { c = [28, 28, 30]; k = 0.35 + 0.7 * ndl(nx, ny); }
    b.put(x, y, lit(c, k, x, y, 5)); b.mask[y * PW + x] = 1;
  }

  if (!masked) drawFace(b, spec, rng, skin, hairC, f, cx);
  else {
    // прорезь для глаз
    b.rect(18, 25, 13, 3, (x, y) => lit(skin, 0.7, x, y, 4));
    for (const ex of [20, 28]) { b.put(ex, 26, [230, 226, 220]); b.put(ex + 1, 26, [32, 24, 18]); }
  }

  // ——— волосы спереди ———
  if (!masked) drawHairFront(b, spec, hairAt, cx, rx, headCY, ry, f, hat);

  // ——— борода/щетина/усы ———
  if (!masked && !f) {
    if (spec.beard) for (let y = 30; y < 41; y++) for (let x = 14; x < 35; x++) {
      if (!b.mask[y * PW + x]) continue; if (y < 33 && Math.abs(x + 0.5 - cx) < 6) continue;
      if (bay(x * 2 + y, y * 3) < 0.42) b.put(x, y, mul(hairC, 0.85), 0.75);
    }
    if (spec.mustache) {
      const thick = rng.chance(0.5);
      for (let x = 20; x < 29; x++) { b.put(x, 33, lit(hairC, 0.7, x, 33, 3)); if (thick && x > 20 && x < 28) b.put(x, 32, lit(hairC, 0.85, x, 32, 3)); }
      b.put(20, 34, lit(hairC, 0.5, 20, 34, 3)); b.put(28, 34, lit(hairC, 0.5, 28, 34, 3));
    }
  }
  if (spec.tired || spec.age > 44) for (const ex of [19, 28]) { b.put(ex, 28, mul(skin, 0.78), 0.8); b.put(ex + 1, 28, mul(skin, 0.8), 0.6); }

  // ——— очки ———
  if (spec.glasses && !masked) {
    const fr = rng.chance(0.5) ? [30, 28, 26] : [120, 96, 54];
    for (const ex of [17, 26]) {
      for (let x = ex; x <= ex + 5; x++) { b.put(x, 24, fr); b.put(x, 28, fr, 0.8); }
      for (let y = 24; y <= 28; y++) { b.put(ex, y, fr); b.put(ex + 5, y, fr); }
      b.put(ex + 1, 25, [230, 236, 240], 0.5);
    }
    b.put(23, 25, fr); b.put(24, 25, fr); b.put(25, 25, fr);
  }

  // ——— головной убор ———
  drawHat(b, spec, rng, cx, rx, f);

  // ——— травмы ———
  if (spec.bruise) { b.ellipse(29.5, 28.5, 2.4, 1.8, [96, 60, 110, 0.45]); b.put(21, 36, [140, 30, 30]); }
  if (spec.injured) {
    b.rect(13, 19, 22, 3, (x, y) => lit([236, 232, 222], 0.85 + 0.2 * bay(x, y), x, y, 3));
    b.put(27, 20, [168, 40, 36]); b.put(28, 20, [150, 36, 34]); b.put(28, 19, [170, 50, 40], 0.7);
  }
  if (spec.plate) {
    b.rect(13, 48, 22, 8, [26, 26, 28]);
    for (let x = 15; x < 33; x++) { if (bay(x * 3, 1) < 0.55) b.put(x, 50, [214, 212, 200]); if (bay(x * 5, 2) < 0.45 && x < 28) b.put(x, 53, [214, 212, 200]); }
  }

  // ——— пост-обработка: 15-битный цвет + дизеринг, лёгкая виньетка ———
  const d = b.d;
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const i = (y * PW + x) * 4;
    const v = 1 - 0.18 * Math.pow(Math.hypot((x - 24) / 28, (y - 26) / 32), 3);
    const t = (bay(x, y) - 0.5) * 5;
    for (let k = 0; k < 3; k++) d[i + k] = Math.round(clamp(d[i + k] * v + t, 0, 255) / 8) * 8;
    if (spec.dead) { const g = (d[i] + d[i + 1] + d[i + 2]) / 3; d[i] = d[i + 1] = d[i + 2] = g * 0.95; }
    d[i + 3] = 255;
  }
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(d, PW, PH), 0, 0);
}

function drawFace(b, spec, rng, skin, hairC, f, cx) {
  const ey = 26;
  const browC = mix(hairC, [30, 24, 20], f ? 0.25 : 0.4);
  // глазницы
  for (const ex of [18, 27]) {
    for (let x = ex; x < ex + 4; x++) b.put(x, ey - 1, mul(b.get(x, ey - 1), 0.82));
    // белок
    b.put(ex + 0, ey, [214, 206, 196]); b.put(ex + 1, ey, [226, 220, 212]); b.put(ex + 2, ey, [214, 206, 196]); b.put(ex + 3, ey, mul(skin, 0.72));
    // зрачок
    const px = ex + 1 + (rng.chance(0.5) ? 0 : 1);
    const iris = rng.pick([[54, 38, 28], [70, 92, 110], [80, 86, 72], [40, 30, 24]]);
    b.put(px, ey, iris); if (f) b.put(px, ey - 1, [40, 30, 26]);
    // верхнее веко
    for (let x = ex; x < ex + 4; x++) b.put(x, ey - 1, f ? [44, 30, 28] : mul(skin, 0.55));
    if (f) { b.put(ex === 18 ? ex - 1 : ex + 4, ey - 2, [36, 26, 24]); b.put(ex === 18 ? ex : ex + 3, ey - 2, mul(skin, 0.7), 0.6); }
    // брови
    const by = ey - 3;
    const thick = !f && rng.chance(0.6);
    for (let x = ex - (ex === 18 ? 1 : 0); x < ex + 4 + (ex === 27 ? 1 : 0); x++) {
      const yy = by + ((ex === 18 && x === ex - 1) || (ex === 27 && x === ex + 4) ? 1 : 0);
      b.put(x, yy, browC, f ? 0.75 : 1); if (thick) b.put(x, yy - 1, browC, 0.5);
    }
  }
  // нос
  for (let y = ey + 1; y <= ey + 5; y++) b.put(cx + 1, y, mul(b.get(cx + 1, y), 0.8));
  b.put(cx, ey + 5, mul(skin, 1.06)); b.put(cx - 1, ey + 6, mul(skin, 0.55)); b.put(cx + 1, ey + 6, mul(skin, 0.5)); b.put(cx, ey + 6, mul(skin, 0.78));
  // носогубные и морщины
  if (spec.age > 40) { b.put(cx - 4, ey + 7, mul(skin, 0.76)); b.put(cx + 4, ey + 7, mul(skin, 0.72)); b.put(cx - 4, ey + 8, mul(skin, 0.8)); b.put(cx + 4, ey + 8, mul(skin, 0.78)); }
  if (spec.age > 52) for (let x = cx - 4; x <= cx + 4; x++) { if (x % 2) b.put(x, 19, mul(b.get(x, 19), 0.86)); }
  // рот
  const my = ey + 9;
  const down = spec.mood === 'angry' || spec.mood === 'crying' || spec.mood === 'scared' || spec.kind === 'detainee';
  if (f) {
    const lip = rng.pick([[168, 52, 58], [150, 60, 66], [182, 80, 82], [130, 46, 54]]);
    for (let x = cx - 3; x <= cx + 3; x++) b.put(x, my, lip);
    for (let x = cx - 2; x <= cx + 2; x++) b.put(x, my + 1, mix(lip, [220, 150, 150], 0.25));
    b.put(cx, my, mul(lip, 0.7));
    // румяна
    b.ellipse(cx - 6.5, ey + 5, 2.2, 1.4, [214, 120, 116, 0.22]); b.ellipse(cx + 6.5, ey + 5, 2.2, 1.4, [214, 120, 116, 0.22]);
    // серьги
    b.put(cx - 11, 30, [222, 186, 80]); b.put(cx + 10, 30, [222, 186, 80]);
  } else {
    for (let x = cx - 3; x <= cx + 3; x++) b.put(x, my, mul(skin, 0.5));
    b.put(cx - 1, my + 1, mul(skin, 0.86)); b.put(cx, my + 1, mul(skin, 0.86)); b.put(cx + 1, my + 1, mul(skin, 0.86));
  }
  if (down) { b.put(cx - 4, my + 1, mul(skin, 0.6)); b.put(cx + 4, my + 1, mul(skin, 0.6)); }
  else if (spec.mood === 'drunk' || spec.mood === 'calm') { b.put(cx - 4, my - 1, mul(skin, 0.65)); b.put(cx + 4, my - 1, mul(skin, 0.65)); }
  if (spec.mood === 'drunk') { b.ellipse(cx, ey + 5, 2, 1.5, [200, 70, 70, 0.35]); b.ellipse(cx - 6, ey + 4, 2.4, 1.6, [200, 80, 80, 0.3]); b.ellipse(cx + 6, ey + 4, 2.4, 1.6, [200, 80, 80, 0.3]); }
  if (spec.mood === 'crying') { b.put(19, ey + 2, [170, 200, 220]); b.put(19, ey + 3, [150, 186, 210], 0.7); b.put(29, ey + 2, [170, 200, 220]); }
  // подбородок
  b.put(cx, 38, mul(skin, 0.82), 0.6);
}

function drawHairFront(b, spec, hairAt, cx, rx, cy, ry, f, hat) {
  const hs = spec.hair;
  const capped = hat === 'cap' || hat === 'helmet' || hat === 'ushanka' || hat === 'beanie';
  const vol = !f && hs === 1 ? 0.4 : !f && hs === 3 ? 0 : !f && hs === 5 ? 2.4 : f && hs === 4 ? 2.2 : 1.3;
  const top = cy - ry - vol;
  // линия роста волос: hairline(x) — y, выше которой (меньше) — волосы
  const hl = (x) => {
    const dx = Math.abs(x + 0.5 - cx) / rx;
    if (!f && hs === 3) return 0; // лысина: обрабатываем отдельно
    let base = f ? (hs === 5 ? 22.5 : hs === 1 ? 17.5 : hs === 3 ? 20 : 19.5) : (hs === 1 ? 17.6 : hs === 2 ? 19 : 18.4);
    if (f && hs === 0) base = 20.5;
    if (!f && hs === 2) base += (x < cx ? -0.5 : 1.2);
    return base + dx * dx * (f ? 3 : 6.5);
  };
  for (let y = Math.floor(top - 1); y < 40; y++) for (let x = 8; x < 40; x++) {
    const nx = (x + 0.5 - cx) / (rx + vol), ny = (y + 0.5 - cy) / (ry + vol);
    const inCap = nx * nx + ny * ny <= 1;
    if (!inCap) continue;
    const onFace = b.mask[y * PW + x] === 1;
    let isHair = false;
    if (!f && hs === 3) {
      // лысина с венчиком
      isHair = Math.abs(nx) > 0.72 && y > cy - 6 && y < cy + 3;
    } else if (y < hl(x)) isHair = true;
    // виски и бакенбарды
    const side = Math.abs(x + 0.5 - cx) > rx - 1.6;
    if (!f && side && y >= hl(x) && y < 28 && hs !== 1) isHair = true;
    if (f && (hs === 0 || hs === 2 || hs === 4) && Math.abs(x + 0.5 - cx) > rx - (hs === 0 ? 2.8 : 2.2) && y < (hs === 0 ? 39 : 37)) isHair = true;
    if (!isHair) continue;
    if (capped && y < 20) continue; // под фуражкой
    let k = 0.25 + 0.95 * ndl(nx, ny);
    if (!f && hs === 1) { if (onFace) { b.put(x, y, hairAt(x, y, k * 0.9), 0.72); continue; } k *= 0.9; }
    if (!f && hs === 2 && Math.abs(x - (cx - 4)) < 0.6 && y < 19) { b.put(x, y, mul(b.get(x, y), 1)); continue; } // пробор
    b.put(x, y, hairAt(x, y, k));
  }
  // кудри: бугристый контур
  if ((!f && hs === 5) || (f && hs === 4)) {
    for (let i = 0; i < 18; i++) {
      const a = Math.PI + (i / 17) * Math.PI;
      const r = rx + vol + 0.2;
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * (ry + vol) * 0.95;
      if (capped && py < 20) continue;
      b.ellipse(px, py, 1.8, 1.8, (x, y, nx, ny) => hairAt(x, y, 0.35 + 0.7 * ndl(nx, ny)));
    }
  }
  // чёлка у женщин
  if (f && (hs === 0 || hs === 5 || hs === 3) && !capped) {
    const bottom = hs === 5 ? 22.6 : hs === 0 ? 21.2 : 20.5;
    for (let x = Math.round(cx - rx + 2); x < cx + rx - 1; x++) for (let y = 15; y < bottom + (x % 3 === 0 ? 1 : 0); y++) b.put(x, y, hairAt(x, y, 0.6 + 0.4 * ndl((x - cx) / rx, -0.4)));
  }
  // лысина — блик
  if (!f && hs === 3 && !capped) { b.put(cx - 4, cy - 9, [255, 240, 226], 0.7); b.put(cx - 3, cy - 9, [255, 236, 220], 0.5); }
}

function drawTorso(b, spec, rng, bw, f) {
  const cx = 24, sw = (f ? 17 : 19.5) * bw;
  const pts = [[cx - sw - 4, 56], [cx - sw - 2, 48], [cx - sw + 4, 43.5], [cx - 6, 41], [cx + 6, 41], [cx + sw - 4, 43.5], [cx + sw + 2, 48], [cx + sw + 4, 56]];
  const u = spec.uniform;
  const sweaterPool = [[110, 72, 52], [70, 84, 62], [108, 40, 46], [96, 98, 100], [48, 56, 82], [132, 118, 92]];
  const blousePool = [[180, 160, 136], [124, 52, 68], [64, 110, 118], [150, 132, 170], [186, 186, 190], [96, 40, 52]];
  let base = [100, 100, 100];
  if (u === 'militia') base = [106, 114, 122];
  else if (u === 'militia_coat') base = [74, 78, 84];
  else if (u === 'omon') base = [58, 64, 72];
  else if (u === 'civil_m') base = spec.formal ? [44, 48, 58] : rng.pick(sweaterPool);
  else if (u === 'civil_f') base = spec.formal ? [150, 40, 50] : rng.pick(blousePool);
  else if (u === 'bandit_track') base = rng.pick([[34, 48, 98], [26, 26, 30], [26, 92, 96], [110, 26, 34]]);
  else if (u === 'bandit_leather') base = [30, 28, 28];
  else if (u === 'bandit_camo') base = [86, 92, 60];
  else if (u === 'junkie') base = [96, 94, 88];
  else if (u === 'prisoner') base = [62, 62, 66];
  else if (u === 'medic') base = [226, 228, 226];
  spec._torso = base;
  b.poly(pts, (x, y) => {
    const nx = (x + 0.5 - cx) / (sw + 4), k = 0.48 + 0.42 * (1 - Math.abs(nx + 0.25)) - (y > 52 ? 0.08 : 0);
    let c = base;
    if (u === 'bandit_camo' || u === 'omon') { const n = bay(x >> 1, y >> 1) + bay(x >> 2, (y >> 2) + 1); if (n > 1.3) c = u === 'omon' ? [36, 40, 46] : [60, 66, 40]; else if (n < 0.5) c = u === 'omon' ? [86, 94, 104] : [118, 110, 76]; }
    if (u === 'bandit_leather' && Math.abs(x - (cx - 9)) < 1 && y > 45) return lit([96, 92, 90], 0.9, x, y, 3);
    return lit(c, k, x, y, 4);
  });
  if (u === 'bandit_track') {
    // три полосы по плечам
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      const x0 = cx + s * (sw - 2 + i * 1.6);
      for (let y = 44 + i; y < 56; y++) b.put(x0 + s * (y - 44) * 0.18, y, [222, 222, 218]);
    }
    for (let y = 44; y < 56; y++) b.put(cx, y, [150, 150, 150]);
  }
  if (u === 'militia' || u === 'militia_coat' || u === 'omon') {
    // погоны
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? Math.round(cx - sw + 2) : Math.round(cx + sw - 9);
      b.rect(x0, 44, 7, 2, (x, y) => lit(mul(base, 0.75), 0.8, x, y, 3));
      const r = String(spec.rank || '');
      const officer = /лейтенант|капитан|майор|полковник/.test(r);
      if (officer) { for (let x = x0; x < x0 + 7; x++) b.put(x, 45, [150, 36, 34]); }
      if (/майор|подполковник|полковник/.test(r)) { b.put(x0 + 3, 44, [236, 200, 90]); if (/подполковник/.test(r)) b.put(x0 + 5, 44, [236, 200, 90]); }
      else if (/капитан/.test(r)) { b.put(x0 + 1, 44, [230, 196, 90]); b.put(x0 + 3, 44, [230, 196, 90]); b.put(x0 + 5, 44, [230, 196, 90]); }
      else if (/лейтенант/.test(r)) { b.put(x0 + 2, 44, [230, 196, 90]); b.put(x0 + 4, 44, [230, 196, 90]); }
      else if (/прапорщик/.test(r)) { b.put(x0 + 2, 44, [230, 196, 90]); b.put(x0 + 4, 44, [230, 196, 90]); }
      else if (/сержант|старшина/.test(r)) { const n = /старший|старшина/.test(r) ? 3 : /младший/.test(r) ? 1 : 2; for (let k = 0; k < n; k++) { b.put(x0 + 2 + k * 2, 44, [214, 180, 70]); b.put(x0 + 2 + k * 2, 45, [214, 180, 70]); } }
    }
    if (u === 'militia_coat') for (const s of [-1, 1]) for (let y = 47; y < 56; y += 3) b.put(cx + s * 4, y, [214, 180, 80]);
  }
}

/** воротник/рубашка поверх шеи */
function redrawCollar(b, spec, rng, bw, f) {
  const cx = 24, u = spec.uniform, base = spec._torso || [100, 100, 100];
  if (u === 'militia') {
    const shirt = [158, 182, 204];
    b.poly([[cx - 6, 41], [cx + 6, 41], [cx + 1.5, 52], [cx - 1.5, 52]], (x, y) => lit(shirt, 0.85, x, y, 4));
    // лацканы
    b.poly([[cx - 6.5, 41], [cx - 2, 43], [cx - 1.5, 53], [cx - 5, 50]], (x, y) => lit(mul(base, 0.88), 0.75, x, y, 3));
    b.poly([[cx + 6.5, 41], [cx + 2, 43], [cx + 1.5, 53], [cx + 5, 50]], (x, y) => lit(mul(base, 0.88), 0.65, x, y, 3));
    if (!f) { b.rect(cx - 1, 42, 2, 1, [40, 46, 58]); for (let y = 43; y < 56; y++) { b.put(cx - 1, y, [44, 52, 66]); b.put(cx, y, [36, 42, 54]); } }
    else { b.put(cx - 1, 43, [150, 36, 40]); b.put(cx, 43, [150, 36, 40]); b.put(cx, 44, [130, 30, 36]); }
  } else if (u === 'militia_coat' || u === 'omon') {
    b.poly([[cx - 7, 40], [cx + 7, 40], [cx + 4, 46], [cx - 4, 46]], (x, y) => lit(mul(base, 0.85), 0.8, x, y, 3));
  } else if (u === 'civil_m') {
    if (spec.formal) {
      b.poly([[cx - 5, 41], [cx + 5, 41], [cx + 1, 52], [cx - 1, 52]], (x, y) => lit([220, 222, 226], 0.9, x, y, 4));
      for (let y = 42; y < 56; y++) { b.put(cx - 1, y, [110, 30, 36]); b.put(cx, y, [96, 26, 32]); }
    } else {
      const shirt = rng.pick([[200, 204, 210], [150, 170, 196], [180, 160, 130]]);
      b.poly([[cx - 6, 40.5], [cx - 1, 43.5], [cx - 4, 45.5]], (x, y) => lit(shirt, 0.85, x, y, 3));
      b.poly([[cx + 6, 40.5], [cx + 1, 43.5], [cx + 4, 45.5]], (x, y) => lit(shirt, 0.75, x, y, 3));
    }
  } else if (u === 'civil_f') {
    if (spec.formal) { b.poly([[cx - 5, 41], [cx + 5, 41], [cx, 49]], (x, y) => lit([228, 224, 216], 0.9, x, y, 4)); b.put(cx - 7, 47, [226, 196, 96]); }
    else { b.poly([[cx - 5.5, 40.5], [cx + 5.5, 40.5], [cx + 3, 44], [cx - 3, 44]], (x, y) => lit(mul(base, 1.12), 0.85, x, y, 3)); if (rng.chance(0.5)) b.put(cx, 45, [226, 210, 160]); }
  } else if (u === 'bandit_leather' || u === 'bandit_track') {
    if (u === 'bandit_leather') b.poly([[cx - 5.5, 40], [cx + 5.5, 40], [cx + 5, 44], [cx - 5, 44]], (x, y) => lit(rng.pick([[24, 24, 26], [90, 24, 30]]), 0.8, x, y, 3));
    // цепь
    for (let x = cx - 4; x <= cx + 4; x++) { const y = 44 + Math.round(Math.abs(x - cx) * -0.4 + 1.6); if ((x & 1) === 0) b.put(x, y, [236, 196, 74]); else b.put(x, y, [180, 140, 50]); }
  } else if (u === 'junkie') {
    b.poly([[cx - 8, 40], [cx + 8, 40], [cx + 7, 44], [cx - 7, 44]], (x, y) => lit(mul(base, 0.85), 0.7, x, y, 3));
    b.put(cx - 2, 46, [220, 220, 220]); b.put(cx - 2, 47, [220, 220, 220]); b.put(cx + 2, 46, [220, 220, 220]);
  } else if (u === 'medic') {
    b.poly([[cx - 5, 41], [cx + 5, 41], [cx, 50]], (x, y) => lit([150, 190, 210], 0.9, x, y, 3));
  }
}

function drawHat(b, spec, rng, cx, rx, f) {
  const hat = spec.hat;
  if (hat === 'cap') {
    const crown = [96, 106, 116], band = [160, 34, 30];
    // тулья (верх) — широкий эллипс
    b.ellipse(cx, 12.4, 14.5, 4.6, (x, y, nx, ny) => lit(crown, 0.55 + 0.55 * ndl(nx, ny * 0.5 - 0.5), x, y, 4));
    // стенка
    b.poly([[cx - 13.6, 13], [cx + 13.6, 13], [cx + 11.2, 18.5], [cx - 11.2, 18.5]], (x, y) => lit(crown, 0.6 + 0.3 * (1 - Math.abs(x + 0.5 - cx) / 14), x, y, 4));
    // околыш
    b.rect(Math.round(cx - 11), 17, 22, 3, (x, y) => lit(band, 0.75 + 0.25 * (1 - Math.abs(x + 0.5 - cx) / 11), x, y, 3));
    // кокарда
    b.put(cx - 1, 15, [236, 204, 96]); b.put(cx, 15, [250, 222, 120]); b.put(cx - 1, 16, [200, 160, 60]); b.put(cx, 16, [214, 176, 70]);
    b.put(cx - 1, 18, [236, 200, 90]); b.put(cx, 18, [236, 200, 90]);
    // козырёк
    b.ellipse(cx, 19.6, 11.6, 3.2, (x, y, nx, ny) => (ny < 0 ? null : lit([20, 20, 22], 0.6 + 0.6 * (nx < -0.2 && ny < 0.5 ? 1 : 0), x, y, 3)));
    // тень от козырька на лбу
    for (let x = cx - 8; x < cx + 8; x++) { const y = 23; b.put(x, y, mul(b.get(x, y), 0.82)); }
  } else if (hat === 'ushanka') {
    const fur = rng.pick([[96, 74, 52], [70, 64, 58], [40, 38, 36]]);
    b.ellipse(cx, 15, 13.5, 8.5, (x, y, nx, ny) => (y > 20 ? null : lit(fur, 0.45 + 0.6 * ndl(nx, ny) + (bay(x * 3, y * 2) - 0.5) * 0.3, x, y, 4)));
    b.rect(cx - 13, 18, 26, 4, (x, y) => lit(fur, 0.7 + (bay(x * 2, y * 3) - 0.5) * 0.4, x, y, 3));
    for (const s of [-1, 1]) b.rect(s < 0 ? cx - 14 : cx + 10, 21, 4, 11, (x, y) => lit(fur, 0.55 + (bay(x, y * 3) - 0.5) * 0.4, x, y, 3));
  } else if (hat === 'beanie') {
    const knit = rng.pick([[30, 30, 34], [34, 40, 66], [90, 30, 36], [60, 62, 58]]);
    b.ellipse(cx, 18, 11.6, 9.4, (x, y, nx, ny) => (y > 21 ? null : lit(knit, 0.4 + 0.7 * ndl(nx, ny) + ((x & 1) ? -0.08 : 0.06), x, y, 4)));
    b.rect(cx - 11, 18, 22, 3, (x, y) => lit(mul(knit, 0.9), 0.75 + ((x & 1) ? -0.15 : 0.1), x, y, 3));
  } else if (hat === 'helmet') {
    const sh = [84, 92, 80];
    b.ellipse(cx, 18, 13.5, 10.5, (x, y, nx, ny) => (y > 22 ? null : lit(sh, 0.4 + 0.8 * ndl(nx, ny), x, y, 4)));
    b.rect(cx - 13, 21, 26, 2, (x, y) => lit(mul(sh, 0.8), 0.7, x, y, 3));
    for (let y = 23; y < 37; y++) { b.put(cx - 10 + Math.round((y - 23) * 0.25), y, [36, 34, 30]); b.put(cx + 9 - Math.round((y - 23) * 0.25), y, [36, 34, 30]); }
  } else if (hat === 'mask') {
    // балаклава уже нарисована вместо лица; добавим макушку
    b.ellipse(cx, 18, 10.6, 9, (x, y, nx, ny) => (y > 22 ? null : lit([28, 28, 30], 0.4 + 0.7 * ndl(nx, ny), x, y, 4)));
  }
}

/** Для экрана выбора командира: случайная внешность */
export function randomLook(rng, gender) {
  return { skin: rng.int(0, 2), hair: rng.int(0, 5), build: rng.range(0.92, 1.08), mustache: gender === 'm' && rng.chance(0.4), glasses: rng.chance(0.15) };
}
