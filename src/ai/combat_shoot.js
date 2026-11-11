// «Участок» — баллистика: хитскан-лучи в 2.5D (сетка + высота), дробь, рукопашная, взрывы (агент D).
// Пуля летит по горизонтальному лучу с уклоном; мебель (0.86 м) и подоконники (0.85 м) ловят низкие пули,
// баррикада — до 1.12 м; силуэт цели зависит от позы (присевший за столом почти неуязвим).
import { getWeapon, SHAPES, ZONE_MUL, ammoClass, falloff, LOW_COVER_H, BARRICADE_H, THROWABLES } from './weapons.js';
import { S_LOW, S_WIN, S_BARS, S_BARR, S_TALL } from './combat_nav.js';

const SILL_H = 0.85, LINTEL_H = 2.25, CEIL = 3.0;

export class Ballistics {
  constructor(cb) { this.cb = cb; }
  get nav() { return this.cb.nav; }
  get rng() { return this.cb.rng; }

  shapeOf(a) {
    if (a.downed || a.pose === 'lie') return SHAPES.lie;
    if (a.pose === 'sit') return SHAPES.sit;
    if (a.pose === 'crouch') return a.data && a.data.ducked ? SHAPES.ducked : SHAPES.crouch;
    return SHAPES.stand;
  }
  baseY(a) { return a.y || 0; }
  muzzleY(a) { return this.baseY(a) + this.shapeOf(a).muzzle; }
  aimY(a) { return this.baseY(a) + this.shapeOf(a).aim; }

  /**
   * Один снаряд. dirx/dirz — нормированное горизонтальное направление, slope — подъём на метр.
   * Возвращает {t, x,y,z, kind, actor, zone, nx, nz}; near — список близких промахов (для подавления).
   */
  projectile(shooter, sx, sy, sz, dirx, dirz, slope, maxDist, near) {
    const nav = this.nav;
    let tHit = nav.traceShot(sx, sz, dirx, dirz, maxDist), kind = nav.wallK >= 0 ? 'wall' : 'none';
    let nx = 0, nz = 0;
    if (nav.wallK >= 0) { const [cx, cz] = nav.center(nav.wallK); const ddx = sx + dirx * tHit - cx, ddz = sz + dirz * tHit - cz; if (Math.abs(ddx) > Math.abs(ddz)) nx = Math.sign(ddx); else nz = Math.sign(ddz); }
    if (slope < -1e-4) { const tg = sy / -slope; if (tg < tHit) { tHit = tg; kind = 'ground'; nx = 0; nz = 0; } }
    else if (slope > 1e-4 && this.cb.indoorAt(sx, sz)) { const tc = (CEIL - sy) / slope; if (tc < tHit) { tHit = tc; kind = 'ceiling'; } }
    // особые клетки по порядку
    const N = nav.specN; let windowsBroken = null, barricadeHit = null;
    for (let s = 0; s < N; s++) {
      const t = nav.specT[s]; if (t >= tHit) break;
      const y = sy + slope * t, ty = nav.specType[s];
      if (ty === S_TALL) { if (y < 2.3) { tHit = t; kind = 'metal'; nx = -dirx; nz = -dirz; break; } continue; }
      if (ty === S_LOW && y < LOW_COVER_H) { tHit = t; kind = 'wood'; nx = -dirx; nz = -dirz; break; }
      if (ty === S_BARR && y < BARRICADE_H) { tHit = t; kind = 'wood'; nx = -dirx; nz = -dirz; barricadeHit = nav.doorOf[nav.specK[s]]; break; }
      if (ty === S_WIN) {
        if (y < SILL_H || y > LINTEL_H) { tHit = t; kind = 'wall'; nx = -dirx; nz = -dirz; break; }
        (windowsBroken || (windowsBroken = [])).push(nav.specK[s], t);
      }
      if (ty === S_BARS && this.rng.chance(0.12)) { tHit = t; kind = 'metal'; nx = -dirx; nz = -dirz; break; }
    }
    // акторы
    let best = null, bestT = tHit, bestZone = null;
    const list = this.cb.targetsAll;
    for (let k = 0; k < list.length; k++) {
      const a = list[k]; if (a === shooter || !a.alive) continue;
      const rx = a.x - sx, rz = a.z - sz; const tc = rx * dirx + rz * dirz;
      if (tc < 0.25 || tc > bestT + 0.4) continue;
      const perp = Math.abs(rx * dirz - rz * dirx);
      const sh = this.shapeOf(a);
      const y = sy + slope * tc - this.baseY(a);
      if (near && perp < 1.3 && y > -0.3 && y < sh.h + 0.9 && tc < bestT) near.push({ a, perp, tc });
      if (perp > sh.arm || y < 0 || y > sh.h) continue;
      let zone = null;
      if (sh === SHAPES.lie) { zone = perp < 0.3 ? this.rng.weighted([{ z: 'torso', w: 45 }, { z: 'leg', w: 30 }, { z: 'arm', w: 15 }, { z: 'head', w: 10 }]).z : (this.rng.chance(0.5) ? 'leg' : 'arm'); }
      else if (y >= sh.head) { if (perp <= 0.12) zone = 'head'; }
      else if (y >= sh.torso) { zone = perp <= sh.half ? 'torso' : 'arm'; }
      else if (perp <= 0.17) zone = 'leg';
      if (!zone) continue;
      if (tc < bestT) { bestT = tc; best = a; bestZone = zone; }
    }
    if (windowsBroken) for (let q = 0; q < windowsBroken.length; q += 2) { if (windowsBroken[q + 1] < bestT) { const [wx, wz] = nav.center(windowsBroken[q]); this.cb.breakWindowAt(wx, wz); } }
    if (best) {
      return { t: bestT, x: sx + dirx * bestT, y: sy + slope * bestT, z: sz + dirz * bestT, kind: 'flesh', actor: best, zone: bestZone, nx: -dirx, nz: -dirz };
    }
    if (barricadeHit !== null && barricadeHit >= 0) this.cb.hurtBarricadeIdx(barricadeHit, 1.5);
    return { t: tHit, x: sx + dirx * tHit, y: Math.max(0, sy + slope * tHit), z: sz + dirz * tHit, kind, actor: null, zone: null, nx, nz };
  }

  /**
   * Выстрел актора (или игрока) из оружия w в точку (ax, ay, az) с угловым СКО sd.
   * opts: {by, player, noMuzzle} → {hits:[{actor,zone,dmg}], first}
   */
  fire(shooter, w, sx, sy, sz, ax, ay, az, sd, opts = {}) {
    const cb = this.cb, rng = this.rng;
    const dx = ax - sx, dz = az - sz; const dist = Math.max(0.3, Math.hypot(dx, dz));
    const yaw0 = Math.atan2(dx, dz), slope0 = (ay - sy) / dist;
    const pellets = w.pellets || 1; const res = { hits: [], first: null };
    const near = [];
    cb.emit('shot', { x: sx, z: sz, weapon: w.id, by: opts.by || shooter.id });
    if (!opts.noMuzzle) cb.emit('muzzle', { x: sx + Math.sin(yaw0) * 0.55, y: sy, z: sz + Math.cos(yaw0) * 0.55, s: w.kind === 'shotgun' ? 1.3 : w.kind === 'auto' ? 0.9 : 0.7 });
    const maxD = w.maxRange || 60;
    // общая ошибка прицела + собственный разлёт дробин
    const eYaw = rng.gauss(0, sd), eSl = rng.gauss(0, sd * 0.75);
    for (let p = 0; p < pellets; p++) {
      const ps = pellets > 1 ? w.spread * 0.55 : 0;
      const yaw = yaw0 + eYaw + (ps ? rng.gauss(0, ps) : 0), slope = slope0 + eSl + (ps ? rng.gauss(0, ps * 0.8) : 0);
      const dirx = Math.sin(yaw), dirz = Math.cos(yaw);
      const r = this.projectile(shooter, sx, sy, sz, dirx, dirz, slope, maxD, p === 0 ? near : null);
      if (p < 3) cb.emit('tracer', { x0: sx + dirx * 0.5, y0: sy, z0: sz + dirz * 0.5, x1: r.x, y1: r.y, z1: r.z });
      if (r.actor) {
        const dmg = w.damage * falloff(w, r.t) * rng.range(0.85, 1.15);
        const h = cb.applyHit(r.actor, dmg, r.zone, { weapon: w, cls: ammoClass(w), shooter, dist: r.t, x: r.x, y: r.y, z: r.z, kind: 'bullet' });
        res.hits.push({ actor: r.actor, zone: r.zone, dmg: h });
        if (!res.first) res.first = r;
      } else {
        if (r.kind !== 'none' && (p < 3 || rng.chance(0.3))) cb.emit('hit', { x: r.x, y: r.y, z: r.z, kind: r.kind, nx: r.nx, nz: r.nz });
        if (!res.first) res.first = r;
      }
    }
    // подавление: близкие промахи по чужим
    for (const n of near) {
      if (res.hits.some((h) => h.actor === n.a)) continue;
      cb.onNearMiss(n.a, shooter, (w.suppress || 0.2) * (1 - n.perp / 1.3) * (pellets > 1 ? 1.3 : 1));
    }
    cb.onShotNoise(shooter, sx, sz, w);
    return res;
  }

  /** Удар в рукопашной */
  melee(att, target, w) {
    const cb = this.cb, rng = this.rng; const c = att.data.cb || {};
    att.playAnim('punch', 0.45);
    let p = 0.55 + (c.skill || 0.4) * 0.3;
    if (target.downed || target.pose === 'lie') p = 0.95;
    else { const tc = target.data && target.data.cb; if (tc && tc.dodge) p -= tc.dodge; if (tc && tc.supp > 0.5) p += 0.1; }
    if (!rng.chance(p)) { cb.emit('sfx', { name: 'punch', x: target.x, z: target.z, vol: 0.4 }); return 0; }
    const zone = rng.weighted([{ z: 'torso', w: 55 }, { z: 'head', w: w.blunt ? 25 : 12 }, { z: 'arm', w: 15 }, { z: 'leg', w: 8 }]).z;
    cb.emit('sfx', { name: 'punch', x: target.x, z: target.z });
    const dmg = w.damage * rng.range(0.8, 1.2) * (c.strength || 1);
    return cb.applyHit(target, dmg, zone, { weapon: w, cls: w.cut ? 'cut' : 'blunt', shooter: att, dist: 1, x: target.x, y: 1.3, z: target.z, kind: 'melee' });
  }

  /** Взрыв гранаты/бочек: урон по прямой видимости, укрытие и поза снижают */
  explode(x, z, kind, by, power = 1) {
    const cb = this.cb, rng = this.rng, nav = this.nav;
    const g = THROWABLES.rgd5; const lethal = g.lethalR * Math.sqrt(power), wound = g.woundR * Math.sqrt(power);
    cb.emit('explosion', { x, z, kind });
    cb.emit('muzzle', { x, y: 0.6, z, s: 3.5 * power });
    cb.emit('sfx', { name: 'explosion_far', x, z, vol: 1 });
    cb.emit('hit', { x, y: 0.05, z, kind: 'ground', nx: 0, nz: 0 });
    for (const a of cb.targetsAll) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - x, a.z - z); if (d > wound * 1.6) continue;
      const c = a.data && a.data.cb; if (c) { c.stress = Math.min(1, (c.stress || 0) + 0.3 * (1 - d / (wound * 1.6))); c.supp = Math.min(1, (c.supp || 0) + 0.8); c.stunT = Math.max(c.stunT || 0, 2.5 * (1 - d / (wound * 1.6))); }
      if (d > wound || !nav.lof(x, z, a.x, a.z)) continue;
      let mul = 1;
      const cov = cb.world.coverBetween(x, z, a.x, a.z); if (cov >= 0.6) mul *= 0.35;
      if (a.downed || a.pose === 'lie') mul *= 0.45; else if (a.pose === 'crouch') mul *= 0.75;
      if (d < lethal) {
        const dmg = g.damage * power * rng.range(0.7, 1.2) * (1 - d / lethal * 0.45) * mul;
        cb.applyHit(a, dmg, 'torso', { weapon: { id: 'rgd5', name: 'РГД-5', kind: 'frag' }, cls: 'frag', shooter: by, dist: d, x: a.x, y: 1, z: a.z, kind: 'frag' });
      } else {
        const pr = (1 - (d - lethal) / (wound - lethal)) * mul;
        const n = rng.int(1, 3);
        for (let i = 0; i < n; i++) if (rng.chance(pr)) {
          const zone = rng.weighted([{ z: 'torso', w: 45 }, { z: 'leg', w: 30 }, { z: 'arm', w: 18 }, { z: 'head', w: 7 }]).z;
          cb.applyHit(a, rng.range(9, 24), zone, { weapon: { id: 'rgd5', name: 'осколок', kind: 'frag' }, cls: 'frag', shooter: by, dist: d, x: a.x, y: 1, z: a.z, kind: 'frag' });
        }
      }
    }
    // двери-баррикады, окна
    for (const d of cb.world.doors) if (d.barricade > 0) {
      const cx = (d.rect[0] + d.rect[2]) / 2, cz = (d.rect[1] + d.rect[3]) / 2; const dd = Math.hypot(cx - x, cz - z);
      if (dd < 3) cb.hurtBarricade(d.id, g.breach * power * (1 - dd / 3));
    }
    cb.breakWindowsNear(x, z, 3.5);
  }
}
export { ZONE_MUL, getWeapon };
