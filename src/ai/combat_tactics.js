// «Участок» — общая тактика: угрозы помещения, расстановка по укрытиям, выбор рубежа (агент D).
import { INDOOR_ZONES } from './doctrine.js';

const distScore = (d, ideal) => 1 - Math.min(1, Math.abs(d - ideal) / 8);

/**
 * Угрозы для помещения zoneId с точки зрения стороны side ('police'|'enemy').
 * → [{x,z,w,o,fromZone}] — проёмы с весом и точки известных врагов внутри.
 */
export function threatsFor(cb, zoneId, side, extra = {}) {
  const nav = cb.nav; const out = [];
  const intel = cb.intel[side];
  const watch = extra.watch || [];
  for (const o of nav.zoneOpenings[zoneId] || []) {
    const other = nav.otherZone(o, zoneId); if (!other) continue;
    let w = 0.15;
    const ownOther = cb.ownerFor(other, side);
    if (!cb.isIndoor(other)) w = side === 'police' ? cb.sideWeight(other) : 0.25;
    if (ownOther === 'enemy') w = Math.max(w, 1.2); else if (ownOther === 'contested') w = Math.max(w, 1.0);
    let n = 0;
    for (const k of intel.values()) { if (cb.t - k.t > 12) continue; if (k.zone === other && Math.hypot(k.x - o.x, k.z - o.z) < 9) n++; }
    w += Math.min(1.6, n * 0.35);
    if (watch.includes(o.ref) || watch.includes(o.id)) w += 0.8;
    if (o.type === 'window' && cb.isIndoor(other)) w *= 0.6;
    if (o.type === 'door' && o.ref && cb.world.doors.find((d) => d.id === o.ref && d.barricade > 0)) w *= 0.9;
    out.push({ x: o.x, z: o.z, w, o, fromZone: other });
  }
  for (const k of intel.values()) {
    if (cb.t - k.t > 6 || k.zone !== zoneId) continue;
    out.push({ x: k.x, z: k.z, w: 1.6, o: null, fromZone: zoneId });
  }
  return out;
}

/**
 * Расставить бойцов: members — акторы; → Map(actorId → {x,z,low,spot,threat}).
 * opts: {ambush, posts:[pointId], current: Map(actorId→spot), noise, ideal, exclude:Set(spotId)}
 */
export function planPositions(cb, zoneId, threats, members, opts = {}) {
  const nav = cb.nav, rng = cb.rng, res = new Map();
  if (!members.length) return res;
  let spots = nav.spots(zoneId).filter((s) => nav.walkable(s.x, s.z) && !cb.fx.fireAt(s.x, s.z, 0.6) && !(opts.exclude && opts.exclude.has(s.id)));
  if (!threats.length) threats = [{ x: cb.world.zoneCenter(zoneId)[0], z: cb.world.zoneCenter(zoneId)[1], w: 0.3, o: null, fromZone: zoneId }];
  if (!spots.length) {
    for (const m of members) { const p = cb.world.randomPointInZone(zoneId, rng) || [m.x, m.z]; res.set(m.id, { x: p[0], z: p[1], low: false, spot: null, threat: threats[0] }); }
    return res;
  }
  const doorsHere = (nav.zoneOpenings[zoneId] || []).filter((o) => o.type === 'door');
  const counts = new Array(threats.length).fill(0);
  const chosen = [];
  const curSpots = new Set(); if (opts.current) for (const s of opts.current.values()) if (s) curSpots.add(s.id);
  const posts = opts.posts || [];
  for (let k = 0; k < members.length; k++) {
    let best = null, bestS = -Infinity, bestT = 0;
    for (const s of spots) {
      if (chosen.some((c) => Math.hypot(c.s.x - s.x, c.s.z - s.z) < 1.25)) continue;
      let base = 0;
      if (s.post) base += posts.includes(s.post) ? 1.2 : 0.35;
      if (curSpots.has(s.id)) base += 0.45;
      for (const d of doorsHere) if (Math.hypot(d.x - s.x, d.z - s.z) < 1.05) base -= 1.6;
      if (opts.noise) base += rng.next() * opts.noise;
      for (let ti = 0; ti < threats.length; ti++) {
        const t = threats[ti]; let sc;
        if (t.o) {
          const ev = nav.evalSpot(s, t.o, t.fromZone);
          if (opts.ambush) { if (!ev.lofIn) continue; sc = ev.prot * 1.5 + (ev.lofOut ? -1.0 : 0.7) + distScore(ev.dist, 3.5); }
          else { if (!ev.lofIn && !ev.lofOut) continue; sc = ev.prot * 1.6 + (ev.lofIn ? 0.8 : 0) + (ev.lofOut ? 0.7 : 0) + distScore(ev.dist, opts.ideal || 6); }
          if (cb.isIndoor(zoneId) && !t.o.exterior) sc -= 0.5 * nav.exposure(s, -1);
        } else {
          if (!nav.lof(s.x, s.z, t.x, t.z)) continue;
          sc = Math.max(0, cb.world.coverBetween(t.x, t.z, s.x, s.z)) * 1.6 + distScore(Math.hypot(s.x - t.x, s.z - t.z), 5) + 0.5;
        }
        const total = (sc * t.w) / (1 + counts[ti] * 0.9) + base;
        if (total > bestS) { bestS = total; best = s; bestT = ti; }
      }
    }
    if (!best) {
      const s = spots.find((x) => !chosen.some((c) => c.s === x)) || spots[0];
      chosen.push({ s, ti: 0 }); continue;
    }
    chosen.push({ s: best, ti: bestT }); counts[bestT]++;
  }
  // распределение по людям: ближние, с учётом характера
  const free = members.slice();
  for (const ch of chosen) {
    if (!free.length) break;
    const t = threats[ch.ti];
    let bm = null, bc = Infinity;
    for (const m of free) {
      const c = m.data.cb || {};
      let cost = Math.hypot(m.x - ch.s.x, m.z - ch.s.z);
      if (opts.current && opts.current.get(m.id) === ch.s) cost -= 6;
      const dThreat = Math.hypot(ch.s.x - t.x, ch.s.z - t.z);
      if (c.marksman) cost -= dThreat * 0.6;
      if (c.hothead) cost += dThreat * 0.5;
      if (c.coward) cost -= dThreat * 0.7;
      if (c.isLeader) cost -= dThreat * 0.3;
      if (cost < bc) { bc = cost; bm = m; }
    }
    free.splice(free.indexOf(bm), 1);
    res.set(bm.id, { x: ch.s.x, z: ch.s.z, low: ch.s.low, spot: ch.s, threat: t });
  }
  for (const m of free) { const s = spots[rng.int(0, spots.length - 1)]; res.set(m.id, { x: s.x, z: s.z, low: s.low, spot: s, threat: threats[0] }); }
  return res;
}

/** Куда отходить из zoneId: ближайшее своё помещение подальше от врага; prefer — зона под охраной */
export function fallbackZoneFor(cb, zoneId, side, prefer = null) {
  const nav = cb.nav; let best = null, bs = -Infinity;
  const enemyPts = [...cb.intel[side].values()].filter((k) => cb.t - k.t < 20);
  const visit = (z, depth) => {
    if (z === zoneId || !cb.isIndoor(z) || cb.ownerFor(z, side) === 'enemy') return;
    const [cx, cz] = cb.world.zoneCenter(z);
    let dmin = 30; for (const k of enemyPts) dmin = Math.min(dmin, Math.hypot(k.x - cx, k.z - cz));
    const ext = (nav.zoneOpenings[z] || []).filter((o) => o.exterior).length;
    let s = dmin * 0.15 - ext * 0.6 - depth * 0.8 + (z === prefer ? 2.5 : 0) + (z === 'corridor' ? 0.6 : 0);
    if (enemyPts.some((k) => k.zone === z)) s -= 4;
    if (s > bs) { bs = s; best = z; }
  };
  for (const o of nav.zoneDoors(zoneId)) { const n = nav.otherZone(o, zoneId); visit(n, 1); for (const o2 of nav.zoneDoors(n)) visit(nav.otherZone(o2, n), 2); }
  return best;
}

/** Самое безопасное своё помещение (для паникующих и раненых) */
export function safestZone(cb, side, x, z) {
  const enemyPts = [...cb.intel[side].values()].filter((k) => cb.t - k.t < 25);
  let best = null, bs = -Infinity;
  for (const zid of INDOOR_ZONES) {
    if (cb.ownerFor(zid, side) !== 'own') continue;
    const [cx, cz] = cb.world.zoneCenter(zid);
    let dmin = 40; for (const k of enemyPts) dmin = Math.min(dmin, Math.hypot(k.x - cx, k.z - cz));
    const ext = (cb.nav.zoneOpenings[zid] || []).filter((o) => o.exterior).length;
    const s = dmin - ext * 3 - Math.hypot(cx - x, cz - z) * 0.15 + (cb.fx.smokeAt(zid) > 0.4 ? -8 : 0);
    if (s > bs) { bs = s; best = zid; }
  }
  return best;
}
