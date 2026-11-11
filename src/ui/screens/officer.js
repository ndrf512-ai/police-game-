// Личное дело сотрудника: бланк с фото, навыки, черты, биография, снаряжение, история; действия командира.
import { Screen } from './base.js';
import { h, btn, bar, call, stamp, paperclip, field, dateStr, txt, pn, signed } from '../dom.js';
import { portraitImg } from '../portrait.js';
import {
  ROLE_NAMES, SKILL_NAMES, statusName, STATUS_TONE, traitInfo, traitTone, rankName, WEAPON_FULL, ARMOR_NAMES, REWARDS, REPRIMANDS,
  LEAVE_DAYS, STATION_ORDERS, POST_NAMES, headerLine, RANK_ORDER,
} from '../labels.js';

export class OfficerScreen extends Screen {
  static pause = true;
  get o() { const id = this.params.id || this.params.officerId; return (this.state.staff || []).find((x) => x.id === id); }
  render() {
    const o = this.o;
    if (!o) return this.frame({ title: 'Личное дело', cls: 'small', body: h('div.empty', 'Дело не найдено.') });
    const g = this.game, f = o.gender === 'f';
    const alive = !['dead', 'fired'].includes(o.status);
    const eq = o.equipment || {};
    const list = this.params.list || [];
    const k = list.indexOf(o.id);
    const nav = list.length > 1 ? h('div.row', { style: 'gap:2px' },
      h('button.win-x', { type: 'button', style: 'margin:0', 'data-act': 'prev', onclick: (e) => { e.stopPropagation(); this.params.id = list[(k - 1 + list.length) % list.length]; delete this.params.officerId; this.ui.sfx('ui_paper'); this.refresh(); } }, '‹'),
      h('button.win-x', { type: 'button', style: 'margin:0', 'data-act': 'next', onclick: (e) => { e.stopPropagation(); this.params.id = list[(k + 1) % list.length]; delete this.params.officerId; this.ui.sfx('ui_paper'); this.refresh(); } }, '›')) : null;
    const rels = Object.entries(o.relations || {}).map(([id, v]) => [(this.state.staff || []).find((x) => x.id === id), v]).filter(([x]) => x).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4);
    const fam = o.family ? [o.family.married ? (f ? 'замужем' : 'женат') : (f ? 'не замужем' : 'холост'), o.family.kids ? pn(o.family.kids, ['ребёнок', 'ребёнка', 'детей']) : 'детей нет'].join(', ') + (o.family.note ? `. ${o.family.note}` : '') : '—';
    const left = h('div.left',
      h('div.photo', { style: 'transform:rotate(-2.2deg)' }, portraitImg(o, { scale: 2 }), paperclip(),
        o.status === 'dead' ? stamp('Погиб' + (f ? 'ла' : ''), { rot: -18, style: { left: '-.2em', top: '40%', fontSize: '.9em' } }) : null,
        o.status === 'fired' ? stamp(f ? 'Уволена' : 'Уволен', { rot: -18, style: { left: '-.2em', top: '40%', fontSize: '.9em' } }) : null),
      h('span.chip.st-' + (STATUS_TONE[o.status] || 'dim'), statusName(o.status, o.gender) + (o.onShift && alive ? ' · на смене' : '')),
      h('div.tiny.dim.center', `Личный номер ${String(o.id).replace(/\D/g, '').slice(-6).padStart(6, '0') || '000014'}`),
      stamp('Секретно', { violet: true, rot: 12, style: { position: 'relative', fontSize: '.62em', marginTop: '.4em' } }));
    const right = h('div.right',
      h('div.form-h', headerLine(g)),
      h('div.form-title', { style: 'font-size:1em;letter-spacing:.2em' }, 'Личное дело'),
      field('Фамилия, имя, отчество', `${o.lastName} ${o.firstName} ${o.patronymic}`),
      field('Специальное звание', rankName(o.rank) + ' милиции'),
      field('Должность', ROLE_NAMES[o.role] || o.role),
      field('Возраст', o.age ? pn(o.age, ['год', 'года', 'лет']) : '—'),
      field('Семейное положение', fam),
      field('На службе в ОМ № 14', o.stats?.daysServed != null ? pn(o.stats.daysServed, ['сутки', 'суток', 'суток']) : '—'),
      h('div.sect', 'Состояние'),
      h('div.skills', bar(o.hp, 'good', 'Здоровье'), bar(o.fatigue, 'bad', 'Усталость'), bar(o.morale, 'good', 'Мораль'), bar(o.stress, 'bad', 'Стресс'), bar(o.loyalty, 'good', 'Лояльность')),
      o.injuries?.length ? h('div.note.bad.mt', 'Травмы: ' + o.injuries.map((x) => `${x.name} (${['лёгкая', 'средняя', 'тяжёлая'][(x.severity || 1) - 1]}, ещё ${pn(x.daysLeft ?? 0, ['день', 'дня', 'дней'])})`).join('; ')) : null,
      h('div.sect', 'Подготовка'),
      h('div.skills', Object.keys(SKILL_NAMES).map((key) => bar(o.skills?.[key], 'good', SKILL_NAMES[key]))),
      h('div.sect', 'Характеристика'),
      (o.traits || []).length ? (o.traits || []).map((id) => { const t = traitInfo(g, id); return h('div.trait', h('span.chip.' + traitTone(id), t.name), h('span', t.desc || '')); }) : h('div.small.dim', 'Ничем не примечателен.'),
      h('div.sect', 'Табельное'),
      h('div.row.wrap', { style: 'gap:.3em 1.2em' },
        h('span', h('span.dim.small', 'Оружие: '), h('b', WEAPON_FULL[eq.weapon] || 'нет'), eq.weapon && eq.weapon !== 'none' ? ` (${pn(eq.ammo ?? 0, ['патрон', 'патрона', 'патронов'])})` : ''),
        h('span', h('span.dim.small', 'Защита: '), h('b', ARMOR_NAMES[eq.armor] || 'нет'), eq.helmet ? ', шлем' : ''),
        h('span', h('span.dim.small', 'Рация: '), h('b', eq.radio ? 'есть' : 'нет')),
        alive ? btn('В оружейку', () => this.ui.open('armory', { officerId: o.id }), { cls: 'slim', act: 'to-armory' }) : null),
      o.bio ? [h('div.sect', 'Биография'), h('div.typed.small', o.bio)] : null,
      rels.length ? [h('div.sect', 'Отношения в коллективе'), rels.map(([x, v]) => h('div.small', `${x.lastName} — ${v >= 50 ? 'друг' : v >= 15 ? 'приятель' : v <= -50 ? 'враг' : v <= -15 ? 'не ладят' : 'ровно'} (${signed(v)})`))] : null,
      h('div.sect', 'Послужной список'),
      h('div.hist', (o.history || []).length ? (o.history || []).slice().reverse().slice(0, 30).map((x) => h('div', h('span.d', `Д${x.day}`), txt(x.text))) : h('span.dim', 'Записей нет.')),
      o.stats ? h('div.small.mt', `Задержаний: ${o.stats.arrests ?? 0} · ранений: ${o.stats.wounds ?? 0} · применял${f ? 'а' : ''} оружие на поражение: ${o.stats.kills ?? 0}`) : null,
    );
    const A = (label, fn, opts = {}) => btn(label, fn, { cls: 'slim' + (opts.cls ? ' ' + opts.cls : ''), act: opts.act, disabled: opts.disabled || !alive });
    const atStation = o.status === 'station';
    const foot = h('div.row.scroll-x', { style: 'flex:1 1 auto;min-width:0;gap:.4em;padding-bottom:2px' },
      A('Поговорить', () => this.ui.open('talk', { officerId: o.id }), { act: 'talk', disabled: !atStation && o.status !== 'home' }),
      A(o.onShift ? 'Снять со смены' : 'В смену', () => this.act('setShift', [!o.onShift], o.onShift ? `${o.lastName} ${f ? 'снята' : 'снят'} со смены` : `${o.lastName} ${f ? 'заступила' : 'заступил'} на смену`), { act: 'shift', disabled: !(atStation || o.status === 'home') }),
      A('Распоряжение', () => this.stationOrder(), { act: 'order', disabled: !(atStation && o.onShift) }),
      A('Поощрить', () => this.pick('Поощрение', REWARDS, (id) => this.act('reward', [id], 'Поощрение объявлено')), { act: 'reward' }),
      A('Взыскание', () => this.pick('Взыскание', REPRIMANDS, (id) => this.act('reprimand', [id], 'Взыскание наложено')), { act: 'reprimand' }),
      A('Повысить', () => this.promote(), { act: 'promote' }),
      A('Отпуск', () => this.pick('Отпуск', LEAVE_DAYS.map((d) => ({ id: d, label: pn(d, ['день', 'дня', 'дней']), desc: d >= 14 ? 'Вернётся отдохнувшим. Людей и так не хватает.' : '' })), (d) => this.act('sendLeave', [d], `${o.lastName} в отпуске`)), { act: 'leave', disabled: !['station', 'home'].includes(o.status) }),
      o.injuries?.length || (o.hp ?? 100) < 70 ? A('В больницу', () => this.act('sendHospital', [], `${o.lastName} ${f ? 'отправлена' : 'отправлен'} в больницу`), { act: 'hospital' }) : null,
      A('Проверить', () => this.investigate(), { act: 'investigate', cls: 'violet' }),
      A('Уволить', () => this.fire(), { act: 'fire', cls: 'danger' }),
    );
    return this.frame({
      title: `${rankName(o.rank)} ${o.lastName}`, sub: list.length > 1 ? `${k + 1} из ${list.length}` : this.stamp(), cls: 'mid', formNo: 'Форма № 4-ЛД', head: nav,
      body: h('div.scroll.grow', { 'data-scroll': 'dossier' }, h('div.dossier', left, right)),
      foot,
    });
  }
  act(fn, args, okMsg) {
    const o = this.o; if (!o) return;
    const r = call(this.sim.staff, fn, this.game, o.id, ...args);
    if (r === undefined && !this.sim.staff?.[fn]) { this.ui.toast('Действие недоступно', 'warn'); return; }
    if (r && r.ok === false) this.ui.toast(r.reason || 'Нельзя', 'warn');
    else this.ui.toast(r?.text || okMsg, 'good');
    this.refresh();
  }
  pick(title, options, onPick) {
    this.ui.dialog({ title, text: `${rankName(this.o.rank)} ${this.o.lastName} ${this.o.firstName}`, choices: [...options.map((x) => ({ label: x.label, desc: x.desc, onPick: () => onPick(x.id) })), { label: 'Отмена' }] });
  }
  stationOrder() {
    const o = this.o;
    this.ui.dialog({
      title: 'Распоряжение по участку', text: `${rankName(o.rank)} ${o.lastName}. Что делать?`,
      choices: [...STATION_ORDERS.map((x) => ({ label: x.label, desc: x.desc, onPick: () => {
        if (x.needsPoint) {
          const busy = new Set((this.state.staff || []).filter((s) => s.id !== o.id && s.post).map((s) => s.post));
          this.ui.dialog({ title: 'Пост', text: 'Куда поставить?', choices: [...Object.entries(POST_NAMES).map(([id, nm]) => ({ label: nm + (busy.has(id) ? ' (занят)' : ''), onPick: () => this.order({ type: 'post', pointId: id }, `${o.lastName} — пост: ${nm}`) })), { label: 'Отмена' }] });
        } else this.order({ type: x.id }, `${o.lastName}: «Есть!» — ${x.label.toLowerCase()}`);
      } })), { label: 'Отмена' }],
    });
  }
  order(ord, msg) {
    const st = this.game?.station;
    if (!st?.orderOfficer) { this.ui.toast('Сотрудника нет на участке', 'warn'); return; }
    const r = call(st, 'orderOfficer', this.o.id, ord);
    if (r && r.ok === false) this.ui.toast(r.reason || 'Не может', 'warn'); else this.ui.toast(msg, 'info');
  }
  async promote() {
    const o = this.o, cur = rankName(o.rank), k = RANK_ORDER.indexOf(cur), next = RANK_ORDER[k + 1];
    if (!(await this.ui.confirm(`Представить ${o.lastName} к званию «${next || 'следующее'}»? Повышение поднимает мораль, но другие могут обидеться.`))) return;
    this.act('promote', [], `${o.lastName} — ${next || 'новое звание'}`);
  }
  async fire() {
    const o = this.o;
    if (!(await this.ui.confirm(`Уволить ${o.lastName} ${o.firstName[0]}. ${o.patronymic[0]}. из органов? Это необратимо.`, { yes: 'Уволить', danger: true }))) return;
    this.act('fire', [], `${o.lastName} ${o.gender === 'f' ? 'уволена' : 'уволен'}`);
    this.close();
  }
  async investigate() {
    const o = this.o;
    if (!(await this.ui.confirm(`Негласная проверка ${o.lastName}: связи, деньги, с кем пьёт. Займёт время и потребует расходов на «источники». Начать?`))) return;
    const r = call(this.sim.staff, 'investigate', this.game, o.id);
    if (!r) { this.ui.toast('Проверка недоступна', 'warn'); return; }
    if (r.ok === false) { this.ui.toast(r.reason || 'Нельзя', 'warn'); return; }
    this.ui.dialog({ title: r.found ? 'Проверка: есть сведения' : 'Проверка: чисто', text: r.text || (r.found ? 'Кое-что нашлось.' : 'Ничего порочащего не обнаружено.'), portrait: o });
    this.refresh();
  }
}

export { dateStr };
