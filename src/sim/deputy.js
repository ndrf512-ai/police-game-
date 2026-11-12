// Заместитель начальника участка (v1.1).
// Назначается игроком (state.departments._deputyId). Ночью (23:00–07:00) или когда игрока нет (state.flags.playerAway)
// сам решает бумаги, у которых есть решение по умолчанию или низкая важность, и запросы по рации.
// Качество решений — по headScore/headForm заместителя. Утром — одна бумага-доклад «за ночь».
import { R, absNow, num, rankShort, emit } from './city_util.js';
import { answerRadio } from './city_radio.js';
import { availableCount } from './city_crime.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// важные бумаги зам не трогает — только с пометкой автоматического решения
const IMPORTANT = new Set(['resignation', 'mole_activity', 'investigation', 'death_check', 'complaint', 'prosecutor', 'hours72', 'night_report']);

function D(game) { const s = game.state; if (!s.departments) s.departments = {}; return s.departments; }
export function deputyOf(game) {
  const id = D(game)._deputyId; if (!id) return null;
  const o = (game.state.staff || []).find((x) => x.id === id);
  if (!o || ['dead', 'fired', 'candidate'].includes(o.status)) { D(game)._deputyId = null; return null; }
  return o;
}
function night(game) { const m = game.state.time.minute; return m >= 23 * 60 || m < 7 * 60; }
export function deputyActive(game) { return !!deputyOf(game) && (night(game) || !!(game.state.flags && game.state.flags.playerAway)); }
function nightLog(game) {
  const d = D(game);
  if (!d._deputyNight || typeof d._deputyNight !== 'object') d._deputyNight = { papers: 0, radio: 0, mistakes: 0, lines: [], since: absNow(game) };
  return d._deputyNight;
}
function addLine(game, text) { const n = nightLog(game); n.lines.push(text); if (n.lines.length > 10) n.lines.shift(); }

/** Назначить/снять заместителя */
export function appointDeputy(game, officerId, scoreFn) {
  const d = D(game);
  if (!officerId) { const prev = deputyOf(game); d._deputyId = null; if (prev) { prev.flags = prev.flags || {}; delete prev.flags.deputy; prev.morale = clamp(num(prev.morale, 50) - 5, 0, 100); } emit(game, 'deputy:changed', { officerId: null }); return { ok: true }; }
  const o = (game.state.staff || []).find((x) => x.id === officerId);
  if (!o || ['dead', 'fired', 'candidate'].includes(o.status)) return { ok: false, reason: 'Сотрудник не найден' };
  if (o.role === 'secretary') return { ok: false, reason: 'Вольнонаёмная не может замещать начальника' };
  const prev = deputyOf(game);
  if (prev && prev !== o) { prev.flags = prev.flags || {}; delete prev.flags.deputy; prev.morale = clamp(num(prev.morale, 50) - 6, 0, 100); }
  d._deputyId = o.id; o.flags = o.flags || {}; o.flags.deputy = true;
  o.morale = clamp(num(o.morale, 50) + 6, 0, 100); o.loyalty = clamp(num(o.loyalty, 50) + 4, 0, 100);
  o.history?.push?.({ day: game.state.time.day, text: `Назначен${o.gender === 'f' ? 'а' : ''} заместителем начальника отделения.` });
  game.log?.(`Заместитель начальника отделения — ${rankShort(o.rank)} ${o.lastName}.`, 'staff');
  emit(game, 'deputy:changed', { officerId: o.id, score: scoreFn ? scoreFn(o) : null });
  return { ok: true, officer: o };
}

function decidePapers(game, o, form) {
  const rng = R(game); const now = absNow(game);
  const ans = game.sim?.staff?.answer; if (typeof ans !== 'function') return;
  const list = (game.state.inbox || []).filter((it) => !it.answered && it.dir !== 'out' && it.choices && it.choices.length && !IMPORTANT.has(it.kind) && it.source !== 'campaign' && it.source !== 'deputy');
  let n = 0;
  for (const it of list) {
    if (n >= 2) break;
    const born = (num(it.day, 1) - 1) * 1440 + num(it.minute, 0);
    if (now - born < 15) continue;
    const low = !!it.autoChoice || it.source === 'dept' || it.choices.length <= 1;
    if (!low) continue;
    let choice = it.autoChoice && it.choices.some((c) => c.id === it.autoChoice) ? it.autoChoice : it.source === 'dept' ? 'sign' : it.choices[0].id;
    const mistake = rng.chance(clamp(0.35 - form * 0.33, 0.03, 0.35));
    if (mistake) { choice = rng.pick(it.choices).id; nightLog(game).mistakes++; }
    if (!it.choices.some((c) => c.id === choice)) choice = it.choices[it.choices.length - 1].id;
    const r = ans.call(game.sim.staff, game, it.id, choice, { auto: true, by: 'deputy' });
    if (r && r.ok) { n++; nightLog(game).papers++; addLine(game, `«${it.title}» — ${(it.choices.find((c) => c.id === choice) || {}).label || 'принято'}${mistake ? ' (поспешно)' : ''}.`); }
  }
  void o;
}
function decideRadio(game, o, form) {
  const rng = R(game); const now = absNow(game);
  for (const m of (game.state.radio || []).slice(-30)) {
    if (!m || m.answered || !m.choices || !m.choices.length) continue;
    const born = (num(m.day, 1) - 1) * 1440 + num(m.minute, 0);
    if (now - born < 2 + Math.round((1 - form) * 4)) continue;
    let choice = m.autoChoice && m.choices.some((c) => c.id === m.autoChoice) ? m.autoChoice : m.choices[m.choices.length - 1].id;
    // толковый зам не бросает вызовы, если есть кого послать
    const act = m.choices.find((c) => ['send_station', 'send_oper', 'search_now'].includes(c.id));
    if (act && availableCount(game) > 1 && rng.chance(form)) choice = act.id;
    if (rng.chance(clamp(0.3 - form * 0.28, 0.02, 0.3))) { choice = rng.pick(m.choices).id; nightLog(game).mistakes++; }
    const r = answerRadio(game, m.id, choice, true);
    if (r && r.ok) { m.byDeputy = o.id; nightLog(game).radio++; if (nightLog(game).radio <= 6) addLine(game, `Эфир, ${m.callsign || m.fromName || 'запрос'}: ${(m.choices.find((c) => c.id === choice) || {}).label || choice}.`); }
    return; // одно решение за тик
  }
}

/** Утренняя бумага «за ночь» */
function morningPaper(game, o, score) {
  const n = nightLog(game);
  const push = game.sim?.staff?.pushInbox;
  if (push && (n.papers || n.radio)) {
    const who = `${rankShort(o.rank)} ${o.lastName}`;
    const text = [
      `Доклад заместителя за ночь. ${who}.`,
      `Решено бумаг: ${n.papers}, запросов по рации: ${n.radio}.${n.mistakes ? ` ${n.mistakes > 1 ? 'Несколько решений' : 'Одно решение'} — второпях, без проверки.` : ''}`,
      n.lines.map((x) => '— ' + x).join('\n'),
      score > 0.6 ? 'Происшествий, требующих вашего решения, не допущено.' : 'Прошу проверить.',
    ].filter(Boolean).join('\n');
    push.call(game.sim.staff, game, {
      source: 'deputy', kind: 'night_report', officerId: o.id, title: `Доклад зама за ночь: ${o.lastName}`, text,
      choices: [{ id: 'thanks', label: 'Объявить благодарность', desc: 'Зам доволен: настроение и лояльность +.' }, { id: 'ok', label: 'Принято' }, { id: 'scold', label: 'Замечание: «Решали наспех»', desc: 'Зам станет осторожнее (меньше ошибок), но обидится.' }],
      autoChoice: 'ok', expires: { day: game.state.time.day + 1, minute: 8 * 60 }, data: { mistakes: n.mistakes },
    });
  }
  D(game)._deputyNight = null;
}

export function resolveDeputy(game, it, choiceId) {
  const o = (game.state.staff || []).find((x) => x.id === it.officerId);
  if (!o) return 'Решать уже не о ком.';
  if (choiceId === 'thanks') { o.morale = clamp(num(o.morale, 50) + 8, 0, 100); o.loyalty = clamp(num(o.loyalty, 50) + 5, 0, 100); o.history?.push?.({ day: game.state.time.day, text: 'Благодарность за ночное замещение.' }); return `${o.lastName} доволен${o.gender === 'f' ? 'а' : ''}: «Служу…»`; }
  if (choiceId === 'scold') { o.morale = clamp(num(o.morale, 50) - 6, 0, 100); o.flags = o.flags || {}; o.flags.deputyCareful = game.state.time.day + 3; return `${o.lastName} поджал${o.gender === 'f' ? 'а' : ''} губы. Ближайшие ночи будет решать осторожнее.`; }
  return 'Принято к сведению.';
}

export const deputy = {
  update(game, dtMin, scoreFn, formFn) {
    const o = deputyOf(game); if (!o) return;
    const d = D(game); const now = absNow(game); const m = game.state.time.minute;
    // утренний доклад: первый тик после 07:00
    if (m >= 7 * 60 && m < 9 * 60 && d._deputyNight && d._deputyReportDay !== game.state.time.day) { d._deputyReportDay = game.state.time.day; morningPaper(game, o, scoreFn(o)); }
    if (!deputyActive(game) || game.combat?.active) return;
    if (now < (d._deputyNext || 0)) return;
    const away = !(o.status === 'station' || o.status === 'home'); // в отпуске/больнице — не замещает
    if (away) return;
    let form = formFn(o) * (o.status === 'home' ? 0.85 : 1); // дома — по телефону
    if (o.flags && o.flags.deputyCareful > game.state.time.day) form = Math.min(1, form + 0.15);
    d._deputyNext = now + Math.round(4 + (1 - form) * 10);
    nightLog(game);
    try { decideRadio(game, o, form); } catch (e) { console.error('[deputy radio]', e); }
    try { decidePapers(game, o, form); } catch (e) { console.error('[deputy papers]', e); }
  },
  deputyOf, deputyActive, appointDeputy, resolveDeputy,
};
export default deputy;
