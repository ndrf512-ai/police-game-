// Экран «Дежурная часть»: журнал КУСП, обстановка (кто свободен, кто на выезде), сводка, распоряжения дежурному.
import { Screen } from './base.js';
import { h, btn, seg, toggle, bar, call, hhmm, sfx } from '../dom.js';
import { rankShort, DISTRICT_NAMES } from '../labels.js';

const ST_CHIP = { registered: '', assigned: '', in_progress: '.warn', closed: '.good', refused: '.red' };
const TASK_NAMES = { patrol: 'патруль', guard: 'охрана', ambush: 'засада', raid: 'рейд', investigate: 'раскрытие', respond: 'выезд на вызов', escort: 'конвой', search: 'розыск' };
const PHASE = { departing: 'выезжает', enroute: 'в пути', active: 'на месте', returning: 'возвращается', done: 'вернулся' };

export class DutyScreen extends Screen {
  static pause = true; static sound = 'ui_paper';
  constructor(ui, params) { super(ui, params); this.tab = params.tab || 'journal'; this.filter = 'open'; }
  get M() { return this.sim.duty; }
  onEvent(ev) { if (ev === 'duty:registered' && this.tab === 'journal') this.refresh(); }
  render() {
    const M = this.M;
    if (!M) return this.frame({ title: 'Дежурная часть', cls: 'small', body: h('div.pad', h('div.empty', 'Модуль дежурной части не загружен.')) });
    const st = call(M, 'stats', this.game) || { today: {} };
    const body = this.tab === 'situation' ? this.situation() : this.tab === 'summary' ? this.summary(st) : this.tab === 'orders' ? this.orders() : this.journal();
    return this.frame({
      title: 'Дежурная часть', formNo: 'КУСП', cls: 'wide',
      tabs: [{ id: 'journal', label: 'Журнал', count: st.open || 0 }, { id: 'situation', label: 'Обстановка' }, { id: 'summary', label: 'Сводка' }, { id: 'orders', label: 'Распоряжения' }], tab: this.tab,
      onTab: (id) => { this.tab = id; this.refresh(); },
      body,
    });
  }
  officerLine() {
    const r = call(this.M, 'dutyOfficer', this.game) || {}; const o = r.o; const q = Math.round(100 * (r.form || 0));
    return h('div.row', { style: 'gap:.6em;align-items:center;margin-bottom:.4em' },
      h('div.col.grow', { style: 'gap:.1em;min-width:0' }, h('b', o ? `Дежурный — ${rankShort(o.rank)} ${o.lastName}` : 'За пультом никого'), h('div.small.dim', q >= 60 ? 'Регистрирует сразу, ничего не теряет.' : q >= 40 ? 'Бывает, записывает с опозданием.' : 'Записи запаздывают, часть теряется — люди жалуются.')),
      h('div', { style: 'min-width:8em' }, bar(q, q < 45 ? 'bad' : 'good', 'Работа с журналом', { thin: true })));
  }
  journal() {
    const all = (call(this.M, 'journal', this.game) || []).slice().reverse();
    const list = all.filter((e) => this.filter === 'all' || (this.filter === 'open' ? !['closed', 'refused'].includes(e.status) : ['closed', 'refused'].includes(e.status))).slice(0, 60);
    const S = this.M.STATUS_NAMES || {}; const SRC = this.M.SRC || {}; const DS = this.M.DEPT_SHORT || {};
    return h('div.scroll.grow.pad', { 'data-scroll': 'kusp' }, this.officerLine(),
      seg([{ id: 'open', label: 'В работе' }, { id: 'done', label: 'Закрытые' }, { id: 'all', label: 'Все' }], this.filter, (v) => { this.filter = v; this.refresh(); }, { small: true, act: 'kusp-filter' }),
      h('div.col', { style: 'gap:.25em;margin-top:.4em' }, list.length ? list.map((e) => h('div.li', { 'data-kusp': e.no },
        h('div.li-main', h('div.li-t', `№${e.no} · ${e.text}`), h('div.li-s', `Д${e.day} ${hhmm(e.minute)} · ${SRC[e.source] || e.source}${e.districtId ? ' · ' + (DISTRICT_NAMES[e.districtId] || e.districtId) : ''} · ${DS[e.deptId] || e.deptId || '—'}${e.deptId2 ? ' + ' + (DS[e.deptId2] || e.deptId2) : ''}${e.late ? ' · с опозданием' : ''}${e.note ? ' · ' + e.note : ''}`)),
        h('div.li-side', h('span.chip' + (ST_CHIP[e.status] || ''), S[e.status] || e.status)))) : h('div.empty', 'Записей нет.')));
  }
  situation() {
    const ov = call(this.M, 'overview', this.game) || { byDept: [], crews: [], vehicles: [] };
    return h('div.scroll.grow.pad', { 'data-scroll': 'sit' }, this.officerLine(),
      h('div.sect', 'Люди по отделам'),
      h('div.col', { style: 'gap:.15em' }, ov.byDept.map((d) => h('div.small', { style: 'display:flex;gap:.5em' }, h('b', { style: 'min-width:9em' }, d.short), h('span', `на месте ${d.here} · свободны ${d.free} · на выезде ${d.out} · всего ${d.total}`)))),
      h('div.sect', 'Наряды в городе'),
      ov.crews.length ? h('div.col', { style: 'gap:.25em' }, ov.crews.map((c) => h('div.li', { 'data-crew': c.id },
        h('div.li-main', h('div.li-t', `${c.callsign} — ${TASK_NAMES[c.type] || c.type}, ${DISTRICT_NAMES[c.districtId] || c.districtId || '—'} (${c.n} чел.)`),
          h('div.li-s', `${PHASE[c.phase] || c.phase}${c.last ? ` · последний доклад ${hhmm(c.last.minute)}: ${String(c.last.text).slice(0, 90)}` : ' · докладов нет'}`)),
        c.phase === 'active' && c.ago != null && c.ago > 90 ? h('div.li-side', h('span.chip.red', 'молчит')) : null))) : h('div.small.dim', 'Все на участке.'),
      h('div.sect', 'Машины'),
      h('div.small', (ov.vehicles || []).map((v) => `${v.name}: ${v.status === 'station' ? 'у входа' : v.status === 'task' ? 'на выезде' : v.status === 'repair' ? 'в ремонте' : v.status}`).join(' · ') || '—'),
      ov.lastReport ? [h('div.sect', 'Последний доклад в эфире'), h('div.small', `${ov.lastReport.callsign}, ${hhmm(ov.lastReport.minute)}: ${ov.lastReport.text}`)] : null,
      h('div.btns.mt', btn('Рация', () => this.ui.open('radio'), { cls: 'slim', act: 'open-radio' }), btn('Карта города', () => this.ui.open('citymap'), { cls: 'slim', act: 'open-map' })));
  }
  summary(st) {
    const t = st.today || {}; const y = (this.state.duty && this.state.duty.yesterday) || null;
    const cs = call(this.sim.departments?.cases, 'stats', this.game) || null;
    const line = (x) => `зарегистрировано ${x.registered || 0} · с опозданием ${x.late || 0} · потеряно ${x.lost || 0} · закрыто ${x.closed || 0} · отказано ${x.refused || 0}`;
    return h('div.scroll.grow.pad', this.officerLine(),
      h('div.sect', 'За текущие сутки'), h('div.small', line(t)),
      y ? [h('div.sect', 'За прошлые сутки'), h('div.small', line(y))] : null,
      h('div.sect', 'Всего'), h('div.small', `${line(st)} · сейчас в работе ${st.open || 0}${st.pending ? ` · ждут записи ${st.pending}` : ''}`),
      cs ? [h('div.sect', 'Следствие'), h('div.small', `дел в производстве ${cs.open} · готово ${cs.ready} · просрочено ${cs.overdue} · в прокуратуре принято ${cs.closed}, возвращено ${cs.returned}`)] : null,
      (t.lost || 0) > 0 ? h('div.note.warn.mt', 'Потерянные заявления всплывают жалобами: доверие районов падает, прокуратура пишет представления.') : null,
      h('div.btns.mt', btn('Открыть сводку (развод)', () => this.ui.open('briefing'), { cls: 'primary', act: 'open-briefing' })));
  }
  orders() {
    const M = this.M; const o = call(M, 'orders', this.game) || {}; const now = absNow(this.state.time);
    const hold = o.holdUntil && now < o.holdUntil; const dnd = o.dndUntil && now < o.dndUntil;
    const msg = (r) => { if (r) this.ui.toast(r.text || r.reason || 'Принято', r.ok === false ? 'warn' : 'good'); sfx('ui_stamp'); this.refresh(); };
    const toMorning = (() => { const m = this.state.time.minute; return ((8 * 60 - m) + 1440) % 1440 || 1440; })();
    return h('div.scroll.grow.pad', this.officerLine(),
      h('div.opt-row', { style: 'grid-template-columns:1fr auto' }, h('div.ol', 'Усилить дежурную часть'),
        h('div', toggle(!!o.reinforce, (v) => msg(call(M, 'setReinforce', this.game, v)), { act: 'ord-reinforce' })),
        h('div.od', { style: 'grid-column:1/3' }, 'Второй человек за пультом: записи не теряются, вызовы решаются быстрее (директива дежурной части — «усиленно»). Дежурные устают быстрее.')),
      h('div.opt-row', { style: 'grid-template-columns:1fr auto' }, h('div.ol', hold ? `Все на участке — до ${hhmm(o.holdUntil % 1440)}` : 'Всех на участок'),
        h('div', hold ? btn('Отменить', () => msg(call(M, 'allIn', this.game, 0)), { cls: 'slim', act: 'ord-allin-off' }) : btn('Отозвать', () => msg(call(M, 'allIn', this.game, 120)), { cls: 'slim danger', act: 'ord-allin' })),
        h('div.od', { style: 'grid-column:1/3' }, 'Патрули, засады, розыск и опера отзываются на участок; два часа отделы сами никого не высылают. Для угрозы нападения.')),
      h('div.opt-row', { style: 'grid-template-columns:1fr' }, h('div.ol', dnd ? `Не беспокоить — до ${hhmm(o.dndUntil % 1440)}` : 'Не беспокоить до…'),
        h('div', seg([{ id: 0, label: 'беспокоить' }, { id: 60, label: '1 час' }, { id: 180, label: '3 часа' }, { id: toMorning, label: 'до 08:00' }], dnd ? 'x' : 0, (v) => msg(call(M, 'doNotDisturb', this.game, Number(v))), { small: true, wrap: true, act: 'ord-dnd' })),
        h('div.od', 'Дежурный сам решает вызовы по рации (самостоятельность дежурной части включается) и не докладывает вам при входе в дежурку.')));
  }
}
function absMin(t) { return t ? ((t.day || 1) - 1) * 1440 + (t.minute || 0) : 0; }
function absNow(t) { return absMin(t); }
