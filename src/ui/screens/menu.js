// Главное меню: дождь по стеклу ночного окна, папка-обложка с названием.
import { Screen } from './base.js';
import { h, btn, stamp } from '../dom.js';
import { headerLine } from '../labels.js';

export class MenuScreen extends Screen {
  static pause = true; static skin = 'menu'; static needsGame = false; static hideHud = true; static sound = null;
  back() { if (this.params.fromGame && this.game?.state) { this.close(); return true; } return true; }
  render() {
    const g = this.game;
    let hasSave = false;
    try { hasSave = typeof g?.hasSave === 'function' ? !!g.hasSave() : !!localStorage.getItem('uchastok_save'); } catch (e) { hasSave = false; }
    const info = typeof g?.saveInfo === 'function' ? g.saveInfo() : null;
    this.cv = h('canvas.menu-cv');
    const card = h('div.menu-card',
      h('div.lbl', headerLine(null)),
      h('div.menu-title', 'УЧАСТОК'),
      h('div.menu-subt', 'Осень. 1996.'),
      h('div.rule'),
      h('div.menu-btns',
        this.params.fromGame && g?.state ? btn([h('span.n', '0'), 'Вернуться'], () => this.close(), { act: 'resume' }) : null,
        btn([h('span.n', '1'), 'Продолжить', info ? h('span.tiny.dim', { style: 'margin-left:auto;text-transform:none;letter-spacing:0;font-weight:400' }, info) : null], () => this.cont(), { disabled: !hasSave, act: 'continue' }),
        btn([h('span.n', '2'), 'Новая игра'], () => this.ui.open('newgame'), { act: 'newgame' }),
        btn([h('span.n', '3'), 'Настройки'], () => this.ui.open('settings'), { act: 'settings' }),
      ),
      stamp('Дело № 14', { rot: 9, violet: false, style: { fontSize: '.8em' } }),
    );
    return h('div', { style: 'position:absolute;inset:0' }, this.cv,
      h('div.menu-wrap', card),
      h('div.menu-foot', 'Держите телефон горизонтально · Дождь не кончится'));
  }
  async cont() {
    const g = this.game;
    if (g?.state && this.params.fromGame) {
      if (!(await this.ui.confirm('Загрузить сохранение? Несохранённый ход будет потерян.'))) return;
    }
    let ok = false;
    try { ok = typeof g?.load === 'function' ? g.load() !== false : false; } catch (e) { console.error(e); ok = false; }
    if (ok) { this.ui.closeAll(); this.ui.toast('Игра загружена', 'good'); }
    else this.ui.toast('Не удалось загрузить сохранение', 'bad');
  }
  afterRender() { this.rain = new RainGlass(this.cv, () => { if (this.ui.settings.volMaster > 0) this.ui.sfx('thunder'); }); }
  destroy() { this.rain?.stop(); }
}

/** Дождь по стеклу: размытые огни улицы, рама окна, капли и стекающие струйки */
export class RainGlass {
  constructor(cv, onThunder) {
    this.cv = cv; this.ctx = cv.getContext('2d'); this.onThunder = onThunder;
    this.drops = []; this.runs = []; this.flash = 0; this.t = 0; this.alive = true;
    this.resize();
    this._ro = () => this.resize(); window.addEventListener('resize', this._ro);
    let last = performance.now();
    const loop = (now) => {
      if (!this.alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (this.cv.isConnected && this.cv.offsetParent !== null) this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  stop() { this.alive = false; window.removeEventListener('resize', this._ro); }
  resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, Math.round((r.width || innerWidth) * dpr)); this.h = Math.max(1, Math.round((r.height || innerHeight) * dpr));
    this.cv.width = this.w; this.cv.height = this.h; this.dpr = dpr;
    // фон: размытые огни в низком разрешении
    const bw = Math.max(64, Math.round(this.w / 6)), bh = Math.max(36, Math.round(this.h / 6));
    const b = document.createElement('canvas'); b.width = bw; b.height = bh;
    const c = b.getContext('2d');
    const gr = c.createLinearGradient(0, 0, 0, bh); gr.addColorStop(0, '#0b1017'); gr.addColorStop(0.55, '#121820'); gr.addColorStop(1, '#1a160f');
    c.fillStyle = gr; c.fillRect(0, 0, bw, bh);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const light = (x, y, r, col, a) => { const g2 = c.createRadialGradient(x, y, 0, x, y, r); g2.addColorStop(0, col.replace('A', a)); g2.addColorStop(1, col.replace('A', 0)); c.fillStyle = g2; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); };
    // дома-силуэты
    c.fillStyle = '#07090c';
    for (let i = 0; i < 9; i++) { const x = rnd() * bw, w = bw * (0.08 + rnd() * 0.12), hgt = bh * (0.25 + rnd() * 0.35); c.fillRect(x, bh * 0.62 - hgt, w, hgt + bh * 0.4); }
    // окна домов
    for (let i = 0; i < 60; i++) { if (rnd() < 0.55) continue; light(rnd() * bw, bh * (0.25 + rnd() * 0.35), 1.6, 'rgba(255,200,120,A)', 0.5); }
    // фонари (натрий), фары, вывеска аптеки
    for (let i = 0; i < 7; i++) light(rnd() * bw, bh * (0.5 + rnd() * 0.2), bh * (0.05 + rnd() * 0.06), 'rgba(255,160,60,A)', 0.55);
    for (let i = 0; i < 4; i++) light(rnd() * bw, bh * (0.72 + rnd() * 0.1), bh * 0.04, 'rgba(255,40,30,A)', 0.5);
    for (let i = 0; i < 3; i++) light(rnd() * bw, bh * (0.7 + rnd() * 0.1), bh * 0.05, 'rgba(220,230,255,A)', 0.45);
    light(bw * 0.78, bh * 0.42, bh * 0.05, 'rgba(60,255,120,A)', 0.4);
    // мокрый асфальт: отражения
    c.globalAlpha = 0.3; c.scale(1, -1); c.drawImage(b, 0, bh * 0.3, bw, bh * 0.32, 0, -bh * 0.94, bw, bh * 0.32); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1;
    this.bg = b;
    // капли
    const n = Math.round((this.w * this.h) / (9000 * dpr * dpr) * 1.4);
    this.drops = Array.from({ length: n }, () => ({ x: Math.random() * this.w, y: Math.random() * this.h, r: (0.6 + Math.random() * Math.random() * 3) * dpr }));
    this.runs = [];
  }
  frame(dt) {
    const { ctx, w, h, dpr } = this;
    this.t += dt;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.bg, 0, 0, w, h);
    // косые струи дождя за стеклом
    ctx.strokeStyle = 'rgba(170,190,210,0.07)'; ctx.lineWidth = dpr;
    ctx.beginPath();
    for (let i = 0; i < 70; i++) { const x = (Math.random() * 1.2 - 0.1) * w, y = Math.random() * h; ctx.moveTo(x, y); ctx.lineTo(x - 6 * dpr, y + 26 * dpr); }
    ctx.stroke();
    // молния
    if (Math.random() < dt * 0.025) { this.flash = 1; setTimeout(() => this.onThunder && this.onThunder(), 900 + Math.random() * 1600); }
    if (this.flash > 0) { ctx.fillStyle = `rgba(200,210,235,${this.flash * 0.22})`; ctx.fillRect(0, 0, w, h); this.flash -= dt * (this.flash > 0.6 ? 6 : 1.8); }
    // капли на стекле
    for (const d of this.drops) this.drawDrop(d.x, d.y, d.r);
    // стекающие струйки
    if (this.runs.length < 14 && Math.random() < dt * 3) this.runs.push({ x: Math.random() * w, y: -10, r: (2.2 + Math.random() * 2.5) * dpr, v: (25 + Math.random() * 70) * dpr, trail: [] });
    for (const r of this.runs) {
      r.y += r.v * dt * (0.5 + Math.random()); r.x += (Math.random() - 0.5) * 1.5 * dpr;
      r.trail.push([r.x, r.y]); if (r.trail.length > 70) r.trail.shift();
      ctx.strokeStyle = 'rgba(180,200,215,0.12)'; ctx.lineWidth = r.r * 0.8; ctx.lineCap = 'round';
      ctx.beginPath(); r.trail.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      this.drawDrop(r.x, r.y, r.r);
      // поглощает мелкие
      for (const d of this.drops) if (Math.abs(d.x - r.x) < r.r + d.r && Math.abs(d.y - r.y) < r.r + d.r) { d.x = Math.random() * w; d.y = Math.random() * h; }
    }
    this.runs = this.runs.filter((r) => r.y < h + 20);
    // рама окна
    ctx.fillStyle = '#050607';
    const fw = Math.max(10, w * 0.016);
    ctx.fillRect(w * 0.62 - fw / 2, 0, fw, h);
    ctx.fillRect(0, h * 0.34 - fw / 2, w, fw);
    ctx.fillStyle = 'rgba(255,170,90,0.05)'; ctx.fillRect(w * 0.62 - fw / 2, 0, 2 * dpr, h);
    // тёплая виньетка комнаты
    const v = ctx.createRadialGradient(w * 0.5, h * 0.55, h * 0.2, w * 0.5, h * 0.55, h * 1.05);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
  }
  drawDrop(x, y, r) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(10,14,20,0.35)'; ctx.beginPath(); ctx.ellipse(x, y + r * 0.25, r, r * 1.1, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(190,205,220,0.22)'; ctx.beginPath(); ctx.ellipse(x, y, r * 0.85, r * 0.95, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x - r * 0.35, y - r * 0.45, Math.max(1, r * 0.3), Math.max(1, r * 0.3));
  }
}
