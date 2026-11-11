// Экраны: рация, телевизор, ИВС и допрос, посетитель, предложения и бумаги, пауза, настройки, блокнот.
import { Screen } from './base.js';
import { h, btn, seg, toggle, bar, call, txt, hhmm, sfx, money, dateStr } from '../dom.js';
import { portraitImg } from '../portrait.js';
import { APPROACHES, MOOD_NAMES, MOOD_NAMES_F, headerLine } from '../labels.js';

const nameOf = (p) => (p ? `${p.lastName || ''} ${p.firstName || ''} ${p.patronymic || ''}`.trim() : '—');

/* ================================================================== РАЦИЯ */
export class RadioScreen extends Screen {
  static pause = true; static skin = 'radio'; static sound = 'radio_squelch';
  constructor(ui, params) { super(ui, params); this.filter = params.filter || 'all'; }
  msgs() {
    const all = this.state.radio || [];
    if (this.filter === 'all') return all;
    if (this.filter === 'requests') return all.filter((m) => m.choices && m.choices.length);
    return all.filter((m) => m.taskId === this.filter || m.meta?.taskId === this.filter);
  }
  onEvent(ev) { if (ev === 'radio') this.refresh(); }
  answer(m, c) {
    const r = call(this.sim.city, 'answerRadio', this.game, m.id, c.id);
    if (r && r.ok === false) this.ui.toast(r.reason || 'Не принято', 'warn');
    sfx('radio_squelch'); this.refresh();
  }
  render() {
    const tasks = (this.state.city?.tasks || []).filter((t) => t.phase !== 'done');
    const list = this.msgs().slice(-80);
    const pend = (this.state.radio || []).filter((m) => m.choices && m.choices.length && m.answered == null).length;
    const lcd = h('div.lcd',
      h('div.lcd-top', h('span', 'КАНАЛ 3 · «ЗАРЯ»'), h('span', `${hhmm(this.state.time?.minute || 0)} · ${list.length} сообщ.`)),
      h('div.scroll.grow', { 'data-scroll': 'radio' }, list.length ? list.map((m) => {
        const req = m.choices && m.choices.length;
        return h('div.rmsg' + (m.kind === 'alarm' ? '.alarm' : '') + (req && m.answered == null ? '.request' : ''),
          h('span.t', `Д${m.day} ${hhmm(m.minute)}`), h('span.cs', (m.callsign || m.fromName || 'Эфир') + ':'), h('span', txt(m.text)),
          req && m.answered == null ? h('div.ch', m.choices.map((c) => h('button', { type: 'button', onclick: (e) => { e.stopPropagation(); this.answer(m, c); } }, c.label))) : null,
          req && m.answered != null ? h('div.ans', `→ ${(m.choices.find((c) => c.id === m.answered) || {}).label || m.answered}${m.auto ? ' (решили без вас)' : ''}`) : null);
      }) : h('div.rmsg', 'Эфир молчит. Только шипение.')));
    const side = h('div.radio-side',
      btn('Весь эфир', () => { this.filter = 'all'; this.refresh(); }, { cls: this.filter === 'all' ? 'primary' : '' }),
      btn(`Запросы${pend ? ` (${pend})` : ''}`, () => { this.filter = 'requests'; this.refresh(); }, { cls: this.filter === 'requests' ? 'primary' : '' }),
      h('div.scroll.grow', tasks.map((t) => btn(`${t.rt?.callsign || 'Наряд'}`, () => { this.filter = t.id; this.refresh(); }, { cls: 'slim' + (this.filter === t.id ? ' primary' : '') }))),
      btn('Карта города', () => this.ui.open('citymap'), { cls: 'slim' }));
    return this.frame({ title: 'Радиостанция', cls: 'wide', body: h('div.radio-body', lcd, side) });
  }
  afterRender() { const s = this.root.querySelector('[data-scroll="radio"]'); if (s && !this._scrolled) { s.scrollTop = s.scrollHeight; this._scrolled = true; } }
}

/* ================================================================== ТЕЛЕВИЗОР */
export class TvScreen extends Screen {
  static pause = false; static skin = 'tv'; static sound = 'ui_click';
  constructor(ui, params) { super(ui, params); this.i = 0; this._t = 0; }
  news() { const n = this.state.city?.news || []; return n.slice(-8).reverse(); }
  tick(dt) { this._t += dt; if (this._t > 9) { this._t = 0; this.i++; this.refresh(); } }
  render() {
    const list = this.news(); const m = this.state.time?.minute || 0; const off = m > 60 && m < 360;
    const n = list.length ? list[this.i % list.length] : null;
    const content = off
      ? h('div.tv-content', h('div.tv-main', h('div.tv-text', h('div.tv-head', 'Настроечная таблица'), h('div', 'Вещание возобновится в 6:00.'))))
      : h('div.tv-content',
        h('div.tv-top', h('span.tv-logo', 'ТВ-ЗАРЕЧЬЕ'), h('span', `${hhmm(m)} · НОВОСТИ`)),
        h('div.tv-main', h('div.tv-text', n ? [h('div.tv-head', txt(n.title)), h('div', txt(n.text) || '')] : [h('div.tv-head', 'В эфире — музыка'), h('div', 'Новостей пока нет.')])),
        h('div.tv-ticker', h('span', { style: `animation-duration:${Math.max(14, list.length * 7)}s` }, list.map((x) => txt(x.title)).join('  ●  ') || 'ТВ-Заречье — мы всегда с вами')));
    const scr = h('div.tv-case', h('div.tv-screen', content, h('div.tv-noise'), h('div.tv-glass')),
      h('div.tv-side', h('div.knob'), h('button.tv-key', { type: 'button', onclick: (e) => { e.stopPropagation(); sfx('ui_click'); this.i++; this._t = 0; this.refresh(); } }, 'ДАЛЬШЕ'), h('button.tv-key', { type: 'button', onclick: (e) => { e.stopPropagation(); sfx('ui_click'); this.close(); } }, 'ВЫКЛ')));
    return h('div.tv-body', { style: 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:1.5vh' }, scr);
  }
}

/* ================================================================== ИВС */
export class DetaineesScreen extends Screen {
  static pause = true;
  constructor(ui, params) { super(ui, params); this.sel = params.detaineeId || null; }
  onEvent(ev) { if (ev.startsWith('detainee')) this.refresh(); }
  hours(d) { const t = this.state.time; return Math.max(0, ((t.day - d.arrivedDay) * 1440 + (t.minute - (d.arrivedMin ?? 480))) / 60); }
  async act(kind, d) {
    const D = this.sim.detainees;
    if (kind === 'interrogate') { this.ui.open('interrogation', { detaineeId: d.id }); return; }
    if (kind === 'release') { if (!(await this.ui.confirm(`Отпустить: ${nameOf(d.person)}?`, { yes: 'Отпустить' }))) return; const r = call(D, 'release', this.game, d.id); this.ui.toast(r?.text || 'Отпущен', 'info'); }
    if (kind === 'transfer') { if (!(await this.ui.confirm(`Оформить и этапировать в СИЗО: ${nameOf(d.person)}?`, { yes: 'Этапировать' }))) return; const r = call(D, 'transfer', this.game, d.id); this.ui.toast(r?.text || 'Этапирован', 'good'); }
    this.sel = null; this.refresh();
  }
  render() {
    const dets = (this.state.detainees || []).filter((d) => d.status === 'cell');
    const zone = this.state.zones?.ivs?.owner; const gangs = this.state.city?.gangs || [];
    const cells = ['cell_1', 'cell_2', 'cell_3'].map((c, i) => {
      const inC = dets.filter((d) => d.cell === c);
      return h('div.cellblk', h('div.cellblk-h', h('span', `Камера № ${i + 1}`), h('span', `${inC.length} / 3`)),
        inC.length ? inC.map((d) => {
          const hrs = this.hours(d); const left = 72 - hrs; const g = gangs.find((x) => x.id === d.gangId);
          return h('div.li' + (this.sel === d.id ? '.sel' : ''), { onclick: () => { sfx('ui_click'); this.sel = this.sel === d.id ? null : d.id; this.refresh(); } },
            portraitImg(d, { scale: 1 }),
            h('div.li-main', h('div.li-t', `${nameOf(d.person)}${d.nick ? ` — «${d.nick}»` : ''}, ${d.age}`), h('div.li-s', `${d.charge}${g ? ` · «${g.name}»${d.leader ? ' (главарь)' : ''}` : ''}${d.confessed ? ' · признался' : ''}`)),
            h('div.li-side', h('span.timer' + (left < 24 ? '.low' : ''), left > 0 ? `${Math.floor(left)} ч` : 'срок вышел')));
        }) : h('div.pad.dim.small', 'Пусто. Нары, ведро, надпись на стене: «ДМБ-89».'));
    });
    const d = dets.find((x) => x.id === this.sel);
    const side = d ? h('div.pad',
      h('div', { style: 'display:flex;gap:.8em;align-items:flex-start' }, h('div.photo', portraitImg(d, { scale: 1.7 })), h('div', h('b', nameOf(d.person)), h('div.small.dim', `${d.age} лет · ${d.charge}`), h('div.small', `Содержится: ${Math.floor(this.hours(d))} ч из 72`), d.complaint ? h('div.note.warn', 'Писал жалобу на побои.') : null)),
      h('div.mt', bar(d.cooperation, 'good', 'Сговорчивость')), bar(d.danger, 'bad', 'Опасность'), bar(d.health, 'good', 'Здоровье'),
      d.intel?.length ? h('div.note.mt', 'Опера считают: знает больше, чем говорит.') : null,
      h('div.btns.mt', { style: 'display:flex;flex-wrap:wrap;gap:.4em' }, btn('Допросить', () => this.act('interrogate', d), { cls: 'primary' }), btn('В СИЗО', () => this.act('transfer', d)), btn('Отпустить', () => this.act('release', d), { cls: 'danger' })))
      : h('div.pad', h('div.note', `Мест свободно: ${9 - dets.length} из 9. По закону задержанного можно держать 72 часа — потом либо обвинение и СИЗО, либо свобода.`), zone && zone !== 'police' ? h('div.note.bad.mt', 'ИВС не под нашим контролем!') : null, !dets.length ? h('div.empty.mt', 'Камеры пусты.') : h('div.dim.small.mt', 'Выберите задержанного.'));
    return this.frame({ title: 'Изолятор временного содержания', cls: 'wide', formNo: 'Книга учёта № 3', body: h('div.split', h('div.pane.l', h('div.scroll.grow.pad', { 'data-scroll': 'det' }, cells)), h('div.pane.r', h('div.scroll.grow', side))) });
  }
}

/* ================================================================== ДОПРОС */
export class InterrogationScreen extends Screen {
  static pause = true; static skin = 'interrog'; static sound = 'door_steel';
  constructor(ui, params) { super(ui, params); this.log = []; this.done = false; }
  get d() { return (this.state.detainees || []).find((x) => x.id === this.params.detaineeId) || null; }
  go(a) {
    const d = this.d; if (!d) return;
    const r = call(this.sim.detainees, 'interrogate', this.game, d.id, a.id) || { ok: false, text: 'Допрос не состоялся.' };
    if (!r.ok) { this.ui.toast(r.text || 'Не получилось', 'warn'); return; }
    this.log.push({ cls: 'eff', text: `— ${a.label} —` });
    for (const l of r.lines || []) this.log.push({ cls: l.who === 'officer' ? 'me' : l.who === 'note' ? 'eff' : '', text: (l.who === 'officer' ? '— ' : l.who === 'detainee' ? '— ' : '') + l.text });
    for (const it of r.intel || []) this.log.push({ cls: 'intel', text: `Получено: ${txt(it.text)}` });
    if (r.effects?.informant) this.log.push({ cls: 'intel', text: `Новый источник: «${r.effects.informant}»` });
    if (r.effects?.solved) this.log.push({ cls: 'intel', text: 'Дело раскрыто.' });
    this.log.push({ cls: 'eff', text: r.text || '' });
    if (r.dead || r.effects?.released) this.done = true;
    sfx(a.id === 'hard' ? 'punch' : 'typewriter'); this.refresh();
  }
  render() {
    const d = this.d;
    if (!d) return this.frame({ title: 'Допросная', cls: 'small', body: h('div.pad', h('div.empty', 'Задержанного нет.')) });
    const gone = d.status !== 'cell';
    const who = h('div.int-who', portraitImg(d, { scale: 2.2 }), h('b', { style: 'color:#e9e0c8' }, `${d.person?.lastName || ''}${d.nick ? ` «${d.nick}»` : ''}`), h('div.small', { style: 'color:#bdb39b' }, d.charge),
      bar(d.cooperation, 'good', 'Сговорчивость'), bar(d.health, 'good', 'Здоровье'));
    const proto = h('div.int-proto', h('div.form-h', 'Протокол допроса'), h('div.scroll.grow', { 'data-scroll': 'int' }, h('div.int-lines', this.log.length ? this.log.map((l) => h('p' + (l.cls ? '.' + l.cls : ''), l.text)) : h('p.eff', 'Лампа в лицо, стол, два стула. Выберите, как вести разговор.'))));
    const foot = gone || this.done ? [h('div.sp'), btn('Закончить', () => this.close(), { cls: 'primary' })]
      : [...APPROACHES.map((a) => btn(a.label, () => this.go(a), { cls: 'slim' + (a.id === 'hard' ? ' danger' : ''), title: a.desc })), h('div.sp'), btn('Увести', () => this.close())];
    return this.frame({ title: 'Допросная', cls: 'wide', body: h('div.int-body', who, proto), foot });
  }
  afterRender() { const s = this.root.querySelector('[data-scroll="int"]'); if (s) s.scrollTop = s.scrollHeight; }
}

/* ================================================================== ПОСЕТИТЕЛЬ */
export class VisitorScreen extends Screen {
  static pause = true;
  constructor(ui, params) { super(ui, params); this.v = params.visitor || this.find(); this.answered = null; }
  find() { const st = this.game.station; const list = st?.visitors ? [...st.visitors] : []; const vb = list.find((x) => x.v && !x.resolved); return vb ? vb.v : null; }
  pick(c) {
    const st = this.game.station; let lines = [];
    if (st?.resolveVisitor) lines = call(st, 'resolveVisitor', this.v.id, c.id, 'player') || []; else call(this.sim.city, 'answerVisitor', this.game, this.v, c.id, 'player');
    this.answered = { c, lines }; this.refresh();
  }
  render() {
    const v = this.v;
    if (!v) return this.frame({ title: 'Окошко дежурного', cls: 'small', body: h('div.pad', h('div.empty', 'У окошка никого. Только сквозняк и запах хлорки.')) });
    const f = v.person?.gender === 'f';
    const left = h('div.glass', portraitImg(v, { scale: 2.6 }), h('div.hole'));
    const right = h('div.grow.scroll', { style: 'min-width:0' },
      h('b', `${nameOf(v.person)}, ${v.age}`), h('div.small.dim', `${(f ? MOOD_NAMES_F : MOOD_NAMES)[v.mood] || ''} · ${v.complaint || ''}`),
      (v.lines || []).map((l) => h('div.say.them', l)),
      this.answered ? [h('div.say.me', `— ${this.answered.c.label}`), (this.answered.lines || []).map((l) => h('div.say.them', txt(l)))]
        : h('div.choices.mt', (v.choices || []).map((c) => h('button.choice', { type: 'button', onclick: (e) => { e.stopPropagation(); sfx('ui_click'); this.pick(c); } }, h('b', c.label), c.desc ? h('span', c.desc) : null))));
    return this.frame({ title: 'Окошко дежурного', cls: 'mid', body: h('div.visit', left, right), foot: this.answered ? [h('div.sp'), btn('Дальше', () => this.close(), { cls: 'primary' })] : null });
  }
}

/* ================================================================== ПРЕДЛОЖЕНИЕ / БУМАГИ */
function decide(scr, item, c) {
  let r;
  if (item._offer) r = call(scr.sim.city, 'answerOffer', scr.game, item.id, c.id); else r = call(scr.sim.staff, 'answer', scr.game, item.id, c.id);
  sfx('ui_stamp');
  return r && r.text ? r.text : (item.result || 'Решение принято.');
}
export class OfferScreen extends Screen {
  static pause = true; static sound = 'ui_paper';
  constructor(ui, params) { super(ui, params); this.o = params.offer; this.res = null; }
  render() {
    const o = this.o;
    if (!o) return this.frame({ title: 'Предложение', cls: 'small', body: h('div.pad', h('div.empty', 'Ничего.')) });
    const done = o.answered != null || this.res;
    const body = h('div.scroll.grow.pad', h('div.letter', h('div.small.dim', `От: ${o.from || '—'}`), h('h3', { style: 'margin:.2em 0 .5em' }, o.title), h('div', txt(o.text))),
      done ? h('div.note.mt', this.res || o.result || 'Решено.') : h('div.choices.mt', (o.choices || []).map((c) => h('button.choice', { type: 'button', onclick: (e) => { e.stopPropagation(); this.res = decide(this, { ...o, _offer: true }, c); this.refresh(); } }, h('b', c.label), c.desc ? h('span', c.desc) : null))));
    return this.frame({ title: 'С глазу на глаз', cls: 'mid', body, foot: done ? [h('div.sp'), btn('Закрыть', () => this.close(), { cls: 'primary' })] : [h('div.sp'), btn('Подумать', () => this.close())] });
  }
}
export class InboxScreen extends Screen {
  static pause = true; static sound = 'ui_paper';
  constructor(ui, params) { super(ui, params); this.sel = params.itemId || null; this.res = {}; }
  items() {
    const inbox = (this.state.inbox || []).slice().reverse().map((x) => ({ ...x, _ref: x }));
    const offers = (this.state.city?.offers || []).slice().reverse().map((x) => ({ ...x, _offer: true, _ref: x }));
    return [...offers, ...inbox].sort((a, b) => (a.answered ? 1 : 0) - (b.answered ? 1 : 0) || (b.day * 1440 + b.minute) - (a.day * 1440 + a.minute)).slice(0, 40);
  }
  render() {
    const list = this.items(); const cur = list.find((x) => x.id === this.sel) || null;
    const left = h('div.scroll.grow', { 'data-scroll': 'inbox' }, list.length ? list.map((x) => h('div.li' + (x.id === this.sel ? '.sel' : '') + (x.answered ? '.off' : ''), { onclick: () => { sfx('ui_paper'); this.sel = x.id; this.refresh(); } },
      h('div.li-main', h('div.li-t', x.title || 'Без названия'), h('div.li-s', `Д${x.day} ${hhmm(x.minute || 0)}${x.answered ? ' · решено' : x.choices?.length ? ' · ждёт решения' : ''}`)),
      !x.answered && x.choices?.length ? h('div.li-side', h('span.chip.red', '!')) : null)) : h('div.empty', 'Стол пуст. Редкий случай.'));
    let right;
    if (cur) {
      const done = cur.answered != null || this.res[cur.id];
      right = h('div.scroll.grow.pad', h('div.letter', h('h3', { style: 'margin:0 0 .5em' }, cur.title), h('div', txt(cur.text))),
        done ? h('div.note.mt', this.res[cur.id] || cur.result || 'Принято.')
          : (cur.choices || []).length ? h('div.choices.mt', cur.choices.map((c) => h('button.choice', { type: 'button', onclick: (e) => { e.stopPropagation(); this.res[cur.id] = decide(this, cur, c); this.refresh(); } }, h('b', c.label), c.desc ? h('span', c.desc) : null)))
            : h('div.mt', btn('Ознакомлен', () => { this.res[cur.id] = decide(this, cur, { id: 'ok' }); this.refresh(); }, { cls: 'primary' })));
    } else right = h('div.pad', h('div.note', 'Рапорты, просьбы, звонки сверху и предложения, от которых трудно отказаться. Если не решить вовремя — решат без вас.'));
    return this.frame({ title: 'Бумаги на столе', cls: 'wide', formNo: 'Входящие', body: h('div.split', h('div.pane.l.narrowL', left), h('div.pane.r.fill', right)) });
  }
}

/* ================================================================== ПАУЗА */
export class PauseScreen extends Screen {
  static pause = true; static sound = 'ui_click';
  render() {
    const g = this.game;
    const b = (label, fn, cls = '') => btn(label, fn, { cls });
    const body = h('div.pad', { style: 'display:flex;flex-direction:column;gap:.5em;min-width:16em' },
      b('Продолжить', () => this.close(), 'primary'),
      b('Сохранить', () => { const ok = call(g, 'save'); if (ok === false) this.ui.toast('Не удалось сохранить', 'bad'); }),
      b('Загрузить', async () => { if (!call(g, 'hasSave')) { this.ui.toast('Сохранений нет', 'warn'); return; } if (await this.ui.confirm('Загрузить последнее сохранение? Несохранённое будет потеряно.')) { this.ui.closeAll?.(); call(g, 'load'); } }),
      b('Блокнот: цели и журнал', () => this.ui.open('notebook')),
      b('Бумаги на столе', () => this.ui.open('inbox')),
      b('Настройки', () => this.ui.open('settings')),
      b('В главное меню', async () => { if (await this.ui.confirm('Выйти в главное меню? Игра будет сохранена.')) { call(g, 'save'); this.ui.closeAll?.(); g.state = null; this.ui.open('menu'); } }, 'danger'),
      h('div.small.dim.center.mt', g.state ? `${g.state.mode === 'sandbox' ? 'Песочница' : 'Кампания'} · сутки ${g.state.time.day} · ${dateStr(g.state.time.day)}` : ''));
    return this.frame({ title: 'Пауза', cls: 'small', body });
  }
}

/* ================================================================== НАСТРОЙКИ */
export class SettingsScreen extends Screen {
  static pause = true; static needsGame = false; static sound = 'ui_click';
  render() {
    const s = this.ui.settings; const set = (k, v) => { this.ui.setSetting(k, v); this.refresh(); };
    const row = (label, ctl) => [h('div.sl', label), h('div.sv', ctl)];
    const sg = (k, opts) => seg(opts.map(([id, label]) => ({ id, label })), s[k], (v) => set(k, Number(v)), { small: true, wrap: true });
    const tg = (k) => toggle(!!s[k], (v) => set(k, v));
    const body = h('div.scroll.grow.pad', h('div.sect', 'Управление'), h('div.set-grid',
      row('Чувствительность обзора', sg('lookSens', [[0.5, 'низкая'], [0.75, 'ниже'], [1, 'средняя'], [1.5, 'выше'], [2, 'высокая']])),
      row('Инверсия по вертикали', tg('invertY')), row('Вибрация', tg('vibration'))),
      h('div.sect', 'Графика'), h('div.set-grid',
        row('Разрешение картинки', sg('resScale', [[0.5, 'PS1'], [0.75, 'PS1+'], [1, 'PS2'], [1.5, 'чётче']])),
        row('Дизеринг (зерно)', tg('dither')), row('Дрожание вершин', tg('jitter')), row('Показывать FPS', tg('showFps'))),
      h('div.sect', 'Звук'), h('div.set-grid',
        row('Общая громкость', sg('volMaster', [[0, 'выкл'], [0.4, 'тихо'], [0.8, 'норма'], [1, 'громко']])),
        row('Эффекты', sg('volSfx', [[0, 'выкл'], [0.5, 'тихо'], [0.9, 'норма'], [1, 'громко']])),
        row('Фон: дождь, гул, город', sg('volAmbience', [[0, 'выкл'], [0.4, 'тихо'], [0.7, 'норма'], [1, 'громко']]))),
      h('div.sect', 'Интерфейс'), h('div.set-grid',
        row('Размер интерфейса', sg('uiScale', [[0.85, 'мелко'], [1, 'обычно'], [1.15, 'крупно'], [1.3, 'очень крупно']])),
        row('Субтитры реплик', tg('subtitles'))));
    return this.frame({ title: 'Настройки', cls: 'mid', body, foot: [h('div.sp'), btn('Готово', () => this.close(), { cls: 'primary' })] });
  }
}

/* ================================================================== БЛОКНОТ */
const HELP = [
  ['Ходьба', 'Левая половина экрана — джойстик. Оттяните палец дальше — бег. На компьютере: WASD, Shift.'],
  ['Обзор', 'Правая половина экрана. На компьютере — мышь (клик по экрану захватывает курсор).'],
  ['Действие', 'Подойдите к предмету или человеку — появится подсказка. Кнопка «Действие» или короткий тап (клавиша E).'],
  ['Карта города', 'В дежурной части, на стене. Отсюда отправляют наряды: патруль, охрана, засада, рейд, выезд на вызов.'],
  ['Схема участка', 'Рядом с картой. Группы обороны, приказы командирам, баррикады, уровень тревоги.'],
  ['Рация', 'Доклады нарядов и запросы. Не ответите вовремя — командир наряда решит сам, по характеру.'],
  ['Личные дела', 'Шкаф в вашем кабинете. Смены, поощрения, взыскания, разговоры, проверки.'],
  ['Бумаги', 'Стол в кабинете. Рапорты, звонки сверху, предложения.'],
  ['Оружейная', 'Выдача оружия, патронов, бронежилетов. Заказ — по телефону в кабинете.'],
  ['ИВС', 'Камеры. Допросы дают наводки на банды. 72 часа — и решайте.'],
  ['Время', 'Пауза и скорость — вверху экрана (пробел, 1/2/3). В бою время не ускоряется.'],
  ['Оружие', 'Кнопка «ПМ» — достать пистолет, «Огонь» — стрелять. Присесть — меньше попадают.'],
  ['Свет', 'Если вырубили свет — рубильник в генераторной. Фонарь — кнопка «Фонарь» (L).'],
];
export class NotebookScreen extends Screen {
  static pause = true; static skin = 'notebook'; static sound = 'ui_paper';
  constructor(ui, params) { super(ui, params); this.tab = params.tab || 'goals'; }
  render() {
    const s = this.state; const c = s.campaign || {}; const fl = s.flags || {};
    let body;
    if (this.tab === 'goals') {
      const gangs = s.city?.gangs || [];
      body = h('div.scroll.grow.pad.nb-ink.lined', { 'data-scroll': 'nb' },
        h('div', { style: 'font-weight:700' }, c.goalText || 'Свободная служба.'),
        (c.objectives || []).map((o) => h('div.goal' + (o.done ? '.done' : '') + (o.failed ? '.failed' : ''), h('span.box', o.done ? '✓' : o.failed ? '✗' : ''), h('span.txt', `${o.text}${o.progress ? ` — ${o.progress}` : ''}${o.optional ? ' (по желанию)' : ''}`))),
        h('div.mt', bar(c.authority ?? fl.authority ?? 50, 'good', 'Авторитет у начальства')), bar(fl.reputation ?? 40, 'good', 'Репутация в городе'),
        h('div.sect', 'Группировки'),
        gangs.map((g) => h('div.goal' + (g.status === 'broken' ? '.done' : ''), h('span.box', g.status === 'broken' ? '✗' : ''), h('span.txt', `«${g.name}» — ${g.status === 'broken' ? 'разгромлены' : `сила ${Math.round(g.strength)}, злость ${Math.round(g.anger)}`}${g.leader?.known ? `. Главарь: «${g.leader.nick}»${g.leader.status === 'arrested' ? ' (арестован)' : g.leader.status === 'dead' ? ' (убит)' : ''}` : '. Главарь неизвестен'}`))),
        c.intro ? [h('div.sect', 'С чего всё началось'), h('div', c.intro)] : null);
    } else if (this.tab === 'log') {
      const log = (s.log || []).slice(-120).reverse();
      body = h('div.scroll.grow.pad.nb-ink', { 'data-scroll': 'nb' }, log.length ? log.map((l) => h('div.logrow' + (l.kind === 'important' ? '.bad' : ''), h('span.tm', `Д${l.day} ${hhmm(l.minute)}`), h('span.tx', l.text))) : h('div.empty', 'Пока пусто.'));
    } else {
      body = h('div.scroll.grow.pad.nb-ink', { 'data-scroll': 'nb' }, h('dl.help-grid', HELP.map(([a, b]) => [h('dt', a), h('dd', b)])));
    }
    const inbox = (s.inbox || []).filter((x) => !x.answered && x.choices?.length).length + (s.city?.offers || []).filter((x) => !x.answered).length;
    return this.frame({ title: 'Блокнот', cls: 'mid', tabs: [{ id: 'goals', label: 'Цели' }, { id: 'log', label: 'Журнал' }, { id: 'help', label: 'Справка' }], tab: this.tab, onTab: (t) => { this.tab = t; this.refresh(); }, body,
      foot: [btn(`Бумаги${inbox ? ` (${inbox})` : ''}`, () => this.ui.open('inbox')), btn('Касса', () => this.ui.open('supply', { tab: 'cash' })), h('div.sp'), btn('Закрыть', () => this.close(), { cls: 'primary' })] });
  }
}

export { money, headerLine };
