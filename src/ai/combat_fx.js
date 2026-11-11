// «Участок» — брошенные предметы (РГД-5, бутылки, «Черёмуха»), огонь, дым, газ (агент D).
// События: 'throw' {kind,x0,z0,x1,z1,t}, 'fire' {id,x,z,r,on}, 'smoke' {zoneId,level}, 'gas' {zoneId,level}, 'explosion' {x,z,kind}.
import { THROWABLES } from './weapons.js';

const FLAMMABLE = new Set(['office', 'opers', 'corridor', 'rest', 'duty']);
const FUEL = [{ x: 28.0, z: 1.0, id: 'barrels', zone: 'generator' }, { x: 25.0, z: -3.5, id: 'fuel_tank', zone: 'yard' }];

export class FX {
  constructor(cb) {
    this.cb = cb; this.proj = []; this.fires = []; this.fid = 1;
    const nz = cb.nav.zoneIds.length;
    this.smoke = new Float32Array(nz); this.gas = new Float32Array(nz); this._sentS = new Float32Array(nz); this._sentG = new Float32Array(nz);
    this.fuelGone = new Set(); this.extinguisher = { holder: null, charges: 8 };
    this._extraDirty = false;
  }
  zi(zoneId) { return this.cb.nav.zoneIndex[zoneId] ?? 0; }
  smokeAt(zoneId) { return this.smoke[this.zi(zoneId)] || 0; }
  gasAt(zoneId) { return this.gas[this.zi(zoneId)] || 0; }
  fireAt(x, z, pad = 0) { for (const f of this.fires) if (Math.hypot(f.x - x, f.z - z) < f.r + pad) return f; return null; }
  firesInZone(zoneId) { return this.fires.filter((f) => f.zone === zoneId); }
  /** Живая граната рядом (для уклонения) */
  grenadeNear(x, z, r = 6) { for (const p of this.proj) if (p.kind === 'rgd5' && Math.hypot(p.tx - x, p.tz - z) < r && p.fuse - p.age < 3.2) return p; return null; }

  /**
   * Бросок. by — актор; kind — 'rgd5'|'molotov'|'cheremukha'; (tx,tz) — цель.
   * Препятствие на пути — предмет отскакивает от стены; окно — бьётся, летит дальше.
   */
  throwItem(by, kind, tx, tz) {
    const cb = this.cb, rng = cb.rng, T = THROWABLES[kind]; if (!T) return null;
    let d = Math.hypot(tx - by.x, tz - by.z);
    if (d > T.range) { const k = T.range / d; tx = by.x + (tx - by.x) * k; tz = by.z + (tz - by.z) * k; d = T.range; }
    const skill = (by.data.cb && by.data.cb.skill) || 0.5;
    const err = 0.35 + d * 0.06 * (1.3 - skill);
    tx += rng.gauss(0, err); tz += rng.gauss(0, err);
    // стена на пути?
    const dl = Math.max(0.01, Math.hypot(tx - by.x, tz - by.z)); const dx = (tx - by.x) / dl, dz = (tz - by.z) / dl;
    const wall = cb.nav.traceShot(by.x, by.z, dx, dz, dl);
    if (wall < dl - 0.2) { const back = Math.max(0.2, wall - 0.5); tx = by.x + dx * back; tz = by.z + dz * back; }
    for (let s = 0; s < cb.nav.specN; s++) if (cb.nav.specType[s] === 2 && cb.nav.specT[s] < Math.hypot(tx - by.x, tz - by.z)) { const [wx, wz] = cb.nav.center(cb.nav.specK[s]); cb.breakWindowAt(wx, wz); }
    const nw = cb.nav.nearestWalkable(tx, tz, 3); if (nw) { tx = nw[0]; tz = nw[1]; }
    const flight = 0.35 + Math.hypot(tx - by.x, tz - by.z) / 13;
    const p = { kind, by, x0: by.x, z0: by.z, tx, tz, flight, age: 0, fuse: kind === 'rgd5' ? T.fuse : flight + (T.fuse || 0), landed: false, warned: false };
    this.proj.push(p);
    by.playAnim('wave', 0.6); by.faceTo(tx, tz);
    cb.emit('throw', { kind, x0: by.x, z0: by.z, x1: tx, z1: tz, t: flight });
    return p;
  }

  update(dt) {
    const cb = this.cb, rng = cb.rng;
    // снаряды
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const p = this.proj[i]; p.age += dt;
      if (!p.landed && p.age >= p.flight) {
        p.landed = true;
        if (p.kind === 'molotov') { this.ignite(p.tx, p.tz, THROWABLES.molotov.fireR, THROWABLES.molotov.fireT, p.by); cb.emit('sfx', { name: 'glass_shards', x: p.tx, z: p.tz }); this.proj.splice(i, 1); continue; }
        cb.emit('sfx', { name: p.kind === 'rgd5' ? 'step_concrete' : 'glass_shards', x: p.tx, z: p.tz, vol: 0.5 });
        if (p.kind === 'rgd5') cb.onGrenadeLanded(p);
      }
      if (p.age >= p.fuse) {
        if (p.kind === 'rgd5') { cb.ballistics.explode(p.tx, p.tz, 'grenade', p.by, 1); this._fuelCheck(p.tx, p.tz, 3); }
        else if (p.kind === 'cheremukha') { const z = cb.nav.zoneAt(p.tx, p.tz); this.addGas(z, THROWABLES.cheremukha.gas); cb.emit('gas', { zoneId: z, level: this.gasAt(z), x: p.tx, z: p.tz }); cb.emit('sfx', { name: 'radio_static', x: p.tx, z: p.tz, vol: 0.6 }); }
        this.proj.splice(i, 1);
      }
    }
    // огонь
    let changed = false;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i]; f.t += dt;
      const zi = this.zi(f.zone); if (this.cb.world.zone(f.zone)?.indoor) this.smoke[zi] = Math.min(1, this.smoke[zi] + dt * 0.022 * f.r);
      f.spreadT -= dt;
      if (f.spreadT <= 0) {
        f.spreadT = rng.range(3.5, 6);
        if (FLAMMABLE.has(f.zone) && f.t > 5 && this.firesInZone(f.zone).length < 4 && rng.chance(0.3)) {
          const a = rng.range(0, Math.PI * 2), r = rng.range(1.2, 2.2); const x = f.x + Math.sin(a) * r, z = f.z + Math.cos(a) * r;
          if (cb.nav.walkable(x, z) && cb.nav.zoneAt(x, z) === f.zone && !this.fireAt(x, z, 0.4)) { this.ignite(x, z, 1.2, rng.range(14, 24), f.by, true); changed = true; }
        }
        // баррикада горит
        for (const d of cb.world.doors) if (d.barricade > 0) { const cx = (d.rect[0] + d.rect[2]) / 2, cz = (d.rect[1] + d.rect[3]) / 2; if (Math.hypot(cx - f.x, cz - f.z) < f.r + 1.2) cb.hurtBarricade(d.id, 22); }
        this._fuelCheck(f.x, f.z, f.r + 0.8);
      }
      if (f.t >= f.max) { this.fires.splice(i, 1); cb.emit('fire', { id: f.id, x: f.x, z: f.z, r: f.r, on: false }); changed = true; }
    }
    if (changed || this._extraDirty) this._rebuildExtra();
    // дым и газ: рассеивание и перетекание через двери
    for (let k = 0; k < this.smoke.length; k++) {
      const zid = cb.nav.zoneIds[k]; const indoor = cb.world.zone(zid)?.indoor;
      const vent = indoor ? 0.012 + cb.brokenWindowsIn(zid) * 0.006 : 0.08;
      this.smoke[k] = Math.max(0, this.smoke[k] - dt * vent);
      this.gas[k] = Math.max(0, this.gas[k] - dt * (indoor ? 0.018 + cb.brokenWindowsIn(zid) * 0.008 : 0.12));
    }
    this._flowT = (this._flowT || 0) - dt;
    if (this._flowT <= 0) {
      this._flowT = 1;
      for (const o of cb.nav.openings) {
        if (o.type !== 'door' || !o.zones[0] || !o.zones[1]) continue;
        const a = this.zi(o.zones[0]), b = this.zi(o.zones[1]);
        const ds = (this.smoke[a] - this.smoke[b]) * 0.06, dg = (this.gas[a] - this.gas[b]) * 0.08;
        this.smoke[a] -= ds; this.smoke[b] += ds; this.gas[a] -= dg; this.gas[b] += dg;
      }
      for (let k = 0; k < this.smoke.length; k++) {
        const zid = cb.nav.zoneIds[k];
        if (Math.abs(this.smoke[k] - this._sentS[k]) >= 0.1) { this._sentS[k] = this.smoke[k]; cb.emit('smoke', { zoneId: zid, level: +this.smoke[k].toFixed(2) }); }
        if (Math.abs(this.gas[k] - this._sentG[k]) >= 0.1) { this._sentG[k] = this.gas[k]; cb.emit('gas', { zoneId: zid, level: +this.gas[k].toFixed(2) }); }
      }
    }
  }
  addGas(zoneId, amount) { const k = this.zi(zoneId); this.gas[k] = Math.min(1, this.gas[k] + amount); }
  ignite(x, z, r, dur, by, spread = false) {
    const zone = this.cb.nav.zoneAt(x, z);
    const f = { id: this.fid++, x, z, r, t: 0, max: dur, zone, by, spreadT: this.cb.rng.range(3, 5) };
    this.fires.push(f); this._extraDirty = true;
    this.cb.emit('fire', { id: f.id, x, z, r, on: true, zoneId: zone });
    if (!spread) this.cb.emit('sfx', { name: 'glass_break', x, z });
    this.cb.onFire(f);
    return f;
  }
  extinguish(f) { const k = this.fires.indexOf(f); if (k < 0) return; this.fires.splice(k, 1); this._extraDirty = true; this.cb.emit('fire', { id: f.id, x: f.x, z: f.z, r: f.r, on: false }); }
  _fuelCheck(x, z, r) {
    for (const fu of FUEL) {
      if (this.fuelGone.has(fu.id) || Math.hypot(fu.x - x, fu.z - z) > r) continue;
      this.fuelGone.add(fu.id);
      this.cb.chron(`Рванули ${fu.id === 'barrels' ? 'бочки с соляркой в генераторной' : 'топливная цистерна во дворе'}!`);
      this.cb.ballistics.explode(fu.x, fu.z, 'fuel', null, 1.3);
      this.ignite(fu.x, fu.z, 2.4, 60, null);
      if (fu.id === 'barrels') this.cb.breakFusebox('взрыв бочек');
    }
  }
  _rebuildExtra() {
    this._extraDirty = false; const nav = this.cb.nav; nav.extra.fill(0);
    for (const f of this.fires) {
      const R = f.r + 0.4;
      for (let dz = -R; dz <= R; dz += 0.5) for (let dx = -R; dx <= R; dx += 0.5) { if (dx * dx + dz * dz > R * R) continue; const k = nav.idx(f.x + dx, f.z + dz); if (k >= 0) nav.extra[k] = 40; }
    }
  }
  clear() { for (const f of this.fires) this.cb.emit('fire', { id: f.id, x: f.x, z: f.z, r: f.r, on: false }); this.fires = []; this.proj = []; this.smoke.fill(0); this.gas.fill(0); this._rebuildExtra(); }
  /** Сохраняемое состояние огня (JSON) */
  snapshot() { return { fires: this.fires.map((f) => ({ x: f.x, z: f.z, r: f.r, left: Math.max(1, f.max - f.t) })), smoke: Array.from(this.smoke, (v) => +v.toFixed(2)), fuelGone: [...this.fuelGone] }; }
  restore(s) { if (!s) return; for (const f of s.fires || []) this.ignite(f.x, f.z, f.r, f.left, null, true); (s.smoke || []).forEach((v, k) => { if (k < this.smoke.length) this.smoke[k] = v; }); for (const id of s.fuelGone || []) this.fuelGone.add(id); }
}
