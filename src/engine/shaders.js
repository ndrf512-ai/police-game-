export const NL = 14;

export const WORLD_VS = `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUV; layout(location=2) in vec4 aCol; layout(location=3) in vec3 aNrm; layout(location=4) in float aZone;
uniform mat4 uView, uProj, uModel;
uniform vec2 uSnap;
uniform vec3 uAmb, uAmbOut, uSky;
uniform vec4 uBld;
uniform vec4 uLp[${NL}];
uniform vec4 uLc[${NL}];
uniform int uNL;
uniform vec4 uSpot, uSpotDir;
uniform float uFlash, uFogNear, uFogFar, uZoneOverride, uFullbright;
out vec2 vUV; out vec3 vUVA; out vec4 vCol; out float vFog; out vec3 vWP;
void main(){
  vec4 wp = uModel * vec4(aPos, 1.0);
  vec3 n = normalize(mat3(uModel) * aNrm);
  int z = int((uZoneOverride >= 0.0 ? uZoneOverride : aZone) + 0.5);
  float outside = (wp.x < uBld.x || wp.x > uBld.z || wp.z < uBld.y || wp.z > uBld.w || wp.y > 3.05) ? 1.0 : 0.0;
  vec3 L = mix(uAmb, uAmbOut, outside) + outside * (uSky * (0.55 + 0.45 * max(n.y, 0.0)) + vec3(uFlash));
  for (int i = 0; i < ${NL}; i++) {
    if (i >= uNL) break;
    int mask = int(uLc[i].w + 0.5);
    if (((mask >> z) & 1) == 0) continue;
    vec3 d = uLp[i].xyz - wp.xyz; float dist = length(d);
    float att = clamp(1.0 - dist / uLp[i].w, 0.0, 1.0); att *= att;
    float ndl = dot(n, d / max(dist, 1e-3)) * 0.6 + 0.4;
    L += uLc[i].rgb * att * max(ndl, 0.0);
  }
  if (uSpot.w > 0.0) {
    vec3 d = wp.xyz - uSpot.xyz; float dist = length(d); vec3 dn = d / max(dist, 1e-3);
    float c = dot(dn, uSpotDir.xyz); float cone = smoothstep(uSpotDir.w, uSpotDir.w + 0.07, c);
    float att = clamp(1.0 - dist / 13.0, 0.0, 1.0);
    L += vec3(1.0, 0.94, 0.8) * uSpot.w * cone * att * att * (max(dot(n, -dn), 0.0) * 0.7 + 0.3);
  }
  float em = step(1.5, aCol.a);
  L = mix(L, vec3(1.0), max(em, uFullbright));
  vCol = vec4(aCol.rgb * L, aCol.a - 2.0 * em);
  vec4 vp = uView * wp;
  vFog = clamp((-vp.z - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  vec4 cp = uProj * vp;
  if (uSnap.x > 0.0 && cp.w > 0.05) { cp.xy = floor(cp.xy / cp.w * uSnap + 0.5) / uSnap * cp.w; }
  gl_Position = cp;
  vUV = aUV; vUVA = vec3(aUV * cp.w, cp.w); vWP = wp.xyz;
}`;

export const WORLD_FS = `#version 300 es
precision highp float;
in vec2 vUV; in vec3 vUVA; in vec4 vCol; in float vFog; in vec3 vWP;
uniform sampler2D uTex; uniform vec3 uFogCol; uniform float uAffine, uAlphaTest, uClipX, uClipSign; uniform vec2 uUVScroll;
out vec4 o;
void main(){
  if (uClipSign != 0.0 && (vWP.x - uClipX) * uClipSign < 0.0) discard;
  vec2 uv = mix(vUV, vUVA.xy / vUVA.z, uAffine) + uUVScroll;
  vec4 t = texture(uTex, uv);
  if (t.a < uAlphaTest) discard;
  vec3 c = t.rgb * vCol.rgb;
  c = mix(c, uFogCol, vFog);
  o = vec4(c, t.a * vCol.a);
}`;

// экран в мире, читающий текстуру по экранным координатам (зеркало) или по UV (ТВ, карта)
export const SCREEN_FS = `#version 300 es
precision highp float;
in vec2 vUV; in vec3 vUVA; in vec4 vCol; in float vFog; in vec3 vWP;
uniform sampler2D uTex; uniform vec3 uFogCol; uniform float uScreenSpace; uniform vec2 uTarget; uniform float uGlow;
out vec4 o;
void main(){
  vec2 uv = uScreenSpace > 0.5 ? vec2(gl_FragCoord.x / uTarget.x, gl_FragCoord.y / uTarget.y) : vUV;
  vec4 t = texture(uTex, uv);
  vec3 c = uScreenSpace > 0.5 ? t.rgb * 0.92 + vec3(0.02, 0.025, 0.03) : t.rgb * mix(vCol.rgb, vec3(1.0), uGlow);
  c = mix(c, uFogCol, vFog);
  o = vec4(c, 1.0);
}`;

export const POST_VS = `#version 300 es
layout(location=0) in vec3 aPos; out vec2 vUV;
void main(){ vUV = aPos.xy * 0.5 + 0.5; gl_Position = vec4(aPos.xy, 0.0, 1.0); }`;

export const POST_FS = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uTex; uniform vec2 uRes; uniform float uDither, uHurt, uFade, uWhite, uTime, uNight, uSuppress;
out vec4 o;
float bayer(vec2 p){ ivec2 i = ivec2(mod(p, 4.0)); int idx = i.x + i.y * 4;
  float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.); return m[idx] / 16.0 - 0.5; }
void main(){
  vec2 px = floor(vUV * uRes);
  vec3 c = texture(uTex, (px + 0.5) / uRes).rgb;
  // холодная мрачная цветокоррекция
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(l), 0.18 + uSuppress * 0.3);
  c *= vec3(0.96, 1.0, 1.04);
  c = pow(max(c, 0.0), vec3(1.05));
  // виньетка
  vec2 d = vUV - 0.5; c *= 1.0 - dot(d, d) * (0.9 + uSuppress * 1.4);
  // ранение
  c = mix(c, vec3(0.45, 0.02, 0.02), uHurt * (0.35 + 0.65 * dot(d, d) * 3.0));
  if (uDither > 0.5) { c = floor(c * 31.0 + 0.5 + bayer(px) * 0.9) / 31.0; }
  c = mix(c, vec3(1.0), uWhite);
  c *= (1.0 - uFade);
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
