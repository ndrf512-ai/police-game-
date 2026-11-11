// Генератор преступлений и городского контента: тип × место × исполнители × жертвы × детали × осложнения × время × погода.
// Чистые функции: всё через переданный rng. Формат шаблонов — см. src/data/crime_lex.js.
import { uid } from '../core/rng.js';
import { randomPerson, randomNick } from '../core/names.js';
import { declSurname } from '../data/staff_lang.js';
import { DISTRICTS, STREETS, DISTRICT_FORMS } from '../data/districts.js';
import * as LEX from '../data/crime_lex.js';
import { VIOLENT, DOMESTIC } from '../data/crime_types_violent.js';
import { PROPERTY, ORGANIZED, DRUGS, PUBLIC_ORDER, ECONOMIC, TRAFFIC, OTHER } from '../data/crime_types_more.js';
import { NEWS_FILLERS, VISITORS, PATROL_EVENTS, CHATTER, OUTCOMES } from '../data/crime_extra.js';

export { DISTRICTS };

const DEF = { freq: 3, hours: 'any', perps: [1, 2], pk: ['local'], arm: { none: 1 }, vic: [1, 1], vk: ['resident'], vc: { ok: 1 }, loot: null, danger: 0.2, solv: 0.4, ip: 0.2, seen: 0.5, flee: 0.7, dur: [20, 60], car: 0, kinds: { street: 1 } };
export const CRIME_TYPES = [...VIOLENT, ...DOMESTIC, ...PROPERTY, ...ORGANIZED, ...DRUGS, ...PUBLIC_ORDER, ...ECONOMIC, ...TRAFFIC, ...OTHER].map((t) => ({ ...DEF, ...t, category: t.cat, severity: t.sev }));
export const CRIME_TYPE_BY_ID = Object.fromEntries(CRIME_TYPES.map((t) => [t.id, t]));

// дополнительные роли потерпевших (нет в лексиконе)
const EXTRA_VK = {
  soldier_v: { gender: { m: 1 }, age: [18, 21], role: 'военнослужащий срочной службы', folk: '[солдатик|дембель]' },
  nurse: { gender: { f: 1 }, age: [22, 55], role: 'медицинская сестра', folk: '[медсестра|сестричка]' },
  bandit_v: { gender: { m: 1 }, age: [20, 38], role: 'ранее судимый', folk: '[бандит|из этих, бритых]' },
  junkie_v: { gender: { m: 2, f: 1 }, age: [16, 26], role: '{g:молодой человек|девушка}', folk: '{g:[парень|пацан]|[девушка|девчонка]}' },
};

/* ------------------------------------------------------------------ утилиты текста */
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const pk = (rng, v) => (Array.isArray(v) ? rng.pick(v) : (v || ''));
const COLL = ['', 'один', 'двое', 'трое', 'четверо', 'пятеро', 'шестеро', 'семеро'];
function plural(n, a, b, c) { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c; }
function wkey(rng, obj) { const e = Object.entries(obj || {}).filter(([, w]) => w > 0); if (!e.length) return null; return rng.weighted(e, (x) => x[1])[0]; }
function findClose(s, i, o, c) { let d = 0; for (let k = i; k < s.length; k++) { if (s[k] === o) d++; else if (s[k] === c) { d--; if (d === 0) return k; } } return -1; }
function splitTop(s) { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '{' || ch === '[') d++; else if (ch === '}' || ch === ']') d--; if (ch === '|' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; }

/** Развернуть шаблон. env = {vars, flags, roles} */
export function expand(rng, s, env, depth = 0) {
  if (s == null) return ''; s = String(s); if (depth > 8) return s;
  let out = ''; let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '[') { const j = findClose(s, i, '[', ']'); if (j < 0) { out += ch; i++; continue; } out += expand(rng, rng.pick(splitTop(s.slice(i + 1, j))), env, depth + 1); i = j + 1; }
    else if (ch === '{') { const j = findClose(s, i, '{', '}'); if (j < 0) { out += ch; i++; continue; } out += brace(rng, s.slice(i + 1, j), env, depth); i = j + 1; }
    else { out += ch; i++; }
  }
  return out;
}
function brace(rng, inner, env, depth) {
  if (inner[0] === '?' || inner[0] === '!') { // {?flag:то|иначе}
    const k = inner.indexOf(':'); if (k < 0) return ''; const on = !!env.flags[inner.slice(1, k)]; const parts = splitTop(inner.slice(k + 1));
    const yes = (inner[0] === '?') === on; return expand(rng, yes ? parts[0] : (parts[1] || ''), env, depth + 1);
  }
  if (/^[A-Za-z]:/.test(inner)) {
    const r = inner[0].toLowerCase(); const forms = splitTop(inner.slice(2)); const g = env.roles[r] || 'm';
    let f = g === 'f' ? forms[1] : g === 'pl' ? (forms[2] !== undefined ? forms[2] : forms[0]) : forms[0]; if (f === undefined) f = forms[0] || '';
    const res = expand(rng, f, env, depth + 1); return inner[0] !== r ? cap(res) : res;
  }
  let v = env.vars[inner]; let capIt = false;
  if (v === undefined) { const low = inner[0].toLowerCase() + inner.slice(1); if (low !== inner) { v = env.vars[low]; capIt = true; } }
  if (typeof v === 'function') v = v();
  if (v === undefined || v === null) return '';
  v = expand(rng, String(v), env, depth + 1);
  return capIt ? cap(v) : v;
}
export function tidy(s) {
  return String(s).replace(/(\d+) человек(?![а-яё])/g, (m, n) => { const k = +n; const a = k % 10, b = k % 100; return `${n} ${a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'человека' : 'человек'}`; }).replace(/\s+/g, ' ').replace(/\s+([,.!?;:])/g, '$1').replace(/([,;:])\s*([.!?])/g, '$2').replace(/\.\s*\.(?!\.)/g, '.').replace(/([!?])\s*\./g, '$1').replace(/,\s*,/g, ',').replace(/\(\s+/g, '(').replace(/—\s*([.!?])/g, '$1').replace(/:\s*([.!?])/g, '$1').trim();
}
/** Падеж фамилии после «гр.» по соседним словам шаблона */
function casePrep(t) {
  return String(t).replace(/(\S+)?(\s*)гр\. \{vshort\}(\s+\S+)?/g, (all, prev = '', sp, next = '') => {
    const p = prev.toLowerCase().replace(/[,;:]$/, ''); const n = (next || '').trim().toLowerCase();
    let c = 'G';
    if (n.startsWith('причинен') || p === 'принадлежащего' || p === 'принадлежащий' || p === 'к') c = 'D';
    else if (p === 'на' || p === 'водителя') c = 'A';
    else if (p === 'изложенные') c = 'I';
    else if (!prev || /[;:.]$/.test(prev) || ['сторож', 'пострадал', 'пострадала', 'пострадал{v:|а}', 'водитель'].includes(p) || /^(высказывал|обнаружен|лишен|был|находил)/.test(n)) c = 'N';
    return `${prev}${sp}гр. {vshort${c}}${next || ''}`;
  });
}
const shortOf = (p, c = 'n') => (p ? `${declSurname(p.lastName, p.gender, c)} ${p.firstName[0]}.${p.patronymic ? ' ' + p.patronymic[0] + '.' : ''}` : 'неустановленное лицо');

/* ------------------------------------------------------------------ время и погода */
const WEATHER_BY_MONTH = { 10: ['rain', 'rain', 'drizzle', 'fog', 'overcast', 'wind', 'drizzle'], 11: ['sleet', 'rain', 'frost', 'firstsnow', 'overcast', 'wind', 'fog'], 12: ['frost', 'firstsnow', 'frost', 'overcast', 'sleet', 'wind'], 1: ['frost', 'frost', 'firstsnow', 'overcast'] };
export function weatherFor(day) {
  const d = new Date(Date.UTC(1996, 9, 14 + (day - 1))); const m = d.getUTCMonth() + 1; const pool = WEATHER_BY_MONTH[m] || WEATHER_BY_MONTH[12];
  const h = (Math.imul(day + 7, 2654435761) >>> 0) % pool.length; const id = pool[h]; const w = LEX.WEATHER[id];
  const temp = w.t[0] + ((Math.imul(day + 3, 40503) >>> 0) % (w.t[1] - w.t[0] + 1));
  return { id, ...w, temp, m };
}
function daypart(h) { return LEX.DAYPART.find((p) => h >= p.from && h < p.to) || LEX.DAYPART[0]; }
function hourW(mode, h) {
  switch (mode) {
    case 'night': return h >= 22 || h < 5 ? 2.2 : (h >= 20 || h < 7 ? 0.8 : 0.15);
    case 'evening': return h >= 17 && h < 23 ? 2 : (h >= 15 && h < 17 ? 0.7 : (h >= 23 || h < 2 ? 0.8 : 0.2));
    case 'dusk': return h >= 16 && h < 20 ? 2.2 : 0.3;
    case 'day': return h >= 9 && h < 18 ? 1.6 : (h >= 7 && h < 20 ? 0.6 : 0.1);
    case 'work': return h >= 8 && h < 18 ? 1.7 : (h >= 18 && h < 21 ? 0.8 : 0.15);
    case 'morning': return h >= 5 && h < 11 ? 2.2 : 0.25;
    default: return 1;
  }
}

/* ------------------------------------------------------------------ люди */
function money(rng) {
  const sumS = () => { const v = rng.pick([80, 120, 150, 200, 250, 300, 400, 500, 650, 800]); return `около ${v} тысяч рублей`; };
  const sumB = () => { const v = rng.pick([8, 12, 15, 20, 30, 40, 60, 90, 120]); return `около ${v} ${plural(v, 'миллиона', 'миллионов', 'миллионов')} рублей`; };
  const usd = () => `${rng.pick([100, 200, 300, 500, 700, 800, 1200])} долларов США`;
  const usdB = () => { const v = rng.pick([5, 8, 10, 15, 20, 30, 50]); return `около ${v} тысяч долларов`; };
  return { sumS, sumB, usd, usdB };
}
function describe(rng, prof, gender, folk) {
  const k = folk ? 1 : 0; const env = { vars: {}, flags: {}, roles: { g: gender } };
  const pick = (arr) => (Array.isArray(arr) && arr.length ? expand(rng, rng.pick(arr)[k] || '', env) : '');
  const parts = [pick(gender === 'f' && prof.topF ? prof.topF : prof.top)];
  if (rng.chance(0.6)) parts.push(pick(gender === 'f' && prof.hatF ? prof.hatF : prof.hat));
  if (rng.chance(0.35)) parts.push(pick(gender === 'f' ? null : prof.low));
  if (rng.chance(0.3)) parts.push(pick(gender === 'f' ? null : prof.shoes));
  const feat = pick(gender === 'f' && prof.featF ? prof.featF : prof.feat);
  const body = parts.filter(Boolean).join(', ');
  return [body, feat].filter(Boolean).join(folk ? ', ' : '; ');
}
function makePerps(rng, type, gang, armOverride) {
  const n = rng.int(type.perps[0], type.perps[1]); const out = [];
  if (n <= 0) return { perps: out, prof: null, profId: null };
  const profId = gang && rng.chance(0.75) && LEX.GANG_PROFILE[gang.type] ? LEX.GANG_PROFILE[gang.type] : rng.pick(type.pk);
  const prof = LEX.PERP_PROFILES[profId] || LEX.PERP_PROFILES.local;
  const real = Math.min(n, 6); // подробно описываем не больше шести
  for (let i = 0; i < real; i++) {
    const p2 = i > 0 && rng.chance(0.25) ? (LEX.PERP_PROFILES[rng.pick(type.pk)] || prof) : prof;
    const gender = type.pgender || (i === 0 ? wkey(rng, p2.gender) : (p2.gender.f && rng.chance(0.12) ? 'f' : 'm')) || 'm';
    const age = type.page ? rng.int(type.page[0], type.page[1]) : rng.int(p2.age[0], p2.age[1]);
    let armed = wkey(rng, type.arm) || 'none'; if (armOverride && i === 0) armed = armOverride;
    if (!['none', 'knife', 'bat', 'pistol', 'rifle', 'shotgun'].includes(armed)) armed = 'none';
    out.push({ person: randomPerson(rng, gender), nick: gang && rng.chance(0.55) ? randomNick(rng) : null, age, desc: describe(rng, p2, gender, false), folk: describe(rng, p2, gender, true), armed, gangId: gang ? gang.id : null, profile: profId });
  }
  return { perps: out, prof, profId, total: n };
}
function makeVictims(rng, type) {
  const n = rng.int(type.vic[0], type.vic[1]); const out = [];
  for (let i = 0; i < Math.min(n, 5); i++) {
    const kind = rng.pick(type.vk); const K = LEX.VICTIM_KINDS[kind] || EXTRA_VK[kind] || LEX.VICTIM_KINDS.resident;
    const gender = wkey(rng, K.gender) || 'm'; const age = rng.int(K.age[0], K.age[1]);
    const env = { vars: {}, flags: {}, roles: { g: gender } };
    out.push({ person: randomPerson(rng, gender), age, desc: expand(rng, K.role, env), folk: expand(rng, K.folk, env), kind, condition: wkey(rng, type.vc) || 'ok' });
  }
  return { victims: out, total: n };
}
function carDesc(rng) {
  const m = rng.weighted(LEX.CAR_MODELS, (x) => x.w); const c = rng.pick(LEX.CAR_COLORS);
  const base = c.indecl ? `${m.nom} ${c.indecl}` : `${m.g === 'f' ? c[1] : c[0]} ${m.nom}`;
  const env = { vars: { L: () => rng.pick(LEX.PLATE_LETTERS), NUM: () => String(rng.int(100, 999)) }, flags: {}, roles: {} };
  return `${base}, ${expand(rng, rng.pick(LEX.CAR_PLATES), env)}`;
}

/* ------------------------------------------------------------------ выбор типа и места */
function placeWeight(type, p) { const k = type.kinds[p.kind] || 0; if (!k) return 0; const tm = (type.ptags || []).filter((t) => (p.tags || []).some((x) => x.includes(t))).length; return k * (1 + 0.7 * tm); }
function pickType(rng, ctx) {
  const d = ctx.district; const h = ctx.hour ?? Math.floor((ctx.minute || 0) / 60); const heat = ctx.heat ?? 0.5;
  const weekend = ctx.weekday === 5 || ctx.weekday === 6 || (ctx.weekday === 4 && h >= 18);
  const gangTypes = new Set((ctx.gangs || []).filter((g) => (d.influence?.[g.id] ?? 10) >= 5).map((g) => g.type));
  return rng.weighted(CRIME_TYPES, (t) => {
    if (t.minDay && (ctx.day || 1) < t.minDay) return 0;
    let ps = 0; for (const p of d.places || []) ps += placeWeight(t, p); if (!ps) return 0;
    let w = t.freq * hourW(t.hours, h) * Math.min(ps, 14) / 7;
    if (weekend && t.weekend) w *= t.weekend;
    w *= t.sev >= 4 ? 0.35 + heat * 1.3 : t.sev <= 1 ? 1.25 - heat * 0.4 : 1;
    if (t.cat === 'organized' && t.gang && ![...Object.keys(t.gang)].some((k) => gangTypes.has(k))) w *= 0.2;
    if (ctx.payday && (t.cat === 'domestic' || t.cat === 'public_order')) w *= 1.3;
    return w;
  });
}

/* ------------------------------------------------------------------ главное: преступление */
/** ctx:{district, gangs, day, minute, heat?, typeId?, forceInProgress?, hour?, weekday?, payday?} → Crime */
export function generateCrime(rng, ctx) {
  const d = ctx.district || DISTRICTS[0];
  const type = (ctx.typeId && CRIME_TYPE_BY_ID[ctx.typeId]) || pickType(rng, ctx) || CRIME_TYPE_BY_ID.drunk_sleeping;
  const h = ctx.hour ?? Math.floor((ctx.minute || 0) / 60) % 24;
  const pool = (d.places || []).filter((p) => placeWeight(type, p) > 0);
  const place = pool.length ? rng.weighted(pool, (p) => placeWeight(type, p)) : rng.pick(d.places);
  const st = STREETS[place.street] || { full: 'улица', short: 'ул.', on: 'на улице' };
  // банда
  let gang = null;
  if (type.gang) {
    const cands = (ctx.gangs || []).filter((g) => type.gang[g.type] && g.status !== 'broken');
    const gp = type.gp ?? (type.cat === 'organized' ? 0.8 : 0.2);
    if (cands.length && rng.chance(gp)) gang = rng.weighted(cands, (g) => type.gang[g.type] * ((d.influence?.[g.id] ?? 10) + 3));
  }
  // осложнение
  const { perps, prof, profId, total: perpTotal } = makePerps(rng, type, gang, null);
  const { victims, total: vicTotal } = makeVictims(rng, type);
  const hurt = victims.some((v) => v.condition !== 'ok');
  let compl = null;
  if (rng.chance(0.38)) {
    const ok = LEX.COMPLICATIONS.filter((c) => (!c.cats || c.cats.includes(type.cat)) && (!c.types || c.types.includes(type.id)) && (!c.kinds || c.kinds.includes(place.kind)) && (!c.dists || c.dists.includes(d.id)) && (!c.minSev || type.sev >= c.minSev) && (!c.needInj || hurt) && (c.id !== 'sawnoff' || perps.length));
    if (ok.length) compl = rng.weighted(ok, (c) => c.w * ((type.complFav || []).includes(c.id) ? 4 : 1));
  }
  if (compl?.fx?.arm && perps[0]) perps[0].armed = compl.fx.arm;
  const order = ['none', 'bat', 'knife', 'pistol', 'shotgun', 'rifle'];
  const topArm = perps.reduce((a, p) => (order.indexOf(p.armed) > order.indexOf(a) ? p.armed : a), 'none');
  const wf = type.armOverride && topArm !== 'none' ? rng.pick(type.armOverride) : (LEX.WEAPON_FORMS[topArm] ? rng.pick(LEX.WEAPON_FORMS[topArm]) : { nom: 'оружие', ins: 'оружием', gen: 'оружия' });
  const seen = perps.length > 0 && rng.chance(type.seen);
  const inProgress = ctx.forceInProgress != null ? !!ctx.forceInProgress : rng.chance(type.ip);
  const hasCar = !!type.fixCar || rng.chance(type.car || 0);
  const isFake = type.fake ? rng.chance(type.fake) : false;
  const w = weatherFor(ctx.day || 1); const dp = daypart(h); const M = money(rng);
  const p0 = perps[0], v0 = victims[0];
  const pGender = !perps.length ? 'm' : (perpTotal > 1 ? 'pl' : (seen || type.prole ? p0.person.gender : 'm'));
  const role = type.prole ? LEX.PERP_ROLES[type.prole] : null;
  let pn;
  if (!perps.length) pn = 'неизвестные';
  else if (role && perpTotal === 1) pn = p0.person.gender === 'f' ? role.f : role.m;
  else if (!seen) pn = perpTotal > 1 ? 'неизвестные' : 'неизвестный';
  else if (perpTotal === 1) pn = p0.person.gender === 'f' ? rng.pick(prof.nounF || ['женщина']) : rng.pick(prof.noun);
  else if (perpTotal <= 7) pn = `${COLL[perpTotal]} ${rng.pick(prof.pl)}`;
  else pn = perpTotal >= 20 ? `толпа, человек ${perpTotal}` : `группа из ${perpTotal} человек`;
  const DF = DISTRICT_FORMS[d.id] || { nom: d.name, prep: 'в районе', gen: 'района', toward: 'в сторону окраины', to: 'в район' };
  const flatNo = rng.int(1, 140);
  const addrHint = `${st.on}, ${place.house}${place.kind === 'flat' ? `, квартира ${flatNo}` : place.kind === 'hostel' ? `, комната ${rng.int(101, 540)}` : ''}`;
  const quoted = /«([^»]+)»/.exec(place.nom || place.name || '');
  const lootTpl = type.loot == null ? null : Array.isArray(type.loot) ? rng.pick(type.loot) : (LEX.LOOT[type.loot]?.length ? rng.pick(LEX.LOOT[type.loot]) : null);
  const vars = {
    pn, pr: role ? (p0?.person.gender === 'f' ? role.f : role.m) : pn, prDrug: profId === 'junkie' ? 'наркоман' : 'алкоголик',
    psurname: p0 ? shortOf(p0.person) : 'неустановленное лицо',
    vshortN: v0 ? shortOf(v0.person, 'n') : 'неустановленное лицо', vshortG: v0 ? shortOf(v0.person, 'g') : 'неустановленного лица', vshortD: v0 ? shortOf(v0.person, 'd') : 'неустановленному лицу', vshortA: v0 ? shortOf(v0.person, 'a') : 'неустановленное лицо', vshortI: v0 ? shortOf(v0.person, 'i') : 'неустановленным лицом', vshort: v0 ? shortOf(v0.person, 'g') : 'неустановленного лица',
    vage: v0 ? `${v0.age} ${plural(v0.age, 'год', 'года', 'лет')}` : 'лет сорок',
    placePrep: place.prep, placeGen: place.gen, placeShort: quoted ? quoted[1] : (place.nom || place.name), placeNom: place.nom || place.name,
    district: DF.prep, districtNom: DF.nom, districtGen: DF.gen, toward: DF.toward, streetOn: st.on, street: st.full, addrHint, houseHint: `${st.on}, ${place.house}`, addr: place.addr,
    weapon: wf.nom, weaponI: wf.ins, weaponG: wf.gen, weaponPl: { knife: 'ножи', bat: 'биты и арматура', pistol: 'пистолеты', shotgun: 'обрезы', rifle: 'автоматы' }[topArm] || 'палки',
    sumS: M.sumS, sumB: M.sumB, usd: M.usd, usdB: M.usdB, kg: () => String(rng.int(3, 40) * 10), n: () => String(rng.int(2, 7)), nBig: String(Math.max(perpTotal || 0, rng.int(10, 30))), shots: () => String(rng.int(3, 14)),
    car: hasCar ? carDesc(rng) : 'машина, марку не разглядели', hhmm: `${String(h).padStart(2, '0')}:${String(Math.floor((ctx.minute || 0) % 60)).padStart(2, '0')}`,
    gangGen: gang?.forms?.peopleGen || (gang ? `«${gang.name}»` : ''), gangIns: gang?.forms?.peopleIns || (gang ? `«${gang.name}»` : ''), gangName: gang ? gang.name : '',
    daypart: dp.word,
  };
  const loot = lootTpl ? tidy(expand(rng, lootTpl, { vars, flags: {}, roles: {} })) : null;
  vars.loot = loot || 'уточняется';
  const flags = {
    armed: topArm !== 'none', gun: ['pistol', 'rifle', 'shotgun'].includes(topArm), ip: inProgress, car: hasCar, gang: !!gang, many: perpTotal > 1,
    kids: compl?.id === 'kids' || (type.tags || []).includes('kids'), inj: hurt, dead: victims.some((v) => v.condition === 'dead'), night: h >= 22 || h < 6, seen,
  };
  const callerKind = type.who ? wkey(rng, type.who) : (victims.length && type.cv && rng.chance(0.45) ? 'victim' : 'neighbor');
  const callerGender = callerKind === 'victim' && v0 ? v0.person.gender : (rng.chance(0.62) ? 'f' : 'm');
  const env = { vars, flags, roles: { p: pGender, v: v0 ? (vicTotal > 3 ? 'pl' : v0.person.gender) : 'm', c: callerGender, w: rng.chance(0.5) ? 'f' : 'm', g: p0 ? p0.person.gender : 'm' } };
  const X = (t) => tidy(expand(rng, casePrep(t), env));
  // тяжесть и срочность
  let severity = type.sev; if (flags.dead && severity < 4) severity++; if (flags.gun && severity < 3) severity = 3;
  const urgency = severity >= 4 || (inProgress && severity >= 3) ? 'urgent' : severity <= 1 ? 'calm' : 'normal';
  // тексты
  const core = X(rng.pick(type.d));
  const marks = seen && perps.length && !role && rng.chance(0.75) ? ` Приметы: ${perps.slice(0, 2).map((p) => `${p.person.gender === 'f' ? 'женщина' : (p.age < 18 ? 'подросток' : 'мужчина')} ${p.age - (p.age % 5)}–${p.age - (p.age % 5) + 5} лет, ${p.desc}`).join('. Второй — ')}.` : '';
  const wline = w.d[0] && rng.chance(0.28) ? ' ' + rng.pick(w.d) : '';
  const dispBody = tidy(`${cap(st.full)}, ${place.house}${place.kind === 'flat' ? `, квартира ${flatNo}` : ''}${/«/.test(place.nom || '') && place.kind !== 'flat' ? ` — ${place.nom}` : ''}. ${core}${compl ? ' ' + X(pk(rng, compl.d)) : ''}${marks}${wline}`);
  // dispatch — суть (город сам добавляет обращение «Заря, Гранит…»); radio — полный текст эфира
  const dispatch = dispBody;
  const radioFull = tidy(`${rng.pick(LEX.DISPATCH_OPEN[urgency])} ${dispBody} ${X(rng.pick(LEX.DISPATCH_CLOSE[urgency]))}`);
  const mood = isFake ? 'calm' : callerKind === 'victim' && hurt ? 'crying' : severity >= 3 ? 'scared' : type.cat === 'public_order' ? 'angry' : rng.pick(['calm', 'angry', 'scared', 'calm']);
  const cpool = callerKind === 'victim' && type.cv ? type.cv : type.c;
  const folkMarks = seen && p0 && !role && rng.chance(0.5) ? ` ${perpTotal > 1 ? 'Один' : cap(p0.person.gender === 'f' ? 'она' : 'он')} ${p0.folk}.` : '';
  const caller = tidy(`${X(rng.pick(LEX.CALLER_OPEN[mood]))} ${X(rng.pick(cpool))} ${rng.chance(0.7) ? `Это ${st.on}, дом ${place.house}${rng.chance(0.4) ? ', ' + rng.pick(LEX.FOLK_LANDMARK) : ''}.` : `${cap(place.prep)}!`}${folkMarks}${compl?.c && rng.chance(0.6) ? ' ' + X(pk(rng, compl.c)) : ''}${w.f && rng.chance(0.15) ? ` А тут ещё ${rng.pick(w.f)}…` : ''} ${X(rng.pick(LEX.CALLER_CLOSE[mood]))}`);
  // улики и свидетели
  const evid = []; const evPools = [...(type.ev || []), 'common']; if (flags.gun && !evPools.includes('gun')) evPools.unshift('gun'); if (hasCar && !evPools.includes('car')) evPools.push('car');
  for (const k of evPools) if (LEX.EVIDENCE[k] && rng.chance(k === 'common' ? 0.6 : 0.75)) { const e = rng.pick(LEX.EVIDENCE[k]); if (!evid.includes(e)) evid.push(e); }
  if (w.id === 'rain' && rng.chance(0.3)) evid.push(rng.pick(LEX.EVIDENCE.rain)); if ((w.id === 'firstsnow' || w.id === 'frost') && rng.chance(0.4)) evid.push(rng.pick(LEX.EVIDENCE.snow));
  const witnesses = Math.max(0, Math.round((place.kind === 'flat' ? 1 : place.kind === 'market' || place.kind === 'station' ? 4 : 2) * rng.range(0, 1.6) * (flags.night ? 0.5 : 1)));
  const details = tidy(`${cap(dp.word)}, около ${vars.hhmm}, ${place.prep} (${place.addr}) ${X(rng.pick(type.x || ['совершено правонарушение']))}. ${w.x ? cap(w.x) + '.' : ''}${evid.length ? ` С места изъято: ${evid.join(', ')}.` : ''}${witnesses ? ` Установлено очевидцев: ${witnesses}.` : ' Очевидцев не установлено.'}${compl?.x ? ' ' + cap(X(pk(rng, compl.x))) + '.' : ''}`);
  const news = type.n && (severity >= 3 || rng.chance(0.25)) ? X(rng.pick(type.n)) : null;
  const solv = Math.max(0.03, Math.min(1, type.solv + (compl?.fx?.solv || 0) + (seen ? 0.08 : -0.05) + witnesses * 0.02 + evid.length * 0.02));
  const danger = Math.max(0, Math.min(1, type.danger + (compl?.fx?.danger || 0) + (flags.gun ? 0.1 : 0)));
  const tags = [...(type.tags || [])]; if (compl?.fx?.tag) tags.push(compl.fx.tag); if (compl) tags.push('c:' + compl.id); if (isFake) tags.push('false'); if (flags.gun) tags.push('gun'); if (hasCar) tags.push('car');
  return {
    id: uid('cr'), typeId: type.id, category: type.cat, severity, title: type.name, districtId: d.id,
    place: { id: place.id, name: place.name, prep: place.prep, kind: place.kind, value: place.value, addr: place.addr, guardable: place.guardable },
    day: ctx.day || 1, minute: Math.floor(ctx.minute || 0),
    perps: perps.map((p) => ({ person: p.person, nick: p.nick, age: p.age, desc: p.desc, armed: p.armed, gangId: p.gangId })), perpCount: perpTotal || 0,
    victims: victims.map((v) => ({ person: v.person, age: v.age, desc: v.desc, condition: v.condition })), victimCount: vicTotal || 0,
    witnesses, evidence: evid, loot, text: { dispatch, radio: radioFull, caller, news, details }, solvability: solv, danger, gangId: gang ? gang.id : null,
    inProgress, durationMin: rng.int(type.dur[0], type.dur[1]), status: 'new', tags, isFake, weather: w.name, complication: compl ? compl.id : null,
    car: hasCar ? vars.car : null, callerMood: mood, callerKind,
  };
}

/* ------------------------------------------------------------------ исход для рации */
/** outcome: detained|escaped|shootout_win|shootout_loss|prevented|nothing|false_alarm|found_body|resolved_talk */
export function outcomeText(rng, crime, outcome, leaderName = '') {
  const pool = OUTCOMES[outcome] || OUTCOMES.nothing;
  const n = crime?.perpCount || crime?.perps?.length || 1; const p0 = crime?.perps?.[0]; const v0 = crime?.victims?.[0];
  const arm = p0?.armed && p0.armed !== 'none' ? rng.pick(LEX.WEAPON_FORMS[p0.armed] || [{ nom: 'оружие' }]).nom : null;
  const env = {
    vars: { place: crime?.place?.prep || 'на месте', n: n <= 7 ? COLL[n] || String(n) : 'несколько человек', weapon: arm || '', loot: crime?.loot || '', title: (crime?.title || 'происшествие').toLowerCase(), leader: leaderName, nick: p0?.nick || '' },
    flags: { armed: !!arm, many: n > 1, loot: !!crime?.loot, vic: !!v0, inj: !!v0 && v0.condition !== 'ok', dead: !!v0 && v0.condition === 'dead', nick: !!p0?.nick, gang: !!crime?.gangId },
    roles: { p: n > 1 ? 'pl' : (p0?.person?.gender || 'm'), v: v0?.person?.gender || 'm' },
  };
  return tidy(expand(rng, rng.pick(pool), env));
}

/* ------------------------------------------------------------------ новости */
export function generateNews(rng, ctx = {}) {
  const out = []; const day = ctx.day || 1; const w = weatherFor(day);
  const crimes = (ctx.recentCrimes || []).filter((c) => c && c.severity >= 3).slice(0, 6);
  for (const c of rng.sample(crimes, Math.min(crimes.length, rng.int(1, 2)))) {
    const DF = DISTRICT_FORMS[c.districtId]; const title = c.text?.news || `${c.title} ${DF ? DF.prep : ''}`.trim();
    const body = rng.pick([`Как сообщили в пресс-службе ГУВД, ${c.status === 'resolved' ? 'подозреваемые задержаны по горячим следам' : 'преступники скрылись, ведётся розыск'}.`, `Очевидцы рассказали нашему корреспонденту подробности. В милиции от комментариев ${c.status === 'resolved' ? 'не отказались: «Работаем»' : 'воздержались'}.`, `Жители ${DF ? DF.gen : 'района'} говорят, что такое здесь уже никого не удивляет.`]);
    out.push({ title, text: body, districtId: c.districtId, kind: 'crime', crimeId: c.id });
  }
  const usd = 5400 + day * 6 + rng.int(-15, 15);
  const env = { vars: { usd: String(usd), temp: (w.temp > 0 ? '+' : w.temp < 0 ? '−' : '') + Math.abs(w.temp), weather: w.n || w.name, n: () => String(rng.int(2, 9)), month: () => rng.pick(['третий', 'четвёртый', 'пятый', 'шестой']), plant: () => rng.pick(['«Химмаш»', 'механический завод', 'комбинат «Заречье»', 'ткацкая фабрика', 'завод «Металлист»']), score: () => `${rng.int(0, 3)}:${rng.int(0, 3)}`, team: () => rng.pick(['«Локомотив» Н-ск', '«Торпедо»', '«Заря»', '«Текстильщик»', '«Энергия»']) }, flags: { cold: w.temp < 0 }, roles: {} };
  const kinds = rng.sample(Object.keys(NEWS_FILLERS), rng.int(3, 4));
  for (const k of kinds) { const it = rng.pick(NEWS_FILLERS[k]); out.push({ title: tidy(expand(rng, it[0], env)), text: tidy(expand(rng, it[1] || '', env)), districtId: null, kind: k }); }
  out.push({ title: `Погода: ${w.n || w.name}, ${env.vars.temp}`, text: `Курс доллара на ММВБ — ${usd} руб.`, districtId: null, kind: 'weather' });
  return out;
}

/* ------------------------------------------------------------------ посетители, звонки, патруль, эфир */
function lookFor(rng, gender, age, uniform) {
  return { uniform: uniform || (gender === 'f' ? 'civil_f' : 'civil_m'), gender, skin: rng.int(0, 3), hair: age > 58 ? 4 : rng.int(0, 5), hat: gender === 'f' ? rng.pick(['scarf', 'none', 'beanie']) : rng.pick(['none', 'cap', 'ushanka', 'beanie']), armor: false, weapon: 'none', build: Math.round(rng.range(0.88, 1.12) * 100) / 100, old: age > 58 };
}
/** Посетитель у окошка дежурного */
export function generateVisitor(rng, ctx = {}) {
  const d = ctx.district || DISTRICTS[0];
  let arch;
  if (ctx.scoutGangId) arch = VISITORS.find((v) => v.id === 'scout');
  else if (ctx.crime) arch = VISITORS.find((v) => v.id === 'victim_statement');
  else arch = rng.weighted(VISITORS.filter((v) => !v.special), (v) => v.w * (v.minTrust && (ctx.trust ?? 40) < v.minTrust ? 0.2 : 1));
  const gender = arch.gender ? wkey(rng, arch.gender) : (rng.chance(0.5) ? 'f' : 'm'); const age = rng.int(arch.age[0], arch.age[1]);
  const person = ctx.crime?.victims?.[0]?.person && arch.id === 'victim_statement' ? ctx.crime.victims[0].person : randomPerson(rng, gender);
  let crime = null;
  if (arch.crimeType && !ctx.crime) { try { crime = generateCrime(rng, { district: d, gangs: ctx.gangs || [], day: ctx.day || 1, minute: ctx.minute || 600, typeId: rng.pick([].concat(arch.crimeType)), forceInProgress: false }); } catch (e) { crime = null; } }
  const cr = ctx.crime || crime; const M = money(rng); const st = STREETS[rng.pick(d.streets || [])] || { on: 'на нашей улице' };
  const env = { vars: { sumS: M.sumS, usd: M.usd, district: (DISTRICT_FORMS[d.id] || {}).prep || 'в районе', streetOn: st.on, title: (cr?.title || 'происшествие').toLowerCase(), place: cr?.place?.prep || 'во дворе', loot: cr?.loot || 'всё, что было', n: () => String(rng.int(2, 6)), name: person.firstName }, flags: { crime: !!cr, loot: !!cr?.loot }, roles: { c: person.gender, v: person.gender } };
  const E = (t) => tidy(expand(rng, t, env));
  const lines = rng.pick(arch.lines).map(E);
  return {
    id: uid('vis'), kind: arch.id, person, age, look: lookFor(rng, person.gender, age, arch.uniform), mood: rng.pick([].concat(arch.mood)), lines, complaint: E(arch.complaint),
    crime: arch.id === 'scout' ? null : cr, isFake: !!arch.fake || !!ctx.fake, scoutGangId: ctx.scoutGangId || null,
    choices: arch.choices.map((c) => ({ id: c.id, label: E(c.label), desc: c.desc ? E(c.desc) : undefined, effect: c.effect || {} })),
  };
}
/** Звонок дежурному */
export function generateCall(rng, ctx = {}) {
  let cr = ctx.crime;
  if (!cr) cr = generateCrime(rng, { ...ctx, forceInProgress: true });
  const g = cr.callerKind === 'victim' && cr.victims?.[0] ? cr.victims[0].person.gender : (rng.chance(0.6) ? 'f' : 'm');
  const callerDesc = cr.callerKind === 'victim' ? (g === 'f' ? 'потерпевшая' : 'потерпевший') : rng.pick(g === 'f' ? ['соседка', 'женщина, не представилась', 'продавщица из ларька напротив', 'пенсионерка с первого этажа', 'прохожая'] : ['сосед', 'мужчина, не представился', 'сторож', 'таксист', 'прохожий', 'вахтёр']);
  const parts = String(cr.text?.caller || '').split(/(?<=[.!?…])\s+/).filter(Boolean);
  return { id: uid('call'), callerDesc, callerGender: g, mood: cr.callerMood || 'scared', lines: parts.length ? parts : ['Алло, милиция?'], crime: cr };
}
/** Мелкое событие во время патруля */
export function patrolEvent(rng, ctx = {}) {
  const d = ctx.district || DISTRICTS[0]; const place = ctx.place || rng.pick(d.places); const h = ctx.hour ?? 12; const night = ctx.night ?? (h >= 22 || h < 6);
  const pool = PATROL_EVENTS.filter((e) => (!e.night || night) && (!e.day || !night) && (!e.kinds || e.kinds.includes(place.kind)) && (!e.focus || !ctx.focus || e.focus.includes(ctx.focus)));
  const ev = rng.weighted(pool.length ? pool : PATROL_EVENTS, (e) => e.w * (e.focus && ctx.focus && e.focus.includes(ctx.focus) ? 2.5 : 1));
  const st = STREETS[place.street] || { on: 'на улице' }; const M = money(rng);
  const env = { vars: { place: place.prep, placeGen: place.gen, streetOn: st.on, sumS: M.sumS, usd: M.usd, n: () => String(rng.int(2, 6)), car: () => carDesc(rng), district: (DISTRICT_FORMS[d.id] || {}).prep || '' }, flags: { night }, roles: { c: rng.chance(0.5) ? 'f' : 'm' } };
  let crime = null;
  if (ev.crimeType && rng.chance(ev.crimeP ?? 1)) { try { crime = generateCrime(rng, { district: d, gangs: ctx.gangs || [], day: ctx.day || 1, minute: ctx.minute || h * 60, hour: h, typeId: rng.pick([].concat(ev.crimeType)), forceInProgress: true }); } catch (e) { crime = null; } }
  const out = { text: tidy(expand(rng, rng.pick(ev.t), env)), kind: ev.kind || 'info', crime };
  if (ev.q) out.choice = { question: tidy(expand(rng, ev.q, env)), options: ev.o.map(([id, label]) => ({ id, label })) };
  return out;
}
/** Фоновая реплика эфира */
export function chatter(rng, ctx = {}) {
  const w = weatherFor(ctx.day || 1); const h = Math.floor((ctx.minute || 0) / 60);
  const env = { vars: { weather: rng.pick(w.f || ['сыро']), n: () => String(rng.int(2, 9)), hh: String(h).padStart(2, '0'), cs: () => rng.pick(['Сокол-2', 'Берёза-1', 'Волга-3', 'Кедр-4', 'Урал-2', 'Байкал-1']), streetOn: () => rng.pick(Object.values(STREETS)).on, score: () => `${rng.int(0, 3)}:${rng.int(0, 3)}` }, flags: { night: h >= 22 || h < 6 }, roles: {} };
  return tidy(expand(rng, rng.pick(CHATTER), env));
}
