// Командир наряда — самостоятельный ИИ. Каждые несколько игровых минут оценивает обстановку, людей, приказы
// и свой характер; сам реагирует на встреченное, решает — вмешаться, звать подмогу, отойти. Здесь же —
// вероятностная модель столкновений: драка, бегство, сдача, перестрелка в несколько раундов, осада.
import { fullName } from '../core/names.js';
import {
  R, clamp, num, absNow, dmOf, hourOf, isNight, officer, oName, oLast, isFem, sk, tmod, hasTrait, isDown, adjustOfficer,
  callDep, dep, safeCall, fmt, cap, sentence, lowerFirst, collective, collectiveGen, nw, plural, joinList, money, glog, badText, minuteOfDay, whenPhrase,
} from './city_util.js';
import { GANG_TYPES, CHARGES, FOCUS_PRESENCE, dForm, DISTRICT_INFO } from './city_data.js';
import {
  C, dist, gang, gT, gn, crime as crimeById, intel as intelById, task as taskById, liveTasks, addEvent, bump, trust, authority,
  staffMorale, placeLite, placePrep, topGang, findPlace, flags,
} from './city_core.js';
import { say, report, ask, pick, autoNote, ackNote, actionWord, registerHandler, hasRadio, dutySay, logTask, dispatchSay } from './city_radio.js';
import { T, CHOICE_LABEL, woundWord, killedWord } from './city_text.js';
import { gangHit, leaderCaught, genGangPerp, gangIntel, addIntel, addInformant, moleFor, recalc } from './city_gangs.js';
import { beginReturn, autoTask, travelMin } from './city_tasks.js';
import { ownCrime, normalizeCrime, registerCrime } from './city_crime.js';

const FIRE = { pistol: 1, shotgun: 1, rifle: 1 };
const W_POL = { none: 0.35, pm: 1, tt: 1, ks23: 1.4, shotgun: 1.3, aks74u: 1.8 };
const ACC_POL = { none: 0, pm: 0.8, tt: 0.8, ks23: 1.1, shotgun: 1.0, aks74u: 1.3 };
const W_B = { none: 0.35, knife: 0.6, bat: 0.55, pistol: 1.1, shotgun: 1.4, rifle: 1.9 };
const ACC_B = { pistol: 0.9, shotgun: 1.1, rifle: 1.5 };
const DEATH = { rifle: 0.22, shotgun: 0.16, pistol: 0.11, knife: 0.03, bat: 0.01, none: 0.003 };
const WEAPON_GEN = { rifle: 'автомата', shotgun: 'обреза', pistol: 'пистолета', knife: 'ножа', bat: 'биты', none: 'кулаков' };
const CROWDED = { market: 1, station: 1, street: 1, bar: 1, school: 1, shop: 1, kiosk: 1, park: 0.6, office: 0.5, bank: 0.8, hostel: 0.6 };

/* ------------------------------------------------------------------ характер и силы */
export function profile(game, t) {
  const L = officer(game, t.leaderId);
  const st = t.orders.stance;
  const courage = clamp(0.5 + tmod(game, L, 'courage') + (sk(L, 'tactics') - 50) / 250 + (num(L && L.morale, 60) - 50) / 300 - (num(L && L.stress, 20) - 30) / 300, 0.02, 1);
  const aggr = clamp(0.4 + tmod(game, L, 'aggression') + (st === 'aggressive' ? 0.25 : st === 'cautious' ? -0.25 : 0), 0, 1);
  const disc = clamp(sk(L, 'discipline') / 100 + tmod(game, L, 'discipline'), 0, 1);
  const greed = clamp(num(L && L.hidden && L.hidden.corruption, 15) / 100 + tmod(game, L, 'greed'), 0, 1);
  const cruelty = clamp(0.08 + tmod(game, L, 'cruelty') + (st === 'aggressive' ? 0.05 : 0), 0, 1);
  const dilig = clamp(0.5 + tmod(game, L, 'diligence') + (disc - 0.5) * 0.4, 0, 1);
  return {
    L, courage, aggr, disc, greed, cruelty, dilig,
    perc: clamp(sk(L, 'perception') / 100 + tmod(game, L, 'perception'), 0, 1.2),
    talk: clamp(sk(L, 'talk') / 100 + tmod(game, L, 'talk'), 0, 1.2),
    tact: clamp(sk(L, 'tactics') / 100 + tmod(game, L, 'tactics'), 0, 1.2),
    asks: clamp(disc * 0.6 + (1 - courage) * 0.3 + (hasTrait(L, 'rookie') ? 0.2 : 0), 0, 1),
    drink: tmod(game, L, 'drink'),
  };
}
export function squad(game, t) {
  return t.officerIds.filter((id) => !t.rt.out[id]).map((id) => officer(game, id)).filter((o) => o && !isDown(o));
}
export function fatigueOf(o, t) { return num(o.fatigue, 20) + num(t.rt.fat[o.id]); }
export function offPower(game, o, t) {
  const eq = o.equipment || {};
  let w = eq.weapon || 'pm';
  if (Number.isFinite(eq.ammo) && eq.ammo <= 0) w = 'none';
  const inj = t ? num(t.rt.inj[o.id]) : 0;
  const arm = eq.armor === 'heavy' ? 1.3 : eq.armor === 'vest' ? 1.15 : 1;
  return (0.5 + sk(o, 'shooting') / 100 * 0.7 + sk(o, 'tactics') / 100 * 0.3 + tmod(game, o, 'shooting') * 0.4) * (W_POL[w] || 1) * arm
    * (1 - (t ? fatigueOf(o, t) : num(o.fatigue, 20)) / 250) * (inj >= 2 ? 0.35 : inj === 1 ? 0.8 : 1) * (num(o.hp, 100) / 100);
}
/** все бойцы, участвующие в столкновении: наряд + подоспевшие */
function fighters(game, t, enc) {
  const out = squad(game, t).map((o) => ({ o, t }));
  for (const hid of enc.helpers || []) {
    const h = taskById(game, hid);
    if (h && h.rt.joined === t.id) for (const o of squad(game, h)) out.push({ o, t: h });
  }
  return out;
}
export function squadPower(game, t, enc = null) {
  const list = enc ? fighters(game, t, enc) : squad(game, t).map((o) => ({ o, t }));
  return list.reduce((s, f) => s + offPower(game, f.o, f.t), 0);
}
function perpPow(p) { return (W_B[p.armed] || 0.4) * num(p.skill, 0.6); }
function enemyPower(enc, perceived = false) {
  const free = enc.perps.filter((p) => p.st === 'free');
  let e = free.reduce((s, p) => s + perpPow(p), 0);
  if (perceived && enc.pre) e *= enc.pre.n / Math.max(1, free.length);
  return e;
}

/* ------------------------------------------------------------------ главный цикл командира */
export function leaderTick(game, t, now) {
  const rt = t.rt;
  t.elapsed++;
  // усталость
  const mul = (isNight(now) ? 1.3 : 1) * ({ guard: 0.8, raid: 1.4, investigate: 0.85, escort: 0.7, ambush: 0.9 }[t.type] || (t.orders.route === 'car' ? 0.8 : 1.1));
  for (const id of t.officerIds) if (!rt.out[id]) rt.fat[id] = num(rt.fat[id]) + 0.035 * mul;
  if (rt.enc) { stepEncounter(game, t, now); return; }
  if (rt.sub) { stepSub(game, t, now); return; }
  if (rt.cancel) { beginReturn(game, t, 'recall'); return; }
  const sq = squad(game, t);
  if (!sq.length) { beginReturn(game, t, 'empty'); return; }
  if (now >= rt.endAt && !rt.holdEnd) { beginReturn(game, t, 'time'); return; }
  if (now >= rt.nextReport && rt.pauseUntil <= now) routineReport(game, t, now);
  if (now < rt.nextThink || now < rt.pauseUntil) return;
  const pf = profile(game, t);
  rt.nextThink = now + Math.round(4 + R(game).int(0, 5) + (1 - pf.dilig) * 4);
  if (checkFatigue(game, t, now, pf, sq)) return;
  deviation(game, t, now, pf);
  const fn = THINK[t.type];
  if (fn) fn(game, t, now, pf);
}

function checkFatigue(game, t, now, pf, sq) {
  const avg = sq.reduce((s, o) => s + fatigueOf(o, t), 0) / sq.length;
  const worst = sq.reduce((a, o) => (fatigueOf(o, t) > fatigueOf(a, t) ? o : a), sq[0]);
  if (avg > 97) { report(game, t, pick(game, T.fatigueForce), { last: oLast(worst) }); beginReturn(game, t, 'fatigue'); return true; }
  const thr = 78 - (1 - pf.dilig) * 18 + pf.disc * 8;
  if (avg > thr && now - num(t.rt.lastFatigueAsk, -999) > 90 && !t.rt.pendingFatigue) {
    t.rt.lastFatigueAsk = now;
    const auto = pf.courage < 0.5 || avg > 90 || pf.dilig < 0.35 ? 'return' : 'continue';
    const hours = Math.max(1, Math.round(t.elapsed / 60));
    const m = ask(game, t, pick(game, T.fatigue), ['return', 'continue'], auto, 8, { type: 'fatigue', taskId: t.id }, { hours: `${nw(hours, 'час', 'часа', 'часов')}`, last: oLast(worst) });
    if (m) t.rt.pendingFatigue = m.id;
    else if (auto === 'return') { beginReturn(game, t, 'fatigue'); return true; }
  }
  return false;
}
registerHandler('fatigue', (game, msg, choice, auto) => {
  const t = taskById(game, msg.meta.taskId);
  if (!t || t.phase !== 'active') return;
  t.rt.pendingFatigue = null;
  if (auto) autoNote(game, t, choice); else ackNote(game, t, choice);
  if (choice === 'return') beginReturn(game, t, 'fatigue');
  else { for (const id of t.officerIds) adjustOfficer(game, officer(game, id), { morale: -2 }); }
});

/** отступления от приказа: лень, выпивка, «чай у знакомой продавщицы» */
function deviation(game, t, now, pf) {
  const rng = R(game);
  if (t.rt.slackUntil > now) return;
  const night = isNight(now);
  if (pf.drink > 0 && night && t.type !== 'raid' && rng.chance(0.012 + pf.drink * 0.02)) {
    t.rt.slackUntil = now + rng.int(60, 150);
    t.rt.drank = true;
    t.rt.hidden.push('выпивали на дежурстве');
    if (rng.chance(0.35)) t.rt.silentUntil = t.rt.slackUntil;
  } else if (pf.dilig < 0.35 && rng.chance(0.03)) {
    t.rt.slackUntil = now + rng.int(30, 90);
    t.rt.hidden.push('отсиживались в тепле');
  }
}

/* ------------------------------------------------------------------ доклады */
export function routineReport(game, t, now) {
  const rng = R(game);
  const rt = t.rt;
  rt.nextReport = now + num(t.orders.reportEvery, 60) + rng.int(-4, 6);
  if (rt.silentUntil > now) {
    // командир не выходит на связь: дежурный забеспокоится
    if (!rt.silentAsked) {
      rt.silentAsked = true;
      dutySay(game, `Товарищ майор, ${rt.callsign} молчит, на вызовы не отвечает уже ${nw(num(t.orders.reportEvery, 60), 'минуту', 'минуты', 'минут')}.`, 'request', {
        choices: [{ id: 'wait', label: 'Подождать' }, { id: 'recall', label: 'Отозвать наряд' }], autoChoice: 'wait', expires: dmOf(now + 15), meta: { type: 'silent', taskId: t.id },
      });
    }
    return;
  }
  const tl = rt.tally;
  const parts = [];
  const d = t.districtId;
  const vars = { prep: dForm(d, 'prep'), Prep: cap(dForm(d, 'prep')) };
  if (t.type === 'patrol') {
    if (tl.docs) parts.push(`проверили документы у ${collectiveGen(tl.docs)}`);
    if (tl.kiosks) parts.push(`обошли ${nw(tl.kiosks, 'ларёк', 'ларька', 'ларьков')}`);
    if (tl.drunks) parts.push(`подобрали ${collectiveGen(tl.drunks)} пьяных`);
    if (tl.warned) parts.push(`${collectiveGen(tl.warned) === 'одного' ? 'одного' : collectiveGen(tl.warned)} отпустили с предупреждением`);
    if (tl.deterred) parts.push('пару раз при нас разбегались');
  }
  const busy = num(tl.encounters) > 0 || parts.length > 2;
  let body = t.type === 'guard' ? pick(game, T.guardQuiet) : t.type === 'ambush' ? pick(game, T.ambushWait) : pick(game, busy ? T.routineLeadBusy : T.routineLead);
  if (parts.length) body += ' ' + sentence(joinList(parts));
  const note = rt.notes.length ? rt.notes[rt.notes.length - 1] : rng.chance(0.4) ? rng.pick(T.flavor[d] || T.flavor.any) : rng.chance(0.3) ? rng.pick(T.flavor.any) : '';
  if (note) body += ' ' + sentence(note);
  if (rt.slackUntil > now && rt.drank && rng.chance(0.3)) body += ' Всё нормально, товарищ майор, всё под контролем.';
  if (t.type === 'patrol') body += ' ' + pick(game, T.routineClose);
  if (t.type === 'investigate' || t.type === 'search') return; // у них свои доклады по ходу работы
  report(game, t, body, vars);
  rt.tally = {};
  rt.notes = [];
}
registerHandler('silent', (game, msg, choice) => {
  const t = taskById(game, msg.meta.taskId);
  if (!t || t.phase === 'done') return;
  if (choice === 'recall') { t.rt.silentUntil = 0; t.rt.cancel = true; t.rt.recallNoticed = true; }
});

/* ------------------------------------------------------------------ типы заданий */
const THINK = {
  patrol(game, t, now, pf) {
    const rng = R(game);
    const d = dist(game, t.districtId);
    const rt = t.rt;
    const slack = rt.slackUntil > now;
    const eff = slack ? 0.4 : 1;
    const focus = t.orders.focus;
    if (focus === 'checks' && rng.chance(0.8 * eff)) {
      const n = rng.int(1, 4);
      rt.tally.docs = num(rt.tally.docs) + n;
      wantedCheck(game, t, n * pf.perc);
      if (rng.chance(0.015 * n * eff)) return weaponFind(game, t);
      if (pf.greed > 0.55 && rng.chance(0.06)) { rt.hidden.push('брали «на лапу» у проверенных'); t.rt.pocket = num(t.rt.pocket) + rng.int(20, 120); }
      if (rng.chance(0.2)) trust(game, d.id, -0.15);
    } else if (focus === 'checks') rt.tally.docs = num(rt.tally.docs) + 1;
    if (focus === 'kiosks' && rng.chance(0.8 * eff)) {
      rt.tally.kiosks = num(rt.tally.kiosks) + rng.int(1, 2);
      trust(game, d.id, 0.12);
      const g = topGang(game, d, 12);
      if (g) {
        g.anger = clamp(g.anger + 0.25, 0, 100);
        if (rng.chance(0.045 * pf.talk * (num(d.influence[g.id]) / 40))) {
          const it = gangIntel(game, g, { kinds: ['hideout', 'stash', 'robbery'], reliability: 0.55, source: 'patrol', prefix: 'Продавщица шепнула: ' });
          if (it) { rt.notes.push(it.text); rt.tally.intel = num(rt.tally.intel) + 1; }
        }
      }
    }
    if (focus === 'drunks' && rng.chance(0.28 * eff)) drunkFound(game, t, pf);
    if (focus === 'drugs' && rng.chance(0.07 * eff)) {
      const g = C(game).gangs.find((x) => x.type === 'drugs' && x.status === 'active');
      if (g && num(d.influence[g.id]) > 8 && rng.chance(0.5 + num(d.influence[g.id]) / 100)) return drugBust(game, t, g);
    }
    // событие патруля (генератор A)
    const pEv = (0.1 + num(d.crime) / 600 + (isNight(now) ? 0.04 : 0) + (focus === 'checks' || focus === 'drunks' ? 0.03 : 0)) * eff;
    if (rng.chance(pEv)) patrolEventHandle(game, t, now, pf);
  },
  guard(game, t, now, pf) {
    const rng = R(game);
    if (rng.chance(0.05)) patrolEventHandle(game, t, now, pf);
    else t.rt.tally.quiet = num(t.rt.tally.quiet) + 1;
    if (t.rt.witness) { const w = t.rt.witness; if (rng.chance(0.02)) t.rt.notes.push(`${w.name} ${w.f ? 'попросила' : 'попросил'} сигарету и всё спрашивает, долго ли ещё`); }
  },
  ambush(game, t, now, pf) {
    const rng = R(game);
    const it = intelById(game, t.targetId);
    const rt = t.rt;
    if (!it) { beginReturn(game, t, 'done'); return; }
    const win = it.window || { from: now, to: now + 240 };
    if (now < win.from) { rt.tally.wait = num(rt.tally.wait) + 1; return; }
    // заметили засаду?
    const stealth = squad(game, t).reduce((s, o) => s + tmod(game, o, 'stealth') + sk(o, 'tactics') / 200, 0) / Math.max(1, squad(game, t).length);
    const detect = (t.orders.position === 'close' ? 0.035 : 0.01) * (t.orders.trigger === 'wait_main' ? 1.6 : 1) * (1 - clamp(stealth, 0, 0.8));
    if (!it.fake && !rt.leaked && rng.chance(detect)) {
      rt.leaked = true;
      report(game, t, rng.pick(['Похоже, нас срисовали: «девятка» проехала мимо, развернулась и ушла.', 'Засветились — пацан на велосипеде покрутился и убежал. Не придут.']), {});
    }
    const real = !it.fake && !rt.leaked;
    const g = gang(game, it.gangId);
    if (real && g && g.status === 'active' && (it.arrivedAt || rng.chance(0.25))) {
      it.used = true;
      const kind = it.kind;
      let n = kind === 'meeting' ? rng.int(4, 7) : kind === 'deal' ? rng.int(2, 4) : rng.int(2, 4);
      const leaderThere = it.data && it.data.leaderPresent && (t.orders.trigger === 'wait_main' || rng.chance(0.6));
      const perps = [];
      for (let i = 0; i < n; i++) perps.push(genGangPerp(game, g, { leader: i === 0 && leaderThere }));
      const pl = findPlace(game, it.placeId);
      const enc = newEnc(game, t, { kind: 'ambush', gangId: g.id, place: pl ? pl.p : null, perps, severity: 4, surprise: t.orders.position === 'close' ? 0.75 : 0.5, cornered: false, title: kind === 'meeting' ? 'сходка' : kind === 'deal' ? (g.type === 'drugs' ? 'передача наркотиков' : 'торговля оружием') : 'вооружённый налёт', loot: kind === 'deal' ? { money: rng.int(300, 2500), items: [g.type === 'drugs' ? 'пакеты с героином' : 'ящик патронов и два ТТ'] } : null });
      startEncounter(game, t, enc, now, { saw: `${kind === 'meeting' ? 'Подъехали, собираются' : kind === 'deal' ? 'Идёт передача' : 'Подъехали, достают стволы'}: ${collective(n)}${leaderThere ? `, среди них, похоже, сам «${g.leader.nick}»` : ''}.` });
      return;
    }
    if (it.fake && g && !rt.trapChecked && now >= win.from + 20) {
      rt.trapChecked = true;
      if ((g.type === 'frostbitten' || g.type === 'afghan') && rng.chance(0.3)) {
        it.used = true;
        const perps = []; for (let i = 0; i < rng.int(3, 5); i++) perps.push(genGangPerp(game, g));
        const pl = findPlace(game, it.placeId);
        const enc = newEnc(game, t, { kind: 'trap', gangId: g.id, place: pl ? pl.p : null, perps, severity: 5, surprise: 0, sudden: true, title: 'засада на наряд' });
        startEncounter(game, t, enc, now, {});
        return;
      }
    }
    if (now >= win.to + 20) {
      it.used = true;
      const inf = C(game).informants.find((i) => i.status === 'active' && i.gangId === it.gangId);
      if (inf) inf.reliability = clamp(inf.reliability - 0.08, 0.1, 0.95);
      report(game, t, rng.pick(['Никого. Наводка пустая. Сворачиваемся.', 'Просидели впустую, никто не пришёл. Возвращаемся.', 'Пусто. То ли спугнули, то ли не было ничего.']), {});
      if (rt.leaked || it.fake) C(game).moleHints += moleFor(game, it.gangId) ? 1 : 0;
      beginReturn(game, t, 'done');
    } else rt.tally.wait = num(rt.tally.wait) + 1;
  },
  raid(game, t, now, pf) {
    const rng = R(game);
    const rt = t.rt;
    const g = gang(game, t.targetGangId);
    if (rt.stage === 'wait') {
      if (now >= rt.stageUntil) { rt.stage = 'recon'; rt.stageUntil = now + rng.int(8, 18); report(game, t, 'Начинаем. Подходим к объекту.', {}); }
      else if (rng.chance(0.02)) { rt.noticed = true; }
      return;
    }
    if (rt.stage === 'recon') {
      if (now < rt.stageUntil) return;
      const pl = findPlace(game, t.placeId);
      if (!g || g.status !== 'active') { report(game, t, 'Объект пустой, давно брошен. Возвращаемся.', {}); beginReturn(game, t, 'done'); return; }
      const mole = moleFor(game, g.id);
      const leaked = rt.leaked || (mole && rng.chance(0.5)) || (rt.noticed && rng.chance(0.5));
      const pt = g.points.find((p) => p.placeId === t.placeId);
      if (pt) pt.raidedDay = dmOf(now).day;
      if (leaked && rng.chance(0.6)) {
        report(game, t, rng.pick(['Пусто. Похоже, их предупредили: печка ещё тёплая, окурки свежие.', 'Никого. Ушли буквально перед нами — кто-то стукнул.']), {});
        C(game).moleHints++;
        g.anger = clamp(g.anger + 6, 0, 100);
        rt.stage = 'search'; rt.stageUntil = now + rng.int(15, 25); rt.empty = true;
        return;
      }
      const tod = hourOf(now);
      const night = tod >= 22 || tod < 6;
      const base = pt && pt.kind === 'hideout' ? rng.int(3, 7) : pt && pt.kind === 'stash' ? rng.int(1, 3) : rng.int(2, 5);
      const n = Math.max(1, Math.min(g.members, base + (night ? 1 : 0)));
      const leaderThere = g.leader.status === 'free' && pt && pt.kind === 'hideout' && rng.chance(g.leader.known ? 0.35 : 0.2);
      const perps = []; for (let i = 0; i < n; i++) perps.push(genGangPerp(game, g, { leader: i === 0 && leaderThere }));
      let surprise = t.orders.mode === 'quiet' ? 0.65 : 0.15;
      if (t.orders.timing === 'dawn') surprise += 0.2;
      if (leaked) surprise = 0;
      const loot = { money: Math.round(g.money * rng.range(0.04, pt && pt.kind === 'hideout' ? 0.14 : 0.06)), items: pt && pt.kind === 'stash' ? [rng.pick(['два автомата АКМ и цинк патронов', 'обрезы, пистолет ТТ, гранаты РГД', 'ящик с патронами и «Макаров» без номера'])] : g.type === 'drugs' ? ['пакеты с маковой соломкой', 'весы, шприцы'] : ['тетрадь с записями о поборах'] };
      const enc = newEnc(game, t, { kind: 'raid', gangId: g.id, place: pl ? pl.p : null, perps, severity: 4, surprise, cornered: true, loot, title: 'рейд', bCover: 0.45 });
      rt.raidLoot = loot;
      enc.pointKind = pt ? pt.kind : 'hideout';
      rt.stage = 'assault';
      const fire = perps.filter((p) => FIRE[p.armed]).length;
      const seen = Math.max(1, n + rng.int(pf.perc > 0.6 ? 0 : -1, pf.perc > 0.6 ? 0 : 2));
      const body = `На точке ${collective(seen)}, ${fire ? `у ${collectiveGen(Math.max(1, Math.min(seen, fire)))} стволы` : 'стволов не видно'}${leaderThere ? `. Похоже, там сам «${g.leader.nick}»` : ''}. Работаем?`;
      const auto = squadPower(game, t) / Math.max(0.5, enemyPower(enc)) < 0.9 && pf.courage < 0.6 ? 'backup' : 'go';
      rt.enc = enc; enc.stage = 'await'; enc.startedAt = now; enc.deadline = now + 40;
      const m = ask(game, t, body, ['go', 'backup', 'abort'], auto, 6, { type: 'raid_go', taskId: t.id, encId: enc.id });
      if (m) enc.msgId = m.id; else applyAction(game, t, enc, auto === 'go' ? 'engage' : auto, 'self');
      return;
    }
    if (rt.stage === 'search') {
      if (now < rt.stageUntil) return;
      raidSearch(game, t, now, pf);
      beginReturn(game, t, 'done');
    }
  },
  investigate(game, t, now, pf) { investigateStep(game, t, now, pf); },
  respond(game, t, now, pf) {
    if (t.rt.helpFor) {
      const h = taskById(game, t.rt.helpFor);
      if (!h || !h.rt.enc || h.phase !== 'active') { report(game, t, 'Прибыли — всё уже закончилось. Возвращаемся.', {}); beginReturn(game, t, 'done'); }
      return;
    }
    const cr = crimeById(game, t.targetCrimeId);
    if (!t.rt.started && cr) { t.rt.started = true; arriveAtCrime(game, t, cr, now); return; }
    beginReturn(game, t, 'done');
  },
  escort(game, t, now, pf) { escortStep(game, t, now, pf); },
  search(game, t, now, pf) { searchStep(game, t, now, pf); },
};

/* ------------------------------------------------------------------ мелочи патруля */
function wantedCheck(game, t, chance) {
  const rng = R(game);
  const w = C(game).intel.filter((i) => i.kind === 'wanted' && !i.used && i.expires > absNow(game));
  if (!w.length || !rng.chance(0.01 * chance * w.length)) return;
  const it = rng.pick(w);
  const cr = crimeById(game, it.crimeId);
  if (!cr || cr.status === 'resolved' || !cr.perps.length) return;
  it.used = true;
  const p = { ...cr.perps[0], st: 'free', skill: 0.6 };
  const enc = newEnc(game, t, { kind: 'wanted', crimeId: cr.id, gangId: p.gangId, place: null, perps: [p], severity: cr.severity, surprise: 0.6, title: 'задержание разыскиваемого' });
  startEncounter(game, t, enc, absNow(game), { saw: `При проверке документов — похож на разыскиваемого по ориентировке: ${fullName(p.person)}. Нервничает.` });
}
function weaponFind(game, t) {
  const rng = R(game);
  const d = dist(game, t.districtId);
  const g = topGang(game, d, 10);
  const p = g ? genGangPerp(game, g, { armed: rng.pick(['pistol', 'knife', 'shotgun']) }) : genGangPerp(game, null, { armed: rng.pick(['pistol', 'knife']) });
  const enc = newEnc(game, t, { kind: 'check', gangId: p.gangId, place: rng.pick(d.places), perps: [{ ...p, st: 'free', skill: g ? gT(g).skill : 0.6 }], severity: 3, surprise: 0.5, title: 'незаконное ношение оружия', charge: CHARGES.weapon });
  startEncounter(game, t, enc, absNow(game), { saw: `При досмотре у одного под курткой ${p.armed === 'pistol' ? 'ствол' : p.armed === 'shotgun' ? 'обрез' : 'нож-«бабочка»'}.` });
}
function drunkFound(game, t, pf) {
  const rng = R(game);
  const rt = t.rt;
  rt.tally.drunks = num(rt.tally.drunks) + 1;
  const d = dist(game, t.districtId);
  if (t.orders.detain === 'all' && rng.chance(0.5)) {
    const p = genGangPerp(game, null, { armed: 'none' });
    rt.captives.push(captiveData(game, t, { ...p, gangId: null }, { charge: CHARGES.drunk, danger: 5, cooperation: 70, uniform: 'civil_m', petty: true }));
    bump(game, 'arrests', 1, d.id);
  } else if (rng.chance(0.5)) rt.notes.push(rng.pick(['Одного сдали в вытрезвитель', 'Довели одного до подъезда, жена забрала', 'Пьяного с лавки отправили в вытрезвитель, замёрз бы']));
  else rt.tally.warned = num(rt.tally.warned) + 1;
  d.crime = clamp(d.crime - 0.05, 5, 100);
}
function drugBust(game, t, g) {
  const rng = R(game);
  const d = dist(game, t.districtId);
  const n = rng.int(1, 3);
  const perps = []; for (let i = 0; i < n; i++) perps.push(genGangPerp(game, g, { armed: rng.chance(0.7) ? rng.pick(['none', 'knife']) : 'pistol' }));
  const pl = rng.pick(d.places.filter((p) => ['hostel', 'flat', 'station', 'park', 'garage'].includes(p.kind))) || rng.pick(d.places);
  const enc = newEnc(game, t, { kind: 'drugs', gangId: g.id, place: pl, perps, severity: 3, surprise: 0.4, title: 'сбыт наркотиков', charge: CHARGES.drugs, loot: { money: rng.int(50, 400), items: ['чеки с героином', 'маковая соломка'] } });
  g.anger = clamp(g.anger + 2, 0, 100);
  startEncounter(game, t, enc, absNow(game), { saw: `${placePrep(pl)} торгуют: ${collective(n)}, по виду — ${gn(g, 'people')}.` });
}

/* ------------------------------------------------------------------ событие патруля от генератора A */
function classify(o) {
  const s = `${o.id || ''} ${o.label || ''}`.toLowerCase();
  if (/bribe|money|деньг|конверт|мзд|взятк|на лапу/.test(s)) return 'bribe';
  if (/backup|подкреп/.test(s)) return 'backup';
  if (/ignore|pass|skip|мимо|игнор|не вмеш|не трог|проехать|оставить|отпуст|уйти/.test(s)) return 'ignore';
  if (/talk|поговор|успоко|убед|разрул|предупред|словами/.test(s)) return 'talk';
  if (/check|провер|документ|обыск|досмотр/.test(s)) return 'check';
  if (/help|помоч|скор|отвез|довез|проводит/.test(s)) return 'help';
  if (/detain|arrest|engage|intervene|задерж|вмеш|взять|брать|разогн|пресеч|скрут/.test(s)) return 'engage';
  return 'other';
}
function optScore(cls, pf) {
  return { engage: pf.aggr * 0.6 + pf.courage * 0.4 + pf.dilig * 0.2, talk: pf.talk * 0.7 + 0.2, check: pf.dilig * 0.6 + 0.2, help: 0.55, ignore: (1 - pf.dilig) * 0.6 + (1 - pf.courage) * 0.3, backup: (1 - pf.courage) * 0.5, bribe: pf.greed * 0.9 - 0.2, other: 0.3 }[cls] || 0.3;
}
function patrolEventHandle(game, t, now, pf) {
  const rng = R(game);
  const d = dist(game, t.districtId);
  const ctx = { district: d, place: t.placeId ? findPlace(game, t.placeId)?.p : rng.pick(d.places), focus: t.orders.focus || null, day: dmOf(now).day, minute: dmOf(now).minute, hour: hourOf(now), night: isNight(now), task: { type: t.type, officers: squad(game, t).length, detain: t.orders.detain }, gangs: C(game).gangs.filter((g) => g.status === 'active') };
  const ev = callDep(game, 'crimes', 'patrolEvent', rng, ctx);
  if (!ev || typeof ev !== 'object' || typeof ev.text !== 'string' || badText(ev.text)) return;
  t.rt.tally.events = num(t.rt.tally.events) + 1;
  if (ev.crime) {
    const cr = normalizeCrime(game, ev.crime, d, now);
    cr.status = 'responding';
    cr.assignedTaskId = t.id;
    bump(game, 'crimes', 1, d.id);
    d.dayAcc.crimes++;
    registerCrime(game, cr, 'patrol');
    const enc = encFromCrime(game, t, cr);
    if (ev.choice && Array.isArray(ev.choice.options) && ev.choice.options.length) enc.ext = { question: ev.choice.question, options: ev.choice.options.map((o) => ({ id: String(o.id), label: String(o.label || o.id), cls: classify(o) })) };
    startEncounter(game, t, enc, now, { saw: ev.text });
    return;
  }
  if (ev.choice && Array.isArray(ev.choice.options) && ev.choice.options.length) {
    const opts = ev.choice.options.map((o) => ({ id: String(o.id), label: String(o.label || o.id), cls: classify(o) }));
    const bribe = opts.find((o) => o.cls === 'bribe');
    if (bribe) {
      // такое начальству по рации не докладывают
      const take = rng.chance(clamp(pf.greed * 1.1 - 0.15, 0, 0.9));
      if (take) { t.rt.hidden.push('взяли деньги «решить на месте»'); t.rt.pocket = num(t.rt.pocket) + rng.int(30, 300); }
      else t.rt.notes.push(`${ev.text} Предлагали «решить вопрос» — отказались`);
      return;
    }
    const best = opts.reduce((a, o) => (optScore(o.cls, pf) + rng.range(-0.1, 0.1) > optScore(a.cls, pf) ? o : a), opts[0]);
    if (pf.asks > rng.next() + 0.2 && hasRadio(game, t)) {
      const q = typeof ev.choice.question === 'string' && !badText(ev.choice.question) ? ev.choice.question : pick(game, T.askQ);
      ask(game, t, `${sentence(ev.text)} ${q}`, opts.map((o) => ({ id: o.id, label: o.label })), best.id, 6, { type: 'event', taskId: t.id, map: Object.fromEntries(opts.map((o) => [o.id, o.cls])), text: ev.text });
    } else applyEventOption(game, t, best.cls, ev.text, false);
    return;
  }
  t.rt.notes.push(ev.text);
  if (ev.kind === 'alarm' || ev.kind === 'important') report(game, t, sentence(ev.text), {});
}
function applyEventOption(game, t, cls, text, viaRadio, auto) {
  const rng = R(game);
  const d = t.districtId;
  const res = {
    engage: () => { trust(game, d, 0.5); return rng.pick(['Разобрались, разогнали.', 'Пресекли, всё тихо.']); },
    talk: () => { trust(game, d, 0.6); return rng.pick(['Поговорили — успокоились.', 'Объяснили по-хорошему, разошлись.']); },
    check: () => { t.rt.tally.docs = num(t.rt.tally.docs) + 1; return rng.pick(['Проверили — чисто.', 'Документы в порядке, отпустили.']); },
    help: () => { trust(game, d, 1); return rng.pick(['Помогли, человек благодарил.', 'Довезли, сдали родственникам.']); },
    ignore: () => { if (rng.chance(0.3)) trust(game, d, -0.3); return rng.pick(['Не стали связываться.', 'Проехали мимо.']); },
    backup: () => 'Справились без подмоги.',
    other: () => 'Отработали.',
  }[cls] || (() => 'Отработали.');
  const out = res();
  if (viaRadio) { if (auto) say(game, t, `${pick(game, T.autoDecide)} ${out}`, { action: lowerFirst(out.replace(/\.$/, '')) }); else say(game, t, `Понял{/а}. ${out}`); }
  else t.rt.notes.push(`${sentence(text)} ${out}`);
}
registerHandler('event', (game, msg, choice, auto) => {
  const t = taskById(game, msg.meta.taskId);
  if (!t || t.phase !== 'active') return;
  applyEventOption(game, t, (msg.meta.map || {})[choice] || 'other', msg.meta.text || '', true, auto);
});

/* ------------------------------------------------------------------ столкновение */
function newEnc(game, t, s) {
  const rng = R(game);
  const perps = s.perps.map((p) => ({ person: p.person, nick: p.nick || null, age: num(p.age, 25), desc: p.desc || '', armed: p.armed || 'none', gangId: p.gangId || null, leader: !!p.leader, st: 'free', skill: num(p.skill, p.gangId ? (GANG_TYPES[(gang(game, p.gangId) || {}).type] || {}).skill || 0.7 : 0.6), look: p.look || null, shot: false }));
  return {
    id: 'enc_' + rng.int(1e5, 9e5), kind: s.kind, crimeId: s.crimeId || null, gangId: s.gangId || null, place: placeLite(s.place) || null,
    districtId: t.districtId, perps, severity: num(s.severity, 2), surprise: num(s.surprise, 0.3), sudden: !!s.sudden, cornered: !!s.cornered,
    talkable: !!s.talkable, victims: num(s.victims), title: s.title || '', charge: s.charge || null, loot: s.loot || null, bCover: num(s.bCover, 0.25),
    stage: 'assess', round: 0, bFired: false, helpers: [], startedAt: absNow(game), deadline: num(s.deadline, absNow(game) + 25), civ: { hurt: 0, dead: 0 }, pre: null,
  };
}
export function encFromCrime(game, t, cr) {
  const perps = cr.perps.length ? cr.perps : [genGangPerp(game, gang(game, cr.gangId), {})];
  const cat = cr.category;
  return newEnc(game, t, {
    kind: 'crime', crimeId: cr.id, gangId: cr.gangId, place: cr.place, perps, severity: cr.severity, surprise: 0.35,
    talkable: ['public_order', 'domestic', 'other', 'traffic'].includes(cat) && cr.severity <= 3, victims: cr.victims.filter((v) => v.condition !== 'dead').length,
    title: cr.title, deadline: num(cr.endsAt, absNow(game) + 20),
  });
}
function weaponsPhrase(n, fire, knives) {
  if (fire >= 2) return `минимум ${collective(fire)} со стволами`;
  if (fire === 1) return 'у одного, похоже, ствол';
  if (knives) return knives > 1 ? 'с ножами' : 'у одного нож';
  return 'вроде без оружия';
}
export function startEncounter(game, t, enc, now, opts = {}) {
  const rng = R(game);
  const pf = profile(game, t);
  t.rt.enc = enc;
  t.rt.tally.encounters = num(t.rt.tally.encounters) + 1;
  const n = enc.perps.length;
  const fire = enc.perps.filter((p) => FIRE[p.armed]).length;
  const seenFire = enc.perps.filter((p) => FIRE[p.armed] && rng.chance(0.45 + pf.perc * 0.5)).length;
  const seenN = Math.max(1, n + (pf.perc < 0.45 ? rng.int(-1, 2) : 0));
  enc.pre = { n: seenN, fire: seenFire };
  if (enc.sudden) {
    enc.bFired = true;
    enc.stage = 'fight';
    const pl = enc.place ? enc.place.prep : dForm(t.districtId, 'prep');
    say(game, t, pick(game, enc.kind === 'trap' || enc.kind === 'convoy' ? T.alarmAmbushed : T.alarm), { place: pl, weapons: weaponsPhrase(n, fire, 0) }, 'alarm', { important: true });
    return;
  }
  const knives = enc.perps.filter((p) => p.armed === 'knife').length;
  const situation = `${opts.saw ? sentence(opts.saw) + ' ' : ''}${enc.kind === 'crime' && !opts.saw ? sentence(`${enc.place ? enc.place.prep + ': ' : ''}${lowerFirst(enc.title)}`) + ' ' : ''}${seenN > 1 ? `Их ${collective(seenN)}, ${weaponsPhrase(seenN, seenFire, knives)}.` : `Один, ${weaponsPhrase(1, seenFire, knives)}.`}`;
  enc.situation = situation;
  decideAndAct(game, t, enc, now, pf);
}
function decide(game, t, enc, pf) {
  const rng = R(game);
  const P = squadPower(game, t, enc);
  const E = Math.max(0.25, enemyPower(enc, true));
  const ratio = P / E;
  const sev = enc.severity;
  const victims = enc.victims > 0;
  const st = t.orders.stance;
  const fireSeen = enc.pre ? enc.pre.fire : 0;
  const avgFat = squad(game, t).reduce((s, o) => s + fatigueOf(o, t), 0) / Math.max(1, squad(game, t).length);
  const sc = {
    engage: 0.5 * (ratio - 1) + pf.aggr * 0.6 + pf.courage * 0.5 + (victims ? 0.4 : 0) + sev * 0.06 + (st === 'aggressive' ? 0.3 : st === 'cautious' ? -0.3 : 0) - (fireSeen ? 0.3 * (1 - pf.courage) : 0) - avgFat / 300,
    backup: (1 - ratio) * 0.7 + pf.disc * 0.25 + (1 - pf.courage) * 0.35 + (fireSeen ? 0.2 : 0) - (victims ? 0.15 : 0) + (st === 'cautious' ? 0.15 : 0),
    observe: (1 - pf.courage) * 0.7 + (st === 'cautious' ? 0.25 : 0) - sev * 0.08 - (victims ? 0.35 : 0) + (enc.kind === 'ambush' && t.orders.position === 'far' ? 0.3 : 0),
  };
  if (enc.talkable) sc.talk = pf.talk * 0.8 + (st === 'cautious' ? 0.2 : 0) + (t.orders.detain === 'none' ? 0.3 : 0) - sev * 0.1 + 0.15;
  if (t.orders.detain === 'none' && !victims && sev <= 2) sc.observe += 0.2;
  if (enc.kind === 'ambush' || enc.kind === 'wanted' || enc.kind === 'check' || enc.kind === 'arrest') { sc.engage += 0.35; sc.observe -= 0.2; }
  for (const k in sc) sc[k] += rng.range(-0.1, 0.1);
  const order = Object.entries(sc).sort((a, b) => b[1] - a[1]);
  const best = order[0][0];
  const close = order.length > 1 && order[0][1] - order[1][1] < 0.25;
  const askIt = hasRadio(game, t) && !enc.sudden && (close || ratio < 1.1 || (pf.disc > 0.65 && sev >= 3)) && rng.chance(0.35 + pf.asks * 0.5) && (enc.deadline - absNow(game) > 6);
  return { best, ask: askIt, ratio, sc };
}
function decideAndAct(game, t, enc, now, pf) {
  const d = decide(game, t, enc, pf);
  if (d.ask) {
    let choices, map = null, auto = d.best;
    if (enc.ext) {
      choices = enc.ext.options.map((o) => ({ id: o.id, label: o.label }));
      map = Object.fromEntries(enc.ext.options.map((o) => [o.id, o.cls === 'engage' || o.cls === 'check' ? 'engage' : o.cls === 'talk' ? 'talk' : o.cls === 'backup' ? 'backup' : o.cls === 'help' ? 'engage' : 'observe']));
      auto = (enc.ext.options.find((o) => map[o.id] === d.best) || enc.ext.options[0]).id;
    } else {
      choices = ['engage', 'backup', 'observe'];
      if (enc.talkable) choices.splice(1, 0, 'talk');
    }
    const q = enc.ext && typeof enc.ext.question === 'string' && !badText(enc.ext.question) ? enc.ext.question : pick(game, T.askQ);
    const ttl = Math.max(3, Math.min(6, enc.deadline - now - 2));
    const m = ask(game, t, `${enc.situation} ${q}`, choices, auto, ttl, { type: 'enc', taskId: t.id, encId: enc.id, map });
    if (m) { enc.stage = 'await'; enc.msgId = m.id; return; }
  }
  applyAction(game, t, enc, d.best, 'self');
}
registerHandler('enc', (game, msg, choice, auto) => {
  const t = taskById(game, msg.meta.taskId);
  if (!t || !t.rt.enc || t.rt.enc.id !== msg.meta.encId || t.rt.enc.stage !== 'await') return;
  const action = msg.meta.map ? msg.meta.map[choice] || 'observe' : choice;
  if (auto) autoNote(game, t, action); else ackNote(game, t, action);
  applyAction(game, t, t.rt.enc, action, auto ? 'self' : 'player');
});
registerHandler('raid_go', (game, msg, choice, auto) => {
  const t = taskById(game, msg.meta.taskId);
  if (!t || !t.rt.enc || t.rt.enc.id !== msg.meta.encId) return;
  if (auto) autoNote(game, t, choice); else ackNote(game, t, choice);
  if (choice === 'abort') { t.rt.enc = null; beginReturn(game, t, 'abort'); return; }
  applyAction(game, t, t.rt.enc, choice === 'go' ? 'engage' : 'backup', auto ? 'self' : 'player');
});

export function applyAction(game, t, enc, action, how) {
  const now = absNow(game);
  enc.stage = 'acting';
  if (action === 'engage') return engage(game, t, enc, now);
  if (action === 'talk') return talkDown(game, t, enc, now);
  if (action === 'backup') {
    if (how === 'player') return sendHelp(game, t, enc, now);
    const why = enc.situation || '';
    const m = ask(game, t, fmt(pick(game, T.backupReq), { why: '' }).replace(/\s+$/, '') + ' ' + (enc.pre ? `Их ${collective(enc.pre.n)}.` : ''), ['send', 'none'], 'none', 5, { type: 'backup', taskId: t.id, encId: enc.id });
    if (m) { enc.stage = 'await'; enc.msgId = m.id; return; }
    return profile(game, t).courage > 0.5 ? engage(game, t, enc, now) : observe(game, t, enc, now);
  }
  if (action === 'withdraw') return observe(game, t, enc, now, true);
  return observe(game, t, enc, now);
}
registerHandler('backup', (game, msg, choice, auto) => {
  const t = taskById(game, msg.meta.taskId);
  if (!t || !t.rt.enc || t.rt.enc.id !== msg.meta.encId) return;
  const enc = t.rt.enc;
  if (choice === 'send') return sendHelp(game, t, enc, absNow(game));
  const pf = profile(game, t);
  if (auto) say(game, t, `Подмоги не будет — ${pf.courage > 0.5 ? 'работаем сами' : 'не лезем, наблюдаем'}.`);
  return pf.courage > 0.5 ? engage(game, t, enc, absNow(game)) : observe(game, t, enc, absNow(game));
});
function sendHelp(game, t, enc, now) {
  const r = autoTask(game, 'respond', { districtId: t.districtId, helpFor: t.id, n: 2, orders: { stance: 'aggressive', siren: true } });
  if (!r.ok) {
    dutySay(game, `${t.rt.callsign}, Заря: людей нет, справляйтесь сами.`, 'info');
    const pf = profile(game, t);
    return pf.courage > 0.45 ? engage(game, t, enc, now) : observe(game, t, enc, now);
  }
  enc.helpers.push(r.task.id);
  enc.stage = 'waitBackup';
  enc.deadline = Math.max(enc.deadline, now + 12);
  if (enc.kind === 'raid' || enc.kind === 'standoff') enc.deadline = now + 60;
  say(game, t, pick(game, T.backupComing));
  return null;
}
/** подкрепление прибыло на место (из city_tasks при прибытии respond с helpFor) */
export function helperArrived(game, h, now) {
  const t = taskById(game, h.rt.helpFor);
  if (!t || !t.rt.enc) return false;
  h.rt.joined = t.id;
  if (!t.rt.enc.helpers.includes(h.id)) t.rt.enc.helpers.push(h.id);
  if (t.rt.enc.stage === 'waitBackup') {
    say(game, t, pick(game, T.backupArrived), {});
    t.rt.enc.stage = 'acting';
    engage(game, t, t.rt.enc, now);
  }
  return true;
}

function stepEncounter(game, t, now) {
  const enc = t.rt.enc;
  if (enc.stage === 'fight') return fightRound(game, t, enc, now);
  if (enc.stage === 'standoff') return standoffTick(game, t, enc, now);
  if (enc.stage === 'assess') return decideAndAct(game, t, enc, now, profile(game, t));
  if ((enc.stage === 'await' || enc.stage === 'waitBackup') && now > enc.deadline) {
    if (enc.stage === 'waitBackup') say(game, t, pick(game, T.backupLate), {});
    for (const p of enc.perps) if (p.st === 'free') p.st = 'fled';
    return endEncounter(game, t, enc, 'escaped');
  }
}

/* ---------- исходы без стрельбы */
function talkDown(game, t, enc, now) {
  const rng = R(game);
  const pf = profile(game, t);
  const p = 0.35 + pf.talk * 0.45 - enc.severity * 0.08 + (enc.perps.every((x) => !FIRE[x.armed]) ? 0.1 : -0.15);
  if (rng.chance(clamp(p, 0.05, 0.92))) {
    for (const x of enc.perps) if (x.st === 'free') x.st = enc.severity >= 3 && t.orders.detain !== 'none' ? 'caught' : 'calm';
    return endEncounter(game, t, enc, 'resolved_talk');
  }
  return skirmish(game, t, enc, now);
}
function observe(game, t, enc, now, withdraw = false) {
  const rng = R(game);
  const pf = profile(game, t);
  for (const p of enc.perps) if (p.st === 'free') p.st = 'fled';
  if (!withdraw && enc.gangId && rng.chance(0.22 * pf.perc + 0.05)) {
    const g = gang(game, enc.gangId);
    const it = g && gangIntel(game, g, { kinds: ['hideout', 'stash'], reliability: 0.8, source: 'patrol', prefix: 'Проследили за ними: ' });
    if (it) enc.followIntel = it.text;
  }
  return endEncounter(game, t, enc, enc.victims > 0 || enc.severity >= 3 ? 'escaped' : 'nothing', { observed: true });
}
function engage(game, t, enc, now) {
  const rng = R(game);
  const pf = profile(game, t);
  const g = gang(game, enc.gangId);
  const T0 = g ? gT(g) : null;
  const armed = enc.perps.filter((p) => p.st === 'free' && FIRE[p.armed]);
  const ratio = squadPower(game, t, enc) / Math.max(0.25, enemyPower(enc));
  let pShoot = (T0 ? T0.aggression * 0.55 : 0.3) + (enc.severity >= 4 ? 0.15 : 0) + (enc.cornered ? 0.15 : 0) - (ratio > 2 ? 0.2 : 0) - enc.surprise * 0.35;
  if (enc.kind === 'raid' && t.orders.mode === 'loud' && T0 && T0.surrender > 0.6) pShoot -= 0.2;
  if (armed.length && rng.chance(clamp(pShoot, 0.05, 0.9))) {
    // осада: засели и отстреливаются
    if (enc.kind === 'raid' && enc.surprise < 0.5 && g && (g.type === 'afghan' || g.type === 'frostbitten') && rng.chance(0.3)) return startStandoff(game, t, enc, now);
    enc.bFired = true;
    enc.stage = 'fight';
    say(game, t, pick(game, T.alarm), { place: enc.place ? enc.place.prep : dForm(t.districtId, 'prep'), weapons: weaponsPhrase(armed.length, armed.length, 0) }, 'alarm', { important: true });
    return fightRound(game, t, enc, now);
  }
  if (armed.length && t.orders.force === 'free' && rng.chance(0.4 + pf.aggr * 0.3)) {
    enc.stage = 'fight';
    enc.policeFirst = true;
    say(game, t, `${pick(game, T.open)} Открыли огонь ${enc.place ? enc.place.prep : ''}! Вооружённые, на приказ не реагируют!`, {}, 'alarm', { important: true });
    return fightRound(game, t, enc, now);
  }
  return skirmish(game, t, enc, now);
}
function skirmish(game, t, enc, now) {
  const rng = R(game);
  const pf = profile(game, t);
  const g = gang(game, enc.gangId);
  const T0 = g ? gT(g) : null;
  const fs = fighters(game, t, enc);
  const ratio = squadPower(game, t, enc) / Math.max(0.25, enemyPower(enc));
  const fit = fs.reduce((s, f) => s + sk(f.o, 'fitness') / 100 + tmod(game, f.o, 'fitness'), 0) / Math.max(1, fs.length);
  const night = isNight(now);
  for (const p of enc.perps) {
    if (p.st !== 'free') continue;
    const pSurr = (T0 ? T0.surrender : 0.55) * (ratio > 1.5 ? 1.2 : 0.8) * (0.6 + enc.surprise * 0.6) * (p.armed === 'none' ? 1.15 : 1);
    const pFlee = clamp(0.42 - fit * 0.25 + (night ? 0.1 : 0) - enc.surprise * 0.25 + (t.type === 'respond' && t.orders.siren ? 0.15 : 0) - (enc.cornered ? 0.2 : 0), 0.05, 0.8);
    const r = rng.next();
    if (r < pSurr) p.st = 'caught';
    else if (r < pSurr + pFlee) p.st = 'fled';
    else {
      const win = clamp(0.55 + (ratio - 1) * 0.2 + pf.tact * 0.15, 0.2, 0.95);
      p.st = rng.chance(win) ? 'caught' : 'fled';
      const pInj = ({ knife: 0.32, bat: 0.28, none: 0.12 }[p.armed] || 0.15) * (1 - pf.tact * 0.4);
      if (fs.length && rng.chance(pInj)) {
        const f = rng.pick(fs);
        hitOfficer(game, f.t, f.o, p.armed, `${p.armed === 'knife' ? 'ножевое ранение' : 'травма'} при задержании ${enc.place ? enc.place.prep : ''}`.trim(), p.armed === 'knife' ? null : 1);
      }
    }
  }
  const caught = enc.perps.filter((p) => p.st === 'caught').length;
  return endEncounter(game, t, enc, caught ? 'detained' : 'escaped');
}

/* ---------- перестрелка */
function fightRound(game, t, enc, now) {
  const rng = R(game);
  const pf = profile(game, t);
  const fs = fighters(game, t, enc);
  const band = enc.perps.filter((p) => p.st === 'free');
  const shooters = band.filter((p) => FIRE[p.armed]);
  if (!fs.length) { for (const p of band) p.st = 'fled'; return endEncounter(game, t, enc, 'shootout_loss'); }
  if (!band.length) return endEncounter(game, t, enc, 'shootout_win');
  const takeAlive = t.orders.takeAlive !== false && t.type === 'raid' ? true : t.orders.takeAlive === true;
  const policeFire = enc.bFired || enc.policeFirst || t.orders.force !== 'return_fire' || enc.round > 0;
  const surpriseRound = enc.round === 0 && enc.surprise > 0.5;
  const pCover = clamp(0.3 + pf.tact * 0.15, 0, 0.6);
  // огонь милиции
  if (policeFire) {
    for (const f of fs) {
      const eq = f.o.equipment || (f.o.equipment = {});
      let w = eq.weapon || 'pm';
      if (Number.isFinite(eq.ammo) && eq.ammo <= 0) continue;
      const shots = w === 'aks74u' ? 2 : 1;
      if (Number.isFinite(eq.ammo)) eq.ammo = Math.max(0, eq.ammo - (w === 'aks74u' ? 6 : w === 'ks23' ? 2 : 3));
      const p = 0.2 * (0.4 + sk(f.o, 'shooting') / 100 * 0.8 + tmod(game, f.o, 'shooting') * 0.4) * (ACC_POL[w] || 0.8) * (1 - enc.bCover)
        * (1 - fatigueOf(f.o, f.t) / 300) * (num(f.t.rt.inj[f.o.id]) >= 2 ? 0.4 : 1) * (surpriseRound ? 1 + enc.surprise * 0.6 : 1);
      for (let s = 0; s < shots; s++) {
        const alive = enc.perps.filter((x) => x.st === 'free');
        if (!alive.length || !rng.chance(p)) continue;
        const target = rng.pick(alive.filter((x) => FIRE[x.armed]).length ? alive.filter((x) => FIRE[x.armed]) : alive);
        const pKill = t.orders.force === 'free' ? 0.5 : takeAlive ? 0.18 : 0.33;
        target.st = rng.chance(pKill) ? 'dead' : 'down';
        target.shot = true;
        f.t.rt.kills = num(f.t.rt.kills) + (target.st === 'dead' ? 1 : 0);
        if (target.st === 'dead') adjustOfficer(game, f.o, { kills: 1, stress: 6 });
      }
    }
  }
  // огонь бандитов
  for (const b of shooters) {
    if (b.st !== 'free') continue;
    const p = 0.15 * b.skill * (ACC_B[b.armed] || 0.9) * (1 - pCover) * (surpriseRound ? 0.4 : 1);
    if (rng.chance(p)) {
      const alive = fighters(game, t, enc);
      if (!alive.length) break;
      const f = rng.pick(alive);
      hitOfficer(game, f.t, f.o, b.armed, `огнестрельное ранение в перестрелке ${enc.place ? enc.place.prep : ''}`.trim());
    }
  }
  // мирные
  const crowd = enc.place ? num(CROWDED[enc.place.kind], 0.3) : 0.5;
  const pCiv = ({ free: 0.06, proportional: 0.03, return_fire: 0.015 }[t.orders.force] || 0.03) * crowd * (isNight(now) ? 0.5 : 1);
  if (rng.chance(pCiv)) { if (rng.chance(0.3)) enc.civ.dead++; else enc.civ.hurt++; }
  // мелочь с ножами разбегается
  for (const p of enc.perps) if (p.st === 'free' && !FIRE[p.armed] && rng.chance(0.4)) p.st = enc.cornered && rng.chance(0.5) ? 'caught' : 'fled';
  enc.round++;
  // мораль бандитов
  const g = gang(game, enc.gangId);
  const T0 = g ? gT(g) : null;
  const total = enc.perps.length;
  const lost = enc.perps.filter((p) => p.st === 'dead' || p.st === 'down').length;
  const ratio = squadPower(game, t, enc) / Math.max(0.25, enemyPower(enc));
  const bm = (T0 ? T0.morale : 0.4) - (lost / total) * 0.6 - (ratio > 1.5 ? 0.1 : 0) - enc.round * 0.05;
  if (bm < 0.25) {
    for (const p of enc.perps) {
      if (p.st !== 'free') continue;
      const surr = (T0 ? T0.surrender : 0.5) * (enc.cornered ? 1.4 : 1);
      if (rng.chance(surr)) p.st = 'caught';
      else p.st = rng.chance(isNight(now) ? 0.75 : 0.6) ? 'fled' : 'caught';
    }
  }
  // решение командира об отходе
  const mine = fighters(game, t, enc);
  const dead = t.results.killed.length;
  const serious = Object.values(t.rt.inj).filter((v) => v >= 2).length;
  const startN = t.officerIds.length;
  const retreat = !mine.length || (dead > 0 && pf.courage < 0.6) || (serious > 0 && t.orders.retreatOnWounded && pf.courage < 0.75 && enc.round >= 2) || (startN - mine.length) / startN >= 0.5;
  const freeLeft = enc.perps.filter((p) => p.st === 'free').length;
  if (!freeLeft) return endEncounter(game, t, enc, 'shootout_win');
  if (retreat) {
    for (const p of enc.perps) { if (p.st === 'free') p.st = 'fled'; else if (p.st === 'down' && rng.chance(0.5)) p.st = 'fled'; }
    return endEncounter(game, t, enc, 'shootout_loss');
  }
  if (enc.round >= (enc.maxRounds || (enc.maxRounds = rng.int(4, 7)))) {
    for (const p of enc.perps) if (p.st === 'free') p.st = 'fled';
    return endEncounter(game, t, enc, lost ? 'shootout_win' : 'shootout_loss');
  }
  if (enc.round === 2) {
    const hurt = t.results.wounded.map((id) => officer(game, id)).filter(Boolean);
    const status = hurt.length ? `У нас ${oLast(hurt[0])} ${woundWord(hurt[0], num(t.rt.inj[hurt[0].id], 1))}!` : lost ? `${collective(lost) === 'один' ? 'Одного' : cap(collectiveGen(lost))} положили!` : 'Головы не поднять!';
    say(game, t, pick(game, T.midFight), { status }, 'alarm');
  }
  return null;
}
function startStandoff(game, t, enc, now) {
  enc.stage = 'standoff';
  enc.standoffSince = now;
  enc.bFired = true;
  const fire = enc.perps.filter((p) => FIRE[p.armed]).length;
  const pf = profile(game, t);
  const auto = pf.courage > 0.7 && pf.aggr > 0.5 ? 'storm' : pf.disc > 0.6 ? 'omon' : 'wait';
  const body = fmt(pick(game, T.standoff), { cs: t.rt.callsign, place: enc.place ? enc.place.prep : '', n: collective(enc.perps.length), weapons: weaponsPhrase(enc.perps.length, fire, 0) }, isFem(pf.L));
  const m = ask(game, t, body.replace(/^Заря,\s*[^.!]*[.!]\s*/, ''), ['storm', 'wait', 'negotiate', 'omon'], auto, 8, { type: 'standoff', taskId: t.id, encId: enc.id });
  if (!m) applyStandoff(game, t, enc, auto, false);
  else enc.msgId = m.id;
}
registerHandler('standoff', (game, msg, choice, auto) => {
  const t = taskById(game, msg.meta.taskId);
  if (!t || !t.rt.enc || t.rt.enc.id !== msg.meta.encId) return;
  if (auto) autoNote(game, t, choice); else ackNote(game, t, choice);
  applyStandoff(game, t, t.rt.enc, choice, auto);
});
function applyStandoff(game, t, enc, choice, auto) {
  const rng = R(game);
  const now = absNow(game);
  if (choice === 'storm') { enc.stage = 'fight'; enc.bCover = 0.55; enc.cornered = true; return fightRound(game, t, enc, now); }
  if (choice === 'omon') { enc.omonAt = now + rng.int(40, 75); enc.stage = 'standoff'; dispatchSay(game, `Гранит — ${t.rt.csDat}: ОМОН выезжает, будут минут через ${Math.round((enc.omonAt - now) / 5) * 5}. Держите периметр.`, 'info'); return; }
  if (choice === 'negotiate') {
    const pf = profile(game, t);
    const g = gang(game, enc.gangId);
    if (rng.chance(0.2 + pf.talk * 0.35 + (g ? gT(g).surrender * 0.3 : 0.2))) {
      for (const p of enc.perps) if (p.st === 'free') p.st = 'caught';
      say(game, t, 'Вышли с поднятыми руками. Пакуем.');
      return endEncounter(game, t, enc, 'detained');
    }
    say(game, t, 'Не выходят. Кричат, что живыми не дадутся.');
  }
  enc.stage = 'standoff';
  enc.nextCheck = now + 10;
}
function standoffTick(game, t, enc, now) {
  const rng = R(game);
  if (enc.omonAt && now >= enc.omonAt) {
    for (const p of enc.perps) if (p.st === 'free') p.st = rng.chance(0.25) ? 'dead' : 'caught';
    say(game, t, 'ОМОН отработал. Всех вывели, у ОМОНа без потерь.', {});
    authority(game, -2, 'вызов ОМОНа на свою территорию');
    enc.omon = true;
    return endEncounter(game, t, enc, 'shootout_win');
  }
  if (!enc.nextCheck || now < enc.nextCheck) return;
  enc.nextCheck = now + 10;
  const g = gang(game, enc.gangId);
  const r = rng.next();
  if (r < 0.12 + (g ? gT(g).surrender * 0.15 : 0)) { for (const p of enc.perps) if (p.st === 'free') p.st = 'caught'; say(game, t, 'Сдались, выходят по одному.'); return endEncounter(game, t, enc, 'detained'); }
  if (r < 0.25) { say(game, t, 'Пошли на прорыв!', {}, 'alarm'); enc.stage = 'fight'; enc.cornered = false; enc.maxRounds = enc.round + 3; return fightRound(game, t, enc, now); }
  if (now - enc.standoffSince > 150) { for (const p of enc.perps) if (p.st === 'free') p.st = 'fled'; say(game, t, 'Ушли подвалом, пока мы ждали. Внутри пусто.'); return endEncounter(game, t, enc, 'escaped'); }
}

/* ---------- ранения и потери */
export function hitOfficer(game, t, o, weapon, cause, forceSev = null) {
  const rng = R(game);
  const eq = o.equipment || {};
  const armor = eq.armor || 'none';
  const pDeath = num(DEATH[weapon], 0.05) * (armor === 'heavy' ? 0.35 : armor === 'vest' ? 0.55 : 1) * (eq.helmet ? 0.85 : 1) * (1 - clamp(tmod(game, o, 'luck'), 0, 0.8) * 0.6);
  if (!forceSev && rng.chance(pDeath)) { killOfficer(game, t, o, cause); return { dead: true }; }
  let sev = forceSev || rng.weighted([[1, 50], [2, 35], [3, 15]], (x) => x[1])[0];
  if (weapon === 'knife' && !forceSev) sev = rng.chance(0.65) ? 1 : 2;
  if (armor !== 'none' && FIRE[weapon] && rng.chance(armor === 'heavy' ? 0.6 : 0.45)) { sev = Math.max(1, sev - 1); cause = sev === 1 ? 'пуля в бронежилете, ушиб рёбер' : cause; }
  const f = dep(game, 'staff', 'applyInjury');
  if (f) safeCall('staff.applyInjury', f, game, o.id, sev, cause);
  else {
    o.hp = Math.max(1, num(o.hp, 100) - [0, 15, 35, 60][sev]);
    if (Array.isArray(o.injuries)) o.injuries.push({ name: cause, severity: sev, daysLeft: [0, 3, 14, 45][sev] });
    if (sev >= 3) o.status = 'hospital';
  }
  t.rt.inj[o.id] = Math.max(num(t.rt.inj[o.id]), sev);
  if (!t.results.wounded.includes(o.id)) t.results.wounded.push(o.id);
  if (sev >= 3) t.rt.out[o.id] = 'hospital';
  bump(game, 'policeWounded', 1, null);
  adjustOfficer(game, o, { stress: 10 + sev * 5, history: `${dmOf(absNow(game)).day}-й день: ${cause}` });
  if (o.id === t.leaderId && sev >= 3) newLeader(game, t, o, false);
  return { sev };
}
function killOfficer(game, t, o, cause) {
  const f = dep(game, 'staff', 'kill');
  if (f) safeCall('staff.kill', f, game, o.id, cause);
  else { o.status = 'dead'; o.hp = 0; }
  t.rt.out[o.id] = 'dead';
  if (!t.results.killed.includes(o.id)) t.results.killed.push(o.id);
  bump(game, 'policeKilled');
  authority(game, -6, 'гибель сотрудника');
  staffMorale(game, (x) => x.id !== o.id, -6);
  addEvent(game, { districtId: t.districtId, weight: 10, kind: 'police', text: `При исполнении служебных обязанностей ${killedWord(o)} ${oName(game, o)} (${cause}).` });
  glog(game, `${oName(game, o)} ${killedWord(o)}: ${cause}.`, 'death');
  if (o.id === t.leaderId) newLeader(game, t, o, true);
}
function newLeader(game, t, old, dead) {
  const sq = squad(game, t);
  if (!sq.length) return;
  const best = sq.reduce((a, o) => (sk(o, 'discipline') + sk(o, 'tactics') > sk(a, 'discipline') + sk(a, 'tactics') ? o : a), sq[0]);
  t.leaderId = best.id;
  say(game, t, `${oName(game, old)} ${dead ? killedWord(old) : woundWord(old, 3)}. Командование принял{/а} ${oName(game, best)}.`, {}, 'alarm', { important: true });
}

/* ---------- задержанный → данные для detainees.add */
export function captiveData(game, t, p, opts = {}) {
  const rng = R(game);
  const g = gang(game, p.gangId);
  const T0 = g ? gT(g) : null;
  const intelIds = [];
  if (g && !opts.petty) {
    const n = p.leader ? rng.int(2, 3) : rng.chance(0.6) ? 1 : 0;
    for (let i = 0; i < n; i++) { const it = gangIntel(game, g, { revealed: false, source: 'interrogation', reliability: rng.range(0.6, 0.9), kinds: p.leader ? ['hideout', 'stash', 'meeting', 'robbery'] : ['hideout', 'stash', 'deal', 'robbery', 'leader'] }); if (it) intelIds.push(it.id); }
  }
  const danger = clamp((p.leader ? 95 : { rifle: 80, shotgun: 70, pistol: 65, knife: 45, bat: 35, none: 18 }[p.armed] || 20) + (g ? 12 : 0) + (p.shot ? 5 : 0), 0, 100);
  const coop = clamp(opts.cooperation !== undefined ? opts.cooperation : g ? { thieves: 10, afghan: 15, sport: 30, drugs: 45, frostbitten: 20 }[g.type] : 50, 0, 100);
  const gender = (p.person && p.person.gender) || 'm';
  return {
    person: p.person, nick: p.nick || null, age: num(p.age, 25), gender,
    look: p.look || { uniform: opts.uniform || (T0 ? T0.uniform : gender === 'f' ? 'civil_f' : 'civil_m'), gender, skin: rng.int(0, 3), hair: rng.int(0, 5), hat: T0 ? rng.pick(T0.hats) : rng.pick(['none', 'beanie', 'cap', 'ushanka']), armor: false, weapon: 'none', build: Math.round(rng.range(0.88, 1.12) * 100) / 100 },
    charge: opts.charge || p.charge || CHARGES.hooligan, crimeId: opts.crimeId || null, gangId: p.gangId || null,
    danger, cooperation: coop, health: p.st === 'down' ? 45 : 90, intel: intelIds, notes: [], leader: !!p.leader, role: p.leader ? 'leader' : g ? 'member' : 'civil',
    taskId: t.id, arrestedBy: t.leaderId, armed: p.armed,
  };
}

/* ---------- завершение столкновения */
const FALLBACK_OUT = {
  detained: ['Взяли.', 'Задержали.', 'Повязали, сидят в машине.'], escaped: ['Ушли дворами, не догнали.', 'Скрылись. Ищем по горячим следам — пусто.'],
  shootout_win: ['Перестрелка окончена, противник подавлен.'], shootout_loss: ['Огневой контакт, противник ушёл.'], prevented: ['Пресекли.'],
  nothing: ['Обошлось.', 'Разошлись сами.'], false_alarm: ['Ложный вызов.'], found_body: ['Обнаружили тело.'], resolved_talk: ['Поговорили — успокоились.', 'Уладили словами.'],
};
function outLine(game, cr, outcome, enc, t) {
  const rng = R(game);
  const L = officer(game, t.leaderId);
  const pseudo = cr || { id: enc.id, title: enc.title || 'происшествие', category: 'organized', severity: enc.severity, place: enc.place || { name: '', prep: '' }, perps: enc.perps, victims: [], districtId: t.districtId, text: { dispatch: '' }, tags: [] };
  const s = callDep(game, 'crimes', 'outcomeText', rng, pseudo, outcome, L ? oName(game, L) : '');
  if (typeof s === 'string' && s.trim() && !badText(s) && cr) return sentence(s);
  return rng.pick(FALLBACK_OUT[outcome] || FALLBACK_OUT.nothing);
}
export function endEncounter(game, t, enc, outcome, extra = {}) {
  const rng = R(game);
  const pf = profile(game, t);
  const d = dist(game, t.districtId);
  const cr = crimeById(game, enc.crimeId);
  const g = gang(game, enc.gangId);
  const won = outcome !== 'shootout_loss' && outcome !== 'escaped';
  // раненые бандиты — тоже задержаны, если поле за нами
  for (const p of enc.perps) if (p.st === 'down') p.st = won ? 'caught' : 'fled';
  const caught = enc.perps.filter((p) => p.st === 'caught');
  const killed = enc.perps.filter((p) => p.st === 'dead');
  const fled = enc.perps.filter((p) => p.st === 'fled' || p.st === 'free');
  // кого везём
  const kept = [], released = [];
  for (const p of caught) {
    const serious = enc.severity >= 3 || p.armed !== 'none' || !!p.gangId || p.shot || enc.bFired;
    let keep = t.orders.detain === 'all' || (t.orders.detain === 'serious' && serious) || (t.orders.detain === 'none' && (p.shot || FIRE[p.armed] || enc.severity >= 4));
    if (!keep && pf.disc < 0.4 && serious && rng.chance(0.5)) keep = true;
    // жадный командир может отпустить «за мзду»
    if (keep && !p.leader && pf.greed > 0.6 && p.gangId && rng.chance((pf.greed - 0.5) * 0.4)) { keep = false; t.rt.hidden.push(`отпустили задержанного за деньги`); t.rt.pocket = num(t.rt.pocket) + rng.int(200, 900); }
    (keep ? kept : released).push(p);
  }
  for (const p of kept) {
    const charge = enc.bFired && p.shot ? CHARGES.attackPolice : enc.charge || (cr ? cr.title : enc.kind === 'raid' ? CHARGES.banditry : CHARGES.hooligan);
    t.rt.captives.push(captiveData(game, t, p, { charge, crimeId: cr ? cr.id : null }));
    if (p.leader && g) leaderCaught(game, g, 'arrested');
  }
  for (const p of killed) if (p.leader && g) leaderCaught(game, g, 'dead');
  // жестокость
  const sadist = squad(game, t).some((o) => hasTrait(o, 'sadist'));
  if (kept.length && rng.chance(pf.cruelty * 0.3 + (sadist ? 0.15 : 0))) {
    for (const c of t.rt.captives.slice(-kept.length)) { c.health = Math.max(20, c.health - 25); c.notes.push('доставлен со следами побоев'); }
    trust(game, t.districtId, -2);
    d.dayAcc.brutality++;
    bump(game, 'brutality');
    t.rt.hidden.push('избили задержанных');
  }
  if (killed.length && t.orders.force === 'free' && killed.some((p) => !FIRE[p.armed])) { trust(game, t.districtId, -3); authority(game, -3, 'применение оружия против безоружного'); }
  // мирные пострадавшие
  if (enc.civ.hurt || enc.civ.dead) {
    bump(game, 'civiliansHurt', enc.civ.hurt + enc.civ.dead);
    bump(game, 'civiliansKilled', enc.civ.dead);
    trust(game, t.districtId, -4 * enc.civ.hurt - 8 * enc.civ.dead);
    if (enc.civ.dead) authority(game, -8, 'гибель мирного жителя в перестрелке');
    addEvent(game, { districtId: t.districtId, weight: enc.civ.dead ? 9 : 6, kind: 'police', text: `В ходе перестрелки ${enc.place ? enc.place.prep : ''} пострадали посторонние: ${enc.civ.dead ? `погибших — ${enc.civ.dead}` : ''}${enc.civ.dead && enc.civ.hurt ? ', ' : ''}${enc.civ.hurt ? `раненых — ${enc.civ.hurt}` : ''}.` });
  }
  // банда
  if (g && (kept.length || killed.length)) {
    gangHit(game, g.id, { arrested: kept.filter((p) => p.gangId === g.id).length, killed: killed.filter((p) => p.gangId === g.id).length, districtId: t.districtId, anger: enc.kind === 'ambush' ? 10 : enc.kind === 'raid' ? 0 : 2, known: 5 });
  }
  if (killed.length) bump(game, 'banditsKilled', killed.length);
  if (kept.length) { bump(game, 'arrests', kept.length, t.districtId); adjustOfficer(game, officer(game, t.leaderId), { arrests: kept.length }); }
  // преступление
  const stopped = won && (kept.length || killed.length || outcome === 'resolved_talk' || outcome === 'detained');
  if (cr) {
    cr.inProgress = false;
    C(game).live = C(game).live.filter((id) => id !== cr.id);
    if (stopped) {
      cr.status = 'resolved';
      if (kept.length || killed.length) { bump(game, 'solved', 1, cr.districtId); d.dayAcc.solved++; d.stats.solved = num(d.stats.solved) + 1; t.results.crimesSolved++; }
      else { bump(game, 'prevented'); t.results.crimesPrevented++; }
      trust(game, t.districtId, 0.4 * cr.severity + (enc.victims ? 0.8 : 0));
    } else if (cr.status !== 'resolved') { cr.status = 'unsolved'; if (extra.observed && enc.victims) trust(game, t.districtId, -1.2 * cr.severity); }
  } else if (stopped) { t.results.crimesPrevented++; }
  // добыча
  if (enc.loot && won && enc.kind !== 'raid') takeLoot(game, t, enc.loot, pf);
  // доклад
  const parts = [outLine(game, cr, outcome === 'detained' && !kept.length && released.length ? 'prevented' : outcome, enc, t)];
  if (kept.length) parts.push(`Задержали ${collectiveGen(kept.length)}${kept.some((p) => p.leader) ? ', среди них главный' : ''}.`);
  if (released.length) parts.push(`${released.length === 1 ? 'Одного' : cap(collectiveGen(released.length))} отпустили с предупреждением.`);
  if (killed.length) parts.push(killed.length === 1 ? 'Один нападавший убит.' : `Нападавших убито: ${killed.length}.`);
  if (fled.length && (kept.length || killed.length)) parts.push(fled.length === 1 ? 'Один ушёл.' : `${cap(collective(fled.length))} ушли.`);
  const hurt = Object.keys(t.rt.inj).filter((id) => !t.rt.reported[id]).map((id) => officer(game, id)).filter(Boolean);
  for (const o of hurt) { parts.push(`${oName(game, o)} — ${woundWord(o, t.rt.inj[o.id])}${t.rt.inj[o.id] >= 3 ? ', вызвали скорую' : ''}.`); t.rt.reported[o.id] = true; }
  for (const id of t.results.killed) if (!t.rt.reported[id]) { const o = officer(game, id); if (o) parts.push(`${oName(game, o)} — ${killedWord(o)}.`); t.rt.reported[id] = true; }
  if ((enc.bFired || enc.policeFirst) && !hurt.length && !t.results.killed.length) parts.push('У нас потерь нет.');
  if (enc.followIntel) parts.push(enc.followIntel);
  if (enc.civ.dead || enc.civ.hurt) parts.push('Задело гражданских, нужна скорая.');
  const lead = enc.bFired || enc.policeFirst ? pick(game, outcome === 'shootout_loss' ? T.fightLoss : T.fightWin) + ' ' : '';
  report(game, t, lead + parts.join(' '), {}, enc.bFired && outcome === 'shootout_loss' ? 'alarm' : 'report', { important: true });
  if (enc.bFired || enc.policeFirst) {
    for (const o of squad(game, t)) adjustOfficer(game, o, { stress: 8, fatigue: 0 });
    for (const id of t.officerIds) t.rt.fat[id] = num(t.rt.fat[id]) + 8;
    addEvent(game, { districtId: t.districtId, weight: 7, kind: 'police', text: `${cap(dForm(t.districtId, 'prep'))} ${enc.place ? enc.place.prep : ''} наряд ${t.rt.callsign} вёл бой${g && g.known > 25 ? ` с членами группировки «${g.name}»` : ' с вооружёнными преступниками'}: задержано ${kept.length}, убито ${killed.length}${t.results.wounded.length ? `, ранено сотрудников: ${t.results.wounded.length}` : ''}.` });
  }
  t.rt.enc = null;
  // помощники возвращаются
  for (const hid of enc.helpers) { const h = taskById(game, hid); if (h && h.phase === 'active') beginReturn(game, h, 'done'); else if (h) h.rt.helpFor = null; }
  // что дальше
  if (t.rt.sub) { t.rt.sub = null; t.rt.pauseUntil = absNow(game) + 6; }
  const serious = Object.values(t.rt.inj).some((v) => v >= 2);
  if (!squad(game, t).length) return beginReturn(game, t, 'empty');
  if (serious && t.orders.retreatOnWounded) return beginReturn(game, t, 'wounded');
  if (squad(game, t).every((o) => o.equipment && Number.isFinite(o.equipment.ammo) && o.equipment.ammo < 6 && o.equipment.weapon !== 'none')) { report(game, t, pick(game, T.ammoLow), {}); return beginReturn(game, t, 'ammo'); }
  if (t.type === 'raid' && won) { t.rt.stage = 'search'; t.rt.stageUntil = absNow(game) + rng.int(20, 40); return; }
  if (['respond', 'ambush', 'raid'].includes(t.type) || enc.kind === 'arrest') return beginReturn(game, t, 'done');
  if (t.type === 'search' && enc.kind === 'rescue') return beginReturn(game, t, 'done');
  if (t.type === 'escort') { t.rt.escortHit = outcome; return; }
  return null;
}

function takeLoot(game, t, loot, pf) {
  const rng = R(game);
  let m = num(loot.money);
  if (m > 0) {
    // кто-то из наряда может прикарманить часть — скрыто
    const greedy = squad(game, t).filter((o) => num(o.hidden && o.hidden.corruption, 10) > 50 || hasTrait(o, 'greedy'));
    const watched = pf.disc > 0.75 && hasTrait(pf.L, 'honest');
    if (greedy.length && !watched && rng.chance(0.6)) {
      const share = Math.round(m * rng.range(0.2, 0.6));
      m -= share;
      C(game).ledger.push({ day: dmOf(absNow(game)).day, officerId: rng.pick(greedy).id, amount: share, taskId: t.id, what: 'часть изъятых денег' });
    }
    t.results.money += m;
    bump(game, 'moneySeized', m);
  }
  for (const it of loot.items || []) t.results.evidence.push(it);
}
function raidSearch(game, t, now, pf) {
  const rng = R(game);
  const g = gang(game, t.targetGangId);
  const enc = t.rt.lastRaidEnc;
  if (t.rt.empty) {
    if (rng.chance(0.4)) { t.results.evidence.push(rng.pick(['записная книжка с телефонами', 'пустые гильзы, тряпки в оружейном масле'])); }
    report(game, t, 'Обыскали — ничего толкового. Возвращаемся.', {});
  } else if (g) {
    const loot = t.rt.raidLoot || { money: 0, items: [] };
    takeLoot(game, t, loot, pf);
    gangHit(game, g.id, { money: loot.money, districtId: t.districtId, influence: t.orders.mode === 'loud' ? 18 : 10, anger: 22, known: 12, cohesion: 12, weapons: (loot.items || []).some((x) => /автомат|АКМ|гранат/.test(x)) ? 0.6 : 0 });
    const d = dist(game, t.districtId);
    d.dayAcc.raids[g.id] = num(d.dayAcc.raids[g.id]) + 1;
    g.stats.raids++;
    trust(game, t.districtId, t.orders.mode === 'loud' ? 2.5 : 1.5);
    authority(game, 2);
    let found = '';
    if (rng.chance(0.45)) { const it = gangIntel(game, g, { source: 'investigation', reliability: 0.75, prefix: 'По бумагам с точки: ' }); if (it) found = ' ' + it.text; }
    report(game, t, `Обыск закончили. Изъято: ${loot.money ? money(loot.money) : 'денег нет'}${(loot.items || []).length ? ', ' + joinList(loot.items) : ''}.${found}`, {});
    addEvent(game, { districtId: t.districtId, weight: 7, kind: 'police', text: `Проведён рейд на точку группировки «${g.name}» ${findPlace(game, t.placeId) ? findPlace(game, t.placeId).p.prep : ''}. Изъято: ${loot.money ? money(loot.money) : 'денег не найдено'}${(loot.items || []).length ? '; ' + joinList(loot.items) : ''}.` });
  }
}

/* ------------------------------------------------------------------ вызов: наряд рядом / берёт вызов */
export function leaderSeesCrime(game, t, cr) {
  const enc = encFromCrime(game, t, cr);
  enc.surprise = 0.5;
  startEncounter(game, t, enc, absNow(game), { saw: fmt(pick(game, T.sawCrime), { cs: t.rt.callsign, what: `${lowerFirst(cr.title)} ${cr.place.prep}.` }).replace(/^Заря,\s*[^!.]*[!.]\s*/, '') });
}
export function leaderTakesCall(game, t, cr) {
  const rng = R(game);
  const pf = profile(game, t);
  const sq = squad(game, t);
  if (!sq.length || !hasRadio(game, t)) return false;
  const fat = sq.reduce((s, o) => s + fatigueOf(o, t), 0) / sq.length;
  let p = 0.45 + pf.dilig * 0.3 + pf.courage * 0.2 - (fat > 70 ? 0.3 : 0) - (cr.danger > 0.6 ? (1 - pf.courage) * 0.4 : 0);
  if (t.rt.slackUntil > absNow(game)) p *= 0.3;
  return rng.chance(clamp(p, 0.05, 0.95));
}
export function takeCall(game, t, cr) {
  const rng = R(game);
  const now = absNow(game);
  const same = cr.districtId === t.districtId;
  const eta = same ? (t.orders.route === 'car' || t.vehicle ? rng.int(2, 6) : rng.int(4, 10)) : rng.int(8, 15);
  cr.status = 'responding';
  cr.assignedTaskId = t.id;
  t.rt.sub = { crimeId: cr.id, arriveAt: now + eta, same };
  if (same) say(game, t, pick(game, T.takeCall), { eta });
}
function stepSub(game, t, now) {
  const sub = t.rt.sub;
  if (now < sub.arriveAt) return;
  const cr = crimeById(game, sub.crimeId);
  t.rt.sub = null;
  if (!cr) return;
  t.rt.sub = { ...sub, arrived: true };
  arriveAtCrime(game, t, cr, now);
  if (!t.rt.enc) { t.rt.sub = null; if (!sub.same) t.rt.pauseUntil = now + 10; }
}
/** прибыли на место происшествия: застали — столкновение; опоздали — горячие следы */
function arriveAtCrime(game, t, cr, now) {
  const rng = R(game);
  const pf = profile(game, t);
  if (cr.tags.includes('false_alarm') || (cr.severity <= 1 && rng.chance(0.08))) {
    cr.status = 'resolved'; cr.inProgress = false;
    report(game, t, outLine(game, cr, 'false_alarm', { title: cr.title, perps: [], severity: 1 }, t), {});
    if (t.type === 'respond') beginReturn(game, t, 'done');
    return;
  }
  if (cr.inProgress && now < num(cr.endsAt, now)) {
    const enc = encFromCrime(game, t, cr);
    enc.surprise = t.type === 'respond' && t.orders.siren ? 0.1 : 0.45;
    if (t.type === 'respond' && t.orders.siren && rng.chance(0.4)) {
      // сирена спугнула: жертвам легче, но преступники уходят
      for (const p of enc.perps) p.st = rng.chance(0.75) ? 'fled' : 'free';
      if (enc.perps.every((p) => p.st === 'fled')) {
        cr.status = 'unsolved'; cr.inProgress = false; C(game).live = C(game).live.filter((id) => id !== cr.id);
        bump(game, 'prevented'); t.results.crimesPrevented++;
        report(game, t, `${outLine(game, cr, 'prevented', enc, t)} Услышали сирену — разбежались. Пострадавшим помогаем.`, {});
        cr.inv = { progress: num(cr.inv && cr.inv.progress) + 0.15 };
        if (t.type === 'respond') beginReturn(game, t, 'done');
        return;
      }
    }
    startEncounter(game, t, enc, now, { saw: `На месте: ${lowerFirst(cr.title)} ${cr.place.prep}.` });
    return;
  }
  // опоздали
  cr.inProgress = false;
  C(game).live = C(game).live.filter((id) => id !== cr.id);
  if (cr.perps.length && rng.chance(0.18 + pf.perc * 0.2)) {
    const p = cr.perps[0];
    const enc = newEnc(game, t, { kind: 'arrest', crimeId: cr.id, gangId: p.gangId, place: cr.place, perps: [p], severity: cr.severity, surprise: 0.3, title: cr.title });
    startEncounter(game, t, enc, now, { saw: `Опоздали, но по горячим следам вышли на одного — ${p.desc}.` });
    return;
  }
  cr.status = 'unsolved';
  cr.inv = { progress: num(cr.inv && cr.inv.progress) + 0.2 };
  report(game, t, `${outLine(game, cr, 'escaped', { title: cr.title, perps: cr.perps, severity: cr.severity }, t)} Опросили людей, приметы записали.`, {});
  if (t.type === 'respond') beginReturn(game, t, 'done');
}

/* ------------------------------------------------------------------ раскрытие */
function investigateStep(game, t, now, pf) {
  const rng = R(game);
  const cr = crimeById(game, t.targetCrimeId);
  const rt = t.rt;
  if (!cr || cr.status === 'resolved') { report(game, t, 'По делу всё ясно, возвращаюсь.', {}); beginReturn(game, t, 'done'); return; }
  const d = dist(game, cr.districtId);
  const inv = cr.inv || (cr.inv = { progress: 0, scene: false, witnesses: 0 });
  const sq = squad(game, t);
  const skill = sq.reduce((s, o) => s + (sk(o, 'investigation') + sk(o, 'perception') * 0.5 + sk(o, 'talk') * 0.5) / 200 + (o.role === 'oper' ? 0.15 : 0), 0) / Math.max(1, sq.length) + (sq.length - 1) * 0.15;
  const g = gang(game, cr.gangId);
  const fear = g ? num(d.influence[g.id]) / 100 : 0;
  const approach = t.orders.approach;
  let mul = approach === 'pressure' ? 1.4 : 1;
  if (approach === 'agents') {
    const infs = C(game).informants.filter((i) => i.status === 'active' && i.districtId === cr.districtId);
    if (infs.length) { mul = 1.6; if (rng.chance(0.03)) { const inf = rng.pick(infs); if (g) { inf.status = 'burned'; rt.notes.push(`засветили источник «${inf.alias}»`); } } }
  }
  if (rt.slackUntil > now) mul *= 0.4;
  let gain;
  let note = '';
  if (!inv.scene) {
    inv.scene = true;
    gain = cr.solvability * 0.25 * skill * 1.6;
    note = cr.evidence.length ? `Осмотрел{/а} место: ${joinList(cr.evidence.slice(0, 2))}.` : 'Осмотр места — почти ничего, всё затоптано.';
  } else {
    const willing = clamp(0.25 + num(d.trust) / 100 * 0.6 - fear * 0.5 + (approach === 'pressure' ? 0.15 : 0), 0.05, 0.95);
    if (cr.witnesses > inv.witnesses && rng.chance(willing)) {
      inv.witnesses++;
      gain = cr.solvability * 0.3 * skill;
      note = rng.pick(['Нашёл{/а} свидетельницу — соседка, всё видела из окна.', 'Один из свидетелей разговорился: описал приметы.', 'Продавщица из соседнего ларька вспомнила машину.']);
      // ключевой свидетель под угрозой
      if (g && cr.severity >= 3 && rng.chance(0.25) && !rt.witnessMade) {
        rt.witnessMade = true;
        const w = { person: { ...(rng.chance(0.5) ? { gender: 'f' } : { gender: 'm' }) } };
        const wp = cr.victims[0] ? cr.victims[0].person : null;
        const it = addIntel(game, { kind: 'witness', gangId: g.id, districtId: cr.districtId, placeId: cr.place.id, crimeId: cr.id, reliability: 0.9, source: 'investigation', expires: now + 3 * 1440, text: `Ключевому свидетелю по делу «${cr.title}» угрожают ${gn(g, 'people')}. Живёт ${cr.place.prep}. Без охраны — запугают или уберут.` });
        C(game).schedule.push({ at: now + rng.int(6, 30) * 60, kind: 'gangop', op: 'witness', intelId: it.id, gangId: g.id, districtId: cr.districtId, placeId: cr.place.id, crimeId: cr.id });
        note += ' Но свидетель боится: ему уже звонили.';
        void w; void wp;
      }
    } else if (cr.witnesses <= inv.witnesses) {
      gain = cr.solvability * 0.06 * skill;
      note = rng.pick(['Хожу по квартирам — никто ничего не видел.', 'Проверяю по картотеке, сверяю приметы.', 'Работаю с бумагами, жду ответа из ИЦ.']);
    } else {
      gain = cr.solvability * 0.03;
      note = fear > 0.3 ? `Свидетели молчат — боятся ${g ? gn(g, 'peopleGen') : 'мести'}.` : rng.pick(['Люди не хотят разговаривать.', 'Дверь не открывают.']);
    }
    if (approach === 'pressure' && rng.chance(0.2)) { trust(game, cr.districtId, -0.6); rt.hidden.push('давили на свидетелей'); }
    // вербовка
    if (rng.chance(0.03 * pf.talk + (num(d.trust) > 55 ? 0.02 : 0)) && !C(game).informants.some((i) => i.districtId === d.id && i.status === 'active')) {
      const inf = addInformant(game, { districtId: d.id, source: 'investigation', gangId: cr.gangId });
      note += ` Есть человек, готовый сотрудничать — «${inf.alias}».`;
    }
  }
  inv.progress = clamp(inv.progress + gain * mul * rng.range(0.6, 1.3), 0, 1.5);
  rt.invNotes = num(rt.invNotes) + 1;
  if (inv.progress >= 1) {
    const p = cr.perps[0] || genGangPerp(game, g, {});
    if (!cr.perps.length) cr.perps.push(p);
    // ложное признание при давлении
    if (approach === 'pressure' && rng.chance(0.12)) cr.falseSolve = true;
    if (rng.chance(0.62)) {
      const enc = newEnc(game, t, { kind: 'arrest', crimeId: cr.id, gangId: p.gangId, place: cr.place, perps: [p], severity: cr.severity, surprise: 0.55, title: cr.title, charge: cr.title });
      startEncounter(game, t, enc, now, { saw: `Установил{/а} подозреваемого — ${fullName(p.person)}, ${p.desc}. Он дома.` });
    } else {
      const it = addIntel(game, { kind: 'suspect', gangId: p.gangId, districtId: cr.districtId, placeId: rng.pick(d.places).id, crimeId: cr.id, reliability: 0.8, source: 'investigation', expires: now + 4 * 1440, text: `По делу «${cr.title}»: подозреваемый ${fullName(p.person)} установлен, скрывается ${dForm(cr.districtId, 'prep')}. Нужна группа на задержание.` });
      report(game, t, `Подозреваемый установлен: ${fullName(p.person)}. Дома нет — скрывается. ${it ? 'Нужна группа на задержание.' : ''}`, {});
      beginReturn(game, t, 'done');
    }
    return;
  }
  if (num(rt.invNotes) % 4 === 1 || note.includes('свидетел')) {
    const progress = inv.progress > 0.66 ? 'Круг сужается, к вечеру, думаю, будет фамилия.' : inv.progress > 0.33 ? 'Кое-что есть, работаю дальше.' : 'Пока глухо.';
    report(game, t, `${note} ${progress}`, {});
  }
}

/* ------------------------------------------------------------------ конвой */
function escortStep(game, t, now, pf) {
  const rng = R(game);
  const rt = t.rt;
  if (rt.escortHit === 'shootout_loss' && !rt.freed) {
    rt.freed = true;
    for (const id of rt.cargo || []) detaineeEscaped(game, id);
    report(game, t, 'Задержанных отбили. Ушли на двух машинах в сторону Промзоны.', {}, 'alarm', { important: true });
    authority(game, -8, 'задержанных отбили при конвоировании');
    beginReturn(game, t, 'done');
    return;
  }
  if (!rt.interceptChecked && t.elapsed > rt.legMin / 2) {
    rt.interceptChecked = true;
    const det = Array.isArray(game.state.detainees) ? game.state.detainees : [];
    let threat = null, pThreat = 0;
    for (const id of rt.cargo || []) {
      const dd = det.find((x) => x.id === id);
      const g = dd && gang(game, dd.gangId);
      if (!g || g.status !== 'active') continue;
      const held = C(game).captivesHeld.find((h) => h.detId === id);
      const p = (0.04 + g.strength / 100 * 0.3) * (held && held.leader ? 2 : 1) * (t.orders.escortRoute === 'detour' ? 0.5 : 1) + (moleFor(game, g.id) ? 0.15 : 0);
      if (p > pThreat) { pThreat = p; threat = g; }
    }
    if (rt.cash) {
      const d = dist(game, t.districtId);
      const g = topGang(game, d, 20);
      if (g) { pThreat = 0.04 + num(d.influence[g.id]) / 400; threat = g; }
    }
    if (threat && rng.chance(clamp(pThreat, 0, 0.7))) {
      const perps = []; for (let i = 0; i < rng.int(3, 5); i++) perps.push(genGangPerp(game, threat));
      const enc = newEnc(game, t, { kind: 'convoy', gangId: threat.id, place: { id: 'road', name: 'трасса', prep: t.orders.escortRoute === 'detour' ? 'на объездной у переезда' : 'на Северном шоссе', kind: 'street' }, perps, severity: 5, surprise: 0, sudden: true, title: 'нападение на конвой' });
      startEncounter(game, t, enc, now, {});
    }
    return;
  }
  if (t.elapsed >= rt.legMin) {
    if (rt.cash) {
      const pay = rng.int(600, 1500);
      t.results.money += pay;
      report(game, t, `Ценности доставлены, инкассаторов сдали. Банк обещал перечислить ${money(pay)} за сопровождение.`, {});
      authority(game, 1);
    } else {
      const f = dep(game, 'detainees', 'transfer');
      for (const id of rt.cargo || []) { if (f) safeCall('detainees.transfer', f, game, id); C(game).captivesHeld = C(game).captivesHeld.filter((h) => h.detId !== id); }
      const n = (rt.cargo || []).length;
      report(game, t, `Сдали в СИЗО ${n === 1 ? 'задержанного' : collectiveGen(n) + ' задержанных'}, бумаги подписаны. Возвращаемся.`, {});
    }
    beginReturn(game, t, 'done');
  }
}
function detaineeEscaped(game, id) {
  const f = dep(game, 'detainees', 'escape');
  if (f) { safeCall('detainees.escape', f, game, id); return; }
  // CONTRACT-NEEDS: detainees.escape(game, id). Пока — минимальная правка статуса.
  const det = Array.isArray(game.state.detainees) ? game.state.detainees.find((x) => x.id === id) : null;
  if (det) det.status = 'escaped';
  const h = C(game).captivesHeld.find((x) => x.detId === id);
  if (h) { const g = gang(game, h.gangId); if (g) { g.members++; if (h.leader && g.leader.status === 'arrested' && g.leader.person && det && det.person && det.person.lastName === g.leader.person.lastName) g.leader.status = 'free'; recalc(g); } }
  C(game).captivesHeld = C(game).captivesHeld.filter((x) => x.detId !== id);
}

/* ------------------------------------------------------------------ розыск */
function searchStep(game, t, now, pf) {
  const rng = R(game);
  const cr = crimeById(game, t.targetCrimeId);
  const rt = t.rt;
  if (!cr || !cr.missing || cr.status === 'resolved') { report(game, t, cr && cr.selfResolved ? 'Отбой: пропавший нашёлся сам. Возвращаемся.' : 'Отбой поиска, возвращаемся.', {}); beginReturn(game, t, 'done'); return; }
  const m = cr.missing;
  const sq = squad(game, t);
  const dog = sq.some((o) => o.role === 'kinolog');
  const wideNeed = ['ran_away', 'friend', 'drunk_friend', 'hospital', 'kidnapped'].includes(m.fate);
  const areaMul = t.orders.area === 'wide' ? (wideNeed ? 1.4 : 0.8) : (wideNeed ? 0.8 : 1.4);
  const d = dist(game, cr.districtId);
  const gain = (0.04 + 0.025 * sq.length) * (0.7 + pf.perc * 0.6) * (dog ? 1.7 : 1) * areaMul * (num(d.trust) > 50 ? 1.2 : 1) * (rt.slackUntil > now ? 0.4 : 1);
  rt.progress = num(rt.progress) + gain * rng.range(0.5, 1.4);
  if (rt.progress < 1) {
    if (rng.chance(0.15)) report(game, t, pick(game, T.searchProgress), { street: rng.pick(['Строителей', 'Мира', 'Заводской', 'Садовой']) });
    return;
  }
  const f = m.gender === 'f';
  const name = `${m.person.firstName} ${m.person.lastName}`;
  if (m.fate === 'kidnapped' && m.gangId) {
    const g = gang(game, m.gangId);
    const perps = []; for (let i = 0; i < rng.int(1, 3); i++) perps.push(genGangPerp(game, g));
    const pl = rng.pick(d.places.filter((p) => ['garage', 'dacha', 'warehouse', 'flat'].includes(p.kind))) || rng.pick(d.places);
    const enc = newEnc(game, t, { kind: 'rescue', crimeId: cr.id, gangId: m.gangId, place: pl, perps, severity: 4, surprise: 0.5, title: 'удержание заложника', charge: CHARGES.kidnap, victims: 1 });
    cr.status = 'responding';
    m.fate = 'rescued_pending';
    startEncounter(game, t, enc, now, { saw: `Нашли, где ${f ? 'её' : 'его'} держат — ${pl.prep}. Должок, видно. Внутри ${collective(perps.length)}.` });
    return;
  }
  cr.status = 'resolved';
  if (m.fate === 'dead') {
    report(game, t, `${outLine(game, cr, 'found_body', { title: cr.title, perps: [], severity: 4 }, t)} ${name}… ${f ? 'Её' : 'Его'} нашли ${rng.pick(['в подвале, на теплотрассе', 'в канаве за гаражами', 'у реки, под мостом'])}. Вызываем опергруппу и… родным сообщим сами.`, {});
    addEvent(game, { districtId: cr.districtId, weight: 6, kind: 'crime', crimeId: cr.id, text: `В ходе розыска обнаружен${f ? 'а' : ''} мёртв${f ? 'ой' : 'ым'} ${name}, ${m.age} лет.` });
    staffMorale(game, (o) => t.officerIds.includes(o.id), -4);
  } else {
    const where = { lost: 'заблудил{ся/ась}, сидел{/а} в чужом подъезде, {весь продрог/вся продрогла}', friend: 'был{/а} у знакомых, «не подумал{/а}», что ищут', ran_away: 'сбежал{/а} — нашли на вокзале, хотел{/а} уехать', accident: 'упал{/а} в открытый люк, нога сломана — вытащили, скорая увезла', hospital: 'лежит в больнице без документов, поступил{/а} позавчера', drunk_friend: 'неделю пил у дружка, в Частном секторе', rescued_pending: '{нашёлся/нашлась}' }[m.fate] || '{нашёлся/нашлась}';
    const wh = fmt(where, {}, f);
    report(game, t, `Нашли! ${name} — ${wh}. ${f ? 'Жива' : 'Жив'}. Передаём родным.`, {});
    trust(game, cr.districtId, 4);
    flags(game).reputation = clamp(num(flags(game).reputation, 40) + 1.5, 0, 100);
    addEvent(game, { districtId: cr.districtId, weight: 4, kind: 'police', crimeId: cr.id, text: `Нарядом ${t.rt.callsign} найден${f ? 'а' : ''} пропавш${f ? 'ая' : 'ий'} ${name}, ${m.age} лет. Передан${f ? 'а' : ''} родственникам.` });
  }
  bump(game, 'solved', 1, cr.districtId);
  t.results.crimesSolved++;
  beginReturn(game, t, 'done');
}

/* ------------------------------------------------------------------ операции банд против объектов (налёт по наводке, расправа со свидетелем) */
export function gangOp(game, ev) {
  const rng = R(game);
  const g = gang(game, ev.gangId);
  if (!g || g.status !== 'active') return;
  const now = absNow(game);
  const it = intelById(game, ev.intelId);
  // засада ждёт по этой наводке
  const amb = liveTasks(game).find((t) => t.type === 'ambush' && t.targetId === ev.intelId && t.phase === 'active');
  if (amb && it) { it.arrivedAt = now; return; }
  const guard = liveTasks(game).find((t) => t.type === 'guard' && t.phase === 'active' && ((ev.op === 'witness' && t.targetId === ev.intelId) || (ev.op !== 'witness' && t.placeId === ev.placeId)));
  const fp = findPlace(game, ev.placeId);
  const pl = fp ? fp.p : null;
  if (guard && !guard.rt.enc) {
    if (guard.orders.posture !== 'hidden' && rng.chance(0.6)) {
      guard.results.crimesPrevented++;
      bump(game, 'prevented');
      report(game, guard, `У объекта притормозила «девятка», ${collective(rng.int(2, 4))} посмотрели на нас и уехали. Номер записали.`, {});
      if (it) it.used = true;
      return;
    }
    const perps = []; for (let i = 0; i < rng.int(2, 4); i++) perps.push(genGangPerp(game, g));
    const enc = newEnc(game, guard, { kind: 'guardhit', gangId: g.id, place: pl, perps, severity: 4, surprise: guard.orders.posture === 'hidden' ? 0.6 : 0.2, title: ev.op === 'witness' ? 'нападение на свидетеля' : 'вооружённый налёт', victims: 1 });
    if (it) it.used = true;
    startEncounter(game, guard, enc, now, { saw: ev.op === 'witness' ? `К подъезду свидетеля подошли ${collective(perps.length)}.` : `Подъехали ${collective(perps.length)}, идут к объекту.` });
    return;
  }
  if (it) it.used = true;
  if (ev.op === 'witness') {
    const cr = crimeById(game, ev.crimeId);
    const killed = rng.chance(g.type === 'frostbitten' ? 0.5 : 0.25);
    if (cr) { cr.solvability = Math.max(0.05, cr.solvability * 0.3); if (cr.inv) cr.inv.progress = Math.max(0, cr.inv.progress - 0.4); }
    if (killed) ownCrime(game, { typeId: 'witness_murder', category: 'violent', severity: 5, title: 'Убийство свидетеля', districtId: ev.districtId, place: pl, perps: [genGangPerp(game, g)], victims: [{ person: null, age: 45, desc: 'свидетель по уголовному делу', condition: 'dead' }], witnesses: 0, evidence: ['гильза от ТТ'], text: { dispatch: `обнаружен убитым свидетель по делу${cr ? ` «${cr.title}»` : ''}.`, caller: '', news: null, details: 'Свидетеля не охраняли.' }, solvability: 0.15, gangId: g.id, tags: ['witness'] });
    else addEvent(game, { districtId: ev.districtId, weight: 5, kind: 'crime', text: `Свидетель по делу${cr ? ` «${cr.title}»` : ''} отказался от показаний: «ничего не видел, ничего не помню». Охраны у него не было.` });
    trust(game, ev.districtId, killed ? -4 : -2);
    return;
  }
  // налёт состоялся
  const perps = []; for (let i = 0; i < rng.int(2, 4); i++) perps.push(genGangPerp(game, g));
  const loot = rng.int(800, 6000);
  const dead = rng.chance(0.3) ? 1 : 0;
  g.money += loot;
  ownCrime(game, { typeId: 'armed_robbery', category: 'violent', severity: 5, title: 'Вооружённое ограбление', districtId: ev.districtId, place: pl, perps, victims: [{ person: null, age: 40, desc: dead ? 'охранник' : 'кассир', condition: dead ? 'dead' : 'injured' }], witnesses: rng.int(1, 4), evidence: ['гильзы', 'следы протекторов'], loot: money(loot), text: { dispatch: `вооружённое ограбление ${pl ? pl.prep : ''}, налётчики уехали на машине.`, caller: '', news: null, details: it ? 'О налёте знали заранее — по наводке информатора. Наряд не выделялся.' : '' }, solvability: 0.3, gangId: g.id, tags: ['planned'] });
  if (it) { authority(game, -4, 'налёт, о котором знали заранее'); trust(game, ev.districtId, -2); }
}

/** выстрелы в районе (разборка банд): наряд может прихватить отходящих */
export function hearClash(game, t, res) {
  const rng = R(game);
  if (!hasRadio(game, t) || t.rt.enc || t.rt.sub) return;
  const pf = profile(game, t);
  say(game, t, pick(game, T.hearShots), { place: res.place ? res.place.prep : dForm(t.districtId, 'prep') }, 'alarm');
  if (rng.chance(0.25 + pf.courage * 0.3)) {
    const loser = res.L;
    const perps = []; for (let i = 0; i < rng.int(1, 3); i++) perps.push(genGangPerp(game, loser));
    const enc = newEnc(game, t, { kind: 'crime', gangId: loser.id, place: res.place, perps, severity: 4, surprise: 0.4, title: 'отход участников перестрелки' });
    startEncounter(game, t, enc, absNow(game), { saw: `Наперерез — ${collective(perps.length)} с оружием, уходят от гаражей.` });
  }
}
