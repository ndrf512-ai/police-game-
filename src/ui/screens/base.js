// Базовый класс экрана. Экран — окно поверх игры; UI держит стек экранов.
import { h, clear, saveScroll, restoreScroll, sfx, hhmm, weekday } from '../dom.js';

export class Screen {
  /** Ставить ли игру на паузу, пока экран открыт */
  static pause = true;
  /** Доп. класс оверлея (.scr.<skin>) */
  static skin = '';
  /** Звук открытия */
  static sound = 'ui_paper';
  /** Нужна ли загруженная игра */
  static needsGame = true;
  /** HUD скрыт целиком (полноэкранные экраны) */
  static hideHud = false;

  constructor(ui, params = {}) {
    this.ui = ui; this.game = ui.game; this.params = params || {};
    this.root = null; this._t = 0;
  }
  get state() { return this.game?.state || {}; }
  get sim() { return this.game?.sim || {}; }
  wantsPause() { return this.constructor.pause; }
  mount(root) { this.root = root; this.build(); }
  build() {
    clear(this.root);
    let el;
    try { el = this.render(); }
    catch (e) {
      console.error('[ui] ошибка отрисовки экрана', this.constructor.id, e);
      const where = String(e && e.stack || '').split('\n').slice(1, 3).map((l) => l.trim().replace(/^at\s+/, '').replace(/\(?https?:\/\/[^/]+\/|\(?file:\/\/[^)]*\//g, '')).join(' ← ');
      el = this.frame({ title: 'Ошибка', cls: 'small', body: h('div.pad', h('div.note.bad', `Экран «${this.constructor.id || '?'}» не удалось отрисовать: ` + (e.message || e)), where ? h('div.small.dim', { style: 'margin-top:.4em;word-break:break-all' }, where) : null) });
    }
    if (el) this.root.appendChild(el);
    this.afterRender?.();
  }
  refresh() {
    if (!this.root) return;
    const s = saveScroll(this.root);
    this.build();
    restoreScroll(this.root, s);
  }
  /** Каждый кадр, пока экран сверху */
  tick(dt) {}
  /** События шины, пока экран открыт (в т.ч. под другими) */
  onEvent(ev, payload) {}
  /** Кнопка «назад»: true — обработано внутри экрана */
  back() { return false; }
  destroy() {}
  close() { this.ui.closeScreen(this); }

  /** Подзаголовок по умолчанию: «Д3 · 14:05 · среда» */
  stamp() {
    const t = this.state.time; if (!t) return '';
    return `Д${t.day} · ${hhmm(t.minute)} · ${weekday(t.day)}`;
  }

  /**
   * Рамка окна: {title, sub, tabs:[{id,label,count,red}], tab, onTab, body, foot, cls, formNo, closeLabel, noClose, head}
   */
  frame(o) {
    const head = h('div.win-head',
      h('div.win-titles', h('div.win-title', o.title || ''), o.sub !== false ? h('div.win-sub', o.sub ?? this.stamp()) : null),
      o.tabs ? this.tabs(o.tabs, o.tab, o.onTab) : null,
      o.head || null,
      o.noClose ? null : h('button.win-x', { type: 'button', 'aria-label': 'Закрыть', 'data-act': 'close', onclick: (e) => { e.stopPropagation(); sfx('ui_click'); if (!this.back()) this.close(); } }, '✕'),
      o.formNo ? h('div.formno', o.formNo) : null,
    );
    const win = h('div.win' + (o.cls ? '.' + o.cls.split(' ').join('.') : ''), head,
      h('div.win-body', o.body),
      o.foot ? h('div.win-foot', o.foot) : null);
    return win;
  }
  tabs(list, cur, onTab) {
    return h('div.tabs', list.map((t) => h('button.tab' + (t.id === cur ? '.on' : ''), {
      type: 'button', 'data-tab': t.id,
      onclick: (e) => { e.stopPropagation(); sfx('ui_paper'); onTab && onTab(t.id); },
    }, t.label, t.count ? h('span.cnt' + (t.red ? '.red' : ''), String(t.count)) : null)));
  }
}
