// Модели предметов из коробок (атлас предметов). Возвращают «экраны» (динамические поверхности) и источники света.
import { Xf } from './math.js';
import { box } from './characters.js';

const W = [1, 1, 1];
const all = (r, t = W) => ({ front: [r, t], back: [r, t], side: [r, t], top: [r, t], bottom: [r, t] });

/** Плоский квад-«экран» в локальных координатах xf: центр, полуширина, полувысота; смотрит в +Z */
function screenQuad(xf, cx, cy, cz, hw, hh) {
  const P = []; const t = new Float32Array(3);
  for (const [x, y] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) { xf.apply(cx + x, cy + y, cz, t); P.push([t[0], t[1], t[2]]); }
  const n = new Float32Array(3); xf.applyN(0, 0, 1, n);
  return { corners: P, normal: [n[0], n[1], n[2]] };
}

export function buildProp(geo, p, A, out) {
  const xf = new Xf().mulLocal(p.x, p.y || 0, p.z, 0, p.rot || 0, 0);
  const B = (cx, cy, cz, hx, hy, hz, faces, alpha = 1, tt = 1, tb = 1) => box(geo, xf, cx, cy, cz, hx, hy, hz, faces, A, alpha, tt, tb);
  const light = (dx, dy, dz, col, radius, extra = {}) => { const t = new Float32Array(3); xf.apply(dx, dy, dz, t); out.lights.push({ x: t[0], y: t[1], z: t[2], color: col, radius, ...extra }); };
  const legs4 = (hx, hz, h, r = 'metal_dark', th = 0.025) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(sx * (hx - th), h / 2, sz * (hz - th), th, h / 2, th, all(r)); };
  switch (p.type) {
    case 'desk_big': B(0, 0.76, 0, 1.3, 0.03, 0.6, { top: ['desk_top'], front: ['wood'], side: ['wood'], bottom: ['wood_dark'] }); B(-0.9, 0.38, 0, 0.38, 0.36, 0.55, all('wood')); B(0.9, 0.38, 0, 0.38, 0.36, 0.55, all('wood')); B(0, 0.5, 0.55, 0.5, 0.25, 0.02, all('wood_dark')); break;
    case 'desk': B(0, 0.74, 0, 0.8, 0.03, 0.48, { top: ['desk_top'], front: ['wood'], side: ['wood'], bottom: ['wood_dark'] }); B(0.55, 0.36, 0, 0.24, 0.35, 0.44, all('wood')); legs4(0.78, 0.46, 0.72, 'wood_dark'); break;
    case 'duty_desk': B(0, 0.78, 0, 1.4, 0.03, 0.7, { top: ['desk_top'], front: ['wood'], side: ['wood'] }); B(0, 0.39, -0.62, 1.4, 0.38, 0.06, all('wood')); B(-1.3, 0.39, 0, 0.08, 0.38, 0.7, all('wood')); B(1.3, 0.39, 0, 0.08, 0.38, 0.7, all('wood')); B(0, 1.05, -0.66, 1.4, 0.24, 0.03, { front: ['wood'], back: ['wood'], side: ['wood'], top: ['wood_dark'] }); break;
    case 'table_interrogation': B(0, 0.74, 0, 0.7, 0.03, 0.5, { top: ['metal'], side: ['metal_dark'], front: ['metal_dark'] }); legs4(0.68, 0.48, 0.72); break;
    case 'table_small': B(0, 0.72, 0, 0.7, 0.03, 0.5, { top: ['wood'], side: ['wood_dark'] }); legs4(0.66, 0.46, 0.7, 'wood_dark'); B(0, 0.751, 0, 0.6, 0.002, 0.4, { top: ['fabric_green'] }); break;
    case 'chair': B(0, 0.45, 0, 0.21, 0.025, 0.21, all('wood')); legs4(0.2, 0.2, 0.45, 'metal_dark', 0.015); B(0, 0.75, -0.19, 0.2, 0.17, 0.02, all('wood')); break;
    case 'chair_office': B(0, 0.48, 0, 0.25, 0.05, 0.25, all('fabric')); B(0, 0.85, -0.23, 0.24, 0.3, 0.04, all('fabric')); B(0, 0.24, 0, 0.03, 0.22, 0.03, all('metal_dark')); B(0, 0.03, 0, 0.25, 0.03, 0.04, all('metal_dark')); B(0, 0.03, 0, 0.04, 0.03, 0.25, all('metal_dark')); B(-0.26, 0.62, 0, 0.03, 0.03, 0.2, all('wood_dark')); B(0.26, 0.62, 0, 0.03, 0.03, 0.2, all('wood_dark')); break;
    case 'phone': B(0, 0.04, 0, 0.11, 0.04, 0.09, { top: ['red'], side: ['red'], front: ['red'] }); B(0, 0.1, -0.02, 0.12, 0.025, 0.035, all('black')); B(0, 0.085, 0.04, 0.035, 0.005, 0.035, { top: ['white', [0.8, 0.8, 0.8]] }); break;
    case 'lamp_desk': B(0, 0.02, 0, 0.07, 0.02, 0.07, all('metal_dark')); B(0, 0.2, 0, 0.012, 0.18, 0.012, all('metal_dark')); B(0.06, 0.38, 0, 0.1, 0.05, 0.08, all('lampshade'), 1, 0.6, 1); light(0.06, 0.3, 0, [1.0, 0.82, 0.55], 2.6, { kind: 'desk' }); break;
    case 'lamp_hanging': B(0, 0.3, 0, 0.006, 0.3, 0.006, all('black')); B(0, -0.02, 0, 0.18, 0.06, 0.18, all('metal_dark'), 1, 0.3, 1); B(0, -0.09, 0, 0.06, 0.01, 0.06, all('glow')); light(0, -0.2, 0, [1.0, 0.95, 0.8], 4.0, { kind: 'interrogation' }); break;
    case 'lamp_ceiling_flicker': B(0, -0.04, 0, 0.6, 0.03, 0.08, all('metal')); B(0, -0.075, 0, 0.55, 0.006, 0.04, all('tube')); light(0, -0.3, 0, [0.85, 0.95, 1.0], 7, { flicker: 0.6, kind: 'tube' }); break;
    case 'papers': for (let k = 0; k < 4; k++) B(-0.2 + k * 0.13, 0.004 + k * 0.002, (k % 2) * 0.05, 0.1, 0.002, 0.14, { top: ['paper'] }); B(0.35, 0.02, 0.1, 0.12, 0.02, 0.16, { top: ['files'], side: ['metal_dark'] }); break;
    case 'file_cabinet': B(0, 0.95, 0, 0.8, 0.95, 0.3, { front: ['files'], side: ['metal'], top: ['metal'], back: ['metal'] }); break;
    case 'safe': B(0, 0.6, 0, 0.38, 0.6, 0.35, { front: ['safe'], side: ['metal_green'], top: ['metal_green'], back: ['metal_green'] }); break;
    case 'portrait': B(0, 0, 0.01, 0.3, 0.38, 0.015, { front: ['emblem'], side: ['wood_dark'] }); break;
    case 'org_chart': B(0, 0, 0.01, 0.42, 0.3, 0.01, { front: ['paper'], side: ['wood_dark'] }); for (let k = 0; k < 5; k++) B(-0.3 + k * 0.15, -0.08 + (k % 2) * 0.12, 0.022, 0.05, 0.03, 0.003, { front: ['files'] }); B(0, 0.2, 0.022, 0.08, 0.03, 0.003, { front: ['files'] }); break;
    case 'flag': B(0, 1.1, 0, 0.015, 1.1, 0.015, all('wood_dark')); B(0.25, 1.85, 0, 0.25, 0.32, 0.006, { front: ['flag'], back: ['flag'] }); break;
    case 'bookshelf': B(0, 1.0, 0, 1.0, 1.0, 0.25, { front: ['books'], side: ['wood_dark'], top: ['wood_dark'], back: ['wood_dark'] }); break;
    case 'coat_rack': B(0, 0.9, 0, 0.02, 0.9, 0.02, all('wood_dark')); B(0, 0.02, 0, 0.2, 0.02, 0.2, all('wood_dark')); B(0.05, 1.45, 0, 0.13, 0.32, 0.1, all('fabric', [0.5, 0.52, 0.6])); B(0, 1.78, 0, 0.12, 0.04, 0.12, { top: ['metal_dark'], side: ['red'] }); break;
    case 'typewriter': B(0, 0.06, 0, 0.2, 0.06, 0.16, { top: ['typewriter'], side: ['metal_dark'], front: ['metal_dark'] }); B(0, 0.14, -0.1, 0.24, 0.03, 0.03, all('black')); B(0, 0.2, -0.12, 0.13, 0.07, 0.002, { front: ['paper'] }); break;
    case 'gun_rack': B(0, 1.0, 0, 2.2, 1.0, 0.25, { front: ['gun_rack'], side: ['metal_dark'], top: ['metal_dark'] }); break;
    case 'ammo_crates': for (let k = 0; k < 3; k++) B(0, 0.17 + k * 0.34, (k - 1) * 0.15, 0.38, 0.17, 0.45, { front: ['ammo_box'], side: ['ammo_box'], top: ['ammo_box'] }); break;
    case 'armory_counter': B(0, 0.5, 0, 1.9, 0.5, 0.3, { front: ['wood'], side: ['wood'], top: ['wood_dark'] }); B(-1.85, 1.5, 0.25, 0.04, 0.5, 0.04, all('metal_dark')); B(1.85, 1.5, 0.25, 0.04, 0.5, 0.04, all('metal_dark')); B(0, 2.0, 0.25, 1.9, 0.04, 0.04, all('metal_dark')); break;
    case 'vest_rack': B(0, 0.8, 0, 1.0, 0.8, 0.25, all('metal_dark')); for (let k = -2; k <= 2; k++) B(k * 0.38, 1.0, 0.1, 0.17, 0.32, 0.08, all('vest')); break;
    case 'bunk': B(0, 0.42, 0, 0.95, 0.06, 0.45, { top: ['fabric', [0.55, 0.55, 0.55]], side: ['metal_dark'] }); legs4(0.93, 0.43, 0.4); break;
    case 'generator': B(0, 0.55, 0, 1.15, 0.55, 0.95, { front: ['generator'], side: ['generator'], top: ['metal_dark'], back: ['generator'] }); B(-0.9, 1.3, 0.5, 0.06, 0.25, 0.06, all('metal_dark')); light(0.9, 1.2, 1.0, [1.0, 0.25, 0.15], 1.2, { kind: 'indicator', power: true }); break;
    case 'fusebox': B(0, 0, 0.06, 0.25, 0.35, 0.06, { front: ['fusebox'], side: ['metal'] }); break;
    case 'barrels': for (const [dx, dz] of [[-0.35, 0], [0.35, 0.1]]) B(dx, 0.45, dz, 0.28, 0.45, 0.28, all('barrel')); break;
    case 'boiler': B(0, 1.0, 0, 0.5, 1.0, 0.8, { front: ['metal'], side: ['metal'], top: ['metal_dark'] }); B(0, 2.4, -0.3, 0.08, 0.6, 0.08, all('rust')); break;
    case 'bench': B(0, 0.45, 0, 1.0, 0.03, 0.22, all('wood')); B(0, 0.75, -0.2, 1.0, 0.13, 0.02, all('wood')); legs4(0.95, 0.2, 0.43, 'metal_dark', 0.02); break;
    case 'notice_board': B(0, 0, 0.015, 0.8, 0.5, 0.015, { front: ['cork'], side: ['wood_dark'] }); break;
    case 'wanted_board': B(0, 0, 0.01, 0.35, 0.45, 0.01, { front: ['poster_wanted'], side: ['wood_dark'] }); break;
    case 'calendar': B(0, 0, 0.004, 0.18, 0.24, 0.004, { front: ['calendar'] }); break;
    case 'fire_ext': B(0, 0.95, 0.08, 0.08, 0.25, 0.08, all('red')); B(0, 1.24, 0.08, 0.03, 0.04, 0.03, all('black')); break;
    case 'plant': B(0, 0.2, 0, 0.16, 0.2, 0.16, all('pot'), 1, 1.2, 0.9); B(0, 0.62, 0, 0.3, 0.25, 0.3, all('plant'), 1, 0.3, 0.8); B(0, 0.9, 0, 0.18, 0.2, 0.18, all('plant'), 1, 0.2, 1); break;
    case 'water_cooler': B(0, 0.5, 0, 0.18, 0.5, 0.18, all('porcelain')); B(0, 1.2, 0, 0.14, 0.2, 0.14, all('blue_water'), 0.85); break;
    case 'sink': B(0, 0.82, 0.12, 0.25, 0.08, 0.2, all('porcelain')); B(0, 0.4, 0.1, 0.06, 0.38, 0.06, all('porcelain')); B(0, 0.98, 0.0, 0.015, 0.06, 0.015, all('metal')); break;
    case 'mirror': B(0, 0, 0.008, 0.36, 0.46, 0.008, all('mirror_frame')); out.screens.push({ type: 'mirror', ...screenQuad(xf, 0, 0, 0.018, 0.32, 0.42), plane: { axis: 'x', value: p.x + 0.018 } }); break;
    case 'toilet': B(0, 0.2, 0, 0.2, 0.2, 0.28, all('porcelain'), 1, 1.1, 0.8); B(0, 0.6, -0.25, 0.2, 0.2, 0.08, all('porcelain')); break;
    case 'stall': B(0, 1.0, 0, 0.04, 1.0, 1.05, all('metal', [0.6, 0.7, 0.6])); break;
    case 'sofa': B(0, 0.25, 0, 1.3, 0.2, 0.42, all('sofa_red')); B(0, 0.62, -0.32, 1.3, 0.3, 0.12, all('sofa_red')); B(-1.25, 0.5, 0, 0.1, 0.2, 0.42, all('sofa_red')); B(1.25, 0.5, 0, 0.1, 0.2, 0.42, all('sofa_red')); break;
    case 'armchair': B(0, 0.25, 0, 0.4, 0.2, 0.4, all('fabric')); B(0, 0.62, -0.32, 0.4, 0.3, 0.1, all('fabric')); B(-0.35, 0.5, 0, 0.08, 0.15, 0.4, all('fabric')); B(0.35, 0.5, 0, 0.08, 0.15, 0.4, all('fabric')); break;
    case 'tv': B(0, 0.3, 0, 0.3, 0.3, 0.25, all('wood_dark')); B(0, 0.85, -0.04, 0.3, 0.25, 0.26, { front: ['tv_body'], side: ['tv_body'], top: ['tv_body'], back: ['tv_body'] }); B(0.12, 1.15, -0.1, 0.005, 0.12, 0.005, all('metal')); B(-0.1, 1.13, -0.1, 0.005, 0.1, 0.005, all('metal'));
      out.screens.push({ type: 'tv', ...screenQuad(xf, -0.04, 0.86, 0.225, 0.2, 0.17) }); light(0, 0.9, 0.6, [0.5, 0.65, 1.0], 3.2, { flicker: 0.35, kind: 'tv' }); break;
    case 'kettle': B(0, 0.1, 0, 0.08, 0.1, 0.08, all('metal'), 1, 0.7, 1); B(0.1, 0.12, 0, 0.03, 0.02, 0.01, all('black')); break;
    case 'mugs': for (const [dx, dz] of [[0, 0], [0.12, 0.06], [-0.1, 0.08]]) B(dx, 0.045, dz, 0.035, 0.045, 0.035, all('porcelain')); break;
    case 'fridge': B(0, 0.75, 0, 0.32, 0.75, 0.3, { front: ['fridge'], side: ['porcelain'], top: ['porcelain'] }); break;
    case 'chess': B(0, 0.005, 0, 0.12, 0.005, 0.12, { top: ['chess'] }); break;
    case 'counter_window': B(0, 0.95, 0, 0.18, 0.04, 0.85, all('wood_dark')); break;
    case 'radio_station': B(0, 0.1, 0, 0.18, 0.1, 0.13, { front: ['radio_front'], side: ['metal_dark'], top: ['metal_dark'] }); B(0.1, 0.3, -0.08, 0.004, 0.2, 0.004, all('black')); B(-0.22, 0.05, 0.05, 0.04, 0.05, 0.02, all('black')); light(-0.05, 0.12, 0.2, [0.4, 1.0, 0.5], 0.9, { kind: 'indicator', power: true }); break;
    case 'city_map': B(0, 0, 0.01, 0.95, 0.65, 0.01, all('wood_dark')); out.screens.push({ type: 'city_map', ...screenQuad(xf, 0, 0, 0.022, 0.9, 0.6) }); break;
    case 'station_plan': B(0, 0, 0.01, 0.7, 0.5, 0.01, all('wood_dark')); out.screens.push({ type: 'station_plan', ...screenQuad(xf, 0, 0, 0.022, 0.66, 0.46) }); break;
    case 'monitors': for (const dx of [-0.25, 0.25]) { B(dx, 0.17, -0.05, 0.2, 0.17, 0.18, all('monitor_body')); out.screens.push({ type: 'monitor', idx: dx < 0 ? 0 : 1, ...screenQuad(xf, dx, 0.18, 0.131, 0.16, 0.13) }); } light(0, 0.2, 0.5, [0.7, 0.8, 0.9], 1.6, { kind: 'monitor', power: true }); break;
    case 'key_box': B(0, 0, 0.04, 0.2, 0.25, 0.04, { front: ['keys'], side: ['wood_dark'] }); break;
    case 'uaz': {
      const base = (geo2) => {
        B(0, 0.75, 0, 0.9, 0.42, 2.0, { side: ['uaz'], front: ['uaz'], back: ['uaz'], top: ['uaz'] });
        B(0, 1.4, -0.3, 0.86, 0.32, 1.4, { side: ['uaz_window'], front: ['uaz_window'], back: ['uaz_window'], top: ['metal', [0.7, 0.65, 0.4]] });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(sx * 0.82, 0.38, sz * 1.25, 0.14, 0.38, 0.38, all('tire'));
        B(0, 1.76, -0.2, 0.3, 0.05, 0.12, { top: ['station_sign_blue'], side: ['station_sign_blue'], front: ['station_sign_blue'] });
        B(0, 0.62, 2.02, 0.75, 0.15, 0.02, all('metal_dark'));
      };
      // УАЗ строится в отдельный буфер (может уезжать) — см. renderer; здесь — только данные
      out.vehicles.push({ id: p.id, x: p.x, z: p.z, rot: p.rot || 0, build: base });
      return; }
    case 'streetlamp': B(0, 2.5, 0, 0.06, 2.5, 0.06, all('metal_dark')); B(0, 4.95, 0.5, 0.05, 0.05, 0.55, all('metal_dark')); B(0, 4.88, 1.0, 0.18, 0.06, 0.25, { bottom: ['glow'], side: ['metal_dark'], top: ['metal_dark'] }); light(0, 4.6, 1.0, [1.7, 1.05, 0.48], 14, { kind: 'street', outdoor: true }); break;
    case 'yardlamp': B(0, 0, 0.15, 0.15, 0.08, 0.15, { bottom: ['glow'], side: ['metal_dark'], top: ['metal_dark'], front: ['metal_dark'] }); light(0, -0.3, 0.5, [1.0, 0.9, 0.7], 9, { kind: 'yard', outdoor: true, power: true }); break;
    case 'kiosk': B(0, 1.25, 0, 1.5, 1.25, 1.0, { front: ['kiosk'], side: ['metal', [0.6, 0.6, 0.65]], back: ['metal', [0.6, 0.6, 0.65]], top: ['metal_dark'] }); B(0, 2.6, 0, 1.6, 0.1, 1.1, all('metal_dark')); light(0, 1.5, 1.6, [1.0, 0.85, 0.5], 5, { kind: 'kiosk', outdoor: true, flicker: 0.1 }); break;
    case 'bus_stop': B(0, 1.2, 0.4, 1.5, 0.02, 0.6, all('metal_dark')); B(-1.45, 0.6, 0.4, 0.03, 0.6, 0.03, all('metal_dark')); B(1.45, 0.6, 0.4, 0.03, 0.6, 0.03, all('metal_dark')); B(0, 0.75, 0.95, 1.5, 0.45, 0.02, { front: ['busstop'], back: ['busstop'] }); B(0, 0.42, 0.6, 1.1, 0.03, 0.15, all('wood')); break;
    case 'trash': B(0, 0.35, 0, 0.22, 0.35, 0.22, all('metal_dark'), 1, 1.1, 0.85); break;
    case 'sign_station': B(0, 0, 0.02, 0.5, 0.25, 0.02, { front: ['sign_otd'], side: ['red'] }); B(2.55, 0.65, 0.02, 0.75, 0.18, 0.02, { front: ['sign_militia'] }); break;
    case 'porch': B(0, 0.08, 0.4, 1.6, 0.08, 0.9, { top: ['metal', [0.75, 0.75, 0.72]], side: ['metal', [0.6, 0.6, 0.58]] }); B(0, 2.85, 0.5, 1.7, 0.05, 1.0, all('metal_dark')); for (const sx of [-1, 1]) B(sx * 1.5, 1.45, 1.35, 0.04, 1.4, 0.04, all('metal_dark')); light(0, 2.6, 0.6, [1.0, 0.9, 0.7], 5.5, { kind: 'porch', outdoor: true, power: true, flicker: 0.05 }); break;
    case 'dumpster': B(0, 0.6, 0, 1.15, 0.6, 0.75, all('dumpster'), 1, 1, 0.92); break;
    case 'wrecked_car': B(0, 0.5, 0, 0.85, 0.3, 1.9, all('rust')); B(0, 1.0, -0.2, 0.8, 0.25, 1.0, { side: ['uaz_window'], top: ['rust'], front: ['uaz_window'], back: ['rust'] }); B(-0.8, 0.25, 1.2, 0.12, 0.25, 0.3, all('tire')); break;
    case 'fuel_tank': B(0, 0.9, 0, 0.95, 0.65, 0.65, { side: ['tank'], front: ['tank'], top: ['metal'] }); for (const sx of [-1, 1]) B(sx * 0.7, 0.13, 0, 0.06, 0.13, 0.5, all('metal_dark')); break;
    default: buildDecor(geo, p, A, out, xf, B, light); break;
  }
}

// Пропы, которые рисуются с alpha-test (лужи, пятна) — в отдельный меш «условных» предметов
export const ALPHA_PROPS = new Set(['puddle', 'dirt_stain']);

/** Обстановка v1.1: здание, двор, улица. Локально: +Z — «лицо» предмета; настенные — задом к стене (z=0). */
function buildDecor(geo, p, A, out, xf, B, light) {
  const sub = (dx, dy, dz, rx = 0, ry = 0, rz = 0) => new Xf().set(xf).mulLocal(dx, dy, dz, rx, ry, rz);
  const Bx = (X, cx, cy, cz, hx, hy, hz, faces, alpha = 1, tt = 1, tb = 1) => box(geo, X, cx, cy, cz, hx, hy, hz, faces, A, alpha, tt, tb);
  const w = p.w || 0.5;
  switch (p.type) {
    case 'radiator': // чугунная батарея у пола; w — полудлина
      B(0, 0.43, 0.075, w, 0.27, 0.05, { front: ['radiator'], back: ['radiator'], side: ['radiator'], top: ['radiator'] });
      for (const sx of [-1, 1]) B(sx * (w + 0.04), sx < 0 ? 0.62 : 0.2, 0.06, 0.016, 0.05, 0.016, all('metal', [0.75, 0.73, 0.66]));
      B(-w - 0.08, 1.0, 0.045, 0.016, 1.0, 0.016, all('metal', [0.75, 0.73, 0.66])); break;
    case 'wall_clock': B(0, 0, 0.025, 0.16, 0.16, 0.025, { front: ['clock'], side: ['black'], top: ['black'], bottom: ['black'] }); break;
    case 'locker': B(0, 0.95, 0, 0.45, 0.95, 0.25, { front: ['locker'], side: ['metal', [0.62, 0.74, 0.64]], top: ['metal', [0.55, 0.65, 0.57]], back: ['metal', [0.55, 0.65, 0.57]] }); B(0, 0.02, 0.02, 0.44, 0.02, 0.24, all('metal_dark')); break;
    case 'fire_shield':
      B(0, 0, 0.015, 0.6, 0.5, 0.015, { front: ['fire_shield'], side: ['red'], top: ['red'], bottom: ['red'] });
      B(0.4, -0.18, 0.12, 0.1, 0.13, 0.09, all('red'), 1, 1, 0.25); // конусное ведро
      B(0.4, -0.04, 0.12, 0.1, 0.005, 0.09, { top: ['black'] }); break;
    case 'poster': {
      const v = p.v || 'agit';
      const [hw, hh] = { honor: [0.8, 0.55], rules: [0.34, 0.47], agit: [0.33, 0.46], ad: [0.36, 0.5] }[v] || [0.33, 0.46];
      if (v === 'honor') { B(0, 0, 0.02, hw + 0.05, hh + 0.05, 0.02, all('wood_dark')); B(0, 0, 0.043, hw, hh, 0.003, { front: ['poster_honor'] }); }
      else B(0, 0, 0.005, hw, hh, 0.004, { front: ['poster_' + v], side: ['paper'] });
      break; }
    case 'bucket_mop':
      B(0, 0.15, 0, 0.14, 0.15, 0.14, all('metal', [0.72, 0.76, 0.82]), 1, 1, 0.8);
      B(0, 0.27, 0, 0.12, 0.004, 0.12, { top: ['blue_water', [0.55, 0.55, 0.5]] });
      { const m = sub(0.1, 0, -0.12, -0.22, 0, 0.18); Bx(m, 0, 0.7, 0, 0.012, 0.66, 0.012, all('wood')); Bx(m, 0, 0.04, 0, 0.13, 0.03, 0.05, all('fabric', [0.55, 0.55, 0.5])); }
      break;
    case 'ashtray':
      B(0, 0.012, 0, 0.055, 0.012, 0.055, all('metal', [0.85, 0.85, 0.8]), 1, 1, 0.8);
      B(0.012, 0.027, 0.01, 0.024, 0.004, 0.006, all('paper')); B(-0.015, 0.027, -0.01, 0.006, 0.004, 0.022, all('paper')); break;
    case 'trash_pile':
      B(0, 0.17, 0, 0.22, 0.17, 0.2, all('trash_bag'), 1, 0.55, 1);
      B(0.32, 0.12, 0.14, 0.17, 0.12, 0.15, all('trash_bag', [0.8, 0.95, 0.85]), 1, 0.55, 1);
      B(-0.28, 0.005, 0.22, 0.13, 0.004, 0.09, { top: ['paper'], side: ['paper'] }); B(0.08, 0.005, 0.38, 0.1, 0.004, 0.13, { top: ['paper'], side: ['paper'] });
      { const b = sub(-0.25, 0.04, -0.12, 0, 0.6, Math.PI / 2); Bx(b, 0, 0, 0, 0.035, 0.12, 0.035, all('bottle')); }
      B(0.2, 0.04, -0.25, 0.08, 0.04, 0.06, all('paper', [0.75, 0.6, 0.45])); break;
    case 'dirt_stain': { const s = p.s || 0.5;
      if (p.wall) B(0, 0, 0.004, s, s * 0.9, 0.002, { front: ['stain_wall'] });
      else B(0, 0.007, 0, s, 0.002, s * 0.85, { top: ['stain'] });
      break; }
    case 'puddle': { const s = p.s || 0.7; B(0, 0.009, 0, s, 0.002, s * 0.75, { top: ['puddle'] }); break; }
    case 'phone_booth':
      B(0, 1.1, 0, 0.45, 1.1, 0.45, { front: ['booth'], side: ['booth'], back: ['booth'], top: ['metal_dark'] });
      B(0, 2.24, 0, 0.5, 0.04, 0.5, all('red')); B(0, 0.01, 0, 0.47, 0.01, 0.47, all('metal_dark')); break;
    case 'tree': {
      B(0, 1.5, 0, 0.14, 1.5, 0.14, all('bark'), 1, 0.55, 1.1);
      const lim = [[0.7, 0], [0.55, 1.9], [0.8, 3.6], [0.5, 5.0], [0.65, 2.7]];
      lim.forEach(([rx, ry], k) => {
        const L = sub(0, 1.5 + k * 0.35, 0, rx, ry, 0); Bx(L, 0, 0.75, 0, 0.045, 0.75, 0.045, all('bark'), 1, 0.4, 1);
        const T = new Xf().set(L).mulLocal(0, 1.3, 0, -0.6, 0.8, 0); Bx(T, 0, 0.4, 0, 0.02, 0.4, 0.02, all('bark'), 1, 0.3, 1);
        if (k % 2 === 0) Bx(L, 0.05, 1.45, 0, 0.12, 0.08, 0.1, all('leaves'));
      });
      B(0, 3.2, 0, 0.05, 0.4, 0.05, all('bark'), 1, 0.3, 1); break; }
    case 'fence': { // палисадник из металлических прутьев; w — полудлина
      const c = all('metal', [0.32, 0.46, 0.34]);
      B(0, 0.86, 0, w, 0.02, 0.02, c); B(0, 0.18, 0, w, 0.02, 0.02, c);
      for (let x = -w + 0.08; x < w; x += 0.16) B(x, 0.5, 0, 0.009, 0.48, 0.009, c);
      for (let x = -w; x <= w + 0.01; x += Math.max(0.5, (2 * w) / Math.max(1, Math.round(w)))) B(x, 0.48, 0, 0.03, 0.48, 0.03, c);
      break; }
    case 'lamp_wall':
      B(0, 0, 0.05, 0.05, 0.05, 0.05, all('metal_dark')); B(0, -0.02, 0.17, 0.1, 0.06, 0.1, { bottom: ['glow'], side: ['metal', [0.7, 0.75, 0.7]], top: ['metal', [0.7, 0.75, 0.7]], front: ['metal', [0.7, 0.75, 0.7]] }, 1, 0.6, 1);
      light(0, -0.25, 0.4, [1.0, 0.82, 0.55], p.radius || 4.5, { kind: 'wall', power: true, outdoor: !!p.outdoor }); break;
    case 'curtains': // y — центр окна; w — полуширина проёма
      B(0, 0.72, 0.09, w + 0.32, 0.012, 0.012, all('metal_dark'));
      for (const sx of [-1, 1]) B(sx * (w + 0.12), -0.02, 0.08, 0.2, 0.7, 0.025, all('curtain'));
      break;
    case 'cabinet_small': B(0, 0.42, 0, 0.42, 0.42, 0.22, { front: ['drawers'], side: ['wood'], top: ['wood_dark'], back: ['wood'] }); break;
    case 'bench_street':
      for (const sx of [-1, 1]) B(sx * 0.75, 0.22, 0, 0.06, 0.22, 0.2, all('concrete_p'));
      for (let k = -1; k <= 1; k++) B(0, 0.46, k * 0.13, 0.95, 0.025, 0.055, all('wood', [0.8, 0.75, 0.7]));
      B(0, 0.72, -0.22, 0.95, 0.05, 0.02, all('wood', [0.8, 0.75, 0.7])); B(0, 0.86, -0.22, 0.95, 0.05, 0.02, all('wood', [0.8, 0.75, 0.7]));
      for (const sx of [-1, 1]) B(sx * 0.75, 0.66, -0.22, 0.04, 0.22, 0.03, all('concrete_p'));
      break;
    case 'trash_can': B(0, 0.36, 0, 0.21, 0.36, 0.21, all('urn'), 1, 1.12, 0.85); B(0, 0.722, 0, 0.19, 0.002, 0.19, { top: ['black'] }); break;
    case 'carpet': { // l — полудлина вдоль local z, w — полуширина; режем на сегменты (аффинные текстуры)
      const L = p.l || 1, n = Math.max(1, Math.round(L)); const hs = L / n; const tex = p.mat ? 'mat' : 'carpet';
      for (let k = 0; k < n; k++) B(0, 0.006, -L + hs * (2 * k + 1), w, 0.004, hs, { top: [tex], side: [tex] });
      break; }
    case 'radio_old': B(0, 0.12, 0, 0.2, 0.12, 0.1, { front: ['radio_old'], side: ['wood_dark'], top: ['wood'], back: ['wood_dark'] }); B(0.14, 0.32, -0.06, 0.004, 0.1, 0.004, all('metal')); break;
    case 'heater':
      B(0, 0.36, 0, 0.24, 0.29, 0.09, { front: ['heater'], back: ['heater'], side: ['heater'], top: ['porcelain'] });
      for (const sx of [-1, 1]) B(sx * 0.18, 0.04, 0, 0.02, 0.04, 0.16, all('metal_dark'));
      light(0, 0.3, 0.25, [1.0, 0.35, 0.2], 0.7, { kind: 'indicator', power: true }); break;
    case 'map_wall': B(0, 0, 0.008, 0.6, 0.42, 0.008, { front: ['map_district'], side: ['wood_dark'], top: ['wood_dark'], bottom: ['wood_dark'] }); break;
    case 'sign_room': B(0, 0, 0.008, 0.24, 0.065, 0.006, { front: ['sign_' + p.room], side: ['black'], top: ['black'], bottom: ['black'] }); break;
    case 'pc':
      B(0, 0.05, -0.05, 0.22, 0.05, 0.2, { front: ['monitor_body'], side: ['monitor_body'], top: ['monitor_body'] });
      B(0, 0.27, -0.06, 0.18, 0.17, 0.16, { front: ['pc_front'], side: ['monitor_body'], top: ['monitor_body'], back: ['monitor_body'] }, 1, 0.85, 1);
      B(0, 0.012, 0.25, 0.2, 0.012, 0.07, { top: ['keyboard'], side: ['monitor_body'], front: ['monitor_body'] });
      light(0, 0.3, 0.3, [0.4, 0.9, 0.5], 0.9, { kind: 'monitor', power: true }); break;
    case 'container':
      B(0, 1.25, 0, 2.4, 1.25, 1.1, { side: ['container'], front: ['container'], back: ['container'], top: ['rust'] });
      for (const sx of [-1, 1]) B(sx * 2.42, 1.25, 0.6, 0.02, 1.2, 0.03, all('metal_dark'));
      break;
    default: break;
  }
}
