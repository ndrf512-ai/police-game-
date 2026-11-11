// Базовый актор: тело в мире. Мозг (brain) решает, что делать; актор двигается, анимируется, говорит.
import { uid } from '../core/rng.js';

export const TEAMS = { POLICE: 'police', BANDIT: 'bandit', CIVIL: 'civil', PRISONER: 'prisoner', PLAYER: 'player' };

export class Actor {
  /**
   * @param {object} o
   *  team, look:{uniform, gender, skin, hair, hat, armor, weapon, build}, x,z,yaw, officerId?, name?
   */
  constructor(o = {}) {
    this.id = o.id || uid('a');
    this.team = o.team || TEAMS.CIVIL;
    this.name = o.name || '';
    this.officerId = o.officerId || null;   // ссылка на state.staff[].id
    this.personId = o.personId || null;     // для задержанных/посетителей
    this.look = Object.assign({ uniform: 'civil', gender: 'm', skin: 0, hair: 0, hat: 'none', armor: false, weapon: 'none', build: 1 }, o.look || {});
    this.x = o.x ?? 0; this.z = o.z ?? 0; this.y = 0; this.yaw = o.yaw ?? 0;
    this.aimPitch = 0;                 // наклон корпуса/оружия (рад)
    this.hp = o.hp ?? 100; this.maxHp = o.maxHp ?? 100; this.alive = true; this.downed = false;
    this.radius = 0.3;
    this.walkSpeed = o.walkSpeed ?? 1.35; this.runSpeed = o.runSpeed ?? 3.6;
    this.path = null; this.running = false; this.onArrive = null; this.moveTarget = null;
    this.anim = 'idle'; this.animTime = 0; this.pose = 'stand'; // stand | crouch | sit | lie
    this.forcedAnim = null; this.forcedAnimT = 0;              // разовая анимация (выстрел, удар)
    this.brain = o.brain || null;
    this.claimedPoint = null; this.reservedCover = null;
    this.speech = null;                // {text, t} — реплика над головой/субтитр
    this.target = null;                // актор-цель (бой)
    this.visible = true;
    this.stuckT = 0; this._lastX = this.x; this._lastZ = this.z;
    this.data = o.data || {};          // произвольные данные мозга
    this.zone = null;
    this.vx = 0; this.vz = 0;
  }

  get pos() { return [this.x, this.z]; }
  distTo(a) { return Math.hypot(a.x - this.x, a.z - this.z); }
  distToXZ(x, z) { return Math.hypot(x - this.x, z - this.z); }

  /** Идти к точке. opts: {run, onArrive(actor), stopDist} . Возвращает false, если пути нет. */
  moveTo(x, z, opts = {}) {
    if (!this.world) return false;
    if (this.pose === 'sit' || this.pose === 'lie') this.pose = 'stand';
    const p = this.world.findPath(this.x, this.z, x, z, opts);
    if (!p) { this.path = null; return false; }
    this.path = p; this.running = !!opts.run; this.onArrive = opts.onArrive || null; this.moveTarget = { x, z };
    this.stopDist = opts.stopDist ?? 0.08; this.stuckT = 0;
    return true;
  }
  /** Идти к именованной точке мира; по прибытии сесть/встать по её типу */
  goToPoint(pointId, opts = {}) {
    const pt = this.world.points[pointId]; if (!pt) return false;
    this.releasePoint(); this.claimedPoint = pointId;
    return this.moveTo(pt.x, pt.z, {
      ...opts,
      onArrive: (a) => {
        a.x = pt.x; a.z = pt.z; a.yaw = pt.yaw ?? a.yaw;
        if (pt.kind === 'seat' && !opts.stand) a.pose = 'sit';
        opts.onArrive && opts.onArrive(a, pt);
      },
    });
  }
  releasePoint() { this.claimedPoint = null; }
  stop() { this.path = null; this.onArrive = null; this.moveTarget = null; }
  get moving() { return !!(this.path && this.path.length); }
  faceTo(x, z) { this.yaw = Math.atan2(x - this.x, z - this.z); }
  /** Плавный поворот к углу; возвращает true, когда повернулся */
  turnTowards(yaw, dt, speed = 6) {
    let d = yaw - this.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const s = speed * dt; if (Math.abs(d) <= s) { this.yaw = yaw; return true; }
    this.yaw += Math.sign(d) * s; return false;
  }
  say(text, dur = 3.5) { this.speech = { text, t: dur }; if (this.world && this.world.onSay) this.world.onSay(this, text); }
  playAnim(name, dur = 0.4) { this.forcedAnim = name; this.forcedAnimT = dur; }
  setPose(p) { this.pose = p; }

  damage(amount, from = null, info = {}) {
    if (!this.alive) return;
    this.hp -= amount;
    this.lastHitT = 0; this.lastAttacker = from;
    if (this.brain && this.brain.onDamage) this.brain.onDamage(this, amount, from, info);
    if (this.hp <= 0) this.die(from, info);
  }
  die(from = null, info = {}) {
    if (!this.alive) return;
    this.alive = false; this.hp = 0; this.pose = 'lie'; this.path = null; this.anim = 'dead';
    this.releasePoint(); this.reservedCover = null;
    if (this.brain && this.brain.onDeath) this.brain.onDeath(this, from, info);
    if (this.world && this.world.onDeath) this.world.onDeath(this, from, info);
  }

  update(dt, ctx) {
    this.animTime += dt;
    if (this.speech) { this.speech.t -= dt; if (this.speech.t <= 0) this.speech = null; }
    if (this.forcedAnimT > 0) { this.forcedAnimT -= dt; if (this.forcedAnimT <= 0) this.forcedAnim = null; }
    if (this.lastHitT !== undefined) this.lastHitT += dt;
    this.zone = this.world.zoneAt(this.x, this.z);
    if (!this.alive) { this.anim = 'dead'; return; }
    if (this.brain && this.brain.update) this.brain.update(this, dt, ctx);
    this._move(dt);
    // выбор анимации
    if (this.forcedAnim) this.anim = this.forcedAnim;
    else if (this.moving) this.anim = this.running ? 'run' : (this.pose === 'crouch' ? 'crouchwalk' : 'walk');
    else if (this.pose === 'sit') this.anim = 'sit';
    else if (this.pose === 'crouch') this.anim = this.data.aiming ? 'crouchaim' : 'crouch';
    else if (this.pose === 'lie') this.anim = 'lie';
    else this.anim = this.data.aiming ? 'aim' : (this.data.idleAnim || 'idle');
  }

  _move(dt) {
    this.vx = 0; this.vz = 0;
    if (!this.path || !this.path.length) return;
    const sp = (this.running ? this.runSpeed : this.walkSpeed) * (this.pose === 'crouch' ? 0.5 : 1) * (this.data.speedMul || 1);
    let step = sp * dt;
    while (step > 0 && this.path.length) {
      const p = this.path[0]; const dx = p.x - this.x, dz = p.z - this.z; const d = Math.hypot(dx, dz);
      const last = this.path.length === 1;
      if (d <= (last ? this.stopDist : 0.15) || d < 1e-4) { this.path.shift(); continue; }
      const m = Math.min(step, d); this.x += dx / d * m; this.z += dz / d * m; step -= m;
      this.vx = dx / d * sp; this.vz = dz / d * sp;
      if (!this.data.strafe) this.turnTowards(Math.atan2(dx, dz), dt, 8);
    }
    // мягкое расталкивание с другими живыми
    for (const o of this.world.actors) {
      if (o === this || !o.alive || o.pose === 'lie') continue;
      const dx = this.x - o.x, dz = this.z - o.z; const d2 = dx * dx + dz * dz; const r = this.radius + o.radius;
      if (d2 > 1e-6 && d2 < r * r) { const d = Math.sqrt(d2); const push = (r - d) * 0.5; this.x += dx / d * push; this.z += dz / d * push; }
    }
    [this.x, this.z] = this.world.collide(this.x, this.z, this.radius * 0.9);
    // застревание: если почти не сдвинулись — перестроить путь
    const moved = Math.hypot(this.x - this._lastX, this.z - this._lastZ); this._lastX = this.x; this._lastZ = this.z;
    if (moved < sp * dt * 0.2) { this.stuckT += dt; if (this.stuckT > 1.2 && this.moveTarget) { this.stuckT = 0; const t = this.moveTarget, cb = this.onArrive, run = this.running; this.moveTo(t.x, t.z, { run, onArrive: cb }); } }
    else this.stuckT = 0;
    if (!this.path.length) {
      this.path = null; const cb = this.onArrive; this.onArrive = null; this.moveTarget = null;
      if (cb) cb(this);
    }
  }
}
