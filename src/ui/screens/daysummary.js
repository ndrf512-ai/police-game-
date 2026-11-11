// Итоги суток: справка о результатах работы.
import { Screen } from './base.js';
import { h, btn, stamp, txt, dateStr, call, money, signed, fmtNum } from '../dom.js';
import { headerLine, DISTRICT_NAMES } from '../labels.js';

const KEYS = {
  crimes: ['Преступлений', 'bad'], newCrimes: ['Новых преступлений', 'bad'], solved: ['Раскрыто', 'good'], unsolved: ['Не раскрыто', 'bad'],
  prevented: ['Предотвращено', 'good'], arrests: ['Задержано', 'good'], detained: ['Задержано', 'good'], released: ['Отпущено', ''],
  transferred: ['Передано в СИЗО', ''], wounded: ['Ранено сотрудников', 'bad'], killed: ['Погибло сотрудников', 'bad'], dead: ['Погибло сотрудников', 'bad'],
  civiliansKilled: ['Погибло граждан', 'bad'], banditsKilled: ['Убито преступников', ''], tasks: ['Нарядов', ''], calls: ['Вызовов', ''],
  visitors: ['Посетителей', ''], complaints: ['Жалоб', 'bad'], income: ['Поступления, тыс.', 'good'], expenses: ['Расходы, тыс.', 'bad'],
  money: ['Касса, тыс.', ''], moneyDelta: ['Деньги, тыс.', ''], trust: ['Доверие населения', ''], trustDelta: ['Доверие', ''], presence: ['Присутствие', ''],
  bribes: ['Взяток', 'bad'], intel: ['Оперданных', 'good'],
};
const SKIP = new Set(['day', 'date', 'lines', 'events', 'text', 'title', 'byDistrict', 'districts', 'news', 'notes', 'staff', 'gangs']);

export class DaySummaryScreen extends Screen {
  static pause = true; static sound = 'typewriter';
  constructor(ui, params) { super(ui, params); this.data = params.data || call(this.sim.city, 'daySummary', this.game) || {}; }
  render() {
    const s = this.state, d = this.data;
    const day = d.day ?? (s.time?.day ? s.time.day - (s.time.minute >= 480 ? 0 : 1) : 1);
    const nums = [];
    for (const k of Object.keys(d)) {
      if (SKIP.has(k)) continue;
      let v = d[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        // вложенные числовые блоки: {total, solved}
        for (const kk of Object.keys(v)) if (typeof v[kk] === 'number') nums.push([KEYS[k + '_' + kk]?.[0] || `${(KEYS[k]?.[0] || k)}: ${KEYS[kk]?.[0]?.toLowerCase() || kk}`, v[kk], KEYS[kk]?.[1] || '', /delta/i.test(kk)]);
        continue;
      }
      if (Array.isArray(v)) { if (v.length && typeof v[0] !== 'string') nums.push([KEYS[k]?.[0] || k, v.length, KEYS[k]?.[1] || '']); continue; }
      if (typeof v === 'number') nums.push([KEYS[k]?.[0] || k, v, KEYS[k]?.[1] || '', /delta/i.test(k)]);
    }
    const lines = [...(d.lines || []), ...(d.events || [])].map(txt).filter(Boolean);
    if (typeof d.text === 'string') lines.unshift(d.text);
    const byD = d.byDistrict || d.districts;
    const dist = (id) => (s.city?.districts || []).find((x) => x.id === id)?.name || DISTRICT_NAMES[id] || id;
    const distRows = byD ? (Array.isArray(byD) ? byD : Object.entries(byD).map(([id, v]) => ({ districtId: id, ...(typeof v === 'object' ? v : { crimes: v }) }))) : [];
    const staffHosp = (s.staff || []).filter((o) => o.status === 'hospital').length;
    const body = h('div.scroll.grow', { 'data-scroll': 'sum' }, h('div.sheet.typed',
      h('div.form-h', headerLine(this.game)),
      h('div.form-title', 'Справка'),
      h('div.center.small', `о результатах служебной деятельности за сутки ${day} (${dateStr(day)})`),
      nums.length ? h('div.num-grid.mt', nums.map(([l, v, tone, delta]) => h('div.num.' + (tone || 'x'), h('b', delta ? signed(v) : fmtNum(v)), h('span', l)))) : null,
      lines.length ? [h('div.sect', 'Основные события'), lines.map((x, i) => h('div', { style: 'display:flex;gap:.6em' }, h('span.dim', `${i + 1}.`), h('span', x)))] : null,
      distRows.length ? [h('div.sect', 'По районам'), h('div.kv', distRows.map((r) => [h('b', dist(r.districtId || r.id)), h('span', Object.entries(r).filter(([k, v]) => typeof v === 'number').map(([k, v]) => `${(KEYS[k]?.[0] || k).toLowerCase()}: ${/delta/i.test(k) ? signed(v) : fmtNum(v)}`).join(', '))]))] : null,
      h('div.sect', 'Состояние на конец суток'),
      h('div', `Касса: ${money(s.economy?.money ?? 0)}. В ИВС: ${(s.detainees || []).filter((x) => x.status === 'cell').length}. В больнице сотрудников: ${staffHosp}.`),
      !nums.length && !lines.length ? h('div.empty', 'Сутки прошли без особых происшествий. Так бывает. Редко.') : null,
      h('div.mt.small', { style: 'text-align:right' }, 'Начальник ОМ № 14 ____________'),
      stamp('Утверждаю', { rot: -7, style: { top: '1em', right: '1.2em' } }),
    ));
    return this.frame({
      title: 'Итоги суток', sub: dateStr(day), cls: 'mid', formNo: 'Форма № 2-С', body,
      foot: [h('div.sp'), btn('Принять смену', () => this.close(), { cls: 'primary', act: 'close', sound: 'ui_stamp' })],
    });
  }
}
