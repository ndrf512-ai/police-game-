// Управление: сенсорное (джойстик слева, обзор пальцем справа, кнопки) + клавиатура/мышь.
const CSS = `
#controls{position:fixed;inset:0;pointer-events:none;z-index:20;user-select:none;-webkit-user-select:none;touch-action:none}
#controls .zone{position:absolute;pointer-events:auto;touch-action:none}
#controls .stick-base{position:absolute;width:118px;height:118px;margin:-59px 0 0 -59px;border-radius:50%;border:2px solid rgba(220,220,200,.25);background:rgba(20,20,20,.18);display:none}
#controls .stick-knob{position:absolute;width:52px;height:52px;margin:-26px 0 0 -26px;border-radius:50%;background:rgba(230,225,200,.35);border:2px solid rgba(255,255,240,.4);display:none}
#controls .btn{position:absolute;pointer-events:auto;touch-action:none;width:66px;height:66px;border-radius:50%;background:rgba(25,25,22,.42);border:2px solid rgba(220,215,190,.38);color:rgba(240,235,215,.92);font:bold 10px/1.1 'Courier New',monospace;display:flex;align-items:center;justify-content:center;text-align:center;letter-spacing:.5px;text-shadow:0 1px 2px #000}
#controls .btn.on{background:rgba(160,130,60,.5);border-color:rgba(255,230,160,.7)}
#controls .btn.big{width:84px;height:84px;font-size:11px}
#controls .btn.down{background:rgba(200,180,120,.45);transform:scale(.94)}
#controls .btn.fire{background:rgba(120,20,20,.45);border-color:rgba(255,140,120,.5)}
#controls .btn.hidden{display:none}
#controls .hint-move{position:absolute;left:4%;bottom:6%;color:rgba(220,215,190,.25);font:11px 'Courier New',monospace;pointer-events:none}
`;

export class Input {
  constructor(root, opts = {}) {
    this.root = root; this.mx = 0; this.my = 0; this.lookDX = 0; this.lookDY = 0;
    this.run = false; this.crouch = false; this.flashlight = false;
    this.pressed = new Set(); this.held = new Set(); this.keys = new Set();
    this.sens = opts.sens ?? 1; this.invertY = false; this.enabled = true;
    this.touchMode = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this._buildDom(); this._bindKeys();
  }
  _buildDom() {
    if (!document.getElementById('controls-css')) { const st = document.createElement('style'); st.id = 'controls-css'; st.textContent = CSS; document.head.appendChild(st); }
    const c = document.createElement('div'); c.id = 'controls'; this.root.appendChild(c); this.el = c;
    // зоны
    const left = document.createElement('div'); left.className = 'zone'; Object.assign(left.style, { left: '0', bottom: '0', width: '44%', height: '72%' });
    const right = document.createElement('div'); right.className = 'zone'; Object.assign(right.style, { right: '0', top: '14%', width: '58%', height: '86%' });
    c.append(left, right);
    const base = document.createElement('div'); base.className = 'stick-base'; const knob = document.createElement('div'); knob.className = 'stick-knob'; c.append(base, knob);
    this.stickEl = { base, knob };
    if (this.touchMode) { const h = document.createElement('div'); h.className = 'hint-move'; h.textContent = '◄ ходьба ►'; c.appendChild(h); this.hintEl = h; }
    // джойстик
    let stickId = null, sx = 0, sy = 0;
    left.addEventListener('pointerdown', (e) => {
      if (!this.enabled || stickId !== null) return; stickId = e.pointerId; sx = e.clientX; sy = e.clientY; try { left.setPointerCapture(e.pointerId); } catch (er) { /* палец уже отпущен */ }
      base.style.display = knob.style.display = 'block'; base.style.left = knob.style.left = sx + 'px'; base.style.top = knob.style.top = sy + 'px';
      if (this.hintEl) this.hintEl.style.display = 'none'; e.preventDefault();
    });
    left.addEventListener('pointermove', (e) => {
      if (e.pointerId !== stickId) return; let dx = e.clientX - sx, dy = e.clientY - sy; const r = 52; const l = Math.hypot(dx, dy);
      // джойстик «догоняет» палец: если увёл далеко — центр подтягивается (не надо возвращать палец)
      if (l > r * 1.6) { const k = (l - r * 1.6) / l; sx += dx * k; sy += dy * k; base.style.left = sx + 'px'; base.style.top = sy + 'px'; dx = e.clientX - sx; dy = e.clientY - sy; }
      const lc = Math.hypot(dx, dy);
      if (lc > r) { dx = dx / lc * r; dy = dy / lc * r; }
      knob.style.left = sx + dx + 'px'; knob.style.top = sy + dy + 'px';
      // мёртвая зона и мягкая кривая: мелкое дрожание пальца не двигает персонажа
      const mag = Math.min(1, lc / r), dz = 0.14;
      const out = mag < dz ? 0 : Math.pow((mag - dz) / (1 - dz), 1.25);
      const nx = lc > 1e-3 ? dx / Math.min(lc, r) : 0, ny = lc > 1e-3 ? dy / Math.min(lc, r) : 0;
      this.mx = nx * out; this.my = -ny * out;
      this.run = lc > r * 1.3 || this.runLatch; // оттянул дальше — бег
    });
    const endStick = (e) => { if (e.pointerId !== stickId) return; stickId = null; this.mx = this.my = 0; base.style.display = knob.style.display = 'none'; this.run = this.runLatch; };
    this._resetStick = () => { stickId = null; this.mx = this.my = 0; base.style.display = knob.style.display = 'none'; this.run = this.runLatch; };
    left.addEventListener('pointerup', endStick); left.addEventListener('pointercancel', endStick);
    // обзор
    const looks = new Map();
    right.addEventListener('pointerdown', (e) => { if (!this.enabled) return; looks.set(e.pointerId, [e.clientX, e.clientY, performance.now(), e.clientX, e.clientY]); try { right.setPointerCapture(e.pointerId); } catch (er) { /* */ } e.preventDefault();
      if (!this.touchMode && document.pointerLockElement !== this.lockTarget && this.lockTarget) { try { this.lockTarget.requestPointerLock(); } catch (er) { /* */ } }
    });
    right.addEventListener('pointermove', (e) => {
      const p = looks.get(e.pointerId); if (!p) return; const k = 0.0055 * this.sens * (this.touchMode ? 1 : 0.6);
      const ddx = e.clientX - p[0], ddy = e.clientY - p[1]; const sp = Math.hypot(ddx, ddy);
      const acc = this.touchMode ? Math.min(1.6, 0.75 + sp * 0.025) : 1; // медленно — точно, резкий свайп — быстрый разворот
      this.lookDX += ddx * k * acc; this.lookDY += ddy * k * acc * 0.85 * (this.invertY ? -1 : 1); p[0] = e.clientX; p[1] = e.clientY;
    });
    const endLook = (e) => {
      const p = looks.get(e.pointerId); looks.delete(e.pointerId);
      // короткий тап по экрану = действие (удобно на телефоне)
      if (p && this.touchMode && performance.now() - p[2] < 260 && Math.hypot(e.clientX - p[3], e.clientY - p[4]) < 18) this.pressed.add('tap');
    };
    right.addEventListener('pointerup', endLook); right.addEventListener('pointercancel', endLook);
    this._resetLook = () => { looks.clear(); this.lookDX = this.lookDY = 0; };
    // кнопки
    const mk = (id, label, pos, cls = '') => {
      const b = document.createElement('div'); b.className = 'btn ' + cls; b.innerHTML = label; Object.assign(b.style, pos); c.appendChild(b);
      b.addEventListener('pointerdown', (e) => { if (!this.enabled) return; this.pressed.add(id); this.held.add(id); b.classList.add('down'); e.preventDefault(); e.stopPropagation(); });
      const up = () => { this.held.delete(id); b.classList.remove('down'); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
      return b;
    };
    this.btn = {
      act: mk('act', 'ДЕЙ-<br>СТВИЕ', { right: '4%', bottom: '24%' }, 'big'),
      fire: mk('fire', 'ОГОНЬ', { right: '15%', bottom: '8%' }, 'big fire hidden'),
      draw: mk('draw', 'ПМ', { right: '3%', bottom: '5%' }),
      crouch: mk('crouch', 'ПРИ-<br>СЕСТЬ', { right: '15%', bottom: '38%' }),
      light: mk('light', 'ФОНАРЬ', { right: '27%', bottom: '6%' }),
      run: mk('run', 'БЕГ', { left: '3%', bottom: '58%' }),
    };
    if (!this.touchMode) for (const b of Object.values(this.btn)) b.style.opacity = '0.55';
  }
  _bindKeys() {
    const map = { KeyE: 'act', KeyF: 'act', KeyR: 'draw', KeyC: 'crouch', ControlLeft: 'crouch', KeyL: 'light', Space: 'pause', Escape: 'menu', Tab: 'radio', KeyN: 'notebook', KeyM: 'citymap', Digit1: 'speed1', Digit2: 'speed2', Digit3: 'speed3', Digit0: 'speed0' };
    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      this.keys.add(e.code); const id = map[e.code]; if (id) { this.pressed.add(id); if (e.code === 'Tab' || e.code === 'Space') e.preventDefault(); }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    // сворачивание/потеря фокуса: иначе на Android после возврата «залипают» джойстик, бег и зажатые кнопки
    const resetAll = () => this.resetTouch(true);
    addEventListener('blur', resetAll); document.addEventListener('visibilitychange', () => { if (document.hidden) resetAll(); });
    addEventListener('pointercancel', resetAll);
    addEventListener('mousemove', (e) => { if (document.pointerLockElement && this.enabled) { this.lookDX += e.movementX * 0.0022 * this.sens; this.lookDY += e.movementY * 0.0022 * this.sens * (this.invertY ? -1 : 1); } });
    addEventListener('mousedown', (e) => { if (document.pointerLockElement && this.enabled) { if (e.button === 0) { this.pressed.add('fire'); this.held.add('fire'); } if (e.button === 2) this.pressed.add('draw'); } });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.held.delete('fire'); });
    addEventListener('contextmenu', (e) => e.preventDefault());
  }
  /** Снять состояние за кадр */
  poll() {
    let mx = this.mx, my = this.my;
    const K = this.keys;
    if (K.has('KeyW') || K.has('ArrowUp')) my = 1; if (K.has('KeyS') || K.has('ArrowDown')) my = -1;
    if (K.has('KeyA') || K.has('ArrowLeft')) mx = -1; if (K.has('KeyD') || K.has('ArrowRight')) mx = 1;
    const run = this.run || K.has('ShiftLeft') || K.has('ShiftRight');
    if (this.pressed.has('run')) { this.runLatch = !this.runLatch; this.run = this.runLatch; this.btn.run.classList.toggle('on', this.runLatch); }
    const out = { mx, my, run, lookDX: this.lookDX, lookDY: this.lookDY, pressed: new Set(this.pressed), held: new Set(this.held) };
    this.lookDX = this.lookDY = 0; this.pressed.clear();
    if (!this.enabled) { out.mx = out.my = out.lookDX = out.lookDY = 0; out.pressed.clear(); }
    return out;
  }
  /** Сбросить всё сенсорное состояние (и клавиши, если keys=true) */
  resetTouch(keys = false) {
    this._resetStick?.(); this._resetLook?.(); this.held.clear(); this.pressed.clear();
    for (const b of Object.values(this.btn || {})) b.classList.remove('down');
    if (keys) this.keys.clear();
  }
  setEnabled(on) { if (this.enabled === on) return; this.enabled = on; this.el.style.display = on ? '' : 'none'; if (!on) this.resetTouch(); }
  setArmed(drawn) { this.btn.fire.classList.toggle('hidden', !drawn); this.btn.draw.classList.toggle('on', drawn); }
  setButtonState(id, on) { this.btn[id]?.classList.toggle('on', !!on); }
}
