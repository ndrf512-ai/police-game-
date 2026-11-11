// Снабжение по телефону (каталог, улучшения, ожидаемые поставки) и сейф (касса).
import { Screen } from './base.js';
import { h, btn, call, money, pn, hhmm, txt, bar } from '../dom.js';
import { itemsList, upgradesList, ITEM_KIND_NAMES } from '../labels.js';

export class SupplyScreen extends Screen {
  static pause = true;
  constructor(ui, params) { super(ui, params); this.tab = params.tab || 'catalog'; this.qty = {}; }
  get eco() { return this.state.economy || {}; }
  render() {
    const e = this.eco, day = this.state.time?.day || 1;
    const items = itemsList(this.game), ups = upgradesList(this.game);
    const deliveries = (e.deliveries || []).slice().sort((a, b) => a.arriveDay - b.arriveDay);
    const weekly = call(this.sim.economy, 'weeklyBudget', this.game);
    const budget = typeof weekly === 'number' ? weekly : weekly?.amount ?? e.budgetPerWeek;
    const head = h('div.moneybox', { style: 'margin-left:auto;margin-right:.5em' }, h('span.small.dim', 'Касса:'), h('b', money(e.money ?? 0)));
    let body;
    if (this.tab === 'catalog') {
      const kinds = [...new Set(items.map((i) => i.kind))];
      body = [
        h('div.small.dim.mb', 'Звонок в ГУВД, отдел материально-технического снабжения. Что не дадут по разнарядке — найдёт ТОО «Спецснаб» за наличные.'),
        kinds.map((k) => [h('div.sect', ITEM_KIND_NAMES[k] || k), items.filter((i) => i.kind === k).map((it) => {
          const q = this.qty[it.id] || 1, cost = it.price * q;
          const inStock = it.kind === 'ammo' ? (e.ammo?.[it.ammoType] ?? null) : (e.inventory?.[it.id] ?? 0);
          const afford = (e.money ?? 0) >= cost;
          return h('div.cat-row', { 'data-item': it.id },
            h('div', h('div.nm', it.name), h('div.ds', `${it.desc || ''}${it.desc ? ' ' : ''}${inStock != null ? `На складе: ${inStock}.` : ''}${it.days != null ? ` Доставка: ${pn(it.days, ['день', 'дня', 'дней'])}.` : ''}`)),
            h('div.qty', h('button', { type: 'button', 'data-act': 'minus-' + it.id, onclick: (ev) => { ev.stopPropagation(); this.qty[it.id] = Math.max(1, q - 1); this.ui.sfx('ui_click'); this.refresh(); } }, '−'), h('span', String(q)), h('button', { type: 'button', 'data-act': 'plus-' + it.id, onclick: (ev) => { ev.stopPropagation(); this.qty[it.id] = Math.min(50, q + 1); this.ui.sfx('ui_click'); this.refresh(); } }, '+')),
            h('div', { style: 'display:flex;flex-direction:column;align-items:flex-end;gap:.2em' }, h('span.pr' + (afford ? '' : '.t-bad'), money(cost)), btn('Заказать', () => this.buy(it, q), { cls: 'slim', act: 'buy-' + it.id, disabled: !afford })));
        })]),
      ];
    } else if (this.tab === 'upgrades') {
      const owned = e.upgrades || {};
      body = [h('div.small.dim.mb', 'Работы по зданию. Деньги вперёд, рабочие — когда придут.'),
        ups.map((u) => {
          const has = !!owned[u.id];
          const pending = deliveries.some((d) => d.itemId === u.id || d.upgradeId === u.id);
          return h('div.cat-row', { 'data-upgrade': u.id },
            h('div', h('div.nm', u.name), h('div.ds', `${u.desc || ''}${u.days != null ? ` Срок: ${pn(u.days, ['день', 'дня', 'дней'])}.` : ''}`)),
            h('span'),
            h('div', { style: 'display:flex;flex-direction:column;align-items:flex-end;gap:.2em' }, has ? h('span.chip.good', 'установлено') : pending ? h('span.chip', 'в работе') : [h('span.pr', money(u.price)), btn('Заказать', () => this.buyUp(u), { cls: 'slim', act: 'up-' + u.id, disabled: (e.money ?? 0) < u.price })]));
        })];
    } else {
      const moneyLog = (this.state.log || []).filter((l) => l.kind === 'money').slice(-14).reverse();
      const veh = e.vehicles || [];
      body = [
        h('div.num-grid', h('div.num', h('b', money(e.money ?? 0)), h('span', 'в кассе')), budget != null ? h('div.num', h('b', money(budget)), h('span', 'бюджет в неделю')) : null,
          e.fuel != null ? h('div.num' + (e.fuel < 30 ? '.bad' : ''), h('b', `${Math.round(e.fuel)} л`), h('span', 'бензин')) : null),
        e.salaryDebt != null ? h('div.note.warn', `Задолженность по зарплате: ${money(e.salaryDebt)}. Люди ждут.`) : null,
        veh.length ? [h('div.sect', 'Автотранспорт'), veh.map((v) => h('div.inv-row', h('span.grow', v.name || v.id), h('span', { style: 'width:9em' }, bar(v.condition ?? 0, 'good', null, { thin: true })), h('span.small.dim', { style: 'min-width:6em;text-align:right' }, { station: 'на месте', task: 'на выезде', repair: 'в ремонте', destroyed: 'списан' }[v.status] || v.status)))] : null,
        h('div.sect', 'Движение денег'),
        moneyLog.length ? moneyLog.map((l) => h('div.logrow', h('span.tm', `Д${l.day} ${hhmm(l.minute)}`), h('span.tx', txt(l.text)))) : h('div.small.dim', 'Записей нет.'),
      ];
    }
    const delivBlock = deliveries.length ? h('div', { style: 'border-top:1px solid rgba(36,33,28,.25);padding:.35em .9em;max-height:30%;overflow:auto', class: 'scroll' },
      h('div.tiny.dim.caps', 'Ожидаются поставки'),
      deliveries.map((d) => { const left = d.arriveDay - day; const nm = items.find((i) => i.id === d.itemId)?.name || ups.find((u) => u.id === (d.itemId || d.upgradeId))?.name || d.itemId; return h('div.inv-row', h('span', `${nm}${d.qty > 1 ? ' × ' + d.qty : ''}`), h('span.c', { style: 'min-width:6em' }, left <= 0 ? 'сегодня' : left === 1 ? 'завтра' : `через ${pn(left, ['день', 'дня', 'дней'])}`)); })) : null;
    return this.frame({
      title: this.tab === 'cash' ? 'Сейф' : 'Снабжение', sub: this.tab === 'cash' ? 'Касса отделения' : 'Телефон: заказ', formNo: 'Заявка № 12-МТО', head,
      tabs: [{ id: 'catalog', label: 'Каталог' }, { id: 'upgrades', label: 'Здание' }, { id: 'cash', label: 'Касса' }], tab: this.tab, onTab: (t) => { this.tab = t; this.refresh(); },
      body: h('div.col.grow', { style: 'gap:0;min-height:0' }, h('div.scroll.grow.pad', { 'data-scroll': 'sup-' + this.tab }, body), delivBlock),
    });
  }
  buy(it, q) {
    const r = call(this.sim.economy, 'buy', this.game, it.id, q);
    if (!r && !this.sim.economy?.buy) { this.ui.toast('Заказ недоступен', 'warn'); return; }
    if (r && r.ok === false) { this.ui.toast(r.reason || 'Отказ', 'bad'); return; }
    this.ui.toast(`Заказано: ${it.name}${q > 1 ? ' × ' + q : ''}${it.days ? ` — привезут через ${pn(it.days, ['день', 'дня', 'дней'])}` : ''}`, 'money');
    this.ui.sfx('phone_pickup');
    this.qty[it.id] = 1;
    this.refresh();
  }
  buyUp(u) {
    const r = call(this.sim.economy, 'buyUpgrade', this.game, u.id);
    if (r && r.ok === false) { this.ui.toast(r.reason || 'Отказ', 'bad'); return; }
    this.ui.toast(`Заказано: ${u.name}`, 'money');
    this.refresh();
  }
}
