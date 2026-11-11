// Построение статической геометрии участка по сетке мира: стены, окна, полы, потолки, фасад, окрестности, светильники.
import { GeoBuilder } from './gl.js';
import { CELL, ORIGIN, ROOMS, PROPS } from '../world/level.js';
import { buildProp } from './props.js';
import { box } from './characters.js';
import { Xf } from './math.js';

export const ZONE_IDS = ['office', 'opers', 'armory', 'ivs', 'generator', 'corridor', 'toilet', 'rest', 'lobby', 'duty', 'street', 'yard', 'alley'];
export const zoneIndex = (id) => { const k = ZONE_IDS.indexOf(id); return k < 0 ? 10 : k; };

const H = 3.0, FACADE = 6.6;
const PAINT = {
  office: [0.80, 0.70, 0.54], opers: [0.56, 0.66, 0.74], armory: [0.60, 0.63, 0.60], ivs: [0.46, 0.56, 0.52], generator: null,
  corridor: [0.46, 0.63, 0.50], toilet: 'tile', rest: [0.82, 0.66, 0.54], lobby: [0.42, 0.58, 0.62], duty: [0.50, 0.63, 0.52],
};
const WHITE = { default: [0.95, 0.94, 0.9], ivs: [0.82, 0.84, 0.82], generator: [0.8, 0.8, 0.78], toilet: [0.92, 0.92, 0.9] };
const FLOOR_TEX = { '.': ['lino', 1.5], ',': ['tiles', 1.2], ':': ['concrete', 2], '_': ['asphalt', 3], '=': ['mud', 2.5], '-': ['sidewalk', 2] };
const ROOM_FLOOR = Object.fromEntries(ROOMS.map((r) => [r.id, r.floor]));
const OUT_FLOOR = { street: '_', yard: '=', alley: '=' };

function inBuilding(x, z) { return x > -0.5 && x < 32 && z > -0.5 && z < 20; }

export function buildLevel(world) {
  const G = {}; // texName -> GeoBuilder
  const g = (name) => (G[name] || (G[name] = new GeoBuilder(4096)));
  const lights = []; const screens = []; const vehicles = []; const glass = new GeoBuilder(512); const bars = new GeoBuilder(512);
  const W = world; const at = (i, j) => W.at(i, j);

  const solid = (c, outdoorFacing) => {
    switch (c) {
      case '#': return [[0, outdoorFacing ? FACADE : H]];
      case 'W': return [[0, 0.9], [2.2, outdoorFacing ? FACADE : H]];
      case 'D': return [[2.1, outdoorFacing ? FACADE : H]];
      case 'F': return [[0, 2.2]];
      default: return [];
    }
  };
  const subtract = (A, B) => {
    let res = A.map((x) => x.slice());
    for (const [b0, b1] of B) { const n = []; for (const [a0, a1] of res) { if (b1 <= a0 || b0 >= a1) n.push([a0, a1]); else { if (b0 > a0) n.push([a0, b0]); if (b1 < a1) n.push([b1, a1]); } } res = n; }
    return res.filter(([a, b]) => b - a > 1e-3);
  };
  const isOutdoorCell = (i, j) => { const [x, z] = W.cellCenter(i, j); return !inBuilding(x, z); };

  // ——— вертикальные грани ———
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let j = 0; j < W.H; j++) for (let i = 0; i < W.W; i++) {
    const c = at(i, j); if (!'#WDF'.includes(c)) continue;
    const [cx, cz] = W.cellCenter(i, j); const x0 = cx - CELL / 2, z0 = cz - CELL / 2, x1 = cx + CELL / 2, z1 = cz + CELL / 2;
    for (const [di, dj] of DIRS) {
      const nc = at(i + di, j + dj); if (nc === ' ' ) continue;
      const [nx, nz] = W.cellCenter(i + di, j + dj);
      const nOut = isOutdoorCell(i + di, j + dj) && c !== 'F' && !isOutdoorCell(i, j) ? true : isOutdoorCell(i + di, j + dj);
      const outdoorFacing = nOut && !isOutdoorCell(i, j); // фасад здания
      const mine = solid(c, outdoorFacing);
      const theirs = solid(nc, outdoorFacing && !isOutdoorCell(i + di, j + dj));
      const faces = subtract(mine, theirs); if (!faces.length) continue;
      // геометрия грани на ребре клетки
      let p0, p1, n;
      if (di === 1) { p0 = [x1, z1]; p1 = [x1, z0]; n = [1, 0, 0]; }
      else if (di === -1) { p0 = [x0, z0]; p1 = [x0, z1]; n = [-1, 0, 0]; }
      else if (dj === 1) { p0 = [x0, z1]; p1 = [x1, z1]; n = [0, 0, 1]; }
      else { p0 = [x1, z0]; p1 = [x0, z0]; n = [0, 0, -1]; }
      const zoneId = W.zoneAt(nx, nz); const zi = zoneIndex(nOut ? (zoneId === 'yard' || zoneId === 'alley' ? zoneId : 'street') : zoneId);
      const along0 = di !== 0 ? p0[1] : p0[0], along1 = di !== 0 ? p1[1] : p1[0];
      for (const [y0, y1] of faces) {
        if (c === 'F') { const b = g('fence'); b.zone = zi; quadV(b, p0, p1, y0, y1, n, along0 / 2.2, along1 / 2.2, (yy) => 1 - yy / 2.2, [0.9, 0.9, 0.9]); continue; }
        if (nOut) { const b = g('extwall'); b.zone = zi; quadV(b, p0, p1, y0, y1, n, along0 / 2, along1 / 2, (yy) => -yy / 2, [0.85, 0.85, 0.85]); continue; }
        // интерьер: низ — краска (до 1.5), верх — побелка
        const paint = PAINT[zoneId];
        const split = (a, b, cut) => (a < cut && b > cut ? [[a, cut], [cut, b]] : [[a, b]]);
        for (const [a, b] of split(y0, y1, paint === 'tile' ? 1.8 : 1.5)) {
          const lower = b <= (paint === 'tile' ? 1.8 : 1.5) + 1e-4;
          if (paint === 'tile' && lower) { const bb = g('walltile'); bb.zone = zi; quadV(bb, p0, p1, a, b, n, along0 / 1, along1 / 1, (yy) => -yy / 1, [1, 1, 1]); }
          else if (lower && paint) { const bb = g('paint'); bb.zone = zi; quadV(bb, p0, p1, a, b, n, along0 / 1.5, along1 / 1.5, (yy) => 1 - yy / 1.5, paint); }
          else if (lower && !paint) { const bb = g('concrete'); bb.zone = zi; quadV(bb, p0, p1, a, b, n, along0 / 2, along1 / 2, (yy) => -yy / 2, [0.85, 0.85, 0.82]); }
          else { const bb = g('whitewash'); bb.zone = zi; quadV(bb, p0, p1, a, b, n, along0 / 1.5, along1 / 1.5, (yy) => (3 - yy) / 1.5, WHITE[zoneId] || WHITE.default); }
        }
      }
    }
    // горизонтальные грани: подоконник, перемычки, верх забора
    const zi = zoneIndex(W.zoneAt(cx, cz));
    if (c === 'W') {
      const b = g('wood'); b.zone = zi; quadH(b, x0 - 0.04, z0 - 0.04, x1 + 0.04, z1 + 0.04, 0.9, true, [0.75, 0.75, 0.72]);
      quadH(g('whitewash'), x0, z0, x1, z1, 2.2, false, [0.8, 0.8, 0.78]);
      // стекло (по центру клетки, вдоль стены)
      const alongX = at(i + 1, j) === 'W' || at(i - 1, j) === 'W' || at(i + 1, j) === '#' && at(i - 1, j) === '#';
      glass.zone = zi;
      if (alongX) { quadV(glass, [x0, cz], [x1, cz], 0.9, 2.2, [0, 0, 1], x0, x1, (yy) => (2.2 - yy) / 1.3, [1, 1, 1], 1); quadV(glass, [x1, cz], [x0, cz], 0.9, 2.2, [0, 0, -1], x1, x0, (yy) => (2.2 - yy) / 1.3, [1, 1, 1], 1); }
      else { quadV(glass, [cx, z1], [cx, z0], 0.9, 2.2, [1, 0, 0], z1, z0, (yy) => (2.2 - yy) / 1.3, [1, 1, 1], 1); quadV(glass, [cx, z0], [cx, z1], 0.9, 2.2, [-1, 0, 0], z0, z1, (yy) => (2.2 - yy) / 1.3, [1, 1, 1], 1); }
      // переплёт рамы
      const fb = g('wood'); fb.zone = zi;
      if (alongX) { boxW(fb, cx, 1.55, cz, 0.02, 0.65, 0.05, [0.55, 0.55, 0.5]); boxW(fb, cx, 1.5, cz, CELL / 2, 0.02, 0.05, [0.55, 0.55, 0.5]); }
      else { boxW(fb, cx, 1.55, cz, 0.05, 0.65, 0.02, [0.55, 0.55, 0.5]); boxW(fb, cx, 1.5, cz, 0.05, 0.02, CELL / 2, [0.55, 0.55, 0.5]); }
    }
    if (c === 'D') { const b = g('whitewash'); b.zone = zi; quadH(b, x0, z0, x1, z1, 2.1, false, [0.75, 0.73, 0.7]); }
    if (c === 'F') { const b = g('concrete'); b.zone = zi; quadH(b, x0, z0, x1, z1, 2.2, true, [0.7, 0.7, 0.7]); }
  }

  // ——— решётки ИВС (alpha-test), включая двери камер (рисуются отдельно, см. dynamic) ———
  for (let j = 0; j < W.H; j++) for (let i = 0; i < W.W; i++) {
    const c = at(i, j); if (c !== 'B') continue;
    const [cx, cz] = W.cellCenter(i, j); bars.zone = zoneIndex('ivs');
    quadV(bars, [cx - CELL / 2, cz], [cx + CELL / 2, cz], 0, H, [0, 0, 1], (cx - CELL / 2) * 2, (cx + CELL / 2) * 2, (yy) => (H - yy) * 2, [1, 1, 1]);
    quadV(bars, [cx + CELL / 2, cz], [cx - CELL / 2, cz], 0, H, [0, 0, -1], (cx + CELL / 2) * 2, (cx - CELL / 2) * 2, (yy) => (H - yy) * 2, [1, 1, 1]);
  }

  // ——— полы и потолки ———
  for (let j = 0; j < W.H; j++) for (let i = 0; i < W.W; i++) {
    const c = at(i, j); if (c === ' ' || c === '#' || c === 'F' || c === 'W' || c === 'B') continue;
    const [cx, cz] = W.cellCenter(i, j); const zid = W.zoneAt(cx, cz);
    let fc = FLOOR_TEX[c] ? c : (ROOM_FLOOR[zid] || OUT_FLOOR[zid] || '_');
    if (c === 'D' && !inBuilding(cx, cz)) fc = '-';
    if ((c === 'D' || c === 'b') && inBuilding(cx, cz)) fc = ROOM_FLOOR[zid] || '.';
    const [tex, sc] = FLOOR_TEX[fc];
    const b = g(tex); b.zone = zoneIndex(zid);
    const x0 = cx - CELL / 2, z0 = cz - CELL / 2;
    const y = fc === '-' ? 0.03 : 0;
    b.quad([x0, y, z0 + CELL], [x0 + CELL, y, z0 + CELL], [x0 + CELL, y, z0], [x0, y, z0], [[x0 / sc, (z0 + CELL) / sc], [(x0 + CELL) / sc, (z0 + CELL) / sc], [(x0 + CELL) / sc, z0 / sc], [x0 / sc, z0 / sc]], [1, 1, 1, 1], [0, 1, 0]);
  }
  for (let j = 0; j < W.H; j++) for (let i = 0; i < W.W; i++) {
    const [cx, cz] = W.cellCenter(i, j); if (!inBuilding(cx, cz)) continue;
    const c = at(i, j); if (c === '#' ) continue;
    const b = g('ceiling'); b.zone = zoneIndex(W.zoneAt(cx, cz)); const x0 = cx - CELL / 2, z0 = cz - CELL / 2;
    b.quad([x0, H, z0], [x0 + CELL, H, z0], [x0 + CELL, H, z0 + CELL], [x0, H, z0 + CELL], [[x0 / 1.5, z0 / 1.5], [(x0 + CELL) / 1.5, z0 / 1.5], [(x0 + CELL) / 1.5, (z0 + CELL) / 1.5], [x0 / 1.5, (z0 + CELL) / 1.5]], [0.9, 0.9, 0.88, 1], [0, -1, 0]);
  }

  // ——— крыша, фасад второго этажа, окрестности ———
  { const b = g('concrete'); b.zone = 10;
    b.quad([-0.5, FACADE, 20], [32, FACADE, 20], [32, FACADE, -0.5], [-0.5, FACADE, -0.5], null, [0.4, 0.4, 0.42, 1], [0, 1, 0]);
    // окна второго этажа (тёмные; одно светится)
    const up = g('panel'); up.zone = 10;
    for (const wx of [1.5, 7, 12, 20.25, 28.25]) quadV(up, [wx - 0.9, 20.02], [wx + 0.9, 20.02], 3.9, 5.4, [0, 0, 1], 0, 0.25, (yy) => (5.4 - yy) / 6, [0.9, 0.9, 0.9]);
    for (const wx of [3, 10, 16, 24]) quadV(up, [wx + 0.9, -0.52], [wx - 0.9, -0.52], 3.9, 5.4, [0, 0, -1], 0.5, 0.75, (yy) => (5.4 - yy) / 6, [0.9, 0.9, 0.9]);
    // карниз
    const k = g('concrete'); k.zone = 10; boxW(k, 15.75, FACADE + 0.1, 9.75, 16.5, 0.12, 10.5, [0.5, 0.5, 0.52]);
  }
  // далёкие дома (панельки) по периметру — в тумане
  const far = g('panel'); far.zone = 10;
  const bld = (x0, z0, x1, z1, h) => {
    const cy = h / 2; const tex = (yy) => -yy / 6;
    quadV(far, [x0, z1], [x1, z1], 0, h, [0, 0, 1], x0 / 6, x1 / 6, tex, [0.8, 0.8, 0.85]);
    quadV(far, [x1, z0], [x0, z0], 0, h, [0, 0, -1], x1 / 6, x0 / 6, tex, [0.8, 0.8, 0.85]);
    quadV(far, [x1, z1], [x1, z0], 0, h, [1, 0, 0], z1 / 6, z0 / 6, tex, [0.8, 0.8, 0.85]);
    quadV(far, [x0, z0], [x0, z1], 0, h, [-1, 0, 0], z0 / 6, z1 / 6, tex, [0.8, 0.8, 0.85]);
  };
  bld(-20, 34, 4, 44, 27); bld(8, 36, 34, 46, 15); bld(38, 33, 58, 45, 27); // через улицу
  bld(-24, -30, -8, -10, 15); bld(-6, -22, 30, -12, 6); bld(40, -26, 62, -6, 9); // за двором: гаражи и дома
  bld(40, -4, 56, 28, 12); bld(-22, -8, -8, 28, 9); // по бокам
  // асфальт и земля за пределами сетки
  { const a = g('asphalt'); a.zone = 10; const sc = 3;
    const Q = (x0, z0, x1, z1) => a.quad([x0, -0.005, z1], [x1, -0.005, z1], [x1, -0.005, z0], [x0, -0.005, z0], [[x0 / sc, z1 / sc], [x1 / sc, z1 / sc], [x1 / sc, z0 / sc], [x0 / sc, z0 / sc]], [0.8, 0.8, 0.8, 1], [0, 1, 0]);
    for (let x = -60; x < 80; x += 6) { Q(x, 29.5, x + 6, 34); Q(x, 34, x + 6, 50); }
    for (let z = -40; z < 30; z += 6) { Q(-60, z, -6, z + 6); Q(38, z, 80, z + 6); }
    for (let x = -6; x < 38; x += 6) Q(x, -40, x + 6, -8);
  }
  // бордюр у тротуара
  { const k = g('concrete'); k.zone = 10; boxW(k, 16, 0.06, 23.05, 22, 0.06, 0.08, [0.7, 0.7, 0.68]); }

  // ——— потолочные светильники (лампы дневного света) ———
  const fixtures = [];
  for (const r of ROOMS) {
    const [x0, z0, x1, z1] = r.rect; const ix1 = x1 - 0.5, iz1 = z1 - 0.5; const w = ix1 - x0, d = iz1 - z0;
    const nx = Math.max(1, Math.round(w / 4.5)), nz = Math.max(1, Math.round(d / 4.5));
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
      const lx = x0 + (a + 0.5) * w / nx, lz = z0 + (b + 0.5) * d / nz;
      const warm = r.id === 'rest' || r.id === 'office';
      const dim = r.id === 'ivs' || r.id === 'generator' || r.id === 'toilet';
      const col = warm ? [1.0, 0.86, 0.62] : dim ? [0.75, 0.8, 0.75] : [0.82, 0.92, 1.0];
      const flicker = (r.id === 'corridor' && a === 4) || (r.id === 'ivs' && a === 0) ? 0.5 : 0;
      fixtures.push({ x: lx, z: lz, warm, room: r.id });
      lights.push({ x: lx, y: 2.75, z: lz, color: col.map((v) => v * (dim ? 0.75 : 1)), radius: Math.max(5.5, Math.min(7, Math.max(w / nx, d / nz) * 1.4)), zones: [zoneIndex(r.id)], power: true, flicker, kind: 'ceiling', room: r.id });
    }
  }
  { const b = g('props'); const A = null; // светильники строятся при наличии атласа, см. buildPropsMesh
  }
  // свет улицы — мягкая подсветка из окон на улицу
  for (const wx of [7, 12, 28.25]) lights.push({ x: wx, y: 1.6, z: 20.8, color: [0.5, 0.48, 0.38], radius: 3.5, zones: [10], power: true, kind: 'windowglow', outdoor: true });

  return { G, glass, bars, lights, fixtures, screens, vehicles };
}

/** Мебель и светильники — в атлас предметов */
export function buildPropsMesh(world, propAtlas, level) {
  const geo = new GeoBuilder(16384); const out = { lights: [], screens: level.screens, vehicles: level.vehicles };
  for (const p of PROPS) { if (p.hidden) continue; geo.zone = zoneIndex(world.zoneAt(p.x, p.z)); buildProp(geo, p, propAtlas, out); }
  // светильники дневного света
  for (const f of level.fixtures) {
    geo.zone = zoneIndex(f.room); const xf = new Xf().mulLocal(f.x, 3.0, f.z, 0, 0, 0);
    box(geo, xf, 0, -0.04, 0, 0.62, 0.035, 0.12, { front: ['metal'], side: ['metal'], bottom: ['metal'], back: ['metal'] }, propAtlas);
    box(geo, xf, 0, -0.08, 0.05, 0.58, 0.012, 0.018, { front: ['tube'], bottom: ['tube'], side: ['tube'], back: ['tube'] }, propAtlas, 3);
    box(geo, xf, 0, -0.08, -0.05, 0.58, 0.012, 0.018, { front: ['tube'], bottom: ['tube'], side: ['tube'], back: ['tube'] }, propAtlas, 3);
  }
  for (const l of out.lights) { if (!l.zones) l.zones = [zoneIndex(world.zoneAt(l.x, l.z))]; l.power = l.power ?? !l.outdoor; }
  return { geo, lights: out.lights };
}

// ——— помощники ———
function quadV(b, p0, p1, y0, y1, n, u0, u1, vf, col, a = 1) {
  b.quad([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], [[u0, vf(y0)], [u1, vf(y0)], [u1, vf(y1)], [u0, vf(y1)]], [col[0], col[1], col[2], a], n);
}
function quadH(b, x0, z0, x1, z1, y, up, col) {
  if (up) b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [[x0, z1], [x1, z1], [x1, z0], [x0, z0]], [col[0], col[1], col[2], 1], [0, 1, 0]);
  else b.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [col[0], col[1], col[2], 1], [0, -1, 0]);
}
function boxW(b, cx, cy, cz, hx, hy, hz, col) {
  const c = [col[0], col[1], col[2], 1]; const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
  b.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [[0, 1], [1, 1], [1, 0], [0, 0]], c, [0, 0, 1]);
  b.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [[0, 1], [1, 1], [1, 0], [0, 0]], c, [0, 0, -1]);
  b.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [[0, 1], [1, 1], [1, 0], [0, 0]], c, [1, 0, 0]);
  b.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [[0, 1], [1, 1], [1, 0], [0, 0]], c, [-1, 0, 0]);
  b.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [[0, 1], [1, 1], [1, 0], [0, 0]], c, [0, 1, 0]);
  b.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [[0, 1], [1, 1], [1, 0], [0, 0]], c, [0, -1, 0]);
}
export { quadV, boxW };
