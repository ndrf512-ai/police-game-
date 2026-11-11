// Минимальная линейная алгебра (column-major, как в WebGL).
export const mat4 = {
  create() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  identity(m) { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  perspective(out, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    out.fill(0); out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1; out[14] = 2 * far * near * nf; return out;
  },
  multiply(out, a, b) {
    const r = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      r[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
    }
    out.set(r); return out;
  },
  /** вид FPS-камеры: позиция, рыскание (yaw вокруг Y; yaw=0 смотрит в +Z), тангаж */
  fpsView(out, x, y, z, yaw, pitch) {
    // направление взгляда
    const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
    const fx = sy * cp, fy = sp, fz = cy * cp; // forward
    // right = forward × up  (up=(0,1,0)) → (-fz, 0, fx) нормированный
    let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    // up = right × forward
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
    out[0] = rx; out[4] = 0; out[8] = rz; out[12] = -(rx * x + rz * z);
    out[1] = ux; out[5] = uy; out[9] = uz; out[13] = -(ux * x + uy * y + uz * z);
    out[2] = -fx; out[6] = -fy; out[10] = -fz; out[14] = (fx * x + fy * y + fz * z);
    out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
    return out;
  },
  translate(out, x, y, z) { mat4.identity(out); out[12] = x; out[13] = y; out[14] = z; return out; },
  /** TRS: перенос + поворот Y + масштаб */
  trsY(out, x, y, z, rotY, s = 1) {
    const c = Math.cos(rotY) * s, sn = Math.sin(rotY) * s;
    out.fill(0); out[0] = c; out[2] = -sn; out[5] = s; out[8] = sn; out[10] = c; out[12] = x; out[13] = y; out[14] = z; out[15] = 1; return out;
  },
  /** зеркальное отражение относительно плоскости x = px (для зеркала в туалете) */
  reflectX(out, px) { mat4.identity(out); out[0] = -1; out[12] = 2 * px; return out; },
  reflectZ(out, pz) { mat4.identity(out); out[10] = -1; out[14] = 2 * pz; return out; },
};

/** Компактная 3x4 матрица для CPU-скиннинга персонажей */
export class Xf {
  constructor() { this.m = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]); } // rot(3x3 col-major) + t
  set(o) { this.m.set(o.m); return this; }
  identity() { this.m.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]); return this; }
  /** this = this * (translate(tx,ty,tz) * rotY(ry) * rotX(rx) * rotZ(rz)) */
  mulLocal(tx, ty, tz, rx = 0, ry = 0, rz = 0) {
    const m = this.m;
    // локальная матрица R = Ry * Rx * Rz
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    // Rx*Rz
    const a00 = cz, a01 = -sz, a02 = 0;
    const a10 = cx * sz, a11 = cx * cz, a12 = -sx;
    const a20 = sx * sz, a21 = sx * cz, a22 = cx;
    // Ry * (Rx*Rz)
    const r00 = cy * a00 + sy * a20, r01 = cy * a01 + sy * a21, r02 = cy * a02 + sy * a22;
    const r10 = a10, r11 = a11, r12 = a12;
    const r20 = -sy * a00 + cy * a20, r21 = -sy * a01 + cy * a21, r22 = -sy * a02 + cy * a22;
    // новая трансляция = m.R * t + m.t
    const nt0 = m[0] * tx + m[3] * ty + m[6] * tz + m[9];
    const nt1 = m[1] * tx + m[4] * ty + m[7] * tz + m[10];
    const nt2 = m[2] * tx + m[5] * ty + m[8] * tz + m[11];
    // новая R = m.R * r  (m.R col-major: столбцы (m0,m1,m2),(m3,m4,m5),(m6,m7,m8))
    const c0x = m[0] * r00 + m[3] * r10 + m[6] * r20, c0y = m[1] * r00 + m[4] * r10 + m[7] * r20, c0z = m[2] * r00 + m[5] * r10 + m[8] * r20;
    const c1x = m[0] * r01 + m[3] * r11 + m[6] * r21, c1y = m[1] * r01 + m[4] * r11 + m[7] * r21, c1z = m[2] * r01 + m[5] * r11 + m[8] * r21;
    const c2x = m[0] * r02 + m[3] * r12 + m[6] * r22, c2y = m[1] * r02 + m[4] * r12 + m[7] * r22, c2z = m[2] * r02 + m[5] * r12 + m[8] * r22;
    m[0] = c0x; m[1] = c0y; m[2] = c0z; m[3] = c1x; m[4] = c1y; m[5] = c1z; m[6] = c2x; m[7] = c2y; m[8] = c2z;
    m[9] = nt0; m[10] = nt1; m[11] = nt2;
    return this;
  }
  apply(x, y, z, out, o = 0) {
    const m = this.m;
    out[o] = m[0] * x + m[3] * y + m[6] * z + m[9];
    out[o + 1] = m[1] * x + m[4] * y + m[7] * z + m[10];
    out[o + 2] = m[2] * x + m[5] * y + m[8] * z + m[11];
  }
  applyN(x, y, z, out, o = 0) {
    const m = this.m;
    out[o] = m[0] * x + m[3] * y + m[6] * z; out[o + 1] = m[1] * x + m[4] * y + m[7] * z; out[o + 2] = m[2] * x + m[5] * y + m[8] * z;
  }
}
