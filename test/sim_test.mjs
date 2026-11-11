// Интеграционный прогон без графики: N суток службы с нарядами, ответами на рацию, атакой на участок.
// node test/sim_test.mjs [дней=4] [seed]
import { Game } from '../src/game.js';
import * as crimes from '../src/sim/crimes.js';
import { city } from '../src/sim/city.js';
import { staff } from '../src/sim/staff.js';
import { economy } from '../src/sim/economy.js';
import { detainees } from '../src/sim/detainees.js';
import { campaign } from '../src/sim/campaign.js';
import { StationAI } from '../src/ai/station.js';
import { Combat } from '../src/ai/combat.js';

const DAYS = +(process.argv[2] || 4); const seed = +(process.argv[3] || 777);
const errs = new Map(); const origErr = console.error; const origWarn = console.warn;
console.error = (...a) => { const k = a.map((x) => (x && x.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : String(x))).join(' ').slice(0, 400); errs.set(k, (errs.get(k) || 0) + 1); };
console.warn = (...a) => { const k = 'WARN ' + a.map((x) => (x && x.message ? x.message + ' @ ' + (x.stack || '').split('\n')[1] : String(x))).join(' ').slice(0, 400); errs.set(k, (errs.get(k) || 0) + 1); };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } };

const game = new Game({ sim: { crimes, city, staff, economy, detainees, campaign }, seed });
game.StationAI = StationAI; game.combat = new Combat(game);
const ev = {}; game.bus.on('*', ({ ev: e }) => { ev[e] = (ev[e] || 0) + 1; });
const attacks = []; game.bus.on('attack:end', (p) => attacks.push({ day: game.state.time.day, t: game.timeStr(), ...p }));
game.bus.on('attack:start', ({ plan }) => console.log(`  !! ${game.timeStr()} АТАКА: ${plan.gangType} ×${plan.size} вход ${plan.entry}; защитников: ${game.world.actors.filter((a) => a.team === 'police' && a.alive).length}`));
game.newGame({ seed, gender: 'f', mode: 'campaign' });
const S = game.state; const rng = game.rng;
console.log('Старт:', S.player.lastName, S.player.firstName, '| состав', S.staff.length, '| банды', S.city.gangs.map((g) => `${g.name}(${Math.round(g.strength)})`).join(', '));
const inp = { mx: 0, my: 0, run: false, lookDX: 0, lookDY: 0, pressed: new Set(), held: new Set() };
// группа обороны
const av0 = staff.available(game).slice(0, 3); if (av0.length >= 2) game.combat.createGroup({ name: 'Вестибюль', leaderId: av0[0].id, memberIds: av0.slice(1).map((o) => o.id), zoneId: 'lobby', doctrine: { hold: 'fallback', fallbackAt: 0.3, roe: 'free' } });
let frames = 0, maxMs = 0, sumMs = 0; let lastDay = 0; let forced = false;
const t0 = Date.now();
while (S.time.day <= DAYS && !S.campaign.result) {
  // утро: наряды по горячим точкам
  if (S.time.day !== lastDay && S.time.minute >= 485) {
    lastDay = S.time.day;
    const hot = S.city.districts.slice().sort((a, b) => b.crime - a.crime).slice(0, 2);
    for (const d of hot) {
      const av = staff.available(game).filter((o) => ['pps', 'uchastkovy'].includes(o.role)); if (av.length < 3) break;
      const r = city.createTask(game, { type: 'patrol', districtId: d.id, officerIds: av.slice(0, 2).map((o) => o.id), leaderId: av[0].id, vehicle: null, orders: { focus: rng.pick(['visible', 'checks', 'kiosks']), durationMin: 360 } });
      console.log(`  ${game.timeStr()} наряд → ${d.name}: ${r.ok ? 'ок' : r.reason}`);
    }
  }
  // ответы на рацию, бумаги, предложения
  if (frames % 50 === 0) {
    for (const m of S.radio) if (m.choices && m.answered == null && rng.chance(0.6)) city.answerRadio(game, m.id, rng.pick(m.choices).id);
    for (const it of S.inbox || []) if (!it.answered && it.choices.length && rng.chance(0.3)) staff.answer(game, it.id, rng.pick(it.choices).id);
    for (const o of S.city.offers) if (!o.answered && rng.chance(0.3)) city.answerOffer(game, o.id, rng.pick(o.choices).id);
    for (const d of S.detainees) if (d.status === 'cell' && rng.chance(0.02)) detainees.interrogate(game, d.id, rng.pick(['soft', 'hard', 'deal', 'threat', 'cellmate']));
  }
  if (!forced && S.time.day === 2 && S.time.minute > 600) { forced = true; game.combat.planAttack(game, S.city.gangs[0].id, 'тест', { inMinutes: 20 }); }
  game.speed = game.combat.active ? 1 : 10; game.paused = false;
  const t = performance.now(); game.update(0.1, inp); const ms = performance.now() - t; frames++; sumMs += ms; if (ms > maxMs) maxMs = ms;
  if (frames > 3e6) break;
}
console.error = origErr; console.warn = origWarn;
const st = S.city.stats.total;
console.log(`\nПрогон: ${frames} кадров за ${((Date.now() - t0) / 1000).toFixed(1)} с; update ср. ${(sumMs / frames).toFixed(3)} мс, макс ${maxMs.toFixed(1)} мс`);
console.log('Время:', game.timeStr(), '| итог кампании:', S.campaign.result, S.campaign.reason || '');
console.log('Всего:', JSON.stringify(st));
console.log('Авторитет', Math.round(S.campaign.authority), 'репутация', Math.round(S.flags.reputation), 'касса', Math.round(S.economy.money));
console.log('Районы:', S.city.districts.map((d) => `${d.name}: пр.${Math.round(d.crime)} дов.${Math.round(d.trust)} прис.${d.presenceAvg}`).join(' | '));
console.log('Банды:', S.city.gangs.map((g) => `${g.name}: сила ${Math.round(g.strength)} злость ${Math.round(g.anger)} ${g.status}`).join(' | '));
console.log('Состав:', Object.entries(S.staff.reduce((m, o) => { m[o.status] = (m[o.status] || 0) + 1; return m; }, {})).map(([k, v]) => `${k}:${v}`).join(' '));
console.log('Задержанные:', S.detainees.map((d) => `${d.person.lastName}(${d.status})`).join(', ') || '—');
console.log('Атаки:', JSON.stringify(attacks));
console.log('Рация:', S.radio.length, '| задачи:', S.city.tasks.length, '| преступлений в памяти:', S.city.crimes.length, '| бумаги:', (S.inbox || []).length, '| предложения:', S.city.offers.length, '| планы атак:', S.attackPlans.length);
console.log('События шины:', Object.entries(ev).sort((a, b) => b[1] - a[1]).slice(0, 28).map(([k, v]) => `${k}:${v}`).join(' '));
console.log('\n— последние сообщения эфира —'); for (const m of S.radio.slice(-10)) console.log(`[Д${m.day} ${String(Math.floor(m.minute / 60)).padStart(2, '0')}:${String(Math.floor(m.minute % 60)).padStart(2, '0')}] ${m.callsign || m.fromName}: ${m.text.slice(0, 260)}`);
console.log('\n— журнал (важное) —'); for (const l of S.log.filter((x) => ['important', 'story', 'authority', 'offer'].includes(x.kind)).slice(-14)) console.log(`Д${l.day}: ${l.text.slice(0, 220)}`);
const bad = JSON.stringify(S).match(/undefined|NaN|\[object Object\]/g); console.log('\nПлохие строки в состоянии:', bad ? bad.length : 0);
try { JSON.parse(JSON.stringify(S)); console.log('Сериализация: ок,', (JSON.stringify(S).length / 1024).toFixed(0), 'КБ'); } catch (e) { console.log('Сериализация: ОШИБКА', e.message); }
console.log(`\nОШИБКИ/ПРЕДУПРЕЖДЕНИЯ (${errs.size}):`); for (const [k, v] of [...errs].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`×${v} ${k}`);
