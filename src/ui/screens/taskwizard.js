// Мастер нового задания наряду: тип → место/цель → состав → транспорт → приказы → оценка → «Приказываю».
import { h, btn, seg, toggle, bar, txt, call, dur, hhmm, pn, stamp, sfx } from '../dom.js';
import { portraitImg } from '../portrait.js';
import {
  TASK_TYPES_FALLBACK, ORDERS_GENERAL, ORDERS_DETAIL, ORDER_DETAILS, TYPE_ORDERS, DURATIONS, RETURN_AT, ROLE_SHORT, WEAPON_NAMES,
  ARMOR_NAMES, SKILL_SHORT, traitInfo, traitTone, rankShort, rankName, normOptionDefs, CRIME_CATS, RANK_ORDER,
} from '../labels.js';
import { MapView } from './citymap.js';

const STEPS = [
  { id: 'type', label: 'Задание' }, { id: 'place', label: 'Место' }, { id: 'squad', label: 'Состав' },
  { id: 'vehicle', label: 'Транспорт' }, { id: 'orders', label: 'Приказ' }, { id: 'check', label: 'Оценка' },
];
const REL_SKILLS = {
  patrol: ['perception', 'talk'], guard: ['perception', 'discipline'], ambush: ['tactics', 'perception'], raid: ['shooting', 'tactics'],
  investigate: ['investigation', 'talk'], respond: ['shooting', 'driving'], escort: ['shooting', 'discipline'], search: ['investigation', 'perception'],
};
export function rankIdx(r) { const k = RANK_ORDER.indexOf(rankName(r)); return k < 0 ? 0 : k; }
export function docRank(r) { return rankName(r).replace(/^старший /, 'ст. ').replace(/^младший /, 'мл. '); }
export function initials(o) { return `${o.lastName} ${(o.firstName || ' ')[0]}. ${(o.patronymic || ' ')[0]}.`; }

export class TaskWizard {
  constructor(screen, preset = {}) {
    this.scr = screen; this.ui = screen.ui; this.game = screen.game;
    const raw = call(this.city, 'taskTypes', this.game);
    this.types = (Array.isArray(raw) && raw.length ? raw : TASK_TYPES_FALLBACK).map((t) => ({ ...TASK_TYPES_FALLBACK.find((f) => f.id === t.id), ...t }));
    this.spec = {
      type: null, districtId: preset.districtId || null, targetId: null, targetKind: null,
      officerIds: [], leaderId: null, vehicle: 'auto', orders: {}, details: {}, durationMin: 240, returnAt: 'none', note: '',
    };
    this.detailOpen = false;
    this.step = 0;
    if (preset.type) this.setType(preset.type, false);
    if (preset.targetCrimeId) { this.spec.targetId = preset.targetCrimeId; this.spec.targetKind = 'crime'; }
    if (preset.placeId) { this.spec.targetId = preset.placeId; this.spec.targetKind = 'place'; }
    if (preset.targetGangId) { this.spec.targetId = preset.targetGangId; this.spec.targetKind = 'gang'; }
    if (preset.type) {
      this.step = preset.step ?? 1;
      while (this.step > 0 && !this.valid(this.step - 1).ok) this.step--;
      if (this.step >= 2 && !this.spec.officerIds.length) this.autoPick(true);
      if (this.step >= 3) this.autoVehicle();
    }
  }
  get city() { return this.game?.sim?.city; }
  get state() { return this.game?.state || {}; }
  typeDef() { return this.types.find((t) => t.id === this.spec.type); }

  setType(id, reset = true) {
    const sp = this.spec;
    if (reset && sp.type !== id) { sp.targetId = null; sp.targetKind = null; }
    sp.type = id;
    // приказы по умолчанию
    const o = {};
    for (const d of this.generalDefs()) o[d.key] = d.def;
    for (const d of ORDERS_DETAIL) o[d.key] = d.def;
    for (const d of this.typeDefs()) o[d.key] = d.def;
    if (id === 'raid' || id === 'respond') { o.stance = 'normal'; }
    if (id === 'ambush') { o.detain = 'serious'; o.respondCalls = false; }
    if (id === 'investigate' || id === 'search') { o.force = 'proportional'; o.respondCalls = false; }
    if (id === 'guard') o.respondCalls = false;
    sp.orders = { ...o, ...Object.fromEntries(Object.entries(sp.orders).filter(([k]) => k in o && sp.type === id && !reset)) };
    const det = {};
    for (const d of ORDER_DETAILS) det[d.key] = d.def;
    if (id === 'ambush') { det.dress = 'civil'; det.siren = 'never'; det.radioSilence = true; det.vehicleUse = 'drop'; }
    if (id === 'respond') det.siren = 'always';
    if (id === 'raid') { det.cuffs = 'always'; det.backup = 'early'; }
    if (id === 'patrol') det.vehicleUse = 'patrol';
    sp.details = det;
    const t = this.typeDef();
    sp.durationMin = t?.defaultDuration ?? ({ patrol: 240, guard: 360, ambush: 360, raid: 120, investigate: 240, respond: 120, escort: 120, search: 240 })[id] ?? 240;
    const max = t?.maxOfficers ?? 4;
    if (sp.officerIds.length > max) { sp.officerIds = sp.officerIds.slice(0, max); if (!sp.officerIds.includes(sp.leaderId)) sp.leaderId = this.bestLeader(sp.officerIds); }
  }
  generalDefs() {
    const t = this.typeDef();
    const strs = (t?.orderOptions || []).filter((x) => typeof x === 'string');
    const keys = new Set(strs.map((s) => s.split(':')[0]));
    const general = ORDERS_GENERAL.map((d) => ({ ...d, type: d.type || 'enum' }));
    if (keys.size && general.some((d) => keys.has(d.key))) return general.filter((d) => keys.has(d.key));
    return general;
  }
  typeDefs() {
    const t = this.typeDef(); if (!t) return [];
    const objs = normOptionDefs((t.orderOptions || []).filter((x) => x && typeof x === 'object'));
    const general = new Set([...ORDERS_GENERAL, ...ORDERS_DETAIL].map((d) => d.key));
    const own = objs.filter((d) => !general.has(d.key));
    if (own.length) return own.map((d) => ({ ...(TYPE_ORDERS[t.id] || []).find((x) => x.key === d.key), ...d, options: d.options?.map((o) => ({ ...(TYPE_ORDERS[t.id] || []).find((x) => x.key === d.key)?.options?.find((q) => String(q.id) === String(o.id)), ...o })) }));
    return TYPE_ORDERS[t.id] || [];
  }

  // ——— данные ———
  officers() { return this.state.staff || []; }
  officer(id) { return this.officers().find((o) => o.id === id); }
  available() {
    const a = call(this.game?.sim?.staff, 'available', this.game);
    return Array.isArray(a) ? a : this.officers().filter((o) => o.status === 'station' && o.onShift && !o.taskId);
  }
  offShift() { const av = new Set(this.available().map((o) => o.id)); return this.officers().filter((o) => o.status === 'station' && !o.onShift && !av.has(o.id)); }
  district(id = this.spec.districtId) { return (this.state.city?.districts || []).find((d) => d.id === id); }
  targets() {
    const sp = this.spec, t = this.typeDef(); if (!t || !sp.districtId) return [];
    const v = call(this.city, 'validTargets', this.game, sp.type, sp.districtId);
    if (Array.isArray(v)) return v;
    const d = this.district();
    if (t.needsTarget) return (this.state.city?.crimes || []).filter((c) => c.districtId === sp.districtId && c.status !== 'resolved').map((c) => ({ id: c.id, name: txt(c.title), desc: c.place?.name || '' }));
    return (d?.places || []).filter((p) => sp.type !== 'guard' || p.guardable !== false).map((p) => ({ id: p.id, name: p.name, desc: p.kind || '' }));
  }
  kindOf(item) {
    if (item.kind === 'place' || item.kind === 'crime' || item.kind === 'gang') return item.kind;
    if (this.district()?.places?.some((p) => p.id === item.id)) return 'place';
    if ((this.state.city?.crimes || []).some((c) => c.id === item.id)) return 'crime';
    if ((this.state.city?.gangs || []).some((g) => g.id === item.id)) return 'gang';
    return this.typeDef()?.needsTarget ? 'crime' : 'place';
  }
  targetName() {
    const sp = this.spec; if (!sp.targetId) return null;
    const it = this.targets().find((x) => x.id === sp.targetId);
    if (it) return it.name;
    if (sp.targetKind === 'place') return this.district()?.places?.find((p) => p.id === sp.targetId)?.name;
    if (sp.targetKind === 'crime') return txt((this.state.city?.crimes || []).find((c) => c.id === sp.targetId)?.title);
    if (sp.targetKind === 'gang') return (this.state.city?.gangs || []).find((g) => g.id === sp.targetId)?.name;
    return sp.targetId;
  }
  score(o) {
    const rel = REL_SKILLS[this.spec.type] || ['tactics', 'perception'];
    const sk = rel.reduce((a, k) => a + (o.skills?.[k] ?? 50), 0) / rel.length;
    return sk - (o.fatigue ?? 0) * 0.45 + (o.hp ?? 100) * 0.15 + (o.morale ?? 50) * 0.1 + (o.equipment?.weapon && o.equipment.weapon !== 'none' ? 6 : -10);
  }
  bestLeader(ids) {
    let best = null, bs = -1e9;
    for (const id of ids) { const o = this.officer(id); if (!o) continue; const s = rankIdx(o.rank) * 9 + (o.skills?.tactics ?? 40) * 0.6 + (o.traits?.includes('leader') ? 30 : 0) + (o.traits?.includes('rookie') ? -20 : 0); if (s > bs) { bs = s; best = id; } }
    return best;
  }
  autoPick(quiet) {
    const t = this.typeDef(); if (!t) return;
    const pool = this.available().slice().sort((a, b) => this.score(b) - this.score(a));
    const want = Math.min(t.maxOfficers ?? 4, Math.max(t.minOfficers ?? 1, Math.min((t.minOfficers ?? 1) + 1, t.maxOfficers ?? 4)));
    const ids = pool.slice(0, want).map((o) => o.id);
    // если есть водитель и нужна машина — пусть он будет в составе
    const drv = pool.find((o) => o.role === 'driver');
    if (drv && !ids.includes(drv.id) && ids.length >= 2 && ids.length >= (t.minOfficers ?? 1)) ids[ids.length - 1] = drv.id;
    this.spec.officerIds = ids; this.spec.leaderId = this.bestLeader(ids);
    if (!quiet) this.ui.toast(ids.length ? `Подобрано: ${ids.length}` : 'Свободных людей на смене нет', ids.length ? 'info' : 'warn');
  }
  autoVehicle() {
    if (this.spec.vehicle !== 'auto') return;
    const v = (this.state.economy?.vehicles || []).find((x) => x.status === 'station' && (x.condition ?? 100) > 10);
    this.spec.vehicle = v ? v.id : null;
  }

  // ——— навигация ———
  valid(step) {
    const sp = this.spec, t = this.typeDef();
    switch (STEPS[step].id) {
      case 'type': return t ? { ok: true } : { ok: false, why: 'Выберите вид задания' };
      case 'place':
        if (!sp.districtId) return { ok: false, why: 'Выберите район' };
        if ((t?.needsPlace || t?.needsTarget) && !sp.targetId) return { ok: false, why: t.needsTarget ? 'Укажите цель' : 'Укажите место' };
        return { ok: true };
      case 'squad': {
        const n = sp.officerIds.length, mn = t?.minOfficers ?? 1, mx = t?.maxOfficers ?? 6;
        if (n < mn) return { ok: false, why: `Нужно не меньше ${pn(mn, ['человека', 'человек', 'человек'])}` };
        if (n > mx) return { ok: false, why: `Не больше ${pn(mx, ['человека', 'человек', 'человек'])}` };
        if (!sp.leaderId || !sp.officerIds.includes(sp.leaderId)) return { ok: false, why: 'Назначьте старшего (★)' };
        return { ok: true };
      }
      default: return { ok: true };
    }
  }
  go(step) {
    if (step > this.step) for (let i = this.step; i < step; i++) { const v = this.valid(i); if (!v.ok) { this.ui.toast(v.why, 'warn'); return; } }
    this.step = step;
    if (STEPS[step].id === 'squad' && !this.spec.officerIds.length) this.autoPick(true);
    if (STEPS[step].id === 'vehicle') this.autoVehicle();
    if (STEPS[step].id === 'check') this.est = null;
    this.scr.refresh();
    const sc = this.scr.root?.querySelector('[data-scroll="wiz"]'); if (sc) sc.scrollTop = 0;
  }
  back() { if (this.step > 0) { this.go(this.step - 1); return true; } return false; }

  // ——— отрисовка ———
  render() {
    const t = this.typeDef();
    const steps = h('div.wiz-steps', STEPS.map((s, i) => h('button.wiz-step' + (i === this.step ? '.on' : i < this.step ? '.done' : ''), {
      type: 'button', 'data-step': i, onclick: (e) => { e.stopPropagation(); sfx('ui_click'); this.go(i); },
    }, h('b', String(i + 1)), i === this.step || window.innerWidth > 900 ? s.label : null)));
    const v = this.valid(this.step);
    const last = this.step === STEPS.length - 1;
    const body = this['step_' + STEPS[this.step].id]();
    const foot = [
      btn(this.step ? '‹ Назад' : 'Отмена', () => { if (this.step) this.go(this.step - 1); else this.scr.endWizard(false); }, { act: 'wiz-back' }),
      h('div.sp.small.dim', { style: 'text-align:center' }, v.ok ? (t ? `${t.name}${this.spec.districtId ? ' · ' + (this.district()?.name || '') : ''}${this.spec.officerIds.length ? ' · ' + pn(this.spec.officerIds.length, ['чел.', 'чел.', 'чел.']) : ''}` : '') : h('span.t-bad', v.why)),
      last ? btn('Приказываю', () => this.submit(), { cls: 'primary big', act: 'wiz-submit', sound: 'ui_stamp' })
        : btn('Далее ›', () => this.go(this.step + 1), { cls: 'primary', act: 'wiz-next', disabled: !v.ok }),
    ];
    return this.scr.frame({ title: 'Новое задание', sub: false, head: steps, body, foot, formNo: 'Форма № 7-Н' });
  }
  afterRender() {
    if (this.miniCv) {
      this.mini = new MapView(this.miniCv, this.game, { mini: true, selected: this.spec.districtId, onPick: (id) => { if (id !== this.spec.districtId) { this.spec.districtId = id; this.spec.targetId = null; this.spec.targetKind = null; sfx('ui_paper'); this.scr.refresh(); } } });
      requestAnimationFrame(() => this.mini?.draw(0));
    }
  }
  tick(dt) { this._a = (this._a || 0) + dt; if (this.mini && this._a > 0.1) { this.mini.draw(this._a); this._a = 0; } }

  step_type() {
    this.miniCv = null;
    return h('div.scroll.grow.pad', { 'data-scroll': 'wiz' },
      h('div.small.dim.mb', 'Что поручить наряду? Подробности — на следующих шагах.'),
      h('div.cards', this.types.map((t) => h('button.card' + (t.id === this.spec.type ? '.sel' : ''), {
        type: 'button', 'data-type': t.id,
        onclick: (e) => { e.stopPropagation(); sfx('ui_click'); this.setType(t.id); this.scr.refresh(); setTimeout(() => { if (this.step === 0 && this.spec.type === t.id) this.go(1); }, 160); },
      },
      h('div.card-t', t.name), h('div.card-d', t.desc || ''),
      h('div.card-m', `Состав: ${t.minOfficers ?? 1}–${t.maxOfficers ?? 4} чел.${t.needsPlace ? ' · нужно место' : ''}${t.needsTarget ? ' · нужна цель' : ''}`)))));
  }
  step_place() {
    const sp = this.spec, t = this.typeDef(), ds = this.state.city?.districts || [];
    this.miniCv = h('canvas');
    const left = h('div.pane.l', { style: 'flex:1 1 50%' },
      h('div.map-wrap', this.miniCv),
      h('div', { style: 'padding:.35em .5em;border-top:1px solid rgba(36,33,28,.25)' },
        seg(ds.map((d) => ({ id: d.id, label: d.name })), sp.districtId, (id) => { sp.districtId = id; sp.targetId = null; sp.targetKind = null; this.scr.refresh(); }, { wrap: true, small: true, act: 'district' })));
    let right;
    if (!sp.districtId) right = h('div.empty', 'Выберите район на карте или кнопкой под ней.');
    else {
      const list = this.targets();
      const need = t?.needsPlace || t?.needsTarget;
      const title = t?.needsTarget ? 'Цель задания' : t?.needsPlace ? 'Место' : 'Место (необязательно)';
      right = [
        h('div.sect', title),
        !need ? h('div.note.mb', 'Наряд работает по всему району. Можно указать точку, на которую обратить особое внимание.') : null,
        list.length ? h('div.list', list.map((it) => {
          const on = sp.targetId === it.id;
          return h('div.li' + (on ? '.sel' : ''), { 'data-target': it.id, onclick: () => { sfx('ui_click'); if (on && !need) { sp.targetId = null; sp.targetKind = null; } else { sp.targetId = it.id; sp.targetKind = this.kindOf(it); } this.scr.refresh(); } },
            h('div.check'), h('div.li-main', h('div.li-t', { style: 'white-space:normal' }, it.name), it.desc ? h('div.li-s', { style: 'white-space:normal' }, this.descOf(it)) : null));
        })) : h('div.empty', t?.needsTarget ? 'В этом районе нет подходящих целей. Попробуйте другой район.' : 'Подходящих мест нет.'),
      ];
    }
    return h('div.split', left, h('div.pane.r.scroll.pad', { 'data-scroll': 'wiz' }, right));
  }
  descOf(it) {
    const kinds = { kiosk: 'ларёк', shop: 'магазин', bank: 'банк', school: 'школа', bar: 'бар', flat: 'квартира', garage: 'гаражи', warehouse: 'склад', street: 'улица', park: 'парк', station: 'вокзал', factory: 'завод', market: 'рынок', dacha: 'дачи', hostel: 'общежитие', church: 'церковь', office: 'контора', hospital: 'больница' };
    return kinds[it.desc] || CRIME_CATS[it.desc] || it.desc;
  }
  step_squad() {
    this.miniCv = null;
    const sp = this.spec, t = this.typeDef();
    const av = this.available();
    const offs = this.offShift();
    const rel = REL_SKILLS[sp.type] || [];
    const lead = this.officer(sp.leaderId);
    const groups = this.state.defense?.groups || [];
    const row = (o, enabled = true) => {
      const on = sp.officerIds.includes(o.id);
      const warn = [];
      if ((o.fatigue ?? 0) >= 75) warn.push(o.gender === 'f' ? 'вымотана' : 'вымотан');
      if ((o.hp ?? 100) < 60) warn.push(o.gender === 'f' ? 'ранена' : 'ранен');
      if (!o.equipment?.weapon || o.equipment.weapon === 'none') warn.push('без оружия');
      const grp = groups.find((g) => g.id === o.groupId || (g.memberIds || []).includes(o.id) || g.leaderId === o.id);
      const eq = o.equipment || {};
      return h('div.li.pers-row' + (on ? '.sel' : '') + (enabled ? '' : '.off'), {
        'data-officer': o.id,
        onclick: () => { if (!enabled) return; sfx('ui_click'); this.toggleOfficer(o.id); },
      },
      enabled ? h('div.check') : null,
      portraitImg(o, { scale: 0.85 }),
      h('div.li-main',
        h('div.li-t', `${rankShort(o.rank)} ${initials(o)}`),
        h('div.li-s', `${ROLE_SHORT[o.role] || o.role || ''} · ${WEAPON_NAMES[eq.weapon] || 'без оружия'}${eq.ammo != null ? ` (${eq.ammo})` : ''}${eq.armor && eq.armor !== 'none' ? ' · ' + ARMOR_NAMES[eq.armor] : ''}${eq.radio ? ' · рация' : ''}`),
        h('div.chips', { style: 'margin-top:.15em' },
          (o.traits || []).slice(0, 3).map((id) => h('span.chip.' + traitTone(id), traitInfo(this.game, id).name)),
          warn.map((w) => h('span.chip.red', w)), grp ? h('span.chip', `оборона: ${grp.name}`) : null)),
      h('div.bars3', { style: 'width:min(10.5em,22vw);flex:0 0 auto' },
        h('span.tiny.dim', 'Уст'), bar(o.fatigue, 'bad', null, { thin: true }),
        h('span.tiny.dim', 'Дух'), bar(o.morale, 'good', null, { thin: true }),
        h('span.tiny.dim', 'Здр'), bar(o.hp, 'good', null, { thin: true }),
        rel.length ? h('span.tiny.dim', { style: 'grid-column:1/3' }, rel.map((k) => `${SKILL_SHORT[k]} ${Math.round(o.skills?.[k] ?? 0)}`).join(' · ')) : null),
      enabled ? h('button.star' + (sp.leaderId === o.id ? '.on' : ''), {
        type: 'button', title: 'Назначить старшим', 'data-leader': o.id,
        onclick: (e) => { e.stopPropagation(); sfx('ui_click'); if (!sp.officerIds.includes(o.id)) this.toggleOfficer(o.id, true); sp.leaderId = o.id; this.scr.refresh(); },
      }, '★') : btn('На смену', () => { call(this.game?.sim?.staff, 'setShift', this.game, o.id, true); this.ui.toast(`${initials(o)} — вызван${o.gender === 'f' ? 'а' : ''} на смену`, 'info'); this.scr.refresh(); }, { cls: 'slim', act: 'shift-' + o.id }));
    };
    return h('div.scroll.grow', { 'data-scroll': 'wiz' },
      h('div.pad', { style: 'padding-bottom:.2em' },
        h('div.row.wrap',
          h('div.grow', h('b', `Выбрано: ${sp.officerIds.length}`), h('span.dim', ` (нужно ${t?.minOfficers ?? 1}–${t?.maxOfficers ?? 4})`), h('br'),
            h('span.small', 'Старший: '), h('b.small', lead ? `${rankShort(lead.rank)} ${lead.lastName}` : '— нажмите ★')),
          btn('Подобрать', () => { this.autoPick(false); this.scr.refresh(); }, { cls: 'slim', act: 'autopick' }),
          sp.officerIds.length ? btn('Сбросить', () => { sp.officerIds = []; sp.leaderId = null; this.scr.refresh(); }, { cls: 'slim ghost', act: 'clear' }) : null),
        rel.length ? h('div.tiny.dim', `Для задания важны: ${rel.map((k) => ({ shooting: 'стрельба', tactics: 'тактика', perception: 'наблюдательность', discipline: 'дисциплина', talk: 'общение', investigation: 'розыск', driving: 'вождение', fitness: 'физподготовка' })[k]).join(', ')}.`) : null),
      av.length ? h('div.list', av.map((o) => row(o))) : h('div.empty', 'На участке нет свободных сотрудников на смене.'),
      offs.length ? [h('div.sect', { style: 'margin:.8em .9em .3em' }, 'Вне смены (на участке)'), h('div.list', offs.map((o) => row(o, false)))] : null);
  }
  toggleOfficer(id, forceOn) {
    const sp = this.spec, t = this.typeDef();
    const on = sp.officerIds.includes(id);
    if (on && !forceOn) { sp.officerIds = sp.officerIds.filter((x) => x !== id); if (sp.leaderId === id) sp.leaderId = this.bestLeader(sp.officerIds); }
    else if (!on) {
      if (sp.officerIds.length >= (t?.maxOfficers ?? 6)) { this.ui.toast(`Для этого задания — не больше ${t?.maxOfficers ?? 6}`, 'warn'); return; }
      sp.officerIds.push(id); if (!sp.leaderId) sp.leaderId = this.bestLeader(sp.officerIds);
    }
    this.scr.refresh();
  }
  step_vehicle() {
    const sp = this.spec, veh = this.state.economy?.vehicles || [];
    const fuel = this.state.economy?.fuel;
    const sq = sp.officerIds.map((id) => this.officer(id)).filter(Boolean);
    const driver = sq.find((o) => o.role === 'driver') || sq.slice().sort((a, b) => (b.skills?.driving ?? 0) - (a.skills?.driving ?? 0))[0];
    const stName = { station: 'у отделения', task: 'на выезде', repair: 'в ремонте', destroyed: 'списана' };
    return h('div.scroll.grow.pad', { 'data-scroll': 'wiz' },
      h('div.cards', { style: 'grid-template-columns:repeat(auto-fill,minmax(14em,1fr))' },
        veh.map((v) => {
          const ok = v.status === 'station';
          return h('button.card' + (sp.vehicle === v.id ? '.sel' : '') + (ok ? '' : '.dis'), {
            type: 'button', 'data-vehicle': v.id, onclick: (e) => { e.stopPropagation(); if (!ok) return; sfx('ui_click'); sp.vehicle = v.id; this.scr.refresh(); },
          }, h('div.card-t', v.name || v.id), bar(v.condition ?? 100, 'good', 'состояние'), h('div.card-m', stName[v.status] || v.status));
        }),
        h('button.card' + (sp.vehicle === null ? '.sel' : ''), { type: 'button', 'data-vehicle': 'none', onclick: (e) => { e.stopPropagation(); sfx('ui_click'); sp.vehicle = null; this.scr.refresh(); } },
          h('div.card-t', 'Пешим порядком'), h('div.card-d', 'Медленнее и только ближние районы. Бензин не тратится, машина остаётся для срочных вызовов.'))),
      h('div.mt.small', fuel != null ? `Бензин на складе: ${Math.round(fuel)} л. ` : '', sp.vehicle && driver ? `За рулём: ${rankShort(driver.rank)} ${driver.lastName}${driver.role === 'driver' ? ' (водитель)' : ` (вождение ${Math.round(driver.skills?.driving ?? 0)})`}.` : ''),
      sp.vehicle && fuel != null && fuel < 20 ? h('div.note.warn.mt', 'Бензина почти нет — машина может встать посреди задания.') : null);
  }
  optRow(d, obj) {
    const desc = h('div.od', d.options?.find((o) => String(o.id) === String(obj[d.key]))?.desc || d.desc || '');
    const hasOpts = Array.isArray(d.options) && d.options.length > 0;
    if (d.type !== 'bool' && !hasOpts) return null; // служебное поле без вариантов — в редакторе не показываем
    const ctl = d.type === 'bool'
      ? toggle(!!obj[d.key], (v) => { obj[d.key] = v; }, { act: 'opt-' + d.key })
      : seg(d.options, obj[d.key], (v, o) => { obj[d.key] = v; desc.textContent = (o && o.desc) || d.desc || ''; }, { wrap: d.options.length > 3, small: true, act: 'opt-' + d.key });
    return h('div.opt-row', h('div.ol', d.label), h('div', ctl), desc);
  }
  step_orders() {
    const sp = this.spec, o = sp.orders;
    const det = h('details.details' + '', { open: this.detailOpen },
      h('summary', { 'data-act': 'details', onclick: () => { this.detailOpen = !det.open; sfx('ui_paper'); } }, 'Уточнить детально'),
      h('div.small.dim', 'Как именно выполнять. Старший наряда учтёт это вместе со своим характером.'),
      ORDERS_DETAIL.map((d) => this.optRow(d, o)),
      ORDER_DETAILS.map((d) => this.optRow(d, sp.details)),
      h('div.opt-row', h('div.ol', 'Примечание'), h('div', { style: 'grid-column:2' }, (() => { const ta = h('textarea.inp', { rows: 3, maxlength: 400, placeholder: 'Например: водителя от машины не отпускать; к ларьку у остановки подойти первым делом; Рыжего брать живым.', 'data-act': 'note' }); ta.value = sp.note || ''; ta.addEventListener('input', () => { sp.note = ta.value; }); ta.addEventListener('keydown', (e) => e.stopPropagation()); return ta; })())),
    );
    const typeDefs = this.typeDefs();
    return h('div.scroll.grow.pad', { 'data-scroll': 'wiz' },
      h('div.sect', 'Общие указания'),
      this.generalDefs().map((d) => this.optRow(d, o)),
      typeDefs.length ? [h('div.sect', this.typeDef()?.name || 'Задание'), typeDefs.map((d) => this.optRow(d, o))] : null,
      h('div.sect', 'Сроки'),
      h('div.opt-row', h('div.ol', 'Продолжительность'), seg(DURATIONS, sp.durationMin, (v) => { sp.durationMin = v; }, { small: true, act: 'duration' })),
      h('div.opt-row', h('div.ol', 'Вернуться'), seg(RETURN_AT, sp.returnAt, (v) => { sp.returnAt = v; }, { small: true, wrap: true, act: 'return' }), h('div.od', 'Если указано время — наряд вернётся к нему, даже если задание не закончено.')),
      det);
  }
  buildSpec() {
    const sp = this.spec;
    const orders = { ...sp.orders, durationMin: sp.durationMin, returnAt: sp.returnAt === 'none' ? null : Number(sp.returnAt), note: (sp.note || '').trim(), details: { ...sp.details } };
    return {
      type: sp.type, districtId: sp.districtId,
      placeId: sp.targetKind === 'place' ? sp.targetId : null,
      targetCrimeId: sp.targetKind === 'crime' ? sp.targetId : null,
      targetGangId: sp.targetKind === 'gang' ? sp.targetId : null,
      officerIds: sp.officerIds.slice(), leaderId: sp.leaderId,
      vehicle: sp.vehicle === 'auto' ? null : sp.vehicle,
      durationMin: sp.durationMin, orders,
    };
  }
  warnings() {
    const sp = this.spec, out = [];
    const sq = sp.officerIds.map((id) => this.officer(id)).filter(Boolean);
    const tired = sq.filter((o) => (o.fatigue ?? 0) >= 75); if (tired.length) out.push(`Вымотаны: ${tired.map((o) => o.lastName).join(', ')} — будут ошибаться.`);
    const noW = sq.filter((o) => !o.equipment?.weapon || o.equipment.weapon === 'none'); if (noW.length) out.push(`Без оружия: ${noW.map((o) => o.lastName).join(', ')}. Выдайте в оружейке.`);
    if (!sq.some((o) => o.equipment?.radio)) out.push('Ни у кого нет рации — докладов не будет, запросы не дойдут.');
    if (['raid', 'respond', 'ambush'].includes(sp.type) && !sq.some((o) => o.equipment?.armor && o.equipment.armor !== 'none')) out.push('На опасное задание — без бронежилетов.');
    if (sq.length && sq.every((o) => (o.traits || []).includes('rookie'))) out.push('В наряде одни салаги.');
    const lead = this.officer(sp.leaderId); if (lead && (lead.traits || []).includes('hothead') && sp.orders.stance === 'aggressive') out.push(`${lead.lastName} — горячая голова, а приказ «жёстко»: жди стрельбы.`);
    if (lead && (lead.traits || []).includes('coward') && ['raid', 'respond'].includes(sp.type)) out.push(`${lead.lastName} — трус. Старшим на силовое задание лучше поставить другого.`);
    return out;
  }
  orderText(spec) {
    const s = this.state, p = s.player || {};
    const sq = spec.officerIds.map((id) => this.officer(id)).filter(Boolean);
    const lead = this.officer(spec.leaderId);
    const veh = (s.economy?.vehicles || []).find((v) => v.id === spec.vehicle);
    const d = this.district();
    const t = this.typeDef();
    const tgt = this.targetName();
    const optLabel = (defs, key, val) => defs.find((x) => x.key === key)?.options?.find((o) => String(o.id) === String(val))?.label;
    const stanceTxt = { cautious: 'Действовать осторожно, на рожон не лезть.', normal: 'Действовать по обстановке и по уставу.', aggressive: 'Действовать жёстко и решительно.' }[spec.orders.stance] || '';
    const forceTxt = { return_fire: 'Оружие применять только в ответ на огонь.', proportional: 'Оружие применять соразмерно угрозе, в соответствии с законом.', free: 'Применение оружия — по решению старшего.' }[spec.orders.force] || '';
    const detTxt = { all: 'Задерживать всех подозрительных.', serious: 'Задерживать по тяжким составам, по мелочи — протокол на месте.', none: 'Никого не задерживать, только наблюдать и докладывать.' }[spec.orders.detain] || '';
    const focus = this.typeDefs().map((dd) => optLabel(this.typeDefs(), dd.key, spec.orders[dd.key]) ? `${dd.label.toLowerCase()} — ${optLabel(this.typeDefs(), dd.key, spec.orders[dd.key]).toLowerCase()}` : null).filter(Boolean);
    const extra = ORDER_DETAILS.filter((dd) => String(spec.orders.details[dd.key]) !== String(dd.def)).map((dd) => dd.type === 'bool' ? `${dd.label.toLowerCase()}: ${spec.orders.details[dd.key] ? 'да' : 'нет'}` : `${dd.label.toLowerCase()} — ${optLabel(ORDER_DETAILS, dd.key, spec.orders.details[dd.key])}`);
    const lines = [];
    lines.push('Наряду в составе:');
    sq.forEach((o, i) => lines.push(`  ${docRank(o.rank)} ${initials(o)}${o.id === spec.leaderId ? ' — старший' : ''}${i === sq.length - 1 ? '' : ';'}`));
    lines.push(veh ? `на автомашине ${veh.name || veh.id}` : 'пешим порядком');
    lines.push(`выдвинуться: ${d?.name || '—'}${tgt ? `, ${spec.placeId ? (d?.places?.find((q) => q.id === spec.placeId)?.prep || tgt) : tgt}` : ''}.`);
    lines.push(`Задача: ${String(t?.name || spec.type || 'по обстановке').toLowerCase()}${focus.length ? '; ' + focus.join('; ') : ''}.`);
    lines.push([stanceTxt, forceTxt, detTxt].filter(Boolean).join(' '));
    lines.push(`Доклад — ${spec.orders.reportEvery === 30 ? 'каждые 30 минут' : spec.orders.reportEvery === 120 ? 'раз в два часа' : 'каждый час'}.${spec.orders.respondCalls ? ' На вызовы по пути откликаться.' : ''}${spec.orders.retreatOnWounded ? ' При ранении сотрудника — прекратить и вернуться.' : ''}`);
    lines.push(spec.orders.returnAt != null ? `Вернуться к ${hhmm(spec.orders.returnAt)}.` : `Продолжительность — ${dur(spec.durationMin)}.`);
    if (extra.length) lines.push(`Особые указания: ${extra.join('; ')}.`);
    if (spec.orders.note) lines.push(`Примечание: ${spec.orders.note}`);
    lines.push('');
    lines.push(`Начальник ОМ № 14 майор милиции ${p.lastName ? initials(p) : '__________'}`);
    if (lead) lines.push(`С приказом ознакомлен${lead.gender === 'f' ? 'а' : ''}: ${docRank(lead.rank)} ${lead.lastName} ________`);
    return lines.join('\n');
  }
  step_check() {
    const spec = this.buildSpec();
    if (!this.est) this.est = call(this.city, 'estimate', this.game, spec) || null;
    const e = this.est || {};
    const risk = Math.max(0, Math.min(1, Number(e.risk ?? 0.3)));
    const rw = risk < 0.2 ? 'низкий' : risk < 0.4 ? 'умеренный' : risk < 0.6 ? 'высокий' : 'очень высокий';
    const warn = this.warnings();
    const t = this.state.time || { day: 1 };
    this.sheet = h('div.order-sheet.typed',
      h('div.form-h', `ОМ № 14 · ПРИКАЗ № ${t.day}-${String((this.state.city?.tasks || []).length + 1).padStart(2, '0')}`),
      h('div', { style: 'white-space:pre-wrap;margin-top:.4em' }, this.orderText(spec)));
    return h('div.scroll.grow.pad', { 'data-scroll': 'wiz' },
      h('div.row.wrap', { style: 'gap:1.2em;align-items:center' },
        h('div.risk', h('div.risk-g', h('i', { style: { transform: `rotate(${-90 + risk * 180}deg)` } }), h('b')),
          h('div', h('div.tiny.dim.caps', 'Риск'), h('div.risk-v', { class: risk >= 0.6 ? 't-bad' : risk >= 0.4 ? 't-warn' : 't-ok' }, rw), h('div.tiny.dim', `${Math.round(risk * 100)} из 100`))),
        h('div.grow', { style: 'min-width:14em' },
          h('div.tiny.dim.caps', 'Ожидаемый результат'), h('div', txt(e.effect) || (this.city?.estimate ? '—' : 'Оценка недоступна')),
          h('div.small.mt', `Займёт около ${dur(e.durationMin ?? spec.durationMin)}.`))),
      warn.length ? h('div.note.warn.mt', warn.map((w) => h('div', '• ' + w))) : null,
      h('div.mt', this.sheet));
  }
  submit() {
    const v = [0, 1, 2].map((i) => this.valid(i)).find((x) => !x.ok);
    if (v) { this.ui.toast(v.why, 'warn'); return; }
    const spec = this.buildSpec();
    const res = call(this.city, 'createTask', this.game, spec);
    if (!res) { this.ui.toast('Город недоступен — задание не создано', 'bad'); return; }
    if (!res.ok) { this.ui.dialog({ title: 'Приказ не принят', text: res.reason || 'Причина не указана.' }); return; }
    sfx('ui_stamp');
    if (this.sheet) this.sheet.appendChild(stamp('К исполнению', { rot: -10, cls: 'slam', style: { right: '1em', bottom: '1.5em', fontSize: '1.3em' } }));
    const cs = res.task?.callsign;
    this.ui.toast(`${cs ? cs + ': ' : ''}приказ принят. Наряд собирается на выезд.`, 'good');
    this.ui.vibrate(40);
    const sc = this.scr;
    sc.root?.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    setTimeout(() => sc.endWizard(true), 750);
  }
}
