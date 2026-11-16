import * as THREE from "three";
import { buildLogo } from "./logo";
import { makeLogoMaterial, makeRaysMaterial } from "./shaders";
import { T_LOGO } from "./config";
import { DEG, clamp, lerp, smoothstep, easeInOutCubic, easeOutCubic, mulberry32 } from "./math";
import type { Settings } from "./schema";

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeOutBack = (t: number) => {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeOutBounce = (x: number) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};
const easeOutElastic = (x: number) =>
  x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;

export function ease(name: string, t: number) {
  t = clamp(t);
  switch (name) {
    case "expo":
      return easeOutExpo(t);
    case "back":
      return easeOutBack(t);
    case "bounce":
      return easeOutBounce(t);
    case "elastic":
      return easeOutElastic(t);
    case "linear":
      return t;
    default:
      return easeInOutCubic(t);
  }
}

const REVEAL_MODE: Record<string, number> = { none: 0, wipeUp: 1, wipeDown: 2, wipeX: 3, radial: 4, noise: 5, scan: 6 };
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const tmpC = new THREE.Color();

/** Один экземпляр 3D-логотипа (слой композиции) со своей анимацией и материалом */
export class LogoInstance {
  readonly root = new THREE.Group();
  private logo: THREE.Group;
  private parts: THREE.Mesh[];
  private rnd: THREE.Vector3[] = [];
  private mat: ReturnType<typeof makeLogoMaterial>;
  private arcU: ReturnType<typeof buildLogo>["arcU"];
  private arcMesh: THREE.Mesh;
  private rays: ReturnType<typeof makeRaysMaterial>;
  private raysMesh: THREE.Mesh;
  private glow: THREE.Sprite;
  private flat = true;
  private cache: Record<string, string> = {};

  constructor(env: THREE.Texture, glowTex: THREE.Texture) {
    this.mat = makeLogoMaterial(env);
    const b = buildLogo(this.mat.mat);
    this.logo = b.group;
    this.parts = b.parts;
    this.arcU = b.arcU;
    this.arcMesh = b.arc;
    this.parts.forEach((_, i) => {
      const r = mulberry32(i * 17 + 3);
      this.rnd.push(new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1));
    });
    this.rays = makeRaysMaterial();
    this.raysMesh = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), this.rays.mat);
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color(1, 0.6, 0.2),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        fog: false,
      })
    );
    this.root.add(this.logo, this.raysMesh, this.glow);
    this.root.visible = false;
  }

  private col(key: string, hex: string) {
    if (this.cache[key] !== hex) {
      this.cache[key] = hex;
      return true;
    }
    return false;
  }

  update(t: number, s: Settings) {
    const dur = Math.max(0.05, s.duration);
    const lq = t - T_LOGO - s.delay;
    const outp = s.outAt > 0 ? clamp((lq - s.outAt) / Math.max(0.05, s.outDur)) : 0;
    const alive = lq > 0 && outp < 1;
    this.root.visible = alive;
    if (!alive) return;

    const prog = clamp(lq / dur);
    const settle = smoothstep(0, 0.75, prog);

    // ── материал ──
    const m = this.mat.mat;
    if (this.col("color", s.color)) m.color.set(s.color);
    if (this.col("emissive", s.emissive)) m.emissive.set(s.emissive);
    m.metalness = s.metalness;
    m.roughness = s.roughness;
    m.envMapIntensity = s.envI;
    m.emissiveIntensity = s.emissiveI;
    if (this.flat !== !!s.flat) {
      this.flat = !!s.flat;
      m.flatShading = this.flat;
      m.needsUpdate = true;
    }
    const u = this.mat.u;
    let mode = REVEAL_MODE[s.reveal] ?? 1;
    let wp = easeInOutCubic(prog);
    if (s.reveal === "scan" || s.reveal === "wipeX") wp = lerp(wp, prog, 0.5);
    wp *= 1 - easeInOutCubic(outp);
    if (mode === 0 && outp > 0) mode = 4;
    u.uMode.value = mode;
    u.uWipe.value = lerp(2.0, -4.4, wp);
    u.uFlash.value = s.flash;
    if (this.col("edge", s.edgeColor)) {
      tmpC.set(s.edgeColor);
      u.uEdgeCol.value.set(tmpC.r, tmpC.g, tmpC.b);
    }
    u.uGlow.value = 0.18 + 0.1 * Math.sin(t * 1.4) + 1.2 * Math.exp(-Math.pow((lq - dur) / 0.5, 2)) * Math.min(1, s.flash);
    // блик-проход
    const gl0 = lq - dur - 0.2;
    let gp = -1;
    if (gl0 > 0) {
      const per = s.glintEvery > 0 ? gl0 % s.glintEvery : gl0;
      gp = per / 1.5;
    }
    u.uGlintI.value = s.glint * (gp >= 0 && gp <= 1 ? 1 : 0) * (1 - outp);
    u.uGlintPos.value = lerp(-3.2, 3.2, clamp(gp));

    // ── части: сборка ──
    const n = this.parts.length;
    const st = clamp(s.stagger, 0, 0.9);
    const q = Math.floor(t * 24);
    for (let i = 0; i < n; i++) {
      const p = this.parts[i];
      const r = this.rnd[i];
      const pi = n > 1 ? clamp((prog - st * (i / (n - 1))) / (1 - st)) : prog;
      const e = ease(s.ease, pi);
      const inv = 1 - e;
      let px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1;
      const A = s.amount;
      switch (s.assemble) {
        case "scatter":
          px = r.x * A * inv; py = r.y * A * inv; pz = r.z * A * inv;
          rx = r.x * Math.PI * 2 * inv; ry = r.y * Math.PI * 2 * inv; rz = r.z * Math.PI * 2 * inv;
          break;
        case "spiral": {
          const a = i * 2.4 + inv * Math.PI * 2.5;
          px = Math.cos(a) * A * inv; py = Math.sin(a) * A * 0.6 * inv; pz = r.z * A * 0.5 * inv;
          rz = inv * Math.PI * 2;
          break;
        }
        case "implode": {
          const d = r.clone().normalize();
          px = d.x * A * inv; py = d.y * A * inv; pz = d.z * A * inv;
          rx = r.x * Math.PI * inv; ry = r.y * Math.PI * inv; rz = r.z * Math.PI * inv;
          sx = sy = sz = 0.15 + 0.85 * clamp(e);
          break;
        }
        case "drop":
          px = r.x * 0.4 * inv; py = A * inv; rz = r.z * 0.5 * inv;
          break;
        case "unfold":
          if (i < 3) rz = inv * 0.33 + inv * 0.2;
          else if (i < 6) rz = -(inv * 0.33 + inv * 0.2);
          else {
            py = -inv * 3;
            sx = sy = sz = clamp(e, 0.001, 1.4);
          }
          break;
        case "rise":
          py = -A * inv; sy = 0.3 + 0.7 * clamp(e); sz = 0.5 + 0.5 * clamp(e);
          break;
        case "glitch": {
          const gate = hash(i, q) > 0.35 ? 1 : 0;
          px = (hash(i, q + 3) - 0.5) * A * 0.5 * inv * gate;
          py = (hash(i + 9, q) - 0.5) * A * 0.18 * inv * gate;
          sx = 1 + (hash(i, q + 5) - 0.5) * 0.9 * inv * gate;
          break;
        }
      }
      p.position.set(px, py, pz);
      p.rotation.set(rx, ry, rz);
      p.scale.set(sx, sy, sz);
    }

    // ── группа: трансформ + idle ──
    const sp = s.idleSpeed;
    const am = s.idleAmp;
    let ox = 0, oy = 0, rotX = 0, rotY = 0, pulse = 1;
    switch (s.idle) {
      case "sway":
        rotY = Math.sin(t * 0.55 * sp) * 0.3 * am * settle;
        rotX = Math.sin(t * 0.43 * sp) * 0.05 * am * settle;
        break;
      case "float":
        oy = Math.sin(t * 0.9 * sp) * 0.22 * am * settle;
        ox = Math.sin(t * 0.6 * sp + 1.2) * 0.08 * am * settle;
        rotY = Math.sin(t * 0.4 * sp) * 0.14 * am * settle;
        rotX = Math.sin(t * 0.5 * sp) * 0.03 * am * settle;
        break;
      case "spin":
        rotY = lq * 0.6 * sp * am * settle;
        break;
      case "pulse":
        pulse = 1 + 0.035 * am * Math.sin(t * 2.2 * sp) * settle;
        rotY = Math.sin(t * 0.4 * sp) * 0.08 * am * settle;
        break;
    }
    const scaleMul = 1 + (s.scaleFrom - 1) * Math.exp((-lq * 6) / dur);
    const S = s.scale * scaleMul * pulse;
    const g = this.logo;
    g.position.set(s.x + ox, s.y + oy, s.z);
    g.rotation.set(s.rotX * DEG + rotX, s.rotY * DEG + rotY + (1 - settle) * s.spinIn * DEG, s.rotZ * DEG, "YXZ");
    g.scale.set(S, S, S * s.depth);

    // ── дуга ──
    this.arcMesh.visible = !!s.arc;
    this.arcU.uP.value = easeInOutCubic((lq - s.arcDelay) / Math.max(0.05, s.arcDur));
    this.arcU.uPower.value = 1 - outp;
    if (this.col("arc", s.arcColor)) {
      tmpC.set(s.arcColor);
      this.arcU.uColor.value.set(tmpC.r, tmpC.g, tmpC.b);
    }

    // ── лучи и гало ──
    const k = s.scale / 1.5;
    const cx = s.x;
    const cy = s.y - 1.1 * s.scale;
    this.raysMesh.visible = lq > 0.3 && s.rays > 0.001;
    this.raysMesh.position.set(cx, cy + 0.2, s.z - 1.4 * k);
    this.raysMesh.scale.setScalar(s.raysSize * k);
    this.rays.u.uPower.value = smoothstep(0.4, 0.4 + dur * 0.8, lq) * (0.55 + 0.1 * Math.sin(t * 1.2)) * s.rays * (1 - outp);
    if (this.col("rays", s.raysColor)) {
      tmpC.set(s.raysColor);
      this.rays.u.uColor.value.set(tmpC.r, tmpC.g, tmpC.b);
    }
    this.glow.visible = s.glow > 0.001;
    this.glow.position.set(cx, cy + 0.3, s.z - 1.0 * k);
    this.glow.scale.setScalar(22 * s.glowSize * k);
    const gk = smoothstep(0, 2.5, lq) * (0.38 + 0.05 * Math.sin(t * 1.7)) * s.glow * (1 - outp);
    if (this.col("glow", s.glowColor)) {
      this.cache.glowRGB = "";
      tmpC.set(s.glowColor);
      (this as any)._gc = [tmpC.r, tmpC.g, tmpC.b];
    }
    const gc = ((this as any)._gc as number[]) ?? [1, 0.6, 0.2];
    this.glow.material.color.setRGB(gc[0] * gk, gc[1] * gk, gc[2] * gk);
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mt = m.material as THREE.Material | undefined;
      if (mt && !Array.isArray(mt)) mt.dispose();
    });
  }
}

export { easeOutCubic };
