// Тонкая обёртка WebGL2: шейдеры, меши, текстуры, фреймбуферы.

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  if (!gl) throw new Error('WebGL2 недоступен');
  return gl;
}

export function compile(gl, vsSrc, fsSrc, name = '') {
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      console.error(name, log, src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
      throw new Error('Shader ' + name + ': ' + log);
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vsSrc)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
  gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aUV'); gl.bindAttribLocation(p, 2, 'aCol'); gl.bindAttribLocation(p, 3, 'aNrm'); gl.bindAttribLocation(p, 4, 'aZone');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link ' + name + ': ' + gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); const nm = info.name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

/** Буфер геометрии: pos(3) uv(2) col(4) nrm(3) zone(1) = 13 float на вершину. zone — индекс помещения для маски света */
export const STRIDE = 13;

export class GeoBuilder {
  constructor(cap = 1024) { this.d = new Float32Array(cap * STRIDE); this.n = 0; this.zone = 0; }
  _grow() { const d = new Float32Array(this.d.length * 2); d.set(this.d); this.d = d; }
  v(x, y, z, u, v, r, g, b, a, nx, ny, nz) {
    if ((this.n + 1) * STRIDE > this.d.length) this._grow();
    const d = this.d, o = this.n * STRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = u; d[o + 4] = v; d[o + 5] = r; d[o + 6] = g; d[o + 7] = b; d[o + 8] = a; d[o + 9] = nx; d[o + 10] = ny; d[o + 11] = nz; d[o + 12] = this.zone;
    this.n++;
  }
  /** четырёхугольник p0..p3 (против часовой, если смотреть со стороны нормали), uv по углам */
  quad(p0, p1, p2, p3, uv, col, nrm) {
    const c = col || [1, 1, 1, 1]; const n = nrm || faceNormal(p0, p1, p2);
    const t = uv || [[0, 0], [1, 0], [1, 1], [0, 1]];
    const P = [p0, p1, p2, p0, p2, p3], T = [t[0], t[1], t[2], t[0], t[2], t[3]];
    for (let k = 0; k < 6; k++) this.v(P[k][0], P[k][1], P[k][2], T[k][0], T[k][1], c[0], c[1], c[2], c[3] ?? 1, n[0], n[1], n[2]);
  }
  tri(p0, p1, p2, t0, t1, t2, col) {
    const c = col || [1, 1, 1, 1]; const n = faceNormal(p0, p1, p2);
    this.v(p0[0], p0[1], p0[2], t0[0], t0[1], c[0], c[1], c[2], c[3] ?? 1, n[0], n[1], n[2]);
    this.v(p1[0], p1[1], p1[2], t1[0], t1[1], c[0], c[1], c[2], c[3] ?? 1, n[0], n[1], n[2]);
    this.v(p2[0], p2[1], p2[2], t2[0], t2[1], c[0], c[1], c[2], c[3] ?? 1, n[0], n[1], n[2]);
  }
  clear() { this.n = 0; }
  get data() { return this.d.subarray(0, this.n * STRIDE); }
}

export function faceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

export class Mesh {
  constructor(gl, data = null, dynamic = false) {
    this.gl = gl; this.vao = gl.createVertexArray(); this.buf = gl.createBuffer(); this.count = 0; this.dynamic = dynamic; this.cap = 0;
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const S = STRIDE * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, S, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, S, 20);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, S, 36);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, S, 48);
    gl.bindVertexArray(null);
    if (data) this.upload(data);
  }
  upload(data) {
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    if (this.dynamic && data.byteLength <= this.cap) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    else { gl.bufferData(gl.ARRAY_BUFFER, this.dynamic ? Math.max(data.byteLength, this.cap * 2, 65536) : data.byteLength, this.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW); gl.bufferSubData(gl.ARRAY_BUFFER, 0, data); this.cap = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE); }
    this.count = data.length / STRIDE;
  }
  draw(mode) { if (!this.count) return; const gl = this.gl; gl.bindVertexArray(this.vao); gl.drawArrays(mode ?? gl.TRIANGLES, 0, this.count); }
}

export function textureFromCanvas(gl, canvas, { repeat = true, mips = false } = {}) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.NEAREST_MIPMAP_NEAREST : gl.NEAREST);
  const w = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}
export function updateTexture(gl, tex, canvas) { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas); }

export class Target {
  constructor(gl, w, h) { this.gl = gl; this.fb = gl.createFramebuffer(); this.tex = gl.createTexture(); this.depth = gl.createRenderbuffer(); this.resize(w, h); }
  resize(w, h) {
    const gl = this.gl; this.w = w; this.h = h;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  bind() { const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb); gl.viewport(0, 0, this.w, this.h); }
}
