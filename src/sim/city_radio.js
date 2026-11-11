// Эфир: state.radio, запросы решений игроку с таймаутом, автоматическое решение командира.
import { R, fmt, nid, absNow, dmOf, emit, officer, oName, isFem, cap, badText } from './city_util.js';
import { C, task as taskById } from './city_core.js';
import { T, ACTIONS, CHOICE_LABEL } from './city_text.js';

const RADIO_CAP = 250;
const HANDLERS = {};
/** обработчик ответа по meta.type: fn(game, msg, choiceId, auto) */
export function registerHandler(type, fn) { HANDLERS[type] = fn; }

export function pick(game, arr) { return R(game).pick(arr); }

/** добавить сообщение (контракт: city.radio) */
export function radio(game, msg) {
  if (!Array.isArray(game.state.radio)) game.state.radio = [];
  const now = absNow(game);
  const t = dmOf(now);
  const m = {
    id: msg.id || nid(game, 'rm'), day: t.day, minute: t.minute,
    from: msg.from || 'unknown', fromName: msg.fromName || '', callsign: msg.callsign || '',
    text: String(msg.text || '').trim(), kind: msg.kind || 'info', taskId: msg.taskId || null,
    choices: msg.choices && msg.choices.length ? msg.choices : null, answered: null,
    expires: msg.expires || null, autoChoice: msg.autoChoice || null,
  };
  if (msg.meta) m.meta = msg.meta;
  if (!m.text) return null;
  if (C(game) && C(game).silent) return m;
  game.state.radio.push(m);
  if (m.choices && m.expires) C(game).pendingMsgs.push(m.id);
  if (game.state.radio.length > RADIO_CAP) {
    const pend = new Set(C(game).pendingMsgs);
    const drop = game.state.radio.length - RADIO_CAP;
    let removed = 0;
    game.state.radio = game.state.radio.filter((x) => { if (removed < drop && !pend.has(x.id)) { removed++; return false; } return true; });
  }
  emit(game, 'radio', { msg: m });
  return m;
}

/** есть ли рация хоть у кого-то в наряде */
export function hasRadio(game, t) {
  for (const id of t.officerIds) {
    if (t.rt.out[id]) continue;
    const o = officer(game, id);
    if (o && (!o.equipment || o.equipment.radio !== false)) return true;
  }
  return false;
}
export function leaderO(game, t) { return officer(game, t.leaderId); }

/** реплика командира наряда. Без рации — важное передаётся через дежурного «из автомата». */
export function say(game, t, tpl, vars = {}, kind = 'report', extra = {}) {
  const L = leaderO(game, t);
  const fem = isFem(L);
  const text = fmt(tpl, { cs: t.rt.callsign, csDat: t.rt.csDat, ...vars }, fem);
  logTask(game, t, text);
  if (!hasRadio(game, t)) {
    if (kind === 'alarm' || kind === 'report' && extra.important) {
      return dutySay(game, `Звонил ${t.rt.callsign} из автомата, рации у них нет: «${text}»`, kind);
    }
    return null;
  }
  return radio(game, { from: t.leaderId, fromName: oName(game, L), callsign: t.rt.callsign, text, kind, taskId: t.id, ...extra });
}
/** обращение к Заре с открывающей фразой */
export function report(game, t, body, vars = {}, kind = 'report', extra = {}) {
  const open = pick(game, T.open), close = kind === 'alarm' ? '' : pick(game, T.close);
  return say(game, t, `${open} ${body} ${close}`, vars, kind, extra);
}
export function dispatchSay(game, text, kind = 'info', extra = {}) {
  return radio(game, { from: 'dispatch', fromName: 'Дежурный по городу', callsign: 'Гранит', text, kind, ...extra });
}
export function dutySay(game, text, kind = 'info', extra = {}) {
  const duty = (game.state.staff || []).find((o) => o.role === 'duty' && o.onShift && o.status === 'station');
  return radio(game, { from: 'duty', fromName: duty ? oName(game, duty) : 'Дежурный', callsign: 'Заря', text, kind, ...extra });
}
export function logTask(game, t, text) {
  const d = dmOf(absNow(game));
  t.log.push({ day: d.day, minute: d.minute, text });
  if (t.log.length > 60) t.log.splice(0, t.log.length - 60);
}

/**
 * Запрос решения игроку. choices: [ids] или [{id,label}]; auto — что сделает командир сам.
 * ttl — минут до истечения. Без рации запрос невозможен — вернёт null, решайте сами.
 */
export function ask(game, t, body, choices, auto, ttl, meta, vars = {}) {
  if (t && !hasRadio(game, t)) return null;
  const ch = choices.map((c) => (typeof c === 'string' ? { id: c, label: CHOICE_LABEL[c] || c } : c));
  const exp = dmOf(absNow(game) + ttl);
  const extra = { choices: ch, autoChoice: auto, expires: { day: exp.day, minute: exp.minute }, meta };
  if (t) {
    const open = pick(game, T.askLead);
    return say(game, t, `${open} ${body}`, vars, 'request', extra);
  }
  return null;
}
export function actionWord(a, cap1 = false) { const w = (ACTIONS[a] || [a])[0]; return cap1 ? cap(w) : w; }

export function answerRadio(game, msgId, choiceId, auto = false) {
  const list = game.state.radio || [];
  const m = list.find((x) => x.id === msgId);
  if (!m || !m.choices || m.answered) return { ok: false, reason: 'Сообщение не ждёт ответа' };
  if (!m.choices.some((c) => c.id === choiceId)) return { ok: false, reason: 'Нет такого варианта' };
  m.answered = choiceId;
  if (auto) m.auto = true;
  const c = C(game);
  c.pendingMsgs = c.pendingMsgs.filter((id) => id !== msgId);
  const h = m.meta && HANDLERS[m.meta.type];
  if (h) {
    try { h(game, m, choiceId, auto); } catch (e) { if (typeof console !== 'undefined') console.warn('[city] обработчик ответа', m.meta.type, e); }
  }
  return { ok: true };
}

/** истечение запросов → решение командира/дежурного */
export function expireRadio(game, now) {
  const c = C(game);
  if (!c.pendingMsgs.length) return;
  const list = game.state.radio || [];
  for (const id of c.pendingMsgs.slice()) {
    const m = list.find((x) => x.id === id);
    if (!m || m.answered) { c.pendingMsgs = c.pendingMsgs.filter((x) => x !== id); continue; }
    const ex = m.expires;
    if (!ex) continue;
    const exAbs = (ex.day - 1) * 1440 + ex.minute;
    if (now >= exAbs) {
      const choice = m.autoChoice && m.choices.some((x) => x.id === m.autoChoice) ? m.autoChoice : m.choices[m.choices.length - 1].id;
      answerRadio(game, id, choice, true);
    }
  }
}

/** сообщение «Заря молчит — решаю сам» от командира */
export function autoNote(game, t, action) {
  if (!t) return;
  say(game, t, pick(game, T.autoDecide), { action: actionWord(action) }, 'report');
}
export function ackNote(game, t, action) {
  if (!t) return;
  say(game, t, pick(game, T.ack), { action: actionWord(action), Action: actionWord(action, true) }, 'report');
}
export function taskOfMsg(game, m) { return m && m.meta && m.meta.taskId ? taskById(game, m.meta.taskId) : null; }
export { badText };
