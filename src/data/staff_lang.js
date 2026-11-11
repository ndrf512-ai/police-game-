// Языковые помощники агента B2: род, падежи фамилий/званий, шаблоны, календарь 1996–1997.
//
// Шаблоны (fmt):
//   {м|ж}  — по роду субъекта ctx.s (сотрудник/задержанный, о ком речь)
//   [м|ж]  — по роду второго лица ctx.o
//   <м|ж>  — по роду командира ctx.p (state.player)
//   %s.dn%     — «ст. сержант Петров»; падеж через суффикс: %s.dn_d% → «ст. сержанту Петрову»
//   %s.last%   — фамилия (падежи: _g _d _a _i _p), %s.first% — имя, %s.io% — имя-отчество,
//   %s.fio%    — Фамилия Имя Отчество, %s.short% — «Петров С. И.», %s.nick% — как зовут в отделе,
//   %s.rank%   — звание (с падежом: %s.rank_d%), %s.role% — должность
//   %var%      — ctx.vars.var
// Те же ключи для o. и p. (командир: %p.last%, %p.rank%).

export function G(person, m, f) { return person && person.gender === 'f' ? f : m; }
export function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

// ---------- Склонение фамилий ----------
const ADJ_END = { g: 'ого', d: 'ому', a: 'ого', p: 'ом' };
export function declSurname(s, gender, c = 'n') {
  if (!s || c === 'n') return s;
  if (gender === 'f') {
    if (/(ова|ева|ёва|ина|ына)$/.test(s)) return c === 'a' ? s.slice(0, -1) + 'у' : s.slice(0, -1) + 'ой';
    if (/ая$/.test(s)) return c === 'a' ? s.slice(0, -2) + 'ую' : s.slice(0, -2) + 'ой';
    return s; // -енко, -ук, -ых и т.п. — женские не склоняются
  }
  if (/(ых|их|ко|аго|яго)$/.test(s)) return s;
  if (/(ов|ев|ёв|ин|ын)$/.test(s)) return s + { g: 'а', d: 'у', a: 'а', i: 'ым', p: 'е' }[c];
  if (/(ий|ый|ой)$/.test(s)) {
    const stem = s.slice(0, -2);
    if (c === 'i') return stem + (/[кгхжшчщ]$/.test(stem) ? 'им' : 'ым');
    return stem + ADJ_END[c];
  }
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(s)) {
    if (c === 'i') return s + (/[жшчщц]$/.test(s) ? 'ем' : 'ом');
    return s + { g: 'а', d: 'у', a: 'а', p: 'е' }[c];
  }
  return s;
}

// ---------- Склонение имён (для писем и обращений) ----------
export function declFirst(n, gender, c = 'n') {
  if (!n || c === 'n') return n;
  if (gender === 'f') {
    if (n === 'Любовь') return { g: 'Любови', d: 'Любови', a: 'Любовь', i: 'Любовью', p: 'Любови' }[c];
    if (/ия$/.test(n)) return n.slice(0, -1) + { g: 'и', d: 'и', a: 'ю', i: 'ей', p: 'и' }[c];
    if (/ья$/.test(n) || /я$/.test(n)) return n.slice(0, -1) + { g: 'и', d: 'е', a: 'ю', i: 'ей', p: 'е' }[c];
    if (/а$/.test(n)) {
      const st = n.slice(0, -1);
      const soft = /[гкхжшчщ]$/.test(st);
      return st + { g: soft ? 'и' : 'ы', d: 'е', a: 'у', i: /[жшчщц]$/.test(st) ? 'ей' : 'ой', p: 'е' }[c];
    }
    return n;
  }
  const special = { 'Лев': 'Льв', 'Павел': 'Павл', 'Пётр': 'Петр' };
  if (special[n]) return special[n] + { g: 'а', d: 'у', a: 'а', i: 'ом', p: 'е' }[c];
  if (n === 'Илья') return { g: 'Ильи', d: 'Илье', a: 'Илью', i: 'Ильёй', p: 'Илье' }[c];
  if (/ий$/.test(n)) return n.slice(0, -1) + { g: 'я', d: 'ю', a: 'я', i: 'ем', p: 'и' }[c];
  if (/й$/.test(n)) return n.slice(0, -1) + { g: 'я', d: 'ю', a: 'я', i: 'ем', p: 'е' }[c];
  if (/ь$/.test(n)) return n.slice(0, -1) + { g: 'я', d: 'ю', a: 'я', i: 'ем', p: 'е' }[c];
  return n + { g: 'а', d: 'у', a: 'а', i: 'ом', p: 'е' }[c];
}
export function declPatronymic(p, gender, c = 'n') {
  if (!p || c === 'n') return p;
  if (gender === 'f') {
    const st = p.slice(0, -1);
    return st + { g: 'ы', d: 'е', a: 'у', i: 'ой', p: 'е' }[c];
  }
  return p + { g: 'а', d: 'у', a: 'а', i: 'ем', p: 'е' }[c]; // все мужские отчества на -ич
}

// ---------- Звания ----------
const RANK_NOUN = {
  'рядовой': { g: 'рядового', d: 'рядовому', a: 'рядового', i: 'рядовым', p: 'рядовом' },
  'сержант': { g: 'сержанта', d: 'сержанту', a: 'сержанта', i: 'сержантом', p: 'сержанте' },
  'старшина': { g: 'старшины', d: 'старшине', a: 'старшину', i: 'старшиной', p: 'старшине' },
  'прапорщик': { g: 'прапорщика', d: 'прапорщику', a: 'прапорщика', i: 'прапорщиком', p: 'прапорщике' },
  'лейтенант': { g: 'лейтенанта', d: 'лейтенанту', a: 'лейтенанта', i: 'лейтенантом', p: 'лейтенанте' },
  'капитан': { g: 'капитана', d: 'капитану', a: 'капитана', i: 'капитаном', p: 'капитане' },
  'майор': { g: 'майора', d: 'майору', a: 'майора', i: 'майором', p: 'майоре' },
  'подполковник': { g: 'подполковника', d: 'подполковнику', a: 'подполковника', i: 'подполковником', p: 'подполковнике' },
  'полковник': { g: 'полковника', d: 'полковнику', a: 'полковника', i: 'полковником', p: 'полковнике' },
};
const RANK_ADJ = {
  'младший': { g: 'младшего', d: 'младшему', a: 'младшего', i: 'младшим', p: 'младшем' },
  'старший': { g: 'старшего', d: 'старшему', a: 'старшего', i: 'старшим', p: 'старшем' },
};
/** «старший сержант» → падеж; работает и с сокращениями «ст. сержант», и с хвостом «милиции» */
export function rankCase(rank, c = 'n') {
  if (!rank || c === 'n') return rank;
  return rank.split(' ').map((w) => (RANK_NOUN[w] ? RANK_NOUN[w][c] : RANK_ADJ[w] ? RANK_ADJ[w][c] : w)).join(' ');
}
export function shortRank(rank) {
  return rank.replace(/^младший /, 'мл. ').replace(/^старший /, 'ст. ');
}

// ---------- Местоимения ----------
const PRON = {
  m: { n: 'он', g: 'его', d: 'ему', a: 'его', i: 'им', p: 'нём' },
  f: { n: 'она', g: 'её', d: 'ей', a: 'её', i: 'ей', p: 'ней' },
};
export function pron(person, c = 'n') { return PRON[person && person.gender === 'f' ? 'f' : 'm'][c]; }

// ---------- Шаблоны ----------
function resolveKey(person, key) {
  if (!person) return '';
  const [base, c = 'n'] = key.split('_');
  const g = person.gender;
  switch (base) {
    case 'last': return declSurname(person.lastName, g, c);
    case 'first': return declFirst(person.firstName, g, c);
    case 'io': return declFirst(person.firstName, g, c) + ' ' + declPatronymic(person.patronymic, g, c);
    case 'fio': return declSurname(person.lastName, g, c) + ' ' + declFirst(person.firstName, g, c) + ' ' + declPatronymic(person.patronymic, g, c);
    case 'short': return `${declSurname(person.lastName, g, c)} ${person.firstName[0]}. ${person.patronymic[0]}.`;
    case 'nick': return person.nick || person.firstName;
    case 'rank': return rankCase(shortRank(person.rank || ''), c);
    case 'rankfull': return rankCase(person.rank || '', c);
    case 'dn': return (person.rank ? rankCase(shortRank(person.rank), c) + ' ' : '') + declSurname(person.lastName, g, c);
    case 'role': return person.roleName || '';
    case 'he': return pron(person, c);
    default: return person[base] != null ? String(person[base]) : '';
  }
}
export function fmt(str, ctx = {}) {
  if (!str) return '';
  return String(str)
    .replace(/\{([^{}|]*)\|([^{}]*)\}/g, (_, m, f) => G(ctx.s, m, f))
    .replace(/\[([^\[\]|]*)\|([^\[\]]*)\]/g, (_, m, f) => G(ctx.o, m, f))
    .replace(/<([^<>|]*)\|([^<>]*)>/g, (_, m, f) => G(ctx.p, m, f))
    .replace(/%([sopx])\.([a-z]+(?:_[ngdaip])?)%/g, (_, who, key) => resolveKey(ctx[who], key))
    .replace(/%([a-zA-Z0-9]+)%/g, (all, key) => (ctx.vars && ctx.vars[key] != null ? String(ctx.vars[key]) : all));
}
/** Выбрать вариант из массива и отформатировать */
export function pf(rng, arr, ctx) { return fmt(rng.pick(arr), ctx); }

// ---------- Числительные ----------
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
export function nWord(n, one, few, many) { return `${n} ${plural(n, one, few, many)}`; }
export function money(n) {
  n = Math.round(n);
  if (Math.abs(n) >= 1000) {
    const mln = n / 1000;
    const s = (Math.round(mln * 10) / 10).toString().replace('.', ',');
    return `${s} млн руб.`;
  }
  return `${n} тыс. руб.`;
}
const NUM_WORDS = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять', 'одиннадцать', 'двенадцать'];
export function numWord(n) { return NUM_WORDS[n] ?? String(n); }

// ---------- Календарь ----------
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const WEEKDAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
export const START_DATE = { y: 1996, m: 10, d: 7 }; // понедельник, 7 октября 1996

function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
function dim(y, m) { return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }
function weekdayOf(y, m, d) { // 0 = понедельник
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  let yy = y; if (m < 3) yy -= 1;
  const w = (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + t[m - 1] + d) % 7; // 0 = воскресенье
  return (w + 6) % 7;
}
/** Игровой день → календарная дата */
export function calendar(day, start = START_DATE) {
  let y = start.y, m = start.m, d = start.d + (Math.max(1, day) - 1);
  while (d > dim(y, m)) { d -= dim(y, m); m++; if (m > 12) { m = 1; y++; } }
  const wd = weekdayOf(y, m, d);
  return { y, m, d, weekday: wd, weekdayName: WEEKDAYS[wd], weekend: wd >= 5, text: `${d} ${MONTHS_GEN[m - 1]} ${y}`, long: `${WEEKDAYS[wd]}, ${d} ${MONTHS_GEN[m - 1]} ${y} г.` };
}
/** Игровой день, на который приходится дата (может быть ≤ 0, если дата раньше старта) */
export function dayOfDate(m, d, y, start = START_DATE) {
  const toN = (yy, mm, dd) => { let n = dd; for (let i = 1; i < mm; i++) n += dim(yy, i); for (let k = 1990; k < yy; k++) n += isLeap(k) ? 366 : 365; return n; };
  return toN(y, m, d) - toN(start.y, start.m, start.d) + 1;
}
export function absMin(t) { return (t.day - 1) * 1440 + t.minute; }
export function clockStr(minute) { const h = Math.floor(minute / 60) % 24, mm = Math.floor(minute % 60); return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; }
