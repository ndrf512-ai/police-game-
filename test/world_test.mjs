import { World } from '../src/world/world.js';
const w = new World();
console.log(w.dump());
const P = w.points;
const bad = Object.entries(P).filter(([k,p]) => !w.isWalkable(p.x,p.z));
console.log('unwalkable points:', bad.map(b=>b[0]));
const pairs = [['spawn_street_w','ivs_guard'],['player_start','city_map'],['spawn_street_w','cell_2'],['spawn_yard_gate','back_door_in'],['front_door_out','tv_sofa_1'],['spawn_alley','smoke_yard'],['armory_counter','visitor_window']];
for (const [a,b] of pairs){ const t=performance.now(); const p = w.findPath(P[a].x,P[a].z,P[b].x,P[b].z); console.log(a,'->',b, p? p.length+' pts '+w.pathLength(p,P[a].x,P[a].z).toFixed(1)+'m':'NO PATH', (performance.now()-t).toFixed(1)+'ms'); }
console.log('LOS lobby->duty via window', w.lineOfSight(19,17,25,17), 'office->corridor wall', w.lineOfSight(3,5,3,12));
console.log('cover pts', w.coverPoints.length);
