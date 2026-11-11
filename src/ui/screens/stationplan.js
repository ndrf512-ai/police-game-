// Схема участка: чертёж здания на миллиметровке (ROOMS/DOORS/WINDOWS/CELLS/POINTS из level.js),
// зоны и их владельцы, двери и баррикады, посты, группы обороны с доктринами, уровень тревоги,
// живая картина во время нападения (враги видны только при работающих камерах).
import { Screen } from './base.js';
import { h, btn, seg, toggle, call, txt, hhmm, sfx, pn } from '../dom.js';
import { portraitImg } from '../portrait.js';
import { ROOMS, OUTDOOR, DOORS, WINDOWS, CELLS, POINTS, PROPS } from '../../world/level.js';
import { ALERT_LEVELS, DOCTRINE_DETAILS, ZONES, zoneName, OWNER_NAMES, POST_NAMES, doctrineDefs, rankShort, statusName } from '../labels.js';

const B = { x0: -1.6, z0: -7.6, x1: 38.1, z1: 26.6 };
const GCOL = ['#2d4f8e', '#3a6b31', '#9a5c12', '#6a3e86', '#1f7a72', '#8a2a4a', '#4a4a4a'];
const DOOR_KIND = { front: 'главная дверь', steel: 'стальная дверь', wood: 'деревянная дверь', arch: 'проём без двери', gate: 'ворота' };
const ALL_ZONES = [...ROOMS, ...OUTDOOR];

export class PlanView {
  constructor(cv, screen) {
    this.cv = cv; this.s = screen; this.ctx = cv.getContext('2d'); this.t = 0;
    cv.addEventListener('click', (e) => {
      const r = cv.getBoundingClientRect();
      const [x, z] = this.toWorld((e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr);
      this.s.onPlanTap(this.hit(x, z), x, z);
    });
  }
  resize() {
    const r = this.cv.getBoundingClientRect(); if (!r.width || !r.height) return false;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(r.width * this.dpr), H = Math.round(r.height * this.dpr);
    if (W !== this.W || H !== this.H) { this.W = W; this.H = H; this.cv.width = W; this.cv.height = H; this.bg = null; }
    const bw = B.x1 - B.x0, bh = B.z1 - B.z0, pad = 8 * this.dpr;
    this.k = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh);
    this.ox = (W - bw * this.k) / 2 - B.x0 * this.k; this.oy = (H - bh * this.k) / 2 - B.z0 * this.k;
    return true;
  }
  X(x) { return this.ox + x * this.k; }
  Z(z) { return this.oy + z * this.k; }
  toWorld(px, py) { return [(px - this.ox) / this.k, (py - this.oy) / this.k]; }
  rect(r) { return [this.X(r[0]), this.Z(r[1]), (r[2] - r[0]) * this.k, (r[3] - r[1]) * this.k]; }
  hit(x, z) {
    for (const d of DOORS) { const cx = (d.rect[0] + d.rect[2]) / 2, cz = (d.rect[1] + d.rect[3]) / 2; if (Math.hypot(cx - x, cz - z) < Math.max(1.1, (d.rect[2] - d.rect[0]) / 2)) return { type: 'door', id: d.id }; }
    for (const r of ROOMS) if (x >= r.rect[0] && x <= r.rect[2] && z >= r.rect[1] && z <= r.rect[3]) return { type: 'zone', id: r.id };
    for (const r of OUTDOOR) if (x >= r.rect[0] && x <= r.rect[2] && z >= r.rect[1] && z <= r.rect[3]) return { type: 'zone', id: r.id };
    return null;
  }
  renderBg() {
    const c = document.createElement('canvas'); c.width = this.W; c.height = this.H;
    const x = c.getContext('2d'), k = this.k, d = this.dpr;
    x.fillStyle = '#efeadb'; x.fillRect(0, 0, this.W, this.H);
    // миллиметровка
    const grid = (step, col, w) => { x.strokeStyle = col; x.lineWidth = w; x.beginPath(); for (let gx = Math.floor(B.x0 / step) * step; gx <= B.x1; gx += step) { x.moveTo(this.X(gx), 0); x.lineTo(this.X(gx), this.H); } for (let gz = Math.floor(B.z0 / step) * step; gz <= B.z1; gz += step) { x.moveTo(0, this.Z(gz)); x.lineTo(this.W, this.Z(gz)); } x.stroke(); };
    if (k > 10 * d) grid(0.5, 'rgba(214,140,70,.12)', 0.6 * d);
    grid(1, 'rgba(214,140,70,.2)', 0.7 * d); grid(5, 'rgba(200,110,50,.35)', 1 * d);
    // улица/двор/проезд
    for (const o of OUTDOOR) {
      const [rx, ry, rw, rh] = this.rect(o.rect);
      x.save(); x.beginPath(); x.rect(rx, ry, rw, rh); x.clip();
      if (o.id === 'street') { x.fillStyle = 'rgba(120,120,120,.12)'; x.fillRect(rx, ry, rw, rh); x.strokeStyle = 'rgba(80,80,80,.18)'; x.lineWidth = d; for (let i = -rh; i < rw; i += 7 * d) { x.beginPath(); x.moveTo(rx + i, ry); x.lineTo(rx + i + rh, ry + rh); x.stroke(); } }
      else { x.fillStyle = 'rgba(110,90,50,.18)'; for (let i = 0; i < rw * rh / (40 * d * d); i++) x.fillRect(rx + Math.random() * rw, ry + Math.random() * rh, 1.3 * d, 1.3 * d); }
      x.restore();
    }
    // тротуар
    const [sx, sy, sw] = this.rect([-6, 20, 38, 23]); x.fillStyle = 'rgba(150,150,150,.12)'; x.fillRect(sx, sy, sw, 3 * k);
    // полы
    for (const r of ROOMS) {
      const [rx, ry, rw, rh] = this.rect(r.rect);
      x.fillStyle = r.floor === ',' ? 'rgba(170,190,200,.2)' : r.floor === ':' ? 'rgba(150,140,120,.16)' : 'rgba(220,200,150,.14)'; x.fillRect(rx, ry, rw, rh);
      if (r.floor === ',') { x.strokeStyle = 'rgba(120,140,150,.14)'; x.lineWidth = 0.6 * d; x.beginPath(); for (let i = 0.5; i < r.rect[2] - r.rect[0]; i += 0.5) { x.moveTo(rx + i * k, ry); x.lineTo(rx + i * k, ry + rh); } for (let j = 0.5; j < r.rect[3] - r.rect[1]; j += 0.5) { x.moveTo(rx, ry + j * k); x.lineTo(rx + rw, ry + j * k); } x.stroke(); }
    }
    // мебель
    x.strokeStyle = 'rgba(60,70,90,.45)'; x.lineWidth = 0.9 * d; x.fillStyle = 'rgba(90,100,120,.10)';
    for (const p of PROPS) if (p.rect && p.type !== 'uaz') { const [rx, ry, rw, rh] = this.rect(p.rect); x.fillRect(rx, ry, rw, rh); x.strokeRect(rx, ry, rw, rh); }
    // УАЗы
    for (const p of PROPS) if (p.type === 'uaz') { const [rx, ry, rw, rh] = this.rect(p.rect); x.fillStyle = 'rgba(60,80,60,.25)'; x.fillRect(rx, ry, rw, rh); x.strokeStyle = '#3a4a3a'; x.strokeRect(rx, ry, rw, rh); x.fillStyle = '#2b352b'; x.font = `bold ${Math.max(8, 0.75 * k)}px "Courier New",monospace`; x.textAlign = 'center'; x.fillText('УАЗ ' + p.id.slice(-1), rx + rw / 2, ry + rh / 2 + 0.25 * k); x.textAlign = 'left'; }
    // стены
    const wall = Math.max(2 * d, 0.28 * k);
    x.strokeStyle = '#23262c'; x.lineWidth = wall; x.lineJoin = 'miter';
    for (const r of ROOMS) { const [rx, ry, rw, rh] = this.rect(r.rect); x.strokeRect(rx, ry, rw, rh); }
    // камеры ИВС
    for (const c2 of CELLS) {
      x.lineWidth = wall * 0.8; x.beginPath(); x.moveTo(this.X(c2.rect[2]), this.Z(c2.rect[1])); x.lineTo(this.X(c2.rect[2]), this.Z(c2.rect[3])); x.stroke();
      x.lineWidth = 1.4 * d; x.setLineDash([2 * d, 2.5 * d]); x.beginPath(); x.moveTo(this.X(c2.rect[0]), this.Z(c2.rect[3])); x.lineTo(this.X(c2.rect[2]), this.Z(c2.rect[3])); x.stroke(); x.setLineDash([]);
    }
    // заборы
    x.strokeStyle = 'rgba(60,60,60,.6)'; x.lineWidth = 1.2 * d; x.setLineDash([6 * d, 3 * d]);
    for (const seg2 of [[-1, -7, 37.5, -7], [-1, -7, -1, 20], [37.5, -7, 37.5, 20], [32, -7, 32, 0]]) { x.beginPath(); x.moveTo(this.X(seg2[0]), this.Z(seg2[1])); x.lineTo(this.X(seg2[2]), this.Z(seg2[3])); x.stroke(); }
    x.setLineDash([]);
    // окна: просвет и двойная линия
    for (const w of WINDOWS) {
      const [rx, ry, rw, rh] = this.rect(w); const horiz = rw > rh;
      x.fillStyle = '#efeadb'; x.fillRect(rx - (horiz ? 0 : 0.1 * k), ry - (horiz ? 0.1 * k : 0), rw + (horiz ? 0 : 0.2 * k), rh + (horiz ? 0.2 * k : 0));
      x.strokeStyle = '#23262c'; x.lineWidth = 0.9 * d; x.beginPath();
      if (horiz) { const cy = ry + rh / 2; x.moveTo(rx, cy - 0.09 * k); x.lineTo(rx + rw, cy - 0.09 * k); x.moveTo(rx, cy + 0.09 * k); x.lineTo(rx + rw, cy + 0.09 * k); }
      else { const cx = rx + rw / 2; x.moveTo(cx - 0.09 * k, ry); x.lineTo(cx - 0.09 * k, ry + rh); x.moveTo(cx + 0.09 * k, ry); x.lineTo(cx + 0.09 * k, ry + rh); }
      x.stroke();
    }
    // подписи комнат
    x.textAlign = 'center';
    for (const r of [...ROOMS, ...OUTDOOR]) {
      const cx = this.X((r.rect[0] + r.rect[2]) / 2), cz = this.Z(r.id === 'ivs' ? 7.6 : r.id === 'street' ? 28 : r.id === 'alley' ? 6 : (r.rect[1] + r.rect[3]) / 2);
      const fs = Math.max(7.5 * d, Math.min(0.62 * k, 12 * d));
      x.font = `bold ${fs}px "Courier New",monospace`; x.fillStyle = 'rgba(35,38,44,.62)';
      const words = r.name.toUpperCase().split(' ');
      const maxW = (r.rect[2] - r.rect[0]) * k * 0.92;
      let lines = [r.name.toUpperCase()];
      if (x.measureText(lines[0]).width > maxW && words.length > 1) lines = [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')];
      lines.forEach((ln, i) => x.fillText(ln, cx, cz + (i - (lines.length - 1) / 2) * fs * 1.1));
    }
    x.textAlign = 'left';
    // штамп чертежа
    const fs = Math.max(8 * d, 0.5 * k);
    x.font = `${fs}px "Courier New",monospace`; x.fillStyle = 'rgba(35,38,44,.55)';
    x.fillText('ОМ № 14 · план первого этажа · М 1:100', this.X(0), this.Z(-6.6));
    return c;
  }
  draw(dt = 0) {
    if (!this.resize()) return;
    this.t += dt;
    if (!this.bg) this.bg = this.renderBg();
    const x = this.ctx, k = this.k, d = this.dpr, s = this.s, st = s.state;
    x.clearRect(0, 0, this.W, this.H);
    x.drawImage(this.bg, 0, 0);
    // владельцы зон
    const zones = st.zones || {};
    for (const z of ALL_ZONES) {
      const zo = zones[z.id]; if (!zo || zo.owner === 'police') continue;
      const [rx, ry, rw, rh] = this.rect(z.rect);
      x.save(); x.beginPath(); x.rect(rx, ry, rw, rh); x.clip();
      const enemy = zo.owner === 'enemy';
      x.fillStyle = enemy ? 'rgba(190,30,20,.16)' : `rgba(110,50,150,${0.1 + 0.08 * Math.sin(this.t * 5)})`; x.fillRect(rx, ry, rw, rh);
      x.strokeStyle = enemy ? 'rgba(170,30,20,.45)' : 'rgba(110,50,150,.4)'; x.lineWidth = 1.5 * d;
      for (let i = -rh; i < rw; i += 6 * d) { x.beginPath(); x.moveTo(rx + i, ry); x.lineTo(rx + i + rh, ry + rh); x.stroke(); if (!enemy) { x.beginPath(); x.moveTo(rx + i + rh, ry); x.lineTo(rx + i, ry + rh); x.stroke(); } }
      x.restore();
    }
    // группы обороны: контуры зон
    const groups = st.defense?.groups || [];
    groups.forEach((g, i) => {
      const z = ALL_ZONES.find((q) => q.id === g.zoneId); if (!z) return;
      const [rx, ry, rw, rh] = this.rect(z.rect); const col = GCOL[i % GCOL.length], inset = (2 + i % 3 * 2.5) * d;
      x.strokeStyle = col; x.lineWidth = (s.selGroup === g.id ? 3.5 : 2) * d; x.setLineDash(s.selGroup === g.id ? [] : [5 * d, 3 * d]);
      x.strokeRect(rx + inset, ry + inset, rw - inset * 2, rh - inset * 2); x.setLineDash([]);
      const fs = Math.max(8 * d, 0.5 * k); x.font = `bold ${fs}px "Courier New",monospace`;
      const lbl = g.name || `Группа ${i + 1}`; const tw = x.measureText(lbl).width;
      x.fillStyle = col; x.fillRect(rx + inset, ry + inset, tw + fs * 0.8, fs * 1.35);
      x.fillStyle = '#fff'; x.fillText(lbl, rx + inset + fs * 0.4, ry + inset + fs);
    });
    // выделение
    if (s.sel?.type === 'zone') { const z = ALL_ZONES.find((q) => q.id === s.sel.id); if (z) { const [rx, ry, rw, rh] = this.rect(z.rect); x.strokeStyle = '#a8261d'; x.lineWidth = 3 * d; x.strokeRect(rx + 1.5 * d, ry + 1.5 * d, rw - 3 * d, rh - 3 * d); } }
    // двери
    const barr = st.defense?.barricades || {};
    const wdoors = s.game?.world?.doors || [];
    for (const dr of DOORS) {
      const [rx, ry, rw, rh] = this.rect(dr.rect); const horiz = rw > rh;
      x.fillStyle = '#efeadb';
      if (horiz) x.fillRect(rx, ry + rh * 0.15, rw, rh * 0.7); else x.fillRect(rx + rw * 0.15, ry, rw * 0.7, rh);
      x.strokeStyle = dr.kind === 'steel' || dr.kind === 'front' ? '#23262c' : '#5a5040'; x.lineWidth = (dr.kind === 'steel' ? 1.8 : 1.1) * d;
      if (dr.kind !== 'arch') {
        const L = horiz ? rw : rh;
        x.beginPath();
        if (horiz) { const y0 = ry + rh / 2; x.moveTo(rx, y0); x.lineTo(rx, y0 - L * 0.9); x.moveTo(rx, y0 - L * 0.9); x.arc(rx, y0, L * 0.9, -Math.PI / 2, 0); }
        else { const x0 = rx + rw / 2; x.moveTo(x0, ry); x.lineTo(x0 + L * 0.9, ry); x.moveTo(x0 + L * 0.9, ry); x.arc(x0, ry, L * 0.9, 0, Math.PI / 2); }
        x.stroke();
      }
      const hp = barr[dr.id] ?? wdoors.find((w) => w.id === dr.id)?.barricade ?? 0;
      if (hp > 0) {
        const pad = 0.25 * k;
        x.fillStyle = 'rgba(140,90,30,.75)'; x.fillRect(rx - pad * (horiz ? 0 : 1), ry - pad * (horiz ? 1 : 0), rw + pad * (horiz ? 0 : 2), rh + pad * (horiz ? 2 : 0));
        x.strokeStyle = '#3d2508'; x.lineWidth = 1.2 * d;
        x.beginPath(); x.moveTo(rx, ry); x.lineTo(rx + rw, ry + rh); x.moveTo(rx + rw, ry); x.lineTo(rx, ry + rh); x.stroke();
      }
      if (s.sel?.type === 'door' && s.sel.id === dr.id) { x.strokeStyle = '#a8261d'; x.lineWidth = 2.5 * d; x.beginPath(); x.arc(rx + rw / 2, ry + rh / 2, Math.max(rw, rh) * 0.8 + 4 * d, 0, 7); x.stroke(); }
    }
    // посты
    const taken = (id) => !!s.game?.world?.pointTaken?.(id);
    let n = 0;
    for (const [id, p] of Object.entries(POINTS)) {
      if (p.kind !== 'post') continue; n++;
      const px = this.X(p.x), pz = this.Z(p.z), r = Math.max(4 * d, 0.32 * k);
      x.save(); x.translate(px, pz); x.rotate(-p.yaw + Math.PI);
      x.beginPath(); x.moveTo(0, -r); x.lineTo(r * 0.8, r * 0.7); x.lineTo(-r * 0.8, r * 0.7); x.closePath();
      x.fillStyle = taken(id) ? '#2d4f8e' : 'rgba(239,234,219,.9)'; x.fill(); x.strokeStyle = '#2d4f8e'; x.lineWidth = 1.2 * d; x.stroke(); x.restore();
    }
    // люди
    const w = s.game?.world;
    const attack = !!st.attack;
    const seeEnemy = s.camerasOn();
    if (w?.actors) {
      const fs = Math.max(7 * d, 0.42 * k);
      for (const a of w.actors) {
        if (!a.alive && a.team !== 'police') continue;
        const px = this.X(a.x), pz = this.Z(a.z);
        let col = null, r = Math.max(3 * d, 0.24 * k), label = null;
        if (a.team === 'player') { col = '#a8261d'; r *= 1.3; label = 'Вы'; }
        else if (a.team === 'police') { col = a.alive ? '#2d4f8e' : '#777'; const o = s.game.officer?.(a.officerId) || (st.staff || []).find((q) => q.id === a.officerId); label = o ? o.lastName.slice(0, 3) : null; }
        else if (a.team === 'bandit') { if (!seeEnemy) continue; col = '#c0281c'; }
        else if (a.team === 'prisoner') col = '#b07d22';
        else col = 'rgba(80,80,80,.7)';
        if (a.team === 'bandit') { const pl = 0.5 + 0.5 * Math.sin(this.t * 8 + a.x); x.strokeStyle = `rgba(192,40,28,${0.6 * pl})`; x.lineWidth = 1.5 * d; x.beginPath(); x.arc(px, pz, r * 2, 0, 7); x.stroke(); }
        x.fillStyle = col; x.beginPath(); x.arc(px, pz, r, 0, 7); x.fill();
        if (a.team === 'player' || a.team === 'police') { x.strokeStyle = col; x.lineWidth = 1.4 * d; x.beginPath(); x.moveTo(px, pz); x.lineTo(px + Math.sin(a.yaw || 0) * r * 2.2, pz + Math.cos(a.yaw || 0) * r * 2.2); x.stroke(); }
        if (!a.alive) { x.strokeStyle = '#fff'; x.lineWidth = d; x.beginPath(); x.moveTo(px - r * 0.6, pz - r * 0.6); x.lineTo(px + r * 0.6, pz + r * 0.6); x.stroke(); }
        if (label && k > 9 * d) { x.font = `${fs}px "Courier New",monospace`; x.fillStyle = col; x.fillText(label, px + r * 1.4, pz - r * 0.6); }
      }
    }
    // без камер — отметки «бой» в зонах
    if (attack && !seeEnemy) {
      for (const z of ALL_ZONES) {
        const zo = zones[z.id]; if (!zo || zo.owner === 'police') continue;
        const cx = this.X((z.rect[0] + z.rect[2]) / 2), cz = this.Z((z.rect[1] + z.rect[3]) / 2) + 0.9 * k;
        x.font = `bold ${Math.max(10 * d, 0.9 * k)}px "Courier New",monospace`; x.textAlign = 'center';
        x.fillStyle = zo.owner === 'enemy' ? '#a8261d' : '#6a3e86'; x.fillText(zo.owner === 'enemy' ? '? ПРОТИВНИК' : '? БОЙ', cx, cz); x.textAlign = 'left';
      }
    }
  }
}

export class StationPlanScreen extends Screen {
  static pause = true;
  constructor(ui, params) {
    super(ui, params);
    this.tab = params.tab || 'defense';
    this.sel = null; this.selGroup = null; this.edit = null; this.detailOpen = false;
  }
  wantsPause() { return !this.state.attack; }
  get combat() { return this.game?.combat; }
  camerasOn() {
    const up = this.state.economy?.upgrades || {};
    const cams = Object.keys(up).some((k) => up[k] && /camera|cctv|video|камер/i.test(k));
    return cams && this.ui.power !== false;
  }
  back() { if (this.edit) { this.edit = null; this.refresh(); return true; } return false; }
  officers() { return (this.state.staff || []).filter((o) => o.status === 'station'); }
  groupOf(id) { return (this.state.defense?.groups || []).find((g) => g.leaderId === id || (g.memberIds || []).includes(id)); }
  onPlanTap(hit) {
    if (!hit) return;
    sfx('ui_click');
    if (this.edit && hit.type === 'zone') { this.edit.zoneId = hit.id; this.refresh(); return; }
    this.sel = hit; this.tab = 'object'; this.refresh();
  }
  render() {
    const s = this.state, attack = s.attack;
    this.cv = h('canvas');
    const legend = h('div.plan-legend',
      h('span', h('i', { style: 'background:#2d4f8e;border-radius:50%' }), 'наши'),
      this.camerasOn() ? h('span', h('i', { style: 'background:#c0281c;border-radius:50%' }), 'противник (камеры)') : h('span', 'камер нет — противника не видно'),
      h('span', h('i', { style: 'background:rgba(190,30,20,.3)' }), 'занято врагом'),
      h('span', h('i', { style: 'background:rgba(140,90,30,.75)' }), 'баррикада'));
    const panel = this.edit ? this.editor() : this.tab === 'object' ? this.objectPanel() : this.tab === 'reports' ? this.reports() : this.defense();
    const speed = attack ? h('div.seg.small', { style: 'margin-left:auto' },
      ...[[0, 'Пауза'], [1, '×1']].map(([n, l]) => h('button.seg-opt' + (((this.game.paused ? 0 : this.game.speed ?? 1) === n) ? '.on' : ''), { type: 'button', 'data-act': 'speed-' + n, onclick: (e) => { e.stopPropagation(); sfx('ui_click'); this.ui._setSpeed(n); this.refresh(); } }, l))) : null;
    return this.frame({
      title: 'Схема участка', sub: attack ? 'ИДЁТ БОЙ' : `Режим: ${ALERT_LEVELS.find((a) => a.id === (s.defense?.alert || 'normal'))?.label.toLowerCase()}`, formNo: 'Лист 1 из 1',
      tabs: this.edit ? null : [{ id: 'defense', label: 'Оборона', count: (s.defense?.groups || []).length }, { id: 'object', label: 'Объект' }, { id: 'reports', label: 'Доклады', red: !!attack, count: attack ? '!' : 0 }],
      tab: this.tab, onTab: (t) => { this.tab = t; this.refresh(); }, head: speed,
      body: h('div.split', h('div.pane.l', h('div.plan-wrap', this.cv, legend)), h('div.pane.r', { style: 'flex:0 0 clamp(16em,42%,28em)' }, panel)),
    });
  }
  afterRender() { this.plan = new PlanView(this.cv, this); requestAnimationFrame(() => this.plan?.draw(0)); }
  tick(dt) {
    this._a = (this._a || 0) + dt; this._r = (this._r || 0) + dt;
    if (this.plan && this._a > (this.state.attack ? 0.06 : 0.25)) { this.plan.draw(this._a); this._a = 0; }
    if (this.state.attack && this._r > 1.2 && !this.edit && this.tab !== 'defense') { this._r = 0; this.refresh(); }
  }
  onEvent(ev) { if (['zone:changed', 'attack:start', 'attack:end', 'power'].includes(ev) && !this.edit) this._r = 99; }

  defense() {
    const s = this.state, alert = s.defense?.alert || 'normal', groups = s.defense?.groups || [];
    const plans = (s.attackPlans || []).filter((p) => p.warned);
    const barr = s.defense?.barricades || {};
    const bars = DOORS.filter((d) => (barr[d.id] ?? this.game?.world?.doors?.find((w) => w.id === d.id)?.barricade ?? 0) > 0);
    const free = this.officers().filter((o) => !this.groupOf(o.id));
    return h('div.scroll.grow.pad', { 'data-scroll': 'def' },
      plans.length && !s.attack ? h('div.note.bad.mb', `Ожидается нападение: ${plans.map((p) => (s.city?.gangs || []).find((g) => g.id === p.gangId)?.name || 'неизвестные').join(', ')}. ${plans[0].entry === 'back' ? 'Говорят, пойдут через двор.' : plans[0].entry === 'both' ? 'Говорят, зайдут с двух сторон.' : plans[0].entry === 'front' ? 'Говорят, пойдут в лоб.' : ''}`) : null,
      h('div.sect', 'Режим'),
      seg(ALERT_LEVELS, alert, (v) => this.setAlert(v), { wrap: true, small: true, act: 'alert' }),
      h('div.small.dim', { style: 'margin-top:.25em' }, ALERT_LEVELS.find((a) => a.id === alert)?.desc),
      h('div.sect', `Группы обороны (${groups.length})`),
      groups.length ? groups.map((g, i) => {
        const lead = (s.staff || []).find((o) => o.id === g.leaderId);
        const doc = g.doctrine || {};
        const defs = doctrineDefs(this.game);
        const lbl = (key) => defs.find((d) => d.key === key)?.options?.find((o) => String(o.id) === String(doc[key]))?.label;
        return h('div.grp' + (this.selGroup === g.id ? '.sel' : ''), { 'data-group': g.id, onclick: () => { sfx('ui_click'); this.selGroup = g.id; this.startEdit(g); } },
          h('div.grp-h', h('span.grp-sw', { style: { background: GCOL[i % GCOL.length] } }), h('b.grow', g.name || `Группа ${i + 1}`), h('span.small', zoneName(g.zoneId))),
          h('div.small', `Командир: ${lead ? rankShort(lead.rank) + ' ' + lead.lastName : '—'} · бойцов: ${(g.memberIds || []).length}`),
          h('div.tiny.dim', [lbl('hold'), lbl('roe') && 'огонь: ' + lbl('roe').toLowerCase(), doc.protect && doc.protect !== 'none' && 'прикрывать: ' + (lbl('protect') || '').toLowerCase()].filter(Boolean).join(' · ')));
      }) : h('div.small.dim', 'Групп нет. При нападении каждый будет сам за себя.'),
      btn('Создать группу', () => this.startEdit(null), { cls: 'primary wide mt', act: 'new-group' }),
      h('div.small.dim', { style: 'margin-top:.3em' }, `Без группы на участке: ${free.length ? free.map((o) => o.lastName).join(', ') : 'никого'}.`),
      h('div.sect', 'Баррикады'),
      bars.length ? bars.map((d) => h('div.inv-row', { onclick: () => { this.sel = { type: 'door', id: d.id }; this.tab = 'object'; this.refresh(); } }, h('span', d.name), h('span.c', String(Math.round(barr[d.id] ?? 0))))) : h('div.small.dim', 'Не установлены. Нажмите на дверь на схеме.'));
  }
  setAlert(v) {
    if (!this.combat?.setAlert) { this.ui.toast('Управление обороной недоступно', 'warn'); return; }
    call(this.combat, 'setAlert', v);
    this.ui.toast(`Режим: ${ALERT_LEVELS.find((a) => a.id === v)?.label}`, v === 'normal' ? 'info' : 'warn');
    this.refresh();
  }
  objectPanel() {
    const sel = this.sel, s = this.state;
    if (!sel) return h('div.pad', h('div.empty', 'Нажмите на комнату или дверь на схеме.'));
    if (sel.type === 'door') {
      const d = DOORS.find((x) => x.id === sel.id);
      const hp = s.defense?.barricades?.[d.id] ?? this.game?.world?.doors?.find((w) => w.id === d.id)?.barricade ?? 0;
      return h('div.scroll.grow.pad', { 'data-scroll': 'obj' },
        h('div.dist-name', d.name),
        h('div.small', `${DOOR_KIND[d.kind] || d.kind}: ${zoneName(d.a)} ↔ ${zoneName(d.b)}`),
        h('div.sect', 'Баррикада'),
        hp > 0 ? h('div', `Стоит. Прочность: ${Math.round(hp)}.`) : h('div.small.dim', 'Нет. Баррикада задержит штурм, но и своим будет не пройти.'),
        d.kind === 'arch' ? h('div.small.dim.mt', 'Широкий проём — баррикада из скамеек и шкафов.') : null,
        h('div.btns.mt',
          hp > 0 ? btn('Разобрать', () => this.unbarricade(d), { cls: 'slim', act: 'unbarricade' }) : btn('Забаррикадировать', () => this.barricade(d), { cls: 'primary slim', act: 'barricade' })));
    }
    const z = ZONES.find((x) => x.id === sel.id);
    const zo = s.zones?.[sel.id];
    const groups = (s.defense?.groups || []).filter((g) => g.zoneId === sel.id);
    const actors = (this.game?.world?.actors || []).filter((a) => a.alive && (a.zone === sel.id || this.game.world.zoneAt?.(a.x, a.z) === sel.id));
    const ours = actors.filter((a) => a.team === 'police' || a.team === 'player');
    const enemies = this.camerasOn() ? actors.filter((a) => a.team === 'bandit') : [];
    const posts = Object.entries(POINTS).filter(([, p]) => p.kind === 'post' && p.zone === sel.id);
    const doors = DOORS.filter((d) => d.a === sel.id || d.b === sel.id);
    return h('div.scroll.grow.pad', { 'data-scroll': 'obj' },
      h('div.dist-name', z?.name || sel.id),
      h('div.small', `Контроль: ${OWNER_NAMES[zo?.owner || 'police']}${zo && zo.control != null ? ` (${Math.round(zo.control * 100)})` : ''}`),
      h('div.sect', 'Люди'),
      h('div.small', ours.length ? ours.map((a) => a.team === 'player' ? 'вы' : ((s.staff || []).find((o) => o.id === a.officerId)?.lastName || a.name || '?')).join(', ') : 'Своих нет.'),
      this.camerasOn() ? h('div.small' + (enemies.length ? '.t-bad' : ''), enemies.length ? `Противник: ${enemies.length}` : 'Противника нет (по камерам).') : null,
      h('div.sect', 'Группы'),
      groups.length ? groups.map((g) => h('div.small', `${g.name} — ${(g.memberIds || []).length + 1} чел.`)) : h('div.small.dim', 'Не назначены.'),
      btn('Группа на эту зону', () => this.startEdit(null, sel.id), { cls: 'slim mt', act: 'zone-group' }),
      posts.length ? [h('div.sect', 'Посты'), posts.map(([id]) => h('div.small', '△ ' + (POST_NAMES[id] || id)))] : null,
      doors.length ? [h('div.sect', 'Двери'), doors.map((d) => h('div.inv-row', { onclick: () => { this.sel = { type: 'door', id: d.id }; this.refresh(); } }, h('span', d.name), h('span.c', (s.defense?.barricades?.[d.id] ?? 0) > 0 ? 'баррикада' : '—')))] : null);
  }
  barricade(d) {
    if (!this.combat?.placeBarricade) { this.ui.toast('Недоступно', 'warn'); return; }
    const r = call(this.combat, 'placeBarricade', d.id);
    if (r && r.ok === false) this.ui.toast(r.reason || 'Не из чего', 'warn'); else this.ui.toast(`${d.name}: баррикада`, 'good');
    this.plan && (this.plan.bg = this.plan.bg); this.refresh();
  }
  unbarricade(d) {
    if (this.combat?.removeBarricade) call(this.combat, 'removeBarricade', d.id);
    else call(this.game?.world, 'removeBarricade', d.id); // CONTRACT-NEEDS: combat.removeBarricade(doorId)
    this.ui.toast(`${d.name}: баррикада разобрана`, 'info');
    this.refresh();
  }
  reports() {
    const s = this.state;
    const log = (s.log || []).filter((l) => ['combat', 'bad', 'attack', 'defense'].includes(l.kind)).slice(-30).reverse();
    const radio = (s.radio || []).filter((m) => m.from === 'duty' || m.kind === 'alarm').slice(-10).reverse();
    return h('div.scroll.grow.pad', { 'data-scroll': 'rep' },
      s.attack ? h('div.note.bad.mb', `Нападение${s.attack.startedAt ? ` с ${hhmm(s.attack.startedAt.minute ?? s.attack.startedAt)}` : ''}. ${this.camerasOn() ? 'Камеры работают.' : 'Камер нет — только доклады.'}`) : null,
      h('div.combat-log', [...log.map((l) => h('div', h('span.dim', `${hhmm(l.minute)} `), txt(l.text))), ...radio.map((m) => h('div', h('span.dim', `${hhmm(m.minute)} ${m.callsign || m.fromName || ''}: `), txt(m.text)))]),
      !log.length && !radio.length ? h('div.empty', 'Докладов нет.') : null);
  }
  startEdit(g, zoneId) {
    const defs = doctrineDefs(this.game);
    const doc = {}; for (const d of defs) doc[d.key] = d.def;
    const det = {}; for (const d of DOCTRINE_DETAILS) det[d.key] = d.def;
    if (g) this.edit = { id: g.id, name: g.name || '', leaderId: g.leaderId || null, memberIds: (g.memberIds || []).slice(), zoneId: g.zoneId || null, doctrine: { ...doc, ...(g.doctrine || {}) } };
    else {
      const n = (this.state.defense?.groups || []).length + 1;
      this.edit = { id: null, name: zoneId ? zoneName(zoneId).split(' ')[0] : `Группа ${n}`, leaderId: null, memberIds: [], zoneId: zoneId || null, doctrine: doc };
    }
    this.edit.doctrine.details = { ...det, ...(this.edit.doctrine.details || {}) };
    this.edit.doctrine.note = this.edit.doctrine.note || '';
    this.refresh();
  }
  editor() {
    const e = this.edit, s = this.state, offs = this.officers();
    const defs = doctrineDefs(this.game);
    const row = (d, obj) => {
      const desc = h('div.od', d.options?.find((o) => String(o.id) === String(obj[d.key]))?.desc || d.desc || '');
      let ctl;
      if (d.type === 'zone') ctl = seg([{ id: '', label: '—' }, ...ZONES.filter((z) => z.indoor).map((z) => ({ id: z.id, label: z.name.split(' ')[0] }))], obj[d.key] || '', (v) => { obj[d.key] = v || null; }, { small: true, wrap: true, act: 'opt-' + d.key });
      else if (d.type === 'bool') ctl = toggle(!!obj[d.key], (v) => { obj[d.key] = v; }, { act: 'opt-' + d.key });
      else if (!Array.isArray(d.options) || !d.options.length) return null;
      else ctl = seg(d.options, obj[d.key], (v, o) => { obj[d.key] = v; desc.textContent = (o && o.desc) || ''; }, { small: true, wrap: d.options.length > 3, act: 'opt-' + d.key });
      return h('div.opt-row', { style: 'grid-template-columns:1fr' }, h('div.ol', d.label), h('div', { style: 'grid-column:1' }, ctl), d.type === 'zone' ? null : h('div.od', { style: 'grid-column:1' }, desc.textContent));
    };
    const mem = (o) => {
      const other = this.groupOf(o.id); const inOther = other && other.id !== e.id;
      const on = e.memberIds.includes(o.id), lead = e.leaderId === o.id;
      return h('button.mem' + (on || lead ? '.on' : '') + (lead ? '.lead' : ''), {
        type: 'button', 'data-mem': o.id,
        onclick: (ev) => { ev.stopPropagation(); sfx('ui_click'); if (lead) return; if (on) e.memberIds = e.memberIds.filter((x) => x !== o.id); else e.memberIds.push(o.id); this.refresh(); },
      }, portraitImg(o, { scale: 0.5 }), h('span', `${o.lastName}`, inOther ? h('span.og', ` · ${other.name}`) : null, !o.onShift ? h('span.og', ' · вне смены') : null));
    };
    const nameIn = h('input.inp', { value: e.name, maxlength: 24, 'data-act': 'group-name' });
    nameIn.addEventListener('input', () => { e.name = nameIn.value; });
    nameIn.addEventListener('keydown', (ev) => ev.stopPropagation());
    const note = h('textarea.inp', { rows: 2, maxlength: 300, placeholder: 'Например: окна вестибюля держать под прицелом, в коридор не выходить.' });
    note.value = e.doctrine.note || ''; note.addEventListener('input', () => { e.doctrine.note = note.value; }); note.addEventListener('keydown', (ev) => ev.stopPropagation());
    const det = h('details.details', { open: this.detailOpen }, h('summary', { onclick: () => { this.detailOpen = !det.open; } }, 'Уточнить детально'),
      DOCTRINE_DETAILS.map((d) => row(d, e.doctrine.details)), h('div.ol.small', 'Примечание командиру'), note);
    const lead = offs.find((o) => o.id === e.leaderId);
    return h('div.col.grow', { style: 'min-height:0;gap:0' },
      h('div.scroll.grow.pad', { 'data-scroll': 'edit' },
        h('div.row', btn('‹', () => { this.edit = null; this.refresh(); }, { cls: 'slim', act: 'edit-back' }), h('b.grow', e.id ? 'Группа обороны' : 'Новая группа')),
        h('div.sect', 'Название'), nameIn,
        h('div.chips', { style: 'margin-top:.3em' }, ['Вестибюль', 'Тыл', 'Резерв', 'ИВС', 'Дежурка', 'Крыльцо'].map((n) => h('button.chip', { type: 'button', style: 'min-height:32px', onclick: (ev) => { ev.stopPropagation(); e.name = n; nameIn.value = n; } }, n))),
        h('div.sect', 'Зона'), h('div.small.dim', 'Нажмите на схеме или выберите:'),
        seg(ZONES.map((z) => ({ id: z.id, label: z.name.replace('Кабинет ', 'Каб. ').replace('комната', 'к.').replace(' (камеры)', '') })), e.zoneId || '', (v) => { e.zoneId = v; this.plan && this.plan.draw(0); }, { small: true, wrap: true, act: 'zone' }),
        h('div.sect', 'Командир группы'),
        h('div.small', lead ? `${rankShort(lead.rank)} ${lead.lastName}${(lead.traits || []).includes('leader') ? ' — прирождённый командир' : ''}` : 'Не назначен'),
        h('div.mem-chips', offs.map((o) => h('button.mem' + (e.leaderId === o.id ? '.on.lead' : ''), {
          type: 'button', 'data-lead': o.id, onclick: (ev) => { ev.stopPropagation(); sfx('ui_click'); e.leaderId = o.id; e.memberIds = e.memberIds.filter((x) => x !== o.id); this.refresh(); },
        }, portraitImg(o, { scale: 0.5 }), h('span', `${rankShort(o.rank)} ${o.lastName}`, h('span.og', ` · так. ${Math.round(o.skills?.tactics ?? 0)}`))))),
        h('div.sect', `Бойцы (${e.memberIds.length})`),
        h('div.mem-chips', offs.filter((o) => o.id !== e.leaderId).map(mem)),
        h('div.sect', 'Доктрина'),
        defs.map((d) => row(d, e.doctrine)),
        det),
      h('div.win-foot',
        e.id ? btn('Расформировать', () => this.removeGroup(), { cls: 'slim danger', act: 'group-remove' }) : null,
        h('div.sp'),
        btn(e.id ? 'Сохранить' : 'Создать', () => this.saveGroup(), { cls: 'primary', act: 'group-save' })));
  }
  saveGroup() {
    const e = this.edit;
    if (!e.zoneId) { this.ui.toast('Укажите зону', 'warn'); return; }
    if (!e.leaderId) { this.ui.toast('Назначьте командира группы', 'warn'); return; }
    if (!this.combat?.createGroup) { this.ui.toast('Управление обороной недоступно', 'warn'); return; }
    // снять бойцов из других групп
    for (const g of this.state.defense?.groups || []) {
      if (g.id === e.id) continue;
      const mine = new Set([e.leaderId, ...e.memberIds]);
      const left = (g.memberIds || []).filter((x) => !mine.has(x));
      const patch = {};
      if (left.length !== (g.memberIds || []).length) patch.memberIds = left;
      if (mine.has(g.leaderId)) { patch.leaderId = left[0] || null; if (left[0]) patch.memberIds = left.slice(1); }
      if (Object.keys(patch).length) call(this.combat, 'updateGroup', g.id, patch);
    }
    const spec = { name: (e.name || 'Группа').trim(), leaderId: e.leaderId, memberIds: e.memberIds.slice(), zoneId: e.zoneId, doctrine: { ...e.doctrine, details: { ...e.doctrine.details } } };
    const r = e.id ? call(this.combat, 'updateGroup', e.id, spec) : call(this.combat, 'createGroup', spec);
    if (r && r.ok === false) { this.ui.toast(r.reason || 'Не удалось', 'bad'); return; }
    this.ui.toast(`${spec.name}: ${e.id ? 'приказ изменён' : 'группа создана'} — ${zoneName(spec.zoneId)}`, 'good');
    this.selGroup = r?.id || e.id; this.edit = null; this.tab = 'defense';
    this.refresh();
  }
  async removeGroup() {
    if (!(await this.ui.confirm(`Расформировать группу «${this.edit.name}»?`, { danger: true, yes: 'Расформировать' }))) return;
    call(this.combat, 'removeGroup', this.edit.id);
    this.edit = null; this.refresh();
  }
}

export { pn, statusName };
