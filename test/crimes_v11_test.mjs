// Проверка типов происшествий версии 1.1 (src/data/crime_types_v11.js): тексты без мусора, обязательные поля, розыск.
// node test/crimes_v11_test.mjs [повторов=5]
import { RNG } from '../src/core/rng.js';
import * as C from '../src/sim/crimes.js';
import { V11 } from '../src/data/crime_types_v11.js';
import { PERP_PROFILES, VICTIM_KINDS, LOOT, EVIDENCE, COMPLICATIONS } from '../src/data/crime_lex.js';
import { V11_VK } from '../src/data/crime_types_v11.js';

const REPS = +(process.argv[2] || 5);
const rng = new RNG(4242);
const gangs = [
  { id: 'g_sport', type: 'sport', name: 'Черёмушкинские', status: 'active', forms: { peopleGen: 'черёмушкинских', peopleIns: 'черёмушкинскими' } },
  { id: 'g_afghan', type: 'afghan', name: 'Афганское братство', status: 'active', forms: { peopleGen: 'афганцев', peopleIns: 'афганцами' } },
  { id: 'g_thieves', type: 'thieves', name: 'Старые', status: 'active', forms: {} },
  { id: 'g_drugs', type: 'drugs', name: 'Аптекари', status: 'active', forms: {} },
  { id: 'g_frost', type: 'frostbitten', name: 'Бешеные', status: 'active', forms: {} },
];
const errs = [];
const fail = (m) => { errs.push(m); };
// мусор: undefined/NaN/null, незакрытые или неразрешённые {…} и […], «|», двойные пробелы, пустые подстановки « ,» / «: .»
const BAD = /undefined|NaN|\[object|null|[{}[\]|]|\s{2}|\s[,.;:]|:\s*\./;
const bad = (s) => typeof s !== 'string' || !s.trim() || BAD.test(s);

/* ---------- данные: обязательные поля и допустимые значения */
const KINDS = new Set(['bank', 'bar', 'church', 'club', 'dacha', 'factory', 'farm', 'flat', 'garage', 'hospital', 'hostel', 'kiosk', 'market', 'office', 'park', 'school', 'shop', 'station', 'street', 'warehouse']);
const CATS = new Set(['violent', 'property', 'drugs', 'organized', 'public_order', 'economic', 'domestic', 'traffic', 'other']);
const HOURS = new Set(['any', 'night', 'evening', 'dusk', 'day', 'work', 'morning']);
const DEPTS = new Set(['ugro', 'pps', 'uchastok', 'duty', 'ivs']);
const GANGS = new Set(['sport', 'afghan', 'thieves', 'drugs', 'frostbitten']);
const FATES = new Set(['lost', 'friend', 'ran_away', 'accident', 'dead', 'kidnapped', 'hospital', 'drunk_friend']);
const VK = new Set([...Object.keys(VICTIM_KINDS), ...Object.keys(V11_VK), 'soldier_v', 'nurse', 'bandit_v', 'junkie_v']);
const ids = new Set(C.CRIME_TYPES.map((t) => t.id));
if (ids.size !== C.CRIME_TYPES.length) fail('повторяющиеся id типов');
if (V11.length < 30) fail(`новых типов ${V11.length} < 30`);
for (const t of V11) {
  const w = (m) => fail(`${t.id}: ${m}`);
  if (!C.CRIME_TYPE_BY_ID[t.id]) w('не подключён в CRIME_TYPES');
  for (const k of ['id', 'name', 'cat', 'sev', 'freq', 'kinds', 'hours', 'perps', 'vic', 'danger', 'solv', 'ip', 'seen', 'flee', 'dur', 'd', 'c', 'x']) if (t[k] == null) w('нет поля ' + k);
  if (!CATS.has(t.cat)) w('категория ' + t.cat);
  if (!HOURS.has(t.hours)) w('hours ' + t.hours);
  for (const k of Object.keys(t.kinds || {})) if (!KINDS.has(k)) w('вид места ' + k);
  for (const k of t.pk || []) if (!PERP_PROFILES[k]) w('pk ' + k);
  for (const k of t.vk || []) if (!VK.has(k)) w('vk ' + k);
  for (const k of t.ev || []) if (!EVIDENCE[k]) w('ev ' + k);
  for (const k of Object.keys(t.gang || {})) if (!GANGS.has(k)) w('gang ' + k);
  for (const k of t.depts || []) if (!DEPTS.has(k)) w('dept ' + k);
  for (const k of t.complFav || []) if (!COMPLICATIONS.some((c) => c.id === k)) w('complFav ' + k);
  if (typeof t.loot === 'string' && !LOOT[t.loot]) w('loot ' + t.loot);
  if (t.vic[1] > 0 && !(t.vk || []).length) w('есть жертвы, нет vk');
  if (t.perps[1] > 0 && !(t.pk || []).length) w('есть исполнители, нет pk');
  if (t.multi && (t.depts || []).length < 2) w('multi без двух отделов');
  for (const k of ['d', 'c', 'x']) if (!Array.isArray(t[k]) || !t[k].length) w('пусто ' + k);
  if (t.d.length < 2 || t.c.length < 1) w('мало вариантов текста');
  if (t.missing) { for (const f of Object.keys(t.missing.fates || {})) if (!FATES.has(f)) w('судьба ' + f); if (t.ip) w('розыск не может быть «в процессе»'); }
}

/* ---------- тексты: по REPS на тип в каждом районе */
let n = 0; const sample = []; const disp = {};
for (const t of V11) {
  for (const d of C.DISTRICTS) {
    if (!d.places.some((p) => t.kinds[p.kind])) continue;
    for (let i = 0; i < REPS; i++) {
      const day = 1 + rng.int(0, 40); const minute = rng.int(0, 1439);
      const cr = C.generateCrime(rng, { district: d, gangs, day, minute, typeId: t.id, heat: rng.next(), weekday: day % 7 });
      n++; (disp[t.id] = disp[t.id] || new Set()).add(cr.text.dispatch.replace(/^[^.]*\.\s*/, ''));
      if (cr.typeId !== t.id) { fail(`${t.id}: сгенерирован ${cr.typeId}`); continue; }
      for (const k of ['dispatch', 'radio', 'caller', 'details']) if (bad(cr.text[k])) fail(`${t.id} ${k}: ${cr.text[k]}`);
      if (cr.text.news != null && bad(cr.text.news)) fail(`${t.id} news: ${cr.text.news}`);
      if (cr.loot != null && bad(cr.loot)) fail(`${t.id} loot: ${cr.loot}`);
      if (!Number.isFinite(cr.solvability) || !Number.isFinite(cr.danger) || !Number.isFinite(cr.durationMin)) fail(`${t.id}: числа`);
      if (t.missing) {
        const m = cr.missing;
        if (!m || !m.person || !m.person.lastName || !FATES.has(m.fate) || !Number.isFinite(m.since) || bad(m.lastSeen) || bad(m.reporter)) fail(`${t.id}: плохой missing ${JSON.stringify(m)}`);
        else if (m.fate === 'kidnapped' && !m.gangId) fail(`${t.id}: kidnapped без банды`);
        if (cr.inProgress) fail(`${t.id}: розыск «в процессе»`);
      } else if (cr.missing) fail(`${t.id}: лишний missing`);
      for (const o of ['detained', 'escaped', 'nothing', 'false_alarm', 'found_body', 'resolved_talk']) { const s = C.outcomeText(rng, cr, o, 'Петров'); if (bad(s)) fail(`${t.id} исход ${o}: ${s}`); }
      if (JSON.stringify(cr).match(/undefined|NaN/)) fail(`${t.id}: undefined/NaN в объекте`);
      if (i === 0 && sample.length < 400) sample.push(cr);
    }
  }
}
// изменчивость: у каждого типа ≥2 разных ядра диспетчера
for (const t of V11) if (!disp[t.id] || disp[t.id].size < 2) fail(`${t.id}: тексты не различаются`);

/* ---------- общий поток: доля новых типов при обычном выборе */
const cnt = {}; let tot = 0;
for (let i = 0; i < 6000; i++) { const d = C.DISTRICTS[i % C.DISTRICTS.length]; const day = 1 + (i % 50); const cr = C.generateCrime(rng, { district: d, gangs, day, minute: rng.int(0, 1439), heat: rng.next(), weekday: day % 7 }); cnt[cr.typeId] = (cnt[cr.typeId] || 0) + 1; tot++; if (bad(cr.text.dispatch) || bad(cr.text.caller) || bad(cr.text.details)) fail(`поток ${cr.typeId}: ${cr.text.dispatch} | ${cr.text.caller} | ${cr.text.details}`); }
const v11n = V11.reduce((s, t) => s + (cnt[t.id] || 0), 0);
const never = V11.filter((t) => !cnt[t.id]).map((t) => t.id);
console.log(`новых типов: ${V11.length}, всего типов: ${C.CRIME_TYPES.length}, текстов проверено: ${n}`);
console.log(`доля новых типов в потоке: ${(v11n / tot * 100).toFixed(1)}%${never.length ? '; не выпали: ' + never.join(', ') : ''}`);
const fq = (arr) => arr.reduce((s, t) => s + t.freq, 0);
console.log(`сумма freq: старые ${fq(C.CRIME_TYPES.filter((t) => !V11.includes(t) && !V11.some((v) => v.id === t.id))).toFixed(1)}, новые ${fq(V11).toFixed(1)}`);
if (process.argv.includes('-v')) for (const c of sample.slice(0, 40)) console.log(`\n[${c.typeId}] D: ${c.text.dispatch}\n  C: ${c.text.caller}\n  X: ${c.text.details}${c.missing ? `\n  M: ${c.missing.fate}, ${c.missing.reporter}, ${c.missing.lastSeen}` : ''}`);
console.log(`\nОШИБКИ (${errs.length}):`); for (const e of errs.slice(0, 40)) console.log(' - ' + e);
process.exitCode = errs.length ? 1 : 0;
