// Документооборот (v1.1): исходящие документы начальника — распоряжения отделам, запросы в управление,
// служебные записки — и ответы на них. Секретарь напоминает о бумагах с истекающим сроком и докладывает о почте.
// Исходящие лежат в state.inbox с dir:'out' (answered:'sent'), ответы — обычные входящие (source 'docs').
import { R, absNow, num, rankShort, oName, glog, dep, hhmm, dmOf } from './city_util.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const CMD_DEPTS = ['ugro', 'pps', 'uchastok', 'sled', 'spec'];

export const TEMPLATES = [
  { id: 'order_focus', group: 'order', label: 'Распоряжение: усилить работу по району', desc: 'Отдел ставит район в приоритет и переходит минимум на обычный режим.', needs: ['dept', 'district'], depts: ['ugro', 'pps', 'uchastok'] },
  { id: 'order_report', group: 'order', label: 'Распоряжение: подготовить письменный доклад', desc: 'Начальник отдела через час-два кладёт подробный доклад. Немного устаёт.', needs: ['dept'], depts: CMD_DEPTS.concat(['duty', 'ivs']) },
  { id: 'order_award', group: 'order', label: 'Представление к награде', desc: 'Благодарность сразу; ходатайство в управление — ответ через сутки.', needs: ['officer'] },
  { id: 'order_reprimand', group: 'order', label: 'Приказ: выговор', desc: 'Письменный выговор сотруднику.', needs: ['officer'] },
  { id: 'req_fuel', group: 'request', label: 'Запрос в управление: бензин (ГСМ)', desc: 'При хорошем авторитете выделят 60 л. Ответ через несколько часов.', cool: 3 },
  { id: 'req_ammo', group: 'request', label: 'Запрос в управление: патроны 9×18', desc: 'Пополнение для ПМ — 160 шт. Ответ через несколько часов.', cool: 3 },
  { id: 'req_money', group: 'request', label: 'Ходатайство: дополнительное финансирование', desc: 'Могут дать 400–900 тыс. Отказ немного раздражает управление.', cool: 5 },
  { id: 'memo_inventory', group: 'memo', label: 'Служебная записка: инвентаризация склада', desc: 'Пересчёт склада: найдутся излишки — или недостача и тот, кто её сделал.', cool: 2 },
];
const TPL = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

function S(game) {
  const s = game.state;
  if (!s.docs || typeof s.docs !== 'object') s.docs = {};
  const d = s.docs;
  if (!Array.isArray(d.pending)) d.pending = [];
  if (!d.cool || typeof d.cool !== 'object') d.cool = {};
  if (!Number.isFinite(d.lastTick)) d.lastTick = 0;
  return d;
}
function push(game, item) { const f = dep(game, 'staff', 'pushInbox'); return f ? f(game, item) : null; }
function officerById(game, id) { return (game.state.staff || []).find((o) => o.id === id) || null; }
function D(game) { return game.sim && game.sim.departments; }
function auth(game) { return num(game.state.campaign?.authority, num(game.state.flags?.authority, 50)); }
function expireIn(game, min) { const t = dmOf(absNow(game) + min); return { day: t.day, minute: t.minute }; }
function secretary(game) { return (game.state.staff || []).find((o) => o.role === 'secretary' && o.status === 'station' && o.onShift) || null; }
function toast(game, text, kind = 'info', itemId = null) {
  if (game.ui && typeof game.ui.toast === 'function') { try { game.ui.toast(text, kind, itemId ? { onClick: () => game.ui.open('inbox', { itemId }), dur: 7 } : { dur: 6 }); return; } catch (e) { /* */ } }
  game.bus?.emit?.('toast', { text, kind });
}
function deptName(game, id) { const def = (D(game)?.DEPTS || []).find((x) => x.id === id); return def ? def.name : id; }

/** Что можно написать сейчас: шаблоны с причиной недоступности */
export function templates(game) {
  const d = S(game); const day = game.state.time.day;
  return TEMPLATES.map((t) => {
    const until = d.cool[t.id] || 0;
    return { ...t, disabled: until > day ? `Повторно — не раньше ${until}-х суток` : null };
  });
}

/** Написать документ. spec: {tpl, deptId?, districtId?, officerId?} → {ok, text|reason, item} */
export function write(game, spec = {}) {
  const t = TPL[spec.tpl]; if (!t) return { ok: false, reason: 'Нет такого бланка' };
  const d = S(game); const day = game.state.time.day; const rng = R(game); const now = absNow(game);
  if ((d.cool[t.id] || 0) > day) return { ok: false, reason: 'Такой документ уже отправлен — ждите ответа' };
  if ((t.needs || []).includes('dept') && !spec.deptId) return { ok: false, reason: 'Выберите отдел' };
  if (t.id === 'order_report' && (d.cool['order_report:' + spec.deptId] || 0) > day) return { ok: false, reason: 'Доклад от этого отдела уже заказан на сегодня' };
  if ((t.needs || []).includes('district') && !spec.districtId) return { ok: false, reason: 'Выберите район' };
  const o = spec.officerId ? officerById(game, spec.officerId) : null;
  if ((t.needs || []).includes('officer') && !o) return { ok: false, reason: 'Выберите сотрудника' };
  let text = ''; let res = '';
  switch (t.id) {
    case 'order_focus': {
      const Dm = D(game); if (!Dm) return { ok: false, reason: 'Отделы недоступны' };
      Dm.setFocus(game, spec.deptId, spec.districtId);
      const dd = Dm.get(game, spec.deptId); if (dd && dd.directive === 'quiet') Dm.setDirective(game, spec.deptId, 'normal');
      if (dd) { dd.trust = clamp(num(dd.trust, 50) + 1, 0, 100); dd.notes.push({ day, minute: Math.floor(game.state.time.minute), text: `Распоряжение начальника: приоритет — ${districtName(game, spec.districtId)}.` }); }
      text = `${deptName(game, spec.deptId)}: усилить работу по району «${districtName(game, spec.districtId)}». Ежедневно докладывать.`;
      res = 'Распоряжение доведено до отдела. Район — в приоритете.';
      break;
    }
    case 'order_report': {
      d.pending.push({ at: now + rng.int(60, 140), tpl: t.id, deptId: spec.deptId });
      text = `${deptName(game, spec.deptId)}: представить письменный доклад о работе отдела.`;
      res = 'Начальник отдела сел писать доклад.';
      break;
    }
    case 'order_award': {
      const f = dep(game, 'staff', 'reward'); const r = f ? f(game, o.id, 'thanks') : null;
      d.pending.push({ at: now + rng.int(18, 30) * 60, tpl: t.id, officerId: o.id });
      text = `Ходатайство о награждении: ${oName(game, o)} — за добросовестное исполнение служебных обязанностей.`;
      res = (r && r.text ? r.text + ' ' : '') + 'Ходатайство ушло в управление.';
      break;
    }
    case 'order_reprimand': {
      const f = dep(game, 'staff', 'reprimand'); const r = f ? f(game, o.id, 'written') : null;
      text = `Приказ: объявить ${oName(game, o)} выговор.`;
      res = (r && r.text) || 'Выговор объявлен.';
      break;
    }
    case 'req_fuel': case 'req_ammo': case 'req_money': {
      // внешний модуль управления/соседних отделений, если появится
      const ext = game.sim?.stations?.request || game.sim?.command?.request;
      if (typeof ext === 'function') {
        try { const r = ext(game, { kind: t.id.slice(4), from: 'station' }); if (r && r.ok) { text = t.label; res = r.text || 'Запрос принят управлением.'; break; } } catch (e) { console.warn('[docs] request', e); }
      }
      d.pending.push({ at: now + rng.int(120, 360), tpl: t.id });
      text = { req_fuel: 'Прошу выделить отделению горюче-смазочные материалы (бензин АИ-76) в связи с перерасходом на выезды.', req_ammo: 'Прошу пополнить боекомплект: патроны 9×18 для пистолетов ПМ.', req_money: 'Ходатайствую о выделении дополнительного финансирования на нужды отделения.' }[t.id];
      res = 'Запрос отправлен фельдъегерской почтой. Ответ — в течение дня.';
      break;
    }
    case 'memo_inventory': {
      d.pending.push({ at: now + rng.int(60, 150), tpl: t.id });
      text = 'Провести инвентаризацию склада и оружейной комнаты, результаты доложить.';
      res = 'Старшина с конвойным пошли пересчитывать склад.';
      break;
    }
    default: return { ok: false, reason: 'Бланк не готов' };
  }
  if (t.cool) d.cool[t.id] = day + t.cool;
  else if (t.id === 'order_report') d.cool[t.id + ':' + spec.deptId] = day + 1;
  const item = push(game, { source: 'docs', dir: 'out', kind: t.id, title: t.label.replace(/^[^:]+: /, ''), text, choices: [], answered: 'sent', result: res, data: { deptId: spec.deptId || null, districtId: spec.districtId || null, officerId: o ? o.id : null } });
  glog(game, `Исходящий документ: ${t.label}.`, 'inbox');
  return { ok: true, text: res, item };
}
function districtName(game, id) { const x = (game.state.city?.districts || []).find((d) => d.id === id); return x ? x.name : id || '—'; }

/* ------------------------------------------------------------------ ответы */
function reply(game, p) {
  const rng = R(game); const A = auth(game); const e = game.state.economy;
  const yes = rng.chance(clamp(A / 100 + 0.15, 0.15, 0.9));
  let title = '', text = '', choices = [], data = {}, kind = 'reply';
  switch (p.tpl) {
    case 'order_report': {
      const Dm = D(game); const lines = Dm && Dm.reportLines ? Dm.reportLines(game, p.deptId) : [];
      const A0 = Dm && Dm.acting ? Dm.acting(game, p.deptId) : null;
      if (A0 && A0.o) A0.o.fatigue = clamp(num(A0.o.fatigue, 20) + 4, 0, 100);
      title = `Письменный доклад: ${deptName(game, p.deptId)}`; text = lines.join('\n') || 'Доклад писать некому — в отделе никого.';
      kind = 'dept_brief'; break;
    }
    case 'order_award': {
      const o = officerById(game, p.officerId); if (!o) return;
      title = `Управление: представление ${o.lastName}`;
      if (yes) { o.morale = clamp(num(o.morale, 50) + 8, 0, 100); o.loyalty = clamp(num(o.loyalty, 50) + 5, 0, 100); o.history?.push?.({ day: game.state.time.day, text: 'Награждён нагрудным знаком «Отличник милиции».' }); text = `Представление удовлетворено: ${oName(game, o)} награждается нагрудным знаком «Отличник милиции». Вручить перед строем.`; }
      else { o.morale = clamp(num(o.morale, 50) - 3, 0, 100); text = `В представлении ${oName(game, o)} отказано: «оснований недостаточно, лимит наград на квартал выбран».`; }
      break;
    }
    case 'req_fuel': title = 'Ответ управления: ГСМ'; if (yes && e) { e.fuel = num(e.fuel, 0) + 60; text = 'Выделено 60 литров бензина. Получить на базе ХОЗУ.'; } else text = 'В выделении ГСМ отказано: «лимиты на квартал исчерпаны, изыскивайте внутренние резервы».'; break;
    case 'req_ammo': title = 'Ответ управления: боеприпасы'; if (yes && e && e.ammo) { e.ammo['9x18'] = num(e.ammo['9x18'], 0) + 160; text = 'Выделено 160 патронов 9×18. Привезли с утренней машиной.'; } else text = 'Патронов нет: «всё ушло на усиление в связи с известными событиями».'; break;
    case 'req_money': {
      title = 'Ответ управления: финансирование';
      const sum = Math.round(rng.int(400, 900) / 10) * 10;
      if (yes && rng.chance(0.7)) { const add = dep(game, 'economy', 'addMoney'); if (add) add(game, sum, 'дополнительное финансирование'); else if (e) e.money = num(e.money, 0) + sum; text = `Дополнительно выделено ${sum} тыс. руб. «Расходовать строго по смете».`; }
      else { const ad = dep(game, 'campaign', 'addAuthority'); if (ad) ad(game, -1, 'лишние ходатайства о деньгах'); text = 'В финансировании отказано. Начальник финчасти по телефону: «Майор, у всех трудно».'; }
      break;
    }
    case 'memo_inventory': return inventoryReply(game);
    default: return;
  }
  const item = push(game, { source: 'docs', dir: 'in', kind, title, text, choices, autoChoice: null, expires: expireIn(game, 24 * 60), data });
  mailNotice(game, item);
}
function inventoryReply(game) {
  const rng = R(game); const e = game.state.economy; if (!e || !e.inventory) return;
  const access = (game.state.staff || []).filter((o) => ['guard', 'duty', 'pps', 'driver'].includes(o.role) && !['dead', 'fired', 'candidate'].includes(o.status));
  const thief = access.filter((o) => num(o.hidden?.corruption, 0) > 55).sort((a, b) => num(b.hidden.corruption) - num(a.hidden.corruption))[0] || null;
  if (thief && rng.chance(0.7)) {
    const pool = ['cigarettes', 'tea', 'ration', 'medkit', 'gas_spray', 'sugar'].filter((k) => num(e.inventory[k], 0) > 0);
    const lost = rng.sample(pool, Math.min(2, pool.length));
    const parts = lost.map((k) => { const n = Math.max(1, Math.round(num(e.inventory[k], 0) * rng.range(0.15, 0.35))); e.inventory[k] -= n; return `${k === 'ration' ? 'сухпаёк' : k === 'cigarettes' ? 'сигареты' : k === 'tea' ? 'чай' : k === 'medkit' ? 'аптечки' : k === 'gas_spray' ? 'баллончики «Черёмуха»' : 'сахар'} — ${n}`; });
    let ammo = '';
    if (e.ammo && num(e.ammo['9x18'], 0) > 100 && rng.chance(0.4)) { const n = rng.int(16, 48); e.ammo['9x18'] -= n; ammo = `, патроны 9×18 — ${n} шт.`; }
    const item = push(game, {
      source: 'docs', dir: 'in', kind: 'inventory_short', title: 'Инвентаризация: недостача', officerId: null,
      text: `Акт инвентаризации. Недостача: ${parts.join(', ') || 'мелочь'}${ammo}. Журнал выдачи заполнен небрежно; ключи от склада, кроме старшины, бывают у дежурной смены. В смене чаще других бывал${thief.gender === 'f' ? 'а' : ''} ${oName(game, thief)}.`,
      choices: [
        { id: 'check', label: `Негласно проверить ${thief.lastName}`, desc: 'Служебная проверка: через несколько суток — результат.' },
        { id: 'search', label: 'Обыскать шкафчики смены', desc: 'Может, найдётся. Обидятся все.' },
        { id: 'writeoff', label: 'Списать и забыть', desc: 'Тихо, но вор останется безнаказанным.' },
      ],
      autoChoice: 'writeoff', expires: expireIn(game, 24 * 60), data: { thiefId: thief.id, lost },
    });
    mailNotice(game, item);
    return;
  }
  const found = rng.chance(0.5);
  if (found) { e.inventory.medkit = num(e.inventory.medkit, 0) + 1; e.inventory.paper = num(e.inventory.paper, 0) + 2; }
  const item = push(game, { source: 'docs', dir: 'in', kind: 'inventory_ok', title: 'Инвентаризация: всё сходится', text: `Акт инвентаризации: расхождений нет.${found ? ' За стеллажом нашлась забытая аптечка и две пачки бумаги — оприходовали.' : ''} Старшина просит отметить порядок на складе.`, choices: [{ id: 'thanks', label: 'Объявить благодарность смене', desc: 'Настроение конвоя и дежурных +.' }, { id: 'ok', label: 'Принято' }], autoChoice: 'ok', expires: expireIn(game, 24 * 60) });
  mailNotice(game, item);
}
function mailNotice(game, item) {
  if (!item) return;
  const sec = secretary(game);
  toast(game, sec ? `Секретарь: пришла почта — «${item.title}».` : `На столе почта: ${item.title}`, 'info', item.id);
}

export function resolve(game, it, choiceId) {
  const rng = R(game);
  switch (it.kind) {
    case 'inventory_short': {
      const o = officerById(game, it.data && it.data.thiefId);
      if (choiceId === 'check' && o) { const f = dep(game, 'staff', 'investigate'); const r = f ? f(game, o.id, 'surveillance') : null; return (r && r.text) || 'Проверка начата.'; }
      if (choiceId === 'search') {
        for (const x of game.state.staff || []) if (['guard', 'duty', 'pps', 'driver'].includes(x.role) && x.status === 'station') x.morale = clamp(num(x.morale, 50) - 4, 0, 100);
        if (o && rng.chance(0.55)) { const f = dep(game, 'staff', 'reprimand'); if (f) f(game, o.id, 'fine'); o.hidden.corruption = clamp(num(o.hidden.corruption, 50) - 10, 0, 100); const e = game.state.economy; for (const k of (it.data.lost || [])) if (e) e.inventory[k] = num(e.inventory[k], 0) + 1; return `В шкафчике ${o.lastName} — часть пропавшего. Лишён премии, остальное вернули на склад.`; }
        return 'Перерыли шкафчики — пусто. Смена смотрит волком.';
      }
      return 'Недостачу списали. Склад закрыт на новый замок.';
    }
    case 'inventory_ok':
      if (choiceId === 'thanks') { for (const x of game.state.staff || []) if (['guard', 'duty'].includes(x.role)) x.morale = clamp(num(x.morale, 50) + 3, 0, 100); return 'Благодарность объявлена. Старшина доволен.'; }
      return 'Принято к сведению.';
    default: return 'Принято к сведению.';
  }
}

/* ------------------------------------------------------------------ тик: ответы и секретарь */
export function update(game, now) {
  const d = S(game);
  if (now - d.lastTick < 5) return;
  d.lastTick = now;
  if (d.pending.length) {
    const due = d.pending.filter((p) => p.at <= now);
    if (due.length) { d.pending = d.pending.filter((p) => p.at > now); for (const p of due) { try { reply(game, p); } catch (e) { console.error('[docs reply]', e); } } }
  }
  // секретарь напоминает о бумагах, у которых истекает срок
  const sec = secretary(game); if (!sec) return;
  let n = 0;
  for (const it of game.state.inbox || []) {
    if (n >= 2) break;
    if (it.answered || it.dir === 'out' || !it.expires || it.reminded || !(it.choices && it.choices.length)) continue;
    const left = (it.expires.day - 1) * 1440 + it.expires.minute - now;
    if (left > 0 && left <= 60) { it.reminded = true; n++; toast(game, `Секретарь: «${it.title}» — срок до ${hhmm(it.expires.minute)}. Потом решат без вас.`, 'warn', it.id); }
  }
}

export const docs = { TEMPLATES, templates, write, resolve, update };
export default docs;
void rankShort;
