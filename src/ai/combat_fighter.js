// «Участок» — базовый мозг бойца (агент D): восприятие, огонь, перезарядка, укрытие, ранения, движение.
// Поля для рендера: actor.data.aiming, .ducked (низко за укрытием), .action ('reload'|'bandage'|'breach'|'unlock'|'surrender'|'crawl'|'cower'|'throw'|'extinguish'|'loot'|'barricade'|null),
// .weaponId (точный id оружия), .muzzleT, .role, .downed; actor.target, actor.aimPitch, actor.downed, actor.y (крыша киоска).
import { getWeapon, isFirearm, lookWeapon, WEAPONS } from './weapons.js';

export class Fighter {
  constructor(cb, actor, prof) {
    this.cb = cb; this.a = actor;
    const w = getWeapon(prof.weaponId);
    const c = Object.assign({
      side: 'police', weaponId: w.id, weapon: w, mag: 0, reserve: 0, melee: WEAPONS.fists,
      skill: 0.5, courage: 0.5, aggression: 0.5, discipline: 0.5, composure: 0.5, perception: 0.5, tactics: 0.5, strength: 1,
      armor: 'none', helmet: false, mask: false, talkative: 1, dodge: 0.1,
      stress: 0, supp: 0, stunT: 0, bleed: 0, accMul: 1, aware: false, reaction: 0.8, aimMul: 1,
      visible: [], spot: new Map(), target: null, aimT: 0, aimTarget: null, nextShotT: 0, burstLeft: 0, burstN: 0,
      reloadT: 0, jamT: 0, actT: 0, act: null, duckT: 0, coverLow: false, lookAt: null,
      dest: null, wantPath: null, prog: { x: actor.x, z: actor.z, t: 0 }, stuck: 0,
      nextThink: 0, nextPerceive: 0, lastPerceive: 0, nextBark: 0, lastShotT: -99, underFireT: -99, aggressed: false,
      downed: false, crawl: null, panic: false, kills: 0, shots: 0, hitsTaken: 0,
    }, prof);
    c.weapon = w; c.weaponId = w.id;
    actor.data.cb = c; actor.data.weaponId = w.id; actor.look.weapon = lookWeapon(w.id);
    actor.data.speedMul = actor.data.speedMul || 1;
  }

  update(a, dt) {
    const c = a.data.cb, cb = this.cb; if (!c) return;
    a.stuckT = 0;
    if (!cb.running) return;
    const now = cb.t;
    this.status(dt);
    if (!a.alive) return;
    if (c.downed) { this.downedTick(dt); return; }
    if (c.surrendered || c.captive) { this.passiveTick(dt); return; }
    if (now >= c.nextPerceive) { this.perceive(Math.min(0.6, now - c.lastPerceive)); c.lastPerceive = now; c.nextPerceive = now + 0.2 + cb.rng.next() * 0.1; }
    if (now >= c.nextThink) { c.nextThink = now + 0.28 + cb.rng.next() * 0.17; this.think(); }
    this.moveTick(dt);
    this.weaponTick(dt);
    this.poseTick(dt);
  }
  onDamage() {}
  think() {}
  passiveTick() { const a = this.a; a.data.aiming = false; a.target = null; if (a.moving) a.stop(); }

  // ——— состояние ———
  status(dt) {
    const a = this.a, c = a.data.cb, cb = this.cb;
    c.supp = Math.max(0, c.supp - dt * 0.4); if (c.stunT > 0) c.stunT -= dt;
    if (c.bleed > 0 && a.alive) {
      a.hp -= c.bleed * dt; cb.syncHp(a);
      if (a.hp <= 0) { a.hp = 0.5; a.damage(1, a.lastAttacker || null, { cause: 'bleed' }); return; }
    }
    const f = cb.fx.fireAt(a.x, a.z, 0.05);
    c.inFire = f;
    if (f) cb.applyHit(a, 9 * dt, 'torso', { cls: 'fire', kind: 'fire', quiet: true, shooter: f.by || null, weapon: { id: 'fire', name: 'огонь' } });
    if (!a.alive) return;
    const z = a.zone || cb.nav.zoneAt(a.x, a.z);
    c.gas = c.mask ? 0 : cb.fx.gasAt(z); c.smoke = cb.fx.smokeAt(z);
    if (c.gas > 0.25) { c.stress = Math.min(1, c.stress + dt * 0.04 * c.gas); if (cb.rng.chance(dt * 0.2)) cb.barks.say(a, c.side === 'police' ? 'gassed' : 'b_gassed'); }
    if (!c.visible.length && c.supp < 0.05 && cb.t - c.underFireT > 4) c.stress = Math.max(c.stressFloor || 0, c.stress - dt * 0.02 * (0.5 + c.composure));
  }

  // ——— восприятие ———
  perceive(el) {
    const a = this.a, c = a.data.cb, cb = this.cb, nav = cb.nav;
    const vis = c.visible; vis.length = 0;
    const enemies = cb.enemiesOf(c.side);
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
    const fovCos = c.aware ? -0.4 : 0.25;
    const seen = this._seenSet || (this._seenSet = new Set()); seen.clear();
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - a.x, dz = e.z - a.z; const d = Math.hypot(dx, dz);
      if (d > 48) continue;
      const range = cb.visRange(a, e, c);
      if (d > range) continue;
      if (d > 2.5 && (dx * fx + dz * fz) / d < fovCos) continue;
      if (!nav.los(a.x, a.z, e.x, e.z)) continue;
      let s = c.spot.get(e.id) || 0;
      const need = Math.max(0.08, c.reaction * (c.aware ? 1 : 2.2) * (0.45 + (d / range) * 0.9));
      s = Math.min(2, s + el / need); c.spot.set(e.id, s); seen.add(e.id);
      if (s < 1) continue;
      vis.push(e);
      cb.see(c.side, e, a);
      if (!c.aware) { c.aware = true; this.onAlert(e); }
    }
    for (const [id, s] of c.spot) if (!seen.has(id)) { const v = s - el * 0.7; if (v <= 0) c.spot.delete(id); else c.spot.set(id, v); }
  }
  onAlert() {}
  /** Видимые враги, по которым можно стрелять */
  engageable() { return this.a.data.cb.visible.filter((e) => e.alive && !(e.data && e.data.cb && (e.data.cb.surrendered || e.data.cb.captive))); }

  // ——— движение ———
  goTo(x, z, run = false, stop = 0.12) {
    const a = this.a, c = a.data.cb, cb = this.cb;
    if (!isFinite(x) || !isFinite(z)) return false;
    if (c.dest && Math.hypot(c.dest.x - x, c.dest.z - z) < 0.3 && (a.moving || Math.hypot(a.x - x, a.z - z) < 0.4)) { a.running = run; return true; }
    if (cb.nav.pathsThisFrame >= cb.pathBudget) { c.wantPath = { x, z, run, stop }; return false; }
    const p = cb.nav.path(a.x, a.z, x, z, { zoneCost: cb.zoneCost[c.side] });
    if (!p || !p.length) { c.dest = null; c.wantPath = null; c.noPathT = cb.t; return false; }
    a.path = p; a.running = !!run; a.onArrive = null; a.moveTarget = { x, z }; a.stopDist = stop; a.stuckT = 0;
    if (a.pose === 'sit' || a.pose === 'lie') a.pose = 'stand';
    c.dest = { x, z }; c.wantPath = null; c.prog = { x: a.x, z: a.z, t: cb.t };
    return true;
  }
  halt() { const a = this.a, c = a.data.cb; a.stop(); c.dest = null; c.wantPath = null; }
  arrived(r = 0.6) { const a = this.a, c = a.data.cb; return !!c.dest && !a.moving && Math.hypot(a.x - c.dest.x, a.z - c.dest.z) < r; }
  near(x, z, r = 0.6) { return Math.hypot(this.a.x - x, this.a.z - z) < r; }
  moveTick() {
    const a = this.a, c = a.data.cb, cb = this.cb;
    if (c.wantPath && cb.nav.pathsThisFrame < cb.pathBudget) { const w = c.wantPath; this.goTo(w.x, w.z, w.run, w.stop); }
    if (a.moving) {
      if (cb.t - c.prog.t > 1.7) {
        if (Math.hypot(a.x - c.prog.x, a.z - c.prog.z) < 0.3) {
          c.stuck++; const d = c.dest; a.stop(); c.dest = null;
          if (d && c.stuck < 4) { const ang = cb.rng.range(0, 6.28); this.goTo(d.x + Math.sin(ang) * 0.4, d.z + Math.cos(ang) * 0.4, a.running); }
        } else c.stuck = 0;
        c.prog = { x: a.x, z: a.z, t: cb.t };
      }
    } else if (c.dest && !this.arrived(0.9) && cb.t - c.prog.t > 0.5) { const d = c.dest; c.dest = null; this.goTo(d.x, d.z, a.running); }
  }

  // ——— оружие ———
  weaponTick(dt) {
    const a = this.a, c = a.data.cb, cb = this.cb, now = cb.t;
    const w = c.weapon;
    a.data.aiming = false;
    if (c.reloadT > 0) { c.reloadT -= dt; a.data.action = 'reload'; if (c.reloadT <= 0) { this.finishReload(); a.data.action = null; } return; }
    if (c.jamT > 0) { c.jamT -= dt; return; }
    if (c.actT > 0) return;
    if (c.stunT > 0.9) return;
    const t = c.target;
    if (!t || !t.alive || c.holdFire) {
      c.aimTarget = null; a.target = null;
      if (isFirearm(w) && c.mag < w.mag * 0.5 && c.reserve > 0 && !c.visible.some((e) => Math.hypot(e.x - a.x, e.z - a.z) < 9)) this.startReload(true);
      if (!a.moving && c.lookAt) a.turnTowards(Math.atan2(c.lookAt.x - a.x, c.lookAt.z - a.z), dt, 4);
      return;
    }
    const dx = t.x - a.x, dz = t.z - a.z, d = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const facing = a.turnTowards(yaw, dt, 9) || Math.abs(angDiff(yaw, a.yaw)) < 0.3;
    a.target = t;
    const useMelee = w.kind === 'melee' || (c.mag <= 0 && c.reserve <= 0);
    if (useMelee) {
      const mw = w.kind === 'melee' ? w : c.melee;
      if (d <= (mw.reachM || 1.1) + 0.25 && facing && now >= c.nextShotT) {
        cb.ballistics.melee(a, t, mw); c.nextShotT = now + 1 / (mw.rate || 1) * cb.rng.range(0.85, 1.2); c.aggressed = true; cb.markAggressive(a);
      }
      return;
    }
    if (c.mag <= 0) { if (c.reserve > 0) this.startReload(); else this.outOfAmmo(); return; }
    a.data.aiming = true;
    const bal = cb.ballistics; a.aimPitch = Math.atan2(bal.aimY(t) - bal.muzzleY(a), Math.max(0.5, d));
    if (c.aimTarget !== t) { c.aimTarget = t; c.aimT = 0; }
    c.aimT += dt;
    if (!facing || now < c.nextShotT) return;
    if (c.burstLeft <= 0 && c.aimT < (w.aimTime || 0.5) * c.aimMul * (d < 4 ? 0.5 : 1)) return;
    if (this.friendlyInLine(t, d)) { c.nextShotT = now + 0.3; return; }
    this.shoot(t, d);
  }
  spread(t, d) {
    const a = this.a, c = a.data.cb, cb = this.cb, w = c.weapon;
    let sd = w.spread * (1.9 - 1.35 * c.skill);
    sd *= 1 + c.stress * 0.9 + c.supp * 1.1;
    if (a.moving) sd *= w.kind === 'pistol' ? 1.7 : 2.2;
    sd *= Math.max(0.82, Math.min(1.35, 1.35 - 0.45 * (c.aimT / (w.aimTime || 0.5))));
    sd += c.burstN * (w.recoil || 0);
    if (cb.isDark(t) && !(t.data && t.data.muzzleT > cb.t - 0.5)) sd *= 1.35;
    sd *= 1 + (c.gas || 0) * 1.6 + (c.smoke || 0) * 0.5;
    sd *= c.accMul;
    if (a.pose === 'crouch') sd *= 0.88;
    if ((a.y || 0) > 1) sd *= 0.85;
    if (c.stunT > 0) sd *= 1.8;
    const tv = Math.hypot(t.vx || 0, t.vz || 0); if (tv > 0.2) sd += tv * 0.09 / Math.max(d, 2);
    return sd;
  }
  shoot(t, d) {
    const a = this.a, c = a.data.cb, cb = this.cb, w = c.weapon, now = cb.t, bal = cb.ballistics;
    const sd = this.spread(t, d);
    let ty = bal.aimY(t);
    if (t.pose === 'crouch' && cb.world.coverBetween(a.x, a.z, t.x, t.z) >= 0.6) ty += 0.12;
    bal.fire(a, w, a.x, bal.muzzleY(a), a.z, t.x, ty, t.z, sd, { by: a.id });
    a.playAnim('shoot', 0.16);
    c.mag--; c.shots++; c.lastShotT = now; a.data.muzzleT = now; c.aggressed = true;
    cb.markAggressive(a); cb.spentRound(a);
    if (cb.rng.chance(w.jam || 0)) { c.jamT = cb.rng.range(1.2, 2.8); c.burstLeft = 0; cb.barks.say(a, 'jam', { force: c.side === 'police' }); return; }
    if (c.burstLeft > 0) { c.burstLeft--; c.burstN++; c.nextShotT = now + 60 / (w.rpm || 300); }
    else {
      c.burstN = 0; c.burstLeft = cb.rng.int(w.burst[0], w.burst[1]) - 1;
      if (c.burstLeft > 0) c.nextShotT = now + 60 / (w.rpm || 300);
      else c.nextShotT = now + w.cadence * cb.rng.range(0.75, 1.35) * (1 + c.supp * 0.8 + c.stress * 0.4);
    }
    if (c.burstLeft <= 0 && w.burst[1] > 1) c.nextShotT = Math.max(c.nextShotT, now + w.cadence * cb.rng.range(0.7, 1.3));
  }
  startReload(tactical = false) {
    const a = this.a, c = a.data.cb, cb = this.cb, w = c.weapon;
    if (!isFirearm(w) || c.reserve <= 0 || c.reloadT > 0 || c.mag >= w.mag) return;
    c.reloadT = w.reload * (1 + c.stress * 0.35) * (c.skill < 0.35 ? 1.2 : 1);
    c.burstLeft = 0; a.playAnim('reload', Math.min(1.5, c.reloadT));
    if (!tactical || cb.rng.chance(0.3)) cb.barks.say(a, c.side === 'police' ? (w.kind === 'shotgun' ? 'reload_sg' : 'reload') : 'reload', { chance: tactical ? 0.4 : 0.8 });
  }
  finishReload() {
    const a = this.a, c = a.data.cb, w = c.weapon;
    const take = Math.min(w.mag - c.mag, c.reserve); c.mag += take; c.reserve -= take; this.cb.syncAmmo(a);
  }
  outOfAmmo() { const c = this.a.data.cb; if (!c.noAmmo) { c.noAmmo = true; this.cb.barks.say(this.a, 'empty', { force: true }); } }
  friendlyInLine(t, d) {
    const a = this.a, c = a.data.cb; const ux = (t.x - a.x) / d, uz = (t.z - a.z) / d;
    for (const f of this.cb.alliesOf(c.side)) {
      if (f === a || !f.alive || f === t) continue;
      const rx = f.x - a.x, rz = f.z - a.z; const along = rx * ux + rz * uz;
      if (along < 0.4 || along > d - 0.3) continue;
      if (Math.abs(rx * uz - rz * ux) < 0.5 && !(f.downed && d < 6)) return true;
    }
    return false;
  }

  // ——— поза ———
  poseTick() {
    const a = this.a, c = a.data.cb, now = this.cb.t;
    if (a.moving) { a.pose = c.sneak ? 'crouch' : 'stand'; a.data.ducked = false; return; }
    if (c.coverLow || c.wantCrouch) {
      a.pose = 'crouch';
      a.data.ducked = c.coverLow && (c.reloadT > 0 || c.jamT > 0 || !c.target || c.duckT > now || (c.supp > 0.75 && !c.target));
    } else { a.pose = 'stand'; a.data.ducked = false; }
  }

  // ——— ранен и лежит ———
  downedTick(dt) {
    const a = this.a, c = a.data.cb, cb = this.cb;
    a.pose = 'lie'; a.downed = true; a.data.downed = true; a.data.ducked = false; a.data.aiming = false; a.target = null;
    if (a.moving) a.stop();
    if (cb.t >= c.nextThink) {
      c.nextThink = cb.t + 0.9 + cb.rng.next() * 0.5;
      const threat = cb.nearestKnownEnemy(c.side, a.x, a.z, 9);
      c.crawl = null;
      if (threat && !c.stabilized && c.courage < 0.85) {
        const dx = a.x - threat.x, dz = a.z - threat.z, l = Math.hypot(dx, dz) || 1;
        const tx = a.x + dx / l * 2, tz = a.z + dz / l * 2;
        if (cb.nav.walkable(tx, tz)) c.crawl = { x: tx, z: tz };
      }
      if (cb.rng.chance(0.12)) cb.barks.say(a, c.side === 'police' ? 'self_down' : 'b_hit', { chance: 0.5 });
      // ветеран отстреливается лёжа
      if (c.side === 'police' && c.courage > 0.7 && c.weapon.kind === 'pistol' && c.mag > 0) {
        const e = cb.nearestVisibleEnemy(a, 14);
        if (e && cb.rng.chance(0.5)) { a.faceTo(e.x, e.z); c.aimT = 0.3; c.burstN = 0; const sd = this.spread(e, a.distTo(e)) * 2; cb.ballistics.fire(a, c.weapon, a.x, 0.3, a.z, e.x, cb.ballistics.aimY(e), e.z, sd, { by: a.id }); c.mag--; cb.spentRound(a); }
      }
    }
    if (c.crawl) {
      const dx = c.crawl.x - a.x, dz = c.crawl.z - a.z, d = Math.hypot(dx, dz);
      if (d < 0.1) c.crawl = null;
      else { const s = Math.min(d, 0.22 * dt); const nx = a.x + dx / d * s, nz = a.z + dz / d * s; if (cb.nav.walkable(nx, nz)) { [a.x, a.z] = cb.world.collide(nx, nz, 0.25); a.data.action = 'crawl'; } else c.crawl = null; }
    } else if (a.data.action === 'crawl') a.data.action = null;
  }
}

export function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
