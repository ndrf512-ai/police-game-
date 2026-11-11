// Занятия сотрудников участка для utility-ИИ: доступность, полезность (score) и план (шаги Seq).
// b — OfficerBrain (см. station_brains.js). Все длительности — в секундах актора (= игровых минутах).
import { Seq } from './station_brains_core.js';
import { SPOTS, PATROL_ROUTE, CELL_IDS, cellGeom } from './station_util.js';

const R = (a, b) => [a, b];
const sq = (x) => x * x;

/** Общий конструктор: дойти до точки и «пробыть» там с тиком */
function stay(b, def, target, o = {}) {
  const steps = [
    { go: target, stand: o.stand, run: o.run },
    { hold: o.dur || R(20, 40), start: o.start, tick: o.tick },
    o.after ? { do: o.after } : null,
  ];
  return new Seq(b, steps, { id: def.id, label: o.label || def.label, def, onEnd: o.onEnd });
}
/** Периодическое действие в тике: каждые every секунд с шансом p */
function every(st, key, sec, fn) {
  st[key] = (st[key] ?? sec * 0.5) - (st._dt || 0);
  if (st[key] <= 0) { st[key] = sec * (0.7 + Math.random() * 0.6); fn(); }
}
const sip = (b, st, dt, need, perSec, anim = 'drink') => {
  st._dt = dt; b.sat(need, dt, perSec);
  every(st, '_sip', 6, () => b.a.playAnim(anim, 1.6));
};

const leisureSpot = (b, ids) => b.st.firstFree(ids, b.a, true);

export const ACTS = [
  // ——— секретарь (вольнонаёмная): печатает, носит бумаги, приносит чай, при бое прячется ———
  {
    id: 'secretary_desk', label: 'печатает на машинке', zone: 'office', duty: true, seat: true,
    avail: (b) => b.civilian && !b.st.combat,
    score: (b) => 0.9 + 0.2 * b.disc,
    plan: (b, def) => {
      if (!b.st.isFree('secretary_desk', b.a)) return null;
      return stay(b, def, 'secretary_desk', {
        dur: R(40, 110),
        tick: (b, dt, st) => { st._dt = dt; every(st, '_w', 7, () => { b.a.playAnim('write', 4); b.st.audio('typewriter', b.a.x, b.a.z, 0.4); }); },
      });
    },
  },
  {
    id: 'carry_papers', label: 'несёт бумаги', duty: true,
    avail: (b) => b.civilian && !b.st.combat && b.f.minute >= 8 * 60 + 15 && (b.st.game.sim?.departments?.pendingPapers?.(b.st.game) || []).length > 0,
    score: (b) => 1.7 + 0.2 * b.disc,
    cool: 15,
    plan: (b, def) => {
      const game = b.st.game; const dep = game.sim?.departments; if (!dep) return null;
      const q = dep.pendingPapers(game); if (!q.length) return null;
      const pq = q[0]; pq.carried = true;
      const from = { ugro: 'dept_ugro', pps: 'dept_pps', uchastok: 'dept_uchastok', duty: 'dept_duty', ivs: 'dept_ivs', sled: 'dept_sled', spec: 'dept_spec' }[pq.deptId] || 'dept_duty';
      let delivered = false;
      const steps = [
        { go: from, stand: true, optional: true },
        { hold: R(2, 4), start: (b) => { b.a.playAnim('talk', 2); if (b.rng.chance(0.4)) b.say('secretary_fetch'); } },
        { do: (b) => { b.a.data.holding = 'papers'; } },
        { go: 'commander_desk_side', stand: true },
        { hold: 1.6, start: (b) => { b.a.playAnim('write', 1.5); } },
        { do: (b) => { b.a.data.holding = null; delivered = true; dep.deliverPaper(game, pq.id, b.id); b.say('secretary_paper'); } },
        { hold: R(1, 2) },
      ];
      return new Seq(b, steps, { id: def.id, label: def.label, def, onEnd: (b) => { b.a.data.holding = null; if (!delivered) pq.carried = false; } });
    },
  },
  {
    id: 'serve_tea', label: 'несёт чай начальнику', duty: true,
    avail: (b) => { const h = Math.floor(b.f.minute / 60); const slot = h === 10 ? 'am' : h === 16 ? 'pm' : null; return b.civilian && !b.st.combat && slot && !b.flags['tea_' + slot] && b.st.game.world.zoneAt(b.st.game.player.x, b.st.game.player.z) === 'office'; },
    score: (b) => 1.3,
    cool: 40,
    plan: (b, def) => {
      const h = Math.floor(b.f.minute / 60); const slot = h === 10 ? 'am' : 'pm';
      const steps = [
        { go: 'kettle', stand: true, optional: true, timeout: 40 },
        { hold: R(4, 6), start: (b) => { b.a.playAnim('write', 2); } },
        { do: (b) => { b.a.data.holding = 'mug'; b.flags['tea_' + slot] = true; } },
        { go: 'commander_desk_side', stand: true },
        { hold: 2, start: (b) => { b.a.data.holding = null; b.say('secretary_tea'); const g = b.st.game; if (g.world.zoneAt(g.player.x, g.player.z) === 'office') { g.player.hp = Math.min(100, g.player.hp + 3); g.bus?.emit('toast', { text: 'Секретарь принесла чай. Горячий, с сахаром.', kind: 'good' }); } } },
      ];
      return new Seq(b, steps, { id: def.id, label: def.label, def, onEnd: (b) => { b.a.data.holding = null; } });
    },
  },
  {
    id: 'hide_civil', label: 'прячется', duty: true,
    avail: (b) => b.civilian && b.st.combat,
    score: () => 9,
    plan: (b, def) => new Seq(b, [
      { go: 'office_corner', stand: true, run: true, optional: true, timeout: 25 },
      { hold: 600, start: (b) => { b.a.pose = 'crouch'; b.a.data.hiding = true; if (b.rng.chance(0.5)) b.say('visitor_hide'); }, tick: (b) => (b.st.combat ? 'stay' : 'done') },
    ], { id: def.id, label: def.label, def, onEnd: (b) => { b.a.pose = 'stand'; b.a.data.hiding = false; } }),
  },
  // ——— обязанности ———
  {
    id: 'duty_desk', label: 'дежурит за пультом', zone: 'duty', duty: true, seat: true,
    avail: (b) => b.assign === 'duty' || b.cover,
    score: (b) => {
      if (b.cover) return 1.25;
      let s = 0.95 + 0.3 * b.disc - (b.has('lazy') ? 0.15 : 0);
      if (b.f.visitorWaiting || b.f.phoneRinging) s += 1.8;
      if (b.bossNear) s += 0.25;
      return s;
    },
    plan: (b, def) => {
      if (!b.st.isFree('duty_desk', b.a)) { if (!b.cover) b.st.releaseCover(); return null; }
      return stay(b, def, 'duty_desk', {
        dur: R(60, 140), label: b.cover ? 'подменяет дежурного' : def.label,
        tick: (b, dt, st) => b.deskTick(dt, st),
        onEnd: (b) => { b.a.data.dozing = false; },
      });
    },
  },
  {
    id: 'monitors', label: 'смотрит в мониторы', zone: 'duty', duty: true, seat: true,
    avail: (b) => b.assign === 'duty2' && !b.cover,
    score: (b) => 0.75 + 0.25 * b.disc,
    plan: (b, def) => stay(b, def, 'monitors', {
      dur: R(60, 120), tick: (b, dt, st) => { st._dt = dt; every(st, '_w', 18, () => b.a.playAnim('write', 2.5)); },
    }),
  },
  {
    id: 'ivs_guard', label: 'на посту конвоя', zone: 'ivs', duty: true, seat: true,
    avail: (b) => b.assign === 'guard',
    score: (b) => 0.8 + 0.3 * b.disc + (b.st.clock - b.st.prisonerNoise < 15 ? 0.3 : 0),
    plan: (b, def) => {
      const p = b.st.isFree('ivs_guard', b.a) ? 'ivs_guard' : (b.st.isFree('post_ivs', b.a) ? 'post_ivs' : null);
      if (!p) return null;
      return stay(b, def, p, {
        dur: R(40, 90),
        tick: (b, dt, st) => {
          if (b.st.clock - b.st.prisonerNoise < 3 && b.st.clock - (b.lastShout || -99) > 25) { b.lastShout = b.st.clock; b.say('guard_shout'); }
        },
      });
    },
  },
  {
    id: 'guard_round', label: 'обходит камеры', zone: 'ivs', duty: true,
    avail: (b) => b.assign === 'guard' && b.st.occupiedCells().length > 0,
    score: (b) => Math.min(1.3, (b.st.clock - (b.lastRound || 0)) / 70) * (0.6 + 0.5 * b.disc),
    cool: 20,
    plan: (b, def) => {
      const steps = [];
      for (const c of b.st.occupiedCells()) {
        steps.push({ go: cellGeom(c).front, stand: true });
        steps.push({ hold: R(2, 4), start: (b) => { if (b.rng.chance(0.35)) b.say('guard_round'); b.st.guardAtCell(b, c); } });
      }
      steps.push({ do: (b) => { b.lastRound = b.st.clock; } });
      return new Seq(b, steps, { id: def.id, label: def.label, def });
    },
  },
  {
    id: 'opers_desk', label: 'работает с бумагами', zone: 'opers', duty: true, seat: true,
    avail: (b) => b.role === 'oper' && !b.assign,
    score: (b) => (b.f.minute < 7 * 60 ? 0.25 : 0.75 + 0.2 * b.disc),
    plan: (b, def) => {
      const p = b.st.firstFree(['opers_desk_1', 'opers_desk_2', 'corridor_bench'], b.a);
      if (!p) return null;
      return stay(b, def, p, {
        dur: R(60, 150),
        tick: (b, dt, st) => {
          st._dt = dt;
          every(st, '_w', 9, () => { b.a.playAnim('write', 3); if (p === 'opers_desk_1') b.st.audio('typewriter', b.a.x, b.a.z, 0.5); });
        },
      });
    },
  },
  {
    id: 'interrogate', label: 'допрашивает задержанного', zone: 'opers', duty: true,
    avail: (b) => b.role === 'oper' && !b.assign && b.f.minute >= 8 * 60 && b.f.minute < 21 * 60 && b.st.canInterrogate(),
    score: (b) => 0.55 + (b.has('ambitious') ? 0.2 : 0) + 0.15 * b.disc,
    cool: 240,
    plan: (b) => b.st.startInterrogation(b),
  },
  {
    id: 'paperwork', label: 'пишет рапорты', zone: 'corridor', duty: true, seat: true,
    avail: (b) => b.role === 'uchastkovy' && !b.assign,
    score: (b) => 0.6 + 0.2 * b.disc,
    plan: (b, def) => {
      const p = b.st.firstFree(['opers_desk_2', 'opers_desk_1', 'corridor_bench', 'rest_chair'], b.a);
      if (!p) return null;
      return stay(b, def, p, { dur: R(50, 110), tick: (b, dt, st) => { st._dt = dt; every(st, '_w', 10, () => b.a.playAnim('write', 3)); } });
    },
  },
  {
    id: 'sled_work', label: 'пишет протоколы по делам', zone: 'opers', duty: true, seat: true,
    avail: (b) => b.role === 'sledovatel' && !b.assign,
    score: (b) => 0.7 + 0.25 * b.disc,
    plan: (b, def) => {
      const p = b.st.firstFree(['opers_desk_2', 'opers_desk_1', 'dept_sled', 'corridor_bench'], b.a);
      if (!p) return null;
      return stay(b, def, p, { stand: p === 'dept_sled', dur: R(60, 140), tick: (b, dt, st) => { st._dt = dt; every(st, '_w', 8, () => b.a.playAnim('write', 3)); } });
    },
  },
  {
    id: 'spec_training', label: 'тренируется в оружейке', zone: 'armory', duty: true,
    avail: (b) => b.role === 'spec' && !b.assign && !b.st.combat,
    score: (b) => 0.55 + 0.25 * b.disc + (b.f.night ? -0.25 : 0),
    cool: 30,
    plan: (b, def) => {
      const p = b.st.firstFree(['spec_rest_1', 'spec_rest_2', 'spec_rest_3'], b.a);
      if (!p) return null;
      const kind = b.rng.pick(['reload', 'punch', 'reload']);
      return stay(b, def, p, {
        stand: true, dur: R(40, 90), label: kind === 'punch' ? 'отрабатывает рукопашную' : 'тренируется с оружием',
        tick: (b, dt, st) => { st._dt = dt; every(st, '_t', 5, () => b.a.playAnim(kind, 2)); },
        after: (b) => { const o = b.o; if (o && o.skills) { o.flags = o.flags || {}; o.flags.specTrainDay = b.st.game.state.time.day; } },
      });
    },
  },
  {
    id: 'car', label: 'возится с машиной', zone: 'street', duty: true, outdoor: true,
    avail: (b) => b.role === 'driver' && !b.assign && b.f.minute >= 7 * 60 && b.f.minute < 21 * 60 && b.st.vehicleSpot(),
    score: (b) => 0.55,
    cool: 90,
    plan: (b, def) => {
      const p = b.st.vehicleSpot(); if (!p || !b.st.isFree(p, b.a)) return null;
      return stay(b, def, p, { stand: true, dur: R(35, 70), start: (b) => { if (b.rng.chance(0.5)) b.say('car'); } });
    },
  },
  {
    id: 'dog', label: 'проведывает собаку', zone: 'yard', duty: true, outdoor: true,
    avail: (b) => b.role === 'kinolog' && !b.assign,
    score: () => 0.5, cool: 150,
    plan: (b, def) => stay(b, def, 'v_yard_dog', { stand: true, dur: R(25, 50), start: (b) => { b.say('dog'); b.st.audio('dog_far', b.a.x, b.a.z, 0.6); } }),
  },
  {
    id: 'reserve', label: 'сидит в резерве', zone: 'rest', duty: true, leisure: true, seat: true,
    avail: (b) => !b.assign && ['pps', 'guard', 'kinolog', 'driver', 'spec'].includes(b.role),
    score: () => 0.32,
    plan: (b, def) => {
      const p = leisureSpot(b, ['rest_chair', 'corridor_bench', 'tv_armchair', 'v_rest_stand_2']);
      if (!p) return null;
      const clean = b.rng.chance(0.4);
      return stay(b, def, p, {
        dur: R(40, 90), label: clean ? 'чистит пистолет' : def.label,
        start: (b) => { if (b.rng.chance(0.15)) b.say('reserve'); },
        tick: (b, dt, st) => { st._dt = dt; if (clean) every(st, '_c', 7, () => b.a.playAnim('reload', 2)); b.chatChance(dt, st); },
      });
    },
  },
  // ——— приказы командира ———
  {
    id: 'hold_post', label: 'держит пост', duty: true, ncivil: true,
    avail: (b) => b.override && b.override.type === 'post',
    score: (b) => 1.25 + 0.6 * b.disc,
    plan: (b, def) => {
      const p = b.override.pointId;
      return stay(b, def, p, {
        stand: !b.st.pt(p) || b.st.pt(p).kind !== 'seat', dur: R(150, 260), label: 'на посту',
        start: (b) => { b.drawWeapon(); b.a.data.idleAnim = 'guard'; },
        onEnd: (b) => { b.a.data.idleAnim = null; },
      });
    },
  },
  {
    id: 'patrol', label: 'обходит участок', zone: 'corridor', ncivil: true,
    avail: (b) => (b.override && b.override.type === 'patrol_inside') || ((b.has('pedant') || (b.f.night && b.disc > 0.75)) && !b.assign),
    score: (b) => {
      if (b.override && b.override.type === 'patrol_inside') return 1.3;
      return (b.st.clock - (b.lastPatrol || -999) > 150) ? (b.has('pedant') ? 0.5 : 0.25) : 0;
    },
    cool: 40,
    plan: (b, def) => {
      const full = b.override && b.override.type === 'patrol_inside';
      let route = PATROL_ROUTE;
      if (!full) { const k = b.rng.int(0, route.length - 6); route = route.slice(k, k + 6); }
      const steps = [];
      for (const p of route) {
        steps.push({ go: p, stand: true, claim: false });
        steps.push({ hold: R(1.2, 3), start: (b) => { if (b.rng.chance(0.18)) b.say('patrol'); } });
      }
      steps.push({ do: (b) => { b.lastPatrol = b.st.clock; } });
      return new Seq(b, steps, { id: def.id, label: def.label, def });
    },
  },
  // ——— потребности ———
  {
    id: 'toilet', label: 'в туалете', zone: 'toilet', need: true,
    avail: (b) => b.needs.bladder > 0.3,
    score: (b) => 1.8 * sq(b.needs.bladder) + (b.has('sick') ? 0.15 : 0),
    cool: 30,
    plan: (b, def) => {
      const free = b.st.isFree('toilet', b.a);
      if (!free && b.needs.bladder < 0.75) return null;
      const steps = [];
      if (!free) {
        steps.push({ go: 'v_toilet_wait', stand: true, optional: true });
        steps.push({ until: (b, dt, st) => { if (!st.said && b.rng.chance(0.3)) { st.said = true; b.say('toilet_queue'); } return b.st.isFree('toilet', b.a); }, timeout: 35 });
      }
      steps.push({ go: 'toilet', stand: true });
      steps.push({ hold: R(8, 18), tick: (b, dt) => b.sat('bladder', dt, 0.12) });
      const wash = b.has('pedant') ? 1 : b.has('lazy') ? 0.35 : 0.65;
      if (b.rng.chance(wash)) { steps.push({ go: (b) => (b.st.isFree('sink_mirror', b.a) ? 'sink_mirror' : null), stand: true, optional: true }); steps.push({ hold: R(2, 4) }); }
      return new Seq(b, steps, { id: def.id, label: def.label, def, onEnd: (b) => { b.needs.bladder = Math.min(b.needs.bladder, 0.05); } });
    },
  },
  {
    id: 'tea', label: 'пьёт чай', zone: 'rest', need: true, leisure: true,
    avail: (b) => b.f.power && b.needs.thirst > 0.25 && b.assign !== 'duty',
    score: (b) => 1.1 * Math.pow(b.needs.thirst, 1.5) + (b.has('veteran') ? 0.15 : 0) + (b.st.zoneCount('rest', b.a) > 0 ? 0.1 : 0),
    cool: 40,
    plan: (b, def) => {
      if (!b.st.isFree('kettle', b.a)) return null;
      const steps = [
        { go: 'kettle', stand: true },
        { hold: R(3, 5), start: (b) => { b.st.audio('kettle', b.a.x, b.a.z, 0.5); if (b.rng.chance(0.3)) b.say('tea'); } },
        { do: (b) => { b.a.data.holding = 'mug'; } },
        { go: (b) => leisureSpot(b, ['rest_chair', 'tv_sofa_1', 'tv_sofa_2', 'tv_armchair', 'v_rest_stand_1', 'v_rest_stand_2', 'corridor_bench']) },
        { hold: R(20, 45), tick: (b, dt, st) => { sip(b, st, dt, 'thirst', 0.05); b.chatChance(dt, st); } },
      ];
      return new Seq(b, steps, { id: def.id, label: def.label, def, onEnd: (b) => { b.a.data.holding = null; b.needs.thirst = Math.min(b.needs.thirst, 0.1); b.needs.bladder += 0.12; } });
    },
  },
  {
    id: 'cooler', label: 'пьёт воду', zone: 'corridor', need: true,
    avail: (b) => b.needs.thirst > 0.3,
    score: (b) => 0.7 * Math.pow(b.needs.thirst, 1.5) + (b.f.power ? 0 : 0.45) + (b.assign === 'duty' ? -0.3 : 0),
    cool: 30,
    plan: (b, def) => (b.st.isFree('water_cooler', b.a) ? stay(b, def, 'water_cooler', {
      stand: true, dur: R(3, 6), start: (b) => { b.a.playAnim('drink', 2); if (b.rng.chance(0.25)) b.say('cooler'); },
      onEnd: (b) => { b.needs.thirst *= 0.3; },
    }) : null),
  },
  {
    id: 'eat', label: 'перекусывает', zone: 'rest', need: true, leisure: true,
    avail: (b) => b.needs.hunger > 0.35,
    score: (b) => 1.2 * Math.pow(b.needs.hunger, 1.6) - (b.assign === 'duty' ? 0.25 : 0),
    cool: 120,
    plan: (b, def) => {
      if (!b.st.isFree('fridge', b.a)) return null;
      return new Seq(b, [
        { go: 'fridge', stand: true },
        { hold: R(3, 5), start: (b) => { if (b.rng.chance(0.35)) b.say('fridge'); } },
        { go: (b) => leisureSpot(b, ['rest_chair', 'tv_sofa_2', 'tv_sofa_1', 'v_rest_stand_2', 'corridor_bench']) },
        { hold: R(20, 35), tick: (b, dt, st) => { sip(b, st, dt, 'hunger', 0.05); b.chatChance(dt, st); } },
      ], { id: def.id, label: def.label, def, onEnd: (b) => { b.needs.hunger = Math.min(b.needs.hunger, 0.1); } });
    },
  },
  {
    id: 'smoke', label: 'курит', zone: 'street', need: true, leisure: true, outdoor: true,
    avail: (b) => b.smoker && b.needs.smoke > 0.3 && !b.f.alarm,
    score: (b) => 1.4 * Math.pow(b.needs.smoke, 1.4) + (b.st.countJob('smoke') > 0 ? 0.15 : 0) - (b.assign === 'duty' && b.disc > 0.7 ? 0.35 : 0) + (b.f.mourning ? 0.2 : 0),
    cool: 25,
    plan: (b, def) => {
      const yard = b.has('lazy') || b.has('silent') || b.has('drinker');
      const near = b.st.smokeSpotNear(b);
      const order = near ? [near] : yard
        ? ['smoke_yard', 'v_smoke_y2', 'smoke_porch_1', 'smoke_porch_2']
        : ['smoke_porch_1', 'smoke_porch_2', 'v_smoke_3', 'v_smoke_4', 'smoke_yard'];
      const p = b.st.firstFree(order, b.a);
      if (!p) return null;
      return stay(b, def, p, {
        stand: true, dur: R(25, 50),
        start: (b) => { b.a.data.idleAnim = 'smoke'; b.a.data.holding = 'cigarette'; if (b.rng.chance(0.25)) b.say('smoke'); },
        tick: (b, dt, st) => { b.sat('smoke', dt, 0.04); st._dt = dt; every(st, '_p', 8, () => b.a.playAnim('smoke', 2)); b.chatChance(dt, st, 0.5); },
        onEnd: (b) => { b.a.data.idleAnim = null; b.a.data.holding = null; b.needs.smoke = Math.min(b.needs.smoke, 0.08); },
      });
    },
  },
  {
    id: 'chat', label: 'болтает с сослуживцем', social: true, leisure: true,
    avail: (b) => b.needs.social > 0.4 && !b.f.alarm,
    score: (b) => 0.9 * Math.pow(b.needs.social, 1.2) + (b.has('talker') ? 0.3 : 0) - (b.has('silent') ? 0.35 : 0) - (b.assign && !b.cover ? 0.25 : 0),
    cool: 40,
    plan: (b, def) => b.st.planChat(b, def),
  },
  {
    id: 'tv', label: 'смотрит телевизор', zone: 'rest', leisure: true, seat: true,
    avail: (b) => b.f.power && b.needs.fun > 0.2 && !b.f.alarm,
    score: (b) => 0.75 * Math.pow(b.needs.fun, 1.2) + (b.has('lazy') ? 0.3 : 0) + (b.st.tvOn ? 0.1 : 0)
      - (b.assign ? 0.3 : 0) - (b.f.deep ? 0.35 : 0) - (b.f.mourning ? 0.3 : 0) + (b.override && b.override.type === 'rest' ? 0.3 : 0),
    cool: 30,
    plan: (b, def) => {
      const p = b.st.firstFree(['tv_sofa_1', 'tv_sofa_2', 'tv_armchair'], b.a, true);
      if (!p) return null;
      return stay(b, def, p, { dur: R(50, 120), tick: (b, dt) => { b.sat('fun', dt, 0.02); } });
    },
  },
  {
    id: 'window', label: 'смотрит в окно', leisure: true,
    avail: (b) => b.needs.fun > 0.25,
    score: (b) => 0.3 * b.needs.fun + (b.has('silent') || b.has('afghan') ? 0.15 : 0) + (b.f.tension ? 0.2 : 0),
    cool: 90,
    plan: (b, def) => {
      const ids = Object.keys(SPOTS).filter((k) => SPOTS[k].kind === 'window');
      const p = b.st.firstFree(b.rng.shuffle(ids), b.a);
      if (!p) return null;
      return stay(b, def, p, { stand: true, dur: R(10, 25), start: (b) => { if (b.rng.chance(0.4)) b.say('window'); }, tick: (b, dt) => b.sat('fun', dt, 0.02) });
    },
  },
  {
    id: 'board', label: 'читает доску объявлений', zone: 'corridor',
    avail: (b) => !b.flags.board,
    score: (b) => 0.35 + (b.has('pedant') || b.has('ambitious') || b.has('rookie') ? 0.3 : 0) - (b.has('lazy') ? 0.2 : 0),
    cool: 600,
    plan: (b, def) => (b.st.isFree('notice_board', b.a) ? stay(b, def, 'notice_board', {
      stand: true, dur: R(5, 10), start: (b) => { b.flags.board = true; if (b.rng.chance(0.55)) b.say('board'); },
    }) : null),
  },
  {
    id: 'sleep', label: 'спит', zone: 'rest',
    avail: (b) => (!b.assign || (b.override && b.override.type === 'rest')) && !b.f.alarm && b.sleepiness() > 0.5,
    score: (b) => 1.5 * (b.sleepiness() - 0.4) + (b.override && b.override.type === 'rest' ? 0.35 : 0),
    cool: 60,
    plan: (b, def) => b.st.planSleep(b, def),
  },
  {
    id: 'slack', label: 'отлынивает', leisure: true,
    avail: (b) => b.has('lazy') && !b.bossNear && !b.f.alarm,
    score: (b) => 0.25 + 0.6 * b.needs.fun,
    cool: 200,
    plan: (b, def) => {
      const p = b.st.firstFree(b.rng.shuffle(['v_yard_hide', 'smoke_yard', 'tv_armchair', 'v_win_opers']), b.a);
      if (!p) return null;
      return stay(b, def, p, { dur: R(40, 90), tick: (b, dt) => b.sat('fun', dt, 0.02) });
    },
  },
  {
    id: 'booze', label: 'прикладывается к бутылке', zone: 'armory',
    avail: (b) => b.drinker && b.needs.booze > 0.5 && !b.bossNear && (b.flags.booze || 0) < 2 && !b.f.alarm,
    score: (b) => 1.2 * Math.pow(b.needs.booze, 1.5) + (b.o.morale < 40 ? 0.2 : 0),
    cool: 120,
    plan: (b, def) => {
      const p = b.st.firstFree(['v_armory_hide', 'toilet'], b.a);
      if (!p) return null;
      return stay(b, def, p, {
        stand: true, dur: R(6, 10),
        start: (b) => { b.a.data.holding = 'bottle'; b.a.data.secret = true; b.a.playAnim('drink', 2.5); if (b.rng.chance(0.3)) b.say('hide_drink'); },
        onEnd: (b, reason) => {
          b.a.data.holding = null; b.a.data.secret = false;
          if (reason !== 'caught') { b.needs.booze = 0; b.flags.booze = (b.flags.booze || 0) + 1; b.tipsyUntil = b.st.clock + 120; }
        },
      });
    },
  },
  {
    id: 'call_home', label: 'звонит домой', zone: 'duty',
    avail: (b) => b.has('family_man') && !b.flags.home && b.f.minute >= 17 * 60 && b.f.minute < 22 * 60,
    score: () => 0.55, cool: 300,
    plan: (b, def) => (b.st.isFree('v_duty_side', b.a) ? stay(b, def, 'v_duty_side', {
      stand: true, dur: R(12, 20),
      start: (b) => { b.flags.home = true; b.a.data.idleAnim = 'phone'; b.a.data.holding = 'phone'; b.say('call_home'); },
      tick: (b, dt, st) => { st._dt = dt; every(st, '_l', 7, () => b.say('call_home')); },
      onEnd: (b) => { b.a.data.idleAnim = null; b.a.data.holding = null; },
    }) : null),
  },
  {
    id: 'porch', label: 'стоит на крыльце', zone: 'street', outdoor: true, leisure: true,
    avail: (b) => !b.assign && (b.has('pedant') || b.has('veteran') || b.has('afghan')) && b.role === 'pps',
    score: (b) => 0.28 + (b.f.tension ? 0.3 : 0), cool: 200,
    plan: (b, def) => (b.st.isFree('post_porch', b.a) ? stay(b, def, 'post_porch', { stand: true, dur: R(25, 50), start: (b) => { if (b.rng.chance(0.3)) b.say('porch'); } }) : null),
  },
  {
    id: 'wander', label: 'прохаживается', leisure: true,
    avail: () => true,
    score: () => 0.1, cool: 30,
    plan: (b, def) => {
      const z = b.rng.pick(['corridor', 'corridor', 'lobby']);
      const [x, zz] = b.st.world.randomPointInZone(z, b.rng);
      return stay(b, def, { x, z: zz }, { stand: true, dur: R(4, 10), start: (b) => { if (b.rng.chance(0.1)) b.say('wander'); } });
    },
  },
];
export const ACT_BY_ID = Object.fromEntries(ACTS.map((a) => [a.id, a]));
export { CELL_IDS };
