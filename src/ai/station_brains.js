// Мозги акторов участка: сотрудник (utility-ИИ с потребностями и характером), посетитель, задержанный.
import { clamp } from '../core/rng.js';
import { Seq } from './station_brains_core.js';
import { ACTS } from './station_acts.js';
import { hash01, dist, yawTo, cellGeom, inCell, OUTDOOR_ZONES } from './station_util.js';

// Запасные модификаторы черт (если game.sim.staff.mod недоступен)
export const TRAIT_MODS = {
  discipline: { pedant: 0.3, lazy: -0.3, ambitious: 0.15, drinker: -0.15, hothead: -0.1, leader: 0.1, veteran: -0.05, rookie: 0.05, honest: 0.05 },
  courage: { coward: -0.4, hothead: 0.25, afghan: 0.3, chechnya: 0.25, veteran: 0.1, rookie: -0.1, leader: 0.15, lucky: 0.1 },
};

function tick(st, key, sec, dt, rng, fn) {
  st[key] = (st[key] ?? sec * rng.range(0.3, 1)) - dt;
  if (st[key] <= 0) { st[key] = sec * rng.range(0.7, 1.3); fn(); }
}

// ═══════════════════════ Сотрудник ═══════════════════════
export class OfficerBrain {
  constructor(st, a, o) {
    this.st = st; this.a = a; this.id = o.id; this.o = o; this.rng = st.rng;
    const r = st.rng;
    this.needs = { bladder: r.range(0, 0.6), thirst: r.range(0, 0.7), hunger: r.range(0, 0.5), smoke: r.range(0, 0.8), social: r.range(0.1, 0.8), fun: r.range(0.1, 0.7), booze: r.range(0, 0.5) };
    this.job = null; this.thinkT = r.range(0.1, 1.5); this.cool = {}; this.pref = {};
    this.order = null; this.override = null; this.assign = null; this.cover = false; this.lockStatus = false;
    this.hold = null; this.talk = null; this.greetShift = 0; this.nearT = 0; this.lastLinger = -99; this.lastConv = -99;
    this.flags = {}; this.flagShift = st.shiftNo; this.bossNear = false; this.standT = 0; this.tipsyUntil = 0;
    this.refreshTraits();
  }
  refreshTraits() {
    const o = this.o; this.tr = new Set(o.traits || []); this.role = o.role;
    this.disc = clamp((o.skills?.discipline ?? 50) / 100 + this.T('discipline') * 0.6, 0.05, 1);
    this.courage = clamp(0.5 + this.T('courage'), 0, 1);
    const h = hash01(o.id + 'smk');
    const heavy = ['afghan', 'chechnya', 'drinker', 'hothead'].some((t) => this.tr.has(t));
    this.smoker = !this.tr.has('athlete') && !this.tr.has('sick') && h < (heavy ? 0.9 : o.gender === 'f' ? 0.3 : 0.6);
    this.drinker = this.tr.has('drinker') || o.hidden?.addiction === 'alcohol';
    for (const d of ACTS) this.pref[d.id] = (hash01(o.id + d.id) - 0.5) * 0.12;
    const fit = (o.skills?.fitness ?? 50) / 100;
    this.a.walkSpeed = 1.35 * (0.88 + fit * 0.24) * ((o.age || 30) > 50 ? 0.92 : 1);
    this.a.runSpeed = 3.6 * (0.8 + fit * 0.35);
  }
  has(t) { return this.tr.has(t); }
  T(key) { return this.st.mod(this.o, key); }
  get f() { return this.st.frame; }
  say(key, extra, listener) { return this.st.say(this.a, key, extra, listener); }
  sat(need, dt, per) { this.needs[need] = Math.max(0, this.needs[need] - per * dt); }
  sleepiness() {
    const fat = (this.o.fatigue ?? 30) / 100;
    return clamp(0.6 * fat + 0.55 * this.f.nf + (this.has('lazy') ? 0.15 : 0) + (this.has('sick') ? 0.1 : 0) - (this.f.tension ? 0.25 : 0), 0, 1.2);
  }
  drawWeapon() { const w = this.o.equipment?.weapon; this.a.look.weapon = w && w !== 'none' ? w : 'pm'; }

  // ——— кадр ———
  update(a, dt) {
    if (!a.alive) return;
    const st = this.st;
    if (this.flagShift !== st.shiftNo) { this.flags = {}; this.flagShift = st.shiftNo; }
    this.tickNeeds(dt);
    this.tickPlayer(dt);
    if (this.talk) { this.updateTalk(dt); return; }
    if (this.hold) {
      if (this.hold.done) this.hold = null;
      else { const o = this.hold.b1 === this ? this.hold.b2.a : this.hold.b1.a; if (a.pose === 'stand' && !a.moving) a.turnTowards(yawTo(a.x, a.z, o.x, o.z), dt, 4); return; }
    }
    if (this.standT > 0) { this.standT -= dt; if (this.standT <= 0 && this.job && this.job.holding && this.job.def?.seat && !a.moving) a.pose = 'sit'; }
    if (this.job) { const r = this.job.update(dt); if (r !== 'run') this.finishJob(r); }
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = this.rng.range(0.8, 1.9); this.think(); }
  }
  tickNeeds(dt) {
    const n = this.needs, m = this.f.minute;
    n.bladder += dt / 170 * (this.has('sick') ? 1.3 : 1);
    n.thirst += dt / 140;
    n.hunger += dt / 320 * ((m > 750 && m < 840) || (m > 1110 && m < 1200) ? 2.2 : 1);
    if (this.smoker) n.smoke += dt / 75 * (this.has('afghan') || this.has('chechnya') || this.has('drinker') ? 1.3 : 1) * ((this.o.stress ?? 0) > 60 ? 1.3 : 1) * (this.f.tension ? 1.4 : 1);
    n.social += dt / 130 * (this.has('talker') ? 1.5 : this.has('silent') ? 0.5 : 1);
    n.fun += dt / 160 * (this.has('lazy') ? 1.3 : 1);
    if (this.drinker) n.booze += dt / 220 * ((this.o.morale ?? 50) < 40 ? 1.5 : 1);
    for (const k in n) if (n[k] > 1) n[k] = 1;
    if (this.tipsyUntil && this.st.clock > this.tipsyUntil) this.tipsyUntil = 0;
  }
  tickPlayer(dt) {
    const P = this.f.player; if (!P || this.lockStatus || this.talk) { this.nearT = 0; return; }
    const d = dist(this.a.x, this.a.z, P.x, P.z);
    if (d < 2.2 && !this.a.moving) {
      this.nearT += dt;
      if (this.nearT > 7 && this.st.clock - this.lastLinger > 45 && !this.hold && !this.a.data.sleeping) { this.lastLinger = this.st.clock; this.nearT = 0; this.say('boss_lingers'); }
    } else this.nearT = 0;
  }

  // ——— решения ———
  think() {
    const o = this.st.officer(this.id); if (o) this.o = o;
    this.bossCheck();
    if (this.talk || this.hold) return;
    if (this.job && this.job.locked) return;
    if (this.override && this.override.type === 'rest' && this.st.clock > this.override.until) {
      this.override = null; this.say('rest_done');
    }
    if (this.order && this.order.type === 'follow') return this.followThink();
    if (this.order && this.order.type === 'goto') { if (!this.job || this.job.id !== 'goto') this.startJob(this.gotoJob()); return; }
    this.utility();
  }
  utility() {
    const clock = this.st.clock, cur = this.job, curDef = cur ? cur.def : null;
    const ov = this.override ? this.override.type : null;
    let curS = -Infinity;
    const cands = [];
    for (const d of ACTS) {
      if (d !== curDef && this.cool[d.id] > clock) continue;
      if (ov === 'rest' && d.duty) continue;
      if ((ov === 'post' || ov === 'patrol_inside') && d.duty && d.id !== 'hold_post' && d.id !== 'patrol') continue;
      if (!d.avail(this)) continue;
      let s = d.score(this) + (this.pref[d.id] || 0) + this.rng.range(-0.04, 0.04);
      if (this.bossNear && !ov && this.disc < 0.75) { if (d.leisure && !d.need) s -= 0.3; if (d.duty) s += 0.15; }
      if (d === curDef) { s += 0.3; curS = s; }
      if (s > 0) cands.push({ d, s });
    }
    cands.sort((x, y) => y.s - x.s);
    if (cur) {
      const top = cands[0];
      if (!top || top.d === curDef) return;
      if (cur.t < (curDef && curDef.need ? 4 : 8) && top.s < 1.3) return;
      if (top.s < curS + 0.25) return;
    }
    for (const c of cands.slice(0, 4)) {
      if (c.d === curDef) return;
      const job = c.d.plan(this, c.d);
      if (job) { if (!job.def) job.def = c.d; this.startJob(job); return; }
      this.cool[c.d.id] = clock + 6;
    }
  }
  startJob(job) {
    if (this.job) this.endJob('switch');
    this.job = job;
    this.a.data.activity = job.id; this.a.data.activityLabel = job.label;
    this.st.onActivity(this, job);
  }
  finishJob(r) {
    const j = this.job; this.job = null; if (!j) return;
    j.stop(r);
    if (j.def && j.def.cool) this.cool[j.def.id] = this.st.clock + j.def.cool;
    this.cleanup();
    this.thinkT = Math.min(this.thinkT, 0.15);
  }
  endJob(reason) {
    const j = this.job; if (!j) return;
    this.job = null; j.stop(reason);
    this.st.halt(this.a); this.a.releasePoint(); this.st.releaseExtra(this.a);
    this.cleanup();
    if (this.hold && !this.hold.done) this.st.endConv(this.hold);
    this.thinkT = Math.min(this.thinkT, 0.3);
  }
  cleanup() {
    const d = this.a.data;
    d.idleAnim = null; d.holding = null; d.talkTo = null; d.sleeping = false; d.dozing = false; d.aiming = false; d.secret = false;
    d.activity = 'idle'; d.activityLabel = 'стоит';
    if (!d.wounded) d.speedMul = this.tipsyUntil ? 0.9 : 1;
  }
  /** Сценарий (наряд, конвой, уход) — блокирует распорядок */
  script(seq) {
    seq.locked = true;
    this.order = null; this.cover = false;
    if (this.talk) this.endTalk();
    if (this.hold && !this.hold.done) this.st.endConv(this.hold);
    this.endJob('script');
    this.startJob(seq);
  }

  // ——— начальство рядом ———
  bossCheck() {
    const P = this.f.player; const a = this.a; this.bossNear = false;
    if (!P || !a.visible) return;
    const d = dist(a.x, a.z, P.x, P.z);
    if (d > 8) return;
    if (d > 2.2 && !this.st.world.lineOfSight(a.x, a.z, P.x, P.z)) return;
    this.bossNear = true;
    const j = this.job, st = this.st;
    if (this.greetShift !== st.shiftNo && d < 6.5 && !(j && j.locked) && !this.hold && !a.data.sleeping && !a.data.dozing && !this.talk) {
      this.greetShift = st.shiftNo;
      this.say(this.assign === 'duty' && j && j.id === 'duty_desk' ? 'greet_duty' : 'greet_boss');
      if (a.pose === 'sit' && (this.has('rookie') || this.has('pedant') || this.has('ambitious'))) { a.pose = 'stand'; this.standT = 2.5; }
      return;
    }
    if (!j) return;
    if (j.id === 'booze' && j.holding && d < 7) {
      this.say('caught_drinking'); this.endJob('caught'); this.cool.booze = st.clock + 600;
      st.caught(this, 'drinking'); return;
    }
    if (j.id === 'slack' && d < 6) { this.say('caught_slacking'); this.endJob('caught'); this.cool.slack = st.clock + 300; st.caught(this, 'slacking'); return; }
    if ((j.id === 'sleep' && j.holding) || a.data.dozing) {
      if (d < 2.5) {
        const onDuty = !!this.assign || a.data.dozing;
        this.say(onDuty ? 'caught_sleeping' : 'caught_sleeping_ok');
        if (a.data.dozing) a.data.dozing = false; else this.endJob('woken');
        if (onDuty) st.caught(this, 'sleeping');
      }
      return;
    }
    if (j.id === 'tv' && P.zone === a.zone && this.assign && this.f.minute > 480 && this.f.minute < 1200 && !this.has('lazy')) {
      this.say('caught_tv'); this.endJob('caught'); this.cool.tv = st.clock + 200;
    }
  }

  // ——— разговор с игроком ———
  beginTalk() {
    const a = this.a;
    if (this.hold && !this.hold.done) this.st.endConv(this.hold);
    if (this.job && !this.job.locked && !this.job.holding) this.endJob('talk');
    else this.st.halt(a);
    this.talk = { t: 0, wasSeated: a.pose === 'sit' };
    if (a.pose === 'sit' && !this.a.data.wounded) { a.pose = 'stand'; a.y = 0; if (this.rng.chance(0.5)) this.say('stand_up'); }
    if (a.pose === 'lie' && !a.data.wounded) { this.st.standUp(a); }
    if (a.data.dozing) a.data.dozing = false;
  }
  updateTalk(dt) {
    const P = this.f.player, a = this.a; this.talk.t += dt;
    if (P) a.turnTowards(yawTo(a.x, a.z, P.x, P.z), dt, 5);
    if (!P || this.talk.t > 30 || dist(a.x, a.z, P.x, P.z) > 4.5) this.endTalk();
  }
  endTalk() {
    if (!this.talk) return;
    const was = this.talk.wasSeated; this.talk = null;
    if (was && this.job && this.job.holding && this.job.def?.seat) this.a.pose = 'sit';
    this.thinkT = 0.2;
  }

  // ——— приказы ———
  applyOrder(order) {
    const type = order.type, st = this.st;
    if (this.lockStatus || (this.job && this.job.locked && this.job.kind !== 'order')) return { ok: false, text: this.say('order_on_task') };
    let text = null;
    const tired = (this.o.fatigue ?? 0) > 75 && type !== 'rest' && type !== 'home';
    const key = { follow: 'order_follow', goto: 'order_goto', post: 'order_post', rest: 'order_rest', home: 'order_home', duty: 'order_duty', guard_cells: 'order_guard_cells', patrol_inside: 'order_patrol_inside' }[type];
    if (!key) return { ok: false, text: null };
    text = this.rng.chance(0.4) ? this.say('order_ack') : this.say(key);
    if (tired && this.rng.chance(0.7)) { const t2 = this.say('order_tired'); if (t2) text = (text ? text + ' ' : '') + t2; }
    this.order = null;
    switch (type) {
      case 'follow': this.order = { type }; this.override = null; break;
      case 'goto': this.order = { type, pointId: order.pointId, x: order.x, z: order.z }; break;
      case 'post': this.override = { type: 'post', pointId: order.pointId || 'post_front_lobby' }; break;
      case 'rest': this.override = { type: 'rest', until: st.clock + this.rng.range(180, 260) }; break;
      case 'duty': this.override = null; break;
      case 'guard_cells': this.override = { type: 'guard' }; break;
      case 'patrol_inside': this.override = { type: 'patrol_inside' }; break;
      case 'home': st.startLeave(this, 'home'); return { ok: true, text };
      default: break;
    }
    st.recomputeAssign();
    // ленивый тянет время, горячий — бегом
    const delay = this.has('lazy') && this.disc < 0.5 && this.rng.chance(0.5) && type !== 'duty';
    if (delay) { const t3 = this.say('order_delay'); if (t3) text = t3; this.thinkT = 3; if (this.job && !this.job.locked && this.job.holding) this.job.st && (this.job.st.dur = Math.min(this.job.st.dur, this.job.st.t + 3)); else this.endJob('order'); }
    else { this.endJob('order'); this.thinkT = 0.1; }
    return { ok: true, text };
  }
  followThink() {
    if (this.job && this.job.id === 'toilet') return; // отпросился на минуту
    if (this.needs.bladder > 0.92 && this.job && this.job.id === 'follow') {
      this.a.say('Товарищ ' + (this.st.playerInfo().rank || 'майор') + ', разрешите на минуту отлучиться?', 3);
      const def = ACTS.find((d) => d.id === 'toilet'); const j = def.plan(this, def); if (j) { this.startJob(j); return; }
    }
    if (this.job && this.job.id === 'follow') return;
    const self = this;
    this.startJob(new Seq(this, [{
      until: (b, dt, st) => {
        const P = b.f.player; if (!P) return false;
        st.rt = (st.rt || 0) - dt;
        const d = dist(b.a.x, b.a.z, P.x, P.z);
        if (d < 1.8) { if (b.a.moving) b.st.halt(b.a); b.a.turnTowards(yawTo(b.a.x, b.a.z, P.x, P.z), dt, 5); return false; }
        if (st.rt <= 0 && (d > 2.4 || !b.a.moving)) {
          st.rt = 0.7;
          const k = 1.5 / Math.max(d, 0.01);
          let tx = P.x + (b.a.x - P.x) * k, tz = P.z + (b.a.z - P.z) * k;
          if (!b.st.world.isWalkable(tx, tz)) { tx = P.x; tz = P.z; }
          b.st.go(b.a, { x: tx, z: tz }, { run: d > 6, claim: false, stopDist: 0.3, snap: false });
        }
        return false;
      },
    }], { id: 'follow', label: 'идёт за командиром', kind: 'order' }));
    void self;
  }
  gotoJob() {
    const o = this.order;
    const target = o.pointId || { x: o.x, z: o.z };
    return new Seq(this, [
      { go: target, stand: true },
      { hold: this.rng.range(30, 60), start: (b) => { b.a.data.idleAnim = 'guard'; } },
      { do: (b) => { b.order = null; b.a.data.idleAnim = null; } },
    ], { id: 'goto', label: 'выполняет приказ', kind: 'order' });
  }

  // ——— рабочие тики ———
  deskTick(dt, st) {
    const a = this.a, rng = this.rng;
    tick(st, '_w', 14, dt, rng, () => a.playAnim('write', 2.5));
    if (this.needs.thirst > 0.45 && !st.tea) { st.tea = 12; a.data.holding = 'mug'; }
    if (st.tea > 0) {
      st.tea -= dt; this.sat('thirst', dt, 0.06);
      tick(st, '_s', 5, dt, rng, () => a.playAnim('drink', 1.5));
      if (st.tea <= 0) { st.tea = 0; a.data.holding = null; }
    }
    tick(st, '_r', 45, dt, rng, () => { if (this.st.activeTasks() > 0 && rng.chance(0.5)) { this.say('duty_radio'); a.playAnim('talk', 2); } });
    if (this.f.deep && !a.data.dozing && !this.f.phoneRinging && !this.f.visitorWaiting && this.disc < 0.65 && this.sleepiness() > 0.65 && rng.chance(dt * 0.01)) { a.data.dozing = true; st.doze = 0; }
    if (a.data.dozing) { st.doze = (st.doze || 0) + dt; if (st.doze > 45 || this.f.phoneRinging || this.f.visitorWaiting) a.data.dozing = false; }
  }
  /** Случайно заговорить с соседом по занятию (курилка, чай, ТВ) */
  chatChance(dt, st, p = 1) {
    st._cc = (st._cc ?? this.rng.range(3, 9)) - dt;
    if (st._cc > 0) return;
    st._cc = this.rng.range(8, 16);
    if (this.needs.social < 0.3 || this.st.clock - this.lastConv < 25 || !this.rng.chance(0.55 * p)) return;
    const other = this.st.neighborForChat(this, 2.8);
    if (other) this.st.startConv(this, other, { short: true });
  }

  onDamage() {}
  onDeath() { const j = this.job; this.job = null; if (j) j.stop('dead'); this.st.onOfficerDied(this); }
}

// ═══════════════════════ Посетитель ═══════════════════════
export class VisitorBrain {
  constructor(st, a, v) {
    this.st = st; this.a = a; this.v = v; this.rng = st.rng;
    this.phase = 'enter'; this.waitT = 0; this.barkT = this.rng.range(12, 22); this.talk = null; this.hold = null;
    this.job = new Seq(this, [
      { go: 'front_door_out', claim: false },
      { go: 'front_door_in', claim: false },
      { do: (b) => { b.st.visitorInside(b); } },
    ], { id: 'v_enter' });
  }
  get f() { return this.st.frame; }
  say(key, extra) { return this.st.say(this.a, key, { vgender: this.v.person?.gender, ...extra }); }
  update(a, dt) {
    if (!a.alive) return;
    if (this.st.combat) return this.combatTick(dt);
    if (this.talk) {
      const P = this.f.player; this.talk.t += dt;
      if (P) a.turnTowards(yawTo(a.x, a.z, P.x, P.z), dt, 5);
      if (!P || this.talk.t > 40 || dist(a.x, a.z, P.x, P.z) > 4.5) this.talk = null;
      return;
    }
    if (this.job) { const r = this.job.update(dt); if (r !== 'run') { const j = this.job; this.job = null; j.stop(r); if (r === 'fail' && this.phase === 'leave') this.st.removeVisitor(this); } }
    if (this.phase === 'queue' || this.phase === 'window') {
      this.waitT += dt; this.barkT -= dt;
      if (this.barkT <= 0) {
        this.barkT = this.rng.range(18, 32);
        const busy = this.st.reception && this.st.reception.vb === this;
        if (!busy && this.v.mood !== 'scared') this.say('visitor_wait');
        if (this.v.mood === 'angry' && this.phase === 'queue') a.playAnim('wave', 1.5);
      }
      const patience = { angry: 110, drunk: 160, crying: 200, scared: 220, shifty: 90, calm: 180 }[this.v.mood] || 160;
      const rec = this.st.reception;
      if (this.waitT > patience && !(rec && rec.vb === this && rec.stage !== 'wait')) this.st.visitorGiveUp(this);
    }
  }
  toWindow() {
    this.phase = 'window';
    this.job = new Seq(this, [{ go: 'visitor_window', stand: true }, { do: (b) => b.st.receptionStart(b) }], { id: 'v_window' });
  }
  toQueue() {
    this.phase = 'queue';
    const p = this.st.firstFree(['visitor_bench_2', 'visitor_bench_3', 'visitor_bench_1', 'visitor_bench_4', 'v_lobby_1', 'v_lobby_2', 'v_lobby_3', 'v_lobby_4'], this.a);
    this.job = new Seq(this, [{ go: p || { x: 15, z: 16.5 } }], { id: 'v_queue' });
  }
  leave(kind) {
    if (this.phase === 'leave' || this.phase === 'gone') return;
    this.phase = 'leave';
    const st = this.st;
    this.job = new Seq(this, [
      { do: (b) => { b.a.data.talkTo = null; if (kind) b.say(kind); } },
      { wait: 1.2 },
      { go: 'front_door_in', claim: false, run: kind === 'visitor_flee' },
      { go: 'front_door_out', claim: false, run: kind === 'visitor_flee' },
      { go: st.nearestSpawn(this.a), claim: false, run: kind === 'visitor_flee' },
      { do: (b) => { b.st.removeVisitor(b); } },
    ], { id: 'v_leave' });
  }
  combatTick(dt) {
    const a = this.a;
    if (!this.cphase) {
      const z = a.zone;
      const danger = this.st.world.actors.some((o) => o.alive && o.team === 'bandit' && dist(o.x, o.z, 16.25, 20) < 10);
      if ((z === 'street' || z === 'lobby') && !danger && this.v.mood !== 'scared') {
        this.cphase = 'flee'; this.phase = 'enter'; this.leave('visitor_flee');
      } else {
        this.cphase = 'hide';
        const p = this.st.firstFree(['visitor_bench_1', 'visitor_bench_3', 'visitor_bench_2', 'visitor_bench_4'], a);
        this.job = new Seq(this, [{ go: p || { x: a.x, z: a.z }, run: true, stand: true }, { do: (b) => { b.a.pose = 'crouch'; b.a.data.hiding = true; b.say('visitor_hide'); } }], { id: 'v_hide' });
      }
    }
    if (this.job) { const r = this.job.update(dt); if (r !== 'run') { const j = this.job; this.job = null; j.stop(r); if (this.phase === 'leave') this.st.removeVisitor(this); } }
  }
  afterCombat() { this.cphase = null; this.a.pose = 'stand'; this.a.data.hiding = false; this.phase = 'window'; this.leave(this.rng.chance(0.5) ? 'visitor_bye_angry' : 'visitor_bye_scared'); }
  onDeath() { this.st.removeVisitor(this, true); }
}

// ═══════════════════════ Задержанный ═══════════════════════
export class PrisonerBrain {
  constructor(st, a, det) {
    this.st = st; this.a = a; this.rng = st.rng; this.detId = det.id; this.cell = det.cell;
    this.mode = 'resident'; this.t = this.rng.range(0.3, 3); this.job = null; this.hold = null; this.talk = null;
    this.aggr = (det.danger ?? 40) > 60; this.coop = det.cooperation ?? 40; this.gangId = det.gangId || null;
    this.lastTalk = -99; this.smokeUntil = 0; this.bangT = 0; this.cT = 0;
  }
  get f() { return this.st.frame; }
  say(key, extra) { return this.st.say(this.a, key, extra); }
  update(a, dt) {
    if (!a.alive || this.mode !== 'resident') return;
    if (this.st.combat) return this.combatTick(dt);
    if (this.hold) { if (this.hold.done) this.hold = null; else return; }
    if (this.talk) {
      const P = this.f.player; this.talk.t += dt;
      if (P && a.pose === 'stand') a.turnTowards(yawTo(a.x, a.z, P.x, P.z), dt, 4);
      if (!P || this.talk.t > 30 || dist(a.x, a.z, P.x, P.z) > 4.5) this.talk = null;
      return;
    }
    if (this.smokeUntil && this.st.clock > this.smokeUntil) { this.smokeUntil = 0; a.data.idleAnim = null; a.data.holding = null; }
    if (this.job) { const r = this.job.update(dt); if (r !== 'run') { const j = this.job; this.job = null; j.stop(r); } }
    this.t -= dt;
    if (this.t <= 0) { this.t = this.rng.range(2.5, 6); this.think(); }
  }
  react() {
    const st = this.st, g = cellGeom(this.cell), P = this.f.player;
    if (st.clock - this.lastTalk < 28) return false;
    if (P && P.zone === 'ivs' && dist(P.x, P.z, g.cx, 5.4) < 3.3) {
      this.lastTalk = st.clock; this.say(this.rng.chance(0.5) ? 'prisoner_to_boss' : (this.aggr ? 'prisoner_aggressive' : 'prisoner_smoke_ask')); return true;
    }
    const off = st.world.nearestActor(g.cx, 5.6, (o) => o.alive && o.team === 'police' && o.visible && o.z > 4.6, 3.0);
    if (off && this.rng.chance(0.5)) {
      this.lastTalk = st.clock;
      this.say(this.aggr ? 'prisoner_aggressive' : this.rng.chance(0.6) ? 'prisoner_smoke_ask' : 'prisoner_idle');
      st.prisonerNoise = st.clock;
      return true;
    }
    return false;
  }
  think() {
    if (this.react()) return;
    if (this.job) return;
    const night = this.f.night, rng = this.rng, g = cellGeom(this.cell);
    const mate = this.st.cellmates(this).find((m) => !m.hold && !m.talk && m.mode === 'resident');
    const opts = [
      { id: 'lie', w: night ? 3 : 0.8 }, { id: 'sit', w: 0.8 }, { id: 'floor', w: 0.4 }, { id: 'pace', w: night ? 0.1 : 0.6 },
      { id: 'bars', w: (night ? 0.1 : 0.5) + (this.aggr ? 0.5 : 0) }, { id: 'shout', w: this.aggr && !night ? 0.6 : (night ? 0 : 0.12) },
      { id: 'chat', w: mate && this.st.clock - this.lastTalk > 20 ? (night ? 0.3 : 0.6) : 0 },
    ];
    const pick = rng.weighted(opts).id;
    const slotGo = (names) => {
      const s = names.map((n) => `${this.cell}:${n}`).find((id) => this.st.isFree(id, this.a));
      return s || null;
    };
    const steps = [];
    if (pick === 'lie' || pick === 'sit' || pick === 'floor') {
      const id = slotGo(pick === 'lie' ? ['bunk_lie', 'floor'] : pick === 'sit' ? ['bunk_sit_1', 'bunk_sit_2', 'floor'] : ['floor', 'bunk_sit_2']);
      if (!id) { this.t = 1; return; }
      steps.push({ go: id });
      steps.push({ hold: pick === 'lie' ? (night ? [90, 200] : [30, 80]) : [15, 45], start: (b) => { b.st.placeSlot(b.a, id); if (night && rng.chance(0.7)) b.a.data.sleeping = true; else if (rng.chance(0.15)) b.say(night ? 'prisoner_night' : 'prisoner_idle'); } });
    } else if (pick === 'pace') {
      for (let k = 0; k < rng.int(2, 3); k++) {
        const x = rng.range(g.x0 + 0.35, g.x1 - 0.35), z = rng.range(1.6, 3.5);
        steps.push({ go: { x, z }, claim: false, stand: true }); steps.push({ wait: [0.5, 2] });
      }
    } else if (pick === 'bars' || pick === 'shout') {
      const id = slotGo(['bars_1', 'bars_2', 'corner']); if (!id) { this.t = 1; return; }
      steps.push({ go: id, stand: true });
      steps.push({
        hold: [8, 20],
        start: (b) => { if (pick === 'shout') b.say(this.aggr ? 'prisoner_aggressive' : 'prisoner_bars'); },
        tick: (b, dt, st) => {
          if (pick !== 'shout') return;
          st.k = (st.k ?? 0) - dt;
          if (st.k <= 0) { st.k = rng.range(1.2, 2.2); b.a.playAnim('punch', 0.45); b.st.prisonerNoise = b.st.clock; b.st.audio('cell_door', b.a.x, b.a.z, 0.35); }
        },
      });
    } else if (pick === 'chat' && mate) {
      this.lastTalk = this.st.clock; this.st.startConv(this, mate, { topic: 'prison' }); return;
    }
    this.job = new Seq(this, steps, { id: 'p_' + pick, onEnd: (b) => { b.a.data.sleeping = false; } });
  }
  /** Сразу разместить в камере (без анимации) */
  settle() {
    this.mode = 'resident'; this.job = null; this.t = this.rng.range(1, 4);
    this.a.data.cuffed = false;
  }
  giveSmoke(sec = 40) {
    this.smokeUntil = this.st.clock + sec; this.a.data.idleAnim = 'smoke'; this.a.data.holding = 'cigarette';
  }
  combatTick(dt) {
    const a = this.a, st = this.st;
    if (st.world.openCellDoors.has(this.cell)) {
      a.brain = null; a.data.free = true; this.mode = 'free';
      st.game.bus?.emit('prisoner:free', { actorId: a.id, detaineeId: this.detId, cell: this.cell });
      return;
    }
    if (!this.cphase) {
      this.cphase = true; this.job = null; st.standUp(a); a.data.sleeping = false;
      const id = [`${this.cell}:bars_1`, `${this.cell}:bars_2`, `${this.cell}:corner`].find((i) => st.isFree(i, a));
      if (id) st.go(a, id, { run: true, stand: true });
    }
    this.bangT -= dt; this.cT -= dt;
    if (this.bangT <= 0 && !a.moving) { this.bangT = this.rng.range(1.1, 2); a.playAnim('punch', 0.45); }
    if (this.cT <= 0) {
      this.cT = this.rng.range(6, 11);
      const friend = this.gangId && st.game.state.attack && st.game.state.attack.gangId === this.gangId;
      this.say(friend ? 'prisoner_combat_friend' : 'prisoner_combat_scared');
    }
  }
  afterCombat() { this.cphase = false; this.job = null; this.t = 1; }
  onDeath() { this.st.onPrisonerDied(this); }
}
export { inCell, OUTDOOR_ZONES };
