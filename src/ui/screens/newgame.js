// Новая игра: режим, сложность, пол и ФИО командира, портрет, предыстория / настройки песочницы.
import { Screen } from './base.js';
import { h, btn, seg, toggle, stamp, paperclip } from '../dom.js';
import { portraitImg, portraitSpec, randomLook } from '../portrait.js';
import { RNG } from '../../core/rng.js';
import { randomPerson } from '../../core/names.js';
import { headerLine } from '../labels.js';

const DIFF = [
  { id: 'easy', label: 'Лёгкая', desc: 'Бюджет побольше, банды терпеливее, люди крепче. Для знакомства.' },
  { id: 'normal', label: 'Обычная', desc: 'Как было на самом деле: денег мало, бандитов много.' },
  { id: 'hard', label: 'Тяжёлая', desc: 'Денег нет, зарплату задерживают, банды наглеют быстро, ошибки не прощаются.' },
];
const SANDBOX = [
  { key: 'startMoney', label: 'Деньги на старте', def: 'normal', options: [{ id: 'low', label: 'нищета' }, { id: 'normal', label: 'как у всех' }, { id: 'high', label: 'спонсор' }, { id: 'unlimited', label: 'без счёта' }] },
  { key: 'staff', label: 'Личный состав', def: 12, options: [{ id: 8, label: '8' }, { id: 12, label: '12' }, { id: 16, label: '16' }, { id: 20, label: '20' }] },
  { key: 'crime', label: 'Преступность', def: 1, options: [{ id: 0.5, label: 'тихо' }, { id: 1, label: 'обычно' }, { id: 1.5, label: 'высокая' }, { id: 2, label: 'беспредел' }] },
  { key: 'gangAggression', label: 'Наглость банд', def: 1, options: [{ id: 0.5, label: 'низкая' }, { id: 1, label: 'обычная' }, { id: 1.6, label: 'высокая' }] },
  { key: 'attacks', label: 'Нападения на отделение', def: true, type: 'bool' },
  { key: 'salaryDelays', label: 'Задержки зарплаты', def: true, type: 'bool' },
  { key: 'events', label: 'Звонки начальства и «предложения»', def: true, type: 'bool' },
];

export class NewGameScreen extends Screen {
  static pause = true; static needsGame = false; static hideHud = true; static skin = 'solid';
  constructor(ui, params) {
    super(ui, params);
    this.rng = new RNG((Date.now() ^ 0x5f3759df) >>> 0);
    this.mode = 'campaign'; this.difficulty = 'normal'; this.gender = 'm';
    this.sandbox = Object.fromEntries(SANDBOX.map((s) => [s.key, s.def]));
    this.reroll(true);
  }
  reroll(face) {
    const p = randomPerson(this.rng, this.gender);
    this.person = p;
    if (face || !this.look) this.look = randomLook(this.rng, this.gender);
    this.faceSeed = this.rng.int(1, 1e9);
  }
  spec() {
    return portraitSpec({ id: 'cmd_' + this.faceSeed, gender: this.gender, age: 41, rank: 'майор', role: 'chief', look: { ...this.look, uniform: 'militia', gender: this.gender, hat: 'cap' } }, { kind: 'officer' });
  }
  story() {
    const f = this.gender === 'f';
    return `Октябрь 1996-го. Вас перевели из области начальником 14-го отделения милиции. Прежний начальник ушёл «по собственному» после истории с рынком — о ней в отделении молчат.

Штат некомплект, зарплату задерживают третий месяц, оба УАЗа на ходу через раз. На рынке делят «крышу» спортсмены и афганцы, у вокзала торгуют героином, в Черёмушках по ночам стреляют. Начальство ждёт цифр, город — порядка. А личный состав ждёт, ${f ? 'какой' : 'каким'} окажется ${f ? 'новая начальница' : 'новый начальник'}.`;
  }
  render() {
    const p = this.person;
    const photo = h('div.photo', { style: 'transform:rotate(-2deg)' }, portraitImg(this.spec(), { scale: 2.5 }), paperclip());
    const left = h('div.ng-col', { style: 'align-items:center;flex:0 0 auto;width:clamp(9em,26%,13em)' },
      photo,
      seg([{ id: 'm', label: 'Мужчина' }, { id: 'f', label: 'Женщина' }], this.gender, (v) => { this.gender = v; this.reroll(true); this.refresh(); }, { act: 'gender' }),
      h('div.row', { style: 'width:100%' },
        btn('Лицо', () => { this.look = randomLook(this.rng, this.gender); this.faceSeed = this.rng.int(1, 1e9); this.refresh(); }, { cls: 'slim grow', act: 'face' }),
        btn('Другое имя', () => { const l = this.look; this.reroll(false); this.look = l; this.refresh(); }, { cls: 'slim grow', act: 'rename' })),
    );
    const right = h('div.ng-col.grow.scroll', { 'data-scroll': 'ng', style: 'padding-right:.3em' },
      h('div.form-h', headerLine(this.game), h('br'), h('b', 'Приказ о назначении')),
      h('div.ng-name', `${p.lastName} ${p.firstName} ${p.patronymic}`),
      h('div.small', 'майор милиции · начальник отделения милиции № 14'),
      h('div.sect', 'Режим'),
      seg([{ id: 'campaign', label: 'Кампания' }, { id: 'sandbox', label: 'Песочница' }], this.mode, (v) => { this.mode = v; this.refresh(); }, { act: 'mode' }),
      h('div.sect', 'Сложность'),
      seg(DIFF, this.difficulty, (v) => { this.difficulty = v; this.refresh(); }, { act: 'difficulty' }),
      h('div.small.dim', { style: 'margin-top:.25em' }, DIFF.find((d) => d.id === this.difficulty).desc),
      this.mode === 'campaign'
        ? [h('div.sect', 'Обстановка'), h('div.ng-story.typed', this.story())]
        : [h('div.sect', 'Условия песочницы'), h('div.ng-sand', SANDBOX.map((s) => [
          h('div.small', s.label),
          s.type === 'bool' ? toggle(this.sandbox[s.key], (v) => { this.sandbox[s.key] = v; }) : seg(s.options, this.sandbox[s.key], (v) => { this.sandbox[s.key] = v; }, { small: true }),
        ])), h('div.small.dim.mt', 'Без целей и сроков. Отделение — ваше, пока вас не сняли или не убили.')],
    );
    const body = h('div.ng-body', left, right);
    const win = this.frame({
      title: 'Новая игра', sub: 'Личное дело командира', cls: 'mid', body,
      foot: [btn('Отмена', () => this.close(), { act: 'cancel' }), h('div.sp'), btn('Принять дела', () => this.start(), { cls: 'primary big', act: 'start', sound: 'ui_stamp' })],
    });
    win.appendChild(stamp(this.mode === 'campaign' ? 'Назначить' : 'Свободная', { rot: -9, style: { right: '1.2em', top: '3.6em', fontSize: '.9em' } }));
    return win;
  }
  start() {
    const p = this.person;
    const opts = {
      mode: this.mode, difficulty: this.difficulty, gender: this.gender,
      firstName: p.firstName, lastName: p.lastName, patronymic: p.patronymic,
      look: { ...this.look, gender: this.gender },
    };
    if (this.mode === 'sandbox') opts.sandbox = { ...this.sandbox };
    const g = this.game;
    if (typeof g?.newGame !== 'function') { this.ui.toast('Новая игра недоступна (нет game.newGame)', 'bad'); return; }
    try { g.newGame(opts); }
    catch (e) { console.error(e); this.ui.toast('Ошибка при создании игры: ' + (e.message || e), 'bad'); return; }
    this.ui.closeAll();
    if (g.state && !this.ui.pending.length) this.ui.open('briefing');
  }
}
