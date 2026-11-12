// Следственное отделение (v1.1): уголовные дела state.cases.
// Дела заводятся по раскрытым и тяжким заявленным преступлениям; следователи собирают материалы
// (по навыку «розыск», допросами задержанных), до срока передают дело в прокуратуру.
// Принято прокуратурой → авторитет +, доверие района +; срок упущен → авторитет −.
import { R, absNow, num, sk, rankShort, emit, glog, dep, callDep } from './city_util.js';
import { C, authority, trust } from './city_core.js';
import { dForm } from './city_data.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const CAP = 60;
const OPEN = ['open', 'ready', 'overdue'];

export function casesState(game) {
  const s = game.state;
  if (!Array.isArray(s.cases)) s.cases = [];
  if (!s.casesMeta || typeof s.casesMeta !== 'object') s.casesMeta = { seq: 0, lastScan: 0, lastWork: 0, stats: { opened: 0, sent: 0, closed: 0, returned: 0, overdue: 0, suspended: 0 } };
  return s.cases;
}
function meta(game) { casesState(game); return game.state.casesMeta; }
function sledList(game) { return (game.state.staff || []).filter((o) => o.role === 'sledovatel' && !['dead', 'fired', 'candidate'].includes(o.status)); }
function present(o) { return o && o.status === 'station' && o.onShift !== false && num(o.hp, 100) > 15; }
function crimeOf(game, id) { return (C(game)?.crimes || []).find((c) => c.id === id) || null; }
function note(game, cs, text) { cs.log.push({ day: game.state.time.day, minute: Math.floor(game.state.time.minute), text }); if (cs.log.length > 12) cs.log.splice(0, cs.log.length - 12); }
function suspects(game, cs) { return (game.state.detainees || []).filter((d) => d.crimeId === cs.crimeId && d.status === 'cell'); }

/** Завести дело по преступлению (если ещё нет) */
export function openCase(game, cr, why = 'заявление') {
  const list = casesState(game); const m = meta(game);
  if (!cr || list.some((x) => x.crimeId === cr.id)) return null;
  m.seq++;
  const day = game.state.time.day;
  const sev = num(cr.severity, 2);
  const solved = cr.status === 'resolved';
  const cs = {
    id: 'case_' + m.seq.toString(36), no: m.seq, crimeId: cr.id, title: String(cr.title || 'преступление'), districtId: cr.districtId || null,
    severity: sev, category: cr.category || 'other', opened: { day, minute: Math.floor(game.state.time.minute) }, deadline: day + (sev >= 4 ? 6 : 5),
    materials: solved ? 25 : 5, suspect: solved, status: 'open', investigatorId: null, sentDay: null, verdictDay: null, interDay: 0, log: [],
  };
  note(game, cs, `Возбуждено уголовное дело (${why}).`);
  list.push(cs); m.stats.opened++;
  if (list.length > CAP) { const k = list.findIndex((x) => !OPEN.includes(x.status) && x.status !== 'sent'); if (k >= 0) list.splice(k, 1); }
  emit(game, 'case:opened', { caseId: cs.id, crimeId: cr.id });
  return cs;
}

/** Просмотр свежих преступлений: раскрытые и тяжкие — в производство */
function scan(game) {
  const crimes = C(game)?.crimes || []; const list = casesState(game);
  const have = new Set(list.map((x) => x.crimeId));
  const openN = list.filter((x) => OPEN.includes(x.status)).length;
  let room = Math.max(0, 25 - openN);
  for (const cr of crimes) {
    if (!room) break;
    if (!cr || have.has(cr.id) || !cr.reported || cr.missing) continue;
    const sev = num(cr.severity, 1);
    const withSuspect = cr.status === 'resolved' || (game.state.detainees || []).some((d) => d.crimeId === cr.id && d.status === 'cell');
    if ((withSuspect && sev >= 2) || sev >= 4) { openCase(game, cr, withSuspect ? 'есть подозреваемый' : 'тяжкое'); room--; }
  }
  // по делу появился подозреваемый
  for (const cs of list) {
    if (!OPEN.includes(cs.status) || cs.suspect) continue;
    const cr = crimeOf(game, cs.crimeId);
    if ((cr && cr.status === 'resolved') || suspects(game, cs).length) { cs.suspect = true; cs.materials = clamp(cs.materials + 15, 0, 100); note(game, cs, 'Установлен подозреваемый.'); }
  }
}

/** Следователи работают: материалы, допросы. hours — сколько часов работы прошло */
function work(game, hours) {
  const rng = R(game);
  const list = casesState(game).filter((x) => x.status === 'open' || x.status === 'overdue');
  if (!list.length) return;
  const people = sledList(game).filter(present);
  if (!people.length) return;
  const day = game.state.time.day;
  list.sort((a, b) => a.deadline - b.deadline || b.severity - a.severity);
  people.forEach((o, i) => {
    const cs = list[i % list.length];
    cs.investigatorId = o.id;
    const fat = 1 - Math.max(0, num(o.fatigue, 20) - 60) / 80;
    let rate = (6 + sk(o, 'investigation') * 0.12 + sk(o, 'discipline') * 0.04) * fat * hours * (cs.severity >= 4 ? 0.75 : 1);
    if ((o.traits || []).includes('pedant')) rate *= 1.15; if ((o.traits || []).includes('lazy')) rate *= 0.7;
    if (o.cond && o.cond.drunk > 0) rate *= 0.3;
    // допрос подозреваемого — раз в сутки по делу
    const sus = suspects(game, cs);
    if (sus.length && cs.interDay !== day) {
      cs.interDay = day;
      const det = sus[0];
      const r = callDep(game, 'detainees', 'interrogate', game, det.id, 'soft', o.id);
      if (r && r.ok) {
        const conf = !!(r.effects && r.effects.confession) || det.confessed;
        cs.materials = clamp(cs.materials + (conf ? 30 : 8), 0, 100); cs.suspect = true;
        note(game, cs, conf ? `${rankShort(o.rank)} ${o.lastName}: допрос — признательные показания.` : `${rankShort(o.rank)} ${o.lastName}: допрос, подозреваемый молчит.`);
        if (conf) det.papers = true;
      } else if (!r) {
        // модуля задержанных нет — абстрактный допрос по навыку
        const ok = rng.chance(clamp(sk(o, 'investigation') / 130, 0.15, 0.7));
        cs.materials = clamp(cs.materials + (ok ? 25 : 6), 0, 100); cs.suspect = true;
        note(game, cs, ok ? 'Допрос: признание.' : 'Допрос: без результата.');
      }
    }
    // без подозреваемого больше 60% не собрать
    cs.materials = clamp(cs.materials + rate, 0, cs.suspect ? 100 : 60);
    if (cs.materials >= 100 && cs.suspect) { cs.status = 'ready'; note(game, cs, 'Материалы собраны: дело готово к передаче в прокуратуру.'); }
    o.fatigue = clamp(num(o.fatigue, 20) + 1.2 * hours, 0, 100);
  });
}

/** Передать дело в прокуратуру (игрок или начальник следствия) */
export function sendCase(game, caseId, by = 'player') {
  const cs = casesState(game).find((x) => x.id === caseId);
  if (!cs) return { ok: false, reason: 'Дело не найдено' };
  if (!['ready', 'open', 'overdue'].includes(cs.status)) return { ok: false, reason: 'Дело уже не в производстве' };
  if (!cs.suspect) return { ok: false, reason: 'Подозреваемый не установлен — прокурор не примет' };
  cs.wasOverdue = cs.status === 'overdue';
  cs.status = 'sent'; cs.sentDay = game.state.time.day; cs.sentBy = by; meta(game).stats.sent++;
  note(game, cs, by === 'player' ? 'Направлено в прокуратуру по вашему указанию.' : 'Направлено в прокуратуру начальником следствия.');
  return { ok: true, text: `Дело №${cs.no} ушло в прокуратуру. Ответ — через сутки.` };
}

/** Решение прокуратуры: через сутки после отправки */
function verdicts(game) {
  const rng = R(game); const day = game.state.time.day;
  for (const cs of casesState(game)) {
    if (cs.status !== 'sent' || day < (cs.sentDay || 0) + 1) continue;
    const p = clamp(0.25 + cs.materials / 130 - (cs.wasOverdue ? 0.1 : 0), 0.1, 0.95);
    cs.verdictDay = day;
    if (rng.chance(p)) {
      cs.status = 'closed'; meta(game).stats.closed++;
      const gain = cs.wasOverdue ? 1 : cs.severity >= 4 ? 3 : 2;
      authority(game, gain, `дело №${cs.no} принято прокуратурой`);
      if (cs.districtId) trust(game, cs.districtId, 1 + cs.severity * 0.4);
      note(game, cs, 'Прокуратура приняла дело, направлено в суд.');
      glog(game, `Прокуратура приняла дело №${cs.no}: ${cs.title}. Направлено в суд.`, 'authority');
    } else {
      cs.status = 'open'; cs.materials = clamp(cs.materials - 35, 0, 100); cs.deadline = Math.max(cs.deadline, day + 2); meta(game).stats.returned++;
      authority(game, -1, `дело №${cs.no} возвращено на доследование`);
      note(game, cs, 'Прокуратура вернула дело на дополнительное расследование.');
      glog(game, `Прокуратура вернула дело №${cs.no} на доследование: «материалов мало».`, 'authority');
    }
    emit(game, 'case:verdict', { caseId: cs.id, status: cs.status });
  }
}

/** Сроки: просрочка и приостановление */
function deadlines(game) {
  const day = game.state.time.day; const m = meta(game);
  for (const cs of casesState(game)) {
    if (cs.status !== 'open' && cs.status !== 'ready') continue;
    if (day <= cs.deadline) continue;
    if (!cs.suspect) {
      cs.status = 'suspended'; m.stats.suspended++;
      note(game, cs, 'Приостановлено: лицо, совершившее преступление, не установлено.');
      if (cs.severity >= 4) authority(game, -1, `нераскрытое тяжкое (дело №${cs.no})`);
      continue;
    }
    cs.status = 'overdue'; m.stats.overdue++;
    authority(game, -(cs.severity >= 4 ? 3 : 2), `сорван срок следствия по делу №${cs.no}`);
    note(game, cs, 'Срок следствия истёк. Прокурор требует объяснений.');
    glog(game, `Сорван срок по делу №${cs.no} (${cs.title}).`, 'authority');
  }
}

export const cases = {
  /** обновление раз в ~30 игровых минут; head — исполняющий обязанности начальника следствия (или null) */
  update(game, head, autonomy) {
    const m = meta(game); const now = absNow(game);
    if (now - (m.lastScan || 0) >= 30) { m.lastScan = now; try { scan(game); } catch (e) { console.error('[cases scan]', e); } }
    const dt = now - (m.lastWork || now);
    if (dt >= 30 || !m.lastWork) {
      m.lastWork = now;
      if (dt > 0 && dt < 600) try { work(game, dt / 60); } catch (e) { console.error('[cases work]', e); }
      // начальник сам отправляет готовые дела, если отдел самостоятелен
      if (head && autonomy) for (const cs of casesState(game).filter((x) => x.status === 'ready' || (x.status === 'overdue' && x.materials >= 100))) sendCase(game, cs.id, 'head');
    }
  },
  dayStart(game) {
    casesState(game);
    try { verdicts(game); deadlines(game); } catch (e) { console.error('[cases day]', e); }
    // старые закрытые — из памяти
    const day = game.state.time.day;
    game.state.cases = game.state.cases.filter((x) => OPEN.includes(x.status) || x.status === 'sent' || day - (x.verdictDay || x.opened.day) < 10);
  },
  /** Готовые, но не отправленные дела (для доклада/бумаги игроку) */
  ready(game) { return casesState(game).filter((x) => x.status === 'ready'); },
  open(game) { return casesState(game).filter((x) => OPEN.includes(x.status)); },
  stats(game) { return { ...meta(game).stats, open: casesState(game).filter((x) => OPEN.includes(x.status)).length, ready: casesState(game).filter((x) => x.status === 'ready').length, overdue: casesState(game).filter((x) => x.status === 'overdue').length }; },
  line(game, cs) { return `№${cs.no} — ${cs.title}${cs.districtId ? ` (${dForm(cs.districtId, 'nom')})` : ''}: материалы ${Math.round(cs.materials)}%, срок — ${cs.deadline} сут.`; },
  sendCase, openCase,
};
export default cases;
void dep;
