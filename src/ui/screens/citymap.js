// Карта города: бумажная карта с районами (полигоны mapPoly), нарядами, бандами и происшествиями;
// панель района, список нарядов, мастер нового задания (taskwizard.js).
import { Screen } from './base.js';
import { h, btn, bar, txt, hhmm, call, dur, hashStr, pn } from '../dom.js';
import { RNG } from '../../core/rng.js';
import { GANG_TYPES, GANG_COLORS, PHASE_NAMES, TASK_TYPES_FALLBACK, CRIME_CATS, rankShort } from '../labels.js';
import { TaskWizard } from './taskwizard.js';

const ASPECT = 1.45;
const RIVER = [[-0.05, 0.6], [0.12, 0.56], [0.27, 0.63], [0.44, 0.58], [0.58, 0.49], [0.74, 0.53], [0.88, 0.45], [1.05, 0.43]];
const LETTERS = 'АБВГДЕЖЗИК';

export function crimeColor(v, a = 1) {
  const t = Math.max(0, Math.min(1, (v || 0) / 100));
  const stops = [[96, 128, 70], [196, 160, 58], [168, 46, 32]];
  const k = t < 0.5 ? t * 2 : (t - 0.5) * 2, A = t < 0.5 ? stops[0] : stops[1], B = t < 0.5 ? stops[1] : stops[2];
  return `rgba(${Math.round(A[0] + (B[0] - A[0]) * k)},${Math.round(A[1] + (B[1] - A[1]) * k)},${Math.round(A[2] + (B[2] - A[2]) * k)},${a})`;
}
function pip(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function centroid(poly) { let x = 0, y = 0; for (const p of poly) { x += p[0]; y += p[1]; } return [x / poly.length, y / poly.length]; }
export function gangLetter(g) { return ({ sport: 'С', afghan: 'А', thieves: 'Б', drugs: 'Н', frostbitten: 'О' })[g.type] || (g.name || '?')[0]; }
export function taskCallsign(t, i) { return t.callsign || t.name || `Наряд-${(i ?? 0) + 1}`; }

/** Рендер карты на canvas */
export class MapView {
  constructor(canvas, game, opts = {}) {
    this.cv = canvas; this.game = game; this.opts = opts; this.sel = opts.selected || null; this.t = 0;
    this.ctx = canvas.getContext('2d');
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const id = this.hit((e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr);
      if (id && this.opts.onPick) this.opts.onPick(id);
    });
  }
  get districts() { return this.game?.state?.city?.districts || []; }
  resize() {
    const r = this.cv.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(r.width * this.dpr), H = Math.round(r.height * this.dpr);
    if (W === this.W && H === this.H && this.paper) return true;
    this.W = W; this.H = H; this.cv.width = W; this.cv.height = H;
    const pad = (this.opts.mini ? 6 : 14) * this.dpr;
    let mw = W - pad * 2, mh = mw / ASPECT;
    if (mh > H - pad * 2) { mh = H - pad * 2; mw = mh * ASPECT; }
    this.m = { x: (W - mw) / 2, y: (H - mh) / 2, w: mw, h: mh };
    this.fs = Math.max(9, Math.min(15, mw / 60)) * (this.opts.mini ? 0.85 : 1);
    this.paper = this.renderPaper();
    return true;
  }
  P(p) { return [this.m.x + p[0] * this.m.w, this.m.y + p[1] * this.m.h]; }
  hit(px, py) {
    const x = (px - this.m.x) / this.m.w, y = (py - this.m.y) / this.m.h;
    for (const d of this.districts) if (d.mapPoly && pip([x, y], d.mapPoly)) return d.id;
    // ближайшая подпись
    let best = null, bd = 0.08;
    for (const d of this.districts) { const c = d.labelPos || (d.mapPoly ? centroid(d.mapPoly) : null); if (!c) continue; const dd = Math.hypot(c[0] - x, (c[1] - y) / ASPECT); if (dd < bd) { bd = dd; best = d.id; } }
    return best;
  }
  renderPaper() {
    const c = document.createElement('canvas'); c.width = this.W; c.height = this.H;
    const x = c.getContext('2d'), { m, dpr } = this;
    const rng = new RNG((this.game?.state?.seed || 14) >>> 0);
    // стол под картой
    x.fillStyle = '#2e2922'; x.fillRect(0, 0, this.W, this.H);
    x.save(); x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 18 * dpr; x.shadowOffsetY = 6 * dpr;
    x.fillStyle = '#e3d4ab'; x.fillRect(m.x, m.y, m.w, m.h); x.restore();
    // пятна старения
    const g = x.createRadialGradient(m.x + m.w / 2, m.y + m.h / 2, m.h * 0.2, m.x + m.w / 2, m.y + m.h / 2, m.w * 0.7);
    g.addColorStop(0, 'rgba(255,250,230,.25)'); g.addColorStop(1, 'rgba(120,90,40,.32)');
    x.fillStyle = g; x.fillRect(m.x, m.y, m.w, m.h);
    for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(${rng.pick(['90,70,40', '255,255,240', '60,50,30'])},${rng.range(0.03, 0.12)})`; x.fillRect(m.x + rng.next() * m.w, m.y + rng.next() * m.h, dpr * rng.range(0.6, 1.6), dpr * rng.range(0.6, 1.6)); }
    x.save(); x.beginPath(); x.rect(m.x, m.y, m.w, m.h); x.clip();
    // сетка квадратов
    x.strokeStyle = 'rgba(90,70,40,.18)'; x.lineWidth = dpr;
    x.font = `${this.fs * 0.75 * dpr}px "Courier New",monospace`; x.fillStyle = 'rgba(80,60,30,.55)';
    for (let i = 1; i < 10; i++) { const gx = m.x + m.w * i / 10; x.beginPath(); x.moveTo(gx, m.y); x.lineTo(gx, m.y + m.h); x.stroke(); }
    for (let j = 1; j < 7; j++) { const gy = m.y + m.h * j / 7; x.beginPath(); x.moveTo(m.x, gy); x.lineTo(m.x + m.w, gy); x.stroke(); }
    if (!this.opts.mini) {
      for (let i = 0; i < 10; i++) x.fillText(LETTERS[i], m.x + m.w * (i + 0.5) / 10 - 3 * dpr, m.y + 10 * dpr);
      for (let j = 0; j < 7; j++) x.fillText(String(j + 1), m.x + 3 * dpr, m.y + m.h * (j + 0.5) / 7 + 3 * dpr);
    }
    // река
    const river = (w, col) => { x.strokeStyle = col; x.lineWidth = w; x.lineCap = 'round'; x.lineJoin = 'round'; x.beginPath(); RIVER.forEach((p, i) => { const [px, py] = this.P(p); if (i === 0) x.moveTo(px, py); else { const [qx, qy] = this.P(RIVER[i - 1]); x.quadraticCurveTo(qx, qy, (qx + px) / 2, (qy + py) / 2); } }); x.stroke(); };
    river(m.h * 0.052, 'rgba(70,90,100,.55)'); river(m.h * 0.042, '#9db0b1'); river(m.h * 0.012, 'rgba(255,255,255,.18)');
    // дороги от центра
    const ds = this.districts, cen = ds.find((d) => d.id === 'centr');
    const cpos = cen ? (cen.labelPos || centroid(cen.mapPoly)) : [0.5, 0.4];
    for (const d of ds) {
      if (d === cen || !d.mapPoly) continue;
      const p = d.labelPos || centroid(d.mapPoly);
      const [ax, ay] = this.P(cpos), [bx, by] = this.P(p), mx = (ax + bx) / 2 + (by - ay) * 0.15, my = (ay + by) / 2 - (bx - ax) * 0.15;
      for (const [w, col] of [[5.5 * dpr, 'rgba(110,80,40,.5)'], [3.2 * dpr, '#efe1b8']]) { x.strokeStyle = col; x.lineWidth = w; x.beginPath(); x.moveTo(ax, ay); x.quadraticCurveTo(mx, my, bx, by); x.stroke(); }
    }
    // железная дорога к вокзалу
    const vok = ds.find((d) => d.id === 'vokzal');
    if (vok) {
      const p = this.P(vok.labelPos || centroid(vok.mapPoly)), a = [m.x + m.w, m.y + m.h * 0.08], b = [m.x + m.w * 0.35, m.y];
      x.lineWidth = 3 * dpr; x.strokeStyle = '#3b332a'; x.beginPath(); x.moveTo(...a); x.quadraticCurveTo(p[0] + 30 * dpr, p[1] - 20 * dpr, p[0], p[1] - 14 * dpr); x.quadraticCurveTo(p[0] - 50 * dpr, p[1] - 30 * dpr, ...b); x.stroke();
      x.setLineDash([7 * dpr, 7 * dpr]); x.lineWidth = 1.6 * dpr; x.strokeStyle = '#efe1b8'; x.stroke(); x.setLineDash([]);
    }
    // кофейные кольца
    for (let i = 0; i < 2; i++) {
      const cx = m.x + m.w * rng.range(0.15, 0.85), cy = m.y + m.h * rng.range(0.2, 0.8), r = m.h * rng.range(0.07, 0.1);
      x.strokeStyle = 'rgba(120,70,30,.22)'; x.lineWidth = r * 0.12; x.beginPath(); x.arc(cx, cy, r, rng.range(0, 1), rng.range(4.5, 6.2)); x.stroke();
      const g2 = x.createRadialGradient(cx, cy, r * 0.3, cx, cy, r); g2.addColorStop(0, 'rgba(140,90,40,.07)'); g2.addColorStop(1, 'rgba(140,90,40,0)'); x.fillStyle = g2; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
    }
    // сгибы
    for (const [ax, ay, bx, by] of [[0.5, 0, 0.5, 1], [0, 0.5, 1, 0.5]]) {
      const [p1x, p1y] = this.P([ax, ay]), [p2x, p2y] = this.P([bx, by]);
      x.strokeStyle = 'rgba(90,70,40,.22)'; x.lineWidth = 2 * dpr; x.beginPath(); x.moveTo(p1x, p1y); x.lineTo(p2x, p2y); x.stroke();
      x.strokeStyle = 'rgba(255,250,235,.35)'; x.lineWidth = dpr; x.beginPath(); x.moveTo(p1x + dpr * 1.5, p1y + dpr * 1.5); x.lineTo(p2x + dpr * 1.5, p2y + dpr * 1.5); x.stroke();
    }
    x.restore();
    // рамка
    x.strokeStyle = '#4a3c26'; x.lineWidth = 2 * dpr; x.strokeRect(m.x + 5 * dpr, m.y + 5 * dpr, m.w - 10 * dpr, m.h - 10 * dpr);
    if (!this.opts.mini) {
      // картуш
      const fs = this.fs * dpr;
      x.fillStyle = 'rgba(239,228,196,.92)'; x.fillRect(m.x + m.w - 15.5 * fs, m.y + m.h - 3.4 * fs, 15 * fs, 2.9 * fs);
      x.strokeStyle = '#4a3c26'; x.lineWidth = dpr; x.strokeRect(m.x + m.w - 15.5 * fs, m.y + m.h - 3.4 * fs, 15 * fs, 2.9 * fs);
      x.fillStyle = '#3a2f1f'; x.font = `bold ${fs}px "Courier New",monospace`; x.fillText(`ПЛАН г. ${(this.game?.state?.city?.name || 'Н-ска').toUpperCase()}`, m.x + m.w - 15 * fs, m.y + m.h - 2.1 * fs);
      x.font = `${fs * 0.72}px "Courier New",monospace`; x.fillText('масштаб 1:25 000 · для служебного пользования', m.x + m.w - 15 * fs, m.y + m.h - 1 * fs);
      // роза ветров
      const rx = m.x + m.w - 2.2 * fs, ry = m.y + 2.6 * fs;
      x.fillStyle = '#3a2f1f'; x.beginPath(); x.moveTo(rx, ry - 1.6 * fs); x.lineTo(rx + 0.45 * fs, ry); x.lineTo(rx - 0.45 * fs, ry); x.fill();
      x.strokeStyle = '#3a2f1f'; x.beginPath(); x.moveTo(rx, ry); x.lineTo(rx, ry + 1.2 * fs); x.stroke();
      x.font = `bold ${fs * 0.9}px "Courier New",monospace`; x.fillText('С', rx - 0.3 * fs, ry - 1.8 * fs);
      // река — подпись
      const [lx, ly] = this.P([0.08, 0.6]);
      x.save(); x.translate(lx, ly); x.rotate(-0.05); x.font = `italic ${fs * 0.8}px "Courier New",monospace`; x.fillStyle = 'rgba(40,60,70,.8)'; x.fillText('р. Тихая', 0, -m.h * 0.035); x.restore();
    }
    return c;
  }
  draw(dt = 0) {
    if (!this.resize()) return;
    this.t += dt;
    const x = this.ctx, { m, dpr } = this, s = this.game?.state || {}, fs = this.fs * dpr;
    x.clearRect(0, 0, this.W, this.H);
    x.drawImage(this.paper, 0, 0);
    x.save(); x.beginPath(); x.rect(m.x, m.y, m.w, m.h); x.clip();
    // районы
    for (const d of this.districts) {
      if (!d.mapPoly) continue;
      const path = new Path2D(); d.mapPoly.forEach((p, i) => { const [px, py] = this.P(p); i ? path.lineTo(px, py) : path.moveTo(px, py); }); path.closePath();
      x.fillStyle = crimeColor(d.crime, this.sel === d.id ? 0.42 : 0.3); x.fill(path);
      if ((d.crime || 0) >= 60) {
        x.save(); x.clip(path); x.strokeStyle = 'rgba(150,30,20,.22)'; x.lineWidth = 1.2 * dpr;
        for (let k = -this.H; k < this.W; k += 9 * dpr) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k + this.H, this.H); x.stroke(); }
        x.restore();
      }
      x.setLineDash(this.sel === d.id ? [] : [6 * dpr, 4 * dpr]);
      x.strokeStyle = this.sel === d.id ? '#a8261d' : 'rgba(70,50,30,.75)'; x.lineWidth = (this.sel === d.id ? 3.2 : 1.5) * dpr; x.stroke(path); x.setLineDash([]);
    }
    // происшествия
    const today = s.time?.day;
    const crimes = (s.city?.crimes || []).filter((c) => (c.inProgress || c.status === 'new' || c.status === 'responding') && (c.day == null || today == null || c.day >= today - 1));
    for (const c of crimes.slice(-40)) {
      const d = this.districts.find((q) => q.id === c.districtId); if (!d?.mapPoly) continue;
      const p = this.pointIn(d, c.id);
      const [px, py] = this.P(p);
      const pulse = c.inProgress ? 0.5 + 0.5 * Math.sin(this.t * 6 + hashStr(c.id)) : 0;
      if (c.inProgress) { x.strokeStyle = `rgba(190,30,20,${0.5 * (1 - pulse)})`; x.lineWidth = 2 * dpr; x.beginPath(); x.arc(px, py, (4 + pulse * 7) * dpr, 0, 7); x.stroke(); }
      x.fillStyle = c.status === 'responding' ? '#2d4f8e' : '#b2241a'; x.beginPath(); x.arc(px, py, 3.2 * dpr, 0, 7); x.fill();
      x.strokeStyle = 'rgba(255,245,220,.8)'; x.lineWidth = dpr; x.stroke();
    }
    // подписи районов, банды, наряды
    const gangs = (s.city?.gangs || []).filter((g) => g.status !== 'broken');
    const tasks = (s.city?.tasks || []).filter((t) => t.phase !== 'done');
    for (const d of this.districts) {
      const lp = d.labelPos || (d.mapPoly ? centroid(d.mapPoly) : null); if (!lp) continue;
      const [lx, ly] = this.P(lp);
      x.font = `bold ${fs * (this.sel === d.id ? 1.12 : 1)}px "Courier New",monospace`; x.textAlign = 'center';
      x.lineWidth = 4 * dpr; x.strokeStyle = 'rgba(239,228,196,.92)'; x.strokeText(d.name.toUpperCase(), lx, ly);
      x.fillStyle = this.sel === d.id ? '#8a1c14' : '#2c2416'; x.fillText(d.name.toUpperCase(), lx, ly);
      if (!this.opts.mini) {
        x.font = `${fs * 0.72}px "Courier New",monospace`; const sub = `прест. ${Math.round(d.crime || 0)} · дов. ${Math.round(d.trust || 0)}`;
        x.lineWidth = 3 * dpr; x.strokeText(sub, lx, ly + fs * 0.95); x.fillStyle = '#4a3c26'; x.fillText(sub, lx, ly + fs * 0.95);
      }
      // банды
      const gs = gangs.filter((g) => (g.territory || []).includes(d.id) || (d.influence?.[g.id] || 0) >= 35);
      gs.forEach((g, i) => {
        const gx = lx - (gs.length - 1) * fs * 0.62 + i * fs * 1.25, gy = ly - fs * 1.45, r = fs * 0.55;
        x.fillStyle = (g.known ?? 100) < 25 ? '#6a6458' : (GANG_COLORS[g.type] || '#333'); x.beginPath(); x.arc(gx, gy, r, 0, 7); x.fill();
        x.strokeStyle = '#efe4c4'; x.lineWidth = 1.5 * dpr; x.stroke();
        x.fillStyle = '#fff'; x.font = `bold ${fs * 0.72}px "Courier New",monospace`; x.fillText((g.known ?? 100) < 25 ? '?' : gangLetter(g), gx, gy + fs * 0.25);
      });
      // наряды
      const ts = tasks.filter((t) => t.districtId === d.id);
      ts.forEach((t, i) => {
        const tx = lx + (i - (ts.length - 1) / 2) * fs * 3.2, ty = ly + fs * (this.opts.mini ? 1.4 : 2.3);
        const col = t.phase === 'active' ? '#2f5a25' : t.phase === 'returning' ? '#5a3f86' : '#2d4f8e';
        if (t.phase === 'enroute' || t.phase === 'departing') { const pz = (this.t * 1.4 + i * 0.3) % 1; x.strokeStyle = `rgba(45,79,142,${1 - pz})`; x.lineWidth = 2 * dpr; x.beginPath(); x.arc(tx, ty, fs * (0.5 + pz * 1.2), 0, 7); x.stroke(); }
        x.strokeStyle = '#1e1a14'; x.lineWidth = 1.6 * dpr; x.beginPath(); x.moveTo(tx, ty + fs * 0.5); x.lineTo(tx, ty - fs * 0.8); x.stroke();
        x.fillStyle = col; x.beginPath(); x.moveTo(tx, ty - fs * 0.8); x.lineTo(tx + fs * 0.95, ty - fs * 0.5); x.lineTo(tx, ty - fs * 0.2); x.fill();
        if (!this.opts.mini) {
          x.font = `bold ${fs * 0.68}px "Courier New",monospace`; const cs = taskCallsign(t, (s.city.tasks || []).indexOf(t));
          x.lineWidth = 3 * dpr; x.strokeStyle = 'rgba(239,228,196,.95)'; x.strokeText(cs, tx, ty + fs * 1.15); x.fillStyle = col; x.fillText(cs, tx, ty + fs * 1.15);
        }
      });
      x.textAlign = 'left';
    }
    x.restore();
    // легенда
    if (!this.opts.mini) {
      const lx = m.x + 10 * dpr, ly = m.y + m.h - 10 * dpr, f2 = fs * 0.7;
      x.font = `${f2}px "Courier New",monospace`;
      const items = [['sw', crimeColor(15, 0.6), 'спокойно'], ['sw', crimeColor(50, 0.6), 'неспокойно'], ['sw', crimeColor(90, 0.6), 'опасно'], ['dot', '#b2241a', 'происшествие'], ['flag', '#2d4f8e', 'наряд'], ['gang', '#5b2d6e', 'группировка']];
      const w = f2 * 9.5, hgt = items.length * f2 * 1.35 + f2 * 0.8;
      x.fillStyle = 'rgba(239,228,196,.9)'; x.fillRect(lx, ly - hgt, w, hgt); x.strokeStyle = '#4a3c26'; x.lineWidth = dpr; x.strokeRect(lx, ly - hgt, w, hgt);
      items.forEach(([k, c, t], i) => {
        const yy = ly - hgt + f2 * 1.2 + i * f2 * 1.35;
        x.fillStyle = c;
        if (k === 'sw') x.fillRect(lx + f2 * 0.5, yy - f2 * 0.75, f2 * 1.1, f2 * 0.85);
        else if (k === 'dot' || k === 'gang') { x.beginPath(); x.arc(lx + f2 * 1.05, yy - f2 * 0.32, f2 * (k === 'gang' ? 0.45 : 0.32), 0, 7); x.fill(); }
        else { x.beginPath(); x.moveTo(lx + f2 * 0.7, yy - f2 * 0.8); x.lineTo(lx + f2 * 1.6, yy - f2 * 0.5); x.lineTo(lx + f2 * 0.7, yy - f2 * 0.2); x.fill(); }
        x.fillStyle = '#2c2416'; x.fillText(t, lx + f2 * 2.1, yy);
      });
    }
  }
  pointIn(d, id) {
    const r = new RNG(hashStr(id));
    const xs = d.mapPoly.map((p) => p[0]), ys = d.mapPoly.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    for (let i = 0; i < 30; i++) { const p = [r.range(x0, x1), r.range(y0, y1)]; if (pip(p, d.mapPoly)) return p; }
    return d.labelPos || centroid(d.mapPoly);
  }
}

export class CityMapScreen extends Screen {
  static pause = true;
  constructor(ui, params) {
    super(ui, params);
    this.tab = params.tab || 'district';
    this.sel = params.districtId || null;
    this.openTask = null;
    this.wizard = params.wizard ? new TaskWizard(this, params.wizard === true ? {} : params.wizard) : null;
  }
  back() { if (this.wizard) { if (!this.wizard.back()) { this.wizard = null; this.refresh(); } return true; } return false; }
  startWizard(preset = {}) { this.wizard = new TaskWizard(this, preset); this.refresh(); }
  endWizard(taskOk) { this.wizard = null; if (taskOk) this.tab = 'tasks'; this.refresh(); }
  render() {
    if (this.wizard) return this.wizard.render();
    const s = this.state;
    const active = (s.city?.tasks || []).filter((t) => t.phase !== 'done');
    this.cv = h('canvas');
    const mapWrap = h('div.map-wrap', this.cv, h('div.map-hint', 'Нажмите на район'));
    const panel = h('div.pane.r.narrowL', { style: 'flex:0 0 clamp(15em,40%,27em)' },
      h('div.scroll.grow.pad', { 'data-scroll': 'citypanel' }, this.tab === 'district' ? this.districtPanel() : this.tasksPanel()),
      h('div.win-foot', btn('Новое задание', () => this.startWizard({ districtId: this.sel }), { cls: 'primary wide', act: 'new-task' })));
    return this.frame({
      title: 'Карта города', cls: '',
      tabs: [{ id: 'district', label: 'Районы' }, { id: 'tasks', label: 'Наряды', count: active.length }], tab: this.tab, onTab: (t) => { this.tab = t; this.refresh(); },
      body: h('div.split', h('div.pane.l', mapWrap), panel),
    });
  }
  afterRender() {
    if (this.wizard) { this.wizard.afterRender?.(); return; }
    this.map = new MapView(this.cv, this.game, { selected: this.sel, onPick: (id) => { this.sel = id; this.tab = 'district'; this.ui.sfx('ui_paper'); this.refresh(); } });
    requestAnimationFrame(() => this.map?.draw(0));
  }
  tick(dt) {
    if (this.wizard) { this.wizard.tick?.(dt); return; }
    this._acc = (this._acc || 0) + dt;
    if (this._acc > 0.08 && this.map) { this.map.draw(this._acc); this._acc = 0; }
    this._rt = (this._rt || 0) + dt;
    if (this._rt > 2 && !this.ui.wantsPause) { this._rt = 0; const key = JSON.stringify((this.state.city?.tasks || []).map((t) => [t.id, t.phase, Math.round(t.elapsed || 0)])); if (key !== this._key) { this._key = key; this.refresh(); } }
  }
  districtPanel() {
    const s = this.state, ds = s.city?.districts || [];
    const d = ds.find((x) => x.id === this.sel);
    if (!d) {
      return [h('div.sect', 'Обстановка в городе'),
        h('div.list', ds.map((x) => h('div.li', { 'data-district': x.id, onclick: () => { this.sel = x.id; this.ui.sfx('ui_paper'); this.refresh(); } },
          h('div', { style: `width:14px;height:14px;flex:0 0 auto;background:${crimeColor(x.crime, 0.8)};border:1px solid rgba(0,0,0,.4)` }),
          h('div.li-main', h('div.li-t', x.name), h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:.6em' }, bar(x.crime, 'bad', 'прест.', { thin: true }), bar(x.trust, 'good', 'дов.', { thin: true })))))),
        h('div.small.dim.mt', 'Цвет района — уровень преступности. Флажки — наряды, буквы в кружках — группировки, красные точки — свежие происшествия.')];
    }
    const gangs = (s.city?.gangs || []).filter((g) => g.status !== 'broken' && ((d.influence?.[g.id] || 0) > 0 || (g.territory || []).includes(d.id)))
      .sort((a, b) => (d.influence?.[b.id] || 0) - (d.influence?.[a.id] || 0));
    const crimes = (s.city?.crimes || []).filter((c) => c.districtId === d.id).slice(-30).reverse();
    const activeCr = crimes.filter((c) => c.status === 'new' || c.status === 'responding' || c.inProgress);
    const recent = crimes.filter((c) => !activeCr.includes(c)).slice(0, 5);
    const tasks = (s.city?.tasks || []).filter((t) => t.districtId === d.id && t.phase !== 'done');
    const placeKinds = { kiosk: 'ларёк', shop: 'магазин', bank: 'банк', school: 'школа', bar: 'бар', flat: 'квартира', garage: 'гаражи', warehouse: 'склад', street: 'улица', park: 'парк', station: 'вокзал', factory: 'завод', market: 'рынок', dacha: 'дачи', hostel: 'общежитие', church: 'церковь', office: 'контора', hospital: 'больница' };
    return [
      h('div.dist-head', h('button.btn.slim', { type: 'button', onclick: () => { this.sel = null; this.refresh(); }, 'data-act': 'all-districts' }, '‹'), h('div.dist-name', d.name)),
      d.desc ? h('div.small', { style: 'margin:.3em 0 .4em' }, d.desc) : null,
      h('div.col', bar(d.crime, 'bad', 'Преступность'), bar(d.trust, 'good', 'Доверие жителей'), bar(d.presence, 'good', 'Присутствие милиции')),
      d.stats ? h('div.small.mt', `Преступлений: ${d.stats.crimes ?? 0}, раскрыто: ${d.stats.solved ?? 0}, за сегодня: ${d.stats.today ?? 0}.`) : null,
      h('div.sect', 'Группировки'),
      gangs.length ? gangs.map((g) => {
        const known = (g.known ?? 100) >= 25;
        return h('div', { style: 'margin:.25em 0' },
          h('div.row', h('span', { style: `width:.9em;height:.9em;flex:0 0 auto;background:${known ? GANG_COLORS[g.type] : '#6a6458'};border:1px solid #000` }),
            h('b.grow', known ? `«${g.name}»` : 'Неустановленная группировка'), h('span.small.dim', known ? GANG_TYPES[g.type] || '' : '')),
          bar(d.influence?.[g.id] || 0, 'bad', 'влияние', { thin: true }),
          known && g.leader ? h('div.tiny.dim', `Главарь: ${g.leader.known ? `${g.leader.person?.lastName || ''} «${g.leader.nick}»` : `«${g.leader.nick || '?'}» — личность не установлена`}${g.leader.status === 'arrested' ? ' (задержан)' : g.leader.status === 'dead' ? ' (убит)' : ''}`) : null);
      }) : h('div.small.dim', 'Влияния группировок не замечено.'),
      h('div.sect', `Происшествия${activeCr.length ? ` (${activeCr.length})` : ''}`),
      activeCr.length ? activeCr.slice(0, 6).map((c) => h('div.task-li', { style: 'padding:.3em .5em' },
        h('div.row', h('b.grow', txt(c.title)), h('span.small', hhmm(c.minute ?? 0))),
        h('div.tiny.dim', `${c.place?.name || ''}${c.category ? ' · ' + (CRIME_CATS[c.category] || c.category) : ''} · ${'●'.repeat(c.severity || 1)}${c.inProgress ? ' · ПРОИСХОДИТ СЕЙЧАС' : ''}${c.status === 'responding' ? ' · наряд выехал' : ''}`),
        c.status === 'new' ? btn('Отправить наряд', () => this.startWizard({ type: 'respond', districtId: d.id, targetCrimeId: c.id }), { cls: 'slim', act: 'respond-' + c.id }) : null)) : h('div.small.dim', 'Открытых происшествий нет.'),
      recent.length ? h('details.details', h('summary', 'Недавние'), recent.map((c) => h('div.small', { style: 'padding:.15em 0' }, `${hhmm(c.minute ?? 0)} — ${txt(c.title)} `, h('span.dim', c.status === 'resolved' ? '(раскрыто)' : c.status === 'unsolved' ? '(не раскрыто)' : '')))) : null,
      tasks.length ? [h('div.sect', 'Наряды в районе'), tasks.map((t) => h('div.small', `${taskCallsign(t, s.city.tasks.indexOf(t))} — ${this.typeName(t.type)}, ${PHASE_NAMES[t.phase] || t.phase}`))] : null,
      h('details.details', h('summary', `Места (${(d.places || []).length})`),
        (d.places || []).map((p) => h('div.row', { style: 'padding:.2em 0;border-bottom:1px dotted rgba(36,33,28,.2)' }, h('span.grow.small', p.name), h('span.tiny.dim', placeKinds[p.kind] || p.kind || ''), p.guardable ? h('span.chip.good', 'охрана') : null))),
      h('div.btns.mt',
        btn('Патруль', () => this.startWizard({ type: 'patrol', districtId: d.id, step: 2 }), { cls: 'slim', act: 'quick-patrol' }),
        btn('Расследование', () => this.startWizard({ type: 'investigate', districtId: d.id, step: 1 }), { cls: 'slim', act: 'quick-invest' })),
    ];
  }
  typeName(id) { return (call(this.sim.city, 'taskTypes', this.game) || TASK_TYPES_FALLBACK).find((x) => x.id === id)?.name || id; }
  tasksPanel() {
    const s = this.state, all = s.city?.tasks || [];
    const active = all.filter((t) => t.phase !== 'done');
    const done = all.filter((t) => t.phase === 'done').slice(-6).reverse();
    const dn = (id) => (s.city?.districts || []).find((x) => x.id === id);
    const off = (id) => (s.staff || []).find((o) => o.id === id);
    const nm = (o) => o ? `${rankShort(o.rank)} ${o.lastName}` : '—';
    const card = (t) => {
      const i = all.indexOf(t), d = dn(t.districtId), pl = d?.places?.find((p) => p.id === t.placeId);
      const total = t.durationMin || t.orders?.durationMin || 0, el = t.elapsed || 0;
      const lastLog = (t.log || [])[t.log?.length - 1];
      const r = t.results || {};
      const open = this.openTask === t.id;
      return h('div.task-li', { 'data-task': t.id, onclick: () => { this.openTask = open ? null : t.id; this.refresh(); } },
        h('div.row', h('span.cs', taskCallsign(t, i)), h('span.ph.' + t.phase, PHASE_NAMES[t.phase] || t.phase), h('span.sp'), h('span.small.dim', this.typeName(t.type))),
        h('div.small', `${d?.name || ''}${pl ? ', ' + (pl.prep || pl.name) : ''}`),
        h('div.tiny.dim', `Старший: ${nm(off(t.leaderId))} · ${pn((t.officerIds || []).length, ['человек', 'человека', 'человек'])} · ${t.vehicle ? (s.economy?.vehicles || []).find((v) => v.id === t.vehicle)?.name || t.vehicle : 'пешком'}`),
        total ? h('div.prog', h('i', { style: { width: Math.min(100, el / total * 100) + '%' } })) : null,
        total ? h('div.tiny.dim', `${dur(el)} из ${dur(total)}`) : null,
        lastLog ? h('div.small', { style: 'margin-top:.2em' }, `${hhmm(lastLog.minute)} — ${txt(lastLog.text)}`) : null,
        (r.detainees?.length || r.wounded?.length || r.killed?.length || r.crimesPrevented || r.crimesSolved) ? h('div.chips.mt',
          r.detainees?.length ? h('span.chip.good', `задержано: ${r.detainees.length}`) : null, r.crimesPrevented ? h('span.chip.good', `пресечено: ${r.crimesPrevented}`) : null,
          r.crimesSolved ? h('span.chip.good', `раскрыто: ${r.crimesSolved}`) : null, r.wounded?.length ? h('span.chip.bad', `ранено: ${r.wounded.length}`) : null, r.killed?.length ? h('span.chip.bad', `погибло: ${r.killed.length}`) : null) : null,
        open ? h('div.mt', h('div.small', 'Состав: ' + (t.officerIds || []).map((id) => nm(off(id)) + (id === t.leaderId ? ' (ст.)' : '')).join(', ')),
          (t.log || []).slice(-8).reverse().map((l) => h('div.tiny', { style: 'padding:.1em 0' }, `${hhmm(l.minute)} ${txt(l.text)}`))) : null,
        t.phase !== 'done' ? h('div.btns.mt',
          btn('Эфир', () => this.ui.open('radio', { filter: t.id }), { cls: 'slim', act: 'radio-' + t.id }),
          t.phase !== 'returning' ? btn('Отозвать', () => this.recall(t), { cls: 'slim danger', act: 'recall-' + t.id }) : null) : null);
    };
    return [
      h('div.sect', `Действующие наряды (${active.length})`),
      active.length ? active.map(card) : h('div.empty', 'Все дома. Город предоставлен сам себе.'),
      done.length ? [h('div.sect', 'Завершённые'), done.map(card)] : null,
    ];
  }
  async recall(t) {
    if (!(await this.ui.confirm(`Отозвать ${taskCallsign(t, this.state.city.tasks.indexOf(t))}? Наряд прекратит задание и вернётся на участок.`, { yes: 'Отозвать', danger: true }))) return;
    call(this.sim.city, 'cancelTask', this.game, t.id);
    this.ui.toast('Наряд отозван — возвращается', 'info');
    this.refresh();
  }
  onEvent(ev) { if (ev === 'task:depart' || ev === 'task:return' || ev === 'crime:new') this._key = null; }
}
