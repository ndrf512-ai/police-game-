// Разговор с сотрудником (или другим актором на участке).
// params: {officerId} — из личного дела; {actor, actorId, officerId, choices} — когда игрок подошёл к актору
// (choices из game.station.onPlayerTalk(actor), выбор → game.station.talkChoice(actor, choiceId) → {lines, openScreen?}).
import { Screen } from './base.js';
import { h, btn, bar, call, txt } from '../dom.js';
import { portraitImg } from '../portrait.js';
import { TALK_TOPICS, EFFECT_NAMES, rankName, ROLE_NAMES, traitInfo, traitTone } from '../labels.js';

export class TalkScreen extends Screen {
  static pause = true; static sound = 'ui_click';
  constructor(ui, params) {
    super(ui, params);
    this.log = []; this.used = new Set(); this.usedChoices = new Set();
    this.choices = Array.isArray(params.choices) ? params.choices : null;
    const o = this.o;
    if (o) {
      const f = o.gender === 'f';
      const greet = (this.state.player?.gender === 'f')
        ? ['Слушаю, товарищ майор.', 'Здравия желаю, товарищ майор.', 'Да, товарищ майор?']
        : ['Слушаю, товарищ майор.', 'Здравия желаю, товарищ майор.', 'Да, товарищ майор?'];
      this.log.push({ who: 'them', text: greet[(o.lastName?.length || 0) % greet.length] });
      if ((o.fatigue ?? 0) > 80) this.log.push({ who: 'note', text: `${o.lastName} еле держится на ногах.` });
      else if ((o.morale ?? 50) < 25) this.log.push({ who: 'note', text: `${f ? 'Она' : 'Он'} смотрит в сторону. Видно, что не в духе.` });
    }
  }
  get o() {
    const id = this.params.officerId || this.params.actor?.officerId;
    return id ? (this.state.staff || []).find((x) => x.id === id) : null;
  }
  get name() {
    const o = this.o; if (o) return `${rankName(o.rank)} ${o.lastName}`;
    const a = this.params.actor; return a?.name || 'Собеседник';
  }
  push(lines, who = 'them') {
    for (const l of lines || []) {
      if (l == null) continue;
      if (typeof l === 'string') this.log.push({ who, text: l });
      else {
        const sp = l.who || l.speaker || l.from;
        const me = sp === 'player' || sp === 'me' || sp === 'commander';
        this.log.push({ who: me ? 'me' : (sp === 'note' || sp === 'narrator' ? 'note' : 'them'), text: txt(l), name: !me && sp && sp !== 'officer' && sp !== 'them' ? String(sp) : null });
      }
    }
  }
  topic(t) {
    const o = this.o; if (!o) return;
    this.used.add(t.id);
    this.log.push({ who: 'me', text: t.q(o) });
    const r = call(this.sim.staff, 'talk', this.game, o.id, t.id);
    if (!r) this.log.push({ who: 'note', text: 'Разговор не клеится.' });
    else {
      this.push(r.lines);
      const eff = r.effects && typeof r.effects === 'object' ? Object.entries(r.effects).filter(([, v]) => typeof v === 'number' && v) : [];
      if (eff.length) this.log.push({ who: 'eff', eff });
    }
    this.refresh();
    this.scrollDown();
  }
  choose(c) {
    const st = this.game?.station;
    this.usedChoices.add(c.id);
    this.log.push({ who: 'me', text: c.label });
    const r = call(st, 'talkChoice', this.params.actor || this.params.actorId, c.id);
    if (r && r.lines) this.push(r.lines);
    if (r && Array.isArray(r.choices)) this.choices = r.choices;
    const os = r?.openScreen;
    if (os) {
      const id = typeof os === 'string' ? os : os.id, params = typeof os === 'string' ? {} : (os.params || {});
      this.ui.open(id, { ...params, replace: true });
      return;
    }
    if (r && (r.close || r.end)) { this.close(); return; }
    this.refresh();
    this.scrollDown();
  }
  scrollDown() { requestAnimationFrame(() => { const s = this.root?.querySelector('[data-scroll="talk"]'); if (s) s.scrollTop = s.scrollHeight; }); }
  render() {
    const o = this.o, a = this.params.actor;
    const who = o || (a ? { id: a.id, gender: a.look?.gender, look: a.look } : {});
    const lines = this.log.map((l) => {
      if (l.who === 'eff') return h('div.chips', { style: 'margin:.2em 0 .5em' }, l.eff.map(([k, v]) => h('span.chip.' + (v > 0 === !['fatigue', 'stress'].includes(k) ? 'good' : 'bad'), `${EFFECT_NAMES[k] || k} ${v > 0 ? '+' : '−'}${Math.abs(Math.round(v))}`)));
      if (l.who === 'note') return h('div.small.dim', { style: 'font-style:italic;margin:.3em 0' }, l.text);
      return h('div.say.' + (l.who === 'me' ? 'me' : 'them'), l.who === 'me' ? h('b', 'Вы: ') : (l.name ? h('b', l.name + ': ') : null), l.text);
    });
    const choiceBtns = this.choices ? this.choices.map((c) => h('button.choice', { type: 'button', 'data-choice': c.id, disabled: c.once && this.usedChoices.has(c.id), onclick: (e) => { e.stopPropagation(); this.ui.sfx('ui_click'); this.choose(c); } }, h('b', c.label), c.desc ? h('span', c.desc) : null)) : [];
    const topics = o && ['station', 'home', 'task'].includes(o.status) ? TALK_TOPICS.filter((t) => t.id !== 'drinking' || (o.traits || []).includes('drinker') || o.hidden?.addiction === 'alcohol').map((t) =>
      btn(t.label, () => this.topic(t), { cls: 'slim', act: 'topic-' + t.id, disabled: this.used.has(t.id) })) : [];
    const left = h('div.int-who', { style: 'width:clamp(8em,24%,12em);color:inherit' },
      h('div.photo', portraitImg(who, { scale: 1.9, kind: o ? 'officer' : 'visitor' })),
      h('b', this.name),
      o ? h('div.small.dim', ROLE_NAMES[o.role] || '') : null,
      o ? h('div.col', { style: 'gap:.15em' }, bar(o.morale, 'good', 'Мораль', { thin: true }), bar(o.loyalty, 'good', 'Лояльность', { thin: true }), bar(o.fatigue, 'bad', 'Усталость', { thin: true })) : null,
      o ? h('div.chips', (o.traits || []).map((id) => h('span.chip.' + traitTone(id), traitInfo(this.game, id).name))) : null);
    const right = h('div.col.grow', { style: 'min-width:0;min-height:0;gap:.4em' },
      h('div.scroll.grow.lined', { 'data-scroll': 'talk', style: 'padding:.2em .6em;border:1px solid rgba(36,33,28,.2);background-color:rgba(255,255,255,.2)' }, lines),
      choiceBtns.length ? h('div.choices', { style: 'max-height:40%;overflow:auto' }, choiceBtns) : null,
      topics.length ? h('div.btns', topics) : null);
    return this.frame({
      title: 'Разговор', sub: this.name, cls: 'mid',
      body: h('div.row.grow', { style: 'align-items:stretch;gap:.9em;padding:.6em .8em;min-height:0' }, left, right),
      foot: [o ? btn('Личное дело', () => this.ui.open('officer', { id: o.id }), { cls: 'slim', act: 'dossier' }) : null, h('div.sp'), btn('Закончить', () => this.close(), { act: 'close' })],
    });
  }
  afterRender() { this.scrollDown(); }
}
