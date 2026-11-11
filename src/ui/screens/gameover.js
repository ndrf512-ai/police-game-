// Конец игры: приказ о поощрении или об освобождении от должности / извещение о гибели.
import { Screen } from './base.js';
import { h, btn, stamp, dateStr, pn } from '../dom.js';
import { headerLine } from '../labels.js';

export class GameOverScreen extends Screen {
  static pause = true; static skin = 'gameover'; static hideHud = true; static noBack = true; static modalLock = true; static sound = 'ui_stamp';
  back() { return true; }
  render() {
    const s = this.state, p = s.player || {}, f = p.gender === 'f';
    const win = this.params.result === 'win';
    const dead = !!this.params.dead;
    const name = `${p.lastName || ''} ${p.firstName || ''} ${p.patronymic || ''}`.trim();
    const day = s.time?.day || 1;
    const staff = s.staff || [];
    const arrests = staff.reduce((a, o) => a + (o.stats?.arrests || 0), 0);
    const lost = staff.filter((o) => o.status === 'dead').length;
    let title, text;
    if (win) {
      title = 'Приказ';
      text = `О поощрении.\n\nЗа образцовое выполнение служебного долга, восстановление правопорядка на территории обслуживания и проявленные при этом мужество и принципиальность начальника отделения милиции № 14 майора милиции ${name}\n\nПРИКАЗЫВАЮ: наградить ценным подарком и представить к присвоению очередного специального звания «подполковник милиции».`;
    } else if (dead) {
      title = 'Извещение';
      text = `${name}, майор милиции, начальник отделения милиции № 14, ${f ? 'погибла' : 'погиб'} при исполнении служебных обязанностей ${dateStr(day)}.\n\nЛичный состав отделения выражает соболезнования родным и близким.`;
    } else {
      title = 'Приказ';
      text = `Об освобождении от занимаемой должности.\n\nМайора милиции ${name} освободить от должности начальника отделения милиции № 14 в связи с неполным служебным соответствием.`;
    }
    const reason = this.params.reason ? String(this.params.reason) : '';
    const sheet = h('div.go-sheet' + (win ? '' : '.lose'),
      h('div.form-h', headerLine(this.game)),
      h('div.go-big', title),
      h('div.center.small', `г. Н-ск · ${dateStr(day)}`),
      h('div.typed.mt.scroll', { style: 'max-height:42vh', 'data-scroll': 'go' }, text, reason ? h('div.note.mt' + (win ? '' : '.bad'), 'Основание: ' + reason) : null),
      h('div.num-grid.mt',
        h('div.num', h('b', String(day)), h('span', 'суток на посту')),
        h('div.num.good', h('b', String(arrests)), h('span', 'задержаний')),
        h('div.num.bad', h('b', String(lost)), h('span', pn(lost, ['сотрудник погиб', 'сотрудника погибли', 'сотрудников погибли']).replace(/^\d+\s/, '')))),
      h('div.row.mt', { style: 'justify-content:flex-end' },
        btn('Загрузить', () => this.load(), { act: 'load' }),
        btn('В главное меню', () => { this.ui.closeAll(); this.ui.open('menu'); }, { cls: 'primary', act: 'menu' })),
      stamp(win ? 'Утверждаю' : dead ? 'Скорбим' : 'Уволить', { rot: win ? -8 : 10, style: { right: '1.4em', top: '2.2em', fontSize: '1.3em' } }),
    );
    return h('div.go-wrap', sheet);
  }
  load() {
    let ok = false;
    try { ok = typeof this.game?.load === 'function' && this.game.load() !== false; } catch (e) { ok = false; }
    if (ok) { this.ui._gameoverShown = false; this.ui.closeAll(); this.ui.toast('Игра загружена', 'good'); }
    else this.ui.toast('Сохранение не найдено', 'bad');
  }
}
