// Личный состав (картотека) и кандидаты на службу.
import { Screen } from './base.js';
import { h, btn, seg, toggle, bar, call, pn } from '../dom.js';
import { portraitImg } from '../portrait.js';
import { ROLE_NAMES, ROLE_SHORT, SKILL_NAMES, statusName, STATUS_TONE, traitInfo, traitTone, rankShort, rankName } from '../labels.js';
import { rankIdx } from './taskwizard.js';

export function officerName(game, o) { return call(game?.sim?.staff, 'displayName', o) || `${rankShort(o.rank)} ${o.lastName}`; }

export class PersonnelScreen extends Screen {
  static pause = true;
  constructor(ui, params) { super(ui, params); this.filter = params.filter || 'all'; this.sort = params.sort || 'rank'; }
  list() {
    const all = this.state.staff || [];
    const f = {
      all: (o) => !['dead', 'fired'].includes(o.status),
      shift: (o) => o.onShift && (o.status === 'station' || o.status === 'task'),
      task: (o) => o.status === 'task',
      out: (o) => ['hospital', 'leave', 'missing', 'home'].includes(o.status) || (!o.onShift && o.status === 'station'),
      gone: (o) => ['dead', 'fired'].includes(o.status),
    }[this.filter] || (() => true);
    const sorter = {
      rank: (a, b) => rankIdx(b.rank) - rankIdx(a.rank) || a.lastName.localeCompare(b.lastName, 'ru'),
      fatigue: (a, b) => (b.fatigue ?? 0) - (a.fatigue ?? 0),
      morale: (a, b) => (a.morale ?? 0) - (b.morale ?? 0),
      name: (a, b) => a.lastName.localeCompare(b.lastName, 'ru'),
    }[this.sort];
    return all.filter(f).sort(sorter);
  }
  render() {
    const all = this.state.staff || [];
    const live = all.filter((o) => !['dead', 'fired'].includes(o.status));
    const onShift = live.filter((o) => o.onShift && (o.status === 'station' || o.status === 'task'));
    const avail = call(this.sim.staff, 'available', this.game) || live.filter((o) => o.status === 'station' && o.onShift);
    const list = this.list();
    const ids = list.map((o) => o.id);
    const rows = list.map((o) => {
      const canShift = o.status === 'station' || o.status === 'home';
      return h('div.li.pers-row', { 'data-officer': o.id, onclick: () => this.ui.open('officer', { id: o.id, list: ids }) },
        portraitImg(o, { scale: 1 }),
        h('div.li-main',
          h('div.li-t', `${rankShort(o.rank)} ${o.lastName} ${o.firstName} ${o.patronymic}`),
          h('div.li-s', `${ROLE_NAMES[o.role] || o.role || ''}, ${o.age ?? '?'} ${o.age ? pn(o.age, ['год', 'года', 'лет']).split(' ')[1] : ''}`),
          h('div.chips', { style: 'margin-top:.2em' },
            h('span.chip.st-' + (STATUS_TONE[o.status] || 'dim'), statusName(o.status, o.gender)),
            (o.traits || []).slice(0, 3).map((id) => h('span.chip.' + traitTone(id), traitInfo(this.game, id).name)),
            o.injuries?.length ? h('span.chip.bad', o.injuries.map((x) => x.name).join(', ')) : null)),
        h('div.bars3',
          h('span.tiny.dim', 'Усталость'), bar(o.fatigue, 'bad', null, { thin: true }),
          h('span.tiny.dim', 'Мораль'), bar(o.morale, 'good', null, { thin: true }),
          h('span.tiny.dim', 'Здоровье'), bar(o.hp, 'good', null, { thin: true })),
        h('div.shift-cell', 'смена',
          canShift ? toggle(!!o.onShift, (v) => { this.setShift(o, v); }, { on: 'вкл', off: 'выкл', act: 'shift-' + o.id }) : h('span.small', { style: 'min-height:44px;display:flex;align-items:center' }, o.status === 'task' ? 'на выезде' : '—')));
    });
    const cand = (this.state.candidates || []).length;
    return this.frame({
      title: 'Личный состав', sub: `В штате ${live.length} · на смене ${onShift.length} · свободно ${avail.length}`, formNo: 'Форма № 4-ЛС',
      tabs: [{ id: 'all', label: 'Все' }, { id: 'shift', label: 'На смене', count: onShift.length }, { id: 'task', label: 'На заданиях' }, { id: 'out', label: 'Вне строя' }, { id: 'gone', label: 'Выбыли' }],
      tab: this.filter, onTab: (t) => { this.filter = t; this.refresh(); },
      body: h('div.col.grow', { style: 'gap:0;min-height:0' },
        h('div.row.wrap', { style: 'padding:.35em .7em;border-bottom:1px solid rgba(36,33,28,.2)' }, btn('Отделы', () => this.ui.open('departments'), { cls: 'slim', act: 'departments' }), h('span.small.dim', 'Порядок:'),
          seg([{ id: 'rank', label: 'по званию' }, { id: 'name', label: 'по фамилии' }, { id: 'fatigue', label: 'усталые' }, { id: 'morale', label: 'недовольные' }], this.sort, (v) => { this.sort = v; this.refresh(); }, { small: true, act: 'sort' })),
        h('div.scroll.grow', { 'data-scroll': 'pers' }, rows.length ? h('div.list', rows) : h('div.empty', 'Никого.'))),
      foot: [btn('Оружейная', () => this.ui.open('armory'), { act: 'armory' }), btn(`Кандидаты (${cand})`, () => this.ui.open('hiring'), { act: 'hiring' }), h('div.sp'), h('span.small.dim', 'Нажмите на сотрудника — откроется личное дело')],
    });
  }
  setShift(o, on) {
    const r = call(this.sim.staff, 'setShift', this.game, o.id, on);
    if (r && r.ok === false) this.ui.toast(r.reason || 'Нельзя', 'warn');
    else this.ui.toast(`${o.lastName}: ${on ? (o.gender === 'f' ? 'заступила' : 'заступил') + ' на смену' : (o.gender === 'f' ? 'снята' : 'снят') + ' со смены'}`, 'info');
    this.refresh();
  }
}

export class HiringScreen extends Screen {
  static pause = true;
  render() {
    const c = this.state.candidates || [];
    const live = (this.state.staff || []).filter((o) => !['dead', 'fired'].includes(o.status)).length;
    const cards = c.map((o) => h('div.task-li', { 'data-cand': o.id, style: 'display:flex;gap:.8em;padding:.6em' },
      h('div.photo', { style: 'align-self:flex-start' }, portraitImg(o, { scale: 1.3 })),
      h('div.grow',
        h('div.row', h('b.grow', `${o.lastName} ${o.firstName} ${o.patronymic}`), h('span.small', `${o.age} ${pn(o.age, ['год', 'года', 'лет']).split(' ')[1]}`)),
        h('div.small', `${rankName(o.rank) || 'рядовой'} · ${ROLE_NAMES[o.role] || o.role || ''}`),
        h('div.skills.mt', Object.keys(SKILL_NAMES).map((k) => bar(o.skills?.[k], 'good', SKILL_NAMES[k], { thin: true }))),
        h('div.mt', (o.traits || []).map((id) => { const t = traitInfo(this.game, id); return h('div.trait', h('span.chip.' + traitTone(id), t.name), h('span.small', t.desc)); })),
        o.bio ? h('div.small.mt', { style: 'font-style:italic' }, o.bio) : null,
        h('div.btns.mt', btn('Принять на службу', () => this.hire(o), { cls: 'primary slim', act: 'hire-' + o.id })))));
    return this.frame({
      title: 'Кандидаты на службу', sub: `В штате ${live}. Каждый новый — лишний рот при задержках зарплаты.`, cls: 'mid', formNo: 'Форма № 5-К',
      body: h('div.scroll.grow.pad', { 'data-scroll': 'hire' }, c.length ? cards : h('div.empty', 'Кандидатов нет. Желающих служить за такие деньги мало.')),
    });
  }
  async hire(o) {
    if (!(await this.ui.confirm(`Принять на службу ${o.lastName} ${o.firstName[0]}. ${o.patronymic[0]}.?`))) return;
    const r = call(this.sim.staff, 'hire', this.game, o.id);
    if (r && r.ok === false) this.ui.toast(r.reason || 'Отказано', 'bad');
    else this.ui.toast(`${o.lastName} ${o.gender === 'f' ? 'принята' : 'принят'} на службу`, 'good');
    this.refresh();
  }
}
