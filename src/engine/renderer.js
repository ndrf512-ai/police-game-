// Рендерер в духе PS1/PS2: низкое разрешение, дрожание вершин, аффинные текстуры, 15-битный цвет с дизерингом, вершинный свет, туман.
import { createGL, compile, Mesh, GeoBuilder, textureFromCanvas, updateTexture, Target } from './gl.js';
import { WORLD_VS, WORLD_FS, SCREEN_FS, POST_VS, POST_FS, NL } from './shaders.js';
import { mat4, Xf } from './math.js';
import { genSurfaces, genPropAtlas, makeCanvas } from './textures.js';
import { genCharAtlas, buildCharacter, box, SKIN } from './characters.js';
import { buildLevel, buildPropsMesh, zoneIndex, ZONE_IDS, boxW } from './levelmesh.js';
import { CELLS, ROOMS, DOORS, POINTS } from '../world/level.js';
import { RNG } from '../core/rng.js';

const ALL_ZONES = (1 << ZONE_IDS.length) - 1;
const OUTDOOR_MASK = (1 << zoneIndex('street')) | (1 << zoneIndex('yard')) | (1 << zoneIndex('alley'));

export class Renderer {
  constructor(canvas, world, game = null) {
    this.canvas = canvas; this.world = world; this.game = game;
    const gl = (this.gl = createGL(canvas));
    this.settings = { scale: 1, height: 240, dither: true, jitter: true, affine: 0.55, fog: 1, fov: 72 };
    this.prog = compile(gl, WORLD_VS, WORLD_FS, 'world');
    this.progScreen = compile(gl, WORLD_VS, SCREEN_FS, 'screen');
    this.progPost = compile(gl, POST_VS, POST_FS, 'post');
    this.rng = new RNG(31337);
    // текстуры
    const S = genSurfaces(); this.tex = {};
    for (const k in S) this.tex[k] = textureFromCanvas(gl, S[k], { repeat: true });
    this.propAtlas = genPropAtlas(); this.tex.props = textureFromCanvas(gl, this.propAtlas.canvas, { repeat: false });
    this.charAtlas = genCharAtlas(); this.tex.chars = textureFromCanvas(gl, this.charAtlas.canvas, { repeat: false });
    // уровень
    const L = buildLevel(world); this.level = L;
    this.meshes = Object.entries(L.G).map(([name, geo]) => ({ name, mesh: new Mesh(gl, geo.data) }));
    this.glassMesh = new Mesh(gl, L.glass.data); this.barsMesh = new Mesh(gl, L.bars.data);
    const P = buildPropsMesh(world, this.propAtlas, L);
    this.propsMesh = new Mesh(gl, P.geo.data);
    this.lights = [...L.lights, ...P.lights].map((l) => ({ ...l, mask: (l.zones || [10]).reduce((m, z) => m | (1 << z), 0), phase: this.rng.range(0, 100) }));
    // уличные фонари светят на всю улицу и немного на фасад
    for (const l of this.lights) if (l.outdoor) l.mask |= OUTDOOR_MASK;
    // транспорт
    this.vehicles = L.vehicles.map((v) => { const g = new GeoBuilder(1024); g.zone = 10; v.build(g); return { ...v, mesh: new Mesh(gl, g.data), model: mat4.create() }; });
    // УАЗ строился в мировых координатах (xf в buildProp) — модель единичная, «уехал» = не рисуем
    this.screens = L.screens;
    // динамика
    this.dyn = new GeoBuilder(8192); this.dynMesh = new Mesh(gl, null, true);
    this.dynProps = new GeoBuilder(2048); this.dynPropsMesh = new Mesh(gl, null, true);
    this.dynBars = new GeoBuilder(512); this.dynBarsMesh = new Mesh(gl, null, true);
    this.fx = new GeoBuilder(2048); this.fxMesh = new Mesh(gl, null, true);
    this.vm = new GeoBuilder(2048); this.vmMesh = new Mesh(gl, null, true);
    this.screenGeo = new GeoBuilder(64); this.screenMesh = new Mesh(gl, null, true);
    this.mirrorCharMesh = new Mesh(gl, null, true);
    this.post = new Mesh(gl, new Float32Array([-1, -1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 3, -1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, -1, 3, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0]));
    // экраны-холсты
    this.tvCanvas = makeCanvas(64, 48); this.tex.tv = textureFromCanvas(gl, this.tvCanvas, { repeat: false });
    this.mapCanvas = makeCanvas(160, 112); this.tex.map = textureFromCanvas(gl, this.mapCanvas, { repeat: false });
    this.planCanvas = makeCanvas(128, 88); this.tex.plan = textureFromCanvas(gl, this.planCanvas, { repeat: false });
    this.target = new Target(gl, 320, 240); this.mirrorTarget = new Target(gl, 320, 240);
    this.cctv = [new Target(gl, 80, 60), new Target(gl, 80, 60)];
    this.cctvCams = [{ x: 16.2, y: 3.0, z: 22.6, yaw: Math.PI, pitch: -0.35 }, { x: 31.5, y: 2.6, z: -0.8, yaw: -2.4, pitch: -0.3 }];
    this.cctvT = 0;
    this.view = mat4.create(); this.proj = mat4.create(); this.model = mat4.create(); this.ident = mat4.create();
    // эффекты
    this.decals = []; this.tracers = []; this.flashes = []; this.sparks = [];
    this.rain = []; for (let k = 0; k < 520; k++) this.rain.push({ x: 0, y: -1, z: 0, s: this.rng.range(7, 10) });
    this.time = 0; this.lightning = 0; this.nextLightning = 12; this.power = true; this.fade = 0; this.hurt = 0; this.white = 0;
    this.tvT = 0; this.mapT = 0; this.planT = 0;
    this.resize();
  }

  resize(force = true) {
    // clientWidth/Height — синхронный layout; в кадре проверяем размер не чаще раза в полсекунды, остальное — по событию resize
    if (!force) { if ((this._rsT = (this._rsT || 0) - 1) > 0) return; this._rsT = 30; }
    const c = this.canvas; const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.round(c.clientWidth * dpr)), ch = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const h = Math.round(this.settings.height * this.settings.scale); const w = Math.round(h * cw / ch);
    if (this.target.w !== w || this.target.h !== h) { this.target.resize(w, h); this.mirrorTarget.resize(w, h); }
  }

  // ——— эффекты из боя ———
  addDecal(kind, x, y, z, nx = 0, ny = 1, nz = 0, size = 0.1) { this.decals.push({ kind, x, y, z, nx, ny, nz, size, t: 0 }); if (this.decals.length > 120) this.decals.shift(); }
  addTracer(x0, y0, z0, x1, y1, z1) { this.tracers.push({ x0, y0, z0, x1, y1, z1, t: 0.06 }); }
  addFlash(x, y, z, strength = 1) { this.flashes.push({ x, y, z, t: 0.07, s: strength }); }
  addSparks(x, y, z) { for (let k = 0; k < 4; k++) this.sparks.push({ x, y, z, vx: this.rng.range(-2, 2), vy: this.rng.range(0, 3), vz: this.rng.range(-2, 2), t: 0.3 }); }

  // ——— выбор источников света ———
  _gatherLights(cam, state) {
    const t = this.time; const night = state.night;
    const L = [];
    for (const l of this.lights) {
      if (l.power && !this.power && !l.outdoorNoPower) continue;
      if (l.kind === 'ceiling' && !this.power) continue;
      if (l.kind === 'street' && !night && !state.dusk) continue;
      if (l.kind === 'tv' && !state.tvOn) continue;
      if (l.kind === 'windowglow' && (!this.power || !night)) continue;
      let k = 1;
      if (l.flicker) { const f = Math.sin(t * 13 + l.phase) + Math.sin(t * 31 + l.phase * 2); if (f > 1.6 - l.flicker) k = 0.25 + this.rng.next() * 0.3; else if (l.kind === 'tv') k = 0.7 + 0.3 * Math.sin(t * 7 + l.phase); }
      const d = Math.hypot(l.x - cam.x, l.z - cam.z) - l.radius;
      L.push({ l, k, d });
    }
    for (const f of this.flashes) L.push({ l: { x: f.x, y: f.y, z: f.z, color: [1.6, 1.2, 0.6], radius: 6 * f.s, mask: ALL_ZONES }, k: 1, d: -10 });
    L.sort((a, b) => a.d - b.d);
    return L.slice(0, NL);
  }

  _setCommon(p, cam, state, lights, view, proj) {
    const gl = this.gl; const u = p.u;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(u.uView, false, view); gl.uniformMatrix4fv(u.uProj, false, proj); gl.uniformMatrix4fv(u.uModel, false, this.ident);
    const tw = this.curTarget.w, th = this.curTarget.h;
    gl.uniform2f(u.uSnap, this.settings.jitter ? tw * 0.5 : 0, this.settings.jitter ? th * 0.5 : 0);
    const amb = this.power ? state.ambIn : [0.03, 0.03, 0.045];
    gl.uniform3fv(u.uAmb, amb); gl.uniform3fv(u.uAmbOut, state.ambOut); gl.uniform3fv(u.uSky, state.sky);
    gl.uniform4f(u.uBld, -0.5, -0.5, 32, 20);
    const lp = new Float32Array(NL * 4), lc = new Float32Array(NL * 4);
    lights.forEach(({ l, k }, i) => { lp.set([l.x, l.y, l.z, l.radius], i * 4); lc.set([l.color[0] * k, l.color[1] * k, l.color[2] * k, l.mask ?? ALL_ZONES], i * 4); });
    gl.uniform4fv(u.uLp, lp); gl.uniform4fv(u.uLc, lc); gl.uniform1i(u.uNL, lights.length);
    if (cam.flashlight) { const cp = Math.cos(cam.pitch); gl.uniform4f(u.uSpot, cam.x, cam.y - 0.1, cam.z, 1.6); gl.uniform4f(u.uSpotDir, Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp, 0.86); }
    else gl.uniform4f(u.uSpot, 0, 0, 0, 0);
    gl.uniform1f(u.uFlash, this.lightning * 0.9);
    gl.uniform1f(u.uFogNear, state.fogNear); gl.uniform1f(u.uFogFar, state.fogFar);
    gl.uniform3fv(u.uFogCol, state.fogCol);
    if (u.uAffine) gl.uniform1f(u.uAffine, this.settings.affine);
    if (u.uAlphaTest) gl.uniform1f(u.uAlphaTest, 0.0);
    if (u.uZoneOverride) gl.uniform1f(u.uZoneOverride, -1);
    if (u.uFullbright) gl.uniform1f(u.uFullbright, 0);
    if (u.uClipSign) gl.uniform1f(u.uClipSign, this.clip ? this.clip.sign : 0);
    if (u.uClipX) gl.uniform1f(u.uClipX, this.clip ? this.clip.x : 0);
    if (u.uUVScroll) gl.uniform2f(u.uUVScroll, 0, 0);
  }

  _bindTex(t, unit = 0) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); }

  /** Сцена целиком в текущую цель. opts: {skipPlayerHead, mirror, cctv} */
  _drawScene(cam, state, view, proj, opts = {}) {
    const gl = this.gl; const lights = this._gatherLights(cam, state);
    const p = this.prog; this._setCommon(p, cam, state, lights, view, proj);
    gl.uniform1i(p.u.uTex, 0);
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.CULL_FACE);
    for (const m of this.meshes) { this._bindTex(this.tex[m.name] || this.tex.white); m.mesh.draw(); }
    this._bindTex(this.tex.props); this.propsMesh.draw();
    for (const v of this.vehicles) if ((this.world.vehicleState?.[v.id] || 'here') === 'here') v.mesh.draw();
    this.dynPropsMesh.draw();
    this._bindTex(this.tex.chars);
    (opts.mirror ? this.mirrorCharMesh : this.dynMesh).draw();
    // решётки
    gl.uniform1f(p.u.uAlphaTest, 0.5); this._bindTex(this.tex.bars); this.barsMesh.draw(); this.dynBarsMesh.draw(); gl.uniform1f(p.u.uAlphaTest, 0.0);
    // экраны
    if (!opts.cctv) this._drawScreens(cam, state, view, proj, lights, opts);
    // прозрачное: стекло, дождь, эффекты
    gl.useProgram(p.p); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.uniform2f(p.u.uUVScroll, 0, -this.time * 0.08); this._bindTex(this.tex.glass); this.glassMesh.draw(); gl.uniform2f(p.u.uUVScroll, 0, 0);
    this._bindTex(this.tex.props); gl.uniform1f(p.u.uFullbright, 1); this.fxMesh.draw(); gl.uniform1f(p.u.uFullbright, 0);
    gl.depthMask(true); gl.disable(gl.BLEND);
  }

  _drawScreens(cam, state, view, proj, lights, opts) {
    const gl = this.gl; const sp = this.progScreen; this._setCommon(sp, cam, state, lights, view, proj);
    gl.uniform1i(sp.u.uTex, 0); gl.uniform2f(sp.u.uTarget, this.curTarget.w, this.curTarget.h);
    for (const s of this.screens) {
      if (opts.mirror && s.type === 'mirror') continue; // зеркало не отражает само себя
      let tex = null, ss = 0, glow = 0;
      if (s.type === 'tv') { tex = this.tex.tv; glow = state.tvOn && this.power ? 1 : 0; if (!state.tvOn || !this.power) tex = this.tex.black || this.tex.white; }
      else if (s.type === 'city_map') tex = this.tex.map;
      else if (s.type === 'station_plan') tex = this.tex.plan;
      else if (s.type === 'monitor') { tex = this.cctvOn ? this.cctv[s.idx].tex : this.tex.tv; glow = this.power ? 1 : 0; if (!this.power) tex = this.tex.white; }
      else if (s.type === 'mirror') { if (opts.mirror || !this.mirrorReady) { tex = this.tex.glass; } else { tex = this.mirrorTarget.tex; ss = 1; } }
      if (!tex) continue;
      this.screenGeo.clear(); const c = s.corners; const n = s.normal;
      const col = s.type === 'monitor' && !this.power ? [0.05, 0.05, 0.05, 1] : [1, 1, 1, 1];
      this.screenGeo.zone = zoneIndex(this.world.zoneAt(c[0][0], c[0][2]));
      this.screenGeo.quad(c[0], c[1], c[2], c[3], [[0, 1], [1, 1], [1, 0], [0, 0]], col, n);
      this.screenMesh.upload(this.screenGeo.data);
      gl.uniform1f(sp.u.uScreenSpace, ss); gl.uniform1f(sp.u.uGlow, glow);
      this._bindTex(tex); this.screenMesh.draw();
    }
  }

  /**
   * Кадр. cam: {x,y,z,yaw,pitch,flashlight}; scene: {actors, player:{look, x,z,yaw, pose, anim, animTime, gender, weaponDrawn, ...}, state:{night,dusk,tvOn,...}, vm:{...}}
   */
  render(dt, cam, scene) {
    const gl = this.gl; this.time += dt; this.resize(false);
    const st = this._envState(scene);
    this._updateFx(dt, cam, st);
    this._updateCanvases(dt, scene);
    // динамическая геометрия
    this._buildDynamic(scene, cam);
    const aspect = this.target.w / this.target.h;
    mat4.perspective(this.proj, (this.settings.fov * Math.PI) / 180, aspect, 0.06, 140);
    mat4.fpsView(this.view, cam.x, cam.y, cam.z, cam.yaw, cam.pitch);
    // CCTV — раз в 0.4 с
    this.cctvOn = !!scene.cctv && this.power;
    if (this.cctvOn) { this.cctvT -= dt; if (this.cctvT <= 0) { this.cctvT = 0.4; this._renderCCTV(st, scene); } }
    // зеркало
    this.mirrorReady = false;
    const mir = this.screens.find((s) => s.type === 'mirror');
    if (mir && this.world.zoneAt(cam.x, cam.z) === 'toilet') {
      const px = mir.plane.value; const R = mat4.reflectX(mat4.create(), px); const V = mat4.multiply(mat4.create(), this.view, R);
      this.curTarget = this.mirrorTarget; this.mirrorTarget.bind(); gl.clearColor(...st.fogCol, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.clip = { x: px, sign: 1 };
      this._drawScene(cam, st, V, this.proj, { mirror: true }); this.clip = null; this.mirrorReady = true;
    }
    // основной проход
    this.curTarget = this.target; this.target.bind();
    gl.clearColor(...st.fogCol, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this._drawScene(cam, st, this.view, this.proj, {});
    // руки от первого лица
    if (this.vm.n) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const vp = mat4.perspective(mat4.create(), (62 * Math.PI) / 180, aspect, 0.02, 10);
      const lights = this._gatherLights(cam, st); const p = this.prog; this._setCommon(p, cam, st, lights, this.view, vp);
      gl.uniformMatrix4fv(p.u.uModel, false, camToWorld(cam));
      gl.uniform1f(p.u.uZoneOverride, zoneIndex(this.world.zoneAt(cam.x, cam.z)));
      gl.uniform2f(p.u.uSnap, 0, 0);
      this._bindTex(this.tex.chars); this.vmMesh.draw();
    }
    // пост-обработка на экран
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.DEPTH_TEST);
    const pp = this.progPost; gl.useProgram(pp.p); this._bindTex(this.target.tex); gl.uniform1i(pp.u.uTex, 0);
    gl.uniform2f(pp.u.uRes, this.target.w, this.target.h); gl.uniform1f(pp.u.uDither, this.settings.dither ? 1 : 0);
    gl.uniform1f(pp.u.uHurt, this.hurt); gl.uniform1f(pp.u.uFade, this.fade); gl.uniform1f(pp.u.uWhite, this.white); gl.uniform1f(pp.u.uTime, this.time);
    gl.uniform1f(pp.u.uSuppress, scene.suppress || 0);
    this.post.draw(); gl.enable(gl.DEPTH_TEST);
  }

  _renderCCTV(st, scene) {
    const gl = this.gl;
    for (let k = 0; k < 2; k++) {
      const c = this.cctvCams[k]; const T = this.cctv[k]; this.curTarget = T; T.bind();
      gl.clearColor(...st.fogCol, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const V = mat4.fpsView(mat4.create(), c.x, c.y, c.z, c.yaw, c.pitch); const Pm = mat4.perspective(mat4.create(), 1.4, 4 / 3, 0.1, 60);
      const s2 = { ...st, fogNear: 4, fogFar: 40 };
      this._drawScene({ ...c, flashlight: false }, s2, V, Pm, { cctv: true });
    }
  }

  _envState(scene) {
    const s = scene.state || {}; const night = !!s.night, dusk = !!s.dusk;
    const day = night ? 0 : dusk ? 0.45 : 1;
    const fogCol = night ? [0.035, 0.04, 0.05] : dusk ? [0.16, 0.16, 0.18] : [0.36, 0.38, 0.4];
    const indoor = scene.cameraIndoor;
    return {
      night, dusk, tvOn: s.tvOn !== false,
      ambIn: this.power ? [0.2, 0.2, 0.21] : [0.03, 0.03, 0.04],
      ambOut: [0.05 + 0.2 * day, 0.055 + 0.21 * day, 0.07 + 0.22 * day],
      sky: [0.06 + 0.3 * day, 0.065 + 0.31 * day, 0.08 + 0.33 * day],
      fogCol: fogCol.map((v) => v * (this.power || !indoor ? 1 : 0.4) + this.lightning * 0.3),
      fogNear: indoor ? 10 : 3, fogFar: indoor ? 40 : (night ? 30 : 46),
    };
  }

  _updateFx(dt, cam, st) {
    // молнии
    this.nextLightning -= dt;
    if (this.nextLightning <= 0) { this.lightning = 1; this.nextLightning = this.rng.range(18, 70); this.onLightning && this.onLightning(); }
    this.lightning = Math.max(0, this.lightning - dt * (this.lightning > 0.5 ? 3 : 1.5));
    if (this.lightning > 0 && this.lightning < 0.6 && this.rng.chance(0.04)) this.lightning = 0.8;
    this.flashes = this.flashes.filter((f) => (f.t -= dt) > 0);
    this.tracers = this.tracers.filter((f) => (f.t -= dt) > 0);
    for (const s of this.sparks) { s.t -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.vy -= 9 * dt; }
    this.sparks = this.sparks.filter((s) => s.t > 0);
    this.hurt = Math.max(0, this.hurt - dt * 0.6); this.white = Math.max(0, this.white - dt * 2);
    // дождь: частицы вокруг камеры, только снаружи здания
    for (const r of this.rain) {
      r.y -= r.s * dt;
      if (r.y < 0) {
        r.x = cam.x + this.rng.range(-11, 11); r.z = cam.z + this.rng.range(-11, 11); r.y = this.rng.range(3, 7);
        if (r.x > -0.6 && r.x < 32.1 && r.z > -0.6 && r.z < 20.1) r.y = -1; // внутри здания — не идёт
      }
    }
  }

  _updateCanvases(dt, scene) {
    const gl = this.gl;
    this.tvT -= dt; if (this.tvT <= 0) { this.tvT = 0.12; drawTV(this.tvCanvas, this.time, scene.news || []); updateTexture(gl, this.tex.tv, this.tvCanvas); }
    this.mapT -= dt; if (this.mapT <= 0) { this.mapT = 3; drawCityMap(this.mapCanvas, scene.city); updateTexture(gl, this.tex.map, this.mapCanvas); }
    this.planT -= dt; if (this.planT <= 0) { this.planT = 1; drawPlan(this.planCanvas, scene.zones, this.world); updateTexture(gl, this.tex.plan, this.planCanvas); }
    if (!this.tex.black) { const c = makeCanvas(4, 4); const x = c.getContext('2d'); x.fillStyle = '#0a0b0a'; x.fillRect(0, 0, 4, 4); this.tex.black = textureFromCanvas(gl, c); }
  }

  _buildDynamic(scene, cam) {
    const A = this.charAtlas; const g = this.dyn; g.clear();
    const actors = scene.actors || [];
    for (const a of actors) {
      if (!a.visible) continue;
      const d = Math.hypot(a.x - cam.x, a.z - cam.z); if (d > 45) continue;
      g.zone = zoneIndex(a.zone || this.world.zoneAt(a.x, a.z));
      buildCharacter(g, a, A, {});
    }
    // тело игрока (видно, если посмотреть вниз): без головы
    const pl = scene.player;
    if (pl && pl.body) { g.zone = zoneIndex(this.world.zoneAt(pl.x, pl.z)); const bx = { ...pl.body }; bx.x -= Math.sin(pl.yaw) * 0.16; bx.z -= Math.cos(pl.yaw) * 0.16; buildCharacter(g, bx, A, { hideHead: true, hideArms: true, hideTorso: true }); }
    this.dynMesh.upload(g.data);
    // для зеркала — тот же набор + полное тело игрока с головой
    if (pl && pl.body && this.world.zoneAt(cam.x, cam.z) === 'toilet') {
      const gm = this._mirrorGeo || (this._mirrorGeo = new GeoBuilder(8192)); gm.clear();
      for (const a of actors) { if (!a.visible) continue; gm.zone = zoneIndex(a.zone || 'toilet'); buildCharacter(gm, a, A, {}); }
      gm.zone = zoneIndex('toilet'); buildCharacter(gm, pl.body, A, {});
      this.mirrorCharMesh.upload(gm.data);
    }
    // двери камер ИВС (решётки), баррикады
    const b = this.dynBars; b.clear(); b.zone = zoneIndex('ivs');
    for (const c of CELLS) {
      const open = this.world.openCellDoors.has(c.id); const [x0, z0, x1, z1] = c.door; const cz = 4.25; const shift = open ? 0.85 : 0;
      quad2(b, x0 - shift, cz, x1 - shift, cz, 0, 2.6);
    }
    this.dynBarsMesh.upload(b.data);
    const dp = this.dynProps; dp.clear(); const PA = this.propAtlas;
    for (const d of this.world.doors) {
      if (!(d.barricade > 0)) continue;
      const cx = (d.rect[0] + d.rect[2]) / 2, cz = (d.rect[1] + d.rect[3]) / 2; const wide = d.rect[2] - d.rect[0] > d.rect[3] - d.rect[1];
      const hpk = d.barricade / (d.barricadeMax || 100);
      dp.zone = zoneIndex(this.world.zoneAt(cx, cz + (wide ? -0.6 : 0)));
      const xf = new Xf().mulLocal(cx, 0, cz, 0, wide ? 0 : Math.PI / 2, 0);
      const span = Math.max(d.rect[2] - d.rect[0], d.rect[3] - d.rect[1]) / 2;
      box(dp, xf, 0, 0.4, 0, span, 0.4, 0.25, { front: ['wood'], side: ['wood'], top: ['wood_dark'] }, PA);
      if (hpk > 0.4) box(dp, xf, span * 0.2, 1.0, 0.05, span * 0.7, 0.25, 0.2, { front: ['metal'], side: ['metal'], top: ['metal'] }, PA);
      if (hpk > 0.7) box(dp, xf, -span * 0.3, 1.45, -0.05, span * 0.5, 0.2, 0.22, { front: ['fabric'], side: ['fabric'], top: ['fabric'] }, PA);
    }
    // декали: кровь и следы от пуль
    for (const dc of this.decals) {
      dp.zone = zoneIndex(this.world.zoneAt(dc.x, dc.z));
      if (dc.kind === 'blood') { const s = dc.size; dp.quad([dc.x - s, 0.012, dc.z + s], [dc.x + s, 0.012, dc.z + s], [dc.x + s, 0.012, dc.z - s], [dc.x - s, 0.012, dc.z - s], uvOf(PA.r('red')), [0.45, 0.04, 0.04, 1], [0, 1, 0]); }
      else if (dc.kind === 'hole') { const s = 0.035; const ux = -dc.nz, uz = dc.nx; const x = dc.x + dc.nx * 0.01, z = dc.z + dc.nz * 0.01;
        dp.quad([x - ux * s, dc.y - s, z - uz * s], [x + ux * s, dc.y - s, z + uz * s], [x + ux * s, dc.y + s, z + uz * s], [x - ux * s, dc.y + s, z - uz * s], uvOf(PA.r('black')), [1, 1, 1, 1], [dc.nx, 0, dc.nz]); }
    }
    this.dynPropsMesh.upload(dp.data);
    // эффекты (полноярко): дождь, трассеры, вспышки, искры
    const fx = this.fx; fx.clear(); fx.zone = 10;
    const glowUV = uvOf(PA.r('glow')); const whiteUV = uvOf(PA.r('white'));
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    for (const r of this.rain) {
      if (r.y < 0) continue; const w = 0.012; const h = 0.45;
      fx.quad([r.x - cy * w, r.y, r.z + sy * w], [r.x + cy * w, r.y, r.z - sy * w], [r.x + cy * w, r.y + h, r.z - sy * w], [r.x - cy * w, r.y + h, r.z + sy * w], whiteUV, [0.55, 0.6, 0.7, 0.28], [0, 0, 1]);
    }
    for (const t of this.tracers) {
      const dx = t.x1 - t.x0, dz = t.z1 - t.z0; const l = Math.hypot(dx, dz) || 1; const px = -dz / l * 0.012, pz = dx / l * 0.012;
      fx.quad([t.x0 + px, t.y0, t.z0 + pz], [t.x1 + px, t.y1, t.z1 + pz], [t.x1 - px, t.y1, t.z1 - pz], [t.x0 - px, t.y0, t.z0 - pz], whiteUV, [1, 0.85, 0.5, 0.7], [0, 1, 0]);
    }
    for (const f of this.flashes) { const s = 0.18 * f.s; fx.quad([f.x - cy * s, f.y - s, f.z + sy * s], [f.x + cy * s, f.y - s, f.z - sy * s], [f.x + cy * s, f.y + s, f.z - sy * s], [f.x - cy * s, f.y + s, f.z + sy * s], glowUV, [1, 0.8, 0.4, 1], [0, 0, 1]); }
    for (const s of this.sparks) { const z = 0.02; fx.quad([s.x - z, s.y - z, s.z], [s.x + z, s.y - z, s.z], [s.x + z, s.y + z, s.z], [s.x - z, s.y + z, s.z], whiteUV, [1, 0.8, 0.3, 1], [0, 0, 1]); }
    this.fxMesh.upload(fx.data);
    // руки
    this.vm.clear();
    if (scene.vm) buildViewModel(this.vm, scene.vm, this.charAtlas, this.time);
    this.vmMesh.upload(this.vm.data);
  }
}

/** матрица «камера → мир» для рук (обратная к fpsView) */
const _c2w = new Float32Array(16);
function camToWorld(cam) {
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const fx = sy * cp, fy = sp, fz = cy * cp; let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  _c2w.set([rx, 0, rz, 0, ux, uy, uz, 0, -fx, -fy, -fz, 0, cam.x, cam.y, cam.z, 1]);
  return _c2w;
}
function uvOf(r) { return [[r[0], r[3]], [r[2], r[3]], [r[2], r[1]], [r[0], r[1]]]; }
function quad2(b, x0, z0, x1, z1, y0, y1) {
  const u0 = x0 * 2, u1 = x1 * 2;
  b.quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], [[u0, (3 - y0) * 2], [u1, (3 - y0) * 2], [u1, (3 - y1) * 2], [u0, (3 - y1) * 2]], [1, 1, 1, 1], [0, 0, 1]);
}

// ——— руки командира от первого лица ———
// Пространство камеры: +X вправо, +Y вверх, −Z вперёд.
function buildViewModel(g, vm, A, t) {
  const fem = vm.gender === 'f'; const skin = SKIN[vm.skin | 0] || SKIN[0];
  const bob = vm.bob || 0; const sway = vm.sway || 0;
  const sleeve = vm.coat ? 'mil_coat' : 'mil_back';
  const hw = fem ? 0.034 : 0.044, fw = fem ? 0.0075 : 0.0095, fl = fem ? 0.052 : 0.05;
  g.zone = 0;
  const hand = (xf, side, grip, nails) => {
    // ладонь
    box(g, xf, 0, 0, 0, hw, 0.012, 0.045, { front: ['hands', skin], top: ['hands', skin], side: ['hands', skin], bottom: ['hands', skin], back: ['hands', skin] }, A);
    // пальцы
    for (let k = 0; k < 4; k++) {
      const fx = (k - 1.5) * (hw * 0.5) * 1.0; const f = new Xf().set(xf).mulLocal(fx, 0, -0.045, grip ? -1.3 + k * 0.05 : -0.15 - k * 0.04, 0, 0);
      const len = fl * (k === 0 || k === 3 ? 0.85 : 1);
      box(g, f, 0, 0, -len / 2, fw, fw * 0.9, len / 2, { front: ['hands', skin], top: ['hands', skin], side: ['hands', skin], bottom: ['hands', skin] }, A);
      if (nails) box(g, f, 0, fw * 0.75, -len + 0.007, fw * 0.85, 0.002, 0.007, { top: ['nails'], front: ['nails'], side: ['nails'] }, A);
    }
    // большой палец
    const th = new Xf().set(xf).mulLocal(side * hw * 0.95, -0.002, -0.01, grip ? -0.6 : 0, side * (grip ? 0.9 : 0.5), 0);
    box(g, th, 0, 0, -0.022, fw * 1.1, fw, 0.024, { front: ['hands', skin], top: ['hands', skin], side: ['hands', skin] }, A);
    if (nails) box(g, th, 0, fw * 0.8, -0.04, fw, 0.002, 0.007, { top: ['nails'] }, A);
  };
  const arm = (side, pose) => {
    // pose: {x,y,z, rx, ry, rz} позиция запястья в пространстве камеры
    const root = new Xf().mulLocal(pose.x, pose.y + bob, pose.z, pose.rx, pose.ry + sway * 0.3, pose.rz);
    // предплечье (рукав) уходит назад-вниз от запястья
    const fa = new Xf().set(root).mulLocal(0, 0, 0.0, 0, 0, 0);
    box(g, fa, 0, 0, 0.16, fem ? 0.033 : 0.042, fem ? 0.033 : 0.042, 0.16, { front: [sleeve], top: [sleeve], side: [sleeve], bottom: [sleeve], back: [sleeve] }, A);
    // манжет рубашки
    box(g, fa, 0, 0, 0.005, fem ? 0.028 : 0.036, fem ? 0.028 : 0.036, 0.012, { front: ['white', [0.78, 0.82, 0.86]], side: ['white', [0.78, 0.82, 0.86]], top: ['white', [0.78, 0.82, 0.86]], bottom: ['white', [0.78, 0.82, 0.86]] }, A);
    // часы/браслет на левой
    if (side < 0) {
      if (fem) box(g, fa, 0, 0, -0.012, 0.03, 0.03, 0.004, { front: ['gold'], top: ['gold'], side: ['gold'], bottom: ['gold'] }, A);
      else box(g, fa, 0, 0.012, -0.015, 0.04, 0.03, 0.012, { front: ['watch'], top: ['watch'], side: ['watch'], bottom: ['watch'] }, A);
    }
    const hd = new Xf().set(root).mulLocal(0, 0, -0.045, 0, 0, 0);
    hand(hd, side, pose.grip, fem);
    // кольцо (обручальное — на правой руке, по-русски)
    if (side > 0 && vm.married) box(g, new Xf().set(hd).mulLocal(hw * 0.25, 0.012, -0.07, 0, 0, 0), 0, 0, 0, fw * 1.25, 0.004, 0.006, { top: ['gold'], front: ['gold'], side: ['gold'] }, A);
    return hd;
  };
  const k = vm.reach || 0; // 0..1 — рука тянется к предмету
  const rec = vm.recoil || 0; const lower = vm.lower || 0;
  if (vm.weapon === 'pm' && vm.drawn) {
    const aim = vm.aimK || 0;
    const rp = { x: 0.13 - aim * 0.13, y: -0.15 + aim * 0.06 - lower * 0.3 + rec * 0.02, z: -0.32 - aim * 0.04 + rec * 0.05, rx: 0.1 + rec * 0.5, ry: 0.05, rz: 0, grip: true };
    const hd = arm(1, rp);
    // ПМ
    const gx = new Xf().set(hd).mulLocal(0, 0.045, -0.05, 0, 0, 0);
    box(g, gx, 0, 0.02, -0.06, 0.013, 0.018, 0.085, { front: ['gun_metal'], top: ['gun_metal'], side: ['gun_metal'], bottom: ['gun_metal'], back: ['gun_metal'] }, A);
    box(g, gx, 0, -0.04, -0.005, 0.012, 0.045, 0.02, { front: ['gun_wood', [0.6, 0.5, 0.45]], side: ['gun_wood', [0.6, 0.5, 0.45]], back: ['gun_wood', [0.6, 0.5, 0.45]] }, A, 1, 1, 1);
    box(g, gx, 0, 0.042, -0.14, 0.002, 0.004, 0.002, { front: ['gun_metal'], top: ['gun_metal'] }, A);
    // левая поддерживает
    arm(-1, { x: 0.07 - aim * 0.08, y: -0.19 + aim * 0.06 - lower * 0.3, z: -0.3 - aim * 0.03, rx: 0.3, ry: -0.6, rz: 0.4, grip: true });
  } else {
    // без оружия: левая держит папку у груди (видна снизу слева), правая расслаблена и тянется к предметам
    const lp = { x: -0.2, y: -0.255 - lower * 0.3, z: -0.44, rx: 0.5, ry: 0.45, rz: -0.3, grip: true };
    const lh = arm(-1, lp);
    if (!vm.noFolder) {
      const f = new Xf().set(lh).mulLocal(0.02, 0.016, -0.02, 0.1, -0.4, 0.1);
      box(g, f, 0.05, 0.0, -0.03, 0.06, 0.005, 0.08, { front: ['white', [0.62, 0.48, 0.3]], top: ['white', [0.62, 0.48, 0.3]], side: ['white', [0.55, 0.42, 0.26]], bottom: ['white', [0.55, 0.42, 0.26]] }, A);
      box(g, f, 0.05, 0.0055, -0.03, 0.055, 0.0012, 0.074, { top: ['white', [0.86, 0.84, 0.76]] }, A);
      box(g, f, 0.05, 0.007, -0.075, 0.025, 0.001, 0.01, { top: ['white', [0.25, 0.22, 0.2]] }, A);
    }
    const rp = { x: 0.22 - k * 0.1, y: -0.3 + k * 0.17 - lower * 0.3, z: -0.42 - k * 0.1, rx: 0.5 - k * 0.5, ry: -0.3, rz: 0.2, grip: false };
    if (k > 0.02 || lower > 0.05) arm(1, rp);
  }
}

// ——— процедурные экраны ———
function drawTV(c, t, news) {
  const x = c.getContext('2d'); const w = c.width, h = c.height;
  const n = news.length ? news[Math.floor(t / 9) % news.length] : null;
  const scene = Math.floor(t / 9) % 4;
  x.fillStyle = scene === 3 ? '#112' : '#203040'; x.fillRect(0, 0, w, h);
  if (scene === 3) { // заставка-настроечная таблица
    const cols = ['#ddd', '#dd2', '#2dd', '#2d2', '#d2d', '#d22', '#22d', '#111']; for (let i = 0; i < 8; i++) { x.fillStyle = cols[i]; x.fillRect(i * 8, 0, 8, 32); }
    x.fillStyle = '#ddd'; x.font = '6px monospace'; x.fillText('ТВ-ЗАРЕЧЬЕ', 14, 42);
  } else {
    // ведущая за столом
    x.fillStyle = '#2a4a6a'; x.fillRect(0, 0, w, 30); x.fillStyle = '#1a2a3a'; for (let i = 0; i < 6; i++) x.fillRect(i * 12 + 2, 4, 8, 10);
    x.fillStyle = '#5a3a3a'; x.fillRect(20, 16, 24, 20); x.fillStyle = '#d8b090'; x.fillRect(26, 6, 12, 12); x.fillStyle = '#4a2a1a'; x.fillRect(24, 4, 16, 6); x.fillRect(24, 4, 3, 12); x.fillRect(37, 4, 3, 12);
    x.fillStyle = '#222'; x.fillRect(29, 10, 2, 1); x.fillRect(33, 10, 2, 1); x.fillStyle = '#a44'; x.fillRect(30, 14, 4, Math.sin(t * 12) > 0 ? 2 : 1);
    x.fillStyle = '#6a5040'; x.fillRect(0, 30, w, 6);
    x.fillStyle = '#c22'; x.fillRect(0, 36, w, 12); x.fillStyle = '#fff'; x.font = '6px monospace';
    const txt = n ? (n.title || '') + ' · ' : 'НОВОСТИ · ';
    const off = (t * 22) % (txt.length * 4 + w); x.fillText(txt, w - off, 45);
    x.fillStyle = '#eee'; x.font = '5px monospace'; x.fillText('ТВ-З', 50, 7);
  }
  // помехи и строчная развёртка
  const im = x.getImageData(0, 0, w, h); const d = im.data;
  for (let i = 0; i < d.length; i += 4) { const nn = (Math.random() - 0.5) * 50; d[i] += nn; d[i + 1] += nn; d[i + 2] += nn; }
  const roll = Math.floor((t * 9) % h); for (let i = 0; i < w; i++) { const k = (roll * w + i) * 4; d[k] += 40; d[k + 1] += 40; d[k + 2] += 40; }
  x.putImageData(im, 0, 0);
}

function drawCityMap(c, city) {
  const x = c.getContext('2d'); const w = c.width, h = c.height;
  x.fillStyle = '#d8ceb0'; x.fillRect(0, 0, w, h);
  // река
  x.strokeStyle = '#7a9ab0'; x.lineWidth = 6; x.beginPath(); x.moveTo(0, h * 0.62); x.bezierCurveTo(w * 0.3, h * 0.5, w * 0.6, h * 0.8, w, h * 0.66); x.stroke();
  const ds = city?.districts || [];
  for (const d of ds) {
    if (!d.mapPoly) continue; const k = (d.crime || 30) / 100;
    x.fillStyle = `rgba(${150 + k * 100 | 0},${120 - k * 80 | 0},${90 - k * 60 | 0},0.45)`; x.strokeStyle = '#3a2a1a'; x.lineWidth = 1;
    x.beginPath(); d.mapPoly.forEach(([px, py], i) => (i ? x.lineTo(px * w, py * h) : x.moveTo(px * w, py * h))); x.closePath(); x.fill(); x.stroke();
    if (d.labelPos) { x.fillStyle = '#201510'; x.font = 'bold 7px monospace'; x.fillText((d.name || '').slice(0, 9).toUpperCase(), d.labelPos[0] * w - 14, d.labelPos[1] * h); }
  }
  // флажки нарядов
  for (const t of city?.tasks || []) { if (t.phase === 'done') continue; const d = ds.find((q) => q.id === t.districtId); if (!d?.labelPos) continue; x.fillStyle = '#1a3aaa'; x.fillRect(d.labelPos[0] * w + 2, d.labelPos[1] * h + 3, 3, 5); x.fillRect(d.labelPos[0] * w + 2, d.labelPos[1] * h + 3, 6, 3); }
  // кнопки-булавки
  x.fillStyle = '#c22'; for (const [px, py] of [[4, 4], [w - 6, 4], [4, h - 6], [w - 6, h - 6]]) x.fillRect(px, py, 3, 3);
  x.fillStyle = '#301a10'; x.font = 'bold 8px monospace'; x.fillText('г. ЗАРЕЧЕНСК', 4, 12);
}

function drawPlan(c, zones, world) {
  const x = c.getContext('2d'); const w = c.width, h = c.height;
  x.fillStyle = '#c8d4dc'; x.fillRect(0, 0, w, h);
  x.strokeStyle = 'rgba(40,70,120,0.25)'; for (let i = 0; i < w; i += 6) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); } for (let j = 0; j < h; j += 6) { x.beginPath(); x.moveTo(0, j); x.lineTo(w, j); x.stroke(); }
  const sx = (w - 8) / 32, sz = (h - 16) / 20;
  for (const r of ROOMS) {
    const z = zones?.[r.id]; const own = z?.owner;
    x.fillStyle = own === 'enemy' ? 'rgba(200,40,30,0.55)' : own === 'contested' ? 'rgba(220,160,40,0.55)' : 'rgba(255,255,255,0.4)';
    x.fillRect(4 + r.rect[0] * sx, 12 + r.rect[1] * sz, (r.rect[2] - r.rect[0]) * sx, (r.rect[3] - r.rect[1]) * sz);
    x.strokeStyle = '#1a2a50'; x.lineWidth = 1; x.strokeRect(4 + r.rect[0] * sx + 0.5, 12 + r.rect[1] * sz + 0.5, (r.rect[2] - r.rect[0]) * sx, (r.rect[3] - r.rect[1]) * sz);
  }
  for (const d of world?.doors || []) { if (d.outer) continue; x.fillStyle = d.barricade > 0 ? '#8a3a10' : '#c8d4dc'; x.fillRect(4 + d.rect[0] * sx, 12 + d.rect[1] * sz, Math.max(2, (d.rect[2] - d.rect[0]) * sx), Math.max(2, (d.rect[3] - d.rect[1]) * sz)); }
  x.fillStyle = '#1a2a50'; x.font = 'bold 7px monospace'; x.fillText('ПЛАН ОМ-14', 4, 9);
}
