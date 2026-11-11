// Оружейная: склад и выдача/изъятие снаряжения по сотрудникам (game.sim.economy.issue / unissue).
import { Screen } from './base.js';
import { h, btn, call, pn } from '../dom.js';
import { portraitImg } from '../portrait.js';
import { itemsList, WEAPON_FULL, WEAPON_NAMES, WEAPON_AMMO, ARMOR_NAMES, AMMO_NAMES, ITEM_KIND_NAMES, rankShort, statusName } from '../labels.js';

const SLOTS = [
  { id: 'weapon', label: 'Оружие', kinds: ['weapon'] },
  { id: 'ammo', label: 'Патроны', kinds: ['ammo'] },
  { id: 'armor', label: 'Бронежилет', kinds: ['armor'] },
  { id: 'helmet', label: 'Шлем', kinds: ['helmet'] },
  { id: 'radio', label: 'Рация', kinds: ['radio'] },
];

export class ArmoryScreen extends Screen {
  static pause = true;
  constructor(ui, params) { super(ui, params); this.sel = params.officerId || null; }
  get eco() { return this.state.economy || {}; }
  officers() {
    const st = this.state.staff || [];
    return st.filter((o) => !['dead', 'fired'].includes(o.status)).sort((a, b) => (b.onShift && b.status === 'station') - (a.onShift && a.status === 'station') || a.lastName.localeCompare(b.lastName, 'ru'));
  }
  captured() { return this.state.zones?.armory?.owner === 'enemy'; }
  stock() {
    const inv = this.eco.inventory || {}, items = itemsList(this.game);
    return Object.entries(inv).filter(([, n]) => n > 0).map(([id, n]) => ({ ...(items.find((i) => i.id === id) || { id, name: WEAPON_FULL[id] || ARMOR_NAMES[id] || id, kind: WEAPON_FULL[id] ? 'weapon' : ARMOR_NAMES[id] ? 'armor' : 'other' }), count: n }));
  }
  ammoItemFor(weapon) {
    const cal = WEAPON_AMMO[weapon]; if (!cal) return null;
    const it = itemsList(this.game).find((i) => i.kind === 'ammo' && (i.ammoType === cal || i.caliber === cal));
    return it ? it.id : 'ammo_' + cal;
  }
  issue(o, itemId, quiet) {
    if (this.captured()) { this.ui.toast('Оружейная в руках противника', 'bad'); return false; }
    const r = call(this.sim.economy, 'issue', this.game, o.id, itemId);
    if (!r && !this.sim.economy?.issue) { this.ui.toast('Выдача недоступна', 'warn'); return false; }
    if (r && r.ok === false) { if (!quiet) this.ui.toast(r.reason || 'Нельзя выдать', 'warn'); return false; }
    if (!quiet) { this.ui.toast(`${o.lastName}: получено — ${this.itemLabel(itemId)}`, 'good'); this.ui.sfx('reload'); }
    return true;
  }
  unissue(o, slot, quiet) {
    const r = call(this.sim.economy, 'unissue', this.game, o.id, slot);
    if (r && r.ok === false) { if (!quiet) this.ui.toast(r.reason || 'Нельзя', 'warn'); return false; }
    if (!quiet) this.ui.toast(`${o.lastName}: сдано — ${SLOTS.find((s) => s.id === slot)?.label.toLowerCase()}`, 'info');
    return true;
  }
  itemLabel(id) { return itemsList(this.game).find((i) => i.id === id)?.name || WEAPON_FULL[id] || ARMOR_NAMES[id] || id; }
  slotValue(o, slot) {
    const e = o.equipment || {};
    if (slot === 'weapon') return e.weapon && e.weapon !== 'none' ? WEAPON_FULL[e.weapon] || e.weapon : null;
    if (slot === 'ammo') return e.weapon && e.weapon !== 'none' ? pn(e.ammo ?? 0, ['патрон', 'патрона', 'патронов']) : null;
    if (slot === 'armor') return e.armor && e.armor !== 'none' ? ARMOR_NAMES[e.armor] : null;
    if (slot === 'helmet') return e.helmet ? 'шлем «Сфера»' : null;
    if (slot === 'radio') return e.radio ? 'рация' : null;
    return null;
  }
  render() {
    const offs = this.officers();
    if (!this.sel || !offs.find((o) => o.id === this.sel)) this.sel = (offs.find((o) => o.onShift && o.status === 'station') || offs[0])?.id || null;
    const o = offs.find((x) => x.id === this.sel);
    const stock = this.stock();
    const ammo = this.eco.ammo || {};
    const left = h('div.pane.l.narrowL', h('div.scroll.grow', { 'data-scroll': 'arm-off' }, h('div.list', offs.map((x) => {
      const e = x.equipment || {};
      const here = x.status === 'station';
      return h('div.li' + (x.id === this.sel ? '.sel' : '') + (here ? '' : '.off'), { 'data-officer': x.id, onclick: () => { this.sel = x.id; this.ui.sfx('ui_click'); this.refresh(); } },
        portraitImg(x, { scale: 0.75 }),
        h('div.li-main', h('div.li-t', `${rankShort(x.rank)} ${x.lastName}`),
          h('div.li-s', here ? `${WEAPON_NAMES[e.weapon] || '—'}${e.weapon && e.weapon !== 'none' ? ' ' + (e.ammo ?? 0) : ''} · ${e.armor && e.armor !== 'none' ? 'бронежилет' : 'без брони'}${e.radio ? ' · рация' : ''}` : statusName(x.status, x.gender))));
    }))));
    let right;
    if (!o) right = h('div.empty', 'Нет сотрудников.');
    else {
      const here = o.status === 'station';
      const slots = SLOTS.map((s) => {
        const v = this.slotValue(o, s.id);
        let opts = stock.filter((it) => s.kinds.includes(it.kind));
        if (s.id === 'ammo') {
          const id = this.ammoItemFor(o.equipment?.weapon);
          const cal = WEAPON_AMMO[o.equipment?.weapon];
          opts = id ? [{ id, name: `+ патроны ${AMMO_NAMES[cal] || cal}`, count: ammo[cal] ?? 0 }] : [];
        }
        return h('div.slot', { 'data-slot': s.id },
          h('span.sn', s.label), h('span.sv', v || h('span.dim', '—')),
          h('div.btns', { style: 'justify-content:flex-end' },
            ...opts.slice(0, 3).map((it) => btn(`${s.id === 'ammo' ? it.name : 'Выдать: ' + it.name.replace(/^(Пистолет|Автомат|Карабин) /, '')} (${it.count})`, () => { if (this.issue(o, it.id)) this.refresh(); }, { cls: 'slim', act: `issue-${s.id}-${it.id}`, disabled: !here || it.count <= 0 || this.captured() })),
            v && s.id !== 'ammo' ? btn('Сдать', () => { if (this.unissue(o, s.id)) this.refresh(); }, { cls: 'slim ghost', act: 'unissue-' + s.id, disabled: !here }) : null));
      });
      right = [
        h('div.row', h('b.grow', `${rankShort(o.rank)} ${o.lastName} ${o.firstName}`), here ? null : h('span.chip.st-dim', statusName(o.status, o.gender))),
        !here ? h('div.note.warn.mt', 'Сотрудника нет на участке — выдать и принять снаряжение нельзя.') : null,
        slots,
        h('div.sect', 'Склад'),
        h('div.skills', { style: 'gap:0 1.5em' },
          h('div', Object.entries(ITEM_KIND_NAMES).map(([k, nm]) => { const xs = stock.filter((i) => i.kind === k && k !== 'ammo'); return xs.length ? [h('div.tiny.dim.caps', { style: 'margin-top:.3em' }, nm), xs.map((i) => h('div.inv-row', h('span', i.name), h('span.c', String(i.count))))] : null; })),
          h('div', h('div.tiny.dim.caps', { style: 'margin-top:.3em' }, 'Патроны'), Object.entries(AMMO_NAMES).map(([cal, nm]) => h('div.inv-row', h('span', nm), h('span.c' + ((ammo[cal] ?? 0) < 30 ? '.t-bad' : ''), String(ammo[cal] ?? 0)))))),
      ];
    }
    return this.frame({
      title: 'Оружейная комната', sub: this.captured() ? 'ЗАХВАЧЕНА ПРОТИВНИКОМ' : 'Выдача и приём табельного', formNo: 'Книга выдачи № 3',
      body: h('div.split', left, h('div.pane.r.scroll.pad', { 'data-scroll': 'arm-r' }, this.captured() ? h('div.note.bad.mb', 'Оружейная захвачена — выдача невозможна, пока её не отобьют.') : null, right)),
      foot: [btn('Вооружить смену', () => this.bulkIssue(), { cls: 'slim', act: 'bulk-issue', disabled: this.captured() }), btn('Сдать у ушедших', () => this.bulkReturn(), { cls: 'slim', act: 'bulk-return' }), h('div.sp'), btn('Заказать', () => this.ui.open('supply'), { cls: 'slim', act: 'supply' })],
    });
  }
  bulkIssue() {
    const offs = (this.state.staff || []).filter((o) => o.status === 'station' && o.onShift && o.role !== 'secretary');
    let n = 0;
    for (const o of offs) {
      const e = o.equipment || {};
      const stock = () => this.stock();
      if (!e.weapon || e.weapon === 'none') { const w = stock().find((i) => i.kind === 'weapon' && i.id === 'pm') || stock().find((i) => i.kind === 'weapon'); if (w && this.issue(o, w.id, true)) n++; }
      if ((o.equipment?.weapon && o.equipment.weapon !== 'none') && (o.equipment.ammo ?? 0) < 8) { const a = this.ammoItemFor(o.equipment.weapon); if (a && this.issue(o, a, true)) n++; }
      if (!e.armor || e.armor === 'none') { const a = stock().find((i) => i.kind === 'armor'); if (a && this.issue(o, a.id, true)) n++; }
      if (!e.radio) { const r = stock().find((i) => i.kind === 'radio'); if (r && this.issue(o, r.id, true)) n++; }
    }
    this.ui.toast(n ? `Выдано единиц: ${n}` : 'Выдавать нечего или некому', n ? 'good' : 'info');
    if (n) this.ui.sfx('reload');
    this.refresh();
  }
  bulkReturn() {
    const offs = (this.state.staff || []).filter((o) => o.role !== 'secretary' && (['home', 'leave', 'hospital'].includes(o.status) || (o.status === 'station' && !o.onShift)));
    let n = 0;
    for (const o of offs) { const e = o.equipment || {}; for (const s of ['weapon', 'armor', 'helmet', 'radio']) if ((s === 'weapon' ? e.weapon && e.weapon !== 'none' : s === 'armor' ? e.armor && e.armor !== 'none' : e[s]) && this.unissue(o, s, true)) n++; }
    this.ui.toast(n ? `Принято на склад: ${n}` : 'Всё уже сдано', n ? 'good' : 'info');
    this.refresh();
  }
}
