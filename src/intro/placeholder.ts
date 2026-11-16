import * as THREE from "three";

/** Красивая заглушка «VIDEO 0N» для грани кристалла */
export function makePlaceholderTexture(
  idx: number,
  aspect: number,
  shape: [number, number][],
  maxAniso: number
) {
  const W = 512;
  const H = Math.round(Math.min(1100, Math.max(420, W / aspect)));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;

  const bg = g.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, "#3a210a");
  bg.addColorStop(0.55, "#1a0d04");
  bg.addColorStop(1, "#0a0502");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // сетка
  g.strokeStyle = "rgba(255,190,90,0.07)";
  g.lineWidth = 1;
  for (let x = 0; x <= W; x += 32) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }
  for (let y = 0; y <= H; y += 32) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }

  // диагональные грани-блики
  const diag = g.createLinearGradient(0, H, W, 0);
  diag.addColorStop(0, "rgba(255,170,60,0)");
  diag.addColorStop(0.5, "rgba(255,190,90,0.13)");
  diag.addColorStop(1, "rgba(255,170,60,0)");
  g.fillStyle = diag;
  g.beginPath();
  g.moveTo(0, H * 0.7);
  g.lineTo(W, H * 0.12);
  g.lineTo(W, H * 0.4);
  g.lineTo(0, H);
  g.closePath();
  g.fill();

  // номер
  const num = String(idx + 1).padStart(2, "0");
  const ng = g.createLinearGradient(0, H * 0.18, 0, H * 0.55);
  ng.addColorStop(0, "#fff0c4");
  ng.addColorStop(1, "#d99a2b");
  g.fillStyle = ng;
  g.font = `200 ${Math.round(W * 0.46)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(num, W / 2, H * 0.36);

  // подпись
  g.font = `500 ${Math.round(W * 0.052)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  g.fillStyle = "rgba(255,214,140,0.9)";
  try {
    (g as unknown as { letterSpacing: string }).letterSpacing = `${Math.round(W * 0.018)}px`;
  } catch {
    /* noop */
  }
  g.fillText("VIDEO", W / 2, H * 0.6);
  g.fillStyle = "rgba(255,190,90,0.45)";
  g.font = `400 ${Math.round(W * 0.034)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  g.fillText("PLACEHOLDER  1920×1080", W / 2, H * 0.655);

  // кнопка play
  const cx = W / 2;
  const cy = H * 0.8;
  const r = W * 0.085;
  g.lineWidth = 3;
  g.strokeStyle = "rgba(255,206,110,0.95)";
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "rgba(255,214,140,0.95)";
  g.beginPath();
  g.moveTo(cx - r * 0.28, cy - r * 0.45);
  g.lineTo(cx + r * 0.52, cy);
  g.lineTo(cx - r * 0.28, cy + r * 0.45);
  g.closePath();
  g.fill();

  // контур по форме грани
  g.strokeStyle = "rgba(255,200,100,0.95)";
  g.lineWidth = 6;
  g.lineJoin = "miter";
  g.beginPath();
  shape.forEach(([u, v], i) => {
    const x = u * W;
    const y = (1 - v) * H;
    const ix = x + (0.5 - u) * 16;
    const iy = y + (0.5 - (1 - v)) * 16;
    if (i === 0) g.moveTo(ix, iy);
    else g.lineTo(ix, iy);
  });
  g.closePath();
  g.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export function makeVideoTexture(src: string, maxAniso: number) {
  const video = document.createElement("video");
  video.src = src;
  video.crossOrigin = "anonymous";
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return { tex, video };
}
