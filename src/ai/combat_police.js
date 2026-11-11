// «Участок» — ИИ милиции (агент D): боец с характером и самостоятельный командир группы обороны.
// Командир получает от игрока только доктрину и сам: расставляет по укрытиям, раздаёт секторы, перевязывает,
// гоняет за патронами, тушит пожар, запускает генератор, отходит, контратакует и планирует штурм помещения.
import { Fighter } from './combat_fighter.js';
import { normalizeDoctrine, zoneLabel, PROTECT_ZONES } from './doctrine.js';
import { threatsFor, planPositions, fallbackZoneFor, safestZone } from './combat_tactics.js';
import { getWeapon, dangerScore, isFirearm, GAS_ITEM_IDS } from './weapons.js';

const AMBUSH_R = 7;

export class PoliceBrain extends Fighter {
  think() {
    const a = this.a, c = a.data.cb, cb = this.cb, now = cb.t;
    if (!c.aware) { if (c.awareAt && now >= c.awareAt) c.aware = true; else { c.target = null; return; } }
    // граната рядом
    const g = cb.fx.grenadeNear(a.x, a.z, 5.5);
    if (g) {
      if (!(c.evadeT > now)) { cb.barks.say(a, 'grenade', { force: true }); c.evadeT = now + 3; }
      const left = g.fuse - g.age;
      if (left > 1.1) { const dx = a.x - g.tx, dz = a.z - g.tz, l = Math.hypot(dx, dz) || 1; const p = cb.nav.nearestWalkable(a.x + dx / l * 4.5, a.z + dz / l * 4.5, 4); if (p) { this.goTo(p[0], p[1], true); c.coverLow = false; return; } }
      c.proneT = now + 1.8; this.halt(); return;
    }
    if (c.inFire) { const f = c.inFire; const dx = a.x - f.x, dz = a.z - f.z, l = Math.hypot(dx, dz) || 1; const p = cb.nav.nearestWalkable(f.x + dx / l * (f.r + 1.2), f.z + dz / l * (f.r + 1.2), 4); if (p) this.goTo(p[0], p[1], true); return; }
    this.updatePanic();
    const grp = cb.groupOf(a);
    if (c.panic) { this.panicBehavior(); return; }
    c.target = this.pickTarget(grp);
    a.data.strafe = !!c.target;
    // горячая голова: в атаку без приказа
    if (c.charge && now > c.charge.until) c.charge = null;
    if (!c.charge && c.hothead && c.target && c.stress < 0.6 && !(grp && (grp.mode === 'fallback' || grp.retake)) && cb.rng.chance(0.025 * (0.5 + c.aggression))) {
      c.charge = { until: now + 6 }; cb.barks.say(a, 'charge', { force: true }); cb.chron(`${cb.nameOf(a)} без приказа бросается вперёд.`);
    }
    if (c.charge && c.target) { const t = c.target; const d = a.distTo(t); if (d > 3.5) this.goTo(t.x + (a.x - t.x) / d * 3, t.z + (a.z - t.z) / d * 3, true); c.coverLow = false; return; }
    // трус уходит сам
    if (c.coward && grp && !c.deserted && grp.lossFrac >= grp.doc.fallbackAt * 0.5 && c.visible.length && cb.rng.chance(0.2)) {
      c.deserted = true; c.panic = true; c.panicMode = 'flee'; c.panicT = now; cb.barks.say(a, 'desert', { force: true }); cb.chron(`${cb.nameOf(a)} бросает пост.`); return;
    }
    if (c.act) { this.doAct(); return; }
    const o = c.order;
    if (o && o.delayUntil && now < o.delayUntil) { this.holdHere(); return; }
    switch (o ? o.type : null) {
      case 'post': case 'move': this.holdPost(o); break;
      case 'push': case 'enter': this.push(o); break;
      case 'aid': this.orderAid(o); break;
      case 'resupply': this.orderResupply(o); break;
      case 'gas': this.orderGas(o); break;
      case 'breach': this.orderBreach(o); break;
      case 'extinguish': this.orderExtinguish(o); break;
      case 'gen': this.orderGen(o); break;
      case 'cuff': this.orderCuff(o); break;
      case 'barricade': this.orderBarricade(o); break;
      case 'follow': this.orderFollow(o); break;
      default: this.loner();
    }
  }
  poseTick(dt) { const a = this.a, c = a.data.cb; if (c.proneT > this.cb.t) { a.pose = 'lie'; a.data.ducked = false; return; } super.poseTick(dt); if (c.panic && !a.moving) { a.pose = 'crouch'; a.data.ducked = true; a.data.action = 'cower'; } }
  onAlert(e) { const a = this.a; this.cb.alarm('police', a, e); }

  // ——— выбор цели по доктрине ———
  allowed(e, d, grp) {
    const a = this.a, c = a.data.cb, cb = this.cb, ec = e.data && e.data.cb;
    if (ec && (ec.surrendered || ec.captive)) return false;
    const roe = grp ? grp.doc.roe : 'free';
    let ok = roe === 'free';
    if (roe === 'return') ok = (ec && ec.aggressed) || cb.isIndoor(e.zone) || cb.t - c.underFireT < 5;
    if (roe === 'hold_fire') { ok = (grp && grp.fireOpen) || d < AMBUSH_R || cb.t - c.underFireT < 3 || (ec && ec.target === a); if (ok && grp && !grp.fireOpen) grp.openFire(a); }
    if (!ok && (c.hothead || c.discipline < 0.3) && cb.rng.chance(0.015 + (c.hothead ? 0.02 : 0))) {
      ok = true; if (grp && roe === 'hold_fire') grp.openFire(a, true);
      cb.chron(`${cb.nameOf(a)} не выдерживает и открывает огонь без команды.`);
    }
    return ok;
  }
  pickTarget(grp) {
    const a = this.a, c = a.data.cb, cb = this.cb;
    const pri = grp ? grp.doc.priority : 'nearest';
    const protectZone = grp ? PROTECT_ZONES[grp.doc.protect] : null;
    let best = null, bs = -Infinity;
    for (const e of c.visible) {
      if (!e.alive) continue;
      const d = a.distTo(e); if (!this.allowed(e, d, grp)) continue;
      const ec = e.data.cb || {};
      let s;
      if (pri === 'armed') s = dangerScore(ec.weaponId, ec) * 3 - d * 0.3;
      else if (pri === 'leader') s = (ec.isLeader ? 12 : 0) + dangerScore(ec.weaponId, ec) - d * 0.3;
      else s = -d + dangerScore(ec.weaponId, ec) * 0.3;
      if (ec.weapon && ec.weapon.kind === 'melee' && d < 4) s += 4;
      if (protectZone && (ec.role === 'liberator' && protectZone === 'ivs' || e.zone === protectZone)) s += 6;
      if (e.downed) s -= 25;
      if (e === c.target) s += 1.5;
      if (s > bs) { bs = s; best = e; }
    }
    return best;
  }

  // ——— паника ———
  updatePanic() {
    const a = this.a, c = a.data.cb, cb = this.cb, now = cb.t;
    const brk = 0.5 + c.courage * 0.45 + (c.pedant ? 0.15 : 0);
    if (!c.panic && c.stress > brk && cb.rng.chance(0.2)) {
      c.panic = true; c.panicT = now; c.panicMode = (c.rookie && cb.rng.chance(0.6)) || cb.rng.chance(0.3) ? 'freeze' : 'flee';
      cb.barks.say(a, c.panicMode === 'freeze' ? 'freeze' : 'panic', { force: true });
      cb.chron(`${cb.nameOf(a)} ${c.panicMode === 'freeze' ? 'впадает в ступор' : 'в панике бежит'}.`);
      c.panicDest = null;
    } else if (c.panic && !c.deserted && c.stress < brk - 0.22 && now - c.underFireT > 5 && now - c.panicT > 8) {
      c.panic = false; a.data.action = null; cb.barks.say(a, 'recover', { force: true }); cb.chron(`${cb.nameOf(a)} приходит в себя.`);
    } else if (c.panic && c.deserted && now - c.panicT > 40 && c.stress < 0.3) { c.panic = false; c.deserted = false; a.data.action = null; }
  }
  panicBehavior() {
    const a = this.a, c = a.data.cb, cb = this.cb;
    const close = c.visible.find((e) => a.distTo(e) < 3.5);
    c.target = close || null; c.coverLow = true;
    if (c.panicMode === 'flee') {
      if (!c.panicDest) { const z = safestZone(cb, 'police', a.x, a.z); const p = z ? cb.world.randomPointInZone(z, cb.rng) : null; c.panicDest = p ? { x: p[0], z: p[1] } : { x: a.x, z: a.z }; }
      if (!this.near(c.panicDest.x, c.panicDest.z, 0.8)) this.goTo(c.panicDest.x, c.panicDest.z, true);
    } else this.halt();
    if (!a.moving) a.playAnim('cower', 0.6);
  }

  // ——— исполнение приказов ———
  holdHere() { const c = this.a.data.cb; if (this.a.moving) this.halt(); c.coverLow = c.coverLowHere || false; }
  holdPost(o) {
    const a = this.a, c = a.data.cb, cb = this.cb;
    if (!this.near(o.x, o.z, 0.45)) { this.goTo(o.x, o.z, !!o.run || c.visible.length > 0 || cb.t - c.underFireT < 4); c.coverLow = false; }
    else { if (a.moving) this.halt(); c.coverLow = !!o.low; c.coverLowHere = !!o.low; c.lookAt = o.look || null; }
  }
  push(o) {
    const a = this.a, c = a.data.cb;
    if (!this.near(o.x, o.z, 0.7)) { this.goTo(o.x, o.z, true); c.coverLow = false; }
    else { if (a.moving) this.halt(); c.coverLow = !!o.low; o.done = true; c.lookAt = o.look || null; }
  }
  startAct(kind, dur, fn, anim) { const a = this.a, c = a.data.cb; this.halt(); c.act = { kind, fn, anim }; c.actT = dur; a.data.action = kind; }
  doAct() {
    const a = this.a, c = a.data.cb, cb = this.cb; const act = c.act;
    const grp = cb.groupOf(a);
    if (c.visible.some((e) => a.distTo(e) < 7 && !e.downed && !(e.data.cb && e.data.cb.surrendered)) && !(act.kind === 'bandage' && grp && grp.doc.aid === 'always')) { c.act = null; c.actT = 0; a.data.action = null; return; }
    c.actT -= cb.t - (c.lastActT || cb.t); c.lastActT = cb.t;
    if (act.anim) a.playAnim(act.anim, 0.5);
    a.pose = act.kind === 'bandage' || act.kind === 'cuff' ? 'crouch' : 'stand';
    if (c.actT <= 0) { c.act = null; c.actT = 0; a.data.action = null; c.lastActT = 0; try { act.fn(); } catch (e) { console.error(e); } }
  }
  orderAid(o) {
    const a = this.a, c = a.data.cb, cb = this.cb; const t = cb.world.actorById(o.targetId);
    if (!t || !t.alive || !t.data.cb || t.data.cb.stabilized) { c.order = null; return; }
    if (a.distTo(t) > 1.0) { this.goTo(t.x, t.z, true, 0.7); return; }
    cb.barks.say(a, 'aid', { chance: 0.7 });
    this.startAct('bandage', 6 * (c.kind ? 0.8 : 1), () => { const tc = t.data.cb; if (t.alive && tc) { tc.bleed = 0; tc.stabilized = true; cb.chron(`${cb.nameOf(a)} перевязывает ${cb.nameOf(t)}.`); } c.order = null; }, 'cuff');
  }
  orderResupply() {
    const a = this.a, c = a.data.cb, cb = this.cb; const p = cb.world.points.armory_counter;
    if (cb.ownerFor('armory', 'police') !== 'own') { cb.barks.say(a, 'armory_lost', { chance: 0.5 }); c.order = null; return; }
    if (!this.near(p.x, p.z, 0.7)) { this.goTo(p.x, p.z, true); return; }
    this.startAct('loot', 5, () => { const n = cb.resupply(a); if (n) cb.chron(`${cb.nameOf(a)} получает в оружейке ${n} патр.`); c.order = null; c.noAmmo = false; }, 'write');
  }
  orderGas(o) {
    const a = this.a, c = a.data.cb, cb = this.cb;
    const d = Math.hypot(o.x - a.x, o.z - a.z);
    const from = o.from || o;
    if (d > 13 || !cb.nav.lof(a.x, a.z, o.x, o.z)) { if (!this.near(from.x, from.z, 0.6)) { this.goTo(from.x, from.z, true); return; } }
    if (!o.thrown) { o.thrown = true; cb.barks.say(a, 'gas', { force: true }); cb.fx.throwItem(a, 'cheremukha', o.x, o.z); cb.chron(`${cb.nameOf(a)} бросает «Черёмуху».`); if (o.onThrown) o.onThrown(); c.order = null; }
  }
  orderBreach(o) {
    const a = this.a, c = a.data.cb, cb = this.cb; const door = cb.world.doors.find((d) => d.id === o.doorId);
    if (!door || door.barricade <= 0) { c.order = null; return; }
    if (!this.near(o.x, o.z, 0.7)) { this.goTo(o.x, o.z, true, 0.3); return; }
    a.faceTo((door.rect[0] + door.rect[2]) / 2, (door.rect[1] + door.rect[3]) / 2);
    const w = c.weapon;
    if (w.kind === 'shotgun' && c.mag > 0) { this.startAct('breach', 1.3, () => { cb.ballistics.fire(a, w, a.x, 1.1, a.z, (door.rect[0] + door.rect[2]) / 2, 1.0, (door.rect[1] + door.rect[3]) / 2, 0.01, { by: a.id }); c.mag--; cb.spentRound(a); cb.hurtBarricade(door.id, w.breach); }); }
    else this.startAct('breach', 1.0, () => cb.hurtBarricade(door.id, 9 * (c.strength || 1)), 'punch');
  }
  orderExtinguish(o) {
    const a = this.a, c = a.data.cb, cb = this.cb; const f = cb.fx.fires.find((x) => x.id === o.fireId);
    const ex = cb.fx.extinguisher;
    if (!f || ex.charges <= 0) { c.order = null; if (ex.holder === a.id && ex.charges <= 0) ex.holder = null; return; }
    if (ex.holder !== a.id) {
      if (ex.holder && cb.world.actorById(ex.holder)?.alive) { c.order = null; return; }
      const p = { x: 0.8, z: 12 };
      if (!this.near(p.x, p.z, 0.8)) { this.goTo(p.x, p.z, true); return; }
      this.startAct('extinguish', 1.5, () => { ex.holder = a.id; }); return;
    }
    if (Math.hypot(f.x - a.x, f.z - a.z) > f.r + 1.3) { const dx = a.x - f.x, dz = a.z - f.z, l = Math.hypot(dx, dz) || 1; this.goTo(f.x + dx / l * (f.r + 0.9), f.z + dz / l * (f.r + 0.9), true); return; }
    cb.barks.say(a, 'extinguish', { chance: 0.6 });
    a.faceTo(f.x, f.z);
    this.startAct('extinguish', 3, () => { cb.fx.extinguish(f); ex.charges--; cb.chron(`${cb.nameOf(a)} тушит огонь.`); c.order = null; }, 'shoot');
  }
  orderGen() {
    const a = this.a, c = a.data.cb, cb = this.cb; const p = cb.fuseBroken ? cb.world.points.fusebox : cb.world.points.generator;
    if (cb.power || cb.ownerFor('generator', 'police') !== 'own') { c.order = null; return; }
    if (!this.near(p.x, p.z, 0.7)) { this.goTo(p.x, p.z, true); return; }
    cb.barks.say(a, 'gen_fix', { chance: 0.8 });
    this.startAct('repair', cb.fuseBroken ? 14 : 7, () => { cb.restorePower(a); c.order = null; }, 'write');
  }
  orderCuff(o) {
    const a = this.a, c = a.data.cb, cb = this.cb; const t = cb.world.actorById(o.targetId);
    if (!t || !t.alive || !t.data.cb || !(t.data.cb.surrendered || t.downed) || t.data.cb.captive) { c.order = null; return; }
    if (a.distTo(t) > 1.1) { this.goTo(t.x, t.z, false, 0.8); return; }
    cb.barks.say(a, 'cuff', { chance: 0.8 });
    this.startAct('cuff', 3, () => { cb.capture(t, a); c.order = null; }, 'cuff');
  }
  orderBarricade(o) {
    const a = this.a, c = a.data.cb, cb = this.cb; const door = cb.world.doors.find((d) => d.id === o.doorId);
    if (!door || door.barricade > 0) { c.order = null; return; }
    if (!this.near(o.x, o.z, 0.7)) { this.goTo(o.x, o.z, false); return; }
    this.startAct('barricade', 12, () => { cb.placeBarricadeNow(o.doorId); cb.chron(`${cb.nameOf(a)} заваливает ${door.name.toLowerCase()} мебелью.`); c.order = null; }, 'punch');
  }
  orderFollow() {
    const a = this.a, c = a.data.cb, cb = this.cb; const p = cb.player; if (!p || !p.alive) { c.order = null; return; }
    const d = Math.hypot(p.x - a.x, p.z - a.z);
    if (d > 2.8) { const ang = Math.atan2(a.x - p.x, a.z - p.z); const q = cb.nav.nearestWalkable(p.x + Math.sin(ang) * 1.6, p.z + Math.cos(ang) * 1.6, 3); if (q) this.goTo(q[0], q[1], d > 6); }
    else if (a.moving && d < 2) this.halt();
    c.coverLow = false; c.wantCrouch = !!(cb.player.pose === 'crouch');
    if (cb.rng.chance(0.01)) cb.barks.say(a, 'bodyguard', { chance: 0.3 });
  }
  loner() {
    const a = this.a, c = a.data.cb, cb = this.cb;
    if (c.target || c.visible.length) {
      const e = c.target || c.visible[0];
      if (!c.lonerCover || cb.t - c.lonerCoverT > 4) { c.lonerCover = cb.quickCover(a, e.x, e.z, 6); c.lonerCoverT = cb.t; }
      if (c.lonerCover) this.holdPost({ x: c.lonerCover.x, z: c.lonerCover.z, low: c.lonerCover.low, run: true });
      return;
    }
    if (!cb.joinNearestGroup(a)) {
      if (!cb.isIndoor(a.zone)) { const p = cb.world.points.post_front_lobby; this.goTo(p.x, p.z, true); }
      else if (!c.lonerCover) { c.lonerCover = cb.quickCover(a, cb.world.points.front_door_in.x, cb.world.points.front_door_in.z, 5); if (c.lonerCover) this.holdPost({ x: c.lonerCover.x, z: c.lonerCover.z, low: c.lonerCover.low }); }
    }
  }
}

// ———————————————————————— командир группы ————————————————————————
export class GroupCommander {
  constructor(cb, groupId, opts = {}) {
    this.cb = cb; this.id = groupId; this.runtime = opts.runtime || null; // OMON — без записи в state
    this.mode = null; this.zone = null; this.initial = 0; this.temps = new Set(); this.assign = new Map();
    this.nextPlan = 0; this.fireOpen = false; this.retake = null; this.fellBack = 0; this.sig = ''; this.lossFrac = 0;
    this.leaderAid = null; this.lastLeader = null; this.pushUntil = 0; this.announced = false; this.pushStartLoss = 0;
    this._doc = null; this._docSrc = '';
  }
  get g() { return this.runtime || this.cb.state.defense.groups.find((x) => x.id === this.id) || null; }
  get doc() { const g = this.g; const src = g ? JSON.stringify(g.doctrine || {}) : ''; if (src !== this._docSrc) { this._docSrc = src; this._doc = normalizeDoctrine(g ? g.doctrine : {}); } return this._doc; }
  members() {
    const cb = this.cb, g = this.g; if (!g) return [];
    const out = [];
    for (const id of g.memberIds || []) { const a = cb.actorForOfficer(id); if (a && a.alive && a.data.cb && a.data.cb.side === 'police') out.push(a); }
    if (g.actorIds) for (const id of g.actorIds) { const a = cb.world.actorById(id); if (a && a.alive && a.data.cb) out.push(a); }
    for (const id of this.temps) { const a = cb.world.actorById(id); if (a && a.alive && !out.includes(a)) out.push(a); else if (!a || !a.alive) this.temps.delete(id); }
    return out;
  }
  effective(a) { const c = a.data.cb; return a.alive && !c.downed && !c.panic && !c.captive; }
  openFire(by, early = false) {
    if (this.fireOpen) return; this.fireOpen = true;
    const L = this.leader; if (L && L.alive) this.cb.barks.say(L, early ? 'fire_open' : 'fire_open', { force: true });
    this.cb.chron(`Группа «${this.g.name}» открывает огонь${early ? ' раньше времени' : ''}.`);
  }
  update(dt) {
    const cb = this.cb; if (cb.t < this.nextPlan) return;
    const L = this.leader; const tq = L ? L.data.cb.tactics : 0.4;
    this.nextPlan = cb.t + 1.7 - tq * 0.8 + cb.rng.next() * 0.3;
    try { this.plan(); } catch (e) { console.error('[group]', e); }
  }
  pickLeader(eff) {
    const g = this.g, cb = this.cb;
    let L = eff.find((a) => a.data.cb.officerId === g.leaderId) || null;
    if (!L && eff.length) L = eff.slice().sort((x, y) => (y.data.cb.tactics + y.data.cb.leadership) - (x.data.cb.tactics + x.data.cb.leadership))[0];
    if (L !== this.lastLeader) {
      if (this.lastLeader && L && this.announced) { cb.barks.say(L, 'take_lead', { force: true }); cb.chron(`${cb.nameOf(L)} принимает командование группой «${g.name}».`); }
      for (const m of eff) m.data.cb.isLeader = m === L;
      this.lastLeader = L;
    }
    this.leader = L; return L;
  }
  underContact(ms) { const now = this.cb.t; return ms.some((m) => m.data.cb.visible.length > 0 || now - m.data.cb.underFireT < 3); }

  plan() {
    const cb = this.cb, g = this.g; if (!g) return;
    const ms = this.members(); if (!ms.length) { this.leader = null; return; }
    const eff = ms.filter((m) => this.effective(m));
    if (!this.initial || ms.length > this.initial) this.initial = ms.length;
    this.lossFrac = 1 - eff.length / Math.max(1, this.initial);
    const L = this.pickLeader(eff);
    const doc = this.doc;
    const aware = ms.some((m) => m.data.cb.aware);
    if (!aware) return;
    if (L) { const lc = L.data.cb; for (const m of eff) if (m !== L && Math.hypot(m.x - L.x, m.z - L.z) < 9) m.data.cb.stress = Math.max(0, m.data.cb.stress - 0.012 * (lc.leadership || 0.3) * 2); }
    if (!this.announced && L) { this.announced = true; cb.barks.say(L, doc.roe === 'hold_fire' ? 'hold_fire' : 'pos', { force: true }); }
    // режим
    if (doc.hold === 'retake' && !this.retakeDone()) return this.planRetake(eff, ms, L);
    if (!this.zone) this.zone = doc.hold === 'retake' ? g.zoneId : g.zoneId;
    if (this.mode === 'push') { if (this.planPush(eff, L)) return; }
    // отход
    const threshold = Math.min(0.92, doc.fallbackAt + this.fellBack * 0.3);
    const zoneLost = cb.ownerFor(this.zone, 'police') === 'enemy' && !eff.some((m) => m.zone === this.zone);
    const protectZ = PROTECT_ZONES[doc.protect];
    if ((doc.hold === 'fallback' && this.lossFrac >= threshold && this.fellBack < 2 && this.zone !== protectZ) || (zoneLost && this.fellBack < 3)) {
      const fz = (this.fellBack === 0 && doc.fallbackZone && cb.ownerFor(doc.fallbackZone, 'police') !== 'enemy') ? doc.fallbackZone : fallbackZoneFor(cb, this.zone, 'police', protectZ);
      if (fz && fz !== this.zone) return this.fallback(fz, eff, L);
    }
    if (doc.hold === 'counter' && this.counterTrigger(eff, L)) return;
    this.planHold(eff, ms, L, doc);
  }
  retakeDone() {
    const cb = this.cb, z = this.g.zoneId;
    if (cb.ownerFor(z, 'police') === 'own' && ![...cb.intel.police.values()].some((k) => k.zone === z && cb.t - k.t < 5)) {
      if (this.retake && !this.retake.done) { this.retake.done = true; this.zone = z; this.assign.clear(); this.sig = ''; const L = this.leader; if (L) cb.barks.say(L, 'took', { force: true, vars: { Z: cap(zoneLabel(z, 'short')) }, subj: null }); cb.chron(`Группа «${this.g.name}» отбила ${zoneLabel(z, 'short')}.`); }
      this.zone = z; return true;
    }
    return false;
  }

  /** Обычная оборона: спецзадачи + расстановка по укрытиям */
  planHold(eff, ms, L, doc) {
    const cb = this.cb, now = cb.t; const zone = this.zone;
    let pool = eff.filter((m) => !m.data.cb.charge && !m.data.cb.act);
    const busy = (m) => { pool = pool.filter((x) => x !== m); };
    const contact = this.underContact(eff);
    // уже занятые спецзадачами
    for (const m of eff) { const o = m.data.cb.order; if (o && ['aid', 'resupply', 'gas', 'breach', 'extinguish', 'gen', 'cuff', 'barricade'].includes(o.type)) busy(m); }
    // охрана командира
    if (doc.protect === 'commander' && cb.player && cb.player.alive) {
      const n = Math.min(pool.length, eff.length >= 4 ? 2 : 1);
      const guards = pool.slice().sort((a, b) => Math.hypot(a.x - cb.player.x, a.z - cb.player.z) - Math.hypot(b.x - cb.player.x, b.z - cb.player.z)).slice(0, n);
      for (const m of guards) { if (!m.data.cb.order || m.data.cb.order.type !== 'follow') m.data.cb.order = { type: 'follow' }; busy(m); }
    }
    // раненые
    if (doc.aid !== 'never' && (doc.aid === 'always' || !contact)) {
      for (const d of ms.filter((m) => m.alive && m.data.cb.downed && !m.data.cb.stabilized)) {
        if (eff.some((m) => m.data.cb.order && m.data.cb.order.type === 'aid' && m.data.cb.order.targetId === d.id)) continue;
        const helper = pool.filter((m) => m.data.cb.courage > 0.3 || m.data.cb.kind).sort((a, b) => a.distTo(d) - b.distTo(d))[0];
        if (helper && helper.distTo(d) < 16) { helper.data.cb.order = { type: 'aid', targetId: d.id }; busy(helper); }
      }
    }
    if (!contact) {
      // патроны
      const low = pool.find((m) => { const c = m.data.cb; return isFirearm(c.weapon) && c.mag + c.reserve < c.weapon.mag * 1.2; });
      if (low && cb.ownerFor('armory', 'police') === 'own' && cb.ammoStock(low.data.cb.weapon.ammoType) > 0 && !eff.some((m) => m.data.cb.order && m.data.cb.order.type === 'resupply')) { cb.barks.say(low, 'resupply', { chance: 0.7 }); low.data.cb.order = { type: 'resupply' }; busy(low); }
      // пожар
      const fire = cb.fx.firesInZone(zone)[0];
      if (fire && pool.length > 1 && cb.fx.extinguisher.charges > 0 && !eff.some((m) => m.data.cb.order && m.data.cb.order.type === 'extinguish')) { const m = pool.sort((a, b) => a.distTo(fire) - b.distTo(fire))[0]; m.data.cb.order = { type: 'extinguish', fireId: fire.id }; busy(m); }
      // свет
      if (!cb.power && cb.ownerFor('generator', 'police') === 'own' && (zone === 'generator' || doc.protect === 'generator' || cb.nearestGroupTo('generator') === this) && pool.length > 1 && !cb.anyOrder('gen')) { const m = pool.sort((a, b) => Math.hypot(a.x - 29.8, a.z - 5.6) - Math.hypot(b.x - 29.8, b.z - 5.6))[0]; m.data.cb.order = { type: 'gen' }; busy(m); }
      // сдавшиеся
      const sur = cb.surrenderedNear(zone);
      if (sur && pool.length > 1 && !cb.anyOrder('cuff', sur.id)) { const m = pool.sort((a, b) => a.distTo(sur) - b.distTo(sur))[0]; m.data.cb.order = { type: 'cuff', targetId: sur.id }; busy(m); }
      // баррикады при осаде
      if (doc.barricade && cb.alert === 'siege' && !cb.state.attack) {
        for (const o of cb.nav.zoneDoors(zone)) {
          if (!o.exterior || cb.world.doors.find((d) => d.id === o.ref).barricade > 0 || cb.anyOrder('barricade', o.ref) || pool.length < 2) continue;
          const m = pool[0]; const p = cb.nav.openingSide(o, zone, 0.9); m.data.cb.order = { type: 'barricade', doorId: o.ref, x: p.x, z: p.z }; busy(m);
        }
      }
    }
    // охрана объекта в другом помещении
    const protectZ = PROTECT_ZONES[doc.protect];
    const groups = [];
    if (protectZ && protectZ !== zone && pool.length >= 2 && cb.ownerFor(protectZ, 'police') !== 'enemy') {
      const k = Math.max(1, Math.round(pool.length / 3));
      const sorted = pool.slice().sort((a, b) => (a.data.cb.pedant ? -1 : 0) - (b.data.cb.pedant ? -1 : 0) || Math.hypot(a.x - cb.world.zoneCenter(protectZ)[0], a.z - cb.world.zoneCenter(protectZ)[1]) - Math.hypot(b.x - cb.world.zoneCenter(protectZ)[0], b.z - cb.world.zoneCenter(protectZ)[1]));
      groups.push({ zone: protectZ, members: sorted.slice(0, k) }); pool = sorted.slice(k);
    }
    groups.push({ zone, members: pool });
    for (const gr of groups) this.placeIn(gr.zone, gr.members, doc, L);
  }
  placeIn(zone, members, doc, L) {
    const cb = this.cb; if (!members.length) return;
    const threats = threatsFor(cb, zone, 'police', { watch: doc.watch });
    const sig = zone + ':' + members.map((m) => m.id).join(',') + ':' + threats.map((t) => (t.o ? t.o.id : 'p') + Math.round(t.w * 3)).join(',');
    const needs = members.some((m) => { const o = m.data.cb.order; return !o || o.type !== 'post' || o.zone !== zone; });
    if (sig === this.sig + zone && !needs) return;
    this.sig = sig.slice(0, -zone.length) + zone;
    const current = new Map(); for (const m of members) if (m.data.cb.order && m.data.cb.order.spot) current.set(m.id, m.data.cb.order.spot);
    const res = planPositions(cb, zone, threats, members, { ambush: doc.roe === 'hold_fire' && !this.fireOpen, posts: doc.posts, current, noise: (1 - (L ? L.data.cb.tactics : 0.4)) * 1.2 });
    for (const m of members) {
      const p = res.get(m.id); if (!p) continue;
      const prev = m.data.cb.order;
      m.data.cb.order = { type: 'post', x: p.x, z: p.z, low: p.low, spot: p.spot, zone, look: p.threat ? { x: p.threat.x, z: p.threat.z } : null, run: prev && prev.run };
      if (L && L !== m && (!prev || prev.spot !== p.spot) && cb.rng.chance(0.15)) cb.barks.say(L, 'sector', { subj: m, chance: 0.8 });
    }
  }
  fallback(fz, eff, L) {
    const cb = this.cb;
    const from = this.zone; this.zone = fz; this.fellBack++; this.sig = ''; this.mode = 'fallback'; this.modeT = cb.t;
    if (L) cb.barks.say(L, 'fallback', { force: true, vars: { to: zoneLabel(fz, 'to') } });
    cb.chron(`Группа «${this.g.name}» отходит из «${zoneLabel(from, 'short')}» ${zoneLabel(fz, 'to')}.`);
    const threats = threatsFor(cb, fz, 'police', {});
    const res = planPositions(cb, fz, threats, eff, { posts: [], noise: 0.4 });
    eff.forEach((m, i) => { const p = res.get(m.id); if (!p) return; m.data.cb.order = { type: 'post', x: p.x, z: p.z, low: p.low, spot: p.spot, zone: fz, look: p.threat ? { x: p.threat.x, z: p.threat.z } : null, run: true, delayUntil: i % 2 ? cb.t + 2.2 : 0 }; });
    this.mode = null;
  }
  counterTrigger(eff, L) {
    const cb = this.cb; if (!L || eff.length < 2) return false;
    const lc = L.data.cb; if (lc.aggression < 0.3 && !lc.hothead) return false;
    const near = [...cb.intel.police.values()].filter((k) => cb.t - k.t < 4 && k.a && k.a.alive && !k.a.downed && (k.zone === this.zone || cb.adjacent(k.zone, this.zone)));
    if (!near.length) return false;
    const weak = eff.length >= 1.4 * near.length || near.some((k) => { const sq = cb.squadOf(k.a); return sq && (sq.phase === 'retreat' || sq.phase === 'rout' || sq.morale < 0.35); });
    if (!weak) return false;
    this.mode = 'push'; this.pushUntil = cb.t + 16; this.pushStartLoss = this.lossFrac; this.sig = '';
    cb.barks.say(L, 'counter', { force: true }); cb.chron(`Группа «${this.g.name}» контратакует.`);
    this.planPush(eff, L); return true;
  }
  planPush(eff, L) {
    const cb = this.cb;
    const near = [...cb.intel.police.values()].filter((k) => cb.t - k.t < 6 && k.a && k.a.alive && !k.a.downed && cb.inPursuitArea(k.x, k.z));
    if (!near.length || cb.t > this.pushUntil || this.lossFrac - this.pushStartLoss > 0.2) { this.mode = null; this.sig = ''; return false; }
    let cx = 0, cz = 0; for (const k of near) { cx += k.x; cz += k.z; } cx /= near.length; cz /= near.length;
    eff.forEach((m, i) => {
      const ang = (i / Math.max(1, eff.length)) * Math.PI * 2; const r = 3 + (i % 2);
      const p = cb.nav.nearestWalkable(cx + Math.sin(ang) * r, cz + Math.cos(ang) * r, 4) || [m.x, m.z];
      m.data.cb.order = { type: 'push', x: p[0], z: p[1], look: { x: cx, z: cz } };
    });
    return true;
  }

  // ——— штурм помещения ———
  planRetake(eff, ms, L) {
    const cb = this.cb, now = cb.t, doc = this.doc;
    const target = this.g.zoneId;
    let R = this.retake;
    if (!R || R.done || R.target !== target) R = this.retake = { target, phase: 'choose', attempts: 0, t: now, startLoss: this.lossFrac, givenUp: false };
    if (R.givenUp) { if (now - R.t > 90) { R.givenUp = false; R.phase = 'choose'; R.attempts = 0; } else return this.planHold(eff, ms, L, doc); }
    if (eff.length < 2 && R.phase !== 'withdraw') { this.zone = this.zone || cb.nearestOwnZone('police', L || eff[0] || ms[0]); return this.planHold(eff, ms, L, doc); }
    const op = this;
    const zoneFor = () => R.via || target;
    if (R.phase === 'choose') {
      // ближайшая вражеская зона по пути к цели
      const from = (L || eff[0]).zone;
      const route = cb.nav.zoneRoute(from, target) || [from, target];
      let via = target; for (const z of route) if (cb.ownerFor(z, 'police') !== 'own') { via = z; break; }
      R.via = via;
      const doors = cb.nav.zoneDoors(via).map((o) => ({ o, stage: cb.nav.otherZone(o, via) })).filter((d) => d.stage && cb.ownerFor(d.stage, 'police') !== 'enemy');
      if (!doors.length) { R.via = null; R.phase = 'choose'; this.zone = from; return this.planHold(eff, ms, L, doc); }
      let best = null, bs = -Infinity;
      const enemies = [...cb.intel.police.values()].filter((k) => k.zone === via && now - k.t < 30);
      const cxL = eff.reduce((s, m) => s + m.x, 0) / eff.length, czL = eff.reduce((s, m) => s + m.z, 0) / eff.length;
      for (const d of doors) {
        let s = -Math.hypot(d.o.x - cxL, d.o.z - czL) / 10 + (cb.isIndoor(d.stage) ? 0.6 : 0);
        for (const k of enemies) if (Math.hypot(k.x - d.o.x, k.z - d.o.z) < 6) s -= 1.2;
        if (cb.world.doors.find((x) => x.id === d.o.ref)?.barricade > 0) s -= 1.5;
        if (R.lastDoor === d.o.ref) s -= 0.8 * R.attempts; // не лезть дважды туда же
        if (s > bs) { bs = s; best = d; }
      }
      R.door = best.o; R.stage = best.stage; R.phase = 'stage'; R.t = now; R.lastDoor = best.o.ref; R.startLoss = this.lossFrac;
      this.zone = R.stage; this.sig = '';
      if (L) cb.barks.say(L, 'stage', { force: true });
      cb.chron(`Группа «${this.g.name}» готовит штурм: ${zoneLabel(via, 'short')} через «${R.door.name.toLowerCase()}», рубеж — ${zoneLabel(R.stage, 'short')}.`);
    }
    const via = zoneFor(); const D = R.door; if (!D) { R.phase = 'choose'; return; }
    const doorObj = D.ref ? cb.world.doors.find((x) => x.id === D.ref) : null;
    const lostSince = this.lossFrac - R.startLoss;
    const abortAt = Math.max(0.25, Math.min(0.6, doc.fallbackAt + 0.1));
    if ((R.phase === 'entry' || R.phase === 'clear') && (lostSince >= abortAt || eff.length < 2)) {
      R.phase = 'withdraw'; R.t = now; R.attempts++;
      if (L) cb.barks.say(L, 'abort', { force: true });
      cb.chron(`Штурм «${zoneLabel(via, 'short')}» захлебнулся. Группа «${this.g.name}» отходит (попытка ${R.attempts}).`);
    }
    if (cb.ownerFor(via, 'police') === 'own' && via !== target && R.phase !== 'withdraw') { R.phase = 'choose'; return; }
    // разметка позиций у двери
    const stackSpots = () => cb.nav.spots(R.stage).filter((s) => Math.hypot(s.x - D.x, s.z - D.z) < 4.2 && Math.hypot(s.x - D.x, s.z - D.z) > 0.9 && !cb.nav.lof(s.x, s.z, ...cb.world.zoneCenter(via)) && cb.nav.walkable(s.x, s.z));
    const assignStack = (list, run) => {
      const spots = stackSpots(); const res = planPositions(cb, R.stage, [{ x: D.x, z: D.z, w: 1, o: D, fromZone: via }], list, { ideal: 2.5, noise: 0.2 });
      list.forEach((m, i) => { const s = spots[i % Math.max(1, spots.length)]; const p = s || res.get(m.id); if (p) m.data.cb.order = { type: 'post', x: p.x, z: p.z, low: !!p.low, zone: R.stage, look: { x: D.x, z: D.z }, run }; });
    };
    const overwatchN = eff.length >= 4 ? 2 : 1;
    if (R.phase === 'stage') {
      const ow = eff.slice().sort((a, b) => (b.data.cb.marksman ? 1 : 0) - (a.data.cb.marksman ? 1 : 0) || b.data.cb.weapon.danger - a.data.cb.weapon.danger).slice(0, overwatchN);
      R.overwatch = new Set(ow.map((m) => m.id));
      const owPos = planPositions(cb, R.stage, [{ x: D.x, z: D.z, w: 1, o: D, fromZone: via }], ow, { ideal: 5 });
      for (const m of ow) { const p = owPos.get(m.id); if (p) m.data.cb.order = { type: 'post', x: p.x, z: p.z, low: p.low, spot: p.spot, zone: R.stage, look: { x: D.x, z: D.z }, run: true }; }
      assignStack(eff.filter((m) => !R.overwatch.has(m.id)), true);
      const ready = eff.filter((m) => { const o = m.data.cb.order; return o && Math.hypot(m.x - o.x, m.z - o.z) < 0.8; }).length;
      if (ready >= Math.ceil(eff.length * 0.75) || now - R.t > 18) {
        R.t = now;
        if (doorObj && doorObj.barricade > 0) R.phase = 'breach';
        else if (doc.gas && !R.gasUsed && cb.hasItem(GAS_ITEM_IDS)) R.phase = 'gas';
        else R.phase = 'entry';
      }
      return;
    }
    if (R.phase === 'breach') {
      if (!doorObj || doorObj.barricade <= 0) { R.phase = doc.gas && !R.gasUsed && cb.hasItem(GAS_ITEM_IDS) ? 'gas' : 'entry'; R.t = now; return; }
      const br = eff.filter((m) => !R.overwatch.has(m.id)).sort((a, b) => (b.data.cb.weapon.breach || 0) - (a.data.cb.weapon.breach || 0)).slice(0, 2);
      const p = cb.nav.openingSide(D, R.stage, 0.85);
      br.forEach((m, i) => { if (!m.data.cb.order || m.data.cb.order.type !== 'breach') m.data.cb.order = { type: 'breach', doorId: D.ref, x: p.x + (i ? D.nz : -D.nz) * 0.4 * (D.half > 0.6 ? 1 : 0.5), z: p.z + (i ? D.nx : -D.nx) * 0.4 * (D.half > 0.6 ? 1 : 0.5) }; });
      if (now - R.t > 50) { R.phase = 'withdraw'; R.t = now; R.attempts++; }
      return;
    }
    if (R.phase === 'gas') {
      if (!R.gasThrower) {
        const id = cb.takeItem(GAS_ITEM_IDS);
        if (!id) { R.phase = 'entry'; R.t = now; return; }
        R.gasUsed = true;
        const thrower = eff.filter((m) => !R.overwatch.has(m.id)).sort((a, b) => Math.hypot(a.x - D.x, a.z - D.z) - Math.hypot(b.x - D.x, b.z - D.z))[0] || eff[0];
        R.gasThrower = thrower.id;
        const [tx, tz] = this.enemyCentroid(via) || cb.world.zoneCenter(via);
        const from = cb.nav.openingSide(D, R.stage, 1.0);
        thrower.data.cb.order = { type: 'gas', x: tx, z: tz, from, onThrown: () => { R.gasT = cb.t; } };
      }
      if (R.gasT && now - R.gasT > 6.5) { R.phase = 'entry'; R.t = now; }
      if (!R.gasT && now - R.t > 15) { R.phase = 'entry'; R.t = now; }
      return;
    }
    if (R.phase === 'entry') {
      if (!R.waves) {
        R.startLoss = this.lossFrac;
        const team = eff.filter((m) => !R.overwatch.has(m.id)).sort((a, b) => (b.data.cb.courage + (b.data.cb.armor !== 'none' ? 0.3 : 0)) - (a.data.cb.courage + (a.data.cb.armor !== 'none' ? 0.3 : 0)));
        const inside = cb.nav.spots(via).filter((s) => Math.hypot(s.x - D.x, s.z - D.z) < 5.5 && cb.nav.walkable(s.x, s.z)).sort((a, b) => Math.hypot(a.x - D.x, a.z - D.z) - Math.hypot(b.x - D.x, b.z - D.z));
        const sideOf = (s) => Math.sign((s.x - D.x) * (D.nz) - (s.z - D.z) * (D.nx)) || 1;
        const left = inside.filter((s) => sideOf(s) < 0), right = inside.filter((s) => sideOf(s) > 0);
        R.waves = []; let li = 0, ri = 0;
        team.concat(eff.filter((m) => R.overwatch.has(m.id))).forEach((m, i) => {
          const useLeft = i % 2 === 0; const s = useLeft ? (left[li++] || right[ri++]) : (right[ri++] || left[li++]);
          const p = s || { x: cb.world.zoneCenter(via)[0], z: cb.world.zoneCenter(via)[1], low: false };
          R.waves.push({ id: m.id, x: p.x, z: p.z, low: !!p.low, at: now + Math.floor(i / 2) * 2.2 + (R.overwatch.has(m.id) ? 2 : 0) });
        });
        if (L) cb.barks.say(L, 'entry', { force: true });
        cb.chron(`Группа «${this.g.name}» входит в ${zoneLabel(via, 'short')}.`);
      }
      let allIn = true;
      for (const w of R.waves) {
        const m = cb.world.actorById(w.id); if (!m || !m.alive || !this.effective(m)) continue;
        if (now >= w.at) { if (!m.data.cb.order || m.data.cb.order.type !== 'enter') m.data.cb.order = { type: 'enter', x: w.x, z: w.z, low: w.low, look: this.enemyCentroidXZ(via) }; if (m.zone !== via) allIn = false; }
        else allIn = false;
      }
      if (allIn || now - R.t > 25) { R.phase = 'clear'; R.t = now; }
      return;
    }
    if (R.phase === 'clear') {
      const ks = [...cb.intel.police.values()].filter((k) => k.zone === via && now - k.t < 8 && k.a && k.a.alive);
      eff.forEach((m, i) => {
        const o = m.data.cb.order;
        if (ks.length) { const k = ks[i % ks.length]; if (!o || o.type !== 'push' || o.done) { const q = cb.quickCover(m, k.x, k.z, 4) || { x: k.x, z: k.z }; m.data.cb.order = { type: 'push', x: q.x, z: q.z, low: q.low, look: { x: k.x, z: k.z } }; } }
        else if (!o || o.done || o.type !== 'push') { const p = cb.world.randomPointInZone(via, cb.rng); if (p) m.data.cb.order = { type: 'push', x: p[0], z: p[1] }; }
      });
      if (now - R.t > 60 && !ks.length) { R.phase = 'choose'; }
      return;
    }
    if (R.phase === 'withdraw') {
      R.waves = null; R.gasThrower = null; R.gasT = 0;
      assignStack(eff, true);
      if (now - R.t > 22) {
        if (R.attempts >= 3) { R.givenUp = true; R.t = now; this.zone = R.stage; this.sig = ''; if (L) cb.barks.say(L, 'give_up', { force: true }); cb.chron(`Группа «${this.g.name}» отказывается от штурма и держит ${zoneLabel(R.stage, 'short')}.`); }
        else { R.phase = 'choose'; if (L) cb.barks.say(L, 'retry', { force: true }); }
      }
    }
  }
  enemyCentroid(zone) { const ks = [...this.cb.intel.police.values()].filter((k) => k.zone === zone && this.cb.t - k.t < 30); if (!ks.length) return null; return [ks.reduce((s, k) => s + k.x, 0) / ks.length, ks.reduce((s, k) => s + k.z, 0) / ks.length]; }
  enemyCentroidXZ(zone) { const c = this.enemyCentroid(zone) || this.cb.world.zoneCenter(zone); return { x: c[0], z: c[1] }; }
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export { getWeapon };
