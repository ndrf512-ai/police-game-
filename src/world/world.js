// Мир участка: сетка, навигация (A*), прямая видимость, лучи, зоны, укрытия, акторы.
// Не зависит от WebGL/DOM — работает и в node для тестов ИИ.
import { CELL, ORIGIN, GRID_W, GRID_H, ROOMS, OUTDOOR, DOORS, POINTS, PROPS, CELLS, buildGrid } from './level.js';
export { CELL, ORIGIN, GRID_W, GRID_H, WALL_H } from './level.js';

const WALK = new Set(['.', ',', ':', '_', '=', '-', 'D']);
const SEE = new Set(['.', ',', ':', '_', '=', '-', 'D', 'W', 'B', 'b', 'o']);
const SHOOT = new Set(['.', ',', ':', '_', '=', '-', 'D', 'W', 'B', 'b', 'o']);

export class World {
  constructor() {
    this.grid = buildGrid();
    this.W = GRID_W; this.H = GRID_H; this.cell = CELL;
    this.points = JSON.parse(JSON.stringify(POINTS));
    this.rooms = ROOMS; this.outdoor = OUTDOOR; this.doors = DOORS.map((d) => ({ ...d, barricade: 0, barricadeMax: 0, locked: false }));
    this.props = PROPS;
    this.actors = [];
    this.openCellDoors = new Set();
    this.dynamicBlock = new Map(); // key "i,j" -> {kind:'barricade', hp, ...}
    this.zoneList = [...ROOMS, ...OUTDOOR].map((r) => ({ id: r.id, name: r.name, rect: r.rect, indoor: !!ROOMS.find((x) => x.id === r.id) }));
    this._zoneCache = new Map();
    this.coverPoints = this._computeCover();
    this.time = 0;
    this.openCellDoors = new Set();
  }
  _cellDoorAt(i, j) {
    const [x, z] = this.cellCenter(i, j);
    for (const c of CELLS) if (x > c.door[0] && x < c.door[2] && z > c.door[1] && z < c.door[3]) return c.id;
    return null;
  }
  /** Открыть/закрыть решётчатую дверь камеры ('cell_1'..'cell_3') */
  setCellDoor(cellId, open) { if (open) this.openCellDoors.add(cellId); else this.openCellDoors.delete(cellId); }

  // ——— координаты ———
  toCell(x, z) { return [Math.floor((x - ORIGIN.x) / CELL), Math.floor((z - ORIGIN.z) / CELL)]; }
  cellCenter(i, j) { return [ORIGIN.x + (i + 0.5) * CELL, ORIGIN.z + (j + 0.5) * CELL]; }
  at(i, j) { return i < 0 || j < 0 || i >= this.W || j >= this.H ? ' ' : this.grid[j][i]; }
  cellWalkable(i, j) {
    const c = this.at(i, j);
    if (c === 'b') return this.openCellDoors.has(this._cellDoorAt(i, j));
    if (!WALK.has(c)) return false;
    const b = this.dynamicBlock.get(i + ',' + j);
    return !(b && b.solid);
  }
  isWalkable(x, z) { const [i, j] = this.toCell(x, z); return this.cellWalkable(i, j); }
  cellSeeThrough(i, j) { const c = this.at(i, j); return SEE.has(c); }
  cellShootThrough(i, j) {
    if (!SHOOT.has(this.at(i, j))) return false;
    return true;
  }

  // ——— зоны ———
  zoneAt(x, z) {
    for (const r of ROOMS) if (x >= r.rect[0] && x <= r.rect[2] && z >= r.rect[1] && z <= r.rect[3]) return r.id;
    for (const r of OUTDOOR) if (x >= r.rect[0] && x <= r.rect[2] && z >= r.rect[1] && z <= r.rect[3]) return r.id;
    return 'street';
  }
  zone(id) { return this.zoneList.find((z) => z.id === id); }
  zoneCenter(id) { const z = this.zone(id); return z ? [(z.rect[0] + z.rect[2]) / 2, (z.rect[1] + z.rect[3]) / 2] : [16, 12]; }
  /** Случайная проходимая точка в зоне */
  randomPointInZone(id, rng) {
    const z = this.zone(id); if (!z) return null;
    for (let k = 0; k < 60; k++) {
      const x = rng.range(z.rect[0] + 0.4, z.rect[2] - 0.4), zz = rng.range(z.rect[1] + 0.4, z.rect[3] - 0.4);
      if (this.isWalkable(x, zz) && this._clearance(x, zz) >= 0.35) return [x, zz];
    }
    return this.zoneCenter(id);
  }
  _clearance(x, z) {
    let best = 1;
    for (const [dx, dz] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) if (!this.isWalkable(x + dx, z + dz)) best = Math.min(best, 0.3);
    return best;
  }
  /** Соседние зоны через двери */
  zoneNeighbors(id) { return this.doors.filter((d) => d.a === id || d.b === id).map((d) => ({ door: d, zone: d.a === id ? d.b : d.a })); }

  // ——— прямая видимость и лучи ———
  /** Луч по сетке (DDA). Возвращает первую непрозрачную клетку или null. mode: 'see' | 'shoot' */
  _trace(x0, z0, x1, z1, mode = 'see') {
    const test = mode === 'see' ? (i, j) => this.cellSeeThrough(i, j) : (i, j) => this.cellShootThrough(i, j);
    const dx = x1 - x0, dz = z1 - z0; const len = Math.hypot(dx, dz);
    if (len < 1e-6) return null;
    const steps = Math.ceil(len / (CELL * 0.25));
    let lastI = -1, lastJ = -1;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps; const x = x0 + dx * t, z = z0 + dz * t;
      const [i, j] = this.toCell(x, z);
      if (i === lastI && j === lastJ) continue; lastI = i; lastJ = j;
      if (!test(i, j)) return { i, j, x, z, t, dist: len * t, cell: this.at(i, j) };
      if (mode === 'see') { const b = this.dynamicBlock.get(i + ',' + j); if (b && b.opaque) return { i, j, x, z, t, dist: len * t, cell: 'barricade' }; }
    }
    return null;
  }
  lineOfSight(x0, z0, x1, z1) { return this._trace(x0, z0, x1, z1, 'see') === null; }
  /** Можно ли простреливать (окна/решётки — да, стены — нет) */
  lineOfFire(x0, z0, x1, z1) { return this._trace(x0, z0, x1, z1, 'shoot') === null; }
  raycast(x0, z0, dirx, dirz, maxDist = 50, mode = 'shoot') {
    const h = this._trace(x0, z0, x0 + dirx * maxDist, z0 + dirz * maxDist, mode);
    return h ? { hit: true, ...h } : { hit: false, dist: maxDist, x: x0 + dirx * maxDist, z: z0 + dirz * maxDist };
  }
  /** Есть ли между точками низкое укрытие (мебель, баррикада) рядом с b */
  coverBetween(ax, az, bx, bz) {
    const dx = ax - bx, dz = az - bz; const l = Math.hypot(dx, dz) || 1;
    for (const d of [0.5, 0.8]) {
      const [i, j] = this.toCell(bx + dx / l * d, bz + dz / l * d);
      const c = this.at(i, j); if (c === 'o') return 0.6;
      const b = this.dynamicBlock.get(i + ',' + j); if (b && b.kind === 'barricade') return 0.75;
      if (c === '#' || c === 'O') return 1.0;
    }
    return 0;
  }

  // ——— навигация A* (8 направлений, без срезания углов) ———
  findPath(x0, z0, x1, z1, opts = {}) {
    let [si, sj] = this.toCell(x0, z0); let [ti, tj] = this.toCell(x1, z1);
    if (!this.cellWalkable(si, sj)) { const n = this._nearestWalkable(si, sj); if (!n) return null; [si, sj] = n; }
    if (!this.cellWalkable(ti, tj)) { const n = this._nearestWalkable(ti, tj); if (!n) return null; [ti, tj] = n; }
    const W = this.W, H = this.H; const N = W * H;
    const g = new Float32Array(N).fill(Infinity); const came = new Int32Array(N).fill(-1); const closed = new Uint8Array(N);
    const start = sj * W + si, goal = tj * W + ti;
    const heap = new MinHeap(); g[start] = 0; heap.push(start, 0);
    const hfun = (i, j) => { const dx = Math.abs(i - ti), dz = Math.abs(j - tj); return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz); };
    const avoid = opts.avoid || null; // fn(i,j) -> extra cost
    let iter = 0;
    while (heap.size) {
      const cur = heap.pop(); if (cur === goal) break; if (closed[cur]) continue; closed[cur] = 1;
      if (++iter > 20000) break;
      const ci = cur % W, cj = (cur / W) | 0;
      for (let k = 0; k < 8; k++) {
        const di = DI[k], dj = DJ[k]; const ni = ci + di, nj = cj + dj;
        if (!this.cellWalkable(ni, nj)) continue;
        if (di && dj && (!this.cellWalkable(ci + di, cj) || !this.cellWalkable(ci, cj + dj))) continue;
        const nIdx = nj * W + ni; if (closed[nIdx]) continue;
        let cost = (di && dj ? Math.SQRT2 : 1);
        // штраф за клетки у стен — пути идут по центру проходов
        if (!this.cellWalkable(ni + 1, nj) || !this.cellWalkable(ni - 1, nj) || !this.cellWalkable(ni, nj + 1) || !this.cellWalkable(ni, nj - 1)) cost += 0.35;
        if (avoid) cost += avoid(ni, nj);
        const ng = g[cur] + cost;
        if (ng < g[nIdx]) { g[nIdx] = ng; came[nIdx] = cur; heap.push(nIdx, ng + hfun(ni, nj)); }
      }
    }
    if (came[goal] === -1 && goal !== start) return null;
    const cells = []; let c = goal; while (c !== -1) { cells.push(c); if (c === start) break; c = came[c]; }
    cells.reverse();
    const pts = cells.map((c) => this.cellCenter(c % W, (c / W) | 0));
    pts[pts.length - 1] = this.isWalkable(x1, z1) ? [x1, z1] : pts[pts.length - 1];
    return this._smooth([[x0, z0], ...pts]).slice(1).map(([x, z]) => ({ x, z }));
  }
  _nearestWalkable(i, j) {
    for (let r = 1; r < 8; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (this.cellWalkable(i + di, j + dj)) return [i + di, j + dj];
    }
    return null;
  }
  _walkLine(x0, z0, x1, z1, r = 0.28) {
    const len = Math.hypot(x1 - x0, z1 - z0); const n = Math.ceil(len / 0.2);
    const px = -(z1 - z0) / (len || 1) * r, pz = (x1 - x0) / (len || 1) * r;
    for (let s = 0; s <= n; s++) {
      const t = s / n; const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      if (!this.isWalkable(x, z) || !this.isWalkable(x + px, z + pz) || !this.isWalkable(x - px, z - pz)) return false;
    }
    return true;
  }
  _smooth(pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]]; let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !this._walkLine(pts[a][0], pts[a][1], pts[b][0], pts[b][1])) b--;
      out.push(pts[b]); a = b;
    }
    return out;
  }
  pathLength(path, x0, z0) { let l = 0, px = x0, pz = z0; for (const p of path || []) { l += Math.hypot(p.x - px, p.z - pz); px = p.x; pz = p.z; } return l; }

  // ——— коллизия круга со стенами (для игрока и акторов) ———
  collide(x, z, r = 0.3) {
    // выталкиваем из непроходимых клеток
    for (let iter = 0; iter < 3; iter++) {
      const [ci, cj] = this.toCell(x, z);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const i = ci + di, j = cj + dj; if (this.cellWalkable(i, j)) continue;
        const x0 = ORIGIN.x + i * CELL, z0 = ORIGIN.z + j * CELL;
        const nx = Math.max(x0, Math.min(x, x0 + CELL)), nz = Math.max(z0, Math.min(z, z0 + CELL));
        const dx = x - nx, dz = z - nz; const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          if (d2 > 1e-8) { const d = Math.sqrt(d2); x += dx / d * (r - d); z += dz / d * (r - d); }
          else { x += (x - (x0 + CELL / 2)) > 0 ? r : -r; }
        }
      }
    }
    return [x, z];
  }

  // ——— укрытия ———
  _computeCover() {
    const out = [];
    for (let j = 1; j < this.H - 1; j++) for (let i = 1; i < this.W - 1; i++) {
      if (!this.cellWalkable(i, j)) continue;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = this.at(i + di, j + dj);
        if (c === 'o' || c === '#' || c === 'O') {
          const [x, z] = this.cellCenter(i, j);
          out.push({ x, z, dir: Math.atan2(di, dj), low: c === 'o', zone: this.zoneAt(x, z), i, j });
          break;
        }
      }
    }
    return out;
  }
  /** Лучшие укрытия от угрозы (tx,tz) около (x,z) в радиусе r */
  findCover(x, z, tx, tz, r = 6, filter = null) {
    let best = null, bestS = -Infinity;
    for (const c of this.coverPoints) {
      const d = Math.hypot(c.x - x, c.z - z); if (d > r) continue;
      if (filter && !filter(c)) continue;
      if (this.actors.some((a) => a.alive && a.reservedCover === c)) continue;
      const prot = this.coverBetween(tx, tz, c.x, c.z);
      if (prot <= 0) continue;
      const canShoot = c.low ? 1 : (this.lineOfFire(c.x, c.z, tx, tz) ? 0.6 : 0.2);
      const s = prot * 2 + canShoot - d * 0.15;
      if (s > bestS) { bestS = s; best = c; }
    }
    return best;
  }

  // ——— двери и баррикады ———
  doorCells(doorId) {
    const d = this.doors.find((x) => x.id === doorId); if (!d) return [];
    const res = [];
    for (let j = 0; j < this.H; j++) for (let i = 0; i < this.W; i++) {
      const [cx, cz] = this.cellCenter(i, j);
      if (cx > d.rect[0] && cx < d.rect[2] && cz > d.rect[1] && cz < d.rect[3]) res.push([i, j]);
    }
    return res;
  }
  /** Поставить баррикаду в дверях (hp — прочность). Возвращает true/false. */
  setBarricade(doorId, hp = 100) {
    const d = this.doors.find((x) => x.id === doorId); if (!d) return false;
    d.barricade = hp; d.barricadeMax = hp;
    for (const [i, j] of this.doorCells(doorId)) this.dynamicBlock.set(i + ',' + j, { kind: 'barricade', solid: true, opaque: false, doorId });
    return true;
  }
  damageBarricade(doorId, dmg) {
    const d = this.doors.find((x) => x.id === doorId); if (!d || d.barricade <= 0) return 0;
    d.barricade = Math.max(0, d.barricade - dmg);
    if (d.barricade <= 0) this.removeBarricade(doorId);
    return d.barricade;
  }
  removeBarricade(doorId) {
    const d = this.doors.find((x) => x.id === doorId); if (d) d.barricade = 0;
    for (const [i, j] of this.doorCells(doorId)) this.dynamicBlock.delete(i + ',' + j);
  }
  /** Дверь, чьи клетки соседствуют с точкой */
  doorNear(x, z, r = 1.2) {
    for (const d of this.doors) { const cx = (d.rect[0] + d.rect[2]) / 2, cz = (d.rect[1] + d.rect[3]) / 2; if (Math.hypot(cx - x, cz - z) < r + Math.max(d.rect[2] - d.rect[0], d.rect[3] - d.rect[1]) / 2) return d; }
    return null;
  }

  // ——— акторы ———
  addActor(a) { this.actors.push(a); a.world = this; return a; }
  removeActor(a) { const k = this.actors.indexOf(a); if (k >= 0) this.actors.splice(k, 1); }
  actorById(id) { return this.actors.find((a) => a.id === id); }
  actorsInZone(zoneId, filter = null) { return this.actors.filter((a) => a.zone === zoneId && (!filter || filter(a))); }
  nearestActor(x, z, filter, maxD = Infinity) {
    let best = null, bd = maxD;
    for (const a of this.actors) { if (!filter(a)) continue; const d = Math.hypot(a.x - x, a.z - z); if (d < bd) { bd = d; best = a; } }
    return best;
  }
  /** Занятость именованной точки */
  pointTaken(pointId, except = null) { return this.actors.some((a) => a !== except && a.alive && a.claimedPoint === pointId); }

  /** Текстовая карта (для отладки) */
  dump() { return this.grid.map((r) => r.join('')).join('\n'); }
}

const DI = [1, -1, 0, 0, 1, 1, -1, -1];
const DJ = [0, 0, 1, -1, 1, -1, 1, -1];

class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(key, pr) {
    const k = this.k, p = this.p; k.push(key); p.push(pr); let i = k.length - 1;
    while (i > 0) { const par = (i - 1) >> 1; if (p[par] <= p[i]) break; [k[par], k[i]] = [k[i], k[par]]; [p[par], p[i]] = [p[i], p[par]]; i = par; }
  }
  pop() {
    const k = this.k, p = this.p; const top = k[0]; const lk = k.pop(), lp = p.pop();
    if (k.length) {
      k[0] = lk; p[0] = lp; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < k.length && p[l] < p[m]) m = l; if (r < k.length && p[r] < p[m]) m = r; if (m === i) break; [k[m], k[i]] = [k[i], k[m]]; [p[m], p[i]] = [p[i], p[m]]; i = m; }
    }
    return top;
  }
}
