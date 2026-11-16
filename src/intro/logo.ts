import * as THREE from "three";
import { NOISE, G } from "./shaders";

const L = 3.3;
const ALPHA = (19 * Math.PI) / 180;

function taper(from: THREE.Vector2, to: THREE.Vector2, w0: number, w1: number, tipLen = 0) {
  const dir = to.clone().sub(from).normalize();
  const n = new THREE.Vector2(-dir.y, dir.x);
  const e = to.clone().addScaledVector(dir, -tipLen);
  const s = new THREE.Shape();
  const p = (v: THREE.Vector2, k: number, w: number) => v.clone().addScaledVector(n, (k * w) / 2);
  const a = p(from, 1, w0);
  s.moveTo(a.x, a.y);
  const b = p(e, 1, w1);
  s.lineTo(b.x, b.y);
  s.lineTo(to.x, to.y);
  const c = p(e, -1, w1);
  s.lineTo(c.x, c.y);
  const d = p(from, -1, w0);
  s.lineTo(d.x, d.y);
  s.closePath();
  return s;
}

function ringShape(ro: number, ri: number, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  s.absarc(cx, cy, ro, 0, Math.PI * 2, false);
  const h = new THREE.Path();
  h.absarc(cx, cy, ri, 0, Math.PI * 2, true);
  s.holes.push(h);
  return s;
}

function arcShape(ro: number, ri: number, a0: number, a1: number) {
  const s = new THREE.Shape();
  s.absarc(0, 0, ro, a0, a1, false);
  s.absarc(0, 0, ri, a1, a0, true);
  s.closePath();
  return s;
}

export function buildLogo(mat: THREE.Material) {
  const group = new THREE.Group();
  const ex = (shape: THREE.Shape, depth = 0.16, bevel = 0.035) => {
    const g = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel * 0.8,
      bevelSegments: 2,
      curveSegments: 64,
    });
    g.translate(0, 0, -depth / 2);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    group.add(m);
    return m;
  };

  const H = new THREE.Vector2(0, 0);
  const dirL = new THREE.Vector2(-Math.sin(ALPHA), -Math.cos(ALPHA));
  const dirR = new THREE.Vector2(Math.sin(ALPHA), -Math.cos(ALPHA));
  const at = (d: THREE.Vector2, t: number) => d.clone().multiplyScalar(L * t);

  // левая нога — игла
  ex(taper(H, at(dirL, 0.7), 0.3, 0.15));
  ex(taper(at(dirL, 0.69), at(dirL, 0.79), 0.26, 0.26), 0.2, 0.04);
  ex(taper(at(dirL, 0.78), at(dirL, 1.0), 0.09, 0.07, 0.75), 0.12, 0.02);

  // правая нога — грифель
  ex(taper(H, at(dirR, 0.6), 0.3, 0.2));
  ex(taper(at(dirR, 0.59), at(dirR, 0.78), 0.34, 0.3), 0.22, 0.04);
  ex(taper(at(dirR, 0.77), at(dirR, 1.0), 0.13, 0.1, 0.62), 0.14, 0.025);

  // шарнир
  ex(ringShape(0.36, 0.15), 0.26, 0.05);
  const pin = new THREE.Shape();
  pin.absarc(0, 0, 0.09, 0, Math.PI * 2, false);
  ex(pin, 0.34, 0.03);

  // рукоять
  const stem = new THREE.Shape();
  stem.moveTo(-0.07, 0.3);
  stem.lineTo(0.07, 0.3);
  stem.lineTo(0.055, 0.82);
  stem.lineTo(-0.055, 0.82);
  stem.closePath();
  ex(stem, 0.14, 0.02);
  ex(ringShape(0.27, 0.12, 0, 1.08), 0.16, 0.035);

  // дуга-стабилизатор
  const base = -Math.PI / 2;
  ex(arcShape(1.98, 1.88, base - ALPHA - 0.07, base + ALPHA + 0.07), 0.1, 0.02);

  // «прочерченная» дуга — шейдер
  const a0 = base - (42 * Math.PI) / 180;
  const a1 = base + (42 * Math.PI) / 180;
  const arcGeo = new THREE.RingGeometry(L - 0.035, L + 0.035, 200, 1, a0, a1 - a0);
  const arcU = { uP: { value: 0 }, uPower: { value: 1 } };
  const arcMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uP: arcU.uP, uPower: arcU.uPower, uTime: G.uTime },
    vertexShader: /* glsl */ `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec3 vP; uniform float uP, uPower, uTime;
      ${NOISE}
      void main(){
        float a = atan(vP.y, vP.x);
        float a0 = ${a0.toFixed(5)};
        float a1 = ${a1.toFixed(5)};
        float t = clamp((a - a0) / (a1 - a0), 0.0, 1.0);
        float head = uP * 1.12 - 0.04;
        float vis = smoothstep(head, head - 0.16, t);
        float hot = exp(-pow((t - head + 0.02) / 0.035, 2.0)) * step(uP, 0.995) * step(0.001, uP);
        float ends = pow(sin(t * 3.14159), 0.6);
        float spark = 0.75 + 0.25 * sin(t * 90.0 - uTime * 6.0);
        vec3 col = vec3(1.0, 0.72, 0.28) * (vis * ends * spark * 1.6) + vec3(1.0, 0.95, 0.8) * hot * 4.0;
        gl_FragColor = vec4(col * uPower, 1.0);
      }`,
  });
  const arc = new THREE.Mesh(arcGeo, arcMat);
  arc.position.z = 0;
  group.add(arc);

  return { group, arcU };
}
