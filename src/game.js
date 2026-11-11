// Ядро: состояние, время, игрок, связь подсистем.
import { RNG, uid, clamp } from './core/rng.js';
import { Bus } from './core/bus.js';
import { randomPerson } from './core/names.js';
import { World } from './world/world.js';
import { Actor } from './world/actor.js';
import { eyeHeight } from './engine/characters.js';

const SAVE_KEY = 'uchastok_save_v1';
const DOW = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
// 1-й игровой день — понедельник, 14 октября 1996
const START_DATE = new Date(1996, 9, 14);

// Интерактивные предметы участка
const INTERACT = [
  { point: 'city_map', at: [31.47, 1.6, 17.0], label: 'Карта города', screen: 'citymap' },
  { point: 'station_plan', at: [29.0, 1.6, 14.05], label: 'Схема участка — оборона', screen: 'stationplan' },
  { point: 'radio', at: [23.3, 0.95, 16.2], label: 'Рация — журнал эфира', screen: 'radio' },
  { point: 'duty_desk', at: [23.3, 0.9, 17.8], label: 'Сводка дежурного', screen: 'briefing' },
  { point: 'monitors', at: [26.5, 1.0, 19.1], label: 'Мониторы наблюдения', screen: 'stationplan' },
  { point: 'personnel_files', at: [6.05, 1.2, 1.0], label: 'Шкаф с личными делами', screen: 'personnel' },
  { point: 'commander_desk', at: [4.3, 0.85, 2.9], label: 'Телефон: снабжение', screen: 'supply' },
  { point: 'papers', at: [3.35, 0.85, 3.1], label: 'Бумаги на столе', screen: 'inbox' },
  { point: 'org_chart', at: [1.5, 1.6, 0.12], label: 'Схема отделов — начальники и директивы', screen: 'departments' },
  { point: 'safe', at: [0.6, 0.8, 8.2], label: 'Сейф — касса', screen: 'safe' },
  { point: 'armory_counter', at: [15.5, 1.0, 7.5], label: 'Оружейная — выдача снаряжения', screen: 'armory' },
  { point: 'ivs_guard', at: [22.5, 1.2, 4.3], label: 'Камеры ИВС — задержанные', screen: 'detainees' },
  { point: 'interrogation', at: [10.0, 0.9, 6.5], label: 'Допросная', screen: 'detainees' },
  { point: 'visitor_window', at: [22.0, 1.3, 17.0], label: 'Окошко дежурного', screen: 'visitor' },
  { point: 'tv_sofa_1', at: [9.0, 0.9, 17.5], label: 'Телевизор', screen: 'tv' },
  { point: 'notice_board', at: [25.0, 1.5, 10.1], label: 'Доска объявлений — блокнот', screen: 'notebook' },
  { point: 'kettle', at: [4.8, 0.85, 15.1], label: 'Чайник — выпить чаю', action: 'tea' },
  { point: 'fusebox', at: [31.4, 1.3, 8.0], label: 'Электрощит', action: 'fusebox' },
  { point: 'sink_mirror', at: [0.2, 1.5, 17.5], label: 'Зеркало', action: 'mirror' },
  { point: 'water_cooler', at: [21.0, 1.1, 10.4], label: 'Кулер — попить воды', action: 'water' },
  { point: 'generator', at: [29.8, 1.0, 4.0], label: 'Генератор', action: 'generator' },
];

export class Game {
  constructor(opts = {}) {
    this.bus = new Bus();
    this.rng = new RNG(opts.seed ?? (Date.now() >>> 0));
    this.world = new World();
    this.sim = opts.sim || {};
    this.state = null;
    this.paused = true; this.speed = 1; this.prevSpeed = 1;
    this.player = { x: 3.5, z: 6, yaw: Math.PI, pitch: -0.05, hp: 100, weapon: 'pm', ammo: 8, mags: 2, crouch: false, drawn: false, gender: 'm', actor: null, bob: 0, vx: 0, vz: 0, flashlight: false, reach: 0, recoil: 0, aimK: 0, lastShot: 0 };
    this.focus = null; // текущий объект взаимодействия
    this.realTime = 0; this._accMin = 0;
    this.world.onSay = (a, text) => this.bus.emit('say', { actorId: a.id, name: a.name || '', text, x: a.x, z: a.z });
    this.world.onDeath = (a, from, info) => this.bus.emit('actor:death', { actor: a, from, info });
  }

  // ——— время ———
  get time() { return this.state?.time; }
  timeStr() { const t = this.state.time; const h = Math.floor(t.minute / 60), m = Math.floor(t.minute % 60); return `Д${t.day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
  dateStr() { const d = new Date(START_DATE); d.setDate(d.getDate() + this.state.time.day - 1); return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}, ${DOW[(d.getDay() + 6) % 7]}`; }
  dayOfWeek() { const d = new Date(START_DATE); d.setDate(d.getDate() + this.state.time.day - 1); return (d.getDay() + 6) % 7; }
  isNight() { const m = this.state.time.minute; return m < 6.5 * 60 || m > 18.5 * 60; }
  isDusk() { const m = this.state.time.minute; return (m >= 17.3 * 60 && m <= 18.5 * 60) || (m >= 6.5 * 60 && m <= 7.6 * 60); }
  setSpeed(n) { const cap = this.combat?.active ? 1 : 10; this.speed = Math.min(n, cap); if (n > 0) this.prevSpeed = this.speed; this.paused = n === 0; this.bus.emit('speed', { speed: this.speed, paused: this.paused }); }
  togglePause() { if (this.paused) this.setSpeed(this.prevSpeed || 1); else this.setSpeed(0); }
  officer(id) { return this.state?.staff?.find((o) => o.id === id); }
  log(text, kind = 'info') { if (!this.state) return; this.state.log.push({ day: this.state.time.day, minute: Math.floor(this.state.time.minute), text, kind }); if (this.state.log.length > 400) this.state.log.splice(0, this.state.log.length - 400); this.bus.emit('log', { text, kind }); }

  // ——— новая игра / сохранения ———
  newGame(o = {}) {
    const seed = (o.seed ?? (Date.now() >>> 0)) >>> 0; this.rng = new RNG(seed);
    const gender = o.gender || 'm';
    const person = o.firstName ? { gender, firstName: o.firstName, lastName: o.lastName, patronymic: o.patronymic } : randomPerson(this.rng, gender);
    this.state = {
      version: 1, seed, mode: o.mode || 'campaign', difficulty: o.difficulty || 'normal', sandbox: o.sandbox || null,
      player: { ...person, gender, rank: 'майор', hp: 100, married: this.rng.chance(0.6), skin: this.rng.int(0, 3), hair: this.rng.int(0, 3) },
      time: { day: 1, minute: 8 * 60 }, settings: this.state?.settings || {}, log: [], flags: { authority: 50, reputation: 40, power: true }, inbox: [],
      staff: [], candidates: [], detainees: [], radio: [],
      defense: { alert: 'normal', groups: [], barricades: {} }, zones: {}, attackPlans: [], attack: null,
    };
    this.world = new World(); this._hookWorld();
    const S = this.sim;
    try { S.campaign?.init?.(this, this.state.mode); } catch (e) { console.error('campaign.init', e); }
    try { S.economy?.init?.(this); } catch (e) { console.error('economy.init', e); }
    try { S.staff?.init?.(this, 12); } catch (e) { console.error('staff.init', e); }
    try { S.city?.init?.(this); } catch (e) { console.error('city.init', e); }
    try { S.departments?.init?.(this); } catch (e) { console.error('departments.init', e); }
    try { S.campaign?.update?.(this); } catch (e) { console.error('campaign.update', e); }
    this._initPlayer();
    this._startRuntime();
    this.log(`${this.state.player.lastName} ${this.state.player.firstName[0]}. ${this.state.player.patronymic[0]}. ${gender === 'f' ? 'приняла' : 'принял'} командование отделением милиции №14.`, 'story');
    this.bus.emit('game:new', {});
    this.bus.emit('day:start', { day: 1, first: true });
    return this.state;
  }
  _hookWorld() {
    this.world.onSay = (a, text) => this.bus.emit('say', { actorId: a.id, name: a.name || '', text, x: a.x, z: a.z });
    this.world.onDeath = (a, from, info) => this.bus.emit('actor:death', { actor: a, from, info });
    this.renderer && (this.renderer.world = this.world);
  }
  _initPlayer() {
    const p = this.player; const sp = this.world.points.player_start;
    Object.assign(p, { x: sp.x, z: sp.z, yaw: sp.yaw, pitch: -0.05, hp: this.state.player.hp ?? 100, gender: this.state.player.gender, drawn: false, crouch: false });
    p.body = new Actor({ id: 'player', team: 'player', name: 'Вы', x: p.x, z: p.z, yaw: p.yaw, look: { uniform: 'militia', gender: p.gender, skin: this.state.player.skin || 0, hair: this.state.player.hair || 1, hat: 'cap', weapon: 'none' } });
    p.body.world = this.world;
  }
  _startRuntime() {
    try { if (this.StationAI) { this.station?.dispose?.(); this.station = new this.StationAI(this); } this.station?.start?.(); } catch (e) { console.error('station.start', e); }
    this._endChk = 0;
    this.paused = false; this.speed = 1;
  }
  save(silent = false) {
    if (!this.state) return false;
    try { this.state.player.x = this.player.x; this.state.player.z = this.player.z; this.state.player.yaw = this.player.yaw; this.state.player.hp = this.player.hp;
      this.state.world = { cellDoors: [...this.world.openCellDoors], barricades: Object.fromEntries(this.world.doors.filter((d) => d.barricade > 0).map((d) => [d.id, d.barricade])), vehicles: this.world.vehicleState || {} };
      this.state.rngState = this.rng.getState();
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.state)); if (!silent) this.bus.emit('toast', { text: 'Игра сохранена', kind: 'good' }); return true;
    } catch (e) { console.error(e); if (!silent) this.bus.emit('toast', { text: 'Не удалось сохранить', kind: 'bad' }); return false; }
  }
  applySettings(st) { this.settingsCache = st; }
  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
  load() {
    let s = null; try { s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { s = null; }
    if (!s || typeof s !== 'object' || !s.player || !s.time) return false;
    this.state = s; this.rng = new RNG(s.seed); if (s.rngState) this.rng.setState(s.rngState);
    try { this._migrate(s); } catch (e) { console.error('migrate', e); }
    this.world = new World(); this._hookWorld();
    const w = s.world || {}; for (const c of w.cellDoors || []) this.world.setCellDoor(c, true);
    for (const [id, hp] of Object.entries(w.barricades || {})) this.world.setBarricade(id, hp);
    this.world.vehicleState = w.vehicles || {};
    this._initPlayer(); if (s.player.x != null) { this.player.x = s.player.x; this.player.z = s.player.z; this.player.yaw = s.player.yaw || 0; }
    this._startRuntime(); this.bus.emit('game:loaded', {}); this.bus.emit('power', { on: s.flags?.power !== false, silent: true }); this.setSpeed(1);
    return true;
  }

  /** Дополнить сохранение прошлых версий недостающими полями (иначе экраны падают на .length/.map у undefined) */
  _migrate(s) {
    const fill = (dst, src) => { // переносит только отсутствующие ключи; вложенные объекты — рекурсивно
      if (!dst || typeof dst !== 'object' || !src || typeof src !== 'object' || Array.isArray(src)) return;
      for (const k of Object.keys(src)) {
        const v = src[k];
        if (dst[k] == null) dst[k] = v;
        else if (v && typeof v === 'object' && !Array.isArray(v) && typeof dst[k] === 'object' && !Array.isArray(dst[k])) fill(dst[k], v);
      }
    };
    for (const k of ['staff', 'candidates', 'detainees', 'radio', 'log', 'inbox', 'attackPlans']) if (!Array.isArray(s[k])) s[k] = [];
    for (const k of ['flags', 'settings', 'zones']) if (!s[k] || typeof s[k] !== 'object') s[k] = {};
    s.defense = s.defense || {}; s.defense.alert = s.defense.alert || 'normal'; if (!Array.isArray(s.defense.groups)) s.defense.groups = []; s.defense.barricades = s.defense.barricades || {};
    if (s.flags.authority == null) s.flags.authority = 50; if (s.flags.reputation == null) s.flags.reputation = 40;
    s.mode = s.mode || 'campaign'; s.difficulty = s.difficulty || 'normal'; s.version = s.version || 1;
    // шаблон «свежего» состояния на тех же настройках — из него берём недостающие поля подсистем
    const S = this.sim; const tmp = Object.create(this);
    tmp.state = { ...s, log: [], radio: [], inbox: [], staff: [], candidates: [], detainees: [], economy: undefined, city: undefined, campaign: undefined };
    tmp.rng = new RNG((s.seed ^ 0x5bd1e995) >>> 0); tmp.bus = { emit() { }, on() { }, once() { } }; tmp.world = this.world; tmp.station = null; tmp.combat = null;
    const tpl = (fn) => { try { fn(); } catch (e) { console.warn('migrate template', e); } };
    tpl(() => S.campaign?.init?.(tmp, s.mode)); tpl(() => S.economy?.init?.(tmp)); tpl(() => S.staff?.init?.(tmp, 2)); tpl(() => S.city?.init?.(tmp));
    const T = tmp.state;
    if (!s.campaign && T.campaign) s.campaign = T.campaign; else fill(s.campaign, T.campaign);
    if (!s.economy && T.economy) s.economy = T.economy; else fill(s.economy, T.economy);
    if (!s.city && T.city) s.city = T.city; else fill(s.city, T.city);
    const oTpl = (T.staff && T.staff[0]) || null;
    if (oTpl) for (const o of [...s.staff, ...s.candidates]) if (o && typeof o === 'object') fill(o, oTpl);
    if (!s.staff.length && T.staff?.length) { s.staff = T.staff; }
    tmp.state = null;
    if (!s.departments) { try { S.departments?.init?.(this); } catch (e) { console.warn('migrate departments', e); } }
  }

  // ——— главный шаг ———
  update(realDt, input) {
    if (!this.state) return;
    realDt = Math.min(realDt, 0.1); this.realTime += realDt;
    const blocking = this.ui?.isBlocking?.() || false;
    if (this.ui?.wantsPause && !this._uiPaused && !this.paused) { this._uiPaused = true; this._speedBeforeUi = this.speed; this.paused = true; }
    if (!this.ui?.wantsPause && this._uiPaused) { this._uiPaused = false; if (this.paused) { this.paused = false; this.speed = this._speedBeforeUi || 1; } }
    if (this.combat?.active && this.speed > 1) this.speed = 1;
    const dt = this.paused ? 0 : realDt * this.speed; // «игровые» секунды для акторов
    // игрок управляется в реальном времени, даже на паузе нельзя ходить
    if (!blocking && !this.paused) this._updatePlayer(realDt, input);
    else if (!blocking && this.paused) this._updateLookOnly(input);
    this._handleButtons(input, blocking);
    if (dt > 0) {
      this._advanceTime(dt);
      for (const a of this.world.actors) a.update(dt, this);
      try { this.station?.update?.(dt); } catch (e) { this._err('station', e); }
      try { this.combat?.update?.(dt); } catch (e) { this._err('combat', e); }
      try { this.sim.city?.update?.(this, dt); /* dt секунд акторов = dt игровых минут */ } catch (e) { this._err('city', e); }
      try { this.sim.staff?.update?.(this, dt); } catch (e) { this._err('staff', e); }
      try { this.sim.departments?.update?.(this, dt); } catch (e) { this._err('departments', e); }
      if ((this._endChk = (this._endChk || 0) + dt) > 2) { this._endChk = 0; try { this.sim.campaign?.checkEnd?.(this); } catch (e) { this._err('campaign', e); } }
    }
    // тело игрока
    const p = this.player, b = p.body; if (b) { b.x = p.x; b.z = p.z; b.yaw = p.yaw; b.pose = p.crouch ? 'crouch' : 'stand'; b.anim = Math.hypot(p.vx, p.vz) > 0.3 ? (p.crouch ? 'crouchwalk' : (p.running ? 'run' : 'walk')) : (p.crouch ? 'crouch' : 'idle'); b.animTime += realDt; b.look.weapon = p.drawn ? 'pm' : 'none'; b.data.drawn = p.drawn; b.data.aiming = p.drawn && p.aimK > 0.5; b.zone = this.world.zoneAt(p.x, p.z); }
    this._updateFocus();
  }
  _err(tag, e) { const k = '_e_' + tag; if (!this[k] || this.realTime - this[k] > 5) { this[k] = this.realTime; console.error('[' + tag + ']', e); } }

  _advanceTime(dt) {
    const t = this.state.time; const before = t.minute;
    t.minute += dt; // 1 реальная секунда при ×1 = 1 игровая минута
    if (t.minute >= 1440) { t.minute -= 1440; t.day += 1; this.bus.emit('midnight', { day: t.day }); }
    // 08:00 — развод: итоги суток службы и новая смена
    if (before < 480 && t.minute >= 480) this._shiftChange();
  }
  _shiftChange() {
    const S = this.sim; const day = this.state.time.day;
    try { S.city?.dayEnd?.(this); } catch (e) { console.error(e); }
    const summary = (() => { try { return S.city?.daySummary?.(this); } catch (e) { return null; } })();
    try { S.staff?.dayEnd?.(this); } catch (e) { console.error(e); }
    this.bus.emit('day:end', { day: day - 1, summary });
    try { S.economy?.dayStart?.(this); } catch (e) { console.error(e); }
    try { S.staff?.dayStart?.(this); } catch (e) { console.error(e); }
    try { S.detainees?.dayStart?.(this); } catch (e) { console.error(e); }
    try { S.departments?.dayStart?.(this); } catch (e) { console.error(e); }
    try { S.campaign?.update?.(this); } catch (e) { console.error(e); }
    this.bus.emit('day:start', { day });
    this.save(true);
  }

  // ——— игрок ———
  _updateLookOnly(inp) {
    const p = this.player; p.yaw -= inp.lookDX; p.pitch = clamp(p.pitch - inp.lookDY, -1.35, 1.25);
  }
  _updatePlayer(dt, inp) {
    const p = this.player; const W = this.world;
    p.yaw -= inp.lookDX; p.pitch = clamp(p.pitch - inp.lookDY, -1.35, 1.25);
    const run = inp.run && !p.crouch && inp.my > 0.2; p.running = run;
    const sp = p.crouch ? 1.3 : run ? 4.2 : 2.3;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw); const rx = -fz, rz = fx; // вправо = (−cos, sin)
    let mx = inp.mx, my = inp.my; const ml = Math.hypot(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
    const tvx = (fx * my + rx * mx) * sp, tvz = (fz * my + rz * mx) * sp;
    const acc = 1 - Math.exp(-dt * 12); p.vx += (tvx - p.vx) * acc; p.vz += (tvz - p.vz) * acc;
    let nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
    [nx, nz] = W.collide(nx, nz, 0.28);
    // не проходить сквозь акторов
    for (const a of W.actors) { if (!a.alive || !a.visible) continue; const dx = nx - a.x, dz = nz - a.z; const d = Math.hypot(dx, dz); if (d < 0.5 && d > 1e-4) { nx = a.x + dx / d * 0.5; nz = a.z + dz / d * 0.5; } }
    [nx, nz] = W.collide(nx, nz, 0.28);
    const moved = Math.hypot(nx - p.x, nz - p.z); p.x = nx; p.z = nz;
    p.bob += moved * (run ? 2.4 : 3.2);
    if (moved > 0.0001) { p.stepAcc = (p.stepAcc || 0) + moved; if (p.stepAcc > (run ? 0.9 : 0.7)) { p.stepAcc = 0; this.bus.emit('step', { x: p.x, z: p.z, surface: this._surface(p.x, p.z), run }); } }
    p.reach = Math.max(0, p.reach - dt * 2.5); p.recoil = Math.max(0, p.recoil - dt * 6);
    p.aimK += ((p.drawn && inp.held.has('fire') ? 1 : p.drawn ? 0.35 : 0) - p.aimK) * Math.min(1, dt * 10);
    // стрельба
    if (p.drawn && (inp.pressed.has('fire')) && this.realTime - p.lastShot > 0.28) this.playerFire();
  }
  _surface(x, z) { const [i, j] = this.world.toCell(x, z); const c = this.world.at(i, j); return c === ',' ? 'tile' : c === ':' ? 'concrete' : c === '.' ? 'lino' : 'wet'; }
  eye() { const p = this.player; return eyeHeight({ gender: p.gender }, p.crouch ? 'crouch' : 'stand') - 0.05 + (Math.hypot(p.vx, p.vz) > 0.3 ? Math.sin(p.bob) * 0.035 : 0); }

  playerFire() {
    const p = this.player; p.lastShot = this.realTime;
    if (p.ammo <= 0) { this.bus.emit('sfx', { name: 'empty_click' }); if (p.mags > 0) { p.mags--; p.ammo = 8; this.bus.emit('sfx', { name: 'reload' }); this.bus.emit('toast', { text: 'Перезарядка', kind: 'info' }); } return; }
    p.ammo--; p.recoil = 1; p.pitch += 0.03;
    const cp = Math.cos(p.pitch); const dir = { x: Math.sin(p.yaw) * cp, y: Math.sin(p.pitch), z: Math.cos(p.yaw) * cp };
    const origin = { x: p.x, y: this.eye(), z: p.z };
    let hit = null; try { hit = this.combat?.playerShoot?.(origin, dir, 'pm'); } catch (e) { console.error(e); }
    if (!this.combat?.playerShoot) {
      this.bus.emit('shot', { x: p.x, z: p.z, weapon: 'pm', by: 'player' });
      const r = this.world.raycast(p.x, p.z, dir.x / (cp || 1), dir.z / (cp || 1), 40);
      this.renderer?.addDecal('hole', r.x, origin.y + dir.y * r.dist, r.z, -dir.x, 0, -dir.z);
    }
    this.renderer?.addFlash(p.x + dir.x * 0.6, origin.y - 0.1 + dir.y * 0.6, p.z + dir.z * 0.6, 0.8);
  }

  _handleButtons(inp, blocking) {
    if (blocking) return;
    const P = inp.pressed; const p = this.player;
    if (P.has('pause')) this.togglePause();
    if (P.has('menu')) this.ui?.open?.('pause');
    if (P.has('radio')) this.ui?.open?.('radio');
    if (P.has('notebook')) this.ui?.open?.('notebook');
    if (P.has('speed1')) this.setSpeed(1); if (P.has('speed2')) this.setSpeed(3); if (P.has('speed3')) this.setSpeed(10); if (P.has('speed0')) this.setSpeed(0);
    if (P.has('crouch')) { p.crouch = !p.crouch; this.input?.setButtonState('crouch', p.crouch); }
    if (P.has('light')) { p.flashlight = !p.flashlight; this.input?.setButtonState('light', p.flashlight); this.bus.emit('sfx', { name: 'ui_click' }); }
    if (P.has('draw')) { p.drawn = !p.drawn; this.input?.setArmed(p.drawn); this.bus.emit('sfx', { name: p.drawn ? 'reload' : 'ui_click' }); }
    if (P.has('act') || (P.has('tap') && this.focus)) this.interact();
  }

  // ——— взаимодействие ———
  _updateFocus() {
    if (!this.state) return;
    const p = this.player; const ey = this.eye(); const cp = Math.cos(p.pitch);
    const dx = Math.sin(p.yaw) * cp, dy = Math.sin(p.pitch), dz = Math.cos(p.yaw) * cp;
    let best = null, bs = Infinity;
    const consider = (x, y, z, obj, maxD = 2.3, cone = 0.42) => {
      const vx = x - p.x, vy = y - ey, vz = z - p.z; const d = Math.hypot(vx, vy, vz); if (d > maxD || d < 0.05) return;
      const cos = (vx * dx + vy * dy + vz * dz) / d; const ang = Math.acos(Math.min(1, cos)); if (ang > cone) return;
      if (!this.world.lineOfSight(p.x, p.z, x - vx / d * 0.35, z - vz / d * 0.35)) return;
      const s = ang * 2 + d * 0.25; if (s < bs) { bs = s; best = obj; }
    };
    for (const it of INTERACT) consider(it.at[0], it.at[1], it.at[2], { kind: 'object', ...it });
    for (const a of this.world.actors) { if (!a.visible || a.team === 'player') continue; const h = a.pose === 'sit' ? 1.15 : a.pose === 'lie' ? 0.3 : 1.45; consider(a.x, h, a.z, { kind: 'actor', actor: a, label: this._actorLabel(a) }, 2.6, 0.5); }
    this.focus = best;
    this.ui?.setInteractPrompt?.(best ? best.label : null);
  }
  _actorLabel(a) {
    if (!a.alive) return a.team === 'police' ? `${a.name} — погиб` : 'Тело';
    if (a.team === 'police') return `Поговорить: ${a.name}`;
    if (a.team === 'prisoner') return `Задержанный: ${a.name}`;
    if (a.team === 'bandit') return a.name || 'Бандит';
    return `Посетитель${a.name ? ': ' + a.name : ''}`;
  }
  interact() {
    const f = this.focus; if (!f) return;
    this.player.reach = 1; this.bus.emit('sfx', { name: 'ui_click' });
    if (f.kind === 'actor') {
      const a = f.actor; if (!a.alive) return;
      const choices = this.station?.onPlayerTalk?.(a) || [];
      if (a.team === 'police' && a.pose === 'sit' && a.brain) { a.pose = 'stand'; }
      this.bus.emit('player:talk', { actor: a, choices });
      if (this.ui?.open) this.ui.open('talk', { actor: a, actorId: a.id, officerId: a.officerId, choices });
      return;
    }
    if (f.screen) { this.ui?.open?.(f.screen, {}); return; }
    switch (f.action) {
      case 'tea': this.bus.emit('sfx', { name: 'kettle' }); this.bus.emit('toast', { text: this.rng.pick(['Крепкий, с сахаром. Руки согрелись.', 'Чай из пачки со слоном. Горячий — уже хорошо.', 'Кто-то опять допил последний сахар.']), kind: 'info' }); this.player.hp = Math.min(100, this.player.hp + 3); break;
      case 'water': this.bus.emit('toast', { text: 'Вода отдаёт ржавчиной.', kind: 'info' }); break;
      case 'mirror': this.bus.emit('toast', { text: this.player.gender === 'f' ? 'Из зеркала смотрит уставшая женщина в форме. Держись, майор.' : 'Из зеркала смотрит небритый мужик в форме. Держись, майор.', kind: 'info' }); break;
      case 'fusebox':
        if (this.state.flags?.power === false) {
          const gz = this.state.zones?.generator?.owner; if (gz === 'enemy') { this.bus.emit('toast', { text: 'Генераторная у противника — щит не включить.', kind: 'bad' }); break; }
          if (this.combat?.setPower) this.combat.setPower(true, 'player'); else this.bus.emit('power', { on: true, by: 'player' }); this.bus.emit('toast', { text: 'Рубильник поднят. Свет есть.', kind: 'good' });
        } else this.bus.emit('toast', { text: 'Щиток гудит. Пробки целы.', kind: 'info' });
        break;
      case 'generator': { const f2 = this.state.economy?.fuel; this.bus.emit('toast', { text: f2 != null ? `Генератор. Солярки: ${Math.round(f2)} л.` : 'Генератор. Тарахтит, но работает.', kind: 'info' }); break; }
      default: break;
    }
  }

  /** Сцена для рендера */
  sceneForRender() {
    const s = this.state; const p = this.player;
    const tvOn = !(s.time.minute > 60 && s.time.minute < 360);
    return {
      actors: this.world.actors,
      player: { x: p.x, z: p.z, yaw: p.yaw, body: p.body },
      state: { night: this.isNight(), dusk: this.isDusk(), tvOn },
      news: s.city?.news || [], city: s.city, zones: s.zones,
      cameraIndoor: this.world.zoneAt(p.x, p.z) !== 'street' && this.world.zoneAt(p.x, p.z) !== 'yard' && this.world.zoneAt(p.x, p.z) !== 'alley',
      cctv: !!(s.economy?.upgrades?.cameras || s.economy?.upgrades?.cctv || s.economy?.flags?.cctv),
      vm: { gender: p.gender, skin: s.player.skin || 0, weapon: 'pm', drawn: p.drawn, bob: Math.hypot(p.vx, p.vz) > 0.3 ? Math.sin(p.bob * 2) * 0.008 : Math.sin(this.realTime * 1.5) * 0.002, sway: Math.sin(p.bob) * 0.02, reach: p.reach, recoil: p.recoil, aimK: p.aimK, married: s.player.married, lower: clamp(-p.pitch - 0.6, 0, 0.6) * 0.5, coat: false },
      suppress: this.combat?.active ? 0.4 : 0,
    };
  }
}
