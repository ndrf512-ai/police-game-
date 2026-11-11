// Бой и оборона отделения: атаки банд, группы обороны с доктринами, контроль зон, оккупация, стрельба игрока.
// Принцип: игрок даёт командиру группы общий приказ (доктрину) — дальше командир и бойцы действуют сами, с поправкой на характер.
import { RNG, uid, clamp } from '../core/rng.js';
import { randomPerson, randomNick } from '../core/names.js';
import { Actor } from '../world/actor.js';
import { WEAPONS, getWeapon } from './weapons.js';
import { DOCTRINES, defaultDoctrine, normalizeDoctrine, gangTactics, ALERT_LEVELS, zoneLabel } from './doctrine.js';

export { WEAPONS, DOCTRINES, ALERT_LEVELS };

const INDOOR = ['office', 'opers', 'armory', 'ivs', 'generator', 'corridor', 'toilet', 'rest', 'lobby', 'duty'];
const KEY_ZONES = ['lobby', 'duty', 'corridor', 'ivs', 'armory', 'generator', 'office'];
const ZONE_HIT = [['head', 0.08, 2.3], ['torso', 0.55, 1], ['arm', 0.17, 0.55], ['leg', 0.2, 0.65]];
const BARK = {
  contact: ['Контакт!', 'Вижу их!', 'Идут!', 'К бою!', 'Справа! Справа!'], reload: ['Перезаряжаюсь!', 'Пустой! Прикрой!', 'Магазин!'],
  hit: ['Ранен!', 'Зацепило!', 'А-а, чёрт!', 'Я ранен!'], down: ['{name} убит!', '{name} лежит!', 'Двухсотый! {name}!'],
  fallback: ['Отходим!', 'Назад, {zone}!', 'Всем отход {zone}!'], hold: ['Держим!', 'Ни шагу назад!', 'Стоять! Держим позицию!'],
  counter: ['Пошли, пошли!', 'За мной!', 'Вперёд, выбиваем!'], panic: ['Я не могу!', 'Их слишком много!', 'Уходить надо!', 'Мама…'],
  kill: ['Готов!', 'Один есть!', 'Минус один!', 'Лежит!'], clear: ['Чисто!', 'Здесь чисто!'], out: ['Патроны кончились!', 'Нечем стрелять!'],
  b_go: ['Пошли, братва!', 'Вали мусоров!', 'Давай, давай!', 'Вперёд!'], b_run: ['Валим!', 'Уходим, уходим!', 'Атас!', 'Всё, сваливаем!'],
  b_hit: ['Попали, суки!', 'Меня зацепило!', 'А-а-а!'], b_free: ['Выходи, братва!', 'Свободны! Бегом!'], b_dark: ['Гаси свет!', 'Рубильник!'],
};

export class Combat {
  constructor(game) {
    this.game = game; this.DOCTRINES = DOCTRINES; this.ALERT_LEVELS = ALERT_LEVELS; this.WEAPONS = WEAPONS;
    this.rng = new RNG(0x5bd1e995);
    this.reset();
    game.bus.on('game:new', () => this.reset()); game.bus.on('game:loaded', () => this.reset());
  }
  reset() {
    this.fighters = new Map(); this.squads = []; this.hot = 0; this.t = 0; this._zt = 0; this._gt = 0; this._endT = 0; this.enemyFired = false; this.quiet = 0; this.fires = []; this.losses = null; this.omonAt = null;
    const s = this.game.state; if (!s) return;
    this.rng = new RNG(((s.seed || 1) ^ 0x5bd1e995) >>> 0);
    s.defense = s.defense || { alert: 'normal', groups: [], barricades: {} }; s.zones = s.zones || {}; s.attackPlans = s.attackPlans || [];
    for (const z of INDOOR) if (!s.zones[z]) s.zones[z] = { owner: 'police', control: 1 };
    if (s.attack) s.attack = null; // бой не переживает загрузку: нападавшие «ушли»
    for (const [id, hp] of Object.entries(s.defense.barricades || {})) if (hp > 0 && this.world) this.world.setBarricade(id, hp);
  }
  get world() { return this.game.world; }
  get state() { return this.game.state; }
  get active() { return !!this.state?.attack || this.hot > 0; }
  now() { const t = this.state.time; return (t.day - 1) * 1440 + t.minute; }
  emit(ev, p) { this.game.bus.emit(ev, p); }
  officer(id) { return (this.state.staff || []).find((o) => o.id === id) || null; }
  say(f, key, vars = {}) { if (!f || !f.a.alive) return; if (this.t - (f.lastSay || -9) < 4) return; f.lastSay = this.t; let s = this.rng.pick(BARK[key] || ['…']); for (const k in vars) s = s.replace(`{${k}}`, vars[k]); f.a.say(s, 2.5); }

  /* ================================================================ планирование атак */
  planAttack(game, gangId, reason = '', opts = {}) {
    const s = this.state; const g = (s.city?.gangs || []).find((x) => x.id === gangId); const type = opts.gangType || g?.type || 'sport';
    const T = gangTactics(type); const rng = this.rng; const diff = { easy: 0.75, normal: 1, hard: 1.3 }[s.difficulty] || 1;
    const strength = opts.strength ?? g?.strength ?? 40;
    const seen = s.flags?.attacksSeen || 0; const size = clamp(Math.round((4 + strength / 9) * (T.sizeMul || 1) * diff * (seen ? 1 + 0.08 * Math.min(seen, 6) : 0.8)), 4, 16);
    let at = this.now() + rng.int(8, 30) * 60 + rng.int(0, 59);
    if (rng.chance(0.65)) { const d0 = Math.floor(at / 1440) * 1440; const night = d0 + rng.int(22 * 60, 27 * 60); at = night > this.now() + 240 ? night : night + 1440; }
    if (opts.inMinutes != null) at = this.now() + opts.inMinutes;
    const entry = opts.entry || rng.weighted(Object.entries(T.entry || { front: 1 }), (e) => e[1])[0];
    const plan = { id: uid('atk'), gangId, gangType: type, day: Math.floor(at / 1440) + 1, minute: at % 1440, size, tier: clamp(opts.weaponsTier ?? g?.weaponsTier ?? 1, 1, 3), entry, reason, code: opts.code || 'revenge', warned: false, done: false };
    s.attackPlans.push(plan); this.emit('attack:planned', { plan });
    return plan;
  }

  /* ================================================================ группы обороны и баррикады */
  createGroup(spec = {}) {
    const g = { id: uid('grp'), name: spec.name || 'Группа', leaderId: spec.leaderId || null, memberIds: (spec.memberIds || []).filter((x) => x !== spec.leaderId), zoneId: spec.zoneId || 'lobby', doctrine: { ...normalizeDoctrine(spec.doctrine || {}), details: spec.doctrine?.details || {} } };
    this.state.defense.groups.push(g); this._rebind(); this.emit('defense:changed', {}); return { ok: true, id: g.id, group: g };
  }
  updateGroup(id, patch = {}) {
    const g = this.state.defense.groups.find((x) => x.id === id); if (!g) return { ok: false, reason: 'Группа не найдена' };
    if (patch.doctrine) patch = { ...patch, doctrine: { ...normalizeDoctrine(patch.doctrine), details: patch.doctrine.details || g.doctrine.details || {} } };
    Object.assign(g, patch); if (g.memberIds) g.memberIds = g.memberIds.filter((x) => x !== g.leaderId);
    if (g.rt && patch.zoneId) { g.rt.zone = g.zoneId; g.rt.fell = false; g.rt.home = g.zoneId; }
    this._rebind(); this.emit('defense:changed', {}); return { ok: true, id };
  }
  removeGroup(id) { const d = this.state.defense; d.groups = d.groups.filter((x) => x.id !== id); this._rebind(); this.emit('defense:changed', {}); return { ok: true }; }
  setAlert(level) {
    const d = this.state.defense; if (!ALERT_LEVELS[level] && !['normal', 'raised', 'siege'].includes(level)) return { ok: false };
    d.alert = level; this.emit('alert', { level });
    if (level !== 'normal') this.game.station?.setCombatMode?.(level === 'siege'); else if (!this.state.attack && !this.occupied()) this.game.station?.setCombatMode?.(false);
    if (level === 'siege') this._ensurePoliceFighters();
    return { ok: true };
  }
  placeBarricade(doorId) {
    const w = this.world; const d = w.doors.find((x) => x.id === doorId); if (!d) return { ok: false, reason: 'Нет такой двери' };
    const fl = this.state.economy?.flags || {}; const bags = Array.isArray(fl.sandbags) ? fl.sandbags.length > 0 : !!fl.sandbags;
    if (d.kind === 'arch' && !bags) return { ok: false, reason: 'Проход слишком широкий: нужны мешки с песком (закажите по телефону снабжения)' };
    if (d.kind === 'gate') return { ok: false, reason: 'Ворота двора баррикадировать нечем' };
    if (d.barricade > 0) return { ok: false, reason: 'Уже забаррикадировано' };
    const hp = (d.id === 'front' ? (fl.frontDoorHp || 150) : d.id === 'back' ? (fl.backDoorHp || 300) * 0.7 : d.kind === 'steel' ? 170 : 90) + (bags ? 60 : 0);
    w.setBarricade(doorId, hp); this.state.defense.barricades[doorId] = hp; this.emit('sfx', { name: 'door_steel', x: (d.rect[0] + d.rect[2]) / 2, z: (d.rect[1] + d.rect[3]) / 2 }); this.emit('defense:changed', {});
    return { ok: true, hp };
  }
  removeBarricade(doorId) { this.world.removeBarricade(doorId); delete this.state.defense.barricades[doorId]; this.emit('defense:changed', {}); return { ok: true }; }

  /* ================================================================ бойцы */
  _mk(a, side, o = {}) {
    const w = getWeapon(o.weapon || 'pm');
    const f = { a, side, w, mag: w.mag || 0, reserve: o.reserve ?? (w.mag || 0) * 2, acc: o.acc ?? 0.45, courage: o.courage ?? 0.6, aggr: o.aggr ?? 0.5, disc: o.disc ?? 0.5, armor: o.armor || 'none', helmet: !!o.helmet,
      supp: 0, cd: this.rng.range(0.2, 1), burst: 0, reload: 0, tThink: this.rng.range(0, 0.4), target: null, cover: null, goal: null, role: o.role || 'assault', squad: o.squad || null, officerId: o.officerId || null, fled: false, wounded: false, seenT: -99, lastSay: -9, firedAt: false, hp0: a.hp };
    a.data.cb = true; a.look.weapon = w.look || o.weapon || 'pm'; a.data.drawn = true;
    a.brain = { update: (ac, dt) => this._tick(f, dt), onDamage: (ac, amt, from, info) => this._onDamage(f, amt, from, info), onDeath: (ac, from) => this._onDeath(f, from) };
    this.fighters.set(a.id, f); return f;
  }
  _ensurePoliceFighters() {
    const st = this.game.sim?.staff;
    for (const a of this.world.actors) {
      if (a.team !== 'police' || !a.alive || this.fighters.has(a.id) || !a.visible || a.data.civilian) continue;
      const o = this.officer(a.officerId); const cs = o && st?.combatStats ? st.combatStats(o) : null; const eq = o?.equipment || {};
      const wid = eq.weapon && eq.weapon !== 'none' ? eq.weapon : 'pm';
      const f = this._mk(a, 'police', { weapon: wid, reserve: Math.max(eq.ammo ?? 16, getWeapon(wid).mag || 8), acc: cs ? cs.accuracy : 0.45, courage: cs ? cs.courage : 0.55, aggr: cs ? cs.aggression : 0.45, disc: cs ? cs.discipline : 0.55, armor: eq.armor || 'none', helmet: eq.helmet, officerId: a.officerId });
      f.traits = o?.traits || []; f.light = !!eq.flashlight; a.look.armor = f.armor !== 'none'; if (f.helmet) a.look.hat = 'helmet';
      if (o) a.hp = Math.min(a.hp, Math.max(20, o.hp ?? 100));
    }
  }
  /** Готовность: взять из оружейки автомат/карабин и каску (вернут после боя) */
  _armUp(f) {
    const e = this.state.economy; if (!e || f.temp) return; const inv = e.inventory || {}; const am = e.ammo || {};
    if (f.w.kind === 'pistol') {
      const pickW = (inv.aks74u > 0 && (am['5.45x39'] || 0) >= 30) ? 'aks74u' : (inv.ks23 > 0 && (am['23mm'] || 0) >= 6) ? 'ks23' : null;
      if (pickW) { const w = getWeapon(pickW); inv[pickW]--; const n = Math.min(am[w.ammoType] || 0, w.mag * 3); am[w.ammoType] -= n; f.borrow = { id: pickW, prev: f.w, prevMag: f.mag, prevRes: f.reserve }; f.w = w; f.mag = Math.min(w.mag, n); f.reserve = n - f.mag; f.a.look.weapon = w.look || pickW; }
    }
    if (!f.helmet && inv.helmet_ssh68 > 0) { inv.helmet_ssh68--; f.helmet = true; f.borrowHelmet = true; f.a.look.hat = 'helmet'; }
  }
  _returnGear(f) {
    const e = this.state.economy; if (!e) return; const inv = e.inventory || {}; const am = e.ammo || {};
    if (f.borrow) { const lost = !f.a.alive && this.rng.chance(0.4); if (!lost) inv[f.borrow.id] = (inv[f.borrow.id] || 0) + 1; if (f.a.alive) am[f.w.ammoType] = (am[f.w.ammoType] || 0) + f.mag + f.reserve; f.w = f.borrow.prev; f.mag = f.borrow.prevMag; f.reserve = f.borrow.prevRes; f.a.look.weapon = f.w.look || 'pm'; f.borrow = null; }
    if (f.borrowHelmet) { inv.helmet_ssh68 = (inv.helmet_ssh68 || 0) + 1; f.borrowHelmet = false; if (f.a.alive) f.a.look.hat = 'cap'; }
  }
  _enemiesOf(f) { const out = []; for (const x of this.fighters.values()) if (x.side !== f.side && x.a.alive && !x.gone && !x.surrendered) out.push(x); return out; }
  _playerTarget() { const p = this.game.player; return p && p.hp > 0 ? { player: true, x: p.x, z: p.z, alive: true, pose: p.crouch ? 'crouch' : 'stand', id: 'player', moving: Math.hypot(p.vx, p.vz) > 1 } : null; }
  _dark(x, z) { return this.state.flags?.power === false && !this.state.economy?.flags?.emergencyLights && INDOOR.includes(this.world.zoneAt(x, z)); }
  _see(f, tx, tz) { const a = f.a; const d = Math.hypot(tx - a.x, tz - a.z); const range = this._dark(tx, tz) ? (f.light ? 17 : 9) : 32; return d <= range && this.world.lineOfSight(a.x, a.z, tx, tz); }

  _tick(f, dt) {
    const a = f.a; if (!a.alive) return;
    f.cd -= dt; f.supp = Math.max(0, f.supp - dt * 0.22);
    if (f.reload > 0) { f.reload -= dt; if (f.reload <= 0) { const n = Math.min(f.w.mag, f.reserve); f.mag = n; f.reserve -= n; } }
    f.tThink -= dt; if (f.tThink <= 0) { f.tThink = this.rng.range(0.28, 0.45); try { this._think(f); } catch (e) { if (!this._errT || this.t - this._errT > 5) { this._errT = this.t; console.error('[combat.think]', e); } } }
    if (f.target && !f.fled && !f.holdFire) this._fire(f, dt); else a.data.aiming = false;
  }

  /* ---------------------------------------------------------------- решение бойца */
  _think(f) {
    const a = f.a; const W = this.world; const rng = this.rng;
    if (f.gone) return;
    // цель
    let best = null, bd = 1e9;
    for (const e of this._enemiesOf(f)) { const d = Math.hypot(e.a.x - a.x, e.a.z - a.z); if (d < bd && this._see(f, e.a.x, e.a.z)) { bd = d; best = e.a; } }
    if (f.side === 'enemy') { const pt = this._playerTarget(); if (pt) { const d = Math.hypot(pt.x - a.x, pt.z - a.z); if (d < bd && this._see(f, pt.x, pt.z)) { bd = d; best = pt; } } }
    if (best && !f.target) { f.seenT = this.t; if (rng.chance(0.3)) this.say(f, f.side === 'police' ? 'contact' : 'b_go'); }
    f.target = best; f.tdist = bd; if (best) { f.last = { x: best.x, z: best.z, t: this.t }; this.hot = Math.max(this.hot, 8); }
    if (f.fled) return this._flee(f);
    if (f.side === 'police') this._thinkPolice(f); else this._thinkBandit(f);
  }
  _takeCover(f, tx, tz, zone = null, r = 7) {
    const a = f.a; const c = this.world.findCover(a.x, a.z, tx, tz, r, zone ? (p) => p.zone === zone : null);
    if (!c) return false; f.cover = c; a.reservedCover = c; if (Math.hypot(c.x - a.x, c.z - a.z) > 0.4) { a.pose = 'stand'; a.moveTo(c.x, c.z, { run: true, onArrive: () => { if (c.low) a.pose = 'crouch'; } }); } else if (c.low) a.pose = 'crouch';
    return true;
  }
  _groupOf(f) { return f.grp || null; }

  _thinkPolice(f) {
    const a = f.a; const rng = this.rng; const g = f.grp; const zone = g?.rt?.zone || this.world.zoneAt(a.x, a.z);
    const doc = g?.doctrine || defaultDoctrine();
    // паника: трус бросает пост раньше, педант и ветеран держатся
    const lossFrac = g?.rt ? 1 - g.rt.alive / Math.max(1, g.rt.initial) : 0;
    const panic = (1 - f.courage) * (0.35 + f.supp * 0.9) + (a.hp < 40 ? 0.3 : 0) + lossFrac * 0.45 - f.disc * 0.3 - (doc.hold === 'hold' ? 0.05 : 0);
    if (!f.fled && f.target && panic > 0.78 + rng.range(0, 0.25)) { f.fled = true; this.say(f, 'panic'); return this._flee(f); }
    // правило открытия огня
    const roe = doc.roe || 'free'; const close = f.tdist < 7;
    f.holdFire = !f.target || (roe === 'return' && !this.enemyFired && !close) || (roe === 'hold_fire' && !f.firedAt && !close);
    if (f.holdFire && f.target && f.aggr > 0.8 && f.disc < 0.45 && rng.chance(0.15)) f.holdFire = false; // горячий не выдержал
    if (f.mag <= 0 && f.reload <= 0) { if (f.reserve > 0) { f.reload = f.w.reload || 2.2; a.playAnim('reload', 0.8); this.say(f, 'reload'); this._resupply(f); } else if (!this._resupply(f)) { this.say(f, 'out'); f.holdFire = true; } }
    if (f.target) {
      const t = f.target;
      // горячий — в контратаку без приказа
      if (f.aggr > 0.75 && doc.hold !== 'hold' && rng.chance(0.06) && f.tdist > 6) { f.cover = null; a.pose = 'stand'; a.moveTo(t.x, t.z, { run: true, stopDist: 4 }); this.say(f, 'counter'); return; }
      const exposed = !f.cover || this.world.coverBetween(t.x, t.z, a.x, a.z) <= 0;
      if (exposed && !a.moving) { if (!this._takeCover(f, t.x, t.z, g ? zone : null, 6) && rng.chance(0.5)) a.pose = 'crouch'; }
      else if (f.cover && !a.moving && f.cover.low) a.pose = f.supp > 0.6 && rng.chance(0.5) ? 'crouch' : 'crouch';
      return;
    }
    // нет цели: занять место по приказу командира
    if (g?.rt) {
      const in0 = this.world.zoneAt(a.x, a.z) === zone;
      if (!in0 || !f.cover || f.cover.zone !== zone) { if (!a.moving) { const th = g.rt.threat || this.world.zoneCenter('lobby'); if (!this._takeCover(f, th[0], th[1], zone, 30)) { const p = this.world.randomPointInZone(zone, rng); if (p) a.moveTo(p[0], p[1], { run: true }); } } }
      else if (!a.moving && g.rt.threat) { a.faceTo(g.rt.threat[0], g.rt.threat[1]); a.data.aiming = this.state.attack ? true : false; }
    }
  }
  _resupply(f) {
    // пополнение из оружейки — пока она наша
    const e = this.state.economy; const z = this.state.zones.armory; if (!e || (z && z.owner !== 'police')) return false;
    const type = f.w.ammoType; const have = e.ammo?.[type] || 0; if (have <= 0) return false;
    const n = Math.min(have, (f.w.mag || 8) * 2); e.ammo[type] -= n; f.reserve += n; return true;
  }
  _flee(f) {
    const a = f.a; f.target = null; a.data.aiming = false;
    if (f.side === 'enemy') {
      f.fleeN = (f.fleeN || 0) + 1; // страховка: не дошёл за ~25 с — считаем, что ушёл дворами
      if (f.fleeN > 70 || (f.fleeN > 30 && !INDOOR.includes(this.world.zoneAt(a.x, a.z)))) { this._despawn(f); return; }
      if (!a.moving) { const sp = f.squad?.spawn || this.world.points.spawn_street_c; if (Math.hypot(a.x - sp.x, a.z - sp.z) < 2.5) { this._despawn(f); return; } a.pose = 'stand'; if (!a.moveTo(sp.x, sp.z, { run: true })) this._despawn(f); }
      return;
    }
    if (!a.moving) { const safe = ['office', 'toilet', 'rest', 'opers'].filter((z) => this.state.zones[z]?.owner === 'police'); const z = safe.length ? this.rng.pick(safe) : 'office'; if (this.world.zoneAt(a.x, a.z) === z) { a.pose = 'crouch'; a.playAnim('cower', 2); if (f.supp < 0.1 && this.rng.chance(0.04 + f.disc * 0.05)) { f.fled = false; } } else { const p = this.world.randomPointInZone(z, this.rng); if (p) a.moveTo(p[0], p[1], { run: true }); } }
  }
  _despawn(f) { f.gone = true; f.a.visible = false; f.a.alive = false; this.world.removeActor(f.a); this.fighters.delete(f.a.id); if (f.squad) f.squad.escaped = (f.squad.escaped || 0) + 1; }

  _thinkBandit(f) {
    const a = f.a; const rng = this.rng; const sq = f.squad; const T = sq.T; const W = this.world;
    f.holdFire = false;
    if (f.mag <= 0 && f.reload <= 0 && f.w.kind !== 'melee') { if (f.reserve > 0) { f.reload = f.w.reload || 2.2; a.playAnim('reload', 0.8); } else { f.w = getWeapon(T.melee || 'knife'); a.look.weapon = f.w.look || 'knife'; } }
    if (a.hp < 30 && rng.chance((1 - f.courage) * 0.25)) { f.fled = true; this.say(f, 'b_run'); return; }
    if (sq.broken) { f.fled = true; return; }
    const melee = f.w.kind === 'melee';
    if (f.target) {
      const t = f.target;
      if (melee || f.tdist > (f.w.range || 20) * 0.9) { if (!a.moving || rng.chance(0.3)) { a.pose = 'stand'; a.moveTo(t.x, t.z, { run: true, stopDist: melee ? 0.9 : 3 }); } return; }
      const exposed = !f.cover || W.coverBetween(t.x, t.z, a.x, a.z) <= 0;
      if (exposed && !a.moving && rng.chance(0.25 + T.disc * 0.6)) { if (this._takeCover(f, t.x, t.z, null, 5)) return; }
      // напор: «спортсмены» лезут вперёд, «афганцы» давят огнём
      if (!a.moving && rng.chance(T.aggression * 0.12) && f.tdist > 5) { const c = W.findCover(t.x, t.z, t.x, t.z, 7, (p) => Math.hypot(p.x - a.x, p.z - a.z) < f.tdist); if (c) { f.cover = c; a.reservedCover = c; a.pose = 'stand'; a.moveTo(c.x, c.z, { run: true, onArrive: () => { if (c.low) a.pose = 'crouch'; } }); } }
      return;
    }
    // особые роли
    const here = W.zoneAt(a.x, a.z);
    if (f.role === 'liberator' && here === 'ivs' && !sq.freed) { sq.freed = true; this._openCells(f); f.role = 'assault'; }
    if (f.role === 'saboteur' && here === 'generator' && this.state.flags?.power !== false) { const fb = W.points.fusebox; if (Math.hypot(a.x - fb.x, a.z - fb.z) < 1.6) { this.setPower(false, 'sabotage'); this.say(f, 'b_dark'); f.role = 'assault'; } else if (!a.moving) a.moveTo(fb.x, fb.z, { run: true }); return; }
    if (f.role === 'support' && this.t - sq.t0 < 35 && !INDOOR.includes(here)) { if (!a.moving && !f.cover) { const d = W.doors.find((x) => x.id === (sq.entry === 'back' ? 'back' : 'front')); this._takeCover(f, (d.rect[0] + d.rect[2]) / 2, (d.rect[1] + d.rect[3]) / 2 + (sq.entry === 'back' ? 1 : -1), null, 9); } return; }
    if (a.moving) return;
    // цель движения
    let gz = f.role === 'liberator' ? 'ivs' : f.role === 'saboteur' ? 'generator' : sq.objective;
    if (f.last && this.t - f.last.t < 6) { if (a.moveTo(f.last.x, f.last.z, { run: true, stopDist: 2 })) { f.last = null; return; } }
    if (here === gz && f.role === 'assault') { if (!f.cover) this._takeCover(f, ...W.zoneCenter('corridor'), gz, 8); return; }
    a.pose = 'stand'; const p = W.randomPointInZone(gz, rng) || W.zoneCenter(gz);
    if (!a.moveTo(p[0], p[1], { run: !T.stealth || this.enemyFired || INDOOR.includes(here) })) this._bash(f);
  }
  /** Путь закрыт баррикадой — ломать ближайшую */
  _bash(f) {
    const a = f.a; const W = this.world; let best = null, bd = 1e9;
    for (const d of W.doors) { if (!(d.barricade > 0)) continue; const cx = (d.rect[0] + d.rect[2]) / 2, cz = (d.rect[1] + d.rect[3]) / 2; const dd = Math.hypot(cx - a.x, cz - a.z); if (dd < bd) { bd = dd; best = d; } }
    if (!best) return;
    const cx = (best.rect[0] + best.rect[2]) / 2, cz = (best.rect[1] + best.rect[3]) / 2;
    if (bd < 1.7) { a.faceTo(cx, cz); a.playAnim('punch', 0.3); const left = W.damageBarricade(best.id, (f.w.breach || 5) * 0.9); this.state.defense.barricades[best.id] = left; if (left <= 0) delete this.state.defense.barricades[best.id]; this.hot = Math.max(this.hot, 10); if (this.rng.chance(0.35)) this.emit('sfx', { name: best.kind === 'wood' ? 'door_wood' : 'door_steel', x: cx, z: cz }); if (left <= 0) this.emit('toast', { text: `Баррикада сломана: ${best.name}`, kind: 'bad' }); return; }
    const horiz = best.rect[2] - best.rect[0] > best.rect[3] - best.rect[1];
    for (const s of [1, -1]) { const px = horiz ? cx : cx + s * 0.9, pz = horiz ? cz + s * 0.9 : cz; if (W.isWalkable(px, pz) && a.moveTo(px, pz, { run: true })) return; }
  }
  _openCells(f) {
    const W = this.world; const dets = this.game.sim?.detainees; let n = 0;
    for (const c of ['cell_1', 'cell_2', 'cell_3']) W.setCellDoor(c, true);
    this.emit('sfx', { name: 'cell_door', x: 22, z: 4.5 }); this.say(f, 'b_free');
    for (const d of this.state.detainees || []) {
      if (d.status !== 'cell') continue; n++;
      const a = this.game.station?.byDetainee?.get?.(d.id) || W.actors.find((x) => x.personId === d.id || x.data?.detId === d.id || (x.brain && x.brain.detId === d.id));
      if (d.gangId === f.squad.gangId || d.danger > 60) { // свои и опасные — присоединяются
        if (a && a.alive) { a.team = 'bandit'; const nf = this._mk(a, 'enemy', { weapon: f.squad.T.melee || 'knife', acc: 0.3, courage: 0.6, aggr: 0.8, squad: f.squad, role: 'assault' }); f.squad.members.push(nf); }
        d.status = 'escaped'; dets?.escape?.(this.game, d.id);
      } else if (a && a.alive) { a.brain = { update: (ac) => { if (!ac.moving) { const sp = W.points.spawn_street_w; if (Math.hypot(ac.x - sp.x, ac.z - sp.z) < 2) { ac.visible = false; W.removeActor(ac); } else ac.moveTo(sp.x, sp.z, { run: true }); } } }; d.status = 'escaped'; dets?.escape?.(this.game, d.id); }
    }
    if (n) this.emit('toast', { text: 'Камеры ИВС открыты — задержанные на свободе!', kind: 'bad' });
  }
  setPower(on, by = '') { const fl = this.state.flags || (this.state.flags = {}); if ((fl.power !== false) === on) return; fl.power = on; this.emit('power', { on, by }); }

  /* ---------------------------------------------------------------- огонь */
  _fire(f, dt) {
    const a = f.a; const t = f.target; const W = this.world; const rng = this.rng;
    if (!t || (t.player ? this.game.player.hp <= 0 : !t.alive)) { f.target = null; return; }
    const dist = Math.hypot(t.x - a.x, t.z - a.z); const want = Math.atan2(t.x - a.x, t.z - a.z);
    const aimed = a.turnTowards(want, dt, 9); a.data.aiming = true;
    const w = f.w;
    if (w.kind === 'melee') { if (dist < 1.3 && f.cd <= 0) { f.cd = 0.95; a.playAnim('punch', 0.35); this.emit('sfx', { name: 'punch', x: a.x, z: a.z }); if (rng.chance(0.5)) this._hit(f, t, (w.damage || 20) * rng.range(0.6, 1.05), 'torso'); } return; }
    if (!aimed || f.cd > 0 || f.reload > 0 || f.mag <= 0 || a.moving && a.running) return;
    if (!W.lineOfFire(a.x, a.z, t.x, t.z)) return;
    if (f.burst <= 0) f.burst = rng.int(w.burst?.[0] || 1, w.burst?.[1] || 1);
    f.burst--; f.mag--; f.cd = f.burst > 0 ? (w.kind === 'auto' ? 0.09 : 0.22) : (w.cadence || 0.6) * rng.range(0.8, 1.5) + (1 - f.acc) * 0.35;
    a.playAnim('shoot', 0.12); this.hot = 22; this.quiet = 0;
    if (f.side === 'enemy') this.enemyFired = true;
    const my = a.pose === 'crouch' ? 0.95 : 1.4; const ty = (t.pose === 'crouch' ? 0.7 : t.pose === 'lie' ? 0.25 : 1.15);
    const fx = a.x + Math.sin(a.yaw) * 0.5, fz = a.z + Math.cos(a.yaw) * 0.5;
    this.emit('shot', { x: a.x, z: a.z, weapon: w.id, by: a.id }); this.emit('muzzle', { x: fx, y: my, z: fz, s: w.kind === 'shotgun' ? 1.3 : 1 });
    // вероятность попадания
    let p = (0.2 + f.acc * 0.55) * 0.72; const r = w.range || 25;
    p *= dist <= r * 0.3 ? 1 : dist <= r ? 1 - 0.7 * (dist - r * 0.3) / (r * 0.7) : 0.12;
    const cov = W.coverBetween(a.x, a.z, t.x, t.z); p *= 1 - Math.min(cov, 0.75) * 0.75;
    if (t.pose === 'crouch') p *= 0.8; if (t.pose === 'lie') p *= 0.55; if (t.moving || (t.running && t.path)) p *= 0.75;
    p *= 1 - 0.5 * Math.min(1, f.supp); if (a.moving) p *= 0.55; if (this._dark(t.x, t.z)) p *= 0.6; if (f.wounded) p *= 0.8;
    if (!a.moving && f.cover) p *= 1.2; if (dist < 4) p *= 1.35; if (t.player) p *= 0.6; p = Math.min(p, 0.92);
    const pellets = w.pellets || 1; let dmg = 0; let zone = 'torso';
    if (pellets > 1) { const hits = rng.chance(Math.min(1, p * 1.5)) ? Math.max(1, Math.round(pellets * p * rng.range(0.4, 1))) : 0; dmg = hits * (w.damage || 10); }
    else if (rng.chance(p)) { let x = rng.next(); for (const [zn, pr, mul] of ZONE_HIT) { if (x < pr) { zone = zn; dmg = (w.damage || 30) * mul * rng.range(0.85, 1.15); break; } x -= pr; } if (!dmg) dmg = w.damage || 30; }
    const tf = t.player ? null : this.fighters.get(t.id);
    if (tf) { tf.supp = Math.min(1.2, tf.supp + (w.suppress || 0.2) * (dmg ? 1 : 0.6)); tf.firedAt = true; }
    if (dmg > 0) { this._hit(f, t, dmg, zone); if (w.kind === 'auto' || rng.chance(0.4)) this.emit('tracer', { x0: fx, y0: my, z0: fz, x1: t.x, y1: ty, z1: t.z }); }
    else {
      // промах: пуля уходит в стену за целью
      const ang = want + rng.range(-0.09, 0.09); const rc = W.raycast(a.x, a.z, Math.sin(ang), Math.cos(ang), 40, 'shoot');
      if (w.kind === 'auto' || rng.chance(0.5)) this.emit('tracer', { x0: fx, y0: my, z0: fz, x1: rc.x, y1: ty + rng.range(-0.3, 0.6), z1: rc.z });
      if (rc.hit && rng.chance(0.6)) this.emit('hit', { x: rc.x - Math.sin(ang) * 0.05, y: rng.range(0.5, 2.0), z: rc.z - Math.cos(ang) * 0.05, nx: -Math.sin(ang), nz: -Math.cos(ang), kind: rc.cell === 'W' ? 'glass' : 'wall' });
    }
  }
  _hit(f, t, dmg, zone) {
    if (t.player) { this.damagePlayer(dmg * 0.55, f.a); return; }
    const tf = this.fighters.get(t.id);
    if (tf) { if (zone === 'torso' && tf.armor !== 'none') dmg *= tf.armor === 'heavy' ? 0.35 : 0.55; if (zone === 'head' && tf.helmet) dmg *= 0.5; }
    this.emit('hit', { x: t.x, y: 1.1, z: t.z, actorId: t.id, kind: 'flesh' });
    t.damage(dmg, f.a, { zone, weapon: f.w.id });
    if (!t.alive && this.rng.chance(0.4)) this.say(f, 'kill');
  }
  _onDamage(f, amt, from) {
    const a = f.a; f.supp = Math.min(1.2, f.supp + 0.35); f.firedAt = true; a.playAnim('hit', 0.25);
    if (f.side === 'police') { const o = this.officer(f.officerId); if (o) o.hp = Math.max(1, Math.round(a.hp)); }
    if (a.alive && a.hp < 45 && !f.wounded) { f.wounded = true; a.data.speedMul = 0.6; this.say(f, f.side === 'police' ? 'hit' : 'b_hit'); }
    if (f.cover && this.rng.chance(0.5)) f.cover = null; // позиция простреливается
  }
  _onDeath(f, from) {
    const a = f.a; a.data.aiming = false; this.hot = Math.max(this.hot, 15);
    const L = this.losses || (this.losses = { policeKilled: [], policeWounded: [], banditsKilled: 0, banditsFled: 0 });
    if (f.side === 'police') {
      L.policeKilled.push(f.officerId); const o = this.officer(f.officerId);
      try { this.game.sim?.staff?.kill?.(this.game, f.officerId, 'погиб при обороне отделения'); } catch (e) { if (o) { o.status = 'dead'; o.hp = 0; } }
      const g = f.grp; if (g?.rt) { for (const m of g.rt.members) if (m !== f && m.a.alive) { m.supp = Math.min(1.2, m.supp + 0.3); if (this.rng.chance(0.4)) this.say(m, 'down', { name: o ? o.lastName : 'Наш' }); } }
      this.game.log?.(`${o ? `${o.rank || ''} ${o.lastName}` : 'Сотрудник'} ${o?.gender === 'f' ? 'погибла' : 'погиб'} при обороне отделения.`, 'important');
    } else {
      L.banditsKilled++; const sq = f.squad; if (sq) { sq.dead++; for (const m of sq.members) if (m !== f && m.a.alive) m.supp = Math.min(1.2, m.supp + 0.2); }
    }
  }

  /* ================================================================ игрок */
  playerShoot(origin, dir, weaponId = 'pm') {
    const W = this.world; const w = getWeapon(weaponId); const hl = Math.hypot(dir.x, dir.z) || 1e-6;
    this.emit('shot', { x: origin.x, z: origin.z, weapon: weaponId, by: 'player' }); this.hot = Math.max(this.hot, 10);
    const rc = W.raycast(origin.x, origin.z, dir.x / hl, dir.z / hl, 60, 'shoot'); const wallT = rc.dist / hl;
    let best = null, bt = wallT;
    for (const a of W.actors) {
      if (!a.alive || !a.visible || a.team === 'player') continue;
      const t = ((a.x - origin.x) * dir.x + (a.z - origin.z) * dir.z) / (hl * hl); if (t <= 0.2 || t >= bt) continue;
      const px = origin.x + dir.x * t, pz = origin.z + dir.z * t; if (Math.hypot(px - a.x, pz - a.z) > 0.36) continue;
      const y = origin.y + dir.y * t; const h = a.pose === 'crouch' ? 1.15 : a.pose === 'sit' ? 1.3 : a.pose === 'lie' ? 0.45 : 1.8; if (y < 0 || y > h) continue;
      best = { a, t, y, head: y > h - 0.28 }; bt = t;
    }
    const ex = origin.x + dir.x * bt, ey = origin.y + dir.y * bt, ez = origin.z + dir.z * bt;
    this.emit('tracer', { x0: origin.x + dir.x * 0.6, y0: origin.y - 0.12, z0: origin.z + dir.z * 0.6, x1: ex, y1: ey, z1: ez });
    if (best) {
      const a = best.a; let dmg = (w.damage || 30) * (best.head ? 2.3 : 1); const tf = this.fighters.get(a.id);
      if (tf && !best.head && tf.armor !== 'none') dmg *= 0.55;
      this.emit('hit', { x: a.x, y: best.y, z: a.z, actorId: a.id, kind: 'flesh' });
      const pBody = this.game.player.body; a.damage(dmg, pBody, { weapon: weaponId, byPlayer: true });
      if (tf) { tf.supp = Math.min(1.2, tf.supp + 0.4); tf.firedAt = true; }
      if (a.team === 'police') this._friendlyFire(a); else if (a.team === 'civil' || (a.team === 'prisoner' && !this.fighters.has(a.id))) this._civilianShot(a);
      return { hit: true, actor: a, point: { x: ex, y: ey, z: ez } };
    }
    if (rc.hit && ey > 0 && ey < 3) this.emit('hit', { x: ex - dir.x * 0.04, y: ey, z: ez - dir.z * 0.04, nx: -dir.x / hl, nz: -dir.z / hl, kind: rc.cell === 'W' ? 'glass' : 'wall' });
    // выстрел в участке без боя — тревога и вопросы
    if (!this.state.attack && !this._shotWarn) { this._shotWarn = true; this.game.log?.('Начальник отделения стрелял в здании. Личный состав в недоумении.', 'info'); for (const o of this.state.staff || []) if (o.status === 'station') o.stress = clamp((o.stress || 0) + 6, 0, 100); }
    return { hit: false, actor: null, point: { x: ex, y: ey, z: ez } };
  }
  _friendlyFire(a) {
    const o = this.officer(a.officerId); if (o) o.hp = Math.max(0, Math.round(a.hp));
    for (const x of this.state.staff || []) { if (x.status !== 'station') continue; x.loyalty = clamp((x.loyalty ?? 50) - 12, 0, 100); x.morale = clamp((x.morale ?? 60) - 10, 0, 100); }
    this.game.sim?.campaign?.addAuthority?.(this.game, a.alive ? -6 : -25, a.alive ? 'ранил своего сотрудника' : 'застрелил своего сотрудника');
    if (!a.alive) { try { this.game.sim?.staff?.kill?.(this.game, a.officerId, 'застрелен начальником отделения'); } catch (e) { /* */ } }
    this.emit('toast', { text: a.alive ? 'Вы ранили своего сотрудника!' : 'Вы убили своего сотрудника.', kind: 'bad' });
  }
  _civilianShot(a) { this.game.sim?.campaign?.addAuthority?.(this.game, a.alive ? -10 : -30, 'стрелял в безоружного'); const fl = this.state.flags; fl.reputation = clamp((fl.reputation ?? 40) - 15, 0, 100); this.emit('toast', { text: 'Вы стреляли в безоружного человека.', kind: 'bad' }); if (a.team === 'prisoner' && !a.alive) { const d = (this.state.detainees || []).find((x) => x.id === a.personId || x.id === a.data?.detId); if (d) this.game.sim?.detainees?.kill?.(this.game, d.id, 'застрелен'); } }
  damagePlayer(amount, from = null) {
    const p = this.game.player; if (p.hp <= 0) return; p.hp = Math.max(0, p.hp - amount); this.state.player.hp = p.hp;
    this.emit('player:hurt', { amount, hp: p.hp }); this.emit('sfx', { name: 'hit_flesh' });
    if (p.hp <= 0) this.emit('player:dead', { reason: null });
  }

  /* ================================================================ атака */
  _startAttack(plan) {
    const s = this.state; const W = this.world; const rng = this.rng; plan.done = true;
    const g = (s.city?.gangs || []).find((x) => x.id === plan.gangId); const T = gangTactics(plan.gangType || g?.type);
    s.flags = s.flags || {}; s.flags.attacksSeen = (s.flags.attacksSeen || 0) + 1;
    s.attack = { id: plan.id, gangId: plan.gangId, gangName: g?.name || 'неизвестные', startedAt: this.now(), phase: 'assault', size: plan.size, entry: plan.entry };
    this.enemyFired = false; this.quiet = 0; this.losses = { policeKilled: [], policeWounded: [], banditsKilled: 0, banditsFled: 0 }; this.squads = []; this.t0 = this.t;
    this.emit('attack:start', { plan }); this.game.station?.setCombatMode?.(true); this.game.setSpeed?.(1);
    this.game.log?.(`Нападение на отделение: «${s.attack.gangName}», около ${plan.size} человек. Причина: ${plan.reason || 'месть'}.`, 'important');
    // отряды
    const split = plan.entry === 'both' ? [Math.ceil(plan.size * 0.6), Math.floor(plan.size * 0.4)] : [plan.size];
    const entries = plan.entry === 'both' ? ['front', 'back'] : [plan.entry];
    entries.forEach((entry, k) => {
      const n = split[k]; if (n <= 0) return;
      const spawn = entry === 'back' ? W.points.spawn_yard_gate : rng.pick([W.points.spawn_street_w, W.points.spawn_street_e, W.points.spawn_street_c]);
      const sq = { id: uid('sq'), gangId: plan.gangId, T, entry, spawn, members: [], dead: 0, initial: n, t0: this.t, objective: entry === 'back' ? 'generator' : 'lobby', broken: false, stage: 0 };
      const heldOurs = (s.detainees || []).some((d) => d.status === 'cell' && d.gangId === plan.gangId);
      for (let i = 0; i < n; i++) {
        const tier = plan.tier; const wid = rng.weighted(Object.entries(T.weapons[tier] || T.weapons[1]), (e) => e[1])[0];
        let role = 'assault'; if (i === 1 && (heldOurs || plan.code === 'free_leader' || plan.code === 'free_members')) role = 'liberator'; else if (i === 2 && T.cutPower && entry === 'back') role = 'saboteur'; else if (i > 2 && rng.chance(T.roles?.support || 0.1)) role = 'support';
        const person = randomPerson(rng, 'm'); const sk = rng.range(T.skill[0], T.skill[1]);
        const a = new Actor({ team: 'bandit', name: `«${randomNick(rng)}»`, x: spawn.x + rng.range(-1.5, 1.5), z: spawn.z + rng.range(-1.2, 1.2), yaw: spawn.yaw || 0, look: { uniform: T.look || 'bandit_leather', gender: 'm', skin: rng.int(0, 3), hair: rng.int(0, 5), hat: rng.pick(T.hats || ['none']), weapon: 'none', build: rng.range(0.95, 1.15), armor: rng.chance((T.armor || [0, 0, 0])[tier - 1] || 0) }, data: { person } });
        a.runSpeed = 3.4 + sk * 0.6; W.addActor(a);
        const f = this._mk(a, 'enemy', { weapon: wid, acc: sk, courage: clamp(T.courage + rng.range(-0.15, 0.15), 0, 1), aggr: T.aggression, disc: T.disc, armor: a.look.armor ? 'vest' : 'none', squad: sq, role });
        if (i === 0) { f.leader = true; f.courage = Math.min(1, f.courage + 0.15); }
        sq.members.push(f);
      }
      this.squads.push(sq);
    });
    // оборона
    this._ensurePoliceFighters();
    const ready = s.defense.alert !== 'normal' || plan.warned;
    for (const f of this.fighters.values()) { if (f.side !== 'police') continue; if (ready) this._armUp(f); else f.tThink = rng.range(1.5, 4); }
    if (!ready) this.emit('toast', { text: 'Нападение застало отделение врасплох: режим был обычный.', kind: 'bad' });
    this._initGroups(plan);
    // ОМОН по тревожной кнопке
    const link = s.economy?.flags?.omonLink || (s.economy?.upgrades?.panic_button ? { delayMin: 15, size: 5 } : null);
    this.omonAt = link ? this.t + (link.delayMin || 15) * (s.flags?.omonAway ? 1.8 : 1) * 60 / 60 * 4 : null; // 1 игр. минута = 1 с; ждём N×4 секунд боя
    this.omonSize = link ? Math.max(3, (link.size || 5) - (s.flags?.omonAway ? 2 : 0)) : 0;
  }
  /** Привязать бойцов к группам обороны (и собрать «дежурную смену» из остальных). Вызывается в начале атаки и при смене приказов. */
  _initGroups(plan) {
    const s = this.state; const pol = [...this.fighters.values()].filter((f) => f.side === 'police' && f.a.alive && !f.temp); const used = new Set();
    const keep = (this.groups || []).filter((g) => g.id === 'omon'); const prevAuto = (this.groups || []).find((g) => g.id === 'auto');
    this.groups = keep; const entry = plan?.entry || s.attack?.entry || 'front';
    const mkRt = (g, members) => { const p = g.rt && g.rt.home === g.zoneId ? g.rt : null; return { zone: p ? p.zone : g.zoneId, home: g.zoneId, members, initial: p ? Math.max(p.initial, members.length) : members.length, alive: members.length, lastSeen: p ? p.lastSeen : this.t, threat: p ? p.threat : null, fell: p ? p.fell : false }; };
    for (const g of s.defense.groups) {
      const ids = [g.leaderId, ...(g.memberIds || [])].filter(Boolean); const members = pol.filter((f) => ids.includes(f.officerId));
      if (!members.length) { if (g.rt) Object.defineProperty(g, 'rt', { value: null, enumerable: false, configurable: true, writable: true }); continue; }
      members.sort((x, y) => (x.officerId === g.leaderId ? -1 : y.officerId === g.leaderId ? 1 : 0)); members.forEach((m) => { used.add(m); if (m.grp !== g) { m.cover = null; m.a.reservedCover = null; } m.grp = g; });
      Object.defineProperty(g, 'rt', { value: mkRt(g, members), enumerable: false, configurable: true, writable: true });
      this.groups.push(g);
    }
    const rest = pol.filter((f) => !used.has(f));
    if (rest.length) {
      const g = prevAuto || { id: 'auto', name: 'Дежурная смена', zoneId: entry === 'back' ? 'corridor' : 'lobby', doctrine: { ...defaultDoctrine(), hold: 'fallback', fallbackAt: 0.4, fallbackZone: 'corridor' } };
      g.leaderId = rest[0].officerId; g.memberIds = rest.slice(1).map((f) => f.officerId);
      g.rt = mkRt(g, rest); rest.forEach((m) => { m.grp = g; }); this.groups.push(g);
      if (plan && !s.defense.groups.length) this.emit('toast', { text: 'Группы обороны не назначены — дежурная смена держит вестибюль сама.', kind: 'warn' });
    }
  }
  _rebind() { if (this.state.attack || this.state.occupation) { this._ensurePoliceFighters(); this._initGroups(null); } }
  /** Командир группы: рубеж, угроза, отход, контратака */
  _commandGroups() {
    const W = this.world; const s = this.state; const rng = this.rng;
    for (const g of this.groups || []) {
      const rt = g.rt; if (!rt) continue; const doc = g.doctrine || {};
      rt.members = rt.members.filter((m) => m.a.alive); const act = rt.members.filter((m) => !m.fled); rt.alive = act.length; if (!act.length) continue;
      const leader = act.find((m) => m.officerId === g.leaderId) || act[0]; if (leader.officerId !== g.leaderId && !rt.newLeader) { rt.newLeader = true; act.forEach((m) => { m.disc = Math.max(0.1, m.disc - 0.1); }); }
      const enemies = [...this.fighters.values()].filter((f) => f.side === 'enemy' && f.a.alive && !f.gone);
      const inZone = enemies.filter((e) => W.zoneAt(e.a.x, e.a.z) === rt.zone).length;
      // угроза: ближайший известный противник, иначе — дверь со стороны входа
      let th = null, bd = 1e9; const c = W.zoneCenter(rt.zone);
      for (const e of enemies) { const d = Math.hypot(e.a.x - c[0], e.a.z - c[1]); if (d < bd) { bd = d; th = [e.a.x, e.a.z]; } }
      rt.threat = th && bd < 30 ? th : (s.attack?.entry === 'back' ? [29.5, 0] : [16.25, 20]);
      if (act.some((m) => m.target)) rt.lastSeen = this.t;
      const loss = 1 - act.length / rt.initial;
      if (doc.hold === 'fallback' && !rt.fell) {
        const thr = (doc.fallbackAt ?? 0.3) * (0.7 + 0.6 * leader.courage);
        if (loss >= thr || (inZone > act.length * 1.5 && leader.courage < 0.55)) {
          const opts = (doc.fallbackZone ? [doc.fallbackZone] : W.zoneNeighbors(rt.zone).map((n) => n.zone).filter((z) => INDOOR.includes(z) && s.zones[z]?.owner === 'police'));
          const z = opts.sort((a, b) => enemies.filter((e) => W.zoneAt(e.a.x, e.a.z) === a).length - enemies.filter((e) => W.zoneAt(e.a.x, e.a.z) === b).length)[0];
          if (z && z !== rt.zone) { rt.zone = z; rt.fell = true; act.forEach((m) => { m.cover = null; m.a.reservedCover = null; }); this.say(leader, 'fallback', { zone: zoneLabel(z, 'to') }); }
        }
      } else if (doc.hold === 'hold' && loss > 0.3 && rng.chance(0.15)) this.say(leader, 'hold');
      else if ((doc.hold === 'counter' && this.t - rt.lastSeen > 7 && act.length >= 2) || doc.hold === 'retake') {
        // куда идти: сосед, где враг (или зона-цель при «отбить»)
        const tz = doc.hold === 'retake' ? g.zoneId : W.zoneNeighbors(rt.zone).map((n) => n.zone).find((z) => INDOOR.includes(z) && s.zones[z] && s.zones[z].owner !== 'police');
        if (tz && tz !== rt.zone && (doc.hold !== 'retake' || this.t - (rt.movedT || -99) > 4)) { rt.zone = tz; rt.movedT = this.t; act.forEach((m) => { m.cover = null; m.a.reservedCover = null; }); this.say(leader, 'counter'); }
        else if (!tz && doc.hold === 'counter' && rt.zone !== rt.home && this.t - rt.lastSeen > 12) { rt.zone = rt.home; act.forEach((m) => { m.cover = null; }); this.say(leader, 'clear'); }
      }
    }
  }
  _commandSquads() {
    const W = this.world; const s = this.state;
    for (const sq of this.squads) {
      const alive = sq.members.filter((m) => m.a.alive && !m.gone); if (!alive.length) continue;
      const frac = alive.filter((m) => !m.fled).length / sq.initial; const leaderAlive = sq.members[0]?.a.alive;
      if (!sq.broken && (frac <= (sq.T.breakAt || 0.35) || (!leaderAlive && this.rng.chance(0.25 * (1 - sq.T.disc))))) { sq.broken = true; const f = alive[0]; this.say(f, 'b_run'); alive.forEach((m) => { m.fled = true; }); continue; }
      // цель отряда: когда нынешняя зона взята — следующая, где есть милиция, иначе ключевые зоны
      const z = s.zones[sq.objective];
      if (z && z.owner === 'enemy') {
        const pol = [...this.fighters.values()].filter((f) => f.side === 'police' && f.a.alive && !f.fled); const here = W.zoneCenter(sq.objective);
        let next = null, bd = 1e9; for (const p of pol) { const pz = W.zoneAt(p.a.x, p.a.z); if (!INDOOR.includes(pz)) continue; const d = Math.hypot(p.a.x - here[0], p.a.z - here[1]); if (d < bd) { bd = d; next = pz; } }
        if (!next) next = KEY_ZONES.find((k) => s.zones[k]?.owner !== 'enemy');
        if (next && next !== sq.objective) { sq.objective = next; alive.forEach((m) => { m.cover = null; }); }
      }
    }
  }
  _zones(dt) {
    const s = this.state; const W = this.world; const cnt = {}; for (const z of INDOOR) cnt[z] = [0, 0];
    for (const f of this.fighters.values()) { if (!f.a.alive || f.gone || f.fled) continue; const z = W.zoneAt(f.a.x, f.a.z); if (cnt[z]) cnt[z][f.side === 'police' ? 0 : 1]++; }
    const pz = W.zoneAt(this.game.player.x, this.game.player.z); if (cnt[pz] && this.game.player.hp > 0) cnt[pz][0]++;
    for (const z of INDOOR) {
      const zs = s.zones[z] || (s.zones[z] = { owner: 'police', control: 1 }); const [p, e] = cnt[z];
      if (p && !e) zs.control = Math.min(1, zs.control + dt * 0.25 * p); else if (e && !p) zs.control = Math.max(-1, zs.control - dt * 0.2 * e);
      const owner = p && e ? 'contested' : zs.control > 0.3 ? 'police' : zs.control < -0.3 ? 'enemy' : 'contested';
      if (owner !== zs.owner) { zs.owner = owner; this.emit('zone:changed', { zoneId: z, owner }); this._zoneEffect(z, owner); }
    }
  }
  _zoneEffect(z, owner) {
    const name = zoneLabel(z) || z;
    if (owner === 'enemy') { this.emit('toast', { text: `Потеряно: ${name}`, kind: 'bad' }); this.game.log?.(`Противник занял: ${name}.`, 'important'); if (z === 'generator') this.setPower(false, 'captured'); if (z === 'duty') this.emit('comms', { on: false }); if (z === 'armory') { for (const sq of this.squads) for (const m of sq.members) if (m.a.alive && m.w.kind === 'melee') { m.w = getWeapon('pm'); m.mag = 8; m.reserve = 16; m.a.look.weapon = 'pm'; } } }
    else if (owner === 'police') { this.emit('toast', { text: `Отбито: ${name}`, kind: 'good' }); if (z === 'duty') this.emit('comms', { on: true }); if (z === 'generator' && this.state.flags?.power === false && !this.state.attack) { /* рубильник — вручную */ } }
  }
  occupied() { return INDOOR.some((z) => this.state.zones[z]?.owner === 'enemy'); }

  _checkEnd(dt) {
    const s = this.state; if (!s.attack) return;
    const en = [...this.fighters.values()].filter((f) => f.side === 'enemy' && f.a.alive && !f.gone);
    const pol = [...this.fighters.values()].filter((f) => f.side === 'police' && f.a.alive && !f.fled);
    this.quiet += dt;
    if (!en.length) return this._endAttack('repelled');
    const inside = en.filter((f) => INDOOR.includes(this.world.zoneAt(f.a.x, f.a.z)));
    const allEnemy = KEY_ZONES.every((z) => s.zones[z]?.owner === 'enemy');
    if ((!pol.length && this.game.player.hp <= 0) || (allEnemy && !pol.length)) return this._endAttack('fallen');
    if (this.quiet > 75 && inside.length && this.t - this.t0 > 60) return this._endAttack('occupied');
    if (this.quiet > 120 && !inside.length) { en.forEach((f) => { f.fled = true; }); }
    // ОМОН
    if (this.omonAt && this.t >= this.omonAt) { this.omonAt = null; this._omon(); }
  }
  _omon() {
    const W = this.world; const sp = W.points.spawn_street_e; this.emit('toast', { text: 'Подкрепление прибыло!', kind: 'good' }); this.emit('sfx', { name: 'siren_far' });
    const g = { id: 'omon', name: 'Подкрепление', leaderId: null, memberIds: [], zoneId: 'lobby', doctrine: { ...defaultDoctrine(), hold: 'counter', roe: 'free' } }; const members = [];
    for (let i = 0; i < this.omonSize; i++) { const a = new Actor({ team: 'police', name: 'ОМОН', x: sp.x + this.rng.range(-1, 1), z: sp.z + this.rng.range(-1, 1), look: { uniform: 'omon', gender: 'm', hat: 'helmet', armor: true, weapon: 'aks74u', skin: this.rng.int(0, 3), hair: 0, build: 1.1 } }); W.addActor(a); const f = this._mk(a, 'police', { weapon: 'aks74u', reserve: 90, acc: 0.7, courage: 0.9, aggr: 0.7, disc: 0.9, armor: 'heavy', helmet: true }); f.temp = true; f.grp = g; members.push(f); }
    g.rt = { zone: 'lobby', home: 'lobby', members, initial: members.length, alive: members.length, lastSeen: this.t, threat: null, fell: false }; this.groups.push(g);
  }
  _endAttack(result) {
    const s = this.state; const L = this.losses || { policeKilled: [], policeWounded: [], banditsKilled: 0 }; const st = this.game.sim?.staff; const gangId = s.attack.gangId;
    let fled = 0; for (const sq of this.squads) fled += sq.escaped || 0; L.banditsFled = fled;
    for (const f of this.fighters.values()) if (f.side === 'police' && !f.temp && result !== 'occupied') this._returnGear(f);
    // раненые
    for (const f of this.fighters.values()) { if (f.side !== 'police' || !f.a.alive || f.temp) continue; const o = this.officer(f.officerId); if (!o) continue; o.hp = Math.max(1, Math.round(f.a.hp)); o.equipment && (o.equipment.ammo = Math.max(0, Math.round(f.mag + f.reserve))); o.stress = clamp((o.stress || 0) + 25, 0, 100); if (f.a.hp < 75) { L.policeWounded.push(o.id); try { st?.applyInjury?.(this.game, o.id, f.a.hp < 35 ? 3 : f.a.hp < 55 ? 2 : 1, 'ранение при обороне отделения'); } catch (e) { /* */ } } if (f.fled) { o.morale = clamp((o.morale ?? 60) - 10, 0, 100); } else if (o.xp != null) o.xp += 15; }
    // банда
    try { this.game.sim?.city?.gangHit?.(this.game, gangId, { killed: L.banditsKilled, anger: result === 'repelled' ? -25 : -10, cohesion: result === 'repelled' ? 8 : 0 }); } catch (e) { /* */ }
    const C = this.game.sim?.campaign; const cnt = s.campaign?.counters;
    if (result === 'repelled') { C?.addAuthority?.(this.game, L.policeKilled.length ? 3 : 6, 'нападение на отделение отбито'); if (cnt) cnt.attacksRepelled++; for (const d of s.city?.districts || []) d.trust = clamp(d.trust + 2, 0, 100); }
    else if (result === 'occupied') { C?.addAuthority?.(this.game, -8, 'часть отделения в руках бандитов'); if (cnt) cnt.attacksLost++; }
    else if (result === 'fallen') { s.flags.stationFallen = true; }
    this.game.log?.(result === 'repelled' ? `Нападение отбито. Убито нападавших: ${L.banditsKilled}, ушло: ${fled}. Наши потери: погибло ${L.policeKilled.length}, ранено ${L.policeWounded.length}.` : result === 'occupied' ? 'Штурм выдохся, но часть отделения осталась у бандитов. Их надо выбивать.' : 'Отделение пало.', 'important');
    const occ = result === 'occupied';
    // уборка: при оккупации бандиты остаются и держат занятое
    for (const f of [...this.fighters.values()]) {
      if (f.side === 'enemy') { if (occ && f.a.alive && !f.gone && INDOOR.includes(this.world.zoneAt(f.a.x, f.a.z))) { f.role = 'assault'; f.squad.objective = this.world.zoneAt(f.a.x, f.a.z); f.squad.holding = true; continue; } if (f.a.alive && !f.gone) { f.fled = true; continue; } this.fighters.delete(f.a.id); }
      else if (f.temp) { f.a.visible = false; this.world.removeActor(f.a); this.fighters.delete(f.a.id); }
      else if (!occ) { f.a.data.cb = false; f.a.data.aiming = false; f.a.reservedCover = null; f.a.pose = 'stand'; f.a.data.speedMul = 1; if (f.a.alive) f.a.brain = null; this.fighters.delete(f.a.id); }
    }
    s.attack = null; s.attackPlans = s.attackPlans.filter((p) => !p.done); this.omonAt = null;
    if (!occ) { for (const z of INDOOR) { const zs = s.zones[z]; if (zs.owner !== 'police' && result === 'repelled') { zs.owner = 'police'; zs.control = 1; this.emit('zone:changed', { zoneId: z, owner: 'police' }); } } this.groups = []; this.game.station?.setCombatMode?.(false); if (s.defense.alert === 'siege') s.defense.alert = 'raised'; for (const c of ['cell_1', 'cell_2', 'cell_3']) this.world.setCellDoor(c, false); }
    else { s.occupation = { gangId, since: this.now() }; }
    this.emit('attack:end', { result, losses: { 'погибло сотрудников': L.policeKilled.length, 'ранено': L.policeWounded.length, 'убито нападавших': L.banditsKilled, 'ушло': fled } });
    this.hot = occ ? 0 : 3;
  }
  _occupationTick() {
    const s = this.state; if (!s.occupation) return;
    const en = [...this.fighters.values()].filter((f) => f.side === 'enemy' && f.a.alive && !f.gone);
    if (!en.length) { s.occupation = null; for (const z of INDOOR) { const zs = s.zones[z]; if (zs.owner !== 'police') { zs.owner = 'police'; zs.control = 1; this.emit('zone:changed', { zoneId: z, owner: 'police' }); } } for (const f of [...this.fighters.values()]) { f.a.data.cb = false; f.a.data.aiming = false; f.a.pose = 'stand'; if (f.a.alive) f.a.brain = null; this.fighters.delete(f.a.id); } this.groups = []; this.game.station?.setCombatMode?.(false); this.emit('toast', { text: 'Отделение полностью очищено.', kind: 'good' }); this.game.sim?.campaign?.addAuthority?.(this.game, 5, 'отделение отбито'); this.game.log?.('Отделение отбито полностью.', 'important'); for (const c of ['cell_1', 'cell_2', 'cell_3']) this.world.setCellDoor(c, false); }
  }

  /* ================================================================ шаг */
  update(dt) {
    const s = this.state; if (!s) return; this.t += dt; this.hot = Math.max(0, this.hot - dt);
    if (!s.attack) { const now = this.now(); for (const p of s.attackPlans) { if (p.done || p.resolved) continue; if (now >= (p.day - 1) * 1440 + p.minute) { this._startAttack(p); break; } } }
    if (!s.attack && !s.occupation && !this.fighters.size) return;
    this._zt += dt; if (this._zt >= 0.5) { this._zones(this._zt); this._zt = 0; }
    this._gt += dt; if (this._gt >= 1.5) { this._gt = 0; try { this._commandGroups(); this._commandSquads(); } catch (e) { console.error('[combat.cmd]', e); } }
    this._endT += dt; if (this._endT >= 1) { if (s.attack) this._checkEnd(this._endT); else this._occupationTick(); this._endT = 0; }
    // убрать сбежавших
    for (const f of this.fighters.values()) if (f.side === 'enemy' && f.fled && !f.gone && !f.a.moving) this._flee(f);
  }
}
