// Небольшие помощники DOM и форматирования для интерфейса «Участка».
// Никаких зависимостей; всё, что касается игры, — в других файлах ui/.

let _sfx = null;
/** Установить обработчик звуков интерфейса (ui.js задаёт play('ui_click') и т.п.) */
export function setSfx(fn) { _sfx = fn; }
export function sfx(name) { try { _sfx && _sfx(name); } catch (e) { /* звук не обязателен */ } }

/**
 * h('div.cls1.cls2', {props}, ...children)
 * props: class, style (строка/объект), text, html, dataset, on<Event>, title, любые атрибуты.
 */
export function h(sel, props, ...kids) {
  let tag = 'div', id = null; const cls = [];
  const m = String(sel).match(/^[a-zA-Z0-9-]+/);
  if (m) tag = m[0];
  String(sel).replace(/([.#])([\w-]+)/g, (_, t, v) => { if (t === '.') cls.push(v); else id = v; return ''; });
  const el = document.createElement(tag);
  if (id) el.id = id;
  if (cls.length) el.className = cls.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = (el.className ? el.className + ' ' : '') + v;
      else if (k === 'style') { if (typeof v === 'string') el.style.cssText += v; else for (const s in v) { if (s.startsWith('--')) el.style.setProperty(s, v[s]); else el.style[s] = v[s]; } }
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  return el;
}
export function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false || k === true) continue;
    if (Array.isArray(k)) append(el, k);
    else if (k instanceof Node) el.appendChild(k);
    else el.appendChild(document.createTextNode(String(k)));
  }
  return el;
}
export function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; }

/** Кнопка с звуком щелчка. opts: {cls, disabled, title, id, sound} */
export function btn(label, onClick, opts = {}) {
  const b = h('button.btn' + (opts.cls ? '.' + opts.cls.split(' ').join('.') : ''), {
    type: 'button', disabled: !!opts.disabled, title: opts.title || null,
    'data-act': opts.act || null,
  }, label);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (b.disabled) return;
    sfx(opts.sound || 'ui_click');
    onClick && onClick(e);
  });
  return b;
}

/**
 * Сегментированный переключатель.
 * options: [{id,label,desc?,disabled?}], value, onChange(id), opts {small, wrap, act}
 */
export function seg(options, value, onChange, opts = {}) {
  const el = h('div.seg' + (opts.wrap ? '.wrap' : '') + (opts.small ? '.small' : ''), { 'data-act': opts.act || null });
  for (const o of options) {
    const b = h('button.seg-opt' + (String(o.id) === String(value) ? '.on' : ''), {
      type: 'button', disabled: !!o.disabled, 'data-v': String(o.id), title: o.desc || null,
    }, o.label);
    b.addEventListener('click', (e) => {
      e.stopPropagation(); if (b.disabled) return;
      sfx('ui_click');
      for (const c of el.children) c.classList.toggle('on', c === b);
      onChange && onChange(o.id, o);
    });
    el.appendChild(b);
  }
  return el;
}

/** Переключатель да/нет */
export function toggle(value, onChange, opts = {}) {
  const b = h('button.tgl' + (value ? '.on' : ''), { type: 'button', 'data-act': opts.act || null, 'aria-pressed': value ? 'true' : 'false' },
    h('span.tgl-track', h('span.tgl-knob')), h('span.tgl-lbl', value ? (opts.on || 'да') : (opts.off || 'нет')));
  b.addEventListener('click', (e) => {
    e.stopPropagation(); sfx('ui_click');
    value = !value; b.classList.toggle('on', value); b.setAttribute('aria-pressed', value ? 'true' : 'false');
    b.querySelector('.tgl-lbl').textContent = value ? (opts.on || 'да') : (opts.off || 'нет');
    onChange && onChange(value);
  });
  return b;
}

/** Полоска значения 0..100. kind: good (выше — лучше) | bad (выше — хуже) */
export function bar(value, kind = 'good', label = null, opts = {}) {
  const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const q = kind === 'bad' ? 100 - v : v;
  const tone = q >= 60 ? 'ok' : q >= 35 ? 'mid' : 'low';
  return h('div.bar.' + tone + (opts.thin ? '.thin' : ''), { title: label ? `${label}: ${v}` : null },
    label ? h('span.bar-l', label) : null,
    h('span.bar-t', h('i', { style: { width: v + '%' } })),
    opts.num === false ? null : h('span.bar-n', String(v)));
}

/** Поле-строка «Метка ........ значение» для бланков */
export function field(label, value, cls = '') {
  return h('div.fld' + (cls ? '.' + cls : ''), h('span.fld-l', label), h('span.fld-v', value ?? '—'));
}

export function stamp(text, opts = {}) {
  return h('div.stamp' + (opts.violet ? '.violet' : '') + (opts.cls ? '.' + opts.cls : ''), {
    style: { transform: `rotate(${opts.rot ?? -8}deg)`, ...(opts.style || {}) },
  }, text);
}

export const PAPERCLIP_SVG = `<svg viewBox="0 0 24 64" width="100%" height="100%" aria-hidden="true"><path d="M8 6 v40 a6 6 0 0 0 12 0 V12 a9 9 0 0 0 -18 0 v38 a4 4 0 0 0 8 0 V16" fill="none" stroke="#8d949a" stroke-width="2.4" stroke-linecap="round"/><path d="M8 6 v40 a6 6 0 0 0 12 0 V12 a9 9 0 0 0 -18 0 v38 a4 4 0 0 0 8 0 V16" fill="none" stroke="#e8edf0" stroke-width="0.8" stroke-linecap="round" opacity=".7" transform="translate(-0.6,-0.4)"/></svg>`;
export function paperclip(cls = '') { return h('div.clip' + (cls ? '.' + cls : ''), { html: PAPERCLIP_SVG }); }

// ——— форматирование ———
export function pad2(n) { return String(n).padStart(2, '0'); }
export function hhmm(minute) { const m = ((Math.round(minute) % 1440) + 1440) % 1440; return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }

/** plural(5, ['день','дня','дней']) → 'дней' */
export function plural(n, forms) {
  const a = Math.abs(Math.trunc(n)) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
export function pn(n, forms) { return `${fmtNum(n)} ${plural(n, forms)}`; }

/** 12500 → «12 500» (неразрывный узкий пробел) */
export function fmtNum(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const neg = n < 0; const s = Math.abs(Math.round(n)).toString();
  return (neg ? '−' : '') + s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
export function money(n) { return `${fmtNum(n)} тыс. руб.`; }
export function signed(n) { const v = Math.round(n); return (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v); }

/** Длительность в минутах → «2 ч 30 мин» */
export function dur(min) {
  min = Math.max(0, Math.round(min || 0));
  const hh = Math.floor(min / 60), mm = min % 60;
  if (!hh) return `${mm} мин`;
  if (!mm) return `${hh} ч`;
  return `${hh} ч ${mm} мин`;
}

// Календарь: Д1 = понедельник, 14 октября 1996 г.
export const WEEKDAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const START = { y: 1996, m: 9, d: 14 };
export function calDate(day) {
  const d = new Date(Date.UTC(START.y, START.m, START.d + (day - 1)));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: ((day - 1) % 7 + 7) % 7 };
}
export function weekday(day) { return WEEKDAYS[calDate(day).wd]; }
export function dateStr(day) { const c = calDate(day); return `${c.d} ${MONTHS_GEN[c.m]} ${c.y} г.`; }
export function dateShort(day) { const c = calDate(day); return `${pad2(c.d)}.${pad2(c.m + 1)}.${String(c.y).slice(2)}`; }

/** Абсолютные минуты от начала игры */
export function absMin(t) { return t ? ((t.day || 1) - 1) * 1440 + (t.minute || 0) : 0; }

export function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/** Детерминированный хеш строки → uint32 */
export function hashStr(s) {
  let h1 = 2166136261 >>> 0; s = String(s);
  for (let i = 0; i < s.length; i++) { h1 ^= s.charCodeAt(i); h1 = Math.imul(h1, 16777619) >>> 0; }
  return h1 >>> 0;
}

/** Сохранить/восстановить прокрутку всех [data-scroll] внутри el между перерисовками */
export function saveScroll(el) {
  const m = {}; if (!el) return m;
  el.querySelectorAll('[data-scroll]').forEach((s) => { m[s.dataset.scroll] = [s.scrollTop, s.scrollLeft]; });
  return m;
}
export function restoreScroll(el, m) {
  if (!el || !m) return;
  el.querySelectorAll('[data-scroll]').forEach((s) => { const v = m[s.dataset.scroll]; if (v) { s.scrollTop = v[0]; s.scrollLeft = v[1]; } });
}

/** Безопасный вызов функции модуля: call(obj, 'fn', ...args) → результат | undefined */
export function call(obj, fn, ...args) {
  try { if (obj && typeof obj[fn] === 'function') return obj[fn](...args); }
  catch (e) { console.error('[ui] ошибка вызова', fn, e); return { ok: false, reason: 'Ошибка: ' + (e.message || e), error: true }; }
  return undefined;
}

/** Текст из строки или объекта {text}|{title}|{name} */
export function txt(x) {
  if (x == null) return '';
  if (typeof x === 'string' || typeof x === 'number') return String(x);
  return x.text ?? x.title ?? x.name ?? x.label ?? '';
}
