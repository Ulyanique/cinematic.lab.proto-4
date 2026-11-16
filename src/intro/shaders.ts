import * as THREE from "three";

// ─────────────────────── глобальные uniform'ы ───────────────────────
export const G = {
  uTime: { value: 0 },
  uEdge: { value: 1 },
  uCharge: { value: 0 },
  uShockR: { value: 0 },
  uShockA: { value: 0 },
};

export const NOISE = /* glsl */ `
float gHash21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float gNoise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  float a=gHash21(i), b=gHash21(i+vec2(1.,0.)), c=gHash21(i+vec2(0.,1.)), d=gHash21(i+vec2(1.,1.));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
float gFbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*gNoise(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
// периодический шум по X (без шва на 360°)
float gNoiseP(vec2 p, float per){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  float x0=mod(i.x,per), x1=mod(i.x+1.,per);
  float a=gHash21(vec2(x0,i.y)), b=gHash21(vec2(x1,i.y)), c=gHash21(vec2(x0,i.y+1.)), d=gHash21(vec2(x1,i.y+1.));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
float gFbmP(vec2 p, float per){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*gNoiseP(p,per); p=p*2.+vec2(0.,3.1); per*=2.; a*=.5; } return s; }
`;

// ───────────────── золотой PBR-материал с светящимися рёбрами ─────────────────
export type GoldKind = "terrain" | "struct" | "sink";

export function makeGold(
  kind: GoldKind,
  env: THREE.Texture,
  opts: { baseGlow?: number; roughness?: number; color?: number; envI?: number } = {}
) {
  const mat = new THREE.MeshStandardMaterial({
    color: opts.color ?? 0xd9962b,
    metalness: 1,
    roughness: opts.roughness ?? 0.3,
    flatShading: true,
    envMap: env,
    envMapIntensity: opts.envI ?? 1.5,
  });
  const u = {
    uReveal: { value: 1 },
    uBaseGlow: { value: opts.baseGlow ?? 0 },
  };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = G.uTime;
    shader.uniforms.uEdge = G.uEdge;
    shader.uniforms.uCharge = G.uCharge;
    shader.uniforms.uShockR = G.uShockR;
    shader.uniforms.uShockA = G.uShockA;
    shader.uniforms.uReveal = u.uReveal;
    shader.uniforms.uBaseGlow = u.uBaseGlow;

    const disp =
      kind === "terrain"
        ? `
        float swv = exp(-pow((rr0 - uShockR) / 7.0, 2.0));
        transformed.y += swv * uShockA * (0.55 + 0.45 * sin(rr0 * 0.7 + position.x));`
        : kind === "sink"
        ? `
        float hit = 1.0 - smoothstep(uShockR - 14.0, uShockR, rr0);
        float hh = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
        transformed.y -= hit * hit * (45.0 + 40.0 * hh);`
        : "";

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec3 aBary; attribute vec3 aEdge;
        varying vec3 vBary; varying vec3 vEdge; varying vec3 vWP;
        uniform float uShockR; uniform float uShockA;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
        float rr0 = length(wp0.xz);
        ${disp}
        vBary = aBary; vEdge = aEdge;
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vBary; varying vec3 vEdge; varying vec3 vWP;
        uniform float uTime; uniform float uEdge; uniform float uCharge;
        uniform float uShockR; uniform float uReveal; uniform float uBaseGlow;`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          vec3 w = fwidth(vBary);
          // более широкий, мягкий край проволоки (менее субпиксельного мигания)
          vec3 core = 1.0 - smoothstep(vec3(0.0), w * 2.0, vBary);
          vec3 halo = 1.0 - smoothstep(vec3(0.0), w * 5.0, vBary);
          float c = max(max(core.x * vEdge.x, core.y * vEdge.y), core.z * vEdge.z);
          float hl = max(max(halo.x * vEdge.x, halo.y * vEdge.y), halo.z * vEdge.z);
          float rr = length(vWP.xz);
          float wave = 0.62 + 0.38 * sin(rr * 0.09 - uTime * 1.6 + vWP.y * 0.15);
          float chg = uCharge * (0.5 + 0.5 * sin(rr * 0.45 + uTime * 10.0));
          float sh = exp(-pow((rr - uShockR) / 6.0, 2.0));
          float szF = 1.0 - smoothstep(0.05, 0.28, max(w.x, max(w.y, w.z)));
          float k = uEdge * (wave + chg * 2.2 + sh * 5.0) * uReveal * szF;
          // уменьшена HDR-эмиссия проволоки + затухание на расстоянии (LOD)
          float distFade = 1.0 - smoothstep(40.0, 200.0, rr);
          totalEmissiveRadiance += vec3(1.0, 0.64, 0.16) * (c * 0.9 + hl * 0.05) * k * distFade;
          float bg = exp(-max(vWP.y, 0.0) * 0.42);
          totalEmissiveRadiance += vec3(1.0, 0.5, 0.1) * bg * uBaseGlow * (0.8 + 0.2 * sin(uTime * 2.0 + vWP.x));
        }`
      );
  };
  mat.customProgramCacheKey = () => "gold-" + kind;
  return { mat, u };
}

// ───────────────────────── материал логотипа ─────────────────────────
export function makeLogoMaterial(env: THREE.Texture) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffcf63,
    metalness: 1,
    roughness: 0.16,
    envMap: env,
    envMapIntensity: 2.2,
    flatShading: true,
    emissive: new THREE.Color(0x5a2a00),
    emissiveIntensity: 0.6,
  });
  const u = {
    uWipe: { value: 4 },
    uGlow: { value: 0 },
    uMode: { value: 1 },
    uFlash: { value: 1 },
    uEdgeCol: { value: new THREE.Vector3(1, 0.72, 0.28) },
    uGlintPos: { value: -9 },
    uGlintI: { value: 0 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.uniforms.uTime = G.uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vObjP;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvObjP = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vObjP; uniform float uWipe, uGlow, uTime, uFlash, uGlintPos, uGlintI; uniform int uMode; uniform vec3 uEdgeCol;
        float lgHash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        float lgN = lgHash(floor(vObjP.xy * 16.0)) * 0.55 + lgHash(floor(vObjP.xy * 5.0)) * 0.3;
        float lgF = 100.0;
        if (uMode == 1) lgF = vObjP.y;
        else if (uMode == 2) lgF = -vObjP.y - 1.9;
        else if (uMode == 3) lgF = vObjP.x * 2.2 - 1.0;
        else if (uMode == 4) lgF = 1.6 - length(vObjP.xy) * 1.1;
        else if (uMode == 5) lgF = lgHash(floor(vObjP.xy * 8.0)) * 4.5 - 3.2;
        else if (uMode == 6) lgF = vObjP.x * 1.1 + vObjP.y - 0.9;
        float lgM = uWipe - (lgF + (uMode == 5 ? 0.0 : lgN) - 0.4);
        if (lgM > 0.0) discard;`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          float fr = 1.0 - smoothstep(0.0, 0.55, -lgM);
          totalEmissiveRadiance += uEdgeCol * fr * fr * 3.2 * uFlash;
          totalEmissiveRadiance += vec3(1.0, 0.6, 0.2) * uGlow;
          float gd = (vObjP.x * 0.8 + vObjP.y * 0.6 - uGlintPos) / 0.38;
          totalEmissiveRadiance += vec3(1.0, 0.93, 0.7) * exp(-gd * gd) * uGlintI * 2.6;
        }`
      );
  };
  mat.customProgramCacheKey = () => "logo2";
  return { mat, u };
}

// ───────────────────────────── небо ─────────────────────────────
export function makeSky() {
  const u = { uBoom: { value: 0 }, uBright: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: { uTime: G.uTime, uBoom: u.uBoom, uBright: u.uBright },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir; uniform float uTime; uniform float uBoom; uniform float uBright;
      ${NOISE}
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        float a = atan(d.x, d.z) / 6.2831853 + 0.5;
        vec3 hz = vec3(0.23, 0.092, 0.012);
        vec3 top = vec3(0.010, 0.005, 0.002);
        vec3 col = mix(hz, top, pow(clamp(h, 0.0, 1.0), 0.40));
        float n  = gFbmP(vec2(a * 6.0, h * 3.4 - uTime * 0.10), 6.0);
        float n2 = gFbmP(vec2(a * 12.0 + 1.0, h * 7.0 - uTime * 0.22), 12.0);
        float wisp = smoothstep(0.38, 0.85, n * 0.7 + n2 * 0.55) * smoothstep(0.5, 0.0, h);
        col += vec3(1.0, 0.48, 0.07) * wisp * 0.3;
        col += vec3(1.0, 0.52, 0.10) * exp(-abs(h) * 16.0) * 0.45;
        col *= 1.0 + uBoom * 1.6;
        col = mix(col, hz * (1.0 + uBoom), smoothstep(0.0, -0.08, h));
        gl_FragColor = vec4(col * uBright, 1.0);
      }`,
  });
  return { mat, u };
}

// ──────────────────────── видео-плейсхолдер ────────────────────────
export function makeScreenMaterial(tex: THREE.Texture, idx: number, isVideo: boolean) {
  const u = {
    uOn: { value: 0 },
    uFlick: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    side: THREE.FrontSide,
    uniforms: {
      uTex: { value: tex },
      uTime: G.uTime,
      uIdx: { value: idx },
      uVideo: { value: isVideo ? 1 : 0 },
      uOn: u.uOn,
      uFlick: u.uFlick,
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D uTex; uniform float uTime, uIdx, uVideo, uOn, uFlick;
      ${NOISE}
      void main(){
        vec2 uv = vUv;
        float wipeY = uOn * 1.5 - 0.25;
        float m = 1.0 - smoothstep(wipeY - 0.05, wipeY, uv.y);
        float front = exp(-pow((uv.y - wipeY) / 0.035, 2.0)) * (1.0 - smoothstep(0.92, 1.0, uOn)) * step(0.001, uOn);
        vec2 ca = vec2(0.0035, 0.0) * (1.0 + front * 6.0);
        vec3 tex;
        tex.r = texture2D(uTex, uv + ca).r;
        tex.g = texture2D(uTex, uv).g;
        tex.b = texture2D(uTex, uv - ca).b;
        float band = 1.0 - abs(fract(uv.y * 0.55 - uTime * 0.05 + uIdx * 0.173) * 2.0 - 1.0);
        tex *= (0.92 + 0.22 * smoothstep(0.55, 1.0, band) * (1.0 - uVideo * 0.7));
        vec3 glass = mix(vec3(0.02, 0.011, 0.003), vec3(0.10, 0.055, 0.012), uv.y);
        glass += vec3(1.0, 0.7, 0.3) * 0.06 * (sin(uv.x * 3.0 + uv.y * 2.0 + uTime * 0.3) * 0.5 + 0.5);
        vec3 col = mix(glass, tex * 1.2, m);
        col += vec3(1.0, 0.72, 0.28) * front * 3.4;
        // 부드러운 флик вместо резкого уФлик
        col *= (0.92 + 0.08 * uFlick);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return { mat, u };
}

// ───────────────────────────── частицы ─────────────────────────────
export function makeEmbers(pix: number) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: G.uTime, uPix: { value: pix }, uInt: { value: 1 }, uSize: { value: 70 } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed; uniform float uTime, uPix, uInt, uSize; varying float vA;
      void main(){
        vec3 p = position;
        float spd = 0.7 + aSeed.x * 1.6;
        p.y = mod(p.y + uTime * spd, 46.0);
        p.x += sin(uTime * 0.45 * (0.5 + aSeed.y) + aSeed.z * 40.0) * 1.6;
        p.z += cos(uTime * 0.40 * (0.5 + aSeed.x) + aSeed.w * 40.0) * 1.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.5 + 0.5 * sin(uTime * (2.0 + aSeed.w * 5.0) + aSeed.z * 30.0);
        vA = tw * smoothstep(0.0, 4.0, p.y) * smoothstep(46.0, 30.0, p.y) * uInt;
        gl_PointSize = clamp(uSize * uPix * (0.35 + aSeed.w) / max(0.1, -mv.z), 1.0, 24.0 * uPix);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(1.0, 0.62, 0.2) * 2.4, a * a * vA);
      }`,
  });
  return mat;
}

export function makeCharge(pix: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: G.uTime,
      uCharge: G.uCharge,
      uInt: { value: 1 },
      uPix: { value: pix },
      uCenter: { value: new THREE.Vector3(0, 4.3, 0) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed; uniform float uTime, uCharge, uPix, uInt; uniform vec3 uCenter; varying float vA;
      void main(){
        float q = fract(uTime * (0.22 + aSeed.x * 0.3) + aSeed.y);
        float ang = q * q * 5.0 * (0.4 + aSeed.z);
        float c = cos(ang), s = sin(ang);
        vec3 o = vec3(position.x * c - position.z * s, position.y, position.x * s + position.z * c);
        o *= pow(1.0 - q, 1.7);
        vec4 mv = modelViewMatrix * vec4(uCenter + o, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = uCharge * uInt * sin(q * 3.14159);
        gl_PointSize = clamp(60.0 * uPix * (0.4 + aSeed.w) / max(0.1, -mv.z), 1.0, 20.0 * uPix);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(1.0, 0.75, 0.35) * 3.0, a * a * vA);
      }`,
  });
}

export function makeBurst(pix: number) {
  const u = { uT: { value: -1 }, uInt: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uT: u.uT,
      uInt: u.uInt,
      uPix: { value: pix },
      uOrigin: { value: new THREE.Vector3(0, 4.3, 0) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aVel; attribute vec4 aSeed; uniform float uT, uPix; uniform vec3 uOrigin;
      varying float vA; varying float vHeat;
      void main(){
        float t = max(uT, 0.0);
        float drag = 0.9 + aSeed.x * 1.4;
        vec3 p = uOrigin + aVel * (1.0 - exp(-drag * t)) / drag;
        p.y -= 0.5 * (1.5 + aSeed.y * 3.5) * t * t;
        float life = 2.2 + aSeed.z * 4.5;
        float k = t / life;
        vHeat = 1.0 - k;
        vA = (1.0 - smoothstep(0.5, 1.0, k)) * step(0.0, uT) * (0.6 + 0.4 * sin(t * 18.0 + aSeed.w * 40.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(130.0 * uPix * (0.3 + aSeed.w) * (1.0 - 0.6 * k) / max(0.1, -mv.z), 1.0, 40.0 * uPix);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA; varying float vHeat; uniform float uInt;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        vec3 hot = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.92, 0.65), smoothstep(0.2, 1.0, vHeat));
        gl_FragColor = vec4(hot * 3.2 * uInt, a * a * vA);
      }`,
  });
  return { mat, u };
}

// ───────────────────── ядро, ударные волны, лучи ─────────────────────
export function makeCoreMaterial() {
  const u = { uPower: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: G.uTime, uPower: u.uPower },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        vP = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform float uTime, uPower;
      ${NOISE}
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        float n = gFbm(vP.xy * 2.6 + vP.z * 1.9 + uTime * 1.6);
        float core = 1.0 - f;
        vec3 col = mix(vec3(1.0, 0.42, 0.06), vec3(1.0, 0.93, 0.72), core * core);
        col *= 0.55 + n * 1.3;
        gl_FragColor = vec4(col * uPower * (1.0 + f * 2.0), 1.0);
      }`,
  });
  return { mat, u };
}

export function makeShellMaterial() {
  const u = { uPower: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: G.uTime, uPower: u.uPower },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        vP = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform float uTime, uPower;
      ${NOISE}
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float n = gFbm(vP.xz * 4.0 + vP.y * 3.0 - uTime * 0.8);
        vec3 col = mix(vec3(1.0, 0.45, 0.08), vec3(1.0, 0.85, 0.5), f);
        gl_FragColor = vec4(col * (f * 2.4 + 0.12) * (0.4 + n * 1.2) * uPower, 1.0);
      }`,
  });
  return { mat, u };
}

export function makeRingMaterial() {
  const u = { uR: { value: 0 }, uPower: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: u,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; uniform float uR, uPower;
      void main(){
        float d = length(vUv - 0.5) * 440.0;
        float ring = exp(-pow((d - uR) / 2.6, 2.0));
        float tail = smoothstep(uR - 46.0, uR, d) * step(d, uR) * 0.16;
        float fall = exp(-uR * 0.011);
        vec3 col = vec3(1.0, 0.72, 0.3) * (ring * 4.0 + tail) * fall * uPower;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return { mat, u };
}

export function makeBeamMaterial() {
  const u = { uPower: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: G.uTime, uPower: u.uPower },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV; uniform float uTime, uPower;
      ${NOISE}
      void main(){
        float fres = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
        float n = gNoise(vec2(vUv.x * 14.0, vUv.y * 3.0 - uTime * 0.8));
        float a = pow(vUv.y, 1.6) * (0.55 + 0.6 * n) * fres;
        gl_FragColor = vec4(vec3(1.0, 0.68, 0.24) * a * uPower * 0.6, 1.0);
      }`,
  });
  return { mat, u };
}

export function makeBaseGlowMaterial() {
  const u = { uPower: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: G.uTime, uPower: u.uPower },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; uniform float uTime, uPower;
      void main(){
        float d = length(vUv - 0.5) * 2.0;
        float g = pow(max(0.0, 1.0 - d), 2.2);
        float rg = exp(-pow((d - 0.55) / 0.08, 2.0)) * 0.35;
        gl_FragColor = vec4(vec3(1.0, 0.6, 0.15) * (g * 0.7 + rg) * uPower * (0.85 + 0.15 * sin(uTime * 2.3)), 1.0);
      }`,
  });
  return { mat, u };
}

/** Лучи света за логотипом */
export function makeRaysMaterial() {
  const u = { uPower: { value: 0 }, uColor: { value: new THREE.Vector3(1, 0.66, 0.22) } };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: G.uTime, uPower: u.uPower, uColor: u.uColor },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; uniform float uTime, uPower; uniform vec3 uColor;
      ${NOISE}
      void main(){
        vec2 p = vUv - 0.5;
        float r = length(p) * 2.0;
        float a = atan(p.y, p.x);
        float rays = gNoiseP(vec2((a / 6.2831853 + 0.5) * 24.0 + uTime * 0.35, r * 1.2), 24.0);
        float rays2 = gNoiseP(vec2((a / 6.2831853 + 0.5) * 48.0 - uTime * 0.5, r * 2.0), 48.0);
        float shape = pow(max(0.0, 1.0 - r), 1.6);
        float v = shape * (pow(rays, 2.2) * 1.2 + pow(rays2, 3.0) * 0.8);
        float core = pow(max(0.0, 1.0 - r), 3.5) * 0.7;
        gl_FragColor = vec4(uColor * (v + core) * uPower, 1.0);
      }`,
  });
  return { mat, u };
}

export function makeGlowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.15, "rgba(255,235,190,0.7)");
  gr.addColorStop(0.4, "rgba(255,170,60,0.22)");
  gr.addColorStop(1, "rgba(255,120,20,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ───────────────────── финальный пост-процесс ─────────────────────
export function makeFinalShader() {
  return {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: G.uTime,
    uFlash: { value: 0 },
    uAberr: { value: 0.0015 },
    uZoom: { value: 0 },
    uExposure: { value: 1 },
    uFade: { value: 1 },
    uVig: { value: 0.55 },
    uStreak: { value: 0.1 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uFlashCol: { value: new THREE.Vector3(1, 0.9, 0.65) },
    uHue: { value: 0 },
    uSat: { value: 1 },
    uContrast: { value: 1 },
    uTint: { value: new THREE.Vector3(1, 0.7, 0.3) },
    uTintAmt: { value: 0 },
    uGrain: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime, uFlash, uAberr, uZoom, uExposure, uFade, uVig, uStreak, uHue, uSat, uContrast, uTintAmt, uGrain;
    uniform vec2 uRes; uniform vec3 uFlashCol, uTint;
    float fHash(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
    vec3 aces(vec3 x){
      const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
      return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
    }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * uAberr * (0.6 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;

      if (uZoom > 0.001) {
        vec3 acc = col;
        for (int i = 1; i < 10; i++) {
          float s = float(i) / 10.0;
          acc += texture2D(tDiffuse, uv - c * uZoom * s).rgb;
        }
        col = acc / 10.0;
      }

      // анаморфные стрики — мягкий порог вместо жёсткого max(s-1.3,0)
      vec3 st = vec3(0.0);
      float wsum = 0.0;
      for (int i = -10; i <= 10; i++) {
        float fi = float(i);
        float w = exp(-abs(fi) * 0.32);
        vec3 s = texture2D(tDiffuse, uv + vec2(fi * 0.011, 0.0)).rgb;
        float bright = max(dot(s, vec3(0.333)), 0.0);
        st += smoothstep(1.3, 1.9, bright) * s * w;
        wsum += w;
      }
      col += st / wsum * uStreak * vec3(1.0, 0.72, 0.42) * 3.0;

      col *= uExposure;
      col = mix(col, uFlashCol * 7.0, uFlash);

      // тон-маппинг и цветокор: тёплые тени, золотые света
      col = aces(col * 0.95);
      col = pow(col, vec3(0.97, 1.0, 1.06));
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(luma), col, 1.12 * uSat);
      if (abs(uHue) > 0.0001) {
        const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
        const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
        vec3 yiq = toYIQ * col;
        float hh = atan(yiq.z, yiq.y) + uHue;
        float ch = length(yiq.yz);
        col = toRGB * vec3(yiq.x, ch * cos(hh), ch * sin(hh));
        col = max(col, 0.0);
      }
      col = mix(col, col * uTint * 1.6, uTintAmt);
      col = (col - 0.5) * uContrast + 0.5;
      col = max(col, 0.0);

      float vig = smoothstep(0.30, 0.98, length(c) * 1.25);
      col *= 1.0 - uVig * vig;

      col = pow(col, vec3(1.0 / 2.2));
      // статичное зерно без привязки к времени (не мигает при движении)
      col += (fHash(uv * uRes) - 0.5) * 0.02 * uGrain;
      col *= uFade;
      gl_FragColor = vec4(col, 1.0);
    }`,
};
}
