// Мини-интерпретаторы сценариев: Seq — последовательность шагов одного актора; Op — операция над несколькими акторами.

function dur(v, b) {
  if (typeof v === 'function') return v(b);
  if (Array.isArray(v)) return v[0] + (v[1] - v[0]) * (b && b.rng ? b.rng.next() : Math.random());
  return v ?? 1;
}

/**
 * Шаги:
 *  {go: target|fn, run, stand, stopDist, claim, optional, timeout} — дойти (target: id точки или {x,z,yaw})
 *  {wait: сек|[a,b]}            {do: fn(b, seq) → false = провал}
 *  {until: fn(b,dt,st) → true, timeout, fail}     {hold: сек|[a,b]|fn, start(b,st), tick(b,dt,st) → 'done'|'fail'}
 */
export class Seq {
  constructor(b, steps, o = {}) {
    this.b = b; this.steps = steps.filter(Boolean); this.i = 0; this.st = null; this.t = 0;
    this.id = o.id || 'job'; this.label = o.label || ''; this.def = o.def || null;
    this.locked = !!o.locked; this.onEnd = o.onEnd || null; this.kind = o.kind || 'act';
    this.phase = 'go';
  }
  get holding() { return this.phase === 'hold'; }
  update(dt) {
    this.t += dt;
    let n = 0;
    while (this.i < this.steps.length) {
      if (++n > 40) return 'run';
      const s = this.steps[this.i];
      if (!this.st) {
        this.st = { t: 0 };
        const r = this._enter(s);
        if (r === 'fail') return 'fail';
        if (r === 'next') { this._next(); continue; }
      }
      this.st.t += dt;
      const r = this._tick(s, dt);
      if (r === 'fail') return 'fail';
      if (r === 'next') { this._next(); continue; }
      return 'run';
    }
    return 'done';
  }
  _next() { this.i++; this.st = null; }
  _enter(s) {
    const b = this.b, st = this.st;
    if (s.go !== undefined) {
      this.phase = 'go';
      const target = typeof s.go === 'function' ? s.go(b, this) : s.go;
      if (!target) return s.optional ? 'next' : 'fail';
      st.target = target; st.arrived = false; st.failed = false;
      const p = typeof target === 'string' ? b.st.pt(target) : target;
      if (!p) return s.optional ? 'next' : 'fail';
      const d = Math.hypot(p.x - b.a.x, p.z - b.a.z);
      st.timeout = s.timeout ?? (d / Math.max(0.5, b.a.walkSpeed * (b.a.data.speedMul || 1)) * 2.2 + 12);
      st.opts = { run: s.run, stand: s.stand, stopDist: s.stopDist, claim: s.claim };
      b.st.go(b.a, target, st.opts, (ok) => { if (ok) st.arrived = true; else st.failed = true; });
      return 'stay';
    }
    if (s.wait !== undefined) { this.phase = 'wait'; st.dur = dur(s.wait, b); return 'stay'; }
    if (s.do) { const r = s.do(b, this); return r === false ? 'fail' : 'next'; }
    if (s.until) { this.phase = 'until'; return 'stay'; }
    if (s.hold !== undefined) { this.phase = 'hold'; st.dur = dur(s.hold, b); if (s.start) s.start(b, st); return 'stay'; }
    return 'next';
  }
  _tick(s, dt) {
    const b = this.b, st = this.st;
    if (s.go !== undefined) {
      if (st.arrived) return 'next';
      if (st.failed) return s.optional ? 'next' : 'fail';
      if (st.t > st.timeout) { b.st.teleport(b.a, st.target, st.opts); return 'next'; }
      return 'stay';
    }
    if (s.wait !== undefined) return st.t >= st.dur ? 'next' : 'stay';
    if (s.until) {
      if (s.until(b, dt, st)) return 'next';
      if (s.timeout && st.t > s.timeout) return s.fail ? 'fail' : 'next';
      return 'stay';
    }
    if (s.hold !== undefined) {
      if (s.tick) { const r = s.tick(b, dt, st); if (r === 'done') return 'next'; if (r === 'fail') return 'fail'; }
      return st.t >= st.dur ? 'next' : 'stay';
    }
    return 'next';
  }
  stop(reason) { if (this.onEnd) { const f = this.onEnd; this.onEnd = null; f(this.b, reason); } }
}

/**
 * Операция над несколькими акторами (конвой, допрос, освобождение).
 * Шаги: {move:[[actor, target, opts], ...], timeout} | {do: fn(op)} | {wait: сек} | {until: fn(op,dt), timeout}
 */
export class Op {
  constructor(st, steps, o = {}) {
    this.st = st; this.steps = steps.filter(Boolean); this.i = 0; this.s = null; this.t = 0;
    this.actors = o.actors || []; this.onDone = o.onDone || null; this.onAbort = o.onAbort || null;
    this.kind = o.kind || 'op'; this.finished = false; this.failed = false; this.data = o.data || {};
  }
  update(dt) {
    if (this.finished) return 'done';
    this.t += dt;
    if (this.actors.some((a) => !a.alive || !a.world)) return this._end(false);
    let n = 0;
    while (this.i < this.steps.length) {
      if (++n > 40) return 'run';
      const s = this.steps[this.i];
      if (!this.s) {
        this.s = { t: 0 };
        if (s.do) { const r = s.do(this); this._next(); if (r === false) return this._end(false); continue; }
        if (s.move) {
          const ss = this.s; ss.left = 0;
          for (const [a, target, opts] of s.move) {
            if (!a || !a.alive || !target) continue;
            ss.left++;
            this.st.go(a, target, opts || {}, () => { ss.left--; });
          }
        }
      }
      this.s.t += dt;
      let done = false;
      if (s.move) {
        done = this.s.left <= 0;
        if (!done && this.s.t > (s.timeout ?? 45)) {
          for (const [a, target, opts] of s.move) if (a && a.alive && target && (a.moving || this.st.pendingPath(a))) this.st.teleport(a, target, opts || {});
          done = true;
        }
      } else if (s.wait !== undefined) done = this.s.t >= s.wait;
      else if (s.until) done = s.until(this, dt) || (s.timeout && this.s.t > s.timeout);
      if (done) { this._next(); continue; }
      return 'run';
    }
    return this._end(true);
  }
  _next() { this.i++; this.s = null; }
  _end(ok) {
    if (this.finished) return ok ? 'done' : 'fail';
    this.finished = true; this.failed = !ok;
    if (ok && this.onDone) this.onDone(this);
    if (!ok && this.onAbort) this.onAbort(this);
    return ok ? 'done' : 'fail';
  }
  abort() { if (!this.finished) this._end(false); }
}
