// Экран «Отделы»: начальники отделов, директивы, самостоятельность, район внимания, доклады, статистика.
// Игрок командует начальниками, а не каждым сотрудником.
import { Screen } from './base.js';
import { h, btn, seg, toggle, bar, call, txt, sfx } from '../dom.js';
import { portraitImg } from '../portrait.js';
import { rankShort, ROLE_NAMES, DISTRICT_NAMES } from '../labels.js';

export class DepartmentsScreen extends Screen {
  static pause = true; static sound = 'ui_paper';
  constructor(ui, params) { super(ui, params); this.open = params.deptId || null; this.pick = null; }
  get D() { return this.sim.departments; }
  render() {
    const D = this.D;
    if (!D) return this.frame({ title: 'Отделы', cls: 'small', body: h('div.pad', h('div.empty', 'Модуль отделов не загружен.')) });
    const all = call(D, 'all', this.game) || [];
    const districts = (this.state.city?.districts || []).map((d) => ({ id: d.id, label: (d.name || DISTRICT_NAMES[d.id] || d.id).split(' ')[0] }));
    const cards = all.map(({ def, d, head, acting, members }) => {
      const openMe = this.open === def.id;
      const on = members.filter((o) => o.onShift && o.status === 'station'), out = members.filter((o) => o.status === 'task');
      const q = head ? call(D, 'headQualityText', head) : null;
      const form = head ? Math.round(100 * (call(D, 'headForm', head) || 0)) : 0;
      const headRow = h('div.row', { style: 'gap:.6em;align-items:center' },
        head ? h('div.photo.sm', portraitImg(head, { scale: 0.9, kind: 'officer' })) : h('div.photo.sm.empty'),
        h('div.col.grow', { style: 'gap:.1em;min-width:0' },
          h('b', head ? `${rankShort(head.rank)} ${head.lastName} ${head.firstName?.[0] || ''}.` : 'Начальник не назначен'),
          h('div.small.dim', head ? `${def.headTitle} · ${q}${acting.deputy ? ' · сейчас не на месте' + (acting.o ? `, и.о. ${acting.o.lastName}` : '') : ''}` : (acting.o ? `И.о. — ${rankShort(acting.o.rank)} ${acting.o.lastName}` : 'В отделе никого')),
          head ? bar(form, form < 40 ? 'bad' : 'good', 'В форме', { thin: true }) : null),
        h('div.small.dim', { style: 'text-align:right;white-space:nowrap' }, `${members.length} чел.`, h('br'), `на месте ${on.length}`, h('br'), `в городе ${out.length}`));
      const tabsBody = !openMe ? null : h('div.col', { style: 'gap:.5em;margin-top:.5em' },
        h('div.opt-row', { style: 'grid-template-columns:1fr' }, h('div.ol', 'Директива'),
          h('div', seg(D.DIRECTIVES.map((x) => ({ id: x.id, label: x.label })), d.directive, (v) => { call(D, 'setDirective', this.game, def.id, v); sfx('ui_stamp'); this.refresh(); }, { small: true, act: 'dir-' + def.id })),
          h('div.od', D.DIRECTIVES.find((x) => x.id === d.directive)?.desc || '')),
        def.id !== 'ivs' ? h('div.opt-row', { style: 'grid-template-columns:1fr auto' }, h('div.ol', def.id === 'duty' ? 'Дежурный сам решает по вызовам' : 'Начальник сам направляет людей'),
          h('div', toggle(!!d.autonomy, (v) => { call(D, 'setAutonomy', this.game, def.id, v); this.refresh(); }, { act: 'auto-' + def.id })),
          h('div.od', { style: 'grid-column:1/3' }, d.autonomy ? (def.id === 'duty' ? 'Вызовы по рации дежурный берёт на себя: шлёт наряд или перенаправляет. Качество — по дежурному.' : 'Отдел работает по директиве без ваших приказов. Вы только задаёте тон и спрашиваете доклад.') : 'Каждое решение — через вас. Начальник ждёт команды; ничего не делает сам.')) : null,
        ['ugro', 'pps', 'uchastok'].includes(def.id) && districts.length ? h('div.opt-row', { style: 'grid-template-columns:1fr' }, h('div.ol', 'Район особого внимания'),
          h('div', seg([{ id: '', label: 'нет' }, ...districts], d.focusDistrict || '', (v) => { call(D, 'setFocus', this.game, def.id, v || null); this.refresh(); }, { small: true, wrap: true, act: 'focus-' + def.id }))) : null,
        h('div.sect', 'За сутки / всего'),
        h('div.small', statsLine(d.today), h('br'), h('span.dim', statsLine(d.stats))),
        d.unsigned >= 2 ? h('div.note.warn', `${d.unsigned} бумаг отдела без резолюции — отдел ждёт решений (бумаги на столе в кабинете).`) : null,
        d.notes.length ? [h('div.sect', 'Журнал отдела'), d.notes.slice(-5).reverse().map((n) => h('div.small', h('span.dim', `Д${n.day} ${String(Math.floor(n.minute / 60)).padStart(2, '0')}:${String(n.minute % 60).padStart(2, '0')} `), n.text))] : null,
        this.pick === def.id ? this.pickList(def, d, members) : null,
        h('div.btns', { style: 'margin-top:.3em' },
          btn(this.pick === def.id ? 'Отмена' : 'Назначить начальника', () => { this.pick = this.pick === def.id ? null : def.id; this.refresh(); }, { cls: 'slim', act: 'pick-' + def.id, disabled: !members.length }),
          btn('Выслушать доклад', () => this.report(def), { cls: 'slim', act: 'report-' + def.id, disabled: !acting.o }),
          head ? btn('Личное дело', () => this.ui.open('officer', { id: head.id }), { cls: 'slim', act: 'file-' + def.id }) : null));
      return h('div.card' + (openMe ? '.sel' : ''), { 'data-dept': def.id, onclick: (e) => { if (openMe) return; e.stopPropagation(); sfx('ui_paper'); this.open = def.id; this.pick = null; this.refresh(); } },
        h('div.card-t', def.name, h('span.small.dim', { style: 'font-weight:400;margin-left:.5em' }, `директива: ${D.DIRECTIVES.find((x) => x.id === d.directive)?.label.toLowerCase() || ''}${d.autonomy ? '' : ' · по команде'}`)),
        headRow, tabsBody);
    });
    return this.frame({
      title: 'Отделы', sub: 'Начальники, директивы, доклады', formNo: 'Приказ № 1-ОС', cls: 'mid',
      body: h('div.scroll.grow.pad', { 'data-scroll': 'depts' },
        h('div.small.dim.mb', 'Вы командуете начальниками отделов, а они — людьми. Директива задаёт темп, самостоятельность — кто решает. Утром каждый отдел кладёт на стол доклад.'),
        h('div.col', { style: 'gap:.5em' }, cards)),
    });
  }
  pickList(def, d, members) {
    const D = this.D;
    const list = members.slice().sort((a, b) => (call(D, 'headScore', b) || 0) - (call(D, 'headScore', a) || 0));
    return h('div.col', { style: 'gap:.25em;margin:.3em 0' }, h('div.sect', 'Кого поставить'),
      list.map((o) => { const s = Math.round(100 * (call(D, 'headScore', o) || 0)); const cur = d.headId === o.id;
        return h('div.li' + (cur ? '.sel' : ''), { 'data-cand': o.id, onclick: (e) => { e.stopPropagation(); if (cur) return; const r = call(D, 'appointHead', this.game, def.id, o.id, 'player'); if (r && r.ok) { sfx('ui_stamp'); this.ui.toast(`${def.headTitle[0].toUpperCase() + def.headTitle.slice(1)} — ${rankShort(o.rank)} ${o.lastName}`, 'good'); this.pick = null; this.refresh(); } else this.ui.toast(r?.reason || 'Нельзя', 'bad'); } },
          h('div.photo.sm', portraitImg(o, { scale: 0.8, kind: 'officer' })),
          h('div.col.grow', { style: 'gap:.05em;min-width:0' }, h('b', `${rankShort(o.rank)} ${o.lastName} ${o.firstName?.[0] || ''}.`), h('div.small.dim', `${ROLE_NAMES[o.role] || o.role} · ${call(D, 'headQualityText', o)} · ${o.status === 'station' ? 'на месте' : o.status === 'task' ? 'в городе' : o.status === 'home' ? 'дома' : o.status}`),
            bar(s, s < 40 ? 'bad' : 'good', 'Как руководитель', { thin: true })),
          cur ? h('span.chip.good', 'назначен') : null); }));
  }
  report(def) {
    const D = this.D; const lines = call(D, 'reportLines', this.game, def.id) || [];
    const A = call(D, 'acting', this.game, def.id);
    this.ui.dialog({ title: `Доклад: ${def.name}`, text: lines.join('\n\n'), portrait: A && A.o ? A.o : null, portraitKind: 'officer', choices: [{ label: 'Понятно' }] });
    void txt;
  }
}
function statsLine(st) {
  const p = [];
  const add = (k, l) => { if (st && st[k]) p.push(`${l} ${st[k]}`); };
  add('tasks', 'нарядов'); add('solved', 'раскрыто'); add('detained', 'задержано'); add('prevented', 'предотвращено'); add('calls', 'вызовов'); add('missed', 'без наряда'); add('raids', 'рейдов'); add('searches', 'розысков');
  return p.length ? p.join(' · ') : '—';
}
