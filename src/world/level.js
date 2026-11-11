// Планировка отделения милиции. Чистые данные + построитель сетки.
// Единицы — метры. Y вверх. Сетка 0.5 м. Здание: x 0..32, z 0..20. Юг (z>20) — улица, север (z<0) — двор.
//
// Коды клеток:
//  ' ' пустота (за пределами карты, непроходимо)
//  '#' стена (непроходимо, непрозрачно)
//  'W' окно (непроходимо, прозрачно, простреливается — стекло бьётся)
//  'B' решётка (непроходимо, прозрачно, простреливается)
//  'b' решётчатая дверь камеры (проходима только если открыта: world.setCellDoor)
//  'D' дверной проём (проходимо)
//  '.' линолеум  ',' кафель  ':' бетон  '_' асфальт  '=' грунт двора  '-' тротуар/крыльцо
//  'F' забор (непроходимо, полупрозрачно — не простреливается)
//  'o' низкое препятствие (мебель: непроходимо, прозрачно, даёт укрытие)
//  'O' высокое препятствие (шкаф: непроходимо, непрозрачно)

export const CELL = 0.5;
export const ORIGIN = { x: -6, z: -8 };
export const GRID_W = 88; // x: -6..38
export const GRID_H = 76; // z: -8..30
export const WALL_H = 3.0;

export const ROOMS = [
  { id: 'office',    name: 'Кабинет начальника', rect: [0, 0, 7, 10],   floor: '.' },
  { id: 'opers',     name: 'Кабинет оперов',      rect: [7, 0, 13, 10],  floor: '.' },
  { id: 'armory',    name: 'Оружейная комната',   rect: [13, 0, 18, 10], floor: ':' },
  { id: 'ivs',       name: 'ИВС (камеры)',        rect: [18, 0, 27, 10], floor: ':' },
  { id: 'generator', name: 'Генераторная',        rect: [27, 0, 32, 10], floor: ':' },
  { id: 'corridor',  name: 'Коридор',             rect: [0, 10, 32, 14], floor: '.' },
  { id: 'toilet',    name: 'Туалет',              rect: [0, 14, 4, 20],  floor: ',' },
  { id: 'rest',      name: 'Комната отдыха',      rect: [4, 14, 10, 20], floor: '.' },
  { id: 'lobby',     name: 'Вестибюль',           rect: [10, 14, 22, 20], floor: ',' },
  { id: 'duty',      name: 'Дежурная часть',      rect: [22, 14, 32, 20], floor: '.' },
];
export const OUTDOOR = [
  { id: 'street', name: 'Улица у входа', rect: [-6, 20, 38, 30], floor: '_' },
  { id: 'yard',   name: 'Двор',          rect: [-1, -7, 32, 0],  floor: '=' },
  { id: 'alley',  name: 'Проезд',        rect: [32, -7, 38, 20], floor: '=' },
];

// Двери: [x0,z0,x1,z1] — прямоугольник, вырезаемый в стене. kind влияет на модель и баррикады.
export const DOORS = [
  { id: 'front',     rect: [15.5, 19.5, 17.0, 20.5], kind: 'front',  a: 'lobby',    b: 'street', name: 'Главный вход' },
  { id: 'back',      rect: [29.0, -0.5, 30.0, 0.5],  kind: 'steel',  a: 'generator', b: 'yard', name: 'Чёрный ход' },
  { id: 'd_office',  rect: [3.0, 9.5, 4.0, 10.5],    kind: 'wood',   a: 'office',   b: 'corridor', name: 'Дверь кабинета' },
  { id: 'd_opers',   rect: [9.5, 9.5, 10.5, 10.5],   kind: 'wood',   a: 'opers',    b: 'corridor', name: 'Дверь оперов' },
  { id: 'd_armory',  rect: [15.0, 9.5, 16.0, 10.5],  kind: 'steel',  a: 'armory',   b: 'corridor', name: 'Дверь оружейки' },
  { id: 'd_ivs',     rect: [19.0, 9.5, 20.0, 10.5],  kind: 'steel',  a: 'ivs',      b: 'corridor', name: 'Дверь ИВС' },
  { id: 'd_gen',     rect: [28.0, 9.5, 29.0, 10.5],  kind: 'steel',  a: 'generator', b: 'corridor', name: 'Дверь генераторной' },
  { id: 'd_toilet',  rect: [1.5, 13.5, 2.5, 14.5],   kind: 'wood',   a: 'toilet',   b: 'corridor', name: 'Дверь туалета' },
  { id: 'd_rest',    rect: [6.5, 13.5, 7.5, 14.5],   kind: 'wood',   a: 'rest',     b: 'corridor', name: 'Дверь комнаты отдыха' },
  { id: 'd_lobby',   rect: [12.0, 13.5, 20.0, 14.5], kind: 'arch',   a: 'lobby',    b: 'corridor', name: 'Проход в вестибюль' },
  { id: 'd_duty',    rect: [23.0, 13.5, 24.0, 14.5], kind: 'wood',   a: 'duty',     b: 'corridor', name: 'Дверь дежурки' },
  { id: 'yard_gate', rect: [31.5, -5.5, 32.5, -2.5], kind: 'gate',   a: 'yard',     b: 'alley', name: 'Ворота двора', outer: true },
];

// Окна: прямоугольники в стенах
export const WINDOWS = [
  [1.0, 19.5, 2.0, 20.5], [6.0, 19.5, 8.0, 20.5], [11.0, 19.5, 13.0, 20.5], [19.5, 19.5, 21.0, 20.5], [27.0, 19.5, 29.5, 20.5],
  [2.0, -0.5, 4.0, 0.5], [9.0, -0.5, 11.0, 0.5],
  [-0.5, 11.0, 0.5, 13.0], [31.5, 11.0, 32.5, 13.0],
  [21.5, 16.0, 22.5, 18.0], // окошко дежурного (вестибюль ↔ дежурка)
];

// Камеры ИВС: перегородки и решётки
export const CELLS = [
  { id: 'cell_1', rect: [18, 0, 21, 4.5], door: [19.0, 4.0, 20.0, 5.0] },
  { id: 'cell_2', rect: [21, 0, 24, 4.5], door: [22.0, 4.0, 23.0, 5.0] },
  { id: 'cell_3', rect: [24, 0, 27, 4.5], door: [25.0, 4.0, 26.0, 5.0] },
];

// Мебель/предметы. type → модель в рендере. block: 'o' низкое / 'O' высокое / null (не мешает).
// rect — занимаемая площадь (для препятствия), y — высота установки, rot — поворот (рад).
export const PROPS = [
  // Кабинет начальника
  { type: 'desk_big', x: 3.5, z: 3.0, rot: 0, rect: [2.2, 2.4, 4.8, 3.6], block: 'o' },
  { type: 'chair_office', x: 3.5, z: 2.0, rot: 0 },
  { type: 'chair', x: 3.0, z: 4.4, rot: Math.PI }, { type: 'chair', x: 4.0, z: 4.4, rot: Math.PI },
  { type: 'phone', x: 4.3, z: 2.9, y: 0.78 }, { type: 'lamp_desk', x: 2.6, z: 2.7, y: 0.78 },
  { type: 'papers', x: 3.4, z: 3.1, y: 0.78 },
  { type: 'file_cabinet', x: 6.05, z: 1.0, rot: -Math.PI / 2, rect: [5.7, 0.2, 6.4, 1.8], block: 'O' },
  { type: 'safe', x: 0.6, z: 8.2, rot: Math.PI / 2, rect: [0.2, 7.8, 1.0, 8.6], block: 'O' },
  { type: 'portrait', x: 3.5, z: 0.12, y: 1.9, rot: 0 },
  { type: 'org_chart', x: 1.5, z: 0.12, y: 1.6, rot: 0 },
  { type: 'flag', x: 0.4, z: 0.6 },
  { type: 'bookshelf', x: 0.35, z: 4.5, rot: Math.PI / 2, rect: [0.1, 3.5, 0.7, 5.5], block: 'O' },
  // стол секретаря (у восточной стены кабинета)
  { type: 'desk', x: 5.8, z: 6.6, rot: -Math.PI / 2, rect: [5.3, 5.8, 6.3, 7.4], block: 'o' },
  { type: 'chair_office', x: 6.55, z: 6.6, rot: -Math.PI / 2 },
  { type: 'typewriter', x: 5.75, z: 6.6, y: 0.77, rot: -Math.PI / 2 }, { type: 'papers', x: 5.8, z: 7.1, y: 0.77, rot: Math.PI / 2 }, { type: 'lamp_desk', x: 5.8, z: 6.0, y: 0.77 },
  { type: 'plant', x: 6.6, z: 9.4 }, { type: 'coat_rack', x: 0.5, z: 9.4 },
  { type: 'coat_rack', x: 6.1, z: 9.0 },
  // Опера
  { type: 'desk', x: 8.6, z: 2.2, rot: 0, rect: [7.8, 1.7, 9.4, 2.7], block: 'o' },
  { type: 'desk', x: 11.4, z: 2.2, rot: 0, rect: [10.6, 1.7, 12.2, 2.7], block: 'o' },
  { type: 'chair', x: 8.6, z: 1.4, rot: 0 }, { type: 'chair', x: 11.4, z: 1.4, rot: 0 },
  { type: 'typewriter', x: 8.4, z: 2.2, y: 0.78 }, { type: 'lamp_desk', x: 11.8, z: 2.0, y: 0.78 },
  { type: 'table_interrogation', x: 10.0, z: 6.5, rect: [9.3, 6.0, 10.7, 7.0], block: 'o' },
  { type: 'chair', x: 10.0, z: 5.6, rot: 0 }, { type: 'chair', x: 10.0, z: 7.4, rot: Math.PI },
  { type: 'lamp_hanging', x: 10.0, z: 6.5, y: 2.4 },
  { type: 'file_cabinet', x: 12.1, z: 8.5, rot: -Math.PI / 2, rect: [11.8, 7.7, 12.4, 9.3], block: 'O' },
  // Оружейка
  { type: 'gun_rack', x: 14.0, z: 0.5, rot: 0, rect: [13.2, 0.1, 17.8, 0.9], block: 'O' },
  { type: 'ammo_crates', x: 17.0, z: 3.5, rect: [16.6, 2.6, 17.4, 4.4], block: 'o' },
  { type: 'armory_counter', x: 15.5, z: 7.5, rot: 0, rect: [13.2, 7.2, 17.0, 7.8], block: 'o' },
  { type: 'vest_rack', x: 13.5, z: 4.0, rot: Math.PI / 2, rect: [13.1, 3.0, 13.9, 5.0], block: 'O' },
  // ИВС
  { type: 'bunk', x: 19.25, z: 0.6, rect: [18.3, 0.1, 20.2, 1.1], block: 'o' },
  { type: 'bunk', x: 22.25, z: 0.6, rect: [21.3, 0.1, 23.2, 1.1], block: 'o' },
  { type: 'bunk', x: 25.25, z: 0.6, rect: [24.3, 0.1, 26.2, 1.1], block: 'o' },
  { type: 'desk', x: 25.5, z: 8.6, rot: Math.PI, rect: [24.7, 8.1, 26.3, 9.1], block: 'o' },
  { type: 'chair', x: 25.5, z: 7.8, rot: 0 },
  // Генераторная
  { type: 'generator', x: 29.8, z: 4.0, rect: [28.6, 3.0, 31.0, 5.0], block: 'o' },
  { type: 'fusebox', x: 31.47, z: 8.0, y: 1.3, rot: -Math.PI / 2 },
  { type: 'barrels', x: 28.0, z: 1.0, rect: [27.4, 0.4, 28.8, 1.6], block: 'o' },
  { type: 'boiler', x: 30.9, z: 1.2, rect: [30.4, 0.3, 31.4, 2.0], block: 'O' },
  // Коридор
  { type: 'bench', x: 12.0, z: 10.4, rot: 0, rect: [11.0, 10.2, 13.0, 10.7], block: 'o' },
  { type: 'notice_board', x: 25.0, z: 10.12, y: 1.5, rot: 0 },
  { type: 'fire_ext', x: 0.3, z: 12.0, rot: Math.PI / 2 },
  { type: 'plant', x: 31.15, z: 13.5 },
  { type: 'water_cooler', x: 21.0, z: 10.4, rect: [20.7, 10.1, 21.3, 10.7], block: 'O' },
  // Туалет
  { type: 'sink', x: 0.35, z: 17.5, rot: Math.PI / 2 },
  { type: 'mirror', x: 0.12, z: 17.5, y: 1.55, rot: Math.PI / 2 },
  { type: 'toilet', x: 3.1, z: 19.0, rect: [2.8, 18.7, 3.4, 19.4], block: 'o' },
  { type: 'stall', x: 2.45, z: 18.45, rect: [2.3, 17.4, 2.6, 19.5], block: 'O' },
  // Комната отдыха
  { type: 'sofa', x: 6.5, z: 19.0, rot: Math.PI, rect: [5.2, 18.6, 7.8, 19.45], block: 'o' },
  { type: 'tv', x: 9.15, z: 17.5, y: 0.0, rot: -Math.PI / 2, rect: [8.85, 17.0, 9.45, 18.0], block: 'o' },
  { type: 'table_small', x: 5.0, z: 15.2, rect: [4.3, 14.7, 5.7, 15.7], block: 'o' },
  { type: 'kettle', x: 4.8, z: 15.1, y: 0.75 }, { type: 'mugs', x: 5.2, z: 15.3, y: 0.75 },
  { type: 'chair', x: 6.2, z: 15.3, rot: -Math.PI / 2 },
  { type: 'fridge', x: 4.4, z: 17.0, rect: [4.1, 16.5, 4.8, 17.5], block: 'O' },
  { type: 'armchair', x: 8.5, z: 15.4, rot: 0.3, rect: [8.1, 15.0, 8.9, 15.8], block: 'o' },
  { type: 'chess', x: 5.0, z: 15.3, y: 0.75, hidden: true },
  { type: 'calendar', x: 9.47, z: 15.5, y: 1.6, rot: -Math.PI / 2 },
  // Вестибюль
  { type: 'bench', x: 10.5, z: 16.5, rot: Math.PI / 2, rect: [10.2, 15.5, 10.8, 17.5], block: 'o' },
  { type: 'bench', x: 10.5, z: 18.6, rot: Math.PI / 2, rect: [10.2, 17.8, 10.8, 19.4], block: 'o' },
  { type: 'counter_window', x: 21.3, z: 17.0, rot: -Math.PI / 2 },
  { type: 'wanted_board', x: 21.47, z: 15.0, y: 1.6, rot: -Math.PI / 2 },
  { type: 'plant', x: 21.1, z: 19.1 },
  { type: 'lamp_ceiling_flicker', x: 16.0, z: 17.0, y: 2.95 },
  // Дежурная часть
  { type: 'duty_desk', x: 23.4, z: 17.0, rot: -Math.PI / 2, rect: [22.6, 15.6, 24.1, 18.4], block: 'o' },
  { type: 'chair_office', x: 24.6, z: 17.0, rot: -Math.PI / 2 },
  { type: 'radio_station', x: 23.3, z: 16.2, y: 0.8, rot: -Math.PI / 2 },
  { type: 'phone', x: 23.3, z: 17.8, y: 0.8 },
  { type: 'city_map', x: 31.47, z: 17.0, y: 1.6, rot: -Math.PI / 2 },
  { type: 'station_plan', x: 29.0, z: 14.12, y: 1.6, rot: 0 },
  { type: 'monitors', x: 26.5, z: 19.15, y: 0.78, rot: Math.PI },
  { type: 'desk', x: 26.5, z: 19.0, rot: Math.PI, rect: [25.7, 18.6, 27.3, 19.45], block: 'o' },
  { type: 'chair', x: 26.5, z: 18.2, rot: 0 },
  { type: 'key_box', x: 31.47, z: 15.0, y: 1.5, rot: -Math.PI / 2 },
  { type: 'kettle', x: 27.0, z: 19.1, y: 0.78 },
  // Улица
  { type: 'uaz', x: 11.0, z: 25.0, rot: 0, rect: [9.0, 24.1, 13.0, 25.9], block: 'O', id: 'uaz_1' },
  { type: 'uaz', x: 22.0, z: 25.0, rot: 0, rect: [20.0, 24.1, 24.0, 25.9], block: 'O', id: 'uaz_2' },
  { type: 'streetlamp', x: 14.0, z: 22.6 }, { type: 'streetlamp', x: 30.0, z: 22.6 },
  { type: 'kiosk', x: 4.0, z: 28.5, rect: [2.5, 27.5, 5.5, 29.5], block: 'O' },
  { type: 'bus_stop', x: 27.0, z: 28.6, rect: [25.5, 28.2, 28.5, 29.0], block: 'o' },
  { type: 'trash', x: 18.6, z: 21.0, rect: [18.3, 20.7, 18.9, 21.3], block: 'o' },
  { type: 'sign_station', x: 14.4, z: 20.03, y: 2.1, rot: 0 },
  { type: 'porch', x: 16.25, z: 21.0 },
  // Двор
  { type: 'dumpster', x: 2.0, z: -5.5, rect: [0.8, -6.3, 3.2, -4.7], block: 'o' },
  { type: 'wrecked_car', x: 14.0, z: -4.0, rect: [12.0, -5.0, 16.0, -3.0], block: 'o' },
  { type: 'fuel_tank', x: 25.0, z: -3.5, rect: [24.0, -4.5, 26.0, -2.5], block: 'o' },
  { type: 'yardlamp', x: 29.5, z: -0.6, y: 2.6 },
];

// Именованные точки. kind: seat/stand/use/post/spawn/smoke/sleep/visitor/cell
export const POINTS = {
  // служебные места
  commander_desk:  { x: 3.5, z: 2.0, yaw: 0, kind: 'seat', zone: 'office' },
  personnel_files: { x: 5.2, z: 1.0, yaw: Math.PI / 2, kind: 'use', zone: 'office' },
  org_chart:       { x: 1.5, z: 1.0, yaw: Math.PI, kind: 'use', zone: 'office' },
  secretary_desk:  { x: 6.55, z: 6.6, yaw: -Math.PI / 2, kind: 'seat', zone: 'office' },
  commander_desk_side: { x: 2.4, z: 4.2, yaw: 2.4, kind: 'stand', zone: 'office' },
  office_corner:   { x: 1.0, z: 9.0, yaw: 0.8, kind: 'stand', zone: 'office' },
  dept_ugro:       { x: 9.9, z: 4.0, yaw: Math.PI, kind: 'stand', zone: 'opers' },
  dept_pps:        { x: 14.0, z: 11.6, yaw: Math.PI, kind: 'stand', zone: 'corridor' },
  dept_uchastok:   { x: 23.0, z: 12.4, yaw: 0, kind: 'stand', zone: 'corridor' },
  dept_duty:       { x: 26.0, z: 16.2, yaw: -Math.PI / 2, kind: 'stand', zone: 'duty' },
  dept_ivs:        { x: 23.2, z: 7.4, yaw: Math.PI / 2, kind: 'stand', zone: 'ivs' },
  safe:            { x: 1.2, z: 8.2, yaw: -Math.PI / 2, kind: 'use', zone: 'office' },
  duty_desk:       { x: 24.6, z: 17.0, yaw: -Math.PI / 2, kind: 'seat', zone: 'duty' },
  radio:           { x: 24.4, z: 16.2, yaw: -Math.PI / 2, kind: 'use', zone: 'duty' },
  city_map:        { x: 31.0, z: 17.0, yaw: Math.PI / 2, kind: 'use', zone: 'duty' },
  station_plan:    { x: 29.0, z: 15.0, yaw: Math.PI, kind: 'use', zone: 'duty' },
  monitors:        { x: 26.5, z: 18.2, yaw: 0, kind: 'seat', zone: 'duty' },
  armory_counter:  { x: 15.5, z: 8.4, yaw: Math.PI, kind: 'use', zone: 'armory' },
  armory_clerk:    { x: 15.5, z: 6.6, yaw: 0, kind: 'stand', zone: 'armory' },
  interrogation:   { x: 10.0, z: 7.4, yaw: Math.PI, kind: 'seat', zone: 'opers' },
  interrogation_suspect: { x: 10.0, z: 5.6, yaw: 0, kind: 'seat', zone: 'opers' },
  opers_desk_1:    { x: 8.6, z: 1.4, yaw: 0, kind: 'seat', zone: 'opers' },
  opers_desk_2:    { x: 11.4, z: 1.4, yaw: 0, kind: 'seat', zone: 'opers' },
  ivs_guard:       { x: 25.5, z: 7.8, yaw: 0, kind: 'seat', zone: 'ivs' },
  cell_1:          { x: 19.5, z: 2.5, yaw: Math.PI, kind: 'cell', zone: 'ivs' },
  cell_2:          { x: 22.5, z: 2.5, yaw: Math.PI, kind: 'cell', zone: 'ivs' },
  cell_3:          { x: 25.5, z: 2.5, yaw: Math.PI, kind: 'cell', zone: 'ivs' },
  generator:       { x: 29.8, z: 5.6, yaw: Math.PI, kind: 'use', zone: 'generator' },
  fusebox:         { x: 30.9, z: 8.0, yaw: -Math.PI / 2, kind: 'use', zone: 'generator' },
  // быт
  tv_sofa_1:       { x: 5.9, z: 18.6, yaw: Math.PI, kind: 'seat', zone: 'rest' },
  tv_sofa_2:       { x: 7.1, z: 18.6, yaw: Math.PI, kind: 'seat', zone: 'rest' },
  tv_armchair:     { x: 8.5, z: 15.4, yaw: 0.3, kind: 'seat', zone: 'rest' },
  kettle:          { x: 5.0, z: 16.2, yaw: Math.PI, kind: 'use', zone: 'rest' },
  rest_chair:      { x: 6.2, z: 15.3, yaw: -Math.PI / 2, kind: 'seat', zone: 'rest' },
  fridge:          { x: 5.2, z: 17.0, yaw: -Math.PI / 2, kind: 'use', zone: 'rest' },
  sink_mirror:     { x: 1.3, z: 17.5, yaw: -Math.PI / 2, kind: 'use', zone: 'toilet' },
  toilet:          { x: 3.1, z: 18.4, yaw: 0, kind: 'use', zone: 'toilet' },
  water_cooler:    { x: 21.0, z: 11.0, yaw: Math.PI, kind: 'use', zone: 'corridor' },
  notice_board:    { x: 25.0, z: 10.8, yaw: Math.PI, kind: 'use', zone: 'corridor' },
  corridor_bench:  { x: 12.0, z: 10.6, yaw: 0, kind: 'seat', zone: 'corridor' },
  smoke_porch_1:   { x: 18.0, z: 21.6, yaw: 0, kind: 'smoke', zone: 'street' },
  smoke_porch_2:   { x: 14.5, z: 21.4, yaw: 0, kind: 'smoke', zone: 'street' },
  smoke_yard:      { x: 28.5, z: -1.5, yaw: 0, kind: 'smoke', zone: 'yard' },
  // посетители
  visitor_window:  { x: 21.0, z: 17.0, yaw: Math.PI / 2, kind: 'visitor', zone: 'lobby' },
  visitor_bench_1: { x: 11.0, z: 16.0, yaw: Math.PI / 2, kind: 'seat', zone: 'lobby' },
  visitor_bench_2: { x: 11.0, z: 17.0, yaw: Math.PI / 2, kind: 'seat', zone: 'lobby' },
  visitor_bench_3: { x: 11.0, z: 18.6, yaw: Math.PI / 2, kind: 'seat', zone: 'lobby' },
  visitor_bench_4: { x: 11.0, z: 19.0, yaw: Math.PI / 2, kind: 'seat', zone: 'lobby' },
  // входы и выезд
  front_door_in:   { x: 16.25, z: 19.0, yaw: Math.PI, kind: 'stand', zone: 'lobby' },
  front_door_out:  { x: 16.25, z: 21.2, yaw: 0, kind: 'stand', zone: 'street' },
  back_door_in:    { x: 29.5, z: 1.0, yaw: Math.PI, kind: 'stand', zone: 'generator' },
  back_door_out:   { x: 29.5, z: -1.0, yaw: 0, kind: 'stand', zone: 'yard' },
  uaz_1:           { x: 11.0, z: 23.4, yaw: 0, kind: 'vehicle', zone: 'street' },
  uaz_2:           { x: 22.0, z: 23.4, yaw: 0, kind: 'vehicle', zone: 'street' },
  // точки появления (для посетителей, нарядов, нападающих)
  spawn_street_w:  { x: -5.0, z: 27.0, yaw: Math.PI / 2, kind: 'spawn', zone: 'street' },
  spawn_street_e:  { x: 37.0, z: 27.0, yaw: -Math.PI / 2, kind: 'spawn', zone: 'street' },
  spawn_street_c:  { x: 16.0, z: 29.0, yaw: Math.PI, kind: 'spawn', zone: 'street' },
  spawn_yard_gate: { x: 35.0, z: -6.0, yaw: Math.PI, kind: 'spawn', zone: 'alley' },
  spawn_alley:     { x: 36.5, z: 10.0, yaw: -Math.PI / 2, kind: 'spawn', zone: 'alley' },
  // оборонительные посты (рекомендуемые)
  post_front_lobby:  { x: 13.0, z: 15.5, yaw: 0, kind: 'post', zone: 'lobby' },
  post_lobby_bench:  { x: 11.2, z: 15.0, yaw: Math.PI * 0.75, kind: 'post', zone: 'lobby' },
  post_duty_window:  { x: 23.0, z: 19.0, yaw: Math.PI, kind: 'post', zone: 'duty' },
  post_corridor_w:   { x: 2.0, z: 12.0, yaw: -Math.PI / 2, kind: 'post', zone: 'corridor' },
  post_corridor_c:   { x: 16.0, z: 11.0, yaw: Math.PI, kind: 'post', zone: 'corridor' },
  post_corridor_e:   { x: 30.5, z: 12.0, yaw: Math.PI / 2, kind: 'post', zone: 'corridor' },
  post_generator:    { x: 28.0, z: 6.0, yaw: 0, kind: 'post', zone: 'generator' },
  post_armory:       { x: 15.5, z: 6.0, yaw: Math.PI, kind: 'post', zone: 'armory' },
  post_ivs:          { x: 22.0, z: 7.0, yaw: Math.PI, kind: 'post', zone: 'ivs' },
  post_office:       { x: 3.5, z: 8.0, yaw: Math.PI, kind: 'post', zone: 'office' },
  post_rest_window:  { x: 7.0, z: 18.6, yaw: Math.PI, kind: 'post', zone: 'rest' },
  post_porch:        { x: 15.0, z: 21.2, yaw: Math.PI, kind: 'post', zone: 'street' },
  post_yard:         { x: 27.0, z: -2.0, yaw: Math.PI / 2, kind: 'post', zone: 'yard' },
  // старт игрока
  player_start:    { x: 3.5, z: 6.0, yaw: Math.PI, kind: 'stand', zone: 'office' },
};

// ——— построение сетки ———
export function buildGrid() {
  const g = Array.from({ length: GRID_H }, () => new Array(GRID_W).fill(' '));
  const toI = (x) => Math.round((x - ORIGIN.x) / CELL);
  const toJ = (z) => Math.round((z - ORIGIN.z) / CELL);
  // заполнить прямоугольник в метрах [x0,z0,x1,z1] (клетки, центры которых внутри)
  const fill = (r, ch, onlyIf = null) => {
    for (let j = 0; j < GRID_H; j++) for (let i = 0; i < GRID_W; i++) {
      const cx = ORIGIN.x + (i + 0.5) * CELL, cz = ORIGIN.z + (j + 0.5) * CELL;
      if (cx > r[0] && cx < r[2] && cz > r[1] && cz < r[3]) { if (!onlyIf || onlyIf.includes(g[j][i])) g[j][i] = ch; }
    }
  };
  // контур прямоугольника стенами толщиной 1 клетку (по линии границы, наружу на полклетки)
  // стена толщиной в одну клетку занимает полосу [линия-0.5, линия]
  const outline = (r, ch) => {
    const e = 0.01, t = CELL;
    fill([r[0] - t, r[1] - t, r[2] + e, r[1] - e], ch);
    fill([r[0] - t, r[3] - t, r[2] + e, r[3] - e], ch);
    fill([r[0] - t, r[1] - t, r[0] - e, r[3] + e], ch);
    fill([r[2] - t, r[1] - t, r[2] - e, r[3] + e], ch);
  };
  for (const o of OUTDOOR) fill(o.rect, o.floor);
  // тротуар/крыльцо вдоль фасада
  fill([-6, 20, 38, 23], '-');
  for (const r of ROOMS) fill(r.rect, r.floor);
  for (const r of ROOMS) outline(r.rect, '#');
  // заборы: северный (z=-7), западный (x=-1, до улицы), восточный край проезда (x=37.5),
  // и забор между двором и проездом (x=32) с воротами.
  const fh = CELL / 2 + 0.01;
  fill([-1 - fh, -7 - fh, 37.5 + fh, -7 + fh], 'F');
  fill([-1 - fh, -7 - fh, -1 + fh, 20.3], 'F');
  fill([37.5 - fh, -7 - fh, 37.5 + fh, 20.3], 'F');
  fill([32 - fh, -7 - fh, 32 + fh, 0], 'F');
  // камеры ИВС
  for (const c of CELLS) {
    fill([c.rect[2] - CELL, c.rect[1], c.rect[2] - 0.01, c.rect[3]], '#'); // перегородка справа
    fill([c.rect[0], c.rect[3] - CELL, c.rect[2], c.rect[3] - 0.01], 'B');  // решётка
    fill(c.door, 'b', ['B']);                                                 // решётчатая дверь камеры
  }
  // окна
  for (const w of WINDOWS) fill(w, 'W', ['#']);
  // двери
  for (const d of DOORS) fill(d.rect, 'D');
  // мебель
  for (const p of PROPS) if (p.block && p.rect) fill(p.rect, p.block, ['.', ',', ':', '_', '=', '-']);
  // край карты — непроходим
  for (let i = 0; i < GRID_W; i++) { g[0][i] = '#'; g[GRID_H - 1][i] = '#'; }
  for (let j = 0; j < GRID_H; j++) { g[j][0] = '#'; g[j][GRID_W - 1] = '#'; }
  return g;
}
