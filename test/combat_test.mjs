// Бой крупным планом: node test/combat_test.mjs [seed] [gangIndex] [size] [verbose]
import { Game } from '../src/game.js';
import * as crimes from '../src/sim/crimes.js';
import { city } from '../src/sim/city.js';
import { staff } from '../src/sim/staff.js';
import { economy } from '../src/sim/economy.js';
import { detainees } from '../src/sim/detainees.js';
import { campaign } from '../src/sim/campaign.js';
import { StationAI } from '../src/ai/station.js';
import { Combat } from '../src/ai/combat.js';
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
export function fight(seed, gi = 0, size = null, verbose = false, setup = null) {
  const game = new Game({ sim: { crimes, city, staff, economy, detainees, campaign }, seed }); game.StationAI = StationAI; game.combat = new Combat(game);
  game.newGame({ seed, gender: 'm' }); const S = game.state; const cb = game.combat;
  const inp = { mx: 0, my: 0, run: false, lookDX: 0, lookDY: 0, pressed: new Set(), held: new Set() };
  for (let i = 0; i < 300; i++) { game.speed = 1; game.paused = false; game.update(0.1, inp); } // 30 с жизни участка
  if (setup) setup(game);
  const g = S.city.gangs[gi % S.city.gangs.length];
  const plan = cb.planAttack(game, g.id, 'тест', { inMinutes: 1 }); if (size) plan.size = size;
  const shots = { police: 0, enemy: 0 }, hits = { police: 0, enemy: 0 }; let result = null;
  game.bus.on('shot', (e) => { const f = cb.fighters.get(e.by); if (f) shots[f.side]++; });
  game.bus.on('attack:end', (p) => { result = p; });
  if (verbose) { game.bus.on('say', (p) => console.log(`   ${p.name || '?'}: ${p.text}`)); game.bus.on('zone:changed', (p) => console.log(`   [зона] ${p.zoneId} → ${p.owner}`)); game.bus.on('actor:death', ({ actor }) => console.log(`   ✝ ${actor.team} ${actor.name} @${actor.zone}`)); }
  let t = 0; const P0 = () => [...cb.fighters.values()];
  while (!result && t < 400) {
    game.speed = 1; game.paused = false; game.update(0.1, inp); t += 0.1;
    if (verbose && Math.abs(t % 10) < 0.05 && S.attack) { const F = P0(); console.log(`t=${t.toFixed(0)} пол:${F.filter((f) => f.side === 'police' && f.a.alive).map((f) => `${f.a.zone[0]}${Math.round(f.a.hp)}${f.fled ? '!' : ''}${f.target ? '*' : ''}`).join(',')} | банд:${F.filter((f) => f.side === 'enemy' && f.a.alive).map((f) => `${f.a.zone.slice(0, 3)}${Math.round(f.a.hp)}${f.fled ? '!' : ''}${f.target ? '*' : ''}`).join(',')} | выстр ${shots.police}/${shots.enemy}`); }
  }
  return { result: result?.result || 'timeout', losses: result?.losses, t: Math.round(t), shots, gang: g.type, size: plan.size, defenders: S.staff.filter((o) => o.status !== 'home' && o.status !== 'leave').length, playerHp: Math.round(game.player.hp) };
}
if (process.argv[1].endsWith('combat_test.mjs')) {
  const seed = +(process.argv[2] || 778); const r = fight(seed, +(process.argv[3] || 0), +(process.argv[4] || 0) || null, !!process.argv[5]); console.log(JSON.stringify(r));
}
