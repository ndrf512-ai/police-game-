// Шина событий. Все подсистемы общаются через неё, не импортируя друг друга напрямую.
export class Bus {
  constructor() { this.h = new Map(); }
  on(ev, fn) {
    if (!this.h.has(ev)) this.h.set(ev, new Set());
    this.h.get(ev).add(fn);
    return () => this.h.get(ev)?.delete(fn);
  }
  once(ev, fn) { const off = this.on(ev, (p) => { off(); fn(p); }); return off; }
  emit(ev, payload) {
    const set = this.h.get(ev);
    if (set) for (const fn of [...set]) { try { fn(payload); } catch (e) { console.error('[bus]', ev, e); } }
    const any = this.h.get('*');
    if (any) for (const fn of [...any]) { try { fn({ ev, payload }); } catch (e) { console.error(e); } }
  }
}
