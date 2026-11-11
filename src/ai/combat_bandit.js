// «Участок» — ИИ бандитов (агент D): боец с ролью и командир отряда.
// Фазы отряда: approach → (parley) → setup → breach → assault ⇄ hold (оккупация) → retreat / rout.
import { Fighter } from './combat_fighter.js';
import { threatsFor, planPositions } from './combat_tactics.js';
import { dangerScore, WEAPONS, getWeapon, lookWeapon } from './weapons.js';
import { zoneLabel } from './doctrine.js';

const ENTRY = {
  front: { zone: 'street', door: 'front', inside: 'lobby', exits: ['spawn_street_w', 'spawn_street_e', 'spawn_street_c'] },
  back: { zone: 'yard', door: 'back', inside: 'generator', exits: ['spawn_yard_gate', 'spawn_alley'] },
};
export { ENTRY };

export class BanditBrain extends Fighter {
  think() {
    const a = this.a, c = a.data.cb, cb = this.cb, now = cb.t;
    c.aware = true;
    const sq = cb.squadOf(a);
    if (c.inFire) { const f = c.inFire; const dx = a.x - f.x, dz = a.z - f.z, l = Math.hypot(dx, dz) || 1; const p = cb.nav.nearestWalkable(f.x + dx / l * (f.r + 1.2), f.z + dz / l * (f.r + 1.2), 4); if (p) this.goTo(p[0], p[1], true); return; }
    // ложная сдача: отморозок ждёт, пока мент подойдёт
    if (c.fakeSurrender && c.surrendered) return;
    // раненый трус уползает/уходит
    if (!c.leaving && a.hp < 45 && c.courage < 0.55 && cb.rng.chance(0.08)) { c.leaving = true; cb.chron(`${cb.nameOf(a)}, раненый, пытается уйти.`); }
    if (this.checkSurrender(sq)) return;
    const o = (c.leaving && !sq?.holding) ? { type: 'retreat' } : c.order;
    const routing = o && o.type === 'rout';
    c.target = routing ? (c.visible.find((e) => a.distTo(e) < 2.5) || null) : this.pickTarget(sq);
    c.holdFire = !!(sq && sq.phase === 'parley' && !sq.provoked) || routing;
    a.data.strafe = !!c.target && !routing;
    if (c.act) { this.doAct(); return; }
    // рукопашник гонится за целью
    const melee = c.weapon.kind === 'melee' || (c.mag <= 0 && c.reserve <= 0);
    if (melee && c.target && !routing && !(o && o.type === 'retreat') && (!sq || ['assault', 'breach', 'hold'].includes(sq.phase) || a.distTo(c.target) < 5) && a.distTo(c.target) < 14) {
      const t = c.target; if (a.distTo(t) > 1.1) this.goTo(t.x, t.z, true, 0.9); c.coverLow = false; return;
    }
    if (c.noAmmo && c.weapon.kind !== 'melee' && !(o && o.type === 'retreat')) { const drop = cb.nearestDrop(a.x, a.z, 10); if (drop) { if (a.distTo(drop) > 0.6) { this.goTo(drop.x, drop.z, true); return; } cb.pickUp(a, drop); return; } }
    switch (o ? o.type : null) {
      case 'post': case 'move': this.holdPost(o); break;
      case 'push': this.push(o); break;
      case 'breach': this.breach(o); break;
      case 'liberate': this.liberate(o); break;
      case 'throw': this.throwAt(o); break;
      case 'climb': this.climb(o); break;
      case 'retreat': case 'rout': this.retreat(o); break;
      case 'barricade': this.barricade(o); break;
      case 'loot': this.loot(o); break;
      case 'cutpower': this.cutPower(o); break;
      default:
        if (sq && sq.leader && sq.leader !== a && a.distTo(sq.leader) > 4) this.goTo(sq.leader.x, sq.leader.z, true, 2);
    }
  }
  checkSurrender(sq) {
    const a = this.a, c = a.data.cb, cb = this.cb;
    if (c.surrendered || !sq || cb.t < (c.nextSurrCheck || 0)) return false;
    c.nextSurrCheck = cb.t + 2;
    const cops = c.visible.filter((e) => a.distTo(e) < 9 && !e.downed);
    if (!cops.length) return false;
    const broken = sq.phase === 'rout' || sq.phase === 'retreat' || sq.morale < sq.T.routAt + 0.05 || c.leaving;
    const desperate = a.hp < 50 || c.noAmmo || (c.noExitT && cb.t - c.noExitT < 6);
    if (!broken || !desperate) return false;
    const p = sq.T.surrender * (cops.length >= 2 ? 1.3 : 1) * (a.hp < 30 ? 1.4 : 1);
    if (!cb.rng.chance(Math.min(0.8, p))) return false;
    cb.surrender(a, sq.T.chaotic && cb.rng.chance(0.3));
    return true;
  }
  pickTarget(sq) {
    const a = this.a, c = a.data.cb, cb = this.cb;
    let best = null, bs = -Infinity;
    for (const e of c.visible) {
      if (!e.alive) continue; const d = a.distTo(e);
      const ec = e.data.cb || {};
      let s = -d;
      if (sq && sq.gangType === 'afghan') s += dangerScore(ec.weaponId) * 1.5;
      if (e.downed) s += (sq && sq.T.chaotic && cb.rng.chance(0.3)) ? 3 : -15;
      if (e.team === 'player') s += sq && sq.T.chaotic ? 3 : 1;
      if (e === c.target) s += 1.5;
      if (d > c.weapon.maxRange) s -= 30;
      if (s > bs) { bs = s; best = e; }
    }
    return best;
  }
  holdPost(o) {
    const a = this.a, c = a.data.cb;
    if (!this.near(o.x, o.z, 0.5)) { this.goTo(o.x, o.z, o.run !== false && (o.run || c.visible.length > 0 || !c.sneakAllowed)); c.coverLow = false; c.sneak = !!o.sneak; }
    else { if (a.moving) this.halt(); c.coverLow = !!o.low; c.lookAt = o.look || null; c.sneak = false; o.arrived = true; }
  }
  push(o) {
    const a = this.a, c = a.data.cb;
    if (!this.near(o.x, o.z, 0.7)) { this.goTo(o.x, o.z, true); c.coverLow = false; }
    else { if (a.moving) this.halt(); c.coverLow = !!o.low; o.done = true; c.lookAt = o.look || null; }
  }
  startAct(kind, dur, fn, anim) { const a = this.a, c = a.data.cb; this.halt(); c.act = { kind, fn, anim }; c.actT = dur; c.lastActT = this.cb.t; a.data.action = kind; }
  doAct() {
    const a = this.a, c = a.data.cb, cb = this.cb, act = c.act;
    c.actT -= cb.t - (c.lastActT || cb.t); c.lastActT = cb.t;
    if (act.anim) a.playAnim(act.anim, 0.5);
    if (act.kind !== 'climb' && c.visible.some((e) => a.distTo(e) < 3 && !e.downed)) { c.act = null; c.actT = 0; a.data.action = null; return; }
    if (c.actT <= 0) { c.act = null; c.actT = 0; a.data.action = null; try { act.fn(); } catch (e) { console.error(e); } }
  }
  breach(o) {
    const a = this.a, c = a.data.cb, cb = this.cb; const door = cb.world.doors.find((d) => d.id === o.doorId);
    if (!door || door.barricade <= 0) { o.done = true; return; }
    if (!this.near(o.x, o.z, 0.75)) { this.goTo(o.x, o.z, true, 0.3); c.coverLow = false; return; }
    const cx = (door.rect[0] + door.rect[2]) / 2, cz = (door.rect[1] + door.rect[3]) / 2; a.faceTo(cx, cz);
    if (cb.rng.chance(0.15)) cb.barks.say(a, 'b_breach', { chance: 0.6 });
    const w = c.weapon; c.aggressed = true; cb.markAggressive(a);
    if (w.kind === 'shotgun' && c.mag > 0 && cb.rng.chance(0.6)) this.startAct('breach', 1.2, () => { cb.ballistics.fire(a, w, a.x, 1.1, a.z, cx, 1.0, cz, 0.02, { by: a.id }); c.mag--; cb.hurtBarricade(door.id, w.breach); });
    else { const mw = w.kind === 'melee' ? w : c.melee; this.startAct('breach', 1.0, () => { cb.hurtBarricade(door.id, (mw.breach || 6) * (c.strength || 1)); cb.emit('sfx', { name: door.kind === 'steel' ? 'door_steel' : 'door_wood', x: cx, z: cz }); }, 'punch'); }
  }
  liberate(o) {
    const a = this.a, c = a.data.cb, cb = this.cb;
    const cell = cb.closedCellTarget(a);
    if (!cell) { o.done = true; c.order = null; return; }
    if (!this.near(cell.x, cell.z, 0.6)) { this.goTo(cell.x, cell.z, true); c.coverLow = false; return; }
    cb.barks.say(a, 'b_liberate', { chance: 0.5 });
    a.faceTo(cell.x, cell.z - 1);
    this.startAct('unlock', 3.5, () => cb.openCell(cell.id, a), 'cuff');
  }
  throwAt(o) {
    const a = this.a, c = a.data.cb, cb = this.cb;
    const have = o.kind === 'rgd5' ? c.grenades : c.molotovs;
    if (!have) { c.order = o.after || null; return; }
    const from = o.from || null;
    const d = Math.hypot(o.x - a.x, o.z - a.z);
    if (from && !this.near(from.x, from.z, 0.8) && (d > 14 || !cb.nav.lof(a.x, a.z, o.x, o.z))) { this.goTo(from.x, from.z, true); return; }
    if (d > 16) { this.goTo(o.x, o.z, true); return; }
    if (o.kind === 'rgd5') c.grenades--; else c.molotovs--;
    cb.barks.say(a, o.kind === 'rgd5' ? 'b_grenade' : 'b_molotov', { force: true });
    cb.fx.throwItem(a, o.kind, o.x, o.z); c.aggressed = true; cb.markAggressive(a);
    cb.chron(`${cb.nameOf(a)} бросает ${o.kind === 'rgd5' ? 'гранату' : 'бутылку с зажигательной смесью'} ${zoneLabel(cb.nav.zoneAt(o.x, o.z), 'to')}.`);
    c.order = o.after || null; c.nextThink = cb.t + 1;
  }
  climb() {
    const a = this.a, c = a.data.cb, cb = this.cb;
    if (c.onRoof) { this.halt(); c.coverLow = false; c.wantCrouch = true; return; }
    const p = { x: 4.0, z: 27.1 };
    if (!this.near(p.x, p.z, 0.6)) { this.goTo(p.x, p.z, true); return; }
    this.startAct('climb', 3.2, () => { a.x = 4.0; a.z = 28.5; a.y = 2.65; c.onRoof = true; a.data.onRoof = true; c.wantCrouch = true; cb.chron(`${cb.nameOf(a)} забирается на крышу киоска с карабином.`); }, 'wave');
  }
  retreat(o) {
    const a = this.a, c = a.data.cb, cb = this.cb;
    if (c.onRoof) { a.y = 0; c.onRoof = false; a.data.onRoof = false; a.x = 4; a.z = 27.0; }
    if (!c.exit || cb.t - (c.exitT || 0) > 10) { c.exit = cb.exitFor(a); c.exitT = cb.t; if (!c.exit) c.noExitT = cb.t; }
    if (!c.exit) return;
    if (this.near(c.exit.x, c.exit.z, 1.6)) { cb.despawn(a, 'fled'); return; }
    this.goTo(c.exit.x, c.exit.z, true); c.coverLow = false;
  }
  barricade(o) {
    const a = this.a, c = a.data.cb, cb = this.cb; const door = cb.world.doors.find((d) => d.id === o.doorId);
    if (!door || door.barricade > 0) { c.order = null; return; }
    if (!this.near(o.x, o.z, 0.7)) { this.goTo(o.x, o.z, false); return; }
    cb.barks.say(a, 'b_hold', { chance: 0.6 });
    this.startAct('barricade', 9, () => { cb.placeBarricadeNow(o.doorId, 220, 'bandit'); c.order = null; }, 'punch');
  }
  loot() {
    const a = this.a, c = a.data.cb, cb = this.cb; const p = cb.world.points.armory_counter;
    if (!this.near(p.x, p.z, 0.8)) { this.goTo(p.x, p.z, true); return; }
    cb.barks.say(a, 'b_loot', { chance: 0.8 });
    this.startAct('loot', 5, () => { cb.lootArmory(a); c.order = null; }, 'punch');
  }
  cutPower() {
    const a = this.a, c = a.data.cb, cb = this.cb; const p = cb.world.points.fusebox;
    if (cb.fuseBroken) { c.order = null; return; }
    if (!this.near(p.x, p.z, 0.8)) { this.goTo(p.x, p.z, true); return; }
    cb.barks.say(a, 'b_cutpower', { force: true });
    this.startAct('breach', 2, () => { cb.breakFusebox(cb.nameOf(a)); c.order = null; }, 'punch');
  }
}

// ———————————————————————— командир отряда ————————————————————————
export class SquadCommander {
  constructor(cb, sq) {
    this.cb = cb; this.sq = sq; // sq — живой объект из state.attack.squads (JSON)
    this.nextPlan = 0; this.lastLeader = null; this.waitT = 0; this.grenadeT = -99; this.lastCapture = cb.t;
  }
  get id() { return this.sq.id; }
  get phase() { return this.sq.phase; }
  get morale() { return this.sq.morale; }
  get T() { return this.cb.tacticsFor(this.sq.gangType); }
  get gangType() { return this.sq.gangType; }
  get holding() { return this.sq.phase === 'hold'; }
  get provoked() { return !!this.sq.provoked; }
  members() { const cb = this.cb; const out = []; for (const id of this.sq.memberIds) { const a = cb.world.actorById(id); if (a && a.alive) out.push(a); } return out; }
  effective(a) { const c = a.data.cb; return a.alive && !c.downed && !c.surrendered && !c.captive && !c.leaving; }
  setPhase(p, why = '') {
    const sq = this.sq; if (sq.phase === p) return;
    sq.phase = p; sq.phaseT = this.cb.t; this.waitT = 0;
    const L = this.leader;
    if (p === 'retreat') { if (L) this.cb.barks.say(L, 'b_retreat', { force: true }); this.cb.chron(`${this.cb.squadName(sq)}: отход${why ? ' — ' + why : ''}.`); }
    if (p === 'rout') { for (const m of this.members()) if (this.effective(m)) this.cb.barks.say(m, 'b_rout', { chance: 0.5 }); this.cb.chron(`${this.cb.squadName(sq)} бежит${why ? ' — ' + why : ''}!`); }
    if (p === 'hold') { if (L) this.cb.barks.say(L, 'b_hold', { force: true }); this.cb.chron(`${this.cb.squadName(sq)} закрепляется в здании.`); }
    if (p === 'assault') this.cb.chron(`${this.cb.squadName(sq)}: штурм.`);
  }
  morale_(d, why) { const sq = this.sq; sq.morale = Math.max(0, Math.min(1, sq.morale + d)); }
  onMemberDown(a, dead) {
    const T = this.T; const isL = a.data.cb.isLeader;
    this.morale_(dead ? -(isL ? 0.22 : 0.1) * (1.25 - T.disc) : -0.045);
    if (isL && dead) {
      const nb = this.members().filter((m) => this.effective(m))[0];
      if (nb) this.cb.barks.say(nb, 'b_leader_dead', { force: true, subj: a });
      this.cb.chron(`Убит главарь отряда — ${this.cb.nameOf(a)}.`);
      if (T.disc < 0.5 && this.cb.rng.chance(0.5)) this.setPhase('rout', 'главарь убит');
    }
  }
  update(dt) {
    const cb = this.cb; if (cb.t < this.nextPlan) return;
    this.nextPlan = cb.t + 0.9 + cb.rng.next() * 0.5;
    try { this.plan(); } catch (e) { console.error('[squad]', e); }
  }
  plan() {
    const cb = this.cb, sq = this.sq, T = this.T, now = cb.t;
    const ms = this.members(); const eff = ms.filter((m) => this.effective(m));
    if (!eff.length) { if (sq.phase !== 'done') sq.phase = 'done'; return; }
    // главарь
    let L = eff.find((m) => m.id === sq.leaderId);
    if (!L) { L = eff.slice().sort((a, b) => b.data.cb.discipline - a.data.cb.discipline)[0]; sq.leaderId = L.id; this.morale_(-0.04); }
    for (const m of ms) m.data.cb.isLeader = m === L;
    this.leader = L;
    // мораль
    const sup = eff.filter((m) => m.data.cb.supp > 0.5).length / eff.length;
    this.morale_(-sup * 0.012 * (1.3 - T.disc));
    if (now - sq.startT > 150) this.morale_(-0.004);
    if (['assault', 'breach', 'setup', 'approach'].includes(sq.phase)) {
      if (sq.morale < T.routAt) this.setPhase('rout', 'нервы сдали');
      else if (sq.morale < T.breakAt) this.setPhase('retreat', 'потери');
    } else if (sq.phase === 'hold' && sq.morale < T.routAt * 0.7) this.setPhase('retreat', 'не удержаться');
    // хаотичность отморозков
    if (T.chaotic && cb.rng.chance(0.05)) { const m = cb.rng.pick(eff); if (m.data.cb.molotovs && !m.data.cb.order?.kind) this.orderMolotov(m); }
    switch (sq.phase) {
      case 'approach': return this.pApproach(eff, L);
      case 'parley': return this.pParley(eff, L);
      case 'setup': return this.pSetup(eff, L);
      case 'breach': return this.pBreach(eff, L);
      case 'assault': return this.pAssault(eff, L);
      case 'hold': return this.pHold(eff, L);
      case 'retreat': case 'rout': case 'deal':
        for (const m of ms) if (!m.data.cb.surrendered && !m.data.cb.captive && !m.data.cb.downed) m.data.cb.order = { type: sq.phase === 'rout' ? 'rout' : 'retreat' };
        return;
    }
  }
  get E() { return ENTRY[this.sq.entry] || ENTRY.front; }
  doorOp() { return this.cb.nav.doorOpening[this.E.door]; }
  facadeThreats() {
    const cb = this.cb, E = this.E; const out = [];
    for (const o of cb.nav.zoneOpenings[E.zone] || []) {
      const inner = cb.nav.otherZone(o, E.zone); if (!inner || !cb.isIndoor(inner)) continue;
      let w = 0.6 + ([...cb.intel.enemy.values()].some((k) => k.zone === inner && cb.t - k.t < 15) ? 0.6 : 0);
      out.push({ x: o.x, z: o.z, w, o, fromZone: inner });
    }
    return out;
  }
  stackSpots(o, zone) {
    const cb = this.cb; const out = [];
    for (const s of cb.nav.spots(zone)) {
      const rx = s.x - o.x, rz = s.z - o.z; const along = rx * o.nx + rz * o.nz, lat = Math.abs(rx * o.nz - rz * o.nx);
      if (Math.abs(along) < 1.3 && lat > o.half + 0.35 && lat < o.half + 3.6 && cb.nav.walkable(s.x, s.z)) out.push(s);
    }
    return out;
  }
  pApproach(eff, L) {
    const cb = this.cb, sq = this.sq, T = this.T, now = cb.t, E = this.E, D = this.doorOp();
    if (!sq.staged) {
      sq.staged = true;
      const sup = eff.filter((m) => ['support', 'sniper'].includes(m.data.cb.role));
      const res = planPositions(cb, E.zone, this.facadeThreats(), sup.filter((m) => m.data.cb.role !== 'sniper'), { ideal: 11, noise: 0.5 });
      for (const m of sup) { const c = m.data.cb; if (c.role === 'sniper' && sq.entry === 'front') { c.order = { type: 'climb' }; continue; } const p = res.get(m.id); if (p) c.order = { type: 'post', x: p.x, z: p.z, low: p.low, look: p.threat ? { x: p.threat.x, z: p.threat.z } : null, sneak: T.stealth && cb.isNight(), run: !T.stealth }; }
      const rest = eff.filter((m) => !sup.includes(m));
      const stacks = this.stackSpots(D, E.zone);
      rest.forEach((m, i) => { const s = stacks[i % Math.max(1, stacks.length)] || cb.nav.openingSide(D, E.zone, 2.5); m.data.cb.order = { type: 'post', x: s.x + (stacks.length ? 0 : cb.rng.range(-1, 1)), z: s.z, low: !!s.low, look: { x: D.x, z: D.z }, sneak: T.stealth && cb.isNight(), run: !T.stealth }; });
      if (L) cb.barks.say(L, 'b_taunt_' + sq.gangType, { force: !T.stealth });
      if (!T.stealth) cb.noise(L.x, L.z, 30, 'enemy', L);
    }
    const ready = eff.filter((m) => { const o = m.data.cb.order; return !o || o.type === 'climb' || o.arrived || (m.data.cb.onRoof); }).length;
    const spotted = eff.some((m) => now - m.data.cb.underFireT < 3);
    if (ready >= Math.ceil(eff.length * 0.7) || now - sq.phaseT > 30 || spotted) {
      if (T.parley && !sq.parleyDone && !spotted) { this.setPhase('parley'); cb.startParley(this); }
      else this.setPhase(T.bounding || T.stealth ? 'setup' : 'breach');
    }
  }
  pParley(eff, L) {
    const cb = this.cb, sq = this.sq, now = cb.t;
    if (eff.some((m) => now - m.data.cb.underFireT < 2)) { sq.provoked = true; sq.parleyDone = true; if (L) cb.barks.say(L, 'b_push', { force: true }); cb.chron('Блатные: «Ах так, мусора!» — переговоры сорваны стрельбой.'); this.setPhase('breach'); return; }
    const ans = sq.parleyAnswer;
    if (ans === 'give') { sq.parleyDone = true; this.setPhase('deal'); cb.chron(`${cb.squadName(sq)} забирают своего и уходят.`); return; }
    if (ans === 'refuse' || now - sq.phaseT > (sq.stall ? 75 : 45)) { sq.parleyDone = true; this.setPhase('setup'); return; }
  }
  pSetup(eff, L) {
    const cb = this.cb, sq = this.sq, T = this.T, now = cb.t;
    // поджигатели — в окна; стрелки держат окна
    for (const m of eff) { const c = m.data.cb; if (c.role === 'arsonist' && c.molotovs > 0 && (!c.order || c.order.type !== 'throw')) this.orderMolotov(m); }
    if (T.cutPower && sq.entry === 'back') {} // свет режут изнутри
    const dur = T.bounding ? 7 : T.stealth ? 4 : 1.5;
    if (now - sq.phaseT > dur) this.setPhase('breach');
  }
  orderMolotov(m) {
    const cb = this.cb, c = m.data.cb; const E = this.E;
    const wins = cb.nav.openings.filter((o) => o.type === 'window' && o.zones.includes(m.zone) && cb.isIndoor(cb.nav.otherZone(o, m.zone) || ''));
    const zoneHere = m.zone;
    let target = null;
    if (wins.length) {
      const scored = wins.map((o) => { const inner = cb.nav.otherZone(o, zoneHere); let s = cb.rng.next(); if ([...cb.intel.enemy.values()].some((k) => k.zone === inner && cb.t - k.t < 20)) s += 2; if (['rest', 'duty', 'office', 'opers', 'corridor'].includes(inner)) s += 1; return { o, inner, s }; }).sort((a, b) => b.s - a.s);
      const w = scored[0]; const p = cb.nav.openingSide(w.o, w.inner, 2.2); const from = cb.nav.openingSide(w.o, zoneHere, 5.5);
      target = { x: p.x, z: p.z, from };
    } else {
      const k = [...cb.intel.enemy.values()].filter((k) => cb.t - k.t < 8).sort((a, b) => Math.hypot(a.x - m.x, a.z - m.z) - Math.hypot(b.x - m.x, b.z - m.z))[0];
      if (k && Math.hypot(k.x - m.x, k.z - m.z) < 16) target = { x: k.x, z: k.z, from: null };
    }
    if (target) c.order = { type: 'throw', kind: 'molotov', x: target.x, z: target.z, from: target.from, after: c.order && c.order.type !== 'throw' ? c.order : null };
  }
  pBreach(eff, L) {
    const cb = this.cb, sq = this.sq, T = this.T, now = cb.t, E = this.E, D = this.doorOp();
    const door = cb.world.doors.find((d) => d.id === E.door);
    if (!door || door.barricade <= 0) { sq.base = E.zone; this.setPhase('assault'); return; }
    // граната за баррикаду
    const nade = eff.find((m) => m.data.cb.grenades > 0);
    if (nade && now - this.grenadeT > 12 && [...cb.intel.enemy.values()].some((k) => k.zone === E.inside && cb.t - k.t < 10)) {
      const p = cb.nav.openingSide(D, E.inside, 2.5); nade.data.cb.order = { type: 'throw', kind: 'rgd5', x: p.x, z: p.z, from: cb.nav.openingSide(D, E.zone, 2.5) }; this.grenadeT = now;
    }
    const breachers = eff.filter((m) => ['assault', 'liberator'].includes(m.data.cb.role) || (T.disc < 0.4 && m.data.cb.role !== 'sniper'));
    const p = cb.nav.openingSide(D, E.zone, 0.8);
    const n = Math.min(breachers.length, D.half > 0.6 ? 3 : 2);
    breachers.forEach((m, i) => {
      if (i < n) { const off = (i - (n - 1) / 2) * 0.55; m.data.cb.order = { type: 'breach', doorId: door.id, x: p.x + D.nz * off, z: p.z + D.nx * off }; }
      else if (!m.data.cb.order || m.data.cb.order.type === 'breach') { const st = this.stackSpots(D, E.zone)[i] || cb.nav.openingSide(D, E.zone, 2.5); m.data.cb.order = { type: 'post', x: st.x, z: st.z, low: !!st.low, look: { x: D.x, z: D.z } }; }
    });
    if (L && cb.rng.chance(0.2)) cb.barks.say(L, 'b_breach', { chance: 0.6 });
    if (now - sq.phaseT > 70) this.morale_(-0.02);
  }
  objectiveChain() {
    const sq = this.sq, cb = this.cb;
    if (sq.chain) return sq.chain;
    const mine = cb.gangDetainees(sq.gangId).length > 0;
    let ch;
    switch (sq.gangType) {
      case 'afghan': ch = sq.entry === 'back' ? ['generator', 'armory', mine ? 'ivs' : 'duty', 'clear'] : ['lobby', 'duty', 'armory', 'clear']; break;
      case 'thieves': ch = ['ivs', 'leave']; break;
      case 'drugs': ch = mine ? ['ivs', 'leave'] : ['armory', 'leave']; break;
      case 'frostbitten': ch = cb.rng.shuffle(['duty', 'rest', 'opers', 'corridor']).slice(0, 2).concat(['clear']); break;
      default: ch = ['lobby', 'duty', mine ? 'ivs' : 'corridor', 'clear'];
    }
    if (sq.liberate && !ch.includes('ivs') && mine) ch.splice(1, 0, 'ivs');
    sq.chain = ch; return ch;
  }
  pAssault(eff, L) {
    const cb = this.cb, sq = this.sq, T = this.T, now = cb.t;
    sq.momentum = Math.max(0, (sq.momentum ?? 1) - 0.011 * (1.4 - T.aggression * 0.6));
    const chain = this.objectiveChain();
    let obj = chain[0];
    if (!sq.base) sq.base = this.E.zone;
    // база = где большинство
    const counts = {}; for (const m of eff) counts[m.zone] = (counts[m.zone] || 0) + 1;
    if (obj === 'leave') { this.setPhase('retreat', 'своих забрали'); return; }
    if (obj === 'clear') {
      const ks = [...cb.intel.enemy.values()].filter((k) => cb.t - k.t < 25 && cb.isIndoor(k.zone) && k.a && k.a.alive && !k.a.downed);
      if (!ks.length) {
        const own = cb.indoorOwnedBy('police');
        if (!own.length) { this.setPhase('hold'); return; }
        obj = own.sort((a, b) => Math.hypot(...sub(cb.world.zoneCenter(a), [L.x, L.z])) - Math.hypot(...sub(cb.world.zoneCenter(b), [L.x, L.z])))[0];
      } else obj = ks.sort((a, b) => Math.hypot(a.x - L.x, a.z - L.z) - Math.hypot(b.x - L.x, b.z - L.z))[0].zone;
    }
    // цель достигнута?
    if (cb.ownerFor(obj, 'enemy') === 'own' && eff.some((m) => m.zone === obj)) {
      if (this.objectiveWork(obj, eff)) return;
      if (chain[0] !== 'clear') { chain.shift(); this.lastCapture = now; sq.momentum = Math.min(1.2, sq.momentum + 0.25); }
      return;
    }
    const route = cb.nav.zoneRoute(sq.base, obj) || [sq.base, obj];
    const next = route.length > 1 ? route[1] : obj;
    if (cb.ownerFor(sq.base, 'enemy') !== 'own' && cb.isIndoor(sq.base) && !eff.some((m) => m.zone === sq.base)) sq.base = this.E.zone;
    const D = cb.nav.doorBetween(sq.base, next);
    if (!D) { sq.base = next; return; }
    const doorObj = D.ref ? cb.world.doors.find((d) => d.id === D.ref) : null;
    const police = [...cb.intel.enemy.values()].filter((k) => k.zone === next && cb.t - k.t < 10 && k.a && k.a.alive && !k.a.downed);
    this.waitT += 1;
    let pushNow;
    if (T.chaotic || sq.gangType === 'sport') pushNow = sq.morale > 0.45 || police.length === 0;
    else if (T.bounding) pushNow = police.length === 0 || now - this.grenadeT < 3.5 || (police.length <= 1 && eff.length >= 3) || this.waitT > 14;
    else pushNow = police.length <= 1 && eff.length >= 2 || this.waitT > 20;
    // гранату перед входом
    const nade = eff.find((m) => m.data.cb.grenades > 0 && m.zone === sq.base);
    if (!pushNow && nade && police.length && now - this.grenadeT > 10) {
      const [px, pz] = [police.reduce((s, k) => s + k.x, 0) / police.length, police.reduce((s, k) => s + k.z, 0) / police.length];
      nade.data.cb.order = { type: 'throw', kind: 'rgd5', x: px, z: pz, from: cb.nav.openingSide(D, sq.base, 1.6) }; this.grenadeT = now + 0.5;
    }
    if (doorObj && doorObj.barricade > 0) {
      const p = cb.nav.openingSide(D, sq.base, 0.8);
      eff.filter((m) => m.data.cb.role !== 'sniper').slice(0, 2).forEach((m, i) => { m.data.cb.order = { type: 'breach', doorId: D.ref, x: p.x + D.nz * (i - 0.5) * 0.5, z: p.z + D.nx * (i - 0.5) * 0.5 }; });
      return;
    }
    const inside = cb.nav.spots(next).filter((s) => Math.hypot(s.x - D.x, s.z - D.z) < 7 && cb.nav.walkable(s.x, s.z));
    const threatsBase = [{ x: D.x, z: D.z, w: 1, o: D, fromZone: next }];
    const holdRes = pushNow ? null : planPositions(cb, sq.base, threatsBase, eff.filter((m) => m.zone === sq.base || !cb.isIndoor(m.zone)), { ideal: 5, noise: 0.6 });
    eff.forEach((m, i) => {
      const c = m.data.cb; if (c.order && c.order.type === 'throw') return;
      if (c.role === 'sniper' && c.onRoof) { if (now - sq.phaseT > 60 && !c.visible.length) c.order = { type: 'post', x: cb.world.points.front_door_out.x, z: cb.world.points.front_door_out.z }; else return; }
      if (c.role === 'liberator' && (next === 'ivs' || sq.base === 'ivs' || (cb.ownerFor('ivs', 'enemy') !== 'enemy' && cb.adjacent(m.zone, 'ivs') && police.length === 0))) { if (cb.closedCellTarget(m)) { c.order = { type: 'liberate' }; return; } }
      if (c.role === 'support' && !cb.isIndoor(m.zone) && cb.isIndoor(next) && next === this.E.inside && i % 2) return; // часть прикрытия остаётся снаружи
      if (pushNow) {
        if (!c.order || c.order.type !== 'push' || c.order.zone !== next || c.order.done) {
          const s = inside.length ? inside[(i * 3 + cb.rng.int(0, 2)) % inside.length] : { x: cb.world.zoneCenter(next)[0], z: cb.world.zoneCenter(next)[1], low: false };
          c.order = { type: 'push', x: s.x, z: s.z, low: s.low, zone: next, look: police[0] ? { x: police[0].x, z: police[0].z } : null };
        }
      } else if (holdRes && holdRes.get(m.id)) { const p = holdRes.get(m.id); c.order = { type: 'post', x: p.x, z: p.z, low: p.low, look: { x: D.x, z: D.z } }; }
    });
    if (pushNow && L && cb.rng.chance(0.3)) cb.barks.say(L, T.bounding ? 'b_push_afghan' : 'b_push', { chance: 0.7 });
    if (cb.ownerFor(next, 'enemy') === 'own' && eff.some((m) => m.zone === next)) { sq.base = next; this.waitT = 0; this.lastCapture = now; sq.momentum = Math.min(1.2, sq.momentum + 0.3); this.morale_(0.04); }
    // выдохся?
    if (sq.momentum < 0.12 && now - this.lastCapture > 40) {
      if (cb.indoorOwnedBy('enemy').length) this.setPhase('hold'); else this.setPhase('retreat', 'штурм выдохся');
    }
  }
  /** Работа на цели: вскрыть камеры, разграбить оружейку, вырубить свет. true — ещё работаем */
  objectiveWork(obj, eff) {
    const cb = this.cb, sq = this.sq;
    if (obj === 'ivs') { const c = cb.closedCellTarget(eff[0]); if (c) { const lib = eff.find((m) => m.data.cb.role === 'liberator') || eff[0]; if (!lib.data.cb.order || lib.data.cb.order.type !== 'liberate') lib.data.cb.order = { type: 'liberate' }; return true; } }
    if (obj === 'armory' && !sq.looted) { const m = eff.find((x) => x.zone === 'armory'); if (m) { if (!m.data.cb.order || m.data.cb.order.type !== 'loot') m.data.cb.order = { type: 'loot' }; return true; } }
    if (obj === 'generator' && !cb.fuseBroken && cb.power) { const m = eff.find((x) => x.zone === 'generator'); if (m) { if (!m.data.cb.order || m.data.cb.order.type !== 'cutpower') m.data.cb.order = { type: 'cutpower' }; return true; } }
    return false;
  }
  pHold(eff, L) {
    const cb = this.cb, sq = this.sq, now = cb.t;
    const held = [...new Set(eff.map((m) => m.zone))].filter((z) => cb.isIndoor(z));
    if (!held.length) { if (!cb.indoorOwnedBy('enemy').length) this.setPhase('retreat', 'нечего держать'); else { const z = cb.indoorOwnedBy('enemy')[0]; eff.forEach((m) => { const p = cb.world.randomPointInZone(z, cb.rng); if (p) m.data.cb.order = { type: 'push', x: p[0], z: p[1], zone: z }; }); } return; }
    if (!sq.holdSig || now - (sq.holdT || 0) > 8) {
      sq.holdT = now;
      for (const z of held) {
        const ms = eff.filter((m) => m.zone === z && !(m.data.cb.order && ['barricade', 'throw', 'liberate', 'loot'].includes(m.data.cb.order.type)));
        const res = planPositions(cb, z, threatsFor(cb, z, 'enemy'), ms, { noise: 0.4 });
        for (const m of ms) { const p = res.get(m.id); if (p) m.data.cb.order = { type: 'post', x: p.x, z: p.z, low: p.low, look: p.threat ? { x: p.threat.x, z: p.threat.z } : null }; }
        // баррикадировать двери к милиции
        for (const o of cb.nav.zoneDoors(z)) {
          const other = cb.nav.otherZone(o, z); const d = cb.world.doors.find((x) => x.id === o.ref);
          if (!d || d.barricade > 0 || cb.ownerFor(other, 'enemy') === 'own' || !cb.isIndoor(other) || cb.anyOrder('barricade', o.ref) || ms.length < 2) continue;
          if (sq.barricaded && sq.barricaded.includes(o.ref)) continue;
          const m = ms[ms.length - 1]; const p = cb.nav.openingSide(o, z, 0.9); m.data.cb.order = { type: 'barricade', doorId: o.ref, x: p.x, z: p.z };
          (sq.barricaded || (sq.barricaded = [])).push(o.ref); break;
        }
      }
      sq.holdSig = 1;
    }
    for (const m of eff) if (m.data.cb.role === 'liberator' && cb.closedCellTarget(m) && m.zone === 'ivs') m.data.cb.order = { type: 'liberate' };
    // расширение в пустые помещения
    if (now - (sq.expandT || 0) > 15 && eff.length >= 3) {
      sq.expandT = now;
      for (const z of held) for (const o of cb.nav.zoneDoors(z)) {
        const n = cb.nav.otherZone(o, z);
        if (!cb.isIndoor(n) || cb.ownerFor(n, 'enemy') === 'own') continue;
        const recent = [...cb.intel.enemy.values()].some((k) => k.zone === n && now - k.t < 25);
        const door = cb.world.doors.find((d) => d.id === o.ref);
        if (recent || (door && door.barricade > 0)) continue;
        const two = eff.filter((m) => m.zone === z).slice(0, 2); const p = cb.world.randomPointInZone(n, cb.rng);
        if (p) for (const m of two) m.data.cb.order = { type: 'push', x: p[0], z: p[1], zone: n };
        sq.holdT = now - 4; return;
      }
    }
  }
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export { WEAPONS, getWeapon, lookWeapon };
