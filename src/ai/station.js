// «Участок» — ИИ жизни отделения (агент C). Контракт: docs/CONTRACTS.md, раздел C.
// Распорядок сотрудников (utility-ИИ), посетители, звонки, наряды (выезд/возврат), конвой, ИВС, смены, тревога.
import { Actor } from '../world/actor.js';
import { RNG, clamp } from '../core/rng.js';
import { bark, conversation } from './barks.js';
import { Seq, Op } from './station_brains_core.js';
import { OfficerBrain, VisitorBrain, PrisonerBrain, TRAIT_MODS } from './station_brains.js';
import { ACT_BY_ID } from './station_acts.js';
import {
  SPOTS, PLACE_NAMES, CELL_IDS, cellGeom, inCell, cellOfPos, isNight, isDeepNight, nightFactor, timeOfDay,
  colloquial, displayName as dispName, peopleCount, speechDur, dist, yawTo, hhmm,
} from './station_util.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const SMOKE_IDS = ['smoke_porch_1', 'smoke_porch_2', 'v_smoke_3', 'v_smoke_4', 'smoke_yard', 'v_smoke_y2'];
const COUNTER = ['v_counter_1', 'armory_counter', 'v_counter_3'];
const ALARM_POSTS = ['post_front_lobby', 'post_duty_window', 'post_lobby_bench', 'post_corridor_c', 'post_armory', 'post_corridor_e', 'post_generator', 'post_ivs', 'post_corridor_w', 'post_office'];
const SPAWNS = ['spawn_street_w', 'spawn_street_e', 'spawn_street_c'];
const BOARD_OFS = [-1.2, -0.4, 0.4, 1.2, 1.9, -1.9];

export class StationAI {
  constructor(game, opts = {}) {
    this.game = game; this.world = game.world;
    this.rng = game.rng && game.rng.fork ? game.rng.fork(4242) : new RNG(4242);
    this.opts = { autoInterrogate: true, generatorRestoresPower: true, autoCombat: true, ...opts };
    this.driveActors = opts.driveActors ?? 'auto';   // true | false | 'auto' (сам вызывать actor.update, если этого не делает игра)
    this.started = false; this.clock = 0; this.shiftNo = 1; this.combat = false; this.power = true;
    this.brains = new Map();      // officerId -> OfficerBrain
    this.byOfficer = new Map();   // officerId -> Actor
    this.byDetainee = new Map();  // detaineeId -> Actor
    this.visitors = new Set();    // VisitorBrain
    this.queue = [];              // очередь посетителей к окошку
    this.reception = null; this.phone = null; this.phoneQ = [];
    this.departures = new Map(); this.returns = new Map(); this.ops = []; this.arrivals = []; this.convs = [];
    this.pathQ = []; this.pathCache = new Map(); this.extra = new Map(); this.dyn = {}; this.later = [];
    this.prisonerNoise = -99; this.tvOn = false; this.tvT = 10; this.alarm = null; this.genAt = 0; this.genBusy = false;
    this.mourning = { until: -1, dead: [] }; this.tensionUntil = -1; this.deskEmptyT = 0; this.interrogating = null;
    this.interrogated = {}; this.newDetainees = new Map(); this.toRemove = [];
    this.stats = { teleports: 0, unstuck: 0, paths: 0, cacheHits: 0 };
    this._t1 = 0; this._t2 = 0; this._probe = new WeakMap(); this._driveDecided = null; this._frames = 0; this._extSeen = false;
    this.frame = this._makeFrame();
    this._unsub = [];
  }

  // ═══════════════ Контракт ═══════════════
  start() {
    if (this.started) return; this.started = true;
    const w = this.world; w.vehicleState = w.vehicleState || {};
    const S = this.game.state;
    for (const v of S.economy?.vehicles || []) if (v.status === 'task') w.vehicleState[v.id] = 'away';
    for (const t of S.city?.tasks || []) if (t.vehicle && t.phase && t.phase !== 'done') w.vehicleState[t.vehicle] = 'away';
    const bus = this.game.bus;
    const on = (ev, fn) => { if (bus) this._unsub.push(bus.on(ev, (p) => { try { fn(p); } catch (e) { console.error('[station]', ev, e); } })); };
    on('task:depart', (p) => this.onDepart(p));
    on('task:return', (p) => this.onReturn(p));
    on('visitor:arrive', (p) => this.onVisitor(p && (p.visitor || p)));
    on('call:incoming', (p) => this.phoneQ.push({ call: (p && p.call) || p || {}, t: 0 }));
    on('day:start', () => { this.shiftNo++; this._sync(true); this._cleanupDead(); });
    on('day:end', () => {});
    on('detainee:new', (p) => { const id = p && (p.detainee ? p.detainee.id : p.id || p); if (id) this.newDetainees.set(id, this.clock); });
    on('shot', (p) => this.onShot(p || {}));
    on('power', (p) => this.onPower(typeof p === 'boolean' ? p : !(p && p.on === false)));
    on('attack:warning', () => { this.tensionUntil = this.clock + 300; this._barkSome('attack_fear', 2, 6); });
    on('attack:start', () => { if (this.opts.autoCombat) this.setCombatMode(true); });
    on('attack:end', () => { if (this.opts.autoCombat) this.setCombatMode(false); });
    // стартовый состав: сразу «на местах»
    for (const o of S.staff || []) if (o.status === 'station' && o.onShift) this.spawnOfficer(o, 'warm');
    for (const d of S.detainees || []) if (d.status === 'cell') this.spawnPrisoner(d, 'cell');
    this.recomputeAssign();
  }
  dispose() { for (const u of this._unsub) u && u(); this._unsub = []; }

  update(dt) {
    if (!this.started || !this.world || !(dt > 0)) return;
    dt = Math.min(dt, 1);
    this.clock += dt; this._frames++;
    this.frame = this._makeFrame();
    if (this.toRemove.length) this._flushRemove();
    if (this.later.length) this._runLater();
    this._processPaths();
    this._updateConvs(dt);
    if (!this.combat) {
      this._updatePhone(dt); this._updateReception(dt); this._updateAlarm(); this._updateTV(dt);
      for (const dep of [...this.departures.values()]) this._updateDeparture(dep, dt);
      for (const ret of [...this.returns.values()]) this._updateReturn(ret, dt);
      for (const op of this.ops) op.update(dt);
      this.ops = this.ops.filter((o) => !o.finished);
      this._updateArrivals();
      if (!this.power && this.genAt && this.clock > this.genAt && !this.genBusy) this._startGenerator();
    }
    this._t1 += dt; this._t2 += dt;
    if (this._t1 >= 1) { this._t1 = 0; this._updateCover(); this._watchdog(); this._newDetainees(); }
    if (this._t2 >= 2) { this._t2 = 0; this._sync(false); }
    if (this._shouldDrive()) for (const a of [...this.world.actors]) if (a.world) a.update(dt, this.game);
    for (const a of this.world.actors) this._probe.set(a, a.animTime);
    if (this.toRemove.length) this._flushRemove();
  }

  /** order: {type:'follow'|'goto'|'post'|'rest'|'home'|'duty'|'guard_cells'|'patrol_inside', pointId?, x?, z?} → {ok, text} */
  orderOfficer(officerId, order) {
    const b = this.brains.get(officerId);
    if (!b || !b.a.alive) return { ok: false, text: 'Сотрудника нет на участке.' };
    if (!b.a.brain) return { ok: false, text: null }; // бой
    return b.applyOrder(order || { type: 'duty' });
  }
  actorForOfficer(officerId) { const a = this.byOfficer.get(officerId); return a && a.world ? a : null; }

  /** Варианты, когда игрок подошёл к актору: [{id,label,sub?}] */
  onPlayerTalk(actor) {
    if (!actor || !actor.alive) return [];
    const b = actor.brain;
    const P = this.playerInfo();
    if (b instanceof OfficerBrain) {
      b.beginTalk();
      if (b.lockStatus || (b.job && b.job.locked)) return [{ id: 'info', label: 'Куда направляетесь?' }, { id: 'file', label: 'Личное дело' }, { id: 'bye', label: 'Ладно, иди' }];
      const dep = this.game.sim?.departments; const deptId = dep && dep.headDeptId ? dep.headDeptId(this.game, b.o.id) : null;
      return [
        { id: 'how', label: 'Как служба?' },
        ...(deptId ? [{ id: 'dept', label: 'Доклад по отделу', desc: dep.DEPTS.find((x) => x.id === deptId)?.name }] : []),
        { id: 'order', label: 'Приказ…', sub: this.orderChoices() },
        { id: 'talk', label: 'Поговорить по душам' },
        { id: 'file', label: 'Личное дело' },
        { id: 'rest', label: 'Отпустить отдыхать' },
        { id: 'bye', label: b.o.gender === 'f' ? 'Свободна' : 'Свободен' },
      ];
    }
    if (b instanceof PrisonerBrain) {
      b.talk = { t: 0 };
      return [{ id: 'interrogate', label: 'Допросить' }, { id: 'smoke', label: 'Дать закурить' }, { id: 'threat', label: 'Пригрозить' }, { id: 'bye', label: 'Отойти' }];
    }
    if (b instanceof VisitorBrain) {
      b.talk = { t: 0 };
      const g = b.v.person?.gender === 'f' ? 'гражданка' : 'гражданин';
      return [...(b.v.choices || []).map((c) => ({ id: 'v:' + c.id, label: c.label, desc: c.desc })), { id: 'v_listen', label: 'Выслушать подробно' }, { id: 'bye', label: `Подождите, ${g}` }];
    }
    void P;
    return [];
  }
  orderChoices() {
    return [
      { id: 'order:follow', label: 'За мной' }, { id: 'order:post', label: 'Занять пост…' }, { id: 'order:guard_cells', label: 'Охранять камеры' },
      { id: 'order:patrol_inside', label: 'Обойти участок' }, { id: 'order:rest', label: 'Отдыхать' }, { id: 'order:duty', label: 'К своим обязанностям' },
      { id: 'order:home', label: 'Домой' },
    ];
  }
  /** Обработка выбора → {speaker, lines:[...], openScreen?:{id,params}, choices?:[...], close?:bool} */
  talkChoice(actor, choiceId) {
    const b = actor && actor.brain; const res = { speaker: actor ? actor.name : '', lines: [] };
    const say = (key, extra) => { const t = this.say(actor, key, extra); if (t) res.lines.push(t); return t; };
    if (!b || !actor.alive) return { ...res, close: true };
    if (choiceId === 'bye') { this.talkEnd(actor); return { ...res, close: true }; }
    if (b instanceof OfficerBrain) {
      const o = b.o, oid = o.id;
      if (choiceId === 'how') {
        const r = this.game.sim?.staff?.talk ? this._try(() => this.game.sim.staff.talk(this.game, oid, 'how_are_you')) : null;
        const mine = b.tipsyUntil ? 'how_tipsy' : (o.fatigue ?? 0) > 75 ? 'how_tired' : (o.stress ?? 0) > 65 ? 'how_stressed' : (o.morale ?? 50) < 35 ? 'how_bad' : (o.morale ?? 50) > 65 ? 'how_good' : 'how_ok';
        if (r && r.lines && r.lines.length) { res.lines.push(...r.lines.map(String)); actor.say(res.lines[0], speechDur(res.lines[0])); } else say(mine);
        return res;
      }
      if (choiceId === 'dept') {
        const dep = this.game.sim?.departments; const deptId = dep && dep.headDeptId ? dep.headDeptId(this.game, oid) : null;
        const lines = deptId ? this._try(() => dep.reportLines(this.game, deptId)) || [] : [];
        if (!lines.length) lines.push('Докладывать нечего, товарищ майор.');
        res.lines.push(...lines); actor.say(lines[0], speechDur(lines[0])); actor.playAnim('talk', 3);
        return res;
      }
      if (choiceId === 'order') return { ...res, choices: this.orderChoices() };
      if (choiceId === 'order:post') return { ...res, choices: Object.keys(PLACE_NAMES).filter((k) => k.startsWith('post_')).map((k) => ({ id: 'order:post:' + k, label: PLACE_NAMES[k] })) };
      if (choiceId.startsWith('order:')) {
        const [, type, pointId] = choiceId.split(':');
        const r = this.orderOfficer(oid, { type, pointId });
        if (r.text) res.lines.push(r.text);
        this.talkEnd(actor); return { ...res, ok: r.ok, close: true };
      }
      if (choiceId === 'rest') { const r = this.orderOfficer(oid, { type: 'rest' }); if (r.text) res.lines.push(r.text); this.talkEnd(actor); return { ...res, close: true }; }
      if (choiceId === 'talk') { this.talkEnd(actor); return { ...res, close: true, openScreen: { id: 'talk', params: { officerId: oid } } }; }
      if (choiceId === 'file') { this.talkEnd(actor); return { ...res, close: true, openScreen: { id: 'officer', params: { officerId: oid } } }; }
      if (choiceId === 'info') { say('order_on_task'); return { ...res, close: true }; }
      return res;
    }
    if (b instanceof PrisonerBrain) {
      const det = this._det(b.detId);
      if (choiceId === 'interrogate') { this.talkEnd(actor); return { ...res, close: true, openScreen: { id: 'interrogation', params: { detaineeId: b.detId } } }; }
      if (choiceId === 'smoke') { say('prisoner_reply_smoke'); b.giveSmoke(45); this._detGesture(b.detId, 'cigarette', { cooperation: +4 }); return res; }
      if (choiceId === 'threat') {
        const scared = (det?.danger ?? 40) < 45 || this.rng.chance(0.3);
        say(scared ? 'prisoner_reply_threat_scared' : 'prisoner_reply_threat_brave');
        this._detGesture(b.detId, 'threat', scared ? { cooperation: +6 } : { cooperation: -3 }); return res;
      }
      return res;
    }
    if (b instanceof VisitorBrain) {
      if (choiceId === 'v_listen') return { ...res, openScreen: { id: 'visitor', params: { visitor: b.v, visitorId: b.v.id } } };
      if (choiceId.startsWith('v:')) { const lines = this.resolveVisitor(b.v.id, choiceId.slice(2), 'player'); res.lines.push(...lines); return { ...res, close: true }; }
    }
    return res;
  }
  talkEnd(actor) {
    const b = actor && actor.brain; if (!b) return;
    if (b instanceof OfficerBrain) b.endTalk(); else b.talk = null;
  }

  setCombatMode(on) {
    on = !!on; if (on === this.combat) return; this.combat = on;
    for (const c of [...this.convs]) this.endConv(c);
    if (on) {
      for (const op of this.ops) op.abort(); this.ops = [];
      this.alarm = null; this.reception && (this.reception.stage = 'talk');
      for (const b of this.brains.values()) {
        const a = b.a; if (!a.alive || !a.world) continue;
        if (b.talk) b.endTalk();
        if (b.civilian) { b.endJob('combat'); this.standUp(a); a.releasePoint(); this.releaseExtra(a); b.cover = false; b.thinkT = 0.1; continue; }
        b.endJob('combat'); this.standUp(a); a.releasePoint(); this.releaseExtra(a); b.cover = false;
        if (a.look.weapon === 'none' && !a.data.wounded) b.drawWeapon();
        a.data.activity = 'combat'; a.data.activityLabel = 'в бою';
        a.brain = null;
      }
      for (const a of this.byDetainee.values()) { const pb = a.brain; if (pb instanceof PrisonerBrain && pb.mode === 'op') { pb.mode = 'resident'; if (!inCell(pb.cell, a.x, a.z)) { a.brain = null; a.data.free = true; } } }
      this.game.bus?.emit('station:combat', { on: true });
    } else {
      for (const b of this.brains.values()) {
        const a = b.a; if (!a.alive || !a.world || a.brain) { if (b.civilian && a.brain === b) { b.endJob('combat_end'); a.pose = 'stand'; a.data.hiding = false; } continue; }
        a.brain = b; b.job = null; b.hold = null; b.thinkT = this.rng.range(0.5, 3); b.cleanup(); b.lockStatus = false;
        this.after(this.rng.range(15, 30), () => { if (a.brain === b && !this.combat && !this.alarm) a.look.weapon = 'none'; });
      }
      this._barkSome('after_fight', 2, 8);
      for (const vb of this.visitors) vb.afterCombat();
      for (const a of this.byDetainee.values()) if (a.brain instanceof PrisonerBrain) a.brain.afterCombat();
      for (const dep of this.departures.values()) for (const id of dep.members) {
        if (dep.boarded.has(id)) continue;
        const b = this.brains.get(id); if (b && b.a.alive && b.a.world) b.script(this._departSeq(b, dep));
      }
      this.after(120, () => this._cleanupDead());
      this.game.bus?.emit('station:combat', { on: false });
    }
  }

  // ═══════════════ Доп. API ═══════════════
  activityOf(officerId) {
    const b = this.brains.get(officerId); if (!b || !b.a.world) return null;
    return { id: b.job ? b.job.id : (b.a.brain ? 'idle' : 'combat'), label: b.job ? b.job.label : (b.a.brain ? 'стоит' : 'в бою'), zone: b.a.zone, sleeping: !!b.a.data.sleeping };
  }
  promptFor(actor) {
    const b = actor && actor.brain;
    if (b instanceof OfficerBrain) return `Поговорить: ${actor.name}${b.job && b.job.label ? ' (' + b.job.label + ')' : ''}`;
    if (b instanceof PrisonerBrain) { const d = this._det(b.detId); return `Задержанный: ${d ? (d.nick ? `«${d.nick}» ` : '') + d.person.lastName : ''}`.trim(); }
    if (b instanceof VisitorBrain) return `Посетитель: ${b.v.person ? b.v.person.lastName : ''}`;
    return null;
  }
  /** Решение по посетителю (игрок/UI или дежурный). Возвращает реплики посетителя. */
  resolveVisitor(visitorId, choiceId, by = 'player') {
    const vb = [...this.visitors].find((x) => x.v.id === visitorId); if (!vb || vb.resolved) return [];
    vb.resolved = true;
    const choice = (vb.v.choices || []).find((c) => c.id === choiceId) || null;
    const duty = by === 'duty' ? this.deskActor() : null;
    this.game.bus?.emit('visitor:choice', { visitor: vb.v, visitorId, choiceId, choice, by, officerId: duty ? duty.officerId : null });
    if (this.game.sim?.city?.answerVisitor) this._try(() => this.game.sim.city.answerVisitor(this.game, vb.v, choiceId, by));
    const lines = [];
    if (by === 'player') {
      const good = choice && /принят|завест|оформ|помоч|разобр|выслат|наряд|найд|занест|запис/i.test(choice.label || '');
      const t = this.say(vb.a, good ? 'visitor_thanks' : 'visitor_upset'); if (t) lines.push(t);
    } else if (duty) this.say(duty, 'duty_v_close', { vgender: vb.v.person?.gender });
    this.game.log?.(`Посетитель (${vb.v.complaint || 'обращение'}): ${choice ? choice.label : 'выслушали'}${by === 'duty' && duty ? ' — решил дежурный ' + duty.name : ''}.`, 'visitor');
    if (this.reception && this.reception.vb === vb) this._endReception();
    vb.talk = null;
    this.after(by === 'player' ? 2.5 : 3.5, () => vb.leave(by === 'player' ? null : this._byeKey(vb)));
    return lines;
  }

  // ═══════════════ Навигация ═══════════════
  pt(id) {
    if (!id) return null;
    if (typeof id !== 'string') return id;
    const w = this.world.points[id] || SPOTS[id] || this.dyn[id];
    if (w) return w;
    const k = id.indexOf(':');
    if (k > 0) {
      const g = cellGeom(id.slice(0, k)); const s = g.slots[id.slice(k + 1)];
      if (s) return { ...s, kind: s.pose === 'sit' ? 'seat' : 'stand', zone: 'ivs' };
    }
    return null;
  }
  isFree(id, a = null) {
    if (this.world.pointTaken(id, a)) return false;
    const e = this.extra.get(id); if (e && e !== a && e.alive && e.world) return false;
    return true;
  }
  firstFree(ids, a, shuffle = false) { const list = shuffle ? this.rng.shuffle(ids) : ids; return list.find((id) => this.pt(id) && this.isFree(id, a)) || null; }
  claimExtra(ids, a) { if (ids.some((id) => !this.isFree(id, a))) return false; for (const id of ids) this.extra.set(id, a); return true; }
  releaseExtra(a) { for (const [k, v] of this.extra) if (v === a) this.extra.delete(k); }
  standUp(a) {
    if (a.pose === 'sit' || a.pose === 'lie' || a.pose === 'crouch') a.pose = 'stand';
    a.y = 0; a.data.lieOn = null; a.data.sitOn = null; a.data.sleeping = false; a.data.hiding = false;
  }
  /** Идти к цели (id точки или {x,z,yaw,id}). cb(ok). Пути — через кэш и бюджет на кадр. */
  go(a, target, opts = {}, cb = null) {
    const p = this.pt(target);
    if (!p || !a.world) { cb && cb(false); return false; }
    const pid = typeof target === 'string' ? target : (target.id || null);
    if (!opts.keepClaim) {
      a.claimedPoint = opts.claim !== false && pid ? pid : null;
      if (!opts.keepExtra) this.releaseExtra(a);
    }
    if (!opts.noStand) this.standUp(a);
    const req = { a, p, opts, cb };
    a._goReq = req; a.stop();
    this.pathQ = this.pathQ.filter((r) => r.a !== a);
    if (dist(a.x, a.z, p.x, p.z) < 0.2) { this._arrive(req); return true; }
    const c = this._cacheGet(a.x, a.z, p.x, p.z);
    if (c) { this.stats.cacheHits++; this._assign(req, c); } else this.pathQ.push(req);
    return true;
  }
  pendingPath(a) { return !!a._goReq; }
  halt(a) { a.stop(); a._goReq = null; this.pathQ = this.pathQ.filter((r) => r.a !== a); }
  teleport(a, target, opts = {}) {
    const p = this.pt(target); if (!p) return;
    this.stats.teleports++;
    a.stop(); this.pathQ = this.pathQ.filter((r) => r.a !== a);
    a.x = p.x; a.z = p.z;
    if (a._goReq) this._arrive(a._goReq);
    else { if (p.yaw != null) a.yaw = p.yaw; if (p.kind === 'seat' && !opts.stand) a.pose = 'sit'; }
  }
  _arrive(req) {
    const a = req.a; if (a._goReq !== req) return;
    a._goReq = null; const p = req.p;
    if (req.opts.snap !== false) { a.x = p.x; a.z = p.z; }
    if (p.yaw != null && req.opts.snap !== false) a.yaw = p.yaw;
    if (p.kind === 'seat' && !req.opts.stand) a.pose = 'sit';
    req.cb && req.cb(true);
  }
  _assign(req, path) {
    const a = req.a;
    a.path = path.slice(); a.running = !!req.opts.run; a.moveTarget = { x: req.p.x, z: req.p.z };
    a.stopDist = req.opts.stopDist ?? 0.08; a.stuckT = 0; a.onArrive = () => this._arrive(req);
    a.data._wd = { x: a.x, z: a.z, t: 0 };
  }
  _sig() { return [...this.world.openCellDoors].sort().join(',') + '|' + this.world.doors.filter((d) => d.barricade > 0).map((d) => d.id).join(','); }
  _cacheKey(x0, z0, x1, z1) { const [a, b] = this.world.toCell(x0, z0), [c, d] = this.world.toCell(x1, z1); return `${a},${b}>${c},${d}|${this._sigCur}`; }
  _cacheGet(x0, z0, x1, z1) { if (!this._sigCur) this._sigCur = this._sig(); return this.pathCache.get(this._cacheKey(x0, z0, x1, z1)) || null; }
  _processPaths() {
    this._sigCur = this._sig();
    if (!this.pathQ.length) return;
    const t0 = now(); let n = 0;
    while (this.pathQ.length && n < 4 && now() - t0 < 5) {
      const req = this.pathQ.shift(); const a = req.a;
      if (a._goReq !== req || !a.alive || !a.world) continue;
      const key = this._cacheKey(a.x, a.z, req.p.x, req.p.z);
      let path = this.pathCache.get(key);
      if (!path) {
        path = this.world.findPath(a.x, a.z, req.p.x, req.p.z); n++; this.stats.paths++;
        if (path) { if (this.pathCache.size > 700) this.pathCache.clear(); this.pathCache.set(key, path); }
      }
      if (!path) { a._goReq = null; req.cb && req.cb(false); continue; }
      this._assign(req, path);
    }
  }
  /** Сторож: если актор «идёт», но не двигается — подтолкнуть */
  _watchdog() {
    for (const a of this.world.actors) {
      if (!a.alive || !a.world || !a.path || !a.path.length || !a.data._wd) continue;
      const w = a.data._wd;
      if (dist(a.x, a.z, w.x, w.z) > 0.6) { w.x = a.x; w.z = a.z; w.t = 0; continue; }
      w.t += 1;
      if (w.t >= 10) { const p = a.path[0]; a.x = p.x; a.z = p.z; w.x = a.x; w.z = a.z; w.t = 0; this.stats.unstuck++; }
    }
  }

  // ═══════════════ Утилиты ═══════════════
  officer(id) { return this.game.officer ? this.game.officer(id) : (this.game.state.staff || []).find((o) => o.id === id); }
  _det(id) { return (this.game.state.detainees || []).find((d) => d.id === id) || null; }
  mod(o, key) {
    const sm = this.game.sim?.staff?.mod;
    if (typeof sm === 'function') { const v = this._try(() => sm(o, key)); if (typeof v === 'number' && !Number.isNaN(v)) return v; }
    const t = TRAIT_MODS[key]; if (!t) return 0;
    let s = 0; for (const tr of o.traits || []) s += t[tr] || 0; return s;
  }
  playerInfo() { const p = this.game.state.player || {}; return { gender: p.gender || this.game.player?.gender || 'm', rank: p.rank || 'майор', lastName: p.lastName || '', firstName: p.firstName || '', patronymic: p.patronymic || '' }; }
  speakerOf(a) {
    if (!a) return null;
    if (a.officerId) {
      const o = this.officer(a.officerId) || {};
      return { role: o.role, gender: o.gender || a.look.gender, traits: o.traits || [], rank: o.rank || 'сержант', lastName: o.lastName || '', firstName: o.firstName || '', patronymic: o.patronymic || '', colloq: colloquial(o, o.age, o.traits || []), role: o.role };
    }
    const per = a.data.person || {};
    return { gender: per.gender || a.look.gender, traits: [], rank: '', lastName: per.lastName || '', firstName: per.firstName || '', colloq: per.firstName || '' };
  }
  say(actor, key, extra = {}, listener = null) {
    if (!actor || !actor.alive || !actor.world) return null;
    const ex = { det: peopleCount(this.byDetainee.size), dead: this.mourning.dead[0], dgender: this.mourning.dg, news: this._news(), n: this.rng.int(1000, 9999), ...extra };
    const text = bark(key, { rng: this.rng, speaker: this.speakerOf(actor), listener: this.speakerOf(listener), player: this.playerInfo(), night: this.frame.night, extra: ex });
    if (!text) return null;
    actor.say(text, speechDur(text));
    if (this.frame.deep && actor.speech && actor.team === 'police') actor.speech.whisper = true;
    return text;
  }
  _news() { const n = this.game.state.city?.news; if (!n || !n.length) return null; const it = n[n.length - 1 - this.rng.int(0, Math.min(3, n.length - 1))]; return it && (it.title || it.text); }
  audio(name, x, z, vol = 1) { const au = this.game.audio; if (au && au.play) this._try(() => au.play(name, { x, z, vol })); }
  after(sec, fn) { this.later.push({ at: this.clock + sec, fn }); }
  _runLater() { const due = this.later.filter((l) => l.at <= this.clock); if (!due.length) return; this.later = this.later.filter((l) => l.at > this.clock); for (const l of due) this._try(l.fn); }
  _try(fn) { try { return fn(); } catch (e) { console.error('[station]', e); return null; } }
  _log(text, kind = 'station') { this._try(() => this.game.log && this.game.log(text, kind)); }
  _makeFrame() {
    const m = this.game.state.time?.minute ?? 600;
    const P = this.game.player && typeof this.game.player.x === 'number' ? { x: this.game.player.x, z: this.game.player.z, zone: this.world.zoneAt(this.game.player.x, this.game.player.z) } : null;
    return {
      minute: m, night: isNight(m), deep: isDeepNight(m), nf: nightFactor(m), tod: timeOfDay(m), power: this.power, player: P,
      visitorWaiting: !!(this.reception || this.queue.length), phoneRinging: !!(this.phone && this.phone.stage === 'ring'),
      tension: this.clock < this.tensionUntil, mourning: this.clock < this.mourning.until, alarm: !!this.alarm,
    };
  }
  onActivity(b, job) { this.game.bus?.emit('station:activity', { actorId: b.a.id, officerId: b.id, id: job.id, label: job.label }); }
  caught(b, what) { this.game.bus?.emit('officer:caught', { officerId: b.id, what }); this._log(`${b.a.name}: застигнут${b.o.gender === 'f' ? 'а' : ''} — ${{ drinking: 'выпивал на службе', sleeping: 'спал на посту', slacking: 'отлынивал' }[what] || what}.`, 'discipline'); }
  _barkSome(key, n, spread, filter = null) {
    const list = this.rng.shuffle([...this.brains.values()].filter((b) => b.a.alive && b.a.world && b.a.brain && !b.a.data.sleeping && (!filter || filter(b))));
    list.slice(0, n).forEach((b, i) => this.after(this.rng.range(0.5, spread) + i, () => b.a.world && b.say(key)));
  }
  nearestSpawn(a) { let best = SPAWNS[0], bd = 1e9; for (const s of SPAWNS) { const p = this.world.points[s]; const d = dist(a.x, a.z, p.x, p.z); if (d < bd) { bd = d; best = s; } } return best; }
  activeTasks() { return (this.game.state.city?.tasks || []).filter((t) => t.phase && t.phase !== 'done').length; }
  zoneCount(zone, except) { let n = 0; for (const b of this.brains.values()) if (b.a !== except && b.a.world && b.a.zone === zone) n++; return n; }
  countJob(id) { let n = 0; for (const b of this.brains.values()) if (b.job && b.job.id === id) n++; return n; }
  vehicleSpot() { const vs = this.world.vehicleState || {}; if (vs.uaz_1 !== 'away') return 'v_car_1'; if (vs.uaz_2 !== 'away') return 'v_car_2'; return null; }
  occupiedCells() { const s = new Set(); for (const a of this.byDetainee.values()) { const b = a.brain; if (b instanceof PrisonerBrain && b.mode === 'resident' && a.alive) s.add(b.cell); } return CELL_IDS.filter((c) => s.has(c)); }
  cellmates(pb) { const r = []; for (const a of this.byDetainee.values()) { const b = a.brain; if (b instanceof PrisonerBrain && b !== pb && b.cell === pb.cell && a.alive) r.push(b); } return r; }
  placeSlot(a, id) {
    const p = this.pt(id); if (!p) return;
    a.x = p.x; a.z = p.z; a.yaw = p.yaw ?? a.yaw;
    if (p.pose === 'lie') { a.pose = 'lie'; a.y = p.y || 0.45; a.data.lieOn = 'bunk'; } else if (p.pose === 'sit') { a.pose = 'sit'; if (p.floor) a.data.sitOn = 'floor'; else a.data.sitOn = 'bunk'; }
  }
  cellSlotTarget(cell, a) { return ['bars_1', 'bars_2', 'corner', 'bunk_sit_1', 'bunk_sit_2', 'floor'].map((n) => `${cell}:${n}`).find((id) => this.isFree(id, a)) || { x: cellGeom(cell).cx, z: 2.6 }; }

  // ═══════════════ Спавн ═══════════════
  spawnOfficer(o, mode = 'warm', at = null) {
    if (this.byOfficer.has(o.id)) return this.byOfficer.get(o.id);
    const civil = mode === 'arrive';
    const sp = at || this.world.points[this.rng.pick(SPAWNS)];
    const ol = o.look || {};
    const look = {
      uniform: civil ? (o.gender === 'f' ? 'civil_f' : 'civil_m') : (mode === 'return' ? 'militia_coat' : 'militia'), gender: o.gender || 'm',
      skin: ol.skin ?? Math.floor(this.rng.next() * 4), hair: ol.hair ?? Math.floor(this.rng.next() * 6), hat: mode === 'return' ? 'cap' : 'none',
      armor: mode === 'return' && o.equipment?.armor && o.equipment.armor !== 'none', weapon: mode === 'return' ? (o.equipment?.weapon && o.equipment.weapon !== 'none' ? o.equipment.weapon : 'pm') : 'none',
      build: ol.build ?? 1, mustache: ol.mustache, glasses: ol.glasses,
    };
    const a = new Actor({ team: 'police', officerId: o.id, name: dispName(o), look, x: sp.x, z: sp.z, yaw: sp.yaw ?? 0 });
    if (this.game.sim?.staff?.displayName) { const n = this._try(() => this.game.sim.staff.displayName(o)); if (n) a.name = n; }
    a.data.role = o.role; a.data.holster = o.equipment?.weapon && o.equipment.weapon !== 'none' ? o.equipment.weapon : 'pm';
    this.world.addActor(a);
    const b = new OfficerBrain(this, a, o); a.brain = b;
    this.byOfficer.set(o.id, a); this.brains.set(o.id, b);
    if (this.combat) a.brain = null;
    if (mode === 'warm') {
      b.greetShift = 0; this.recomputeAssign(); b.think();
      if (a._goReq) this.teleport(a, a._goReq.p, a._goReq.opts); else if (!b.job) this.teleport(a, this.world.randomPointInZone('corridor', this.rng));
      this.stats.teleports--;
    } else if (mode === 'arrive') b.script(this._arriveSeq(b));
    return a;
  }
  spawnPrisoner(det, mode = 'cell', at = null) {
    if (this.byDetainee.has(det.id)) return this.byDetainee.get(det.id);
    if (!det.cell || !CELL_IDS.includes(det.cell)) { det.cell = this._freeCell(); /* CONTRACT-NEEDS: detainee.cell */ }
    const per = det.person || { gender: 'm', firstName: '', lastName: '' };
    const look = { uniform: per.gender === 'f' ? 'civil_f' : 'civil_m', gender: per.gender || 'm', skin: 0, hair: 0, build: 1, ...(det.look || {}), hat: 'none', weapon: 'none', armor: false };
    const g = cellGeom(det.cell);
    const p = at || { x: g.cx + this.rng.range(-0.6, 0.6), z: 2.6, yaw: 0 };
    const a = new Actor({ team: 'prisoner', personId: det.id, name: (det.nick ? `«${det.nick}» ` : '') + (per.lastName || ''), look, x: p.x, z: p.z, yaw: p.yaw ?? 0 });
    a.data.person = per; a.data.detId = det.id; a.walkSpeed = 1.15;
    this.world.addActor(a);
    const pb = new PrisonerBrain(this, a, det); a.brain = pb;
    this.byDetainee.set(det.id, a);
    if (mode !== 'cell') { pb.mode = 'op'; a.data.cuffed = true; }
    return a;
  }
  _freeCell() {
    const cnt = { cell_1: 0, cell_2: 0, cell_3: 0 };
    for (const d of this.game.state.detainees || []) if (d.status === 'cell' && cnt[d.cell] !== undefined) cnt[d.cell]++;
    return CELL_IDS.slice().sort((x, y) => cnt[x] - cnt[y])[0];
  }
  removeOfficerActor(id) {
    const a = this.byOfficer.get(id); if (!a) return;
    a.visible = false; a.brain = null; a.releasePoint(); this.releaseExtra(a); this.halt(a);
    this.byOfficer.delete(id); this.brains.delete(id); this.toRemove.push(a);
  }
  removeVisitor(vb, dead = false) {
    if (vb.phase === 'gone') return; vb.phase = 'gone';
    this.visitors.delete(vb); this.queue = this.queue.filter((q) => q !== vb);
    if (this.reception && this.reception.vb === vb) this._endReception();
    if (!dead) { vb.a.visible = false; vb.a.brain = null; this.toRemove.push(vb.a); }
    this.game.bus?.emit('visitor:left', { visitor: vb.v, visitorId: vb.v.id });
  }
  _flushRemove() { for (const a of this.toRemove) { this.releaseExtra(a); this.world.removeActor(a); } this.toRemove = []; }
  _cleanupDead() {
    for (const a of [...this.world.actors]) if (!a.alive && (a.team === 'police' || a.team === 'civil' || a.team === 'prisoner')) {
      this.world.removeActor(a);
      if (a.officerId && this.byOfficer.get(a.officerId) === a) { this.byOfficer.delete(a.officerId); this.brains.delete(a.officerId); }
      if (a.data.detId && this.byDetainee.get(a.data.detId) === a) this.byDetainee.delete(a.data.detId);
    }
  }

  // ═══════════════ Состав и обязанности ═══════════════
  _sync(dayStart) {
    const S = this.game.state;
    for (const o of S.staff || []) {
      const want = o.status === 'station' && o.onShift;
      const a = this.byOfficer.get(o.id), b = this.brains.get(o.id);
      if (want && !a && !this.arrivals.some((x) => x.id === o.id) && !this._inReturn(o.id) && !this._inDeparture(o.id)) {
        this.arrivals.push({ id: o.id, at: this.clock + (dayStart ? this.rng.range(2, 35) : this.rng.range(1, 6)) + ((o.traits || []).includes('lazy') ? 10 : 0) - ((o.traits || []).includes('pedant') ? 2 : 0) });
      }
      if (a && b && !want && a.alive && !b.lockStatus && !this.combat && a.brain) {
        if (o.status === 'task') { const t = (S.city?.tasks || []).find((x) => (x.officerIds || []).includes(o.id) && x.phase !== 'done'); if (t && !this._inDeparture(o.id)) this.onDepart({ taskId: t.id, officerIds: [o.id], vehicle: t.vehicle, late: true }); }
        else if (o.status !== 'dead') this.startLeave(b, o.status === 'fired' ? 'fired' : o.status === 'hospital' ? 'hospital' : 'shift');
      }
    }
    for (const [id, a] of this.byOfficer) if (!this.officer(id) && a.alive) this.removeOfficerActor(id);
    // задержанные
    for (const d of S.detainees || []) {
      const a = this.byDetainee.get(d.id);
      if (d.status === 'cell' && !a && !this._pendingDet(d.id)) this.spawnPrisoner(d, 'cell');
      if (a && a.alive && d.status !== 'cell' && !this.combat && a.brain instanceof PrisonerBrain && a.brain.mode === 'resident' && !a.data.leaving) this._releaseOp(a.brain, d.status);
      if (a && a.alive && d.status === 'cell' && !this.combat && !a.brain) { // после боя вне камеры
        const pb = new PrisonerBrain(this, a, d); a.brain = pb; a.data.free = false;
        if (inCell(d.cell, a.x, a.z)) pb.settle(); else { pb.mode = 'op'; this._escortOrTeleport([pb], null); }
      }
    }
    this.recomputeAssign();
  }
  _inReturn(id) { for (const r of this.returns.values()) if (r.living.includes(id)) return true; return false; }
  _inDeparture(id) { for (const d of this.departures.values()) if (d.members.has(id) && !d.boarded.has(id)) return true; return false; }
  _pendingDet(id) { if (this.newDetainees.has(id)) return true; for (const r of this.returns.values()) if (r.dets.includes(id)) return true; return false; }
  recomputeAssign() {
    const bs = [...this.brains.values()].filter((b) => b.a.alive && b.a.world && !b.leaving && !b.departing);
    const rankW = (o) => ({ 'капитан': 6, 'старший лейтенант': 5, 'лейтенант': 4, 'младший лейтенант': 3.5, 'старший прапорщик': 3.2, 'прапорщик': 3, 'старшина': 2.5, 'старший сержант': 2, 'сержант': 1.5, 'младший сержант': 1 }[String(o.rank || '').toLowerCase()] || 1);
    const free = (b) => !(b.override && (b.override.type === 'post' || b.override.type === 'patrol_inside' || b.override.type === 'rest')) && !(b.order && b.order.type === 'follow') && !b.a.data.wounded;
    for (const b of bs) b._newAssign = null;
    const duties = bs.filter((b) => b.role === 'duty' && free(b)).sort((x, y) => (y.assign === 'duty') - (x.assign === 'duty') || rankW(y.o) - rankW(x.o) || y.disc - x.disc);
    if (duties[0]) duties[0]._newAssign = 'duty';
    if (duties[1]) duties[1]._newAssign = 'duty2';
    if (!duties[0]) { const acting = bs.filter((b) => b.role !== 'oper' && free(b)).sort((x, y) => (y.assign === 'duty') - (x.assign === 'duty') || y.disc - x.disc)[0]; if (acting) acting._newAssign = 'duty'; }
    for (const b of bs) if (b.override && b.override.type === 'guard') b._newAssign = 'guard';
    if (!bs.some((b) => b._newAssign === 'guard')) {
      const g = bs.filter((b) => b.role === 'guard' && !b._newAssign && free(b))[0]
        || (this.byDetainee.size ? bs.filter((b) => b.role === 'pps' && !b._newAssign && free(b)).sort((x, y) => (y.assign === 'guard') - (x.assign === 'guard') || y.disc - x.disc)[0] : null);
      if (g) g._newAssign = 'guard';
    }
    for (const b of bs) {
      if (b.assign !== b._newAssign) { const old = b.assign; b.assign = b._newAssign; if (old && b.job && b.job.def && b.job.def.duty && !b.job.locked) b.endJob('reassign'); }
    }
  }
  releaseCover() {
    for (const b of this.brains.values()) if (b.cover) { b.cover = false; if (b.job && b.job.id === 'duty_desk' && !b.job.locked) b.endJob('cover_end'); }
  }
  _updateCover() {
    const duty = [...this.brains.values()].find((b) => b.assign === 'duty' && b.a.brain);
    const d2 = [...this.brains.values()].find((b) => b.assign === 'duty2' && b.a.brain);
    if (!duty || !d2) { this.deskEmptyT = 0; return; }
    if (d2.cover) return;
    const empty = this.isFree('duty_desk') && !(duty.job && duty.job.id === 'duty_desk');
    this.deskEmptyT = empty ? this.deskEmptyT + 1 : 0;
    if (this.deskEmptyT > 8 && !d2.lockStatus && !(d2.job && d2.job.locked)) { d2.cover = true; d2.thinkT = 0; this.deskEmptyT = 0; }
  }
  deskActor() {
    for (const b of this.brains.values()) {
      const a = b.a;
      if (a.claimedPoint === 'duty_desk' && a.pose === 'sit' && a.brain === b && b.job && b.job.id === 'duty_desk' && b.job.holding && !b.hold) return a;
    }
    return null;
  }

  // ═══════════════ Смены: приход/уход ═══════════════
  _updateArrivals() {
    if (!this.arrivals.length) return;
    const due = this.arrivals.filter((x) => x.at <= this.clock);
    if (!due.length) return;
    this.arrivals = this.arrivals.filter((x) => x.at > this.clock);
    for (const x of due) { const o = this.officer(x.id); if (o && o.status === 'station' && o.onShift && !this.byOfficer.has(o.id)) this.spawnOfficer(o, 'arrive'); }
  }
  _arriveSeq(b) {
    const steps = [
      { do: (b) => { b.lockStatus = true; b.a.data.offduty = true; } },
      { go: 'front_door_out', claim: false }, { go: 'front_door_in', claim: false },
      { go: (b) => this.firstFree(['v_change_1', 'v_change_2', 'v_change_3'], b.a) || { x: 6.6, z: 17.2 }, stand: true },
      { hold: [4, 6], start: (b) => { if (this.rng.chance(0.35)) b.say('changing'); } },
      { do: (b) => { b.a.look.uniform = 'militia'; b.a.data.offduty = false; b.lockStatus = false; b.arriving = false; if (this.rng.chance(0.6)) b.say('shift_arrive'); } },
    ];
    if (b.role === 'duty') {
      steps.push({ go: 'v_duty_side', stand: true });
      steps.push({ until: (b) => this.isFree('duty_desk', b.a), timeout: 70 });
    }
    return new Seq(b, steps, { id: 'arrive', label: 'заступает на смену' });
  }
  /** kind: 'shift' | 'home' | 'fired' | 'hospital' */
  startLeave(b, kind) {
    if (b.leaving) return; b.leaving = true; b.lockStatus = true;
    const a = b.a; const wasDuty = b.assign === 'duty';
    this.recomputeAssign();
    if (kind === 'hospital' && a.data.wounded) return this._medicOp(b);
    const steps = [];
    if (wasDuty && kind === 'shift' && (this.arrivals.length || [...this.brains.values()].some((x) => x !== b && x.role === 'duty' && x.lockStatus))) {
      steps.push({ until: () => [...this.brains.values()].some((x) => x !== b && x.a.world && x.role === 'duty' && dist(x.a.x, x.a.z, 24.6, 17) < 3), timeout: 75 });
      steps.push({ do: (b) => { b.say('shift_handover_out'); const rep = [...this.brains.values()].find((x) => x !== b && x.role === 'duty' && dist(x.a.x, x.a.z, 24.6, 17) < 3); if (rep) this.after(2.8, () => rep.say('shift_handover_in')); } });
      steps.push({ wait: 3 });
    }
    if (kind !== 'fired' && kind !== 'hospital' && !String(a.look.uniform).startsWith('civil')) {
      steps.push({ go: (b) => this.firstFree(['v_change_2', 'v_change_1', 'v_change_3'], b.a) || { x: 6.6, z: 17.2 }, stand: true });
      steps.push({ hold: [4, 6] });
      steps.push({ do: (b) => { b.a.look.uniform = b.o.gender === 'f' ? 'civil_f' : 'civil_m'; b.a.look.weapon = 'none'; b.a.look.hat = 'none'; b.a.look.armor = false; } });
    }
    steps.push({ do: (b) => { b.say(kind === 'fired' ? 'fired_leave' : kind === 'hospital' ? 'hospital_leave' : 'shift_leave'); } });
    steps.push({ go: 'front_door_in', claim: false }, { go: 'front_door_out', claim: false });
    steps.push({ do: (b) => { if (kind === 'home') this._setHome(b.o); } });
    steps.push({ go: (b) => this.nearestSpawn(b.a), claim: false });
    steps.push({ do: (b) => this.removeOfficerActor(b.id) });
    b.script(new Seq(b, steps, { id: 'leave', label: kind === 'fired' ? 'уходит со службы' : kind === 'hospital' ? 'едет в больницу' : 'уходит домой' }));
  }
  _setHome(o) {
    const st = this.game.sim?.staff;
    if (st && st.sendHome) this._try(() => st.sendHome(this.game, o.id));
    else if (st && st.setShift) this._try(() => st.setShift(this.game, o.id, false));
    if (o.status === 'station') o.status = 'home';   // CONTRACT-NEEDS: staff.sendHome(game,id)
    o.onShift = false;
  }
  _medicOp(b) {
    const sp = this.world.points.spawn_street_c;
    const m = new Actor({ team: 'civil', name: 'Фельдшер', look: { uniform: 'medic', gender: this.rng.chance(0.5) ? 'f' : 'm', skin: 0, hair: 1, hat: 'none', weapon: 'none', build: 1 }, x: sp.x, z: sp.z });
    m.data.person = { gender: m.look.gender, firstName: '', lastName: 'фельдшер' };
    this.world.addActor(m);
    b.script(new Seq(b, [{ until: (bb, dt, st) => st.done }], { id: 'hospital', label: 'ждёт «скорую»' }));
    const job = b.job;
    const op = new Op(this, [
      { move: [[m, { x: b.a.x + 0.8, z: b.a.z }, { claim: false, run: true }]], timeout: 60 },
      { do: () => { this.say(m, 'medic_arrive'); m.faceTo(b.a.x, b.a.z); } }, { wait: 3 },
      { do: () => { this.standUp(b.a); b.say('hospital_leave'); } },
      { move: [[b.a, 'front_door_in', { claim: false }], [m, { x: 16.8, z: 18.4 }, { claim: false }]], timeout: 60 },
      { move: [[b.a, 'front_door_out', { claim: false }], [m, { x: 17, z: 21.6 }, { claim: false }]], timeout: 30 },
      { move: [[b.a, 'spawn_street_c', { claim: false }], [m, 'spawn_street_c', { claim: false }]], timeout: 40 },
    ], { actors: [b.a, m], onDone: () => { this.removeOfficerActor(b.id); m.visible = false; this.toRemove.push(m); }, onAbort: () => { m.visible = false; this.toRemove.push(m); if (job && job.st) job.st.done = true; } });
    this.ops.push(op);
  }

  // ═══════════════ Наряды ═══════════════
  onDepart(p) {
    if (!p || !p.taskId) return;
    const task = (this.game.state.city?.tasks || []).find((t) => t.id === p.taskId);
    let dep = this.departures.get(p.taskId);
    if (!dep) {
      dep = { taskId: p.taskId, vehicle: p.vehicle ?? task?.vehicle ?? null, members: new Set(), boarded: new Set(), armed: new Set(), t: 0, clerk: null, clerkReady: false,
        urgent: !!(task && (task.type === 'respond' || task.orders?.stance === 'aggressive')), leaderId: task?.leaderId || (p.officerIds || [])[0] };
      this.departures.set(p.taskId, dep);
    }
    for (const id of p.officerIds || []) {
      const b = this.brains.get(id);
      if (!b || !b.a.alive || !b.a.world) continue;
      if (b.leaving) { b.leaving = false; }
      dep.members.add(id); b.departing = true; b.lockStatus = true;
      if (b.a.brain) b.script(this._departSeq(b, dep));
    }
    this.recomputeAssign();
    if (!dep.clerk && dep.members.size) {
      const c = [...this.brains.values()].find((b) => b.assign === 'duty2' && b.a.brain && !b.lockStatus && !(b.job && b.job.locked))
        || [...this.brains.values()].find((b) => b.assign === 'duty' && b.a.brain && !b.lockStatus && !(this.phone && this.phone.ans === b.a) && !(b.job && b.job.locked));
      if (c) { dep.clerk = c; c.script(this._clerkSeq(c, dep)); }
    }
    if (!dep.members.size) this._finishDepart(dep);
  }
  _departSeq(b, dep) {
    const rng = this.rng;
    return new Seq(b, [
      { do: (b) => { if (b.a.data.sleeping || b.job?.id === 'sleep') { const w = [...this.brains.values()].find((x) => dep.members.has(x.id) && x !== b && !x.a.data.sleeping); (w || b).say('wake_up'); } this.standUp(b.a); } },
      { wait: [0.2, b.has('lazy') ? 2.5 : b.has('hothead') ? 0.3 : 1.2] },
      { go: (b) => this.firstFree(COUNTER, b.a) || { x: 15.5 + rng.range(-1.2, 1.2), z: 11.4 }, run: dep.urgent, stand: true },
      { until: (b, dt, st) => !dep.clerk || dep.clerkReady || st.t > 6 },
      { do: (b) => {
        b.drawWeapon(); b.a.look.uniform = 'militia_coat'; b.a.look.hat = b.o.equipment?.helmet ? 'helmet' : 'cap';
        b.a.look.armor = !!(b.o.equipment?.armor && b.o.equipment.armor !== 'none'); b.a.playAnim('reload', 1.2);
        if (dep.clerk && dep.clerkReady && rng.chance(0.6)) this.say(dep.clerk.a, 'armory_issue'); else if (rng.chance(0.4)) b.say('armory_take');
        dep.armed.add(b.id);
      } },
      { wait: 1 },
      { do: (b) => { b.a.releasePoint(); if (b.id === dep.leaderId) b.say('depart_leader'); else if (rng.chance(0.35)) b.say('depart_member'); } },
      { go: (b) => this._boardSpot(dep, b), run: dep.urgent, claim: false },
      { do: (b) => this._board(b, dep) },
    ], { id: 'depart', label: 'собирается на выезд' });
  }
  _clerkSeq(c, dep) {
    return new Seq(c, [
      { go: 'armory_clerk', stand: true, run: dep.urgent },
      { do: () => { dep.clerkReady = true; } },
      { until: () => [...dep.members].every((id) => dep.armed.has(id) || dep.boarded.has(id) || !this.byOfficer.has(id)), timeout: 45 },
      { wait: 1.5 },
    ], { id: 'clerk', label: 'выдаёт оружие' });
  }
  _boardSpot(dep, b) {
    if (!dep.vehicle || !this.world.points[dep.vehicle]) return this.nearestSpawn(b.a);
    const vp = this.world.points[dep.vehicle]; const k = [...dep.members].indexOf(b.id);
    return { x: vp.x + BOARD_OFS[Math.max(0, k) % BOARD_OFS.length], z: vp.z - 0.1, yaw: 0 };
  }
  _board(b, dep) {
    if (dep.vehicle && this.rng.chance(0.4)) b.say('board_vehicle');
    this.audio('car_door', b.a.x, b.a.z, 0.8);
    dep.boarded.add(b.id); b.departing = false;
    this.removeOfficerActor(b.id);
  }
  _updateDeparture(dep, dt) {
    dep.t += dt;
    const remaining = [...dep.members].filter((id) => !dep.boarded.has(id) && this.byOfficer.has(id) && this.byOfficer.get(id).alive);
    if (!remaining.length) return this._finishDepart(dep);
    if (dep.t > 120) for (const id of remaining) { const b = this.brains.get(id); if (b) { this.stats.teleports++; this._board(b, dep); } }
  }
  _finishDepart(dep) {
    if (dep.done) return; dep.done = true;
    this.departures.delete(dep.taskId);
    if (dep.vehicle) {
      this.world.vehicleState = this.world.vehicleState || {}; this.world.vehicleState[dep.vehicle] = 'away';
      this.game.bus?.emit('vehicle', { id: dep.vehicle, state: 'away' });
      const vp = this.world.points[dep.vehicle]; if (vp) this.audio('car_engine', vp.x, vp.z, 1);
    }
    if (dep.clerk && dep.clerk.job && dep.clerk.job.id === 'clerk') dep.clerk.finishJob('done');
    const city = this.game.sim?.city; if (city && city.onDeparted) this._try(() => city.onDeparted(this.game, dep.taskId));
    this.game.bus?.emit('station:departed', { taskId: dep.taskId, vehicle: dep.vehicle });
    this.recomputeAssign();
  }
  onReturn(p) {
    if (!p || !p.taskId || this.returns.has(p.taskId)) return;
    const task = (this.game.state.city?.tasks || []).find((t) => t.id === p.taskId);
    const dead = new Set(p.dead || []);
    const vehicle = p.vehicle ?? task?.vehicle ?? (this.game.state.economy?.vehicles || []).find((v) => v.taskId === p.taskId)?.id ?? null;
    const ret = { taskId: p.taskId, vehicle, living: (p.officerIds || []).filter((id) => !dead.has(id)), wounded: new Set(p.wounded || []), dets: [...(p.detainees || [])],
      t: 0, i: 0, next: 0, spawned: [], spawnedAll: false, ops: [], reported: false };
    this.returns.set(p.taskId, ret);
    for (const id of ret.dets) this.newDetainees.delete(id);
    if (dead.size) this.mourn([...dead].map((id) => this.officer(id)).filter(Boolean));
    if (vehicle) {
      this.world.vehicleState = this.world.vehicleState || {}; this.world.vehicleState[vehicle] = 'here';
      this.game.bus?.emit('vehicle', { id: vehicle, state: 'here' });
      const vp = this.world.points[vehicle]; if (vp) this.audio('car_engine', vp.x, vp.z, 1);
    }
    if (this.combat) { // во время боя — без церемоний
      for (const id of ret.living) { const o = this.officer(id); if (o) { const a = this.spawnOfficer(o, 'return', this._retSpot(ret, ret.i++)); a.brain = null; } }
      for (const did of ret.dets) { const d = this._det(did); if (d && d.status === 'cell') this.spawnPrisoner(d, 'cell'); }
      this._reportReturn(ret);
    }
  }
  _retSpot(ret, k) {
    const vp = ret.vehicle && this.world.points[ret.vehicle] ? this.world.points[ret.vehicle] : this.world.points.front_door_out;
    return { x: vp.x + BOARD_OFS[k % BOARD_OFS.length] * 0.9, z: vp.z - 0.2, yaw: Math.PI };
  }
  _updateReturn(ret, dt) {
    ret.t += dt;
    if (ret.t < 1.5) return;
    if (!ret.spawnedAll) {
      ret.next -= dt; if (ret.next > 0) return;
      ret.next = 0.6;
      const id = ret.living[ret.i];
      if (id !== undefined) {
        const o = this.officer(id);
        if (o && !this.byOfficer.has(id)) {
          const a = this.spawnOfficer(o, 'return', this._retSpot(ret, ret.i)); const b = this.brains.get(id);
          this.audio('car_door', a.x, a.z, 0.8); b.lockStatus = true; b.returning = ret.taskId;
          if (ret.wounded.has(id)) { a.data.wounded = true; a.data.speedMul = 0.5; }
          ret.spawned.push(b);
        }
        ret.i++; return;
      }
      ret.spawnedAll = true;
      this._startReturnScripts(ret);
      return;
    }
    if (!ret.reported && ret.ops.every((o) => o.finished) && ret.t > 3) this._reportReturn(ret);
  }
  _startReturnScripts(ret) {
    const healthy = ret.spawned.filter((b) => !b.a.data.wounded);
    const wounded = ret.spawned.filter((b) => b.a.data.wounded);
    // задержанные
    const pbs = [];
    ret.dets.forEach((did, k) => {
      const d = this._det(did); if (!d || d.status !== 'cell') return;
      const sp = this._retSpot(ret, ret.i + k + 1);
      const a = this.spawnPrisoner(d, 'escort', { x: sp.x, z: sp.z + 0.1, yaw: Math.PI });
      if (a.brain instanceof PrisonerBrain) { a.brain.mode = 'op'; pbs.push(a.brain); a.playAnim('cuff', 1); }
    });
    const escorts = healthy.slice().sort((x, y) => (y.id === ret.leaderId) - (x.id === ret.leaderId));
    const helpers = new Set();
    // раненых ведут
    for (const w of wounded) {
      const h = escorts.find((e) => !helpers.has(e) && escorts.length - helpers.size > (pbs.length ? 1 : 0));
      if (h) helpers.add(h);
      w.script(this._woundedSeq(w));
      if (h) h.script(this._helperSeq(h, w));
    }
    if (pbs.length) {
      const free = escorts.filter((e) => !helpers.has(e));
      if (free.length) { this.say(free[0].a, 'return_detainee'); ret.ops.push(this._escortOp(free[0], pbs)); }
      else ret.ops.push(this._escortOrTeleport(pbs, null));
    }
    for (const b of escorts) if (!helpers.has(b) && !(b.job && b.job.id === 'escort')) b.script(this._handInSeq(b));
  }
  _reportReturn(ret) {
    ret.reported = true; this.returns.delete(ret.taskId);
    const city = this.game.sim?.city; if (city && city.onReturned) this._try(() => city.onReturned(this.game, ret.taskId));
    for (const b of ret.spawned) if (b.a.world) { b.returning = null; if (!(b.job && b.job.locked && b.job.id !== 'wounded')) b.lockStatus = false; else if (b.job.id === 'wounded') b.lockStatus = false; }
    this.game.bus?.emit('station:returned', { taskId: ret.taskId });
  }
  _handInSeq(b) {
    return new Seq(b, [
      { do: (b) => { if (this.rng.chance(0.5)) b.say('return_arrive'); } },
      { go: (b) => this.firstFree(COUNTER, b.a) || { x: 15.5 + this.rng.range(-1, 1), z: 11.4 }, stand: true },
      { hold: [1.5, 2.5], start: (b) => { b.a.playAnim('reload', 1); if (this.rng.chance(0.4)) b.say('armory_hand', { n: this.rng.int(4, 30) }); } },
      { do: (b) => { b.a.look.weapon = 'none'; b.a.look.armor = false; b.a.look.hat = 'none'; b.a.look.uniform = 'militia'; if (!b.returning) b.lockStatus = false; } },
    ], { id: 'hand_in', label: 'сдаёт оружие' });
  }
  _woundedSeq(w) {
    return new Seq(w, [
      { do: (b) => b.say('return_wounded') },
      { go: (b) => (this.isFree('tv_sofa_1', b.a) && this.isFree('tv_sofa_2', b.a) ? 'tv_sofa_1' : this.firstFree(['corridor_bench', 'rest_chair', 'tv_armchair'], b.a) || 'v_rest_stand_1') },
      { do: (b) => { if (b.a.claimedPoint === 'tv_sofa_1' && this.claimExtra(['tv_sofa_2', 'v_sofa_lie'], b.a)) { const s = SPOTS.v_sofa_lie; b.a.x = s.x; b.a.z = s.z; b.a.yaw = s.yaw; b.a.y = s.y; b.a.pose = 'lie'; b.a.data.lieOn = 'sofa'; } b.a.look.weapon = 'none'; b.a.look.armor = false; } },
      { hold: 420 },
    ], { id: 'wounded', label: 'ранен, ждёт врача' });
  }
  _helperSeq(h, w) {
    return new Seq(h, [
      { do: (b) => b.say('return_helper') },
      { until: (b, dt, st) => {
        st.r = (st.r || 0) - dt;
        if (st.r <= 0) { st.r = 0.8; this.go(b.a, { x: w.a.x + 0.7, z: w.a.z + 0.3 }, { claim: false, snap: false, stopDist: 0.3 }); b.a.data.speedMul = 0.55; }
        return !w.a.world || (w.job && w.job.holding) || st.t > 70;
      } },
      { do: (b) => { b.a.data.speedMul = 1; } },
    ], { id: 'help', label: 'ведёт раненого', onEnd: (b) => { b.script(this._handInSeq(b)); } });
  }

  // ═══════════════ Конвой, допрос, освобождение ═══════════════
  _waitOpSeq(b, op, id, label) { return new Seq(b, [{ until: () => op.finished }], { id, label }); }
  /** Конвой задержанных в камеры (escort — OfficerBrain, prisoners — PrisonerBrain[]) */
  _escortOp(eb, pbs) {
    const esc = eb.a; const groups = new Map();
    for (const pb of pbs) { if (!groups.has(pb.cell)) groups.set(pb.cell, []); groups.get(pb.cell).push(pb); }
    const steps = [{ do: () => { esc.data.speedMul = 0.85; this.say(esc, 'escort_cmd'); for (const pb of pbs) { pb.a.data.cuffed = true; pb.mode = 'op'; } } }];
    const p0 = pbs[0].a;
    if (dist(esc.x, esc.z, p0.x, p0.z) > 3) steps.push({ move: [[esc, { x: p0.x + 0.9, z: p0.z - 0.5 }, { claim: false }]], timeout: 60 });
    steps.push({ do: () => { if (this.rng.chance(0.5)) this.say(pbs[0].a, 'prisoner_escorted'); } });
    steps.push({ move: [...pbs.map((pb, i) => [pb.a, i < 3 ? `v_ivs_wait_${i + 1}` : { x: 21 + i * 0.5, z: 8.2 }, { claim: false }]), [esc, { x: 22.4, z: 8.9 }, { claim: false }]], timeout: 70 });
    for (const [cell, ps] of groups) {
      const g = cellGeom(cell);
      steps.push({ move: [...ps.map((pb, k) => [pb.a, k === 0 ? { x: g.cx, z: 5.5, yaw: Math.PI } : { x: g.cx + (k === 1 ? -0.8 : 0.8), z: 6.1 }, { claim: false }]), [esc, { x: g.cx + 1.1, z: 6.5, yaw: -2.4 }, { claim: false }]], timeout: 30 });
      steps.push({ do: () => { this.world.setCellDoor(cell, true); this.audio('cell_door', g.cx, 4.5, 1); this.say(esc, 'cell_open'); } });
      steps.push({ wait: 0.6 });
      steps.push({ move: ps.map((pb) => [pb.a, this.cellSlotTarget(cell, pb.a)]), timeout: 14 });
      steps.push({ do: () => {
        for (const pb of ps) if (!inCell(cell, pb.a.x, pb.a.z)) this.teleport(pb.a, { x: g.cx, z: 2.6 });
        if (esc.z < 4.6) { esc.x = g.cx + 1.1; esc.z = 6.4; }
        this.world.setCellDoor(cell, false); this.audio('cell_door', g.cx, 4.5, 1); this.say(esc, 'cell_close'); esc.playAnim('cuff', 1);
        for (const pb of ps) { pb.cell = cell; pb.settle(); }
      } });
    }
    steps.push({ do: () => { esc.data.speedMul = 1; } });
    const op = new Op(this, steps, { actors: [esc, ...pbs.map((p) => p.a)], kind: 'escort',
      onDone: () => { if (eb.job && eb.job.id === 'escort') eb.finishJob('done'); eb.script(this._handInSeq(eb)); },
      onAbort: () => { this._fixPrisoners(pbs); if (eb.job && eb.job.id === 'escort') eb.finishJob('fail'); esc.data.speedMul = 1; } });
    eb.script(this._waitOpSeq(eb, op, 'escort', 'конвоирует задержанного'));
    this.ops.push(op);
    return op;
  }
  _fixPrisoners(pbs) {
    for (const pb of pbs) {
      if (!pb.a.alive || !pb.a.world) continue;
      for (const c of CELL_IDS) if (this.world.openCellDoors.has(c) && !this.combat) this.world.setCellDoor(c, false);
      if (!inCell(pb.cell, pb.a.x, pb.a.z) && !this.combat) { this.halt(pb.a); const g = cellGeom(pb.cell); pb.a.x = g.cx; pb.a.z = 2.6; this.stats.teleports++; }
      pb.settle();
    }
  }
  /** Найти свободного сотрудника для конвоя; если нет — «телепорт» в камеру */
  _escortOrTeleport(pbs, exclude) {
    const cand = [...this.brains.values()].filter((b) => b !== exclude && b.a.brain && !b.lockStatus && !(b.job && b.job.locked) && !b.a.data.wounded && b.assign !== 'duty')
      .sort((x, y) => (y.assign === 'guard') - (x.assign === 'guard') || dist(x.a.x, x.a.z, pbs[0].a.x, pbs[0].a.z) - dist(y.a.x, y.a.z, pbs[0].a.x, pbs[0].a.z))[0];
    if (cand) return this._escortOp(cand, pbs);
    const op = new Op(this, [{ do: () => this._fixPrisoners(pbs) }], { kind: 'teleport' });
    this.ops.push(op); return op;
  }
  _newDetainees() {
    for (const [id, t] of this.newDetainees) {
      if (this.clock - t < 3) continue;
      this.newDetainees.delete(id);
      const d = this._det(id); if (!d || d.status !== 'cell' || this.byDetainee.has(id) || this._pendingDet(id)) continue;
      const sp = this.world.points.front_door_out;
      const a = this.spawnPrisoner(d, 'escort', { x: sp.x, z: sp.z + 0.6, yaw: Math.PI });
      this._escortOrTeleport([a.brain], null);
    }
  }
  canInterrogate() {
    if (this.interrogating || !this.isFree('interrogation') || !this.isFree('interrogation_suspect')) return false;
    return !!this._interrogCandidate();
  }
  _interrogCandidate() {
    for (const a of this.byDetainee.values()) { const pb = a.brain; if (pb instanceof PrisonerBrain && pb.mode === 'resident' && !pb.hold && !pb.talk && this.interrogated[pb.detId] !== this.shiftNo) return pb; }
    return null;
  }
  startInterrogation(b) {
    const pb = this._interrogCandidate(); if (!pb) return null;
    const pa = pb.a, oa = b.a, cell = pb.cell, g = cellGeom(cell), det = this._det(pb.detId);
    this.interrogating = pb.detId; this.interrogated[pb.detId] = this.shiftNo;
    const coop = det?.cooperation ?? 40;
    const lines = [];
    for (let k = 0; k < 3 + this.rng.int(0, 2); k++) { lines.push([oa, 'interrog_q']); lines.push([pa, coop > 55 && k >= 1 && this.rng.chance(0.6) ? 'prisoner_interrog_talk' : 'prisoner_interrog_deny']); }
    const steps = [
      { do: () => { pb.mode = 'op'; pb.job = null; this.standUp(pa); } },
      { move: [[oa, g.front, { stand: true }]], timeout: 60 },
      { do: () => { this.world.setCellDoor(cell, true); this.audio('cell_door', g.cx, 4.5, 1); this.say(oa, 'escort_cmd'); } },
      { move: [[pa, { x: g.cx - 0.7, z: 6.0 }, { claim: false }], [oa, { x: g.cx + 0.7, z: 6.3 }, { claim: false }]], timeout: 14 },
      { do: () => { if (!this.cellmates(pb).length || true) this.world.setCellDoor(cell, false); this.audio('cell_door', g.cx, 4.5, 1); pa.data.cuffed = true; } },
      { move: [[pa, 'interrogation_suspect'], [oa, 'interrogation']], timeout: 70 },
      { do: (op) => { op.data.i = 0; op.data.t = 0.5; pa.data.cuffed = false; } },
      { until: (op, dt) => {
        op.data.t -= dt; if (op.data.t > 0) return false;
        const L = lines[op.data.i++]; if (!L) return true;
        const txt = this.say(L[0], L[1], {}, L[0] === oa ? pa : oa); L[0].playAnim(L[0] === oa ? 'write' : 'talk', 2);
        op.data.t = txt ? speechDur(txt) + 0.4 : 1; return false;
      }, timeout: 120 },
      { do: () => {
        const D = this.game.sim?.detainees;
        if (this.opts.autoInterrogate && D && D.interrogate) {
          const approach = b.has('sadist') ? 'hard' : b.has('kind') ? 'soft' : b.has('talker') ? 'deal' : 'soft';
          const r = this._try(() => D.interrogate(this.game, pb.detId, approach));
          const intel = r && r.intel ? (Array.isArray(r.intel) ? r.intel.length : 1) : 0;
          this._log(`${oa.name} допросил${b.o.gender === 'f' ? 'а' : ''} задержанного ${det ? det.person.lastName : ''}${intel ? ' — есть информация' : ' — без результата'}.`, 'interrogation');
        }
        pa.data.cuffed = true;
      } },
      { move: [[pa, { x: g.cx - 0.7, z: 6.0 }, { claim: false }], [oa, { x: g.cx + 0.8, z: 6.4 }, { claim: false }]], timeout: 70 },
      { do: () => { this.world.setCellDoor(cell, true); this.audio('cell_door', g.cx, 4.5, 1); } },
      { move: [[pa, this.cellSlotTarget(cell, pa)]], timeout: 14 },
      { do: () => { if (!inCell(cell, pa.x, pa.z)) this.teleport(pa, { x: g.cx, z: 2.6 }); if (oa.z < 4.6) { oa.x = g.cx + 1; oa.z = 6.4; } this.world.setCellDoor(cell, false); this.audio('cell_door', g.cx, 4.5, 1); this.say(oa, 'cell_close'); pb.settle(); } },
    ];
    const op = new Op(this, steps, { actors: [oa, pa], kind: 'interrogation',
      onDone: () => { this.interrogating = null; },
      onAbort: () => { this.interrogating = null; this._fixPrisoners([pb]); } });
    this.ops.push(op);
    return new Seq(b, [{ until: () => op.finished }], { id: 'interrogate', label: 'допрашивает задержанного', locked: true, def: ACT_BY_ID.interrogate });
  }
  _releaseOp(pb, status) {
    const pa = pb.a, cell = pb.cell, g = cellGeom(cell); pa.data.leaving = true; pb.mode = 'op'; pb.job = null;
    const eb = [...this.brains.values()].filter((b) => b.a.brain && !b.lockStatus && !(b.job && b.job.locked) && b.assign !== 'duty' && !b.a.data.wounded)
      .sort((x, y) => (y.assign === 'guard') - (x.assign === 'guard') || dist(x.a.x, x.a.z, g.cx, 6) - dist(y.a.x, y.a.z, g.cx, 6))[0] || null;
    const esc = eb ? eb.a : null;
    const steps = [
      esc ? { move: [[esc, g.front, { stand: true }]], timeout: 60 } : null,
      { do: () => { this.standUp(pa); this.world.setCellDoor(cell, true); this.audio('cell_door', g.cx, 4.5, 1); if (esc) this.say(esc, 'release_cmd', { vgender: pa.look.gender }); } },
      { move: [[pa, { x: g.cx, z: 6.0 }, { claim: false }], esc ? [esc, { x: g.cx + 1, z: 6.4 }, { claim: false }] : null].filter(Boolean), timeout: 14 },
      { do: () => { this.world.setCellDoor(cell, false); this.audio('cell_door', g.cx, 4.5, 1); } },
      { move: [[pa, 'front_door_in', { claim: false }], esc ? [esc, { x: 16.25, z: 16.2 }, { claim: false }] : null].filter(Boolean), timeout: 70 },
      { do: () => { if (status === 'released') this.say(pa, 'prisoner_released'); } },
      { move: [[pa, 'front_door_out', { claim: false }]], timeout: 25 },
      { move: [[pa, this.nearestSpawn(pa), { claim: false }]], timeout: 45 },
    ];
    const op = new Op(this, steps, { actors: [pa], kind: 'release',
      onDone: () => { this._removePrisoner(pb); if (eb && eb.job && eb.job.id === 'release') eb.finishJob('done'); },
      onAbort: () => { this._removePrisoner(pb); if (eb && eb.job && eb.job.id === 'release') eb.finishJob('fail'); } });
    if (eb) eb.script(this._waitOpSeq(eb, op, 'release', status === 'transferred' ? 'передаёт задержанного конвою' : 'выпускает задержанного'));
    this.ops.push(op);
  }
  _removePrisoner(pb) { const a = pb.a; this.byDetainee.delete(pb.detId); a.visible = false; a.brain = null; this.halt(a); a.releasePoint(); this.toRemove.push(a); }
  guardAtCell(b, cell) {
    const pbs = this.cellmates({ cell }).filter((p) => p.mode === 'resident');
    const asker = pbs.find((p) => !p.smokeUntil && this.clock - p.lastTalk > 20);
    if (!asker || !this.rng.chance(0.45)) return;
    asker.lastTalk = this.clock; this.say(asker.a, 'prisoner_smoke_ask');
    this.after(2.5, () => {
      if (!b.a.world) return;
      const yes = (b.has('kind') || (b.disc < 0.5 && this.rng.chance(0.5))) && !b.has('sadist');
      b.say(yes ? 'guard_smoke_yes' : 'guard_smoke_no');
      if (yes) { b.a.playAnim('wave', 1); asker.giveSmoke(40); this.after(2.5, () => asker.a.world && this.say(asker.a, 'prisoner_smoking')); }
    });
  }
  onPrisonerDied(pb) { this.game.bus?.emit('station:prisoner_dead', { detaineeId: pb.detId }); }

  // ═══════════════ Посетители ═══════════════
  onVisitor(v) {
    if (!v) return;
    if (!v.id) v.id = 'v_' + Math.floor(this.rng.next() * 1e9).toString(36);
    const per = v.person || { gender: 'm', firstName: '', lastName: '' };
    const sp = this.world.points[this.rng.pick(SPAWNS)];
    const look = { uniform: per.gender === 'f' ? 'civil_f' : 'civil_m', gender: per.gender || 'm', skin: 0, hair: 0, build: 1, hat: 'none', weapon: 'none', armor: false, ...(v.look || {}) };
    const a = new Actor({ team: 'civil', personId: v.id, name: `${per.lastName || 'Посетитель'}`, look, x: sp.x, z: sp.z, yaw: sp.yaw ?? 0 });
    a.data.person = per; a.data.visitor = true; a.data.mood = v.mood;
    a.walkSpeed = { angry: 1.55, drunk: 1.0, crying: 1.05, scared: 1.4, shifty: 1.3, calm: 1.3 }[v.mood] || 1.3;
    if (v.mood === 'drunk') a.data.speedMul = 0.8;
    this.world.addActor(a);
    const vb = new VisitorBrain(this, a, v); a.brain = vb; this.visitors.add(vb);
    if (this.combat) vb.combatTick(0);
    this.game.bus?.emit('station:visitor', { visitorId: v.id, actorId: a.id });
    return a;
  }
  visitorInside(vb) {
    if (!this.reception && !this.queue.length && this.isFree('visitor_window', vb.a)) { vb.toWindow(); }
    else { this.queue.push(vb); vb.toQueue(); }
  }
  receptionStart(vb) { if (this.reception && this.reception.vb !== vb) { this.queue.unshift(vb); vb.toQueue(); return; } this.reception = { vb, i: 0, t: 1.2, stage: 'talk', waitT: 0, emptyT: 4 }; vb.waitT = 0; }
  _endReception() {
    this.reception = null;
    const next = this.queue.shift();
    if (next && next.phase === 'queue') next.toWindow();
  }
  visitorGiveUp(vb) {
    if (vb.resolved) return; vb.resolved = true;
    this.game.bus?.emit('visitor:choice', { visitor: vb.v, visitorId: vb.v.id, choiceId: null, choice: null, by: 'nobody' });
    this._log(`Посетитель ушёл, не дождавшись приёма (${vb.v.complaint || 'обращение'}).`, 'visitor');
    if (this.reception && this.reception.vb === vb) this._endReception();
    this.queue = this.queue.filter((q) => q !== vb);
    vb.leave('visitor_ignored');
  }
  _byeKey(vb) { return 'visitor_bye_' + ({ angry: 'angry', crying: 'crying', drunk: 'drunk', scared: 'scared', shifty: 'shifty' }[vb.v.mood] || 'calm'); }
  _updateReception(dt) {
    const r = this.reception; if (!r) return;
    const vb = r.vb, va = vb.a, v = vb.v;
    if (!va.world || vb.phase === 'gone' || vb.resolved) { if (this.reception === r) this._endReception(); return; }
    if (vb.talk) return; // с посетителем говорит командир
    const duty = this.deskActor();
    if (!duty) { r.emptyT -= dt; if (r.emptyT <= 0) { r.emptyT = 12; this.say(va, 'duty_v_empty'); } return; }
    duty.data.talkTo = va.id; va.data.talkTo = duty.id;
    r.t -= dt; if (r.t > 0) return;
    const P = this.frame.player;
    if (r.stage === 'talk') {
      const k = r.i++; const vl = v.lines || [];
      if (k % 2 === 0) {
        const line = vl[k / 2];
        if (line === undefined || k / 2 >= 3) { r.stage = 'decide'; r.t = 0.5; return; }
        va.say(String(line), speechDur(line)); va.playAnim(v.mood === 'angry' ? 'wave' : 'talk', 2); r.t = speechDur(line) + 0.3;
      } else {
        const key = 'duty_v_' + ({ angry: 'angry', crying: 'crying', drunk: 'drunk', scared: 'scared', shifty: 'shifty' }[v.mood] || 'calm');
        const t = this.say(duty, key, { vgender: v.person?.gender }); duty.playAnim('talk', 2); r.t = (t ? speechDur(t) : 2) + 0.3;
      }
      return;
    }
    if (r.stage === 'decide') {
      const serious = (v.crime && (v.crime.severity || 0) >= 3) || v.mood === 'angry' || v.isFake;
      if ((v.choices || []).length && serious && P && this.world.zone(P.zone)?.indoor && !r.asked) {
        r.asked = true; this.say(duty, 'duty_calls_boss', { vgender: v.person?.gender }); r.stage = 'wait'; r.waitT = 0; r.t = 1;
        this.game.bus?.emit('visitor:needs_boss', { visitor: v, visitorId: v.id });
        return;
      }
      return this._autoResolve(duty, vb);
    }
    if (r.stage === 'wait') { r.waitT += 1; r.t = 1; if (r.waitT > 45) this._autoResolve(duty, vb); }
  }
  _autoResolve(duty, vb) {
    const ch = vb.v.choices || []; const db = duty.brain;
    const find = (re) => ch.find((c) => re.test(c.label || c.id || ''));
    let c = null;
    if (db && (db.has('lazy') || db.disc < 0.35)) c = find(/отказ|прогн|выгн|домой|потом|понедельник|не принимать/i);
    if (!c && db && db.has('greedy') && (db.o.hidden?.corruption ?? 0) > 60) c = find(/взят|деньг|договор/i);
    if (!c && vb.v.mood === 'drunk' && db && (db.has('sadist') || db.has('pedant'))) c = find(/задерж|камер|вытрезв/i);
    if (!c) c = find(/принят|завест|оформ|выслат|наряд|помоч|разобр|записа/i) || ch[0] || null;
    duty.playAnim('write', 3);
    this.resolveVisitor(vb.v.id, c ? c.id : null, 'duty');
  }

  // ═══════════════ Телефон ═══════════════
  _updatePhone(dt) {
    if (!this.phone && this.phoneQ.length) this.phone = { call: this.phoneQ.shift().call, t: 0, stage: 'ring', ringT: 0, ansT: 0, ans: null, i: 0 };
    const ph = this.phone; if (!ph) return;
    ph.t += dt; const desk = this.world.points.duty_desk;
    if (ph.stage === 'ring') {
      ph.ringT -= dt; if (ph.ringT <= 0) { ph.ringT = 2.5; this.audio('phone_ring', 23.3, 17.8, 1); }
      const a = this.deskActor();
      if (a) {
        ph.ansT += dt;
        const delay = a.data.dozing ? 3.5 : (a.brain && a.brain.has('lazy') ? 2.6 : 1.4);
        if (ph.ansT >= delay) {
          const doz = a.data.dozing; a.data.dozing = false;
          ph.stage = 'talk'; ph.ans = a; ph.t = 0; ph.i = 0; ph.next = 0;
          this.audio('phone_pickup', desk.x, desk.z, 1);
          a.data.idleAnim = 'phone'; a.data.holding = 'phone'; a.playAnim('phone', 2);
          this.say(a, doz ? 'phone_pickup_dozing' : 'phone_pickup'); ph.next = 3.2;
          this.game.bus?.emit('call:answered', { call: ph.call, officerId: a.officerId, actorId: a.id });
        }
      } else if (ph.t > 4 && !ph.shouted) {
        ph.shouted = true;
        const near = [...this.brains.values()].find((b) => b.a.world && b.a.brain && b.a.zone === 'duty' && !(b.job && b.job.locked));
        if (near) near.say('phone_run');
      }
      if (ph.t > 32) {
        this.game.bus?.emit('call:missed', { call: ph.call });
        this._log('Звонок в дежурную часть остался без ответа.', 'call');
        this.phone = null;
      }
      return;
    }
    if (ph.stage === 'talk') {
      const a = ph.ans;
      if (!a || !a.world || !a.alive) { this.phone = null; return; }
      a.playAnim('phone', 0.5);
      ph.next -= dt; if (ph.next > 0) return;
      const n = (ph.call.lines || []).length;
      const mids = n > 2 ? 2 : 1;
      if (ph.i < mids) { const t = this.say(a, 'phone_mid'); ph.next = (t ? speechDur(t) : 2.5) + 1.5; ph.i++; return; }
      if (ph.i === mids) { const t = this.say(a, 'phone_end'); ph.next = (t ? speechDur(t) : 2) + 0.5; ph.i++; return; }
      a.data.idleAnim = 'write'; a.data.holding = null; a.playAnim('write', 4);
      this.audio('phone_pickup', desk.x, desk.z, 0.6);
      this.after(4.5, () => { if (a.data.idleAnim === 'write') a.data.idleAnim = null; });
      this.phone = null;
    }
  }

  // ═══════════════ Тревога, свет, ТВ, утраты ═══════════════
  onShot(p) {
    if (this.combat) return;
    const by = p.by; const shooter = typeof by === 'string' ? this.world.actorById(by) : by;
    const isPlayer = by === 'player' || (shooter && shooter.team === 'player') || (this.game.player && shooter === this.game.player.actor);
    if (isPlayer) { this._barkSome('player_shot', 1, 1.5, (b) => dist(b.a.x, b.a.z, p.x ?? 16, p.z ?? 10) < 15); return; }
    if (shooter && shooter.team === 'police') return;
    if (typeof p.x === 'number' && dist(p.x, p.z, 16, 10) > 70) return;
    if (this.alarm) { this.alarm.until = this.clock + 40; return; }
    this.alarm = { until: this.clock + 40, x: p.x ?? 16, z: p.z ?? 26 };
    this.game.bus?.emit('station:alarm', { on: true, x: this.alarm.x, z: this.alarm.z });
    const duty = this.deskActor();
    if (duty) {
      this.say(duty, 'alarm_duty');
      if (this.game.sim?.city?.radio) this._try(() => this.game.sim.city.radio(this.game, { from: 'duty', fromName: duty.name, callsign: 'Заря', text: 'Гранит, я Заря. У отдела стрельба, личный состав поднят по тревоге.', kind: 'alarm' }));
    }
    this._log('Стрельба у отдела. Личный состав поднят по тревоге.', 'alarm');
    let k = 0;
    for (const b of this.brains.values()) {
      if (!b.a.alive || !b.a.world || !b.a.brain || b.lockStatus || (b.job && b.job.locked)) continue;
      if (b.a === duty) continue;
      if (b.assign === 'guard' && b.job && b.job.id === 'ivs_guard') { b.drawWeapon(); continue; }
      b.script(this._alarmSeq(b, k++));
    }
    for (const vb of this.visitors) if (vb.phase === 'queue' || vb.phase === 'window') { vb.a.pose = 'crouch'; vb.a.data.hiding = true; if (this.rng.chance(0.5)) vb.say('visitor_hide'); }
  }
  _alarmSeq(b, k) {
    const al = this.alarm;
    return new Seq(b, [
      { do: (b) => { this.standUp(b.a); b.say(b.courage < 0.35 ? 'alarm_fear' : k === 0 ? 'alarm_shots' : 'alarm_brave'); } },
      b.a.look.weapon === 'none' ? { go: (b) => this.firstFree(COUNTER, b.a) || { x: 15.5 + this.rng.range(-1, 1), z: 11.3 }, run: true, stand: true } : null,
      { do: (b) => { b.drawWeapon(); b.a.playAnim('reload', 1); } },
      { go: (b) => this.firstFree(ALARM_POSTS.slice().sort((x, y) => { const px = this.world.points[x], py = this.world.points[y]; return dist(b.a.x, b.a.z, px.x, px.z) - dist(b.a.x, b.a.z, py.x, py.z); }), b.a) || 'post_corridor_c', run: true, stand: true },
      { hold: 999, start: (b) => { b.a.pose = 'crouch'; b.a.data.aiming = true; b.a.faceTo(al.x, al.z); }, tick: () => (!this.alarm ? 'done' : undefined) },
    ], { id: 'alarm', label: 'по тревоге', onEnd: (b) => { this.standUp(b.a); b.a.data.aiming = false; this.after(this.rng.range(6, 14), () => { if (b.a.world && !this.alarm && !this.combat && !(b.job && b.job.id === 'depart')) b.a.look.weapon = 'none'; }); } });
  }
  _updateAlarm() {
    if (!this.alarm || this.clock < this.alarm.until) return;
    this.alarm = null;
    const duty = this.deskActor(); if (duty) this.say(duty, 'alarm_calm'); else this._barkSome('alarm_calm', 1, 2);
    for (const vb of this.visitors) if (vb.a.data.hiding) { vb.a.pose = 'stand'; vb.a.data.hiding = false; }
    this.game.bus?.emit('station:alarm', { on: false });
  }
  onPower(on) {
    if (on === this.power) return;
    this.power = on;
    for (const b of this.brains.values()) if (b.a.world) b.a.data.flashlight = !on;
    if (!on) {
      this._barkSome('power_off', 2, 4);
      this.genAt = this.opts.generatorRestoresPower && !this.combat ? this.clock + 10 : 0;
      for (const b of this.brains.values()) if (b.job && b.job.id === 'tv' && !b.job.locked) { b.endJob('power'); if (this.rng.chance(0.4)) b.say('tv_off'); }
    } else { this.genAt = 0; this._barkSome('power_on', 1, 2); }
  }
  _startGenerator() {
    this.genAt = 0;
    const cands = [...this.brains.values()].filter((b) => b.a.world && b.a.brain && !b.lockStatus && !(b.job && b.job.locked) && b.assign !== 'duty');
    const b = cands.find((x) => x.role === 'driver') || cands.find((x) => x.has('pedant')) || cands[0];
    if (!b) return;
    this.genBusy = true;
    b.script(new Seq(b, [
      { do: (b) => b.say('power_generator') },
      { go: 'generator', stand: true },
      { hold: 8, tick: (b, dt, st) => { st.k = (st.k ?? 0) - dt; if (st.k <= 0) { st.k = 2; b.a.playAnim('reload', 1); } } },
      { do: (b) => {
        const fuel = this.game.state.economy?.fuel;
        if (typeof fuel === 'number' && fuel <= 0) { b.say('power_no_fuel'); return; }
        this.audio('generator_start', 29.8, 4, 1);
        if (!this.power) this.game.bus?.emit('power', { on: true, source: 'generator' });
      } },
    ], { id: 'generator', label: 'заводит дизель', onEnd: () => { this.genBusy = false; } }));
  }
  _updateTV(dt) {
    const watchers = [...this.brains.values()].filter((b) => b.job && b.job.id === 'tv' && b.job.holding && b.a.brain);
    const on = this.power && watchers.length > 0;
    if (on !== this.tvOn) { this.tvOn = on; this.game.bus?.emit('station:tv', { on }); }
    if (!on) return;
    this.tvT -= dt; if (this.tvT > 0) return;
    this.tvT = this.rng.range(18, 32);
    const w = watchers.find((b) => !b.hold); if (!w) return;
    const news = this._news();
    const key = news && this.rng.chance(0.3) ? 'tv_news' : 'tv_' + (this.frame.deep ? 'night' : this.frame.tod);
    w.say(BARK_TV[key] ? key : 'tv_day');
  }
  mourn(officers) {
    const names = officers.map((o) => dispName(o));
    if (!names.length) return;
    this.mourning = { until: this.clock + 200, dead: names, dg: officers[0].gender };
    this._barkSome('comrade_dead', 3, 25);
  }
  onOfficerDied(b) {
    if (this.combat) return;
    this.mourn([b.o]);
  }

  // ═══════════════ Болтовня ═══════════════
  findChatPartner(b) {
    let best = null, bs = -1;
    for (const o of this.brains.values()) {
      if (o === b || !o.a.alive || !o.a.world || !o.a.brain || o.hold || o.talk || o.lockStatus) continue;
      if (o.job && (o.job.locked || !o.job.def || !o.job.def.leisure || !o.job.holding)) continue;
      if (!o.job && o.a.moving) continue;
      if (o.a.data.sleeping) continue;
      const d = dist(b.a.x, b.a.z, o.a.x, o.a.z); if (d > 16) continue;
      if (o.has('silent') && this.rng.chance(0.6)) continue;
      const rel = ((b.o.relations && b.o.relations[o.id]) || 0) / 100;
      const s = rel * 0.5 + (1 - d / 16) * 0.6 + this.rng.next() * 0.2;
      if (s > bs) { bs = s; best = o; }
    }
    return best;
  }
  neighborForChat(b, r) {
    for (const o of this.brains.values()) {
      if (o === b || !o.a.world || !o.a.brain || o.hold || o.talk || o.lockStatus || o.a.data.sleeping) continue;
      if (!o.job || !o.job.def || !o.job.def.leisure || !o.job.holding) continue;
      if (dist(b.a.x, b.a.z, o.a.x, o.a.z) < r && this.clock - o.lastConv > 20) return o;
    }
    return null;
  }
  _spotNear(t, from) {
    const base = Math.atan2(from.x - t.x, from.z - t.z);
    for (const r of [1.05, 1.3]) for (const da of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
      const ang = base + da; const x = t.x + Math.sin(ang) * r, z = t.z + Math.cos(ang) * r;
      if (!this.world.isWalkable(x, z) || this.world._clearance(x, z) < 0.35) continue;
      if (this.world.actors.some((a) => a !== from && a !== t && a.alive && dist(a.x, a.z, x, z) < 0.6)) continue;
      if (this.world.doors.some((d) => x > d.rect[0] - 0.3 && x < d.rect[2] + 0.3 && z > d.rect[1] - 0.3 && z < d.rect[3] + 0.3)) continue;
      return { x, z, yaw: yawTo(x, z, t.x, t.z) };
    }
    return null;
  }
  planChat(b, def) {
    const o = this.findChatPartner(b); if (!o) return null;
    const s = this._spotNear(o.a, b.a); if (!s) return null;
    const id = 'dyn_' + b.a.id; this.dyn[id] = { ...s, kind: 'stand' };
    return new Seq(b, [
      { go: id, stand: true },
      { do: (b) => {
        if (o.hold || o.talk || !o.a.world || !o.a.brain || dist(b.a.x, b.a.z, o.a.x, o.a.z) > 2.4) return false;
        b.say('chat_invite', {}, o.a);
        this.startConv(b, o, {});
        return true;
      } },
      { until: (b) => !b.hold || b.hold.done, timeout: 90 },
    ], { id: def.id, label: def.label, def, onEnd: (b) => { b.a.data.talkTo = null; } });
  }
  smokeSpotNear(b) {
    if (b.has('silent') || b.needs.social < 0.25) return null;
    for (const o of this.brains.values()) {
      if (o === b || !o.job || o.job.id !== 'smoke' || !o.job.holding) continue;
      let best = null, bd = 3.2;
      for (const id of SMOKE_IDS) { const p = this.pt(id); const d = dist(p.x, p.z, o.a.x, o.a.z); if (d > 0.3 && d < bd && this.isFree(id, b.a)) { bd = d; best = id; } }
      if (best) return best;
    }
    return null;
  }
  startConv(b1, b2, o = {}) {
    const A = this.speakerOf(b1.a), B = this.speakerOf(b2.a); const f = this.frame;
    const whisper = f.night && (f.deep || [...this.brains.values()].some((x) => x.a.data.sleeping && dist(x.a.x, x.a.z, b1.a.x, b1.a.z) < 8));
    const P = f.player; const bossFar = !P || dist(P.x, P.z, b1.a.x, b1.a.z) > 10;
    const conv = conversation(o.topic || null, A, B, { rng: this.rng, player: this.playerInfo(), night: f.night, mourning: f.mourning && !o.topic, whisper: whisper && !o.topic, fear: f.tension, lowMorale: (b1.o?.morale ?? 50) < 40, bossFar, extra: { dead: this.mourning.dead[0], dgender: this.mourning.dg } });
    let lines = conv.lines; if (o.short) lines = lines.slice(0, Math.min(lines.length, 2 + this.rng.int(0, 1)));
    const c = { b1, b2, lines, i: 0, t: 0.4, done: false, whisper, topic: conv.topic };
    b1.hold = c; b2.hold = c; b1.lastConv = b2.lastConv = this.clock;
    for (const [x, y] of [[b1.a, b2.a], [b2.a, b1.a]]) { x.data.talkTo = y.id; if (x.pose === 'stand' && !x.moving) x.faceTo(y.x, y.z); }
    this.convs.push(c);
    this.game.bus?.emit('station:chat', { a: b1.a.id, b: b2.a.id, topic: conv.topic });
    return c;
  }
  endConv(c) {
    if (c.done) return; c.done = true;
    for (const b of [c.b1, c.b2]) { if (b.hold === c) b.hold = null; b.a.data.talkTo = null; if (b.needs) { b.needs.social *= 0.25; b.needs.fun *= 0.7; } }
    this.convs = this.convs.filter((x) => x !== c);
  }
  _updateConvs(dt) {
    for (const c of [...this.convs]) {
      const ok = (b) => b.a.alive && b.a.world && b.a.brain === b && !b.talk;
      if (!ok(c.b1) || !ok(c.b2) || this.combat) { this.endConv(c); continue; }
      c.t -= dt; if (c.t > 0) continue;
      if (c.i >= c.lines.length) { this.endConv(c); continue; }
      const L = c.lines[c.i++]; const sp = L.who === 0 ? c.b1.a : c.b2.a;
      const d = speechDur(L.text); sp.say(L.text, d); if (c.whisper && sp.speech) sp.speech.whisper = true;
      sp.playAnim('talk', Math.min(d, 3)); c.t = d + 0.25;
    }
  }

  // ═══════════════ Сон ═══════════════
  planSleep(b, def) {
    const night = this.frame.night, visitors = this.visitors.size > 0;
    const opts = [['v_sofa_lie', 'lie'], ['v_bench_lie', 'lie'], ['tv_armchair', 'sit'], ['rest_chair', 'sit']];
    if (night && !visitors) opts.splice(2, 0, ['v_lobby_lie_1', 'lie'], ['v_lobby_lie_2', 'lie']);
    for (const [id, kind] of opts) {
      const s = this.pt(id);
      if (kind === 'lie') {
        if (!s.needs.every((n) => this.isFree(n, b.a)) || !this.isFree(id, b.a)) continue;
        return new Seq(b, [
          { go: s.approach, stand: true },
          { do: (b) => { if (!this.claimExtra([...s.needs.filter((n) => n !== s.approach), id], b.a)) return false; b.a.x = s.x; b.a.z = s.z; b.a.yaw = s.yaw; b.a.y = s.y; b.a.pose = 'lie'; b.a.data.lieOn = id === 'v_sofa_lie' ? 'sofa' : 'bench'; b.a.data.sleeping = true; return true; } },
          { hold: [120, 300], tick: (b) => (this.frame.minute >= 390 && this.frame.minute < 480 && this.rng.chance(0.01) ? 'done' : (b.sleepiness() < 0.3 ? 'done' : undefined)) },
        ], { id: def.id, label: def.label, def, onEnd: (b) => { b.a.data.sleeping = false; this.releaseExtra(b.a); } });
      }
      if (!this.isFree(id, b.a)) continue;
      return new Seq(b, [
        { go: id },
        { hold: [90, 200], start: (b) => { b.a.data.sleeping = true; }, tick: (b) => (b.sleepiness() < 0.3 ? 'done' : undefined) },
      ], { id: def.id, label: 'дремлет', def, onEnd: (b) => { b.a.data.sleeping = false; } });
    }
    return null;
  }

  // ═══════════════ Прочее ═══════════════
  _detGesture(detaineeId, kind, delta) {
    const D = this.game.sim?.detainees;
    if (D && D.adjust) this._try(() => D.adjust(this.game, detaineeId, delta)); // CONTRACT-NEEDS: detainees.adjust(game,id,{cooperation})
    this.game.bus?.emit('detainee:gesture', { detaineeId, kind, delta });
  }
  _shouldDrive() {
    if (this.driveActors === true) return true;
    if (this.driveActors === false) return false;
    if (this._driveDecided !== null) return this._driveDecided;
    for (const a of this.world.actors) { const v = this._probe.get(a); if (v !== undefined && v !== a.animTime) { this._extSeen = true; break; } }
    if (this._extSeen) { this._driveDecided = false; return false; }
    if (this._frames >= 3) { this._driveDecided = true; return true; }
    return false;
  }
  /** Отладочный снимок: кто где что делает */
  snapshot() {
    const out = [];
    for (const b of this.brains.values()) if (b.a.world) out.push({ name: b.a.name, role: b.role, assign: b.assign, job: b.job ? b.job.id : (b.a.brain ? 'idle' : 'combat'), label: b.job ? b.job.label : '', zone: b.a.zone, x: +b.a.x.toFixed(1), z: +b.a.z.toFixed(1), pose: b.a.pose });
    return out;
  }
}
const BARK_TV = { tv_morning: 1, tv_day: 1, tv_evening: 1, tv_night: 1, tv_news: 1 };
export { hhmm, clamp };
