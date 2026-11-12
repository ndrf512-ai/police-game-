// Точка входа: собирает подсистемы и крутит цикл.
import { Game } from './game.js';
import { Renderer } from './engine/renderer.js';
import { Input } from './engine/input.js';

const BOOT = document.getElementById('boot');
const say = (t) => { if (BOOT) BOOT.querySelector('.msg').textContent = t; };

const BARE = new URLSearchParams(location.search).has('bare');
async function opt(loader, name) { if (BARE) return null; try { return await loader(); } catch (e) { console.warn('модуль не загружен', name, e); return null; } }

export async function boot() {
  say('Загрузка подсистем…');
  const [crimes, city, staffM, econM, detM, campM, stationM, combatM, uiM, audioM, deptM, bldM] = await Promise.all([
    opt(() => import('./sim/crimes.js'), 'crimes'), opt(() => import('./sim/city.js'), 'city'), opt(() => import('./sim/staff.js'), 'staff'),
    opt(() => import('./sim/economy.js'), 'economy'), opt(() => import('./sim/detainees.js'), 'detainees'), opt(() => import('./sim/campaign.js'), 'campaign'),
    opt(() => import('./ai/station.js'), 'station'), opt(() => import('./ai/combat.js'), 'combat'), opt(() => import('./ui/ui.js'), 'ui'), opt(() => import('./engine/audio.js'), 'audio'),
    opt(() => import('./sim/departments.js'), 'departments'), opt(() => import('./sim/building.js'), 'building'),
  ]);
  const sim = {
    crimes: crimes || null, city: city?.city || null, staff: staffM?.staff || null, economy: econM?.economy || null,
    detainees: detM?.detainees || null, campaign: campM?.campaign || null, departments: deptM?.departments || null,
    building: bldM?.building || null,
  };
  if (staffM) { sim.staff && (sim.staff.TRAITS = staffM.TRAITS); }
  if (econM) { sim.economy && (sim.economy.ITEMS = econM.ITEMS, sim.economy.UPGRADES = econM.UPGRADES, sim.economy.CHANNELS = econM.CHANNELS); }
  const game = new Game({ sim });
  window.game = game; // для отладки
  const canvas = document.getElementById('view');
  say('Строю участок…');
  let renderer;
  try { renderer = new Renderer(canvas, game.world, game); } catch (e) { say('Ошибка графики: ' + e.message); throw e; }
  game.renderer = renderer;
  const input = new Input(document.body, {}); input.lockTarget = canvas; game.input = input;
  if (audioM?.Audio) {
    game.audio = new audioM.Audio();
    try { if (game.audio.autoInit) game.audio.autoInit(window); } catch (e) { console.warn(e); }
    const unlock = () => { try { game.audio.init(); game.audio.resume?.(); } catch (e) { /* нет звука — играем без него */ } };
    for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) addEventListener(ev, unlock, { passive: true });
    const occ = () => { try { if (audioM.occlusionFromWorld && game.audio.setOcclusionFn) game.audio.setOcclusionFn(audioM.occlusionFromWorld(game.world)); } catch (e) { /* */ } };
    game.bus.on('game:new', occ); game.bus.on('game:loaded', occ);
  }
  if (stationM?.StationAI) game.StationAI = stationM.StationAI; // создаётся при старте игры (нужно состояние)
  if (combatM?.Combat) game.combat = new combatM.Combat(game);
  if (uiM?.UI) game.ui = new uiM.UI(game, document.getElementById('ui'));
  wireEvents(game, renderer);
  // настройки
  const applySettings = (e) => {
    const s = (e && e.settings) || game.ui?.settings || game.state?.settings || {};
    if (s.resScale) renderer.settings.scale = s.resScale;
    if (s.dither != null) renderer.settings.dither = !!s.dither;
    if (s.jitter != null) renderer.settings.jitter = !!s.jitter;
    if (s.brightness) renderer.settings.brightness = +s.brightness || 1;
    if (s.lookSens) input.sens = s.lookSens;
    if (s.invertY != null) input.invertY = !!s.invertY;
    game.showFps = !!s.showFps;
    try { game.audio?.setVolume?.(s.volMaster ?? 0.8, s.volSfx ?? 0.9, s.volAmbience ?? 0.7); } catch (er) { /* */ }
  };
  game.bus.on('settings', applySettings);
  BOOT && BOOT.remove();
  const params = new URLSearchParams(location.search);
  if (params.get('quick') || !game.ui) { game.newGame({ gender: params.get('g') === 'f' ? 'f' : 'm', mode: 'campaign' }); }
  else game.ui.open('menu');
  applySettings();
  // цикл
  let last = performance.now(); let fpsAcc = 0, fpsN = 0, renderAcc = 0; let fpsEl = null;
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    fpsAcc += dt; fpsN++; if (fpsAcc >= 0.5) { game._fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0;
      if (game.showFps) { if (!fpsEl) { fpsEl = document.createElement('div'); fpsEl.style.cssText = 'position:fixed;left:4px;top:2px;z-index:40;color:#9f9;font:11px monospace;pointer-events:none;text-shadow:0 1px 1px #000'; document.body.appendChild(fpsEl); } fpsEl.textContent = game._fps + ' fps'; }
      else if (fpsEl) { fpsEl.remove(); fpsEl = null; } }
    const inp = input.poll();
    if (game.state) {
      const blocking = game.ui?.isBlocking?.() || false; input.setEnabled(!blocking);
      game.update(dt, inp);
      // под открытым экраном игра стоит на паузе — рисуем фон реже (экономия батареи на телефоне)
      renderAcc += dt;
      if (blocking && game.paused && renderAcc < 1 / 15) { try { game.ui?.update?.(dt); } catch (e) { console.error(e); } requestAnimationFrame(frame); return; }
      const rdt = renderAcc; renderAcc = 0;
      const p = game.player; const ey = game.eye();
      const cam = { x: p.x, y: ey, z: p.z, yaw: p.yaw, pitch: p.pitch + p.recoil * 0.02, flashlight: p.flashlight };
      renderer.hurt = Math.max(renderer.hurt, game._hurtFlash || 0); game._hurtFlash = 0;
      renderer.render(rdt, cam, game.sceneForRender());
      if (game.audio) {
        try {
          game.audio.setListener(p.x, p.z, p.yaw);
          const zone = game.world.zoneAt(p.x, p.z); const indoor = !['street', 'yard', 'alley'].includes(zone);
          game.audio.ambience({ rain: indoor ? 0.35 : 1, hum: renderer.power && indoor ? 0.5 : 0, tv: zone === 'rest' ? 0.6 : zone === 'corridor' ? 0.15 : 0, power: renderer.power, tension: game.combat?.active ? 1 : (game.state.attackPlans?.length ? 0.3 : 0), indoor });
        } catch (e) { /* */ }
      }
    } else { input.setEnabled(false); }
    try { game.ui?.update?.(dt); } catch (e) { console.error(e); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  addEventListener('resize', () => renderer.resize());
  addEventListener('orientationchange', () => setTimeout(() => renderer.resize(), 300));
  // сворачивание/уход в фон: тихое автосохранение (без тоста), чтобы не терять прогресс при убийстве процесса
  const autosave = () => { if (game.state) game.save(true); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) autosave(); });
  addEventListener('pagehide', autosave);
  return game;
}

function wireEvents(game, R) {
  const B = game.bus; const A = () => game.audio;
  B.on('shot', (e) => { A()?.play?.('shot_' + (e.weapon === 'aks74u' ? 'ak' : e.weapon === 'ks23' ? 'ks23' : e.weapon === 'tt' ? 'tt' : e.weapon === 'sawnoff' || e.weapon === 'shotgun' ? 'sawnoff' : 'pm'), { x: e.x, z: e.z }); });
  B.on('tracer', (e) => R.addTracer(e.x0, e.y0, e.z0, e.x1, e.y1, e.z1));
  B.on('muzzle', (e) => R.addFlash(e.x, e.y, e.z, e.s || 1));
  B.on('hit', (e) => {
    if (e.kind === 'flesh' || e.actorId) { R.addDecal('blood', e.x, 0, e.z, 0, 1, 0, 0.12 + Math.random() * 0.1); A()?.play?.('hit_flesh', { x: e.x, z: e.z }); }
    else { R.addDecal('hole', e.x, e.y ?? 1.2, e.z, e.nx ?? 0, 0, e.nz ?? 0); R.addSparks(e.x, e.y ?? 1.2, e.z); A()?.play?.(e.kind === 'glass' ? 'glass_break' : 'ricochet', { x: e.x, z: e.z }); }
  });
  B.on('actor:death', ({ actor }) => { R.addDecal('blood', actor.x, 0, actor.z, 0, 1, 0, 0.45); A()?.play?.('body_fall', { x: actor.x, z: actor.z }); });
  B.on('power', (e) => { R.power = !!e.on; if (game.state) { game.state.flags = game.state.flags || {}; game.state.flags.power = !!e.on; } if (!e.silent) A()?.play?.(e.on ? 'generator_start' : 'power_down'); });
  B.on('game:new', () => { R.power = true; R.decals.length = 0; R.fade = 0; });
  B.on('inbox', ({ item }) => { if (item && item.choices && item.choices.length) game.ui?.toast?.(`На столе новая бумага: ${item.title}`, 'info', { onClick: () => game.ui.open('inbox', { itemId: item.id }), dur: 7 }); });
  B.on('vehicle', (e) => { game.world.vehicleState = game.world.vehicleState || {}; game.world.vehicleState[e.id] = e.state; A()?.play?.(e.state === 'away' ? 'car_engine' : 'car_door', { x: 16, z: 25 }); });
  B.on('sfx', (e) => A()?.play?.(e.name, e));
  const condSync = () => R.rebuildCond?.(game.state?.building?.conds);
  B.on('building:changed', condSync); B.on('game:new', condSync); B.on('game:loaded', condSync);
  B.on('delivery', (e) => { const it = game.sim.economy?.ITEMS?.[e.itemId]; game.ui?.toast?.(`Привезли: ${it ? it.name : e.itemId} ×${e.qty}. Всё на склад.`, 'good', { onClick: () => game.ui.open('supply'), dur: 6 }); A()?.play?.('car_door', { x: 16, z: 25 }); });
  B.on('step', (e) => A()?.play?.('step_' + (e.surface === 'tile' ? 'tile' : e.surface === 'concrete' ? 'concrete' : e.surface === 'lino' ? 'lino' : 'wet'), { vol: e.run ? 0.5 : 0.3 }));
  B.on('radio', () => A()?.radioBurst?.('open'));
  B.on('call:incoming', () => A()?.play?.('phone_ring', { x: 23.3, z: 17.8 }));
  B.on('player:hurt', (e) => { game._hurtFlash = Math.min(1, (e.amount || 20) / 40); });
  B.on('player:dead', () => { R.fade = 0.6; });
  B.on('attack:start', () => { A()?.play?.('alarm_bell'); });
  R.onLightning = () => { setTimeout(() => A()?.play?.('thunder', { vol: 0.6 + Math.random() * 0.4 }), 400 + Math.random() * 2200); };
}
