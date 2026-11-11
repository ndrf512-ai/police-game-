import { RNG } from '../src/core/rng.js';
import * as C from '../src/sim/crimes.js';
const rng = new RNG(12345);
const gangs = [{ id: 'g_sport', type: 'sport', name: 'Черёмушкинские', status: 'active', forms: { peopleGen: 'черёмушкинских', peopleIns: 'черёмушкинскими' } }, { id: 'g_afghan', type: 'afghan', name: 'Афганское братство', status: 'active', forms: { peopleGen: 'афганцев', peopleIns: 'афганцами' } }, { id: 'g_thieves', type: 'thieves', name: 'Старые', status: 'active', forms: {} }, { id: 'g_drugs', type: 'drugs', name: 'Аптекари', status: 'active', forms: {} }, { id: 'g_frost', type: 'frostbitten', name: 'Бешеные', status: 'active', forms: {} }];
console.log('types', C.CRIME_TYPES.length, 'districts', C.DISTRICTS.length, 'places', C.DISTRICTS.reduce((s, d) => s + d.places.length, 0));
const bad = (s) => typeof s !== 'string' || /undefined|NaN|\[object|null|[{}\[\]|]|  /.test(s);
const N = 3000; const seen = new Set(); const cats = {}, dists = {}, types = {}; let badN = 0; const samples = []; const badS = [];
for (let i = 0; i < N; i++) {
  const d = C.DISTRICTS[i % 6]; const day = 1 + (i % 60); const minute = rng.int(0, 1439);
  const cr = C.generateCrime(rng, { district: d, gangs, day, minute, heat: rng.next(), weekday: day % 7 });
  seen.add(cr.text.dispatch); cats[cr.category] = (cats[cr.category] || 0) + 1; dists[d.id] = (dists[d.id] || 0) + 1; types[cr.typeId] = (types[cr.typeId] || 0) + 1;
  for (const k of ['dispatch', 'caller', 'details']) if (bad(cr.text[k])) { badN++; if (badS.length < 12) badS.push(cr.typeId + ' ' + k + ': ' + cr.text[k]); }
  if (cr.text.news && bad(cr.text.news)) { badN++; badS.push('news ' + cr.text.news); }
  if (cr.loot && bad(cr.loot)) { badN++; badS.push('loot ' + cr.loot); }
  for (const o of ['detained', 'escaped', 'shootout_win', 'shootout_loss', 'prevented', 'nothing', 'false_alarm', 'found_body', 'resolved_talk']) { const t = C.outcomeText(rng, cr, o, 'Петров'); if (bad(t)) { badN++; if (badS.length < 20) badS.push('out ' + o + ': ' + t); } }
  if (i % 250 === 7) samples.push(cr);
}
console.log('unique dispatch', (seen.size / N * 100).toFixed(1) + '%', 'bad', badN); console.log(cats); console.log(dists);
console.log('never generated:', C.CRIME_TYPES.filter((t) => !types[t.id]).map((t) => t.id).join(', ') || '—');
console.log(badS.join('\n'));
for (const c of samples.slice(0, 7)) console.log(`\n=== ${c.title} [${c.category} sev${c.severity}] ${c.districtId} ip=${c.inProgress} gang=${c.gangId}\nD: ${c.text.dispatch}\nC: ${c.text.caller}\nX: ${c.text.details}\nN: ${c.text.news}\nOUT: ${C.outcomeText(rng, c, 'detained', 'Петров')}`);
console.log('\n--- NEWS'); for (const n of C.generateNews(rng, { day: 12, recentCrimes: samples })) { console.log('*', n.title, '—', n.text); if (bad(n.title) || bad(n.text)) console.log('  BAD'); }
console.log('\n--- VISITORS'); for (let i = 0; i < 40; i++) { const v = C.generateVisitor(rng, { district: C.DISTRICTS[i % 6], gangs, day: 3, minute: 700, trust: 50, scoutGangId: i === 5 ? 'g_sport' : null }); for (const l of [...v.lines, v.complaint, ...v.choices.map((c) => c.label + (c.desc || ''))]) if (bad(l)) console.log('BAD visitor', v.kind, l); if (i < 4 || i === 5) console.log(`[${v.kind}/${v.mood}] ${v.person.lastName}, ${v.age}: ${v.lines.join(' / ')} => ${v.choices.map((c) => c.label).join(' | ')}`); }
console.log('\n--- PATROL'); for (let i = 0; i < 60; i++) { const d = C.DISTRICTS[i % 6]; const e = C.patrolEvent(rng, { district: d, place: rng.pick(d.places), hour: i % 24, gangs, day: 2, minute: 600, focus: ['checks', 'drunks', 'kiosks', 'drugs', 'visible'][i % 5] }); if (bad(e.text) || (e.choice && bad(e.choice.question))) console.log('BAD patrol', e.text); if (i < 6) console.log('-', e.text, e.choice ? '?? ' + e.choice.options.map((o) => o.label).join(' | ') : '', e.crime ? '[crime ' + e.crime.typeId + ']' : ''); }
console.log('\n--- CHATTER'); for (let i = 0; i < 40; i++) { const t = C.chatter(rng, { day: 5, minute: i * 30 }); if (bad(t)) console.log('BAD', t); if (i < 5) console.log('-', t); }
const call = C.generateCall(rng, { district: C.DISTRICTS[2], gangs, day: 4, minute: 1300 }); console.log('\n--- CALL', call.callerDesc, call.lines);
