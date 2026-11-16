import { DEG } from "./math";
import { T_BOOM } from "./config";

type V3 = [number, number, number];
interface Key {
  t: number;
  p: V3;
  l: V3;
  fov: number;
  roll: number;
}

const pol = (deg: number, r: number, y: number): V3 => [
  Math.cos(deg * DEG) * r,
  y,
  Math.sin(deg * DEG) * r,
];

// ─────────────────────────── ключевые кадры ───────────────────────────
const keys: Key[] = [];
const K = (t: number, p: V3, l: V3, fov: number, roll = 0) => keys.push({ t, p, l, fov, roll });

// A · низкий пролёт над золотой долиной между башнями
K(0.0, pol(112, 175, 7.5), pol(100, 120, 17), 46, 0);
K(2.6, pol(104, 138, 5.2), pol(96, 92, 15), 46, 0.02);
K(5.0, pol(97, 102, 3.8), pol(95, 62, 11), 44, -0.03);
K(7.4, pol(98, 72, 4.6), pol(112, 40, 9), 43, -0.05);
K(9.0, pol(100, 52, 6.0), pol(126, 22, 7.5), 42, -0.09);

// B · внешний облёт колец — кристаллы вырастают из земли
K(11.0, pol(150, 38, 8.0), pol(186, 14, 6.5), 41, -0.14);
K(13.0, pol(222, 32, 9.0), pol(256, 10, 6.5), 40, -0.15);
K(15.0, pol(300, 28.5, 6.8), pol(326, 12, 6.2), 41, -0.06);

// Прыжок внутрь кольца через «ворота» между кристаллами
K(16.1, pol(313, 19.5, 5.6), pol(340, 9, 5.6), 46, 0.02);

// C · облёт внутри кольца, взгляд на грани-экраны
const C0 = 17.3;
const CN = 8;
for (let k = 0; k <= CN; k++) {
  const ang = 330 + 45 * k;
  const r = 8.6 + 0.7 * Math.sin(k * 1.3);
  const y = 5.0 + 1.5 * Math.sin(k * 1.1 + 0.5);
  K(
    C0 + k * 1.15,
    pol(ang, r, y),
    pol(ang + 34, 15.5, 5.6 + 1.4 * Math.sin(k * 0.9)),
    k < 2 ? 50 : 52,
    k === 0 ? 0 : 0.07 * Math.sin(k * 1.7)
  );
}
// D · закручивающийся рывок к центру
K(27.7, pol(735, 6.8, 4.7), pol(795, 5, 4.6), 62, 0.12);
K(29.1, pol(780, 4.6, 4.45), [0, 4.35, 0], 76, 0.22);
K(T_BOOM, pol(810, 3.0, 4.3), [0, 4.3, 0], 88, 0.28);

// Взрыв → отлёт камеры → титры
K(T_BOOM + 1.1, [0, 3.8, 6.4], [0, 4.6, 0], 66, 0.05);
K(T_BOOM + 3.4, [0, 4.6, 11.8], [0, 4.8, 0], 46, 0);
K(T_BOOM + 6.5, [0, 4.8, 15.2], [0, 4.8, 0], 40, 0);
K(T_BOOM + 16, [0, 4.9, 14.0], [0, 4.8, 0], 40, 0);
K(T_BOOM + 40, [0, 5.0, 13.4], [0, 4.8, 0], 40, 0);

// ─────────────────────── интерполяция Эрмита ──────────────────────────
function tangent(get: (k: Key) => number, i: number) {
  const n = keys.length;
  if (i === 0) return (get(keys[1]) - get(keys[0])) / (keys[1].t - keys[0].t);
  if (i === n - 1)
    return (get(keys[n - 1]) - get(keys[n - 2])) / (keys[n - 1].t - keys[n - 2].t);
  return (get(keys[i + 1]) - get(keys[i - 1])) / (keys[i + 1].t - keys[i - 1].t);
}

function sample(t: number, get: (k: Key) => number) {
  const n = keys.length;
  if (t <= keys[0].t) return get(keys[0]);
  if (t >= keys[n - 1].t) return get(keys[n - 1]);
  let i = 0;
  while (i < n - 2 && t >= keys[i + 1].t) i++;
  const k0 = keys[i];
  const k1 = keys[i + 1];
  const h = k1.t - k0.t;
  const u = (t - k0.t) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  const p0 = get(k0);
  const p1 = get(k1);
  const m0 = tangent(get, i) * h;
  const m1 = tangent(get, i + 1) * h;
  return (
    (2 * u3 - 3 * u2 + 1) * p0 +
    (u3 - 2 * u2 + u) * m0 +
    (-2 * u3 + 3 * u2) * p1 +
    (u3 - u2) * m1
  );
}

export interface CamState {
  p: V3;
  l: V3;
  fov: number;
  roll: number;
}

export function cameraAt(t: number): CamState {
  return {
    p: [sample(t, (k) => k.p[0]), sample(t, (k) => k.p[1]), sample(t, (k) => k.p[2])],
    l: [sample(t, (k) => k.l[0]), sample(t, (k) => k.l[1]), sample(t, (k) => k.l[2])],
    fov: sample(t, (k) => k.fov),
    roll: sample(t, (k) => k.roll),
  };
}

// Полилиния пути камеры (XZ) — для коридора в рельефе и обхода препятствий
export const pathSamples: { x: number; z: number }[] = [];
for (let t = 0; t <= 17.5; t += 0.4) {
  const c = cameraAt(t);
  pathSamples.push({ x: c.p[0], z: c.p[2] });
}

export function distToPath(x: number, z: number) {
  let m = 1e9;
  for (let i = 0; i < pathSamples.length; i++) {
    const dx = x - pathSamples[i].x;
    const dz = z - pathSamples[i].z;
    const d = dx * dx + dz * dz;
    if (d < m) m = d;
  }
  return Math.sqrt(m);
}

/** Момент входа камеры внутрь кольца (r падает ниже порога) и угол входа */
export function ringCrossing(radius = 15.5) {
  for (let t = 15; t < 20; t += 0.01) {
    const c = cameraAt(t);
    if (Math.hypot(c.p[0], c.p[2]) < radius) {
      return { t, angle: Math.atan2(c.p[2], c.p[0]) };
    }
  }
  return { t: 16.4, angle: 0 };
}

/** Угол камеры (рад) во времени */
export function cameraAngle(t: number) {
  const c = cameraAt(t);
  return Math.atan2(c.p[2], c.p[0]);
}
