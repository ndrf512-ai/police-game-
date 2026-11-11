// «Участок» — быстрая боевая навигация и трассировка лучей (агент D).
// Снимок сетки World в типизированные массивы: A* без строковых ключей, DDA-лучи, компоненты связности,
// проёмы (двери/окна) и кэш оценок позиций. world.findPath (~4 мс) слишком дорог для 25 бойцов в реальном времени.
// CONTRACT-NEEDS: world.findPath/cellWalkable используют строковые ключи "i,j" — стоит перевести на массивы.
import { CELL, ORIGIN, GRID_W, GRID_H, DOORS, WINDOWS, CELLS, POINTS } from '../world/level.js';

export const F_WALK = 1, F_SEE = 2, F_SHOOT = 4, F_LOW = 8, F_WIN = 16, F_BARS = 32, F_CELLDOOR = 64, F_DOOR = 128;
const D_BLOCK = 1, D_OPEN = 2;
// типы особых клеток на луче выстрела
export const S_LOW = 1, S_WIN = 2, S_BARS = 3, S_BARR = 4, S_TALL = 5;

const WALK_CH = '.,:_=-D';
const SEE_CH = '.,:_=-DWBbo';
const DI8 = [1, -1, 0, 0, 1, 1, -1, -1], DJ8 = [0, 0, 1, -1, 1, -1, 1, -1];

export class Nav {
  constructor(world) {
    this.world = world;
    const W = GRID_W, H = GRID_H, N = W * H;
    this.W = W; this.H = H; this.N = N;
    this.flags = new Uint8Array(N); this.tall = new Uint8Array(N); this.dyn = new Uint8Array(N); this.wallPen = new Float32Array(N);
    this.extra = new Float32Array(N);           // доп. стоимость (огонь и т.п.), ведёт FX
    this.zoneOf = new Uint8Array(N); this.doorOf = new Int8Array(N).fill(-1); this.cellDoorOf = new Int8Array(N).fill(-1);
    this.comp = new Int32Array(N); this.compT = new Int32Array(N);
    this.zoneIds = world.zoneList.map((z) => z.id); this.zoneIndex = {}; this.zoneIds.forEach((z, k) => { this.zoneIndex[z] = k; });
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, ch = world.grid[j][i];
      let f = 0;
      if (WALK_CH.includes(ch)) f |= F_WALK;
      if (SEE_CH.includes(ch)) f |= F_SEE | F_SHOOT;
      if (ch === 'o') f |= F_LOW; if (ch === 'W') f |= F_WIN; if (ch === 'B' || ch === 'b') f |= F_BARS; if (ch === 'b') f |= F_CELLDOOR; if (ch === 'D') f |= F_DOOR;
      this.flags[k] = f; if (ch === 'O') this.tall[k] = 1;
      const [x, z] = this.center(k); this.zoneOf[k] = this.zoneIndex[world.zoneAt(x, z)] ?? 0;
    }
    DOORS.forEach((d, di) => { for (const k of this._rectCells(d.rect)) this.doorOf[k] = di; });
    CELLS.forEach((c, ci) => { for (const k of this._rectCells(c.door)) if (this.flags[k] & F_CELLDOOR) this.cellDoorOf[k] = ci; });
    for (let k = 0; k < N; k++) {
      if (!(this.flags[k] & F_WALK)) continue;
      const i = k % W, j = (k / W) | 0;
      if (!this._sw(i + 1, j) || !this._sw(i - 1, j) || !this._sw(i, j + 1) || !this._sw(i, j - 1)) this.wallPen[k] = 0.35;
    }
    // буферы A*
    this.g = new Float32Array(N); this.came = new Int32Array(N); this.stamp = new Uint32Array(N); this.closed = new Uint32Array(N); this.search = 0;
    this.heapK = new Int32Array(N * 8); this.heapP = new Float32Array(N * 8); this.heapN = 0;
    // буферы трассировки выстрела
    this.specK = new Int32Array(512); this.specT = new Float32Array(512); this.specType = new Uint8Array(512); this.specN = 0;
    this.sig = ''; this.version = 0; this.pathsThisFrame = 0; this.pathCalls = 0;
    this.sync(true);
    this._buildOpenings();
    this._spots = null; this._evalCache = new Map(); this._expCache = new Map();
  }

  // ——— координаты ———
  idx(x, z) { const i = Math.floor((x - ORIGIN.x) / CELL), j = Math.floor((z - ORIGIN.z) / CELL); return i < 0 || j < 0 || i >= this.W || j >= this.H ? -1 : j * this.W + i; }
  center(k) { return [ORIGIN.x + ((k % this.W) + 0.5) * CELL, ORIGIN.z + (((k / this.W) | 0) + 0.5) * CELL]; }
  _rectCells(r) { const out = []; for (let k = 0; k < this.N; k++) { const [cx, cz] = this.center(k); if (cx > r[0] && cx < r[2] && cz > r[1] && cz < r[3]) out.push(k); } return out; }
  _sw(i, j) { if (i < 0 || j < 0 || i >= this.W || j >= this.H) return false; return !!(this.flags[j * this.W + i] & F_WALK); }
  walkK(k) {
    if (k < 0) return false; const f = this.flags[k], d = this.dyn[k];
    if (f & F_CELLDOOR) return !!(d & D_OPEN);
    return !!(f & F_WALK) && !(d & D_BLOCK);
  }
  walkable(x, z) { return this.walkK(this.idx(x, z)); }
  zoneAtK(k) { return this.zoneIds[this.zoneOf[k]]; }
  zoneAt(x, z) { const k = this.idx(x, z); return k < 0 ? 'street' : this.zoneIds[this.zoneOf[k]]; }
  isLow(x, z) { const k = this.idx(x, z); return k >= 0 && !!(this.flags[k] & F_LOW); }
  barricadeAtK(k) { return k >= 0 && !!(this.dyn[k] & D_BLOCK); }

  // ——— синхронизация с динамикой мира (баррикады, двери камер) ———
  sync(force = false) {
    const w = this.world;
    let s = w.dynamicBlock.size + '|';
    for (const c of w.openCellDoors) s += c + ',';
    s += '|'; for (const d of w.doors) s += d.barricade > 0 ? '1' : '0';
    if (!force && s === this.sig) return false;
    this.sig = s; this.version++;
    this.dyn.fill(0);
    for (const [key, b] of w.dynamicBlock) {
      if (!b || !b.solid) continue; const p = key.indexOf(','); const i = +key.slice(0, p), j = +key.slice(p + 1);
      if (i >= 0 && j >= 0 && i < this.W && j < this.H) this.dyn[j * this.W + i] |= D_BLOCK;
    }
    for (let k = 0; k < this.N; k++) { const ci = this.cellDoorOf[k]; if (ci >= 0 && w.openCellDoors.has(CELLS[ci].id)) this.dyn[k] |= D_OPEN; }
    this._labelComps(this.comp, false); this._labelComps(this.compT, true);
    return true;
  }
  _labelComps(comp, through) {
    comp.fill(-1); let label = 0; const W = this.W, q = this.heapK;
    for (let s = 0; s < this.N; s++) {
      if (comp[s] !== -1 || !this._walkMode(s, through)) continue;
      let h = 0, t = 0; q[t++] = s; comp[s] = label;
      while (h < t) {
        const k = q[h++]; const i = k % W, j = (k / W) | 0;
        if (i > 0) { const n = k - 1; if (comp[n] === -1 && this._walkMode(n, through)) { comp[n] = label; q[t++] = n; } }
        if (i < W - 1) { const n = k + 1; if (comp[n] === -1 && this._walkMode(n, through)) { comp[n] = label; q[t++] = n; } }
        if (j > 0) { const n = k - W; if (comp[n] === -1 && this._walkMode(n, through)) { comp[n] = label; q[t++] = n; } }
        if (j < this.H - 1) { const n = k + W; if (comp[n] === -1 && this._walkMode(n, through)) { comp[n] = label; q[t++] = n; } }
      }
      label++;
    }
  }
  _walkMode(k, through) { if (through && (this.dyn[k] & D_BLOCK) && (this.flags[k] & F_WALK)) return true; return this.walkK(k); }
  connected(x0, z0, x1, z1, through = false) {
    let a = this.idx(x0, z0), b = this.idx(x1, z1);
    if (!this.walkK(a)) a = this.nearestWalkK(a); if (!this._walkMode(b, through)) b = this.nearestWalkK(b, 6, through);
    if (a < 0 || b < 0) return false; const c = through ? this.compT : this.comp; return c[a] === c[b];
  }
  nearestWalkK(k, R = 6, through = false) {
    if (k < 0) return -1; if (this._walkMode(k, through)) return k;
    const W = this.W, i0 = k % W, j0 = (k / W) | 0;
    for (let r = 1; r <= R; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= W || j >= this.H) continue;
      const n = j * W + i; if (this._walkMode(n, through)) return n;
    }
    return -1;
  }
  nearestWalkable(x, z, R = 6) { const k = this.nearestWalkK(this.idx(x, z), R); return k < 0 ? null : this.center(k); }

  // ——— видимость ———
  /** Прямая видимость/простреливаемость (окна, решётки, мебель прозрачны). Клетки начала и конца не проверяются. */
  los(x0, z0, x1, z1, mask = F_SEE, tallOk = false) {
    const gx = (x0 - ORIGIN.x) / CELL, gz = (z0 - ORIGIN.z) / CELL, ex = (x1 - ORIGIN.x) / CELL, ez = (z1 - ORIGIN.z) / CELL;
    let i = Math.floor(gx), j = Math.floor(gz); const ti = Math.floor(ex), tj = Math.floor(ez);
    const dx = ex - gx, dz = ez - gz, W = this.W, fl = this.flags;
    const si = dx > 0 ? 1 : -1, sj = dz > 0 ? 1 : -1;
    const tdi = dx !== 0 ? Math.abs(1 / dx) : Infinity, tdj = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tmi = dx !== 0 ? (si > 0 ? (i + 1 - gx) : (gx - i)) * tdi : Infinity;
    let tmj = dz !== 0 ? (sj > 0 ? (j + 1 - gz) : (gz - j)) * tdj : Infinity;
    let guard = 400;
    while (guard-- > 0) {
      if (i === ti && j === tj) return true;
      if (Math.abs(tmi - tmj) < 1e-9) { // ровно через угол — проверить обе соседние
        const a = j * W + i + si, b = (j + sj) * W + i;
        if (!((i + si) === ti && j === tj) && (i + si < 0 || i + si >= W || !((fl[a] & mask) || (tallOk && this.tall[a])))) return false;
        if (!(i === ti && (j + sj) === tj) && (j + sj < 0 || j + sj >= this.H || !((fl[b] & mask) || (tallOk && this.tall[b])))) return false;
        i += si; j += sj; tmi += tdi; tmj += tdj;
      } else if (tmi < tmj) { i += si; tmi += tdi; } else { j += sj; tmj += tdj; }
      if (i < 0 || j < 0 || i >= W || j >= this.H) return false;
      if (i === ti && j === tj) return true;
      const kk = j * W + i; if (!(fl[kk] & mask) && !(tallOk && this.tall[kk])) return false;
    }
    return true;
  }
  lof(x0, z0, x1, z1, tallOk = false) { return this.los(x0, z0, x1, z1, F_SHOOT, tallOk); }

  /**
   * Трасса выстрела по горизонтали из (x0,z0) в направлении (dx,dz) (нормировано) до maxDist.
   * Возвращает дистанцию до стены (или maxDist); особые клетки — в specK/specT/specType/specN.
   */
  traceShot(x0, z0, dx, dz, maxDist) {
    this.specN = 0;
    const gx = (x0 - ORIGIN.x) / CELL, gz = (z0 - ORIGIN.z) / CELL;
    let i = Math.floor(gx), j = Math.floor(gz);
    const si = dx > 0 ? 1 : -1, sj = dz > 0 ? 1 : -1;
    const tdi = dx !== 0 ? Math.abs(CELL / dx) : Infinity, tdj = dz !== 0 ? Math.abs(CELL / dz) : Infinity; // в метрах
    let tmi = dx !== 0 ? (si > 0 ? (i + 1 - gx) : (gx - i)) * tdi : Infinity;
    let tmj = dz !== 0 ? (sj > 0 ? (j + 1 - gz) : (gz - j)) * tdj : Infinity;
    const W = this.W, fl = this.flags, dy = this.dyn;
    let t = 0, first = true;
    this.wallK = -1;
    for (let guard = 0; guard < 600; guard++) {
      if (i < 0 || j < 0 || i >= W || j >= this.H) { this.wallK = -1; return Math.min(t, maxDist); }
      const k = j * W + i;
      if (!first) {
        const f = fl[k];
        if (!(f & F_SHOOT) && !this.tall[k]) { this.wallK = k; return Math.min(t, maxDist); }
        if (this.specN < 512) {
          let ty = 0;
          if (this.tall[k]) ty = S_TALL; else
          if (f & F_LOW) ty = S_LOW; else if (f & F_WIN) ty = S_WIN; else if (f & F_BARS) ty = S_BARS; else if (dy[k] & D_BLOCK) ty = S_BARR;
          if (ty) { this.specK[this.specN] = k; this.specT[this.specN] = t; this.specType[this.specN] = ty; this.specN++; }
        }
      }
      first = false;
      if (t >= maxDist) return maxDist;
      if (tmi < tmj) { t = tmi; tmi += tdi; i += si; } else { t = tmj; tmj += tdj; j += sj; }
    }
    return maxDist;
  }

  // ——— A* ———
  /**
   * Путь [{x,z}] без стартовой точки или null.
   * opts: {through — сквозь баррикады (дорого), zoneCost: Float32Array по зонам, maxIter, noSmooth}
   * Если through и путь проходит через баррикаду — у результата поле .barricade = doorId.
   */
  path(x0, z0, x1, z1, opts = {}) {
    this.pathCalls++; this.pathsThisFrame++;
    const through = !!opts.through;
    let s = this.idx(x0, z0), g = this.idx(x1, z1);
    if (!this.walkK(s)) s = this.nearestWalkK(s, 4, through);
    if (!this._walkMode(g, through)) g = this.nearestWalkK(g, 6, through);
    if (s < 0 || g < 0) return null;
    const comp = through ? this.compT : this.comp;
    if (comp[s] !== comp[g]) return null;
    const goalWalk = this.walkK(this.idx(x1, z1));
    if (s === g) return [{ x: goalWalk ? x1 : this.center(g)[0], z: goalWalk ? z1 : this.center(g)[1] }];
    const W = this.W, gi = g % W, gj = (g / W) | 0;
    const id = ++this.search; const G = this.g, came = this.came, st = this.stamp, cl = this.closed;
    const zc = opts.zoneCost || null, ex = this.extra, wp = this.wallPen, zo = this.zoneOf, dyn = this.dyn;
    this.heapN = 0; st[s] = id; G[s] = 0; came[s] = -1; this._push(s, 0);
    const maxIter = opts.maxIter || 9000; let it = 0, found = false;
    while (this.heapN) {
      const cur = this._pop();
      if (cl[cur] === id) continue; cl[cur] = id;
      if (cur === g) { found = true; break; }
      if (++it > maxIter) break;
      const ci = cur % W, cj = (cur / W) | 0, gc = G[cur];
      for (let d = 0; d < 8; d++) {
        const ni = ci + DI8[d], nj = cj + DJ8[d]; if (ni < 0 || nj < 0 || ni >= W || nj >= this.H) continue;
        const n = nj * W + ni; if (cl[n] === id || !this._walkMode(n, through)) continue;
        const diag = d >= 4;
        if (diag && (!this._walkMode(cj * W + ni, through) || !this._walkMode(nj * W + ci, through))) continue;
        let c = (diag ? 1.41421 : 1) + wp[n] + ex[n];
        if (zc) c += zc[zo[n]];
        if (through && (dyn[n] & D_BLOCK)) c += 30;
        const ng = gc + c;
        if (st[n] !== id || ng < G[n]) {
          st[n] = id; G[n] = ng; came[n] = cur;
          const ddx = Math.abs(ni - gi), ddz = Math.abs(nj - gj);
          this._push(n, ng + (ddx + ddz) - 0.5858 * Math.min(ddx, ddz));
        }
      }
    }
    if (!found) return null;
    const cells = []; for (let c = g; c !== -1; c = came[c]) { cells.push(c); if (c === s) break; if (cells.length > 4000) break; }
    cells.reverse();
    let barricade = null;
    if (through) for (const c of cells) if (dyn[c] & D_BLOCK) { const di = this.doorOf[c]; barricade = di >= 0 ? DOORS[di].id : 'unknown'; break; }
    const pts = cells.map((c) => this.center(c));
    pts[pts.length - 1] = goalWalk ? [x1, z1] : pts[pts.length - 1];
    let out;
    if (opts.noSmooth) out = pts.slice(1);
    else out = this._smooth([[x0, z0], ...pts], through).slice(1);
    const res = out.map(([x, z]) => ({ x, z }));
    if (barricade) res.barricade = barricade;
    return res;
  }
  _push(k, p) {
    const K = this.heapK, P = this.heapP; let i = this.heapN++;
    if (i >= K.length) { this.heapN--; return; }
    K[i] = k; P[i] = p;
    while (i > 0) { const par = (i - 1) >> 1; if (P[par] <= p) break; K[i] = K[par]; P[i] = P[par]; i = par; }
    K[i] = k; P[i] = p;
  }
  _pop() {
    const K = this.heapK, P = this.heapP; const top = K[0]; const n = --this.heapN;
    if (n > 0) {
      const k = K[n], p = P[n]; let i = 0;
      for (;;) { const l = 2 * i + 1; if (l >= n) break; let m = l; if (l + 1 < n && P[l + 1] < P[l]) m = l + 1; if (P[m] >= p) break; K[i] = K[m]; P[i] = P[m]; i = m; }
      K[i] = k; P[i] = p;
    }
    return top;
  }
  _walkLine(x0, z0, x1, z1, through, r = 0.27) {
    const len = Math.hypot(x1 - x0, z1 - z0); if (len < 1e-6) return true;
    const n = Math.ceil(len / 0.2); const px = -(z1 - z0) / len * r, pz = (x1 - x0) / len * r;
    for (let s = 0; s <= n; s++) {
      const t = s / n; const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      if (!this._walkMode(this.idx(x, z), through) || !this._walkMode(this.idx(x + px, z + pz), through) || !this._walkMode(this.idx(x - px, z - pz), through)) return false;
      if (this.extra[this.idx(x, z)] > 5) return false; // не срезать через огонь
    }
    return true;
  }
  _smooth(pts, through) {
    if (pts.length < 3) return pts;
    const out = [pts[0]]; let a = 0;
    while (a < pts.length - 1) {
      let b = a + 1;
      // жадно вперёд, с шагом, затем уточнение
      while (b + 1 < pts.length && b - a < 40 && this._walkLine(pts[a][0], pts[a][1], pts[b + 1][0], pts[b + 1][1], through)) b++;
      out.push(pts[b]); a = b;
    }
    return out;
  }
  pathLength(path, x0, z0) { let l = 0, px = x0, pz = z0; for (const p of path || []) { l += Math.hypot(p.x - px, p.z - pz); px = p.x; pz = p.z; } return l; }

  // ——— проёмы: двери и окна ———
  _buildOpenings() {
    const w = this.world; const ops = [];
    const mk = (type, ref, rect, name, zoneA, zoneB, kind) => {
      const x = (rect[0] + rect[2]) / 2, z = (rect[1] + rect[3]) / 2;
      const horiz = (rect[2] - rect[0]) >= (rect[3] - rect[1]); // стена вдоль X → нормаль по Z
      const nx = horiz ? 0 : 1, nz = horiz ? 1 : 0;
      const half = horiz ? (rect[2] - rect[0]) / 2 : (rect[3] - rect[1]) / 2;
      const side = (s) => { const px = x + nx * s, pz = z + nz * s; return this.walkable(px, pz) || (this.flags[this.idx(px, pz)] & F_LOW) ? w.zoneAt(px, pz) : null; };
      let zp = side(0.9), zm = side(-0.9);
      if (zoneA && zoneB) { if (zp !== zoneA && zm === zoneA) { /* ok */ } else if (zp === zoneA) { /* swap */ } }
      const o = { id: ops.length, type, ref, name, x, z, nx, nz, half, kind, zones: [zp, zm], exterior: false };
      o.exterior = !!(zp && zm && (this._indoor(zp) !== this._indoor(zm))) || (!!zp !== !!zm);
      ops.push(o);
    };
    DOORS.forEach((d) => mk('door', d.id, d.rect, d.name, d.a, d.b, d.kind));
    WINDOWS.forEach((r, i) => mk('window', i, r, 'окно', null, null, 'window'));
    this.openings = ops;
    this.doorOpening = {}; for (const o of ops) if (o.type === 'door') this.doorOpening[o.ref] = o;
    this.zoneOpenings = {}; for (const zid of this.zoneIds) this.zoneOpenings[zid] = ops.filter((o) => o.zones.includes(zid));
  }
  _indoor(zid) { const z = this.world.zone(zid); return !!(z && z.indoor); }
  /** Точка у проёма со стороны зоны zoneId на расстоянии d (м). */
  openingSide(o, zoneId, d = 1.2) {
    const s = o.zones[0] === zoneId ? 1 : o.zones[1] === zoneId ? -1 : 1;
    return { x: o.x + o.nx * d * s, z: o.z + o.nz * d * s };
  }
  otherZone(o, zoneId) { return o.zones[0] === zoneId ? o.zones[1] : o.zones[0]; }
  /** Граф зон через двери (без окон и решёток) */
  zoneDoors(zoneId) { return (this.zoneOpenings[zoneId] || []).filter((o) => o.type === 'door' && o.zones[0] && o.zones[1]); }
  /** BFS по зонам: маршрут [zoneId,...] от a до b (включительно); blocked(zoneId) — запретные */
  zoneRoute(a, b, blocked = null) {
    if (a === b) return [a];
    const prev = { [a]: null }; const q = [a];
    while (q.length) {
      const z = q.shift();
      for (const o of this.zoneDoors(z)) {
        const n = this.otherZone(o, z); if (!n || n in prev) continue; if (blocked && n !== b && blocked(n)) continue;
        prev[n] = z; if (n === b) { const r = [b]; let c = z; while (c) { r.push(c); c = prev[c]; } return r.reverse(); } q.push(n);
      }
    }
    return null;
  }
  doorBetween(za, zb) { return (this.zoneOpenings[za] || []).find((o) => o.type === 'door' && o.zones.includes(zb)) || null; }

  // ——— позиции ———
  /** Позиции зоны: укрытия мира + посты */
  spots(zoneId) {
    if (!this._spots) {
      this._spots = {}; this._spotList = [];
      for (const zid of this.zoneIds) this._spots[zid] = [];
      for (const c of this.world.coverPoints) { const s = { id: this._spotList.length, x: c.x, z: c.z, low: c.low, zone: c.zone, post: null, cover: c }; this._spotList.push(s); (this._spots[c.zone] || (this._spots[c.zone] = [])).push(s); }
      for (const [pid, p] of Object.entries(POINTS)) {
        if (p.kind !== 'post' || !this.walkable(p.x, p.z)) continue;
        const s = { id: this._spotList.length, x: p.x, z: p.z, low: this._lowNear(p.x, p.z), zone: p.zone, post: pid, cover: null };
        this._spotList.push(s); (this._spots[p.zone] || (this._spots[p.zone] = [])).push(s);
      }
    }
    return this._spots[zoneId] || [];
  }
  _lowNear(x, z) { for (const [dx, dz] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) if (this.isLow(x + dx, z + dz)) return true; return false; }
  /**
   * Оценка позиции s против проёма o, если угроза идёт со стороны зоны fromZone:
   * {lofIn — простреливает проём, lofOut — видит подход снаружи, prot — укрытие 0..1, dist}
   */
  evalSpot(s, o, fromZone) {
    const key = s.id * 4096 + o.id * 16 + (o.zones[0] === fromZone ? 0 : 1);
    let e = this._evalCache.get(key); if (e) return e;
    const out = this.openingSide(o, fromZone, 2.6);
    const inn = { x: o.x, z: o.z };
    const lofIn = this.lof(s.x, s.z, inn.x, inn.z), lofOut = this.lof(s.x, s.z, out.x, out.z);
    const w = this.world;
    const prot = Math.max(w.coverBetween(inn.x, inn.z, s.x, s.z), 0) * 0.5 + Math.max(w.coverBetween(out.x, out.z, s.x, s.z), 0) * 0.5;
    e = { lofIn, lofOut, prot, dist: Math.hypot(s.x - o.x, s.z - o.z) };
    this._evalCache.set(key, e); return e;
  }
  /** Сколько внешних проёмов (кроме ignore) простреливают позицию снаружи */
  exposure(s, ignoreOpening = -1) {
    const key = s.id * 64 + (ignoreOpening + 1);
    let v = this._expCache.get(key); if (v !== undefined) return v;
    v = 0;
    for (const o of this.zoneOpenings[s.zone] || []) {
      if (!o.exterior || o.id === ignoreOpening) continue;
      const outside = o.zones.find((z) => z && !this._indoor(z)); if (!outside) continue;
      const p = this.openingSide(o, outside, 4);
      if (this.lof(s.x, s.z, p.x, p.z) && this.world.coverBetween(p.x, p.z, s.x, s.z) < 0.5) v++;
    }
    this._expCache.set(key, v); return v;
  }
}
