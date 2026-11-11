// Персонажи: низкополигональные «коробочные» люди в духе PS1, процедурные анимации, CPU-скиннинг в общий буфер.
import { Atlas } from './textures.js';
import { RNG } from '../core/rng.js';
import { Xf } from './math.js';

const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
function fillNoise(x, w, h, rng, base, amp = 12) { x.fillStyle = base; x.fillRect(0, 0, w, h); const im = x.getImageData(0, 0, w, h); const d = im.data; for (let i = 0; i < d.length; i += 4) { const n = (rng.next() - 0.5) * 2 * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; } x.putImageData(im, 0, 0); }

export const SKIN = [[0.93, 0.78, 0.66], [0.86, 0.69, 0.56], [0.74, 0.57, 0.44], [0.97, 0.86, 0.77]];
export const HAIR = [[0.12, 0.1, 0.09], [0.28, 0.18, 0.1], [0.45, 0.3, 0.16], [0.78, 0.66, 0.42], [0.62, 0.62, 0.6], [0.55, 0.22, 0.1]];

export function genCharAtlas() {
  const A = new Atlas(256); const rng = new RNG(4242);
  A.add('white', 4, 4, (x) => { x.fillStyle = '#fff'; x.fillRect(0, 0, 4, 4); });
  // Милицейский китель: серый, золотые пуговицы, нагрудные карманы, погоны рисуются на плечах
  A.add('mil_jacket', 32, 32, (x, w, h) => {
    fillNoise(x, w, h, rng, rgb(118, 124, 132), 7);
    x.fillStyle = rgb(90, 96, 104); x.fillRect(15, 0, 2, 32);
    x.fillStyle = rgb(200, 170, 70); for (let j = 6; j < 30; j += 7) x.fillRect(17, j, 2, 2);
    x.fillStyle = rgb(96, 102, 110); x.fillRect(4, 8, 8, 6); x.fillRect(20, 8, 8, 6);
    x.fillStyle = rgb(200, 170, 70); x.fillRect(7, 9, 2, 1); x.fillRect(23, 9, 2, 1);
    x.fillStyle = rgb(60, 50, 40); x.fillRect(0, 26, 32, 2); // ремень
    x.fillStyle = rgb(170, 150, 80); x.fillRect(14, 26, 4, 2);
    x.fillStyle = rgb(170, 175, 185); x.fillRect(13, 0, 6, 4); // рубашка в вороте
    x.fillStyle = rgb(40, 50, 70); x.fillRect(15, 0, 2, 5); // галстук
  });
  A.add('mil_coat', 32, 32, (x, w, h) => {
    fillNoise(x, w, h, rng, rgb(70, 76, 90), 8);
    x.fillStyle = rgb(50, 54, 66); x.fillRect(15, 0, 2, 32);
    x.fillStyle = rgb(170, 150, 70); for (let j = 4; j < 28; j += 8) { x.fillRect(11, j, 2, 2); x.fillRect(19, j, 2, 2); }
    x.fillStyle = rgb(80, 60, 50); x.fillRect(0, 24, 32, 2);
    x.fillStyle = rgb(90, 80, 70); x.fillRect(10, 0, 12, 4); // воротник
  });
  A.add('mil_back', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(116, 122, 130), 7); x.fillStyle = rgb(60, 50, 40); x.fillRect(0, 26, 32, 2); x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(15, 4, 2, 22); });
  A.add('mil_trousers', 16, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(100, 106, 114), 6); x.fillStyle = rgb(170, 30, 30); x.fillRect(0, 0, 1, 32); x.fillRect(15, 0, 1, 32); });
  A.add('mil_skirt', 32, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(100, 106, 114), 6); x.fillStyle = rgb(80, 86, 94); x.fillRect(15, 4, 2, 12); x.fillStyle = rgb(60, 50, 40); x.fillRect(0, 0, 32, 2); });
  A.add('epaulet', 8, 4, (x) => { x.fillStyle = rgb(110, 116, 124); x.fillRect(0, 0, 8, 4); x.fillStyle = rgb(170, 30, 30); x.fillRect(0, 0, 8, 1); x.fillStyle = rgb(220, 190, 80); x.fillRect(3, 1, 2, 2); });
  A.add('tights', 16, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(150, 120, 105), 5); });
  A.add('boots', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(24, 22, 22), 6); x.fillStyle = 'rgba(255,255,255,0.15)'; x.fillRect(2, 2, 3, 2); });
  A.add('sneakers', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(210, 210, 210), 8); x.fillStyle = rgb(40, 40, 120); x.fillRect(3, 6, 10, 2); x.fillStyle = '#333'; x.fillRect(0, 13, 16, 3); });
  A.add('shoes_f', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(30, 20, 20), 6); });
  // Спортивный костюм: синий с тремя белыми полосами (без логотипов)
  A.add('track_blue', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(30, 40, 110), 8); x.fillStyle = '#e8e8e8'; for (const s of [2, 5, 8]) { x.fillRect(s, 0, 1, 32); x.fillRect(31 - s, 0, 1, 32); } x.fillStyle = '#ccc'; x.fillRect(15, 0, 2, 20); });
  A.add('track_red', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(130, 26, 30), 8); x.fillStyle = '#e8e8e8'; for (const s of [2, 5, 8]) { x.fillRect(s, 0, 1, 32); x.fillRect(31 - s, 0, 1, 32); } x.fillStyle = '#ccc'; x.fillRect(15, 0, 2, 20); });
  A.add('track_legs', 16, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(30, 40, 110), 8); x.fillStyle = '#e8e8e8'; x.fillRect(1, 0, 1, 32); x.fillRect(4, 0, 1, 32); x.fillRect(7, 0, 1, 32); });
  A.add('leather', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(28, 26, 26), 10); x.fillStyle = 'rgba(255,255,255,0.14)'; x.fillRect(4, 4, 6, 18); x.fillRect(22, 6, 5, 14); x.fillStyle = rgb(90, 90, 90); x.fillRect(15, 0, 1, 30); x.fillStyle = rgb(50, 30, 30); x.fillRect(12, 0, 8, 6); });
  A.add('leather_brown', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(70, 40, 24), 10); x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(4, 4, 6, 18); x.fillStyle = rgb(110, 110, 100); x.fillRect(15, 0, 1, 30); });
  A.add('camo', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(90, 96, 60), 6); for (let k = 0; k < 26; k++) { x.fillStyle = rng.pick([rgb(60, 70, 40), rgb(110, 100, 70), rgb(40, 44, 30)]); x.fillRect(rng.int(0, 28), rng.int(0, 28), rng.int(3, 7), rng.int(2, 5)); } });
  A.add('camo_city', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(110, 112, 116), 6); for (let k = 0; k < 26; k++) { x.fillStyle = rng.pick([rgb(70, 72, 80), rgb(150, 150, 150), rgb(40, 42, 50)]); x.fillRect(rng.int(0, 28), rng.int(0, 28), rng.int(3, 7), rng.int(2, 5)); } });
  A.add('jeans', 16, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(60, 80, 120), 14); x.fillStyle = 'rgba(200,200,220,0.25)'; x.fillRect(5, 8, 6, 10); });
  A.add('dark_trousers', 16, 32, (x, w, h) => fillNoise(x, w, h, rng, rgb(40, 40, 44), 8));
  A.add('coat', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(170, 170, 170), 10); x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(15, 0, 2, 32); for (let j = 4; j < 30; j += 7) x.fillRect(12, j, 2, 2); x.fillRect(2, 18, 9, 1); x.fillRect(21, 18, 9, 1); x.fillStyle = 'rgba(0,0,0,0.2)'; x.fillRect(8, 0, 16, 5); });
  A.add('sweater', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(150, 150, 150), 14); x.fillStyle = 'rgba(0,0,0,0.25)'; for (let j = 8; j < 32; j += 6) x.fillRect(0, j, 32, 2); });
  A.add('prisoner', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(60, 60, 64), 10); x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(15, 0, 2, 32); });
  A.add('medic', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(220, 222, 222), 5); x.fillStyle = '#c22'; x.fillRect(5, 6, 6, 2); x.fillRect(7, 4, 2, 6); });
  A.add('vest_cover', 32, 32, (x, w, h) => { fillNoise(x, w, h, rng, rgb(56, 64, 56), 8); x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, 8, 32, 1); x.fillRect(0, 18, 32, 1); x.fillStyle = '#ddd'; x.font = 'bold 5px monospace'; x.fillText('МИЛИЦИЯ', 3, 15); });
  // Лица (серые черты на светлом фоне; кожа — цветом вершин)
  const face = (fem, old) => (x, w, h) => {
    fillNoise(x, w, h, rng, rgb(235, 235, 235), 5);
    // брови
    x.fillStyle = fem ? rgb(110, 90, 80) : rgb(70, 60, 55); x.fillRect(4, 8, 5, fem ? 1 : 2); x.fillRect(11, 8, 5, fem ? 1 : 2);
    // глаза
    x.fillStyle = rgb(250, 250, 250); x.fillRect(5, 10, 4, 2); x.fillRect(11, 10, 4, 2);
    x.fillStyle = rgb(40, 40, 50); x.fillRect(6, 10, 2, 2); x.fillRect(12, 10, 2, 2);
    if (fem) { x.fillStyle = rgb(30, 25, 25); x.fillRect(4, 9, 6, 1); x.fillRect(10, 9, 6, 1); x.fillStyle = 'rgba(160,110,140,0.5)'; x.fillRect(4, 9, 5, 1); x.fillRect(11, 9, 5, 1); }
    // нос
    x.fillStyle = 'rgba(120,90,80,0.55)'; x.fillRect(9, 11, 2, 4); x.fillRect(8, 15, 4, 1);
    // рот
    x.fillStyle = fem ? rgb(170, 50, 60) : rgb(130, 80, 75); x.fillRect(7, 18, 6, fem ? 2 : 1);
    // щёки
    x.fillStyle = fem ? 'rgba(230,120,120,0.25)' : 'rgba(180,110,100,0.12)'; x.fillRect(3, 14, 3, 3); x.fillRect(14, 14, 3, 3);
    if (old) { x.fillStyle = 'rgba(90,70,60,0.35)'; x.fillRect(3, 6, 14, 1); x.fillRect(4, 16, 2, 4); x.fillRect(14, 16, 2, 4); }
    // щетина у мужчин
    if (!fem) { for (let k = 0; k < 30; k++) { x.fillStyle = 'rgba(70,60,60,0.25)'; x.fillRect(rng.int(4, 15), rng.int(16, 22), 1, 1); } }
  };
  A.add('face_m', 20, 24, face(false, false));
  A.add('face_f', 20, 24, face(true, false));
  A.add('face_old', 20, 24, face(false, true));
  A.add('face_oldf', 20, 24, face(true, true));
  A.add('mustache', 8, 4, (x) => { x.fillStyle = '#fff'; x.fillRect(0, 1, 8, 2); });
  A.add('glasses', 16, 4, (x) => { x.clearRect(0, 0, 16, 4); x.strokeStyle = '#222'; x.strokeRect(1.5, 0.5, 5, 3); x.strokeRect(9.5, 0.5, 5, 3); });
  A.add('mask', 20, 24, (x, w, h) => { fillNoise(x, w, h, rng, rgb(25, 25, 28), 6); x.fillStyle = rgb(210, 170, 150); x.fillRect(4, 9, 12, 4); x.fillStyle = '#222'; x.fillRect(6, 10, 2, 2); x.fillRect(12, 10, 2, 2); x.fillStyle = rgb(190, 140, 130); x.fillRect(8, 17, 4, 2); });
  A.add('hair', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(200, 200, 200), 30); x.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < 16; i += 2) x.fillRect(i, 0, 1, 16); });
  A.add('skin', 8, 8, (x, w, h) => fillNoise(x, w, h, rng, rgb(240, 240, 240), 4));
  A.add('hands', 8, 8, (x, w, h) => { fillNoise(x, w, h, rng, rgb(240, 240, 240), 4); x.fillStyle = 'rgba(120,90,80,0.3)'; x.fillRect(0, 2, 8, 1); x.fillRect(0, 5, 8, 1); });
  A.add('cap_top', 16, 16, (x, w, h) => fillNoise(x, w, h, rng, rgb(110, 116, 126), 6));
  A.add('cap_band', 32, 8, (x, w, h) => { fillNoise(x, w, h, rng, rgb(160, 26, 30), 6); x.fillStyle = rgb(220, 190, 70); x.fillRect(14, 1, 4, 5); x.fillStyle = '#b22'; x.fillRect(15, 2, 2, 3); x.fillStyle = '#111'; x.fillRect(0, 6, 32, 2); });
  A.add('visor', 8, 8, (x) => { x.fillStyle = '#121212'; x.fillRect(0, 0, 8, 8); x.fillStyle = 'rgba(255,255,255,0.2)'; x.fillRect(1, 1, 6, 1); });
  A.add('ushanka', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(70, 56, 44), 25); });
  A.add('beanie', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(30, 30, 90), 10); x.fillStyle = '#ddd'; x.fillRect(0, 6, 16, 2); x.fillStyle = '#b22'; x.fillRect(0, 10, 16, 2); });
  A.add('helmet', 16, 16, (x, w, h) => fillNoise(x, w, h, rng, rgb(70, 80, 66), 8));
  A.add('scarf', 16, 16, (x, w, h) => { fillNoise(x, w, h, rng, rgb(120, 40, 50), 10); for (let k = 0; k < 10; k++) { x.fillStyle = '#d8b060'; x.fillRect(rng.int(0, 14), rng.int(0, 14), 2, 2); } });
  // оружие
  A.add('gun_metal', 8, 8, (x, w, h) => fillNoise(x, w, h, rng, rgb(36, 36, 38), 6));
  A.add('gun_wood', 8, 8, (x, w, h) => fillNoise(x, w, h, rng, rgb(110, 60, 30), 8));
  A.add('blade', 8, 8, (x, w, h) => fillNoise(x, w, h, rng, rgb(190, 190, 195), 8));
  A.add('nails', 4, 4, (x) => { x.fillStyle = rgb(190, 20, 40); x.fillRect(0, 0, 4, 4); });
  A.add('gold', 4, 4, (x) => { x.fillStyle = rgb(220, 180, 60); x.fillRect(0, 0, 4, 4); });
  A.add('watch', 8, 4, (x) => { x.fillStyle = rgb(40, 30, 20); x.fillRect(0, 0, 8, 4); x.fillStyle = rgb(210, 210, 200); x.fillRect(2, 0, 4, 4); });
  A.add('blood', 8, 8, (x) => { x.fillStyle = rgb(110, 10, 10); x.fillRect(0, 0, 8, 8); });
  return A;
}

// ——— описание гардероба по look.uniform ———
const OUTFITS = {
  militia:       { torso: 'mil_jacket', back: 'mil_back', arms: 'mil_back', legs: 'mil_trousers', feet: 'boots', ep: true },
  militia_coat:  { torso: 'mil_coat', back: 'mil_coat', arms: 'mil_coat', legs: 'mil_trousers', feet: 'boots', ep: true, bulky: 1.08 },
  omon:          { torso: 'camo_city', back: 'camo_city', arms: 'camo_city', legs: 'camo_city', feet: 'boots' },
  bandit_track:  { torso: 'track_blue', back: 'track_blue', arms: 'track_blue', legs: 'track_legs', feet: 'sneakers', alt: 'track_red' },
  bandit_leather:{ torso: 'leather', back: 'leather', arms: 'leather', legs: 'dark_trousers', feet: 'boots', alt: 'leather_brown', altLegs: 'jeans' },
  bandit_camo:   { torso: 'camo', back: 'camo', arms: 'camo', legs: 'camo', feet: 'boots' },
  junkie:        { torso: 'sweater', back: 'sweater', arms: 'sweater', legs: 'jeans', feet: 'sneakers', tint: [0.6, 0.62, 0.55] },
  civil_m:       { torso: 'coat', back: 'coat', arms: 'coat', legs: 'dark_trousers', feet: 'boots', tintPool: [[0.55, 0.5, 0.45], [0.4, 0.42, 0.45], [0.5, 0.42, 0.34], [0.3, 0.3, 0.32]] },
  civil_f:       { torso: 'coat', back: 'coat', arms: 'coat', legs: 'tights', feet: 'shoes_f', skirt: 'coat', tintPool: [[0.6, 0.35, 0.35], [0.45, 0.45, 0.55], [0.55, 0.5, 0.4], [0.35, 0.4, 0.35]] },
  prisoner:      { torso: 'prisoner', back: 'prisoner', arms: 'prisoner', legs: 'dark_trousers', feet: 'sneakers' },
  medic:         { torso: 'medic', back: 'medic', arms: 'medic', legs: 'dark_trousers', feet: 'shoes_f' },
};

// ——— скелет: размеры частей (м) ———
function proportions(look) {
  const f = look.gender === 'f'; const b = look.build || 1;
  return {
    hip: 0.93 * (f ? 0.97 : 1), pelvisW: f ? 0.34 : 0.32, pelvisH: 0.18, pelvisD: 0.2,
    torsoW: (f ? 0.34 : 0.4) * b, torsoH: 0.52, torsoD: (f ? 0.2 : 0.22) * b, waistW: (f ? 0.28 : 0.36) * b,
    headW: f ? 0.19 : 0.21, headH: f ? 0.23 : 0.25, headD: 0.22,
    uarmL: 0.29, larmL: 0.27, armW: f ? 0.085 : 0.105,
    thighL: 0.44, shinL: 0.44, legW: f ? 0.12 : 0.145,
    shoulderX: (f ? 0.205 : 0.25) * b, hipX: f ? 0.095 : 0.09,
  };
}

// ——— позы и анимации: возвращают углы суставов ———
function poseFor(a, t) {
  const P = { pelvisY: 0, pelvisRx: 0, torsoRx: 0, torsoRy: 0, headRx: 0, headRy: 0,
    lSh: [0, 0, 0.08], rSh: [0, 0, -0.08], lEl: 0, rEl: 0, lHip: [0, 0], rHip: [0, 0], lKn: 0, rKn: 0, bodyRx: 0, bodyY: 0, lie: false, gun: 'none' };
  const anim = a.anim || 'idle';
  const breath = Math.sin(t * 1.7) * 0.015;
  P.torsoRx = breath;
  const walkLike = (speed, amp, armAmp) => {
    const ph = t * speed; const s = Math.sin(ph), c = Math.cos(ph);
    P.lHip = [s * amp, 0]; P.rHip = [-s * amp, 0];
    P.lKn = Math.max(0, -c) * amp * 1.4; P.rKn = Math.max(0, c) * amp * 1.4;
    P.lSh = [-s * armAmp, 0, 0.08]; P.rSh = [s * armAmp, 0, -0.08]; P.lEl = -0.25 - Math.max(0, s) * 0.3; P.rEl = -0.25 - Math.max(0, -s) * 0.3;
    P.pelvisY = Math.abs(c) * 0.035; P.torsoRy = s * 0.08;
  };
  switch (anim) {
    case 'walk': walkLike(7.2, 0.45, 0.4); break;
    case 'carry': walkLike(7.2, 0.45, 0); P.lSh = [-0.95, 0, 0.12]; P.rSh = [-0.95, 0, -0.12]; P.lEl = -1.45; P.rEl = -1.45; break;
    case 'run': walkLike(11, 0.75, 0.8); P.torsoRx = 0.25; P.lEl = -1.3; P.rEl = -1.3; break;
    case 'crouchwalk': walkLike(6, 0.35, 0.2); P.pelvisY = -0.32; P.lHip[0] -= 0.9; P.rHip[0] -= 0.9; P.lKn += 1.3; P.rKn += 1.3; P.torsoRx = 0.35; break;
    case 'sit': P.pelvisY = -0.47; P.lHip = [-1.5, 0.05]; P.rHip = [-1.5, -0.05]; P.lKn = 1.5; P.rKn = 1.5; P.lSh = [-0.5, 0, 0.1]; P.rSh = [-0.5, 0, -0.1]; P.lEl = -0.9; P.rEl = -0.9; P.torsoRx = -0.05 + breath; break;
    case 'crouch': case 'crouchaim': P.pelvisY = -0.42; P.lHip = [-1.5, 0.15]; P.rHip = [-0.5, -0.1]; P.lKn = 2.0; P.rKn = 1.9; P.torsoRx = 0.3; break;
    case 'lie': case 'dead': P.lie = true; P.lSh = [-0.3, 0, 0.5]; P.rSh = [0.2, 0, -0.9]; P.lHip = [0.1, 0.1]; P.rHip = [-0.2, -0.1]; P.lKn = 0.3; break;
    case 'drink': P.rSh = [-1.1 - Math.max(0, Math.sin(t * 0.8)) * 0.6, 0.3, -0.2]; P.rEl = -1.9; break;
    case 'smoke': { const k = Math.max(0, Math.sin(t * 0.7)); P.rSh = [-0.4 - k * 0.9, 0.35, -0.2]; P.rEl = -1.6 - k * 0.6; P.lSh = [0, 0, 0.1]; break; }
    case 'phone': P.rSh = [-1.0, 0.6, -0.4]; P.rEl = -2.4; P.headRy = 0.2; break;
    case 'talk': { const k = Math.sin(t * 3.1); P.rSh = [-0.5 + k * 0.2, 0, -0.2]; P.rEl = -1.0 + k * 0.3; P.headRy = Math.sin(t * 1.3) * 0.15; P.headRx = Math.sin(t * 2.3) * 0.06; break; }
    case 'write': P.lSh = [-0.7, 0, 0.1]; P.rSh = [-0.7 + Math.sin(t * 6) * 0.05, 0, -0.1]; P.lEl = -0.9; P.rEl = -1.0; P.headRx = 0.35; break;
    case 'wave': P.rSh = [-2.7, 0, -0.3 + Math.sin(t * 8) * 0.25]; P.rEl = -0.4; break;
    case 'guard': P.lSh = [0.35, 0, 0.1]; P.rSh = [0.35, 0, -0.1]; P.lEl = -1.2; P.rEl = -1.2; break;
    case 'punch': { const k = Math.min(1, (a.forcedAnimT || 0) * 4); P.rSh = [-1.5 * (1 - k * 0.5), 0, -0.1]; P.rEl = -0.2; P.torsoRy = -0.3; break; }
    case 'cuff': P.lSh = [-0.8, 0, 0.2]; P.rSh = [-0.8, 0, -0.2]; P.lEl = -0.6; P.rEl = -0.6; P.torsoRx = 0.3; break;
    case 'hit': P.torsoRx = -0.25; P.headRx = -0.3; P.lSh = [0.3, 0, 0.5]; P.rSh = [0.3, 0, -0.5]; break;
    case 'hands_up': P.lSh = [-2.9, 0, 0.3]; P.rSh = [-2.9, 0, -0.3]; P.lEl = -0.3; P.rEl = -0.3; break;
    case 'cower': P.pelvisY = -0.45; P.lHip = [-1.6, 0.2]; P.rHip = [-1.6, -0.2]; P.lKn = 2.2; P.rKn = 2.2; P.torsoRx = 0.6; P.lSh = [-2.4, 0, 0.6]; P.rSh = [-2.4, 0, -0.6]; P.lEl = -2.0; P.rEl = -2.0; break;
    case 'shake_bars': { const k = Math.sin(t * 14) * 0.08; P.lSh = [-1.6 + k, 0, 0.25]; P.rSh = [-1.6 - k, 0, -0.25]; P.lEl = -0.5; P.rEl = -0.5; break; }
    default: { // idle с переминанием
      const sway = Math.sin(t * 0.6) * 0.03; P.torsoRy = sway; P.headRy = Math.sin(t * 0.37) * 0.25; break;
    }
  }
  // оружие в руках
  const wpn = a.look?.weapon || 'none';
  const hold = a.data?.holding;
  if (hold === 'papers' && !P.lie && anim !== 'sit') { P.lSh = [-0.95, 0, 0.12]; P.rSh = [-0.95, 0, -0.12]; P.lEl = -1.45; P.rEl = -1.45; }
  else if (hold === 'mug' && !P.lie && anim !== 'drink') { P.rSh = [-0.7, 0.25, -0.15]; P.rEl = -1.6; }
  const aiming = a.data?.aiming || anim === 'aim' || anim === 'crouchaim' || anim === 'shoot';
  if (wpn !== 'none' && !P.lie) {
    const long = wpn === 'aks74u' || wpn === 'ks23' || wpn === 'shotgun' || wpn === 'sawnoff';
    if (aiming) {
      const rec = anim === 'shoot' ? Math.max(0, (a.forcedAnimT || 0)) * 1.2 : 0;
      const ap = (a.aimPitch || 0);
      if (long) { P.rSh = [-1.45 - ap - rec * 0.3, -0.25, -0.1]; P.rEl = -0.5; P.lSh = [-1.35 - ap, 0.55, 0.15]; P.lEl = -0.55; }
      else { P.rSh = [-1.55 - ap - rec * 0.4, 0.12, -0.05]; P.rEl = -0.05; P.lSh = [-1.45 - ap, 0.45, 0.1]; P.lEl = -0.35; }
      P.gun = long ? 'long_aim' : 'pistol_aim';
    } else if (anim === 'idle' || anim === 'walk' || anim === 'run' || anim === 'crouch' || anim === 'crouchwalk') {
      if (long) { P.rSh = [-0.5, -0.3, -0.15]; P.rEl = -1.1; P.lSh = [-0.7, 0.5, 0.15]; P.lEl = -1.2; P.gun = 'long_low'; }
      else if (a.data?.drawn) { P.rSh = [-0.4, 0, -0.1]; P.rEl = -0.4; P.gun = 'pistol_low'; }
      else P.gun = 'holster';
    } else P.gun = long ? 'back' : 'holster';
  }
  return P;
}

// ——— построение геометрии ———
const tmp = new Float32Array(3), tmpN = new Float32Array(3);
const CORNERS = [
  // грань: 4 вершины (x,y,z в долях −0.5..0.5 / низ 0..−1 для конечностей) и нормаль
  { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], f: 'front' },
  { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], f: 'back' },
  { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], f: 'side' },
  { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], f: 'side' },
  { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], f: 'top' },
  { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], f: 'bottom' },
];
/**
 * Коробка в локальных координатах xf: центр (cx,cy,cz), полуразмеры (hx,hy,hz).
 * faces: {front, back, side, top, bottom} → [region, tint]. taperTop — сужение верхней грани по X (для юбки/торса).
 */
export function box(geo, xf, cx, cy, cz, hx, hy, hz, faces, atlas, alpha = 1, taperTop = 1, taperBottom = 1) {
  for (const F of CORNERS) {
    const spec = faces[F.f] || faces.side || faces.front; if (!spec) continue;
    const reg = atlas.r(spec[0]); const tint = spec[1] || [1, 1, 1];
    const uv = [[reg[0], reg[3]], [reg[2], reg[3]], [reg[2], reg[1]], [reg[0], reg[1]]];
    xf.applyN(F.n[0], F.n[1], F.n[2], tmpN);
    const P = [];
    for (let k = 0; k < 4; k++) {
      const c = F.v[k]; const tp = c[1] > 0 ? taperTop : taperBottom;
      xf.apply(cx + c[0] * hx * tp, cy + c[1] * hy, cz + c[2] * hz, tmp); P.push([tmp[0], tmp[1], tmp[2]]);
    }
    const idx = [0, 1, 2, 0, 2, 3];
    for (const i of idx) geo.v(P[i][0], P[i][1], P[i][2], uv[i][0], uv[i][1], tint[0], tint[1], tint[2], alpha, tmpN[0], tmpN[1], tmpN[2]);
  }
}

const tintCache = new Map();
function hashTint(id, pool) { if (!pool) return [1, 1, 1]; let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0; return pool[Math.abs(h) % pool.length]; }

/**
 * Построить персонажа в geo.
 * opts: {hideHead, hideArms, alpha, dirt}
 */
export function buildCharacter(geo, a, atlas, opts = {}) {
  const look = a.look || {}; const L = proportions(look); const fem = look.gender === 'f';
  const t = a.animTime || 0; const P = poseFor(a, t);
  const O = OUTFITS[look.uniform] || OUTFITS.civil_m;
  const skin = SKIN[look.skin | 0] || SKIN[0]; const hairC = HAIR[look.hair | 0] || HAIR[0];
  let cloth = O.tint || hashTint(a.id, O.tintPool) || [1, 1, 1];
  const useAlt = O.alt && (Math.abs(hashCode(a.id)) % 2 === 1);
  const torsoReg = useAlt ? O.alt : O.torso; const backReg = useAlt ? O.alt : O.back; const armReg = useAlt ? O.alt : O.arms;
  const legsReg = useAlt && O.altLegs ? O.altLegs : O.legs;
  const W = [1, 1, 1];
  const ct = cloth; const bulky = O.bulky || 1;
  const skirt = (fem && (look.uniform === 'militia' || look.uniform === 'militia_coat' || look.uniform === 'civil_f' || look.uniform === 'medic')) ? (O.skirt || 'mil_skirt') : null;
  const legTex = skirt ? 'tights' : legsReg; const legTint = skirt ? [1, 1, 1] : (O.tintPool && legsReg === 'coat' ? ct : W);
  const alpha = opts.alpha ?? 1;

  const root = new Xf();
  if (P.lie) {
    // лежит на спине/боку: корень на полу, поворот по X
    root.mulLocal(a.x, 0.12, a.z, 0, a.yaw, 0).mulLocal(0, 0, -0.9, -Math.PI / 2, 0, 0);
  } else root.mulLocal(a.x, (a.y || 0), a.z, 0, a.yaw, 0);
  const s = look.build || 1;
  // таз
  const pelvis = new Xf().set(root).mulLocal(0, L.hip + P.pelvisY, 0, P.pelvisRx, 0, 0);
  box(geo, pelvis, 0, 0, 0, L.pelvisW / 2 * bulky, L.pelvisH / 2, L.pelvisD / 2, { front: [skirt ? (skirt === 'coat' ? 'coat' : 'mil_skirt') : legsReg, skirt === 'coat' ? ct : legTint] }, atlas, alpha);
  // ноги
  for (const side of [-1, 1]) {
    const hip = side < 0 ? P.rHip : P.lHip; const kn = side < 0 ? P.rKn : P.lKn; // side −1 = правая (−X)
    const th = new Xf().set(pelvis).mulLocal(side * L.hipX * (fem ? 1.05 : 1), -0.06, 0, hip[0], 0, hip[1]);
    box(geo, th, 0, -L.thighL / 2, 0, L.legW / 2, L.thighL / 2, L.legW / 2 * 1.05, { front: [legTex, legTint] }, atlas, alpha);
    const sh = new Xf().set(th).mulLocal(0, -L.thighL, 0, kn, 0, 0);
    box(geo, sh, 0, -L.shinL / 2, 0, L.legW / 2 * 0.9, L.shinL / 2, L.legW / 2 * 0.95, { front: [legTex, legTint] }, atlas, alpha);
    const ft = new Xf().set(sh).mulLocal(0, -L.shinL, 0, -kn * 0.3 - hip[0] * 0.2, 0, 0);
    box(geo, ft, 0, -0.035, 0.05, L.legW / 2 * 0.85, 0.04, fem ? 0.11 : 0.13, { front: [O.feet], top: [O.feet], side: [O.feet] }, atlas, alpha);
  }
  // юбка (поверх бёдер) — трапеция
  if (skirt && !P.lie) {
    const sk = new Xf().set(pelvis);
    const lift = Math.max(0, -Math.min(P.lHip[0], P.rHip[0])) * 0.12;
    box(geo, sk, 0, -0.2 + lift * 0.5, 0.01 + lift, L.pelvisW / 2 * 1.12, 0.17, L.pelvisD / 2 * 1.3, { front: [skirt === 'coat' ? 'coat' : 'mil_skirt', skirt === 'coat' ? ct : W] }, atlas, alpha, 0.88, 1.12);
  }
  // торс
  const torso = new Xf().set(pelvis).mulLocal(0, L.pelvisH / 2, 0, P.torsoRx, P.torsoRy, 0);
  const noT = !!opts.hideTorso;
  const tF = { front: [torsoReg, O.tintPool ? ct : W], back: [backReg, O.tintPool ? ct : W], side: [backReg, O.tintPool ? ct : W], top: [backReg, O.tintPool ? ct : W] };
  if (noT) { /* тело игрока от первого лица: торс не рисуем */ }
  else if (fem) {
    box(geo, torso, 0, 0.13, 0, L.waistW / 2 * bulky, 0.13, L.torsoD / 2 * bulky, tF, atlas, alpha, 1.15, 1);
    box(geo, torso, 0, 0.39, 0.0, L.torsoW / 2 * bulky, 0.13, L.torsoD / 2 * 1.05 * bulky, tF, atlas, alpha, 0.95, 1.05);
    if (!look.armor) { // грудь: два объёма со скруглённым (ступенчатым) профилем, а не один брусок
      const bf = { front: [torsoReg, O.tintPool ? ct : W], side: [torsoReg, O.tintPool ? ct : W], top: [torsoReg, O.tintPool ? ct : W] };
      const hw = L.torsoW / 2 * 0.75, zf = L.torsoD / 2 * 0.78;
      for (const side of [-1, 1]) {
        const cx = side * hw * 0.5;
        box(geo, torso, cx, 0.355, zf, hw * 0.44, 0.07, 0.03, bf, atlas, alpha, 0.72, 0.72);      // основание: восьмиугольный силуэт спереди
        box(geo, torso, cx, 0.35, zf + 0.028, hw * 0.3, 0.048, 0.018, bf, atlas, alpha, 0.7, 0.7); // выступ: уже и ниже
        box(geo, torso, cx, 0.345, zf + 0.044, hw * 0.16, 0.026, 0.01, bf, atlas, alpha, 0.75, 0.75); // вершина
      }
    }
  } else {
    box(geo, torso, 0, L.torsoH / 2, 0, L.torsoW / 2 * bulky, L.torsoH / 2, L.torsoD / 2 * bulky, tF, atlas, alpha, 1.0, L.waistW / L.torsoW);
  }
  if (look.armor && !noT) box(geo, torso, 0, L.torsoH * 0.52, 0, L.torsoW / 2 * 1.08 * bulky, L.torsoH * 0.36, L.torsoD / 2 * 1.35 * bulky, { front: ['vest_cover'], back: ['vest_cover'], side: ['vest_cover'], top: ['vest_cover'] }, atlas, alpha);
  if (O.ep && !noT) for (const side of [-1, 1]) box(geo, torso, side * L.torsoW * 0.32, L.torsoH + 0.005, 0, 0.06, 0.012, 0.045, { top: ['epaulet'], front: ['epaulet'], side: ['epaulet'] }, atlas, alpha);
  // руки
  if (!opts.hideArms) for (const side of [-1, 1]) {
    const shv = side < 0 ? P.rSh : P.lSh; const el = side < 0 ? P.rEl : P.lEl;
    const ua = new Xf().set(torso).mulLocal(side * L.shoulderX * bulky, L.torsoH - 0.04, 0, shv[0], shv[1] * -side, shv[2] + side * 0.06); // ry>0 = к центру
    box(geo, ua, 0, -L.uarmL / 2, 0, L.armW / 2 * bulky, L.uarmL / 2, L.armW / 2 * bulky, { front: [armReg, O.tintPool ? ct : W] }, atlas, alpha);
    const la = new Xf().set(ua).mulLocal(0, -L.uarmL, 0, el, 0, 0);
    box(geo, la, 0, -L.larmL / 2, 0, L.armW / 2 * 0.92 * bulky, L.larmL / 2, L.armW / 2 * 0.92 * bulky, { front: [armReg, O.tintPool ? ct : W] }, atlas, alpha);
    const hd = new Xf().set(la).mulLocal(0, -L.larmL, 0, 0, 0, 0);
    box(geo, hd, 0, -0.05, 0.005, L.armW / 2 * 0.8, 0.05, L.armW / 2 * 0.55, { front: ['hands', skin] }, atlas, alpha);
    // оружие в правой руке
    if (side < 0 && (P.gun === 'pistol_aim' || P.gun === 'pistol_low')) {
      box(geo, hd, 0, -0.08, 0.06, 0.016, 0.03, 0.08, { front: ['gun_metal'] }, atlas, alpha);
    }
    if (side < 0 && (P.gun === 'long_aim' || P.gun === 'long_low')) {
      const w = look.weapon; const len = w === 'ks23' || w === 'shotgun' ? 0.42 : w === 'sawnoff' ? 0.22 : 0.3;
      const g = new Xf().set(hd).mulLocal(0, -0.06, 0, Math.PI / 2, 0, 0);
      box(geo, g, 0, len * 0.5, -0.02, 0.02, len, 0.035, { front: [w === 'aks74u' ? 'gun_metal' : 'gun_wood'] }, atlas, alpha);
      if (w === 'aks74u') box(geo, g, 0, 0.12, -0.08, 0.015, 0.05, 0.04, { front: ['gun_metal'] }, atlas, alpha); // магазин
    }
    if (side < 0 && (look.weapon === 'knife') && P.gun !== 'holster') box(geo, hd, 0, -0.1, 0.03, 0.005, 0.02, 0.09, { front: ['blade'] }, atlas, alpha);
    if (side < 0 && (look.weapon === 'bat')) { const g = new Xf().set(hd).mulLocal(0, -0.06, 0, 0.3, 0, 0); box(geo, g, 0, -0.35, 0, 0.025, 0.35, 0.025, { front: ['gun_wood'] }, atlas, alpha); }
    if (side < 0 && a.anim === 'smoke') box(geo, hd, 0.02, -0.1, 0.03, 0.006, 0.006, 0.03, { front: ['white'] }, atlas, alpha);
    if (side < 0 && a.anim === 'drink') box(geo, hd, 0, -0.09, 0.05, 0.03, 0.04, 0.03, { front: ['white', [0.85, 0.8, 0.7]] }, atlas, alpha);
    if (side < 0 && a.anim === 'phone') box(geo, hd, 0, -0.07, 0.03, 0.025, 0.08, 0.025, { front: ['gun_metal'] }, atlas, alpha);
    // предметы в руках по data.holding
    const hold = a.data?.holding;
    if (side < 0 && hold === 'mug' && a.anim !== 'drink') box(geo, hd, 0, -0.09, 0.05, 0.03, 0.04, 0.03, { front: ['white', [0.85, 0.8, 0.7]] }, atlas, alpha);
    if (side < 0 && hold === 'bottle') box(geo, hd, 0, -0.1, 0.05, 0.025, 0.09, 0.025, { front: ['white', [0.35, 0.45, 0.3]] }, atlas, alpha);
    if (side < 0 && hold === 'cigarette' && a.anim !== 'smoke') box(geo, hd, 0.02, -0.1, 0.03, 0.006, 0.006, 0.03, { front: ['white'] }, atlas, alpha);
    if (side < 0 && hold === 'papers' && !P.lie && a.anim !== 'sit') { const g = new Xf().set(hd).mulLocal(0, -0.09, 0.06, -0.35, 0, 0); box(geo, g, -0.12, 0, 0, 0.14, 0.004, 0.1, { front: ['white', [0.92, 0.9, 0.82]], top: ['white', [0.92, 0.9, 0.82]], side: ['white', [0.85, 0.82, 0.74]] }, atlas, alpha); }
  }
  // кобура / автомат за спиной
  if (P.gun === 'holster') box(geo, pelvis, -(L.pelvisW / 2 + 0.01), 0.0, 0.0, 0.02, 0.06, 0.05, { front: ['boots'] }, atlas, alpha);
  if (P.gun === 'back') { const g = new Xf().set(torso).mulLocal(0, L.torsoH * 0.5, -L.torsoD / 2 - 0.03, 0, 0, 0.6); box(geo, g, 0, 0, 0, 0.02, 0.3, 0.03, { front: ['gun_metal'] }, atlas, alpha); }
  // голова
  if (!opts.hideHead) {
    const head = new Xf().set(torso).mulLocal(0, L.torsoH + 0.03, 0.005, P.headRx, P.headRy, 0);
    const faceReg = look.hat === 'mask' ? 'mask' : (fem ? (look.old ? 'face_oldf' : 'face_f') : (look.old ? 'face_old' : 'face_m'));
    const faceT = look.hat === 'mask' ? W : skin;
    box(geo, head, 0, 0.05, 0, 0.045, 0.05, 0.045, { front: ['skin', skin] }, atlas, alpha); // шея
    box(geo, head, 0, 0.1 + L.headH / 2, 0, L.headW / 2, L.headH / 2, L.headD / 2,
      { front: [faceReg, faceT], back: [look.hat === 'mask' ? 'mask' : 'hair', look.hat === 'mask' ? W : hairC], side: [look.hat === 'mask' ? 'mask' : 'skin', look.hat === 'mask' ? W : skin], top: ['hair', look.hat === 'mask' ? [0.1, 0.1, 0.1] : hairC], bottom: ['skin', skin] }, atlas, alpha);
    const hy = 0.1 + L.headH;
    if (look.mustache && !fem && look.hat !== 'mask') box(geo, head, 0, 0.1 + L.headH * 0.33, L.headD / 2 + 0.006, 0.04, 0.012, 0.006, { front: ['mustache', hairC] }, atlas, alpha);
    if (look.glasses) box(geo, head, 0, 0.1 + L.headH * 0.56, L.headD / 2 + 0.008, L.headW / 2 * 0.9, 0.02, 0.004, { front: ['glasses'] }, atlas, alpha * 0.999);
    // волосы
    if (look.hat !== 'mask') {
      const hh = (look.hair === 4 && !fem) ? 0.012 : 0.03;
      box(geo, head, 0, hy - 0.02, -0.01, L.headW / 2 * 1.06, hh + 0.02, L.headD / 2 * 1.06, { front: ['hair', hairC], top: ['hair', hairC], side: ['hair', hairC], back: ['hair', hairC] }, atlas, alpha);
      if (fem) {
        const long = (look.hair | 0) % 2 === 0;
        if (long && look.hat !== 'cap' && look.hat !== 'helmet') box(geo, head, 0, hy - 0.16, -L.headD / 2 - 0.01, L.headW / 2 * 1.02, 0.16, 0.035, { front: ['hair', hairC], back: ['hair', hairC], side: ['hair', hairC] }, atlas, alpha);
        else box(geo, head, 0, hy - 0.08, -L.headD / 2 - 0.035, 0.045, 0.045, 0.04, { front: ['hair', hairC], back: ['hair', hairC], side: ['hair', hairC], top: ['hair', hairC] }, atlas, alpha); // пучок
      }
    }
    // головной убор
    if (look.hat === 'cap') {
      box(geo, head, 0, hy + 0.015, -0.005, L.headW / 2 * 1.12, 0.03, L.headD / 2 * 1.12, { front: ['cap_band'], back: ['cap_band'], side: ['cap_band'], top: ['cap_top'] }, atlas, alpha);
      box(geo, head, 0, hy + 0.06, -0.01, L.headW / 2 * 1.32, 0.022, L.headD / 2 * 1.34, { front: ['cap_top'], top: ['cap_top'], side: ['cap_top'], bottom: ['cap_top'] }, atlas, alpha);
      box(geo, head, 0, hy - 0.002, L.headD / 2 + 0.04, L.headW / 2 * 0.95, 0.008, 0.05, { front: ['visor'], top: ['visor'], bottom: ['visor'] }, atlas, alpha);
    } else if (look.hat === 'ushanka') box(geo, head, 0, hy + 0.02, -0.01, L.headW / 2 * 1.25, 0.07, L.headD / 2 * 1.2, { front: ['ushanka'], top: ['ushanka'], side: ['ushanka'], back: ['ushanka'] }, atlas, alpha);
    else if (look.hat === 'beanie') box(geo, head, 0, hy, -0.01, L.headW / 2 * 1.1, 0.06, L.headD / 2 * 1.1, { front: ['beanie'], top: ['beanie'], side: ['beanie'], back: ['beanie'] }, atlas, alpha, 0.6, 1);
    else if (look.hat === 'helmet') box(geo, head, 0, hy + 0.01, -0.01, L.headW / 2 * 1.25, 0.08, L.headD / 2 * 1.25, { front: ['helmet'], top: ['helmet'], side: ['helmet'], back: ['helmet'] }, atlas, alpha, 0.8, 1);
    else if (look.hat === 'scarf') box(geo, head, 0, hy - 0.06, -0.01, L.headW / 2 * 1.15, 0.1, L.headD / 2 * 1.15, { front: ['scarf'], top: ['scarf'], side: ['scarf'], back: ['scarf'] }, atlas, alpha);
  }
}
function hashCode(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

/** Высота глаз для персонажа в текущей позе (для камеры игрока/линии огня) */
export function eyeHeight(look, pose) {
  const f = look?.gender === 'f';
  if (pose === 'crouch') return f ? 1.0 : 1.05;
  if (pose === 'sit') return f ? 1.12 : 1.18;
  if (pose === 'lie') return 0.25;
  return f ? 1.6 : 1.68;
}
