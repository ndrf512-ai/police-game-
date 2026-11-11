// Интерфейс «Участка»: HUD, стек экранов, тосты, диалоги, субтитры. Контракт — docs/CONTRACTS.md (агент E).
import { injectStyle } from './style.js';
import { h, clear, setSfx, sfx, hhmm, weekday, dateStr, txt, call } from './dom.js';
import { portraitImg } from './portrait.js';
import { WEAPON_NAMES, ATTACK_RESULT, zoneName, GANG_TYPES } from './labels.js';
import { SCREENS } from './screens/index.js';

export const DEFAULT_SETTINGS = {
  lookSens: 1, invertY: false, resScale: 0.75, dither: true, jitter: true, fog: true, brightness: 1,
  volMaster: 0.8, volSfx: 0.9, volAmbience: 0.7, uiScale: 1, vibration: true, subtitles: true, showFps: false,
};
const LS_SETTINGS = 'uchastok_settings';

/** Какой экран открывать при взаимодействии с предметом участка (тип пропа или id точки) */
export const INTERACT = {
  city_map: 'citymap', station_plan: 'stationplan', personnel_files: 'personnel', file_cabinet: 'personnel', safe: 'safe',
  phone: 'supply', radio: 'radio', radio_station: 'radio', tv: 'tv', armory_counter: 'armory', gun_rack: 'armory',
  visitor_window: 'visitor', counter_window: 'visitor', ivs_guard: 'detainees', bunk: 'detainees', monitors: 'stationplan',
  notice_board: 'notebook', commander_desk: 'notebook', interrogation: 'detainees', table_interrogation: 'detainees', duty_desk: 'radio',
};
export const INTERACT_LABELS = {
  citymap: 'Карта города', stationplan: 'Схема участка', personnel: 'Личные дела', safe: 'Сейф', supply: 'Телефон: снабжение',
  radio: 'Рация', tv: 'Телевизор', armory: 'Оружейная', visitor: 'Окошко дежурного', detainees: 'Изолятор (ИВС)', notebook: 'Блокнот',
};

const ICONS = {
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/></svg>',
  play1: '<svg viewBox="0 0 24 24"><path d="M8 5l10 7-10 7z" fill="currentColor"/></svg>',
  play3: '<svg viewBox="0 0 28 24"><path d="M3 5l9 7-9 7zM13 5l9 7-9 7z" fill="currentColor"/></svg>',
  play10: '<svg viewBox="0 0 34 24"><path d="M2 5l8 7-8 7zM11 5l8 7-8 7zM20 5l8 7-8 7z" fill="currentColor"/><rect x="29" y="5" width="2.5" height="14" fill="currentColor"/></svg>',
  radio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="7" y="7" width="10" height="15" rx="1.5"/><path d="M9 7V2"/><rect x="9" y="10" width="6" height="4" fill="currentColor" stroke="none" opacity=".55"/><path d="M9.5 17h5M9.5 19h5"/></svg>',
  notebook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="3" width="15" height="18" rx="1"/><path d="M3 7h4M3 12h4M3 17h4M10 8h7M10 12h7M10 16h5"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  bulbOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18h6M10 21h4M8.5 14.5A6 6 0 1 1 15.5 14.5c-.8.7-1 1.6-1 2.5h-5c0-.9-.2-1.8-1-2.5z"/><path d="M3 3l18 18" stroke-width="2.2"/></svg>',
};

export class UI {
  constructor(game, rootEl) {
    injectStyle();
    this.game = game;
    this.rootEl = rootEl || document.body;
    this.stack = [];          // [{id, screen, el}]
    this.modals = [];         // [{el, resolve, pause}]
    this.pending = [];        // очередь экранов [{id, params}]
    this.wantsPause = false;
    this.prompt = null;
    this.lastVisitor = null;
    this.power = true;
    this.attackOn = false;
    this._shownBriefingDay = null;
    this._shownSummaryDay = null;
    this._gameoverShown = false;
    this._hudT = 0; this._lastState = null; this._radioKey = '';
    this.settings = this._loadSettings();

    this.el = h('div.uch');
    this.hudEl = h('div.uch-hud.off');
    this.screensEl = h('div.uch-screens');
    this.subsEl = h('div.uch-subs');
    this.toastsEl = h('div.uch-toasts');
    this.modalEl = h('div.uch-modal');
    this.el.append(this.hudEl, this.screensEl, this.subsEl, this.toastsEl, this.modalEl);
    this.rootEl.appendChild(this.el);
    this._buildHud();
    this.applySettings(false);
    setSfx((name) => this.sfx(name));

    this._onKey = (e) => {
      if (e.key === 'Escape' && this.isBlocking()) { e.preventDefault(); e.stopImmediatePropagation(); this.back(); }
    };
    window.addEventListener('keydown', this._onKey, true);
    this._subscribe();
  }

  // ———————————————————— публичный API ————————————————————
  open(screenId, params = {}) {
    if (screenId === 'safe') { screenId = 'supply'; params = { tab: 'cash', ...params }; }
    const Cls = SCREENS[screenId];
    if (!Cls) { console.warn('[ui] неизвестный экран', screenId); return null; }
    if (Cls.needsGame && !this.game?.state) { console.warn('[ui] экран требует загруженной игры', screenId); return null; }
    const top = this.stack[this.stack.length - 1];
    if (top && top.id === screenId && !params.push) {
      top.screen.params = { ...top.screen.params, ...params };
      top.screen.refresh();
      return top.screen;
    }
    if (params.replace && top) this._pop(true);
    const prev = this.stack[this.stack.length - 1];
    const el = h('div.scr' + (Cls.skin ? '.' + Cls.skin : ''), { 'data-screen': screenId });
    el.addEventListener('click', (e) => { if (e.target === el && !Cls.modalLock) { sfx('ui_click'); this.back(); } });
    const screen = new Cls(this, params);
    screen.id = screenId;
    const entry = { id: screenId, screen, el };
    this.stack.push(entry);
    this.screensEl.appendChild(el);
    try { screen.mount(el); } catch (e) { console.error('[ui] mount', screenId, e); }
    if (prev) prev.el.classList.add('under');
    if (Cls.sound) sfx(Cls.sound);
    this._afterStackChange();
    this.game?.bus?.emit('ui:open', { id: screenId });
    return screen;
  }
  close() {
    if (!this.stack.length) return false;
    this._pop(false);
    return true;
  }
  closeScreen(screen) {
    const k = this.stack.findIndex((e) => e.screen === screen);
    if (k < 0) return;
    if (k === this.stack.length - 1) this._pop(false);
    else { const [e] = this.stack.splice(k, 1); this._destroyEntry(e, true); this._afterStackChange(); }
  }
  closeAll() {
    while (this.stack.length) this._pop(true, true);
    this._afterStackChange();
  }
  top() { return this.stack.length ? this.stack[this.stack.length - 1].id : null; }
  topScreen() { return this.stack.length ? this.stack[this.stack.length - 1].screen : null; }
  isOpen(id) { return this.stack.some((e) => e.id === id); }
  isBlocking() { return this.stack.length > 0 || this.modals.length > 0; }
  /** Назад (Android back / Esc): true — что-то закрыто */
  back() {
    if (this.modals.length) { const m = this.modals[this.modals.length - 1]; if (m.cancelable !== false) { this._closeModal(m, m.cancelValue); return true; } return true; }
    const t = this.topScreen();
    if (!t) return false;
    if (t.back()) return true;
    if (t.constructor.noBack) return true;
    this.close();
    return true;
  }
  /** Открыть экран сейчас или после закрытия текущих */
  queue(screenId, params = {}) {
    if (!this.isBlocking() && !this.pending.length) return this.open(screenId, params);
    if (!this.pending.some((p) => p.id === screenId && JSON.stringify(p.params) === JSON.stringify(params))) this.pending.push({ id: screenId, params });
    return null;
  }

  toast(text, kind = 'info', opts = {}) {
    if (!text) return;
    const el = h('div.toast.' + (kind || 'info'), String(text));
    const ttl = opts.dur ?? Math.min(9, 3.2 + String(text).length * 0.035);
    el.addEventListener('click', (e) => { e.stopPropagation(); if (opts.onClick) { sfx('ui_click'); opts.onClick(); } kill(); });
    let dead = false;
    const kill = () => { if (dead) return; dead = true; el.classList.add('out'); setTimeout(() => el.remove(), 380); };
    this.toastsEl.appendChild(el);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild.remove();
    setTimeout(kill, ttl * 1000);
    if ((kind === 'bad' || kind === 'alarm') && this.settings.vibration) this.vibrate(120);
    return el;
  }

  /** Диалог: {title, text, portrait?, choices:[{label, desc?, onPick, cls?}], cancelable} → Promise<index|null> */
  dialog(o = {}) {
    return new Promise((resolve) => {
      const m = { resolve, cancelable: o.cancelable !== false, cancelValue: null, pause: o.pause !== false };
      const choices = o.choices && o.choices.length ? o.choices : [{ label: 'Понятно' }];
      let por = null;
      if (o.portrait) por = o.portrait instanceof Node ? o.portrait : h('div.photo', portraitImg(o.portrait, { scale: 1.6, kind: o.portraitKind }));
      const rowBtns = choices.length <= 3 && choices.every((c) => !c.desc && String(c.label).length < 16);
      const dlg = h('div.dlg' + (o.cls ? '.' + o.cls : ''),
        o.title ? h('div.dlg-h', o.title) : null,
        h('div.dlg-b.scroll', por, h('div.dlg-t', o.text || '')),
        h('div.dlg-c' + (rowBtns ? '.row' : ''), choices.map((c, i) => {
          if (rowBtns) {
            const b = h('button.btn' + (c.cls ? '.' + c.cls : (i === 0 && choices.length > 1 ? '.primary' : '')), { type: 'button', 'data-choice': i }, c.label);
            b.addEventListener('click', (e) => { e.stopPropagation(); sfx('ui_click'); this._closeModal(m, i); try { c.onPick && c.onPick(); } catch (err) { console.error(err); } });
            return b;
          }
          const b = h('button.choice', { type: 'button', 'data-choice': i }, h('b', c.label), c.desc ? h('span', c.desc) : null);
          b.addEventListener('click', (e) => { e.stopPropagation(); sfx('ui_click'); this._closeModal(m, i); try { c.onPick && c.onPick(); } catch (err) { console.error(err); } });
          return b;
        })));
      const wrap = h('div.modal', dlg);
      wrap.addEventListener('click', (e) => { if (e.target === wrap && m.cancelable) { sfx('ui_click'); this._closeModal(m, null); } });
      m.el = wrap;
      this.modals.push(m);
      this.modalEl.appendChild(wrap);
      sfx('ui_paper');
      this._afterStackChange();
    });
  }
  confirm(text, opts = {}) {
    return this.dialog({
      title: opts.title || 'Подтверждение', text,
      choices: [{ label: opts.yes || 'Да', cls: opts.danger ? 'danger' : 'primary' }, { label: opts.no || 'Отмена' }],
    }).then((i) => i === 0);
  }

  setInteractPrompt(text) {
    const t = text ? String(text) : null;
    if (t === this.prompt) return;
    this.prompt = t;
    if (t) this.hud.promptText.textContent = t;
    this.hud.prompt.classList.toggle('on', !!t);
    this.hud.cross.classList.toggle('hot', !!t);
  }

  /** Реплика-субтитр */
  say(name, text, dur) {
    if (!text || this.settings.subtitles === false) return;
    const key = name || '';
    for (const c of [...this.subsEl.children]) if (c.dataset.who === key) c.remove();
    const el = h('div.sub-line', { 'data-who': key }, name ? h('span.who', name + ': ') : null, String(text));
    this.subsEl.appendChild(el);
    while (this.subsEl.children.length > 3) this.subsEl.firstChild.remove();
    const ttl = dur ?? Math.max(2.6, Math.min(7, 1.2 + String(text).length * 0.055));
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 420); }, ttl * 1000);
  }

  /** Меню вариантов при разговоре с актором (вызов из игры): options [{id,label}] */
  choices(title, options, onPick, opts = {}) {
    return this.dialog({ title, text: opts.text || '', portrait: opts.portrait, choices: options.map((o) => ({ label: o.label, desc: o.desc, onPick: () => onPick(o.id, o) })) });
  }

  update(dt = 0.016) {
    const g = this.game;
    if (g?.state && g.state !== this._lastState) this._onNewState();
    this._hudT -= dt;
    if (this._hudT <= 0) { this._hudT = 0.2; this._updateHud(); }
    const t = this.stack[this.stack.length - 1];
    if (t) { try { t.screen.tick(dt); } catch (e) { console.error('[ui] tick', t.id, e); } }
    // итог кампании
    const camp = g?.state?.campaign;
    if (camp?.result && !this._gameoverShown) this.showGameover(camp.result, camp.reason);
    if (!this.isBlocking() && this.pending.length) this._drainQueue();
  }

  // ———————————————————— настройки ————————————————————
  _loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}') || {}; } catch (e) { s = {}; }
    return { ...DEFAULT_SETTINGS, ...(this.game?.state?.settings || {}), ...s };
  }
  setSetting(key, value) {
    this.settings[key] = value;
    this.applySettings(true);
  }
  applySettings(emit = true) {
    const s = this.settings;
    this.el.style.setProperty('--ui-scale', String(s.uiScale || 1));
    if (this.game?.state) this.game.state.settings = { ...s };
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); } catch (e) { /* приватный режим */ }
    if (emit) {
      call(this.game?.audio, 'setVolume', s.volMaster, s.volSfx, s.volAmbience);
      call(this.game, 'applySettings', { ...s });
      this.game?.bus?.emit('settings', { settings: { ...s } });
    }
  }
  _onNewState() {
    this._lastState = this.game.state;
    this._gameoverShown = !!this.game.state.campaign?.result;
    this._shownBriefingDay = null; this._shownSummaryDay = null;
    this.game.state.settings = { ...this.settings };
    this.power = this.game.state.flags?.power !== false;
    this.attackOn = !!this.game.state.attack;
    this._radioKey = '';
  }

  // ———————————————————— служебное ————————————————————
  sfx(name) { try { this.game?.audio?.play?.(name, { vol: name === 'ui_click' ? 0.5 : 0.8 }); } catch (e) { /* без звука */ } }
  vibrate(p) { try { if (this.settings.vibration && navigator.vibrate) navigator.vibrate(p); } catch (e) { /* нет */ } }
  inCombat() { return !!(this.game?.combat?.active || this.game?.state?.attack); }

  _pop(silent, noAfter) {
    const e = this.stack.pop();
    if (!e) return;
    this._destroyEntry(e, silent);
    const prev = this.stack[this.stack.length - 1];
    if (prev) { prev.el.classList.remove('under'); try { prev.screen.refresh(); } catch (err) { console.error(err); } }
    if (!noAfter) this._afterStackChange();
    this.game?.bus?.emit('ui:close', { id: e.id });
  }
  _destroyEntry(e, silent) {
    try { e.screen.destroy(); } catch (err) { console.error(err); }
    if (silent) e.el.remove();
    else { e.el.classList.add('closing'); setTimeout(() => e.el.remove(), 170); }
  }
  _closeModal(m, value) {
    const k = this.modals.indexOf(m); if (k < 0) return;
    this.modals.splice(k, 1);
    m.el.remove();
    this._afterStackChange();
    m.resolve(value);
  }
  _afterStackChange() {
    const want = this.stack.some((e) => e.screen.wantsPause()) || this.modals.some((m) => m.pause);
    if (want !== this.wantsPause) { this.wantsPause = want; this.game?.bus?.emit('ui:pause', { want }); }
    const hide = this.stack.length > 0;
    this.hudEl.classList.toggle('off', hide || !this.game?.state);
    this._hudT = 0;
  }
  _drainQueue() {
    const inCombat = this.inCombat();
    const k = this.pending.findIndex((p) => !(inCombat && (p.id === 'offer' || p.id === 'visitor')));
    if (k < 0) return;
    const [p] = this.pending.splice(k, 1);
    if (p.id === 'briefing' && this._shownBriefingDay === this.game?.state?.time?.day) return;
    this.open(p.id, p.params);
  }
  showGameover(result, reason, extra = {}) {
    if (this._gameoverShown) return;
    this._gameoverShown = true;
    this.pending = [];
    this.closeAll();
    while (this.modals.length) this._closeModal(this.modals[0], null);
    this.open('gameover', { result, reason, ...extra });
  }

  // ———————————————————— HUD ————————————————————
  _buildHud() {
    const H = {};
    const speedBtn = (n, icon, title) => {
      const b = h('button', { type: 'button', title, 'data-speed': n, html: icon });
      b.style.cssText = 'display:flex;align-items:center;justify-content:center';
      b.querySelector('svg').style.cssText = 'width:1.25em;height:1.25em';
      b.addEventListener('click', (e) => { e.stopPropagation(); sfx('ui_click'); this._setSpeed(n); });
      return b;
    };
    H.speedBtns = [speedBtn(0, ICONS.pause, 'Пауза'), speedBtn(1, ICONS.play1, 'Скорость ×1'), speedBtn(3, ICONS.play3, 'Скорость ×3'), speedBtn(10, ICONS.play10, 'Скорость ×10')];
    H.clockMain = h('div.c-main');
    H.clockSub = h('div.c-sub');
    H.top = h('div.hud-top',
      h('div.hud-clock.hud-chip', H.clockMain, H.clockSub),
      h('div.hud-speed.hud-chip', H.speedBtns));
    H.radioLines = h('div');
    H.radioLed = h('span.led');
    H.radioReq = h('div.r-req', 'Ждут решения — нажмите');
    H.radio = h('div.hud-radio.hud-chip', { 'data-act': 'hud-radio' }, h('div.r-h', H.radioLed, 'Эфир · Заря'), H.radioLines, H.radioReq);
    H.radio.addEventListener('click', (e) => { e.stopPropagation(); sfx('ui_click'); this.open('radio', { filter: this._pendingRequests().length ? 'requests' : 'all' }); });
    const hb = (icon, label, act, fn) => { const b = h('button.hud-btn.hud-chip', { type: 'button', 'data-act': act, html: icon + `<span>${label}</span>` }); b.addEventListener('click', (e) => { e.stopPropagation(); sfx('ui_click'); fn(); }); return b; };
    H.radioBtn = hb(ICONS.radio, 'Рация', 'hud-radio-btn', () => this.open('radio'));
    H.radioBadge = h('span.badge.hidden');
    H.radioBtn.appendChild(H.radioBadge);
    H.noteBtn = hb(ICONS.notebook, 'Блокнот', 'hud-notebook', () => this.open('notebook'));
    H.menuBtn = hb(ICONS.menu, 'Меню', 'hud-menu', () => this.open('pause'));
    H.right = h('div.hud-right', H.radioBtn, H.noteBtn, H.menuBtn);
    H.bar = h('div', { style: 'position:absolute;left:0;right:0;top:0;display:flex;align-items:flex-start;gap:6px;padding:calc(6px + var(--sa-t)) calc(6px + var(--sa-r)) 0 calc(6px + var(--sa-l));pointer-events:none' },
      H.radio, h('div', { style: 'flex:1 1 0' }), H.top, h('div', { style: 'flex:1 1 0' }), H.right);
    // позиционирование внутри флекс-строки
    H.radio.style.cssText += ';position:relative;top:auto;left:auto;flex:0 1 440px;width:auto;min-width:0';
    H.top.style.cssText += ';position:relative;top:auto;left:auto;transform:none;flex:0 0 auto';
    H.right.style.cssText += ';position:relative;top:auto;right:auto;flex:0 0 auto';
    H.alertInd = h('div.ind.hud-chip.hidden');
    H.powerInd = h('div.ind.power.hud-chip.hidden', { html: ICONS.bulbOff + '<span>Нет света</span>' });
    H.threatInd = h('button.ind.threat.hud-chip.hidden', { type: 'button', 'data-act': 'hud-threat' }, h('span.dot'), h('span', 'Угроза нападения'));
    H.threatInd.addEventListener('click', (e) => { e.stopPropagation(); sfx('ui_click'); this.open('stationplan'); });
    H.ind = h('div.hud-ind', H.alertInd, H.powerInd, H.threatInd);
    H.attack = h('button.hud-attack.hidden', { type: 'button', 'data-act': 'hud-attack' }, h('span', 'Нападение на отделение'), H.attackSub = h('span.sub'));
    H.attack.addEventListener('click', (e) => { e.stopPropagation(); sfx('ui_click'); this.open('stationplan'); });
    H.cross = h('div.hud-cross', h('i'), h('i'), h('i'), h('i'), h('b'));
    H.promptText = h('span');
    H.prompt = h('div.hud-prompt', h('span.k', '◆'), H.promptText);
    H.player = h('div.hud-player.hud-chip.hidden');
    this.hudEl.append(H.bar, H.ind, H.attack, H.cross, H.prompt, H.player);
    this.hud = H;
  }
  _setSpeed(n) {
    const g = this.game; if (!g) return;
    if (this.inCombat() && n > 1) { this.toast('Во время боя — только реальное время', 'warn'); return; }
    if (typeof g.setSpeed === 'function') g.setSpeed(n);
    else { g.speed = n; g.paused = n === 0; }
    this._hudT = 0;
  }
  _pendingRequests() {
    const r = this.game?.state?.radio || [];
    const out = [];
    for (let i = r.length - 1; i >= 0 && i >= r.length - 80; i--) { const m = r[i]; if (m.choices && m.choices.length && (m.answered == null)) out.push(m); }
    return out;
  }
  _updateHud() {
    const g = this.game, s = g?.state, H = this.hud;
    if (!s) { this.hudEl.classList.add('off'); return; }
    const t = s.time || { day: 1, minute: 480 };
    const wide = window.innerWidth >= 760;
    const main = wide ? `Д${t.day}<span class="sep">·</span>${hhmm(t.minute)}<span class="sep">·</span>${weekday(t.day)}` : `Д${t.day}<span class="sep">·</span>${hhmm(t.minute)}`;
    if (H.clockMain._v !== main) { H.clockMain.innerHTML = main; H.clockMain._v = main; }
    const sub = wide ? dateStr(t.day) : weekday(t.day);
    if (H.clockSub.textContent !== sub) H.clockSub.textContent = sub;
    // скорость
    const combat = this.inCombat();
    const cur = g.paused ? 0 : (g.speed ?? 1);
    for (const b of H.speedBtns) {
      const n = +b.dataset.speed;
      b.classList.toggle('on', n === cur);
      b.disabled = combat && n > 1;
    }
    // рация
    const radio = s.radio || [];
    const req = this._pendingRequests();
    const last = radio[radio.length - 1];
    const key = radio.length + ':' + (last?.id || '') + ':' + req.length + ':' + (last?.answered ?? '');
    if (key !== this._radioKey) {
      this._radioKey = key;
      clear(H.radioLines);
      const lines = radio.slice(-3);
      if (!lines.length) H.radioLines.appendChild(h('div.r-line', 'Эфир молчит.'));
      for (const m of lines) {
        H.radioLines.appendChild(h('div.r-line.' + (m.kind || 'info'),
          h('span', hhmm(m.minute) + ' '), h('span.cs', (m.callsign || m.fromName || 'Эфир') + ': '), txt(m.text)));
      }
      H.radio.classList.toggle('req', req.length > 0);
      H.radioBadge.textContent = String(req.length);
      H.radioBadge.classList.toggle('hidden', !req.length);
      H.radioLed.classList.add('on'); clearTimeout(this._ledT); this._ledT = setTimeout(() => H.radioLed.classList.remove('on'), 900);
      requestAnimationFrame(() => this.el.style.setProperty('--radioH', (H.radio.offsetHeight + 6) + 'px'));
    }
    // тревога, свет, угроза
    const alert = s.defense?.alert || 'normal';
    H.alertInd.classList.toggle('hidden', alert === 'normal');
    H.alertInd.className = 'ind hud-chip ' + alert + (alert === 'normal' ? ' hidden' : '');
    H.alertInd.innerHTML = `<span class="dot"></span><span>${alert === 'siege' ? 'Осада' : 'Повышенная готовность'}</span>`;
    H.powerInd.classList.toggle('hidden', this.power);
    const threat = (s.attackPlans || []).some((p) => p.warned) && !s.attack;
    H.threatInd.classList.toggle('hidden', !threat);
    const attack = s.attack;
    H.attack.classList.toggle('hidden', !attack);
    if (attack) {
      const gang = (s.city?.gangs || []).find((x) => x.id === attack.gangId);
      const enemyZones = Object.entries(s.zones || {}).filter(([, z]) => z.owner === 'enemy').map(([id]) => zoneName(id));
      H.attackSub.textContent = (gang ? `«${gang.name}»` : '') + (enemyZones.length ? ` · заняты: ${enemyZones.slice(0, 2).join(', ')}${enemyZones.length > 2 ? '…' : ''}` : '');
    }
    const indH = H.ind.offsetHeight;
    this.el.style.setProperty('--indH', indH ? indH + 4 + 'px' : '0px');
    this.el.classList.toggle('hasInd', indH > 0);
    // игрок
    const p = g.player;
    if (p) {
      const w = p.weapon && p.weapon !== 'none' ? p.weapon : null;
      const show = !!w || (p.hp ?? 100) < 100;
      H.player.classList.toggle('hidden', !show);
      if (show) {
        const hp = Math.max(0, Math.round(p.hp ?? s.player?.hp ?? 100));
        let ammo = '';
        if (typeof p.ammo === 'number') ammo = String(p.ammo);
        else if (p.ammo && typeof p.ammo === 'object') ammo = (p.ammo.mag ?? p.ammo.clip ?? '?') + ' / ' + (p.ammo.reserve ?? p.ammo.total ?? '?');
        const html = `<span class="hp">♥<i><b style="width:${hp}%"></b></i>${hp}</span>${w ? `<span>${WEAPON_NAMES[w] || w}${ammo ? ' · ' + ammo : ''}</span>` : ''}`;
        if (H.player._v !== html) { H.player.innerHTML = html; H.player._v = html; }
      }
    }
    this.hudEl.classList.toggle('off', this.stack.length > 0);
  }

  // ———————————————————— события ————————————————————
  _subscribe() {
    const bus = this.game?.bus; if (!bus) return;
    const on = (ev, fn) => bus.on(ev, (p) => { try { fn(p || {}); } catch (e) { console.error('[ui] событие', ev, e); } });
    on('radio', ({ msg }) => {
      this._hudT = 0;
      if (!msg) return;
      if (this.game.audio?.radioBurst) call(this.game.audio, 'radioBurst', msg.kind); else this.sfx('radio_squelch');
      if (this.top() === 'radio') return;
      if (msg.kind === 'alarm') this.toast(`${msg.callsign || msg.fromName || 'Эфир'}: ${txt(msg.text)}`, 'bad', { onClick: () => this.open('radio') });
      else if (msg.choices && msg.choices.length && msg.answered == null) this.toast(`Запрос по рации — ${msg.callsign || msg.fromName || 'наряд'}: ${txt(msg.text)}`, 'warn', { onClick: () => this.open('radio', { filter: 'requests' }), dur: 8 });
    });
    on('offer', ({ offer }) => { if (offer) this.queue('offer', { offer }); });
    on('visitor:arrive', ({ visitor }) => {
      this.lastVisitor = visitor || null;
      const p = visitor?.person;
      this.toast(p ? `В дежурную часть пришёл${p.gender === 'f' ? 'а' : ''} ${p.gender === 'f' ? 'женщина' : 'мужчина'} — ждёт у окошка` : 'В дежурную часть пришёл посетитель', 'info');
    });
    on('call:incoming', () => this.toast('Звонит телефон в дежурной части', 'info'));
    on('attack:warning', ({ plan }) => {
      const gang = (this.game.state?.city?.gangs || []).find((x) => x.id === plan?.gangId);
      this.toast(`Осведомитель: ${gang ? `«${gang.name}» готовят` : 'готовится'} нападение на отделение`, 'warn', { onClick: () => this.open('stationplan'), dur: 9 });
    });
    on('attack:start', ({ plan }) => {
      this.attackOn = true; this._hudT = 0;
      const gang = (this.game.state?.city?.gangs || []).find((x) => x.id === plan?.gangId);
      this.toast(`Нападение на отделение${gang ? ` — «${gang.name}»` : ''}! Схема участка — управление обороной.`, 'bad', { onClick: () => this.open('stationplan'), dur: 8 });
      this.vibrate([200, 100, 200, 100, 300]);
      for (const e of this.stack) if (e.id === 'stationplan') e.screen.refresh();
    });
    on('attack:end', ({ result, losses }) => {
      this.attackOn = false; this._hudT = 0;
      const lossTxt = Array.isArray(losses) ? (losses.length ? `Потери: ${losses.length}.` : 'Без потерь.') : (losses && typeof losses === 'object' ? Object.entries(losses).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : v}`).join(', ') : (losses != null ? `Потери: ${losses}.` : ''));
      this.dialog({ title: ATTACK_RESULT[result] || 'Бой окончен', text: (result === 'repelled' ? 'Бандиты отступили. Раненых — в больницу, двери — под замок.\n' : result === 'occupied' ? 'Часть здания в руках противника. Соберите группу с задачей «Отбить зону».\n' : 'Здание потеряно.\n') + lossTxt });
    });
    on('day:start', () => {
      const d = this.game.state?.time?.day;
      if (d != null && this._shownBriefingDay === d) return;
      this.queue('briefing');
    });
    on('day:end', () => {
      const d = this.game.state?.time?.day;
      if (d != null && this._shownSummaryDay === d) return;
      this._shownSummaryDay = d;
      this.queue('daysummary');
    });
    on('player:dead', (p) => this.showGameover('lose', p.reason || (this.game.state?.player?.gender === 'f' ? 'Начальник отделения погибла при исполнении служебных обязанностей.' : 'Начальник отделения погиб при исполнении служебных обязанностей.'), { dead: true }));
    on('campaign:end', (p) => this.showGameover(p.result, p.reason));
    on('game:over', (p) => this.showGameover(p.result, p.reason));
    on('say', (p) => this.say(p.name || p.actor?.name || '', p.text));
    on('toast', (p) => this.toast(p.text, p.kind));
    on('power', (p) => {
      const was = this.power; this.power = p.on !== false; this._hudT = 0;
      if (was && !this.power) this.toast('Свет погас — работает только аварийное освещение', 'bad');
      else if (!was && this.power) this.toast('Свет снова есть', 'good');
    });
    on('zone:changed', ({ zoneId, owner }) => {
      if (owner === 'enemy') this.toast(`Противник занял: ${zoneName(zoneId)}`, 'bad', { onClick: () => this.open('stationplan') });
      else if (owner === 'police' && this.inCombat()) this.toast(`Отбили: ${zoneName(zoneId)}`, 'good');
    });
    on('task:depart', ({ taskId }) => { const t = this._task(taskId); this.toast(`${t?.callsign || 'Наряд'} выехал${t ? ': ' + this._taskWhere(t) : ''}`, 'info'); });
    on('task:return', ({ taskId, wounded, dead, detainees }) => {
      const t = this._task(taskId);
      const parts = [];
      if (detainees?.length) parts.push(`задержанных: ${detainees.length}`);
      if (wounded?.length) parts.push(`раненых: ${wounded.length}`);
      if (dead?.length) parts.push(`погибших: ${dead.length}`);
      this.toast(`${t?.callsign || 'Наряд'} вернулся на участок${parts.length ? ' — ' + parts.join(', ') : ''}`, dead?.length ? 'bad' : wounded?.length ? 'warn' : 'good');
    });
    on('detainee:new', ({ detainee }) => this.toast(detainee ? `В ИВС доставлен: ${detainee.person?.lastName || ''}${detainee.nick ? ' («' + detainee.nick + '»)' : ''}` : 'В ИВС доставлен задержанный', 'info', { onClick: () => this.open('detainees') }));
    on('log', (p) => { if (p?.toast || p?.entry?.toast) this.toast(p.text || p.entry?.text, p.kind || p.entry?.kind); });
    // все события — открытым экранам
    bus.on('*', ({ ev, payload }) => {
      if (ev === 'ui:open' || ev === 'ui:close' || ev === 'ui:pause') return;
      for (const e of this.stack) { try { e.screen.onEvent(ev, payload || {}); } catch (err) { console.error('[ui] onEvent', e.id, err); } }
    });
  }
  _task(id) { return (this.game.state?.city?.tasks || []).find((t) => t.id === id); }
  _taskWhere(t) {
    const d = (this.game.state?.city?.districts || []).find((x) => x.id === t.districtId);
    const p = d?.places?.find((x) => x.id === t.placeId);
    return p ? (p.prep || p.name) : d?.name || '';
  }
  destroy() {
    window.removeEventListener('keydown', this._onKey, true);
    this.closeAll();
    this.el.remove();
  }
}

export { GANG_TYPES };
