import * as THREE from "three";
import Delaunator from "delaunator";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { fbm, vnoise, smoothstep, mulberry32 } from "./math";
import { distToPath } from "./timeline";

// ───────────────────────── рельеф ─────────────────────────
export function terrainHeight(x: number, z: number) {
  const r = Math.hypot(x, z);
  const arena = smoothstep(16, 64, r);
  const corr = smoothstep(7, 46, distToPath(x, z));
  const m = arena * corr;
  const n = fbm(x * 0.03 + 10, z * 0.03 - 4);
  const ridge = 1 - Math.abs(fbm(x * 0.018 - 3, z * 0.018 + 7) * 2 - 1);
  const hills = (n - 0.36) * 34 + ridge * ridge * 22;
  const fine = (vnoise(x * 0.33, z * 0.33) - 0.5) * 1.5;
  return hills * m + fine * (0.18 + 0.82 * smoothstep(8, 40, r)) * (0.35 + 0.65 * corr);
}

/** Максимальная высота рельефа вокруг точки — чтобы камера не проваливалась в грань */
let frameId = 0;
const safeCache = new Map<string, number>();
export function terrainSafeHeightBeginFrame() { frameId++; safeCache.clear(); }
export function terrainSafeHeight(x: number, z: number, rad = 4) {
  const key = `${Math.round(x / rad) * rad},${Math.round(z / rad) * rad}`;
  const cached = safeCache.get(key);
  if (cached !== undefined) return cached;
  let m = terrainHeight(x, z);
  m = Math.max(m, terrainHeight(x + rad, z), terrainHeight(x - rad, z));
  m = Math.max(m, terrainHeight(x, z + rad), terrainHeight(x, z - rad));
  safeCache.set(key, m);
  return m;
}

// ───────────────────── билдер граней с «рёбрами» ─────────────────────
class FacetBuilder {
  pos: number[] = [];
  bary: number[] = [];
  edge: number[] = [];
  constructor(public center: THREE.Vector3) {}

  tri(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    fbc: number,
    fca: number,
    fab: number
  ) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const cen = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
    if (n.dot(cen.sub(this.center)) < 0) {
      [b, c] = [c, b];
      [fca, fab] = [fab, fca];
    }
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.bary.push(1, 0, 0, 0, 1, 0, 0, 0, 1);
    for (let i = 0; i < 3; i++) this.edge.push(fbc, fca, fab);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("aBary", new THREE.Float32BufferAttribute(this.bary, 3));
    g.setAttribute("aEdge", new THREE.Float32BufferAttribute(this.edge, 3));
    g.computeVertexNormals();
    return g;
  }
}

export interface CrystalOpts {
  sides: number;
  w: number;
  d: number;
  h: number;
  taper: number;
  apex: number; // 0 → плоская крышка
  lean?: [number, number];
  apexOff?: [number, number];
  regular?: boolean;
}

export interface CrystalFront {
  corners: THREE.Vector3[]; // bl, br, tr, tl
  normal: THREE.Vector3;
}

export function buildCrystal(rand: () => number, o: CrystalOpts) {
  const n = o.sides;
  const lean = o.lean ?? [0, 0];
  const apexOff = o.apexOff ?? [0, 0];
  const center = new THREE.Vector3(lean[0] * 0.5, o.h * 0.5, lean[1] * 0.5);
  const fb = new FacetBuilder(center);

  const base: THREE.Vector3[] = [];
  const top: THREE.Vector3[] = [];
  for (let k = 0; k < n; k++) {
    let ang: number;
    let rx: number;
    let rz: number;
    if (o.regular) {
      ang = ((k + 0.5) / n) * Math.PI * 2;
      rx = (o.w / 2) * Math.SQRT2;
      rz = (o.d / 2) * Math.SQRT2;
    } else {
      ang = ((k + (rand() - 0.5) * 0.55) / n) * Math.PI * 2;
      rx = (o.w / 2) * (0.78 + 0.5 * rand());
      rz = (o.d / 2) * (0.78 + 0.5 * rand());
    }
    const b = new THREE.Vector3(Math.cos(ang) * rx, 0, Math.sin(ang) * rz);
    base.push(b);
    top.push(new THREE.Vector3(lean[0] + b.x * o.taper, o.h, lean[1] + b.z * o.taper));
  }

  let best = 0;
  let bestLen = -1;
  for (let k = 0; k < n; k++) {
    const b0 = base[k];
    const b1 = base[(k + 1) % n];
    // 4 боковых — берём широкие и более-менее фронтальные грани
    const len = b0.distanceTo(b1);
    if (len > bestLen) {
      bestLen = len;
      best = k;
    }
    fb.tri(b0, b1, top[(k + 1) % n], 1, 0, 1);
    fb.tri(b0, top[(k + 1) % n], top[k], 1, 1, 0);
  }

  const ctop = new THREE.Vector3(lean[0], o.h, lean[1]);
  if (o.apex > 0) {
    const apex = new THREE.Vector3(lean[0] + apexOff[0], o.h + o.apex, lean[1] + apexOff[1]);
    for (let k = 0; k < n; k++) fb.tri(top[k], top[(k + 1) % n], apex, 1, 1, 1);
  } else {
    for (let k = 0; k < n; k++) fb.tri(top[k], top[(k + 1) % n], ctop, 0, 0, 1);
  }

  const k1 = (best + 1) % n;
  const corners = [base[best].clone(), base[k1].clone(), top[k1].clone(), top[best].clone()];
  const normal = new THREE.Vector3()
    .subVectors(corners[1], corners[0])
    .cross(new THREE.Vector3().subVectors(corners[3], corners[0]))
    .normalize();
  const mid = corners[0].clone().add(corners[2]).multiplyScalar(0.5);
  if (normal.dot(mid.sub(center)) < 0) normal.negate();

  return { geo: fb.geometry(), front: { corners, normal } as CrystalFront };
}

// ───────────────────── «экран» на грани кристалла ─────────────────────
export const SCREEN_SHAPES: [number, number][][] = [
  [[0, 0], [1, 0], [1, 0.8], [0.8, 1], [0, 1]],
  [[0, 0], [1, 0], [1, 1], [0.18, 1], [0, 0.86]],
  [[0.12, 0], [1, 0], [1, 0.9], [0.88, 1], [0, 1], [0, 0.12]],
  [[0, 0], [0.86, 0], [1, 0.12], [1, 1], [0.1, 1], [0, 0.9]],
  [[0, 0], [1, 0], [1, 0.88], [0.7, 1], [0.12, 1], [0, 0.82]],
];

export function buildScreen(front: CrystalFront, shape: [number, number][]) {
  const [bl, br, tr, tl] = front.corners;
  const cen = bl.clone().add(br).add(tr).add(tl).multiplyScalar(0.25);
  const inset = 0.88;
  const push = front.normal.clone().multiplyScalar(0.035);
  const c = [bl, br, tr, tl].map((p) =>
    p.clone().sub(cen).multiplyScalar(inset).add(cen).add(push)
  );
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(front.normal.clone().negate(), up);
  const flip = new THREE.Vector3().subVectors(c[1], c[0]).dot(right) < 0;

  const map = (pu: number, pv: number) => {
    const u = flip ? 1 - pu : pu;
    const v = pv;
    return new THREE.Vector3()
      .addScaledVector(c[0], (1 - u) * (1 - v))
      .addScaledVector(c[1], u * (1 - v))
      .addScaledVector(c[2], u * v)
      .addScaledVector(c[3], (1 - u) * v);
  };

  const verts = shape.map(([pu, pv]) => map(pu, pv));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  verts.forEach((v, i) => {
    pos.push(v.x, v.y, v.z);
    uv.push(shape[i][0], shape[i][1]);
  });
  for (let i = 1; i < verts.length - 1; i++) {
    const a = verts[0];
    const b = verts[i];
    const d = verts[i + 1];
    const nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
    if (nrm.dot(front.normal) >= 0) idx.push(0, i, i + 1);
    else idx.push(0, i + 1, i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);

  const wTop = c[3].distanceTo(c[2]);
  const wBot = c[0].distanceTo(c[1]);
  const hh = (c[0].distanceTo(c[3]) + c[1].distanceTo(c[2])) * 0.5;
  const aspect = ((wTop + wBot) * 0.5) / hh;
  return { geo: g, aspect };
}

// ───────────────────────── рельеф-мозаика ─────────────────────────
export function buildTerrain() {
  const rand = mulberry32(7);
  const pts: number[] = [0, 0];
  let r = 2.4;
  while (r < 320) {
    const sp = 1.2 + r * 0.052;
    const n = Math.max(6, Math.round((2 * Math.PI * r) / sp));
    const off = rand();
    for (let i = 0; i < n; i++) {
      const a = ((i + off + (rand() - 0.5) * 0.7) / n) * Math.PI * 2;
      const rr = r + (rand() - 0.5) * sp * 0.65;
      pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    r += sp * 0.9;
  }
  const d = new Delaunator(pts);
  const tris = d.triangles;
  const pos: number[] = [];
  const bary: number[] = [];
  const edge: number[] = [];
  for (let i = 0; i < tris.length; i += 3) {
    const ids = [tris[i], tris[i + 1], tris[i + 2]];
    const v = ids.map((id) => {
      const x = pts[id * 2];
      const z = pts[id * 2 + 1];
      return new THREE.Vector3(x, terrainHeight(x, z), z);
    });
    const n = new THREE.Vector3()
      .subVectors(v[1], v[0])
      .cross(new THREE.Vector3().subVectors(v[2], v[0]));
    if (n.y < 0) [v[1], v[2]] = [v[2], v[1]];
    v.forEach((p) => pos.push(p.x, p.y, p.z));
    bary.push(1, 0, 0, 0, 1, 0, 0, 0, 1);
    for (let k = 0; k < 3; k++) edge.push(1, 1, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aBary", new THREE.Float32BufferAttribute(bary, 3));
  g.setAttribute("aEdge", new THREE.Float32BufferAttribute(edge, 3));
  g.computeVertexNormals();
  return g;
}

// ───────────────── башни на горизонте и россыпь осколков ─────────────────
export function buildWorldStructures(crossingAngle: number) {
  void crossingAngle;
  const rand = mulberry32(2024);
  const towers: THREE.BufferGeometry[] = [];
  const shards: THREE.BufferGeometry[] = [];

  const place = (g: THREE.BufferGeometry, x: number, y: number, z: number, rotY: number, tiltX = 0, tiltZ = 0) => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, rotY, tiltZ, "YXZ")),
      new THREE.Vector3(1, 1, 1)
    );
    g.applyMatrix4(m);
    return g;
  };

  // кластеры башен
  const clusters: { a: number; r: number; s: number }[] = [];
  // по бокам от коридора камеры (как на референсе)
  const sideA = 100 * (Math.PI / 180);
  [
    [-13, 78], [12, 84], [-9, 112], [14, 118], [-17, 140], [10, 150], [-6, 66], [9, 62],
  ].forEach(([da, r]) => clusters.push({ a: sideA + da * (Math.PI / 180), r, s: 0.85 + rand() * 0.5 }));
  // остальной горизонт
  for (let i = 0; i < 22; i++) {
    clusters.push({ a: rand() * Math.PI * 2, r: 70 + rand() * 120, s: 0.8 + rand() * 0.9 });
  }
  clusters.forEach((c) => {
    const cx = Math.cos(c.a) * c.r;
    const cz = Math.sin(c.a) * c.r;
    if (distToPath(cx, cz) < 16) return;
    const cnt = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < cnt; i++) {
      const ox = (rand() - 0.5) * 18 * c.s;
      const oz = (rand() - 0.5) * 18 * c.s;
      const x = cx + ox;
      const z = cz + oz;
      if (distToPath(x, z) < 13) continue;
      const w = (3 + rand() * 5) * c.s;
      const dd = (3 + rand() * 5) * c.s;
      const h = (14 + rand() * 34) * c.s * (i === 0 ? 1.25 : 1);
      const { geo } = buildCrystal(rand, {
        sides: 4,
        w,
        d: dd,
        h,
        taper: 0.86 + rand() * 0.14,
        apex: rand() > 0.55 ? 2 + rand() * 4 : 0,
        apexOff: [(rand() - 0.5) * 2, (rand() - 0.5) * 2],
        regular: true,
      });
      towers.push(place(geo, x, terrainHeight(x, z) - 3, z, rand() * Math.PI));
    }
  });

  // россыпь кристаллических осколков (как на референсе №4)
  for (let c = 0; c < 38; c++) {
    const a = rand() * Math.PI * 2;
    const r = 24 + Math.pow(rand(), 0.8) * 80;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const cnt = 4 + Math.floor(rand() * 5);
    for (let i = 0; i < cnt; i++) {
      const x = cx + (rand() - 0.5) * 9;
      const z = cz + (rand() - 0.5) * 9;
      if (distToPath(x, z) < 7) continue;
      const hh = 1 + rand() * 4.5;
      const { geo } = buildCrystal(rand, {
        sides: 5 + Math.floor(rand() * 2),
        w: 0.8 + rand() * 1.4,
        d: 0.8 + rand() * 1.4,
        h: hh,
        taper: 0.35 + rand() * 0.3,
        apex: 0.7 + rand() * 1.8,
        lean: [(rand() - 0.5) * 0.6, (rand() - 0.5) * 0.6],
        apexOff: [(rand() - 0.5) * 0.8, (rand() - 0.5) * 0.8],
      });
      shards.push(
        place(geo, x, terrainHeight(x, z) - 0.4, z, rand() * 6.28, (rand() - 0.5) * 0.5, (rand() - 0.5) * 0.5)
      );
    }
  }

  return {
    towers: mergeGeometries(towers, false)!,
    shards: mergeGeometries(shards, false)!,
  };
}

/** Один осколок для взрыва (инстансинг) */
export function buildDebrisGeometry() {
  const rand = mulberry32(99);
  const { geo } = buildCrystal(rand, {
    sides: 4,
    w: 0.5,
    d: 0.35,
    h: 1.2,
    taper: 0.5,
    apex: 0.8,
    apexOff: [0.1, 0.05],
  });
  geo.translate(0, -0.6, 0);
  return geo;
}
