// Утренний развод: машинописная сводка на 08:00.
import { Screen } from './base.js';
import { h, btn, stamp, txt, dateStr, weekday, hhmm, call, pn } from '../dom.js';
import { headerLine, DISTRICT_NAMES, statusName } from '../labels.js';

export class BriefingScreen extends Screen {
  static pause = true; static sound = 'typewriter';
  constructor(ui, params) {
    super(ui, params);
    this.data = call(this.sim.city, 'briefing', this.game) || {};
    ui._shownBriefingDay = this.state.time?.day ?? null;
  }
  render() {
    const s = this.state, d = this.data, t = s.time || { day: 1, minute: 480 };
    const dist = (id) => (s.city?.districts || []).find((x) => x.id === id)?.name || DISTRICT_NAMES[id] || id;
    const staff = (s.staff || []).filter((o) => !['dead', 'fired'].includes(o.status));
    const onShift = staff.filter((o) => o.onShift && (o.status === 'station' || o.status === 'task'));
    const hosp = staff.filter((o) => o.status === 'hospital'), leave = staff.filter((o) => o.status === 'leave');
    const veh = s.economy?.vehicles || [];
    const det = (s.detainees || []).filter((x) => x.status === 'cell');
    const plans = (s.attackPlans || []).filter((p) => p.warned);
    let n = 0;
    const L = (content, cls = '') => h('div.bline' + cls, { style: { animation: `fadeIn .3s ${Math.min(2.2, (n++) * 0.05)}s backwards` } }, content);
    const sec = (title) => L(h('div.sect', title));
    const items = (arr, fn) => arr.map((x, i) => L(h('div', { style: 'display:flex;gap:.6em' }, h('span.dim', `${i + 1}.`), h('span', fn ? fn(x) : txt(x)))));

    const body = h('div.scroll.grow', { 'data-scroll': 'brief' }, h('div.sheet.typed',
      L(h('div.form-h', headerLine(this.game))),
      L(h('div.form-title', 'Сводка')),
      L(h('div.center.small', `о происшествиях и оперативной обстановке на ${hhmm(480)} ${d.date || dateStr(t.day)} (${weekday(t.day)}, сутки ${t.day})`)),
      sec('1. Обстановка за сутки'),
      (d.lines && d.lines.length) ? items(d.lines) : L(h('div.dim', 'Происшествий, требующих внимания, не зарегистрировано.')),
      d.hotspots?.length ? [sec('2. Очаги'), items(d.hotspots, (x) => [h('b', dist(x.districtId)), ' — ', txt(x.why)])] : null,
      d.intel?.length ? [sec('3. Оперативные данные'), items(d.intel, (x) => txt(x))] : null,
      plans.length ? L(h('div.note.bad.mt', `Внимание! По данным осведомителей готовится нападение на отделение (${plans.map((p) => (s.city?.gangs || []).find((g) => g.id === p.gangId)?.name || 'неизвестные').join(', ')}). Проверьте группы обороны на схеме участка.`)) : null,
      sec('4. Личный состав и техника'),
      L(h('div', `На смене: ${onShift.length} из ${staff.length}. В больнице: ${hosp.length}${hosp.length ? ' (' + hosp.map((o) => o.lastName).join(', ') + ')' : ''}. В отпуске: ${leave.length}.`)),
      veh.length ? L(h('div', 'Транспорт: ' + veh.map((v) => `${v.name || v.id} — ${v.status === 'station' ? 'на ходу' : v.status === 'repair' ? 'в ремонте' : v.status === 'task' ? 'на выезде' : 'списан'} (${Math.round(v.condition ?? 0)}%)`).join('; ') + `. Бензин: ${Math.round(s.economy?.fuel ?? 0)} л.`)) : null,
      L(h('div', `ИВС: ${pn(det.length, ['задержанный', 'задержанных', 'задержанных'])}, свободно мест: ${Math.max(0, 9 - det.length)}.`)),
      d.news?.length ? [sec('5. Пресса и ТВ'), items(d.news.slice(0, 5), (x) => [h('b', txt(x.title ?? x)), x.text ? h('span.dim', ' — ' + String(x.text).slice(0, 140) + (String(x.text).length > 140 ? '…' : '')) : null])] : null,
      L(h('div.mt.small', { style: 'text-align:right' }, `Оперативный дежурный ${this.dutyName()}`)),
      stamp('ДСП', { rot: -12, style: { top: '1.2em', right: '1.4em' } }),
    ));
    return this.frame({
      title: 'Утренний развод', sub: `${hhmm(t.minute)} · ${dateStr(t.day)}`, cls: 'mid', formNo: 'Форма № 1-С', body,
      foot: [btn('Личный состав', () => this.ui.open('personnel'), { act: 'personnel' }), btn('Карта города', () => this.ui.open('citymap'), { act: 'citymap' }), h('div.sp'), btn('Разойтись', () => this.close(), { cls: 'primary', act: 'close' })],
    });
  }
  dutyName() {
    const o = (this.state.staff || []).find((x) => x.role === 'duty' && x.onShift && x.status === 'station');
    if (!o) return '—';
    return call(this.sim.staff, 'displayName', o) || `${o.rank || ''} ${o.lastName}`;
  }
}

export { statusName };
