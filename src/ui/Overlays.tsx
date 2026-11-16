import { useMemo, useRef, useState } from "react";
import { T_BOOM, T_LOGO } from "../intro/config";
import { clamp, lerp, smoothstep, easeOutCubic } from "../intro/math";
import type { Config, Layer } from "../intro/schema";
import { hash2, useTime } from "./store";

const fmt = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

// ───────────────────────────── текст ─────────────────────────────
function TextLayer({ layer, z }: { layer: Layer; z: number }) {
  const s = layer.s;
  const sRef = useRef(s);
  sRef.current = s;
  const root = useRef<HTMLDivElement>(null);
  const spans = useRef<(HTMLSpanElement | null)[]>([]);
  const text = s.upper ? String(s.text).toUpperCase() : String(s.text);
  const chars = useMemo(() => Array.from(text), [text]);

  useTime(
    (t) => {
      const el = root.current;
      if (!el) return;
      const c = sRef.current;
      const ref0 = c.anchor === "start" ? 0 : c.anchor === "boom" ? T_BOOM : T_LOGO;
      const lt = t - ref0 - c.delay;
      const p = clamp(lt / Math.max(0.05, c.duration));
      const out = c.outAt > 0 ? smoothstep(c.outAt, c.outAt + c.outDur, lt) : 0;
      const n = chars.length;
      const e0 = easeOutCubic(p);
      const sp = lerp(c.spacingFrom, c.spacing, e0);
      const st = clamp(c.anim === "typewriter" ? 1 : c.stagger, 0, 1.5) * 0.85;
      const q = Math.floor(t * 24);
      const visible = lt > 0 && out < 1;
      el.style.visibility = visible ? "visible" : "hidden";
      if (!visible) return;
      el.style.letterSpacing = `${sp}em`;
      el.style.paddingLeft = `${sp}em`;
      el.style.opacity = String(c.opacity * (1 - out));
      const sweep = (t * c.shimmerSpeed) % 1.7 - 0.35;
      const sweepOn = c.shimmer > 0 ? smoothstep(0.5, 1, p) : 0;
      for (let i = 0; i < n; i++) {
        const sp_ = spans.current[i];
        if (!sp_) continue;
        const u = n > 1 ? i / (n - 1) : 0.5;
        const pi = st >= 1 ? clamp((p - u * 0.99) / 0.01) : clamp((p - st * u) / (1 - st));
        const e = easeOutCubic(pi);
        let o = e,
          tx = 0,
          ty = 0,
          sc = 1,
          b = 0,
          clip = "";
        switch (c.anim) {
          case "lettersRise":
            ty = (1 - e) * 0.5;
            b = (1 - e) * c.blur;
            break;
          case "blurIn":
            b = (1 - e) * c.blur;
            sc = 1 + (1 - e) * 0.06;
            break;
          case "maskUp":
            o = pi > 0 ? 1 : 0;
            ty = (1 - e) * 0.5;
            clip = `inset(0 0 ${(1 - e) * 100}% 0)`;
            break;
          case "typewriter":
            o = pi > 0.001 ? 1 : 0;
            break;
          case "scaleIn":
            sc = 1 + (1 - e) * 1.2;
            b = (1 - e) * c.blur;
            break;
          case "glitch":
            if (pi <= 0) o = 0;
            else if (pi >= 1) o = 1;
            else {
              o = hash2(i, q) > 0.45 ? 1 : 0.15;
              tx = (hash2(i + 7, q) - 0.5) * (1 - pi) * 0.7;
            }
            break;
          case "fade":
            break;
          default: // trackIn
            b = (1 - e) * c.blur;
        }
        const sh = Math.exp(-Math.pow((u - sweep) / 0.1, 2)) * c.shimmer * sweepOn;
        sp_.style.opacity = String(o);
        sp_.style.transform = `translate(${tx}em, ${ty}em) scale(${sc})`;
        sp_.style.clipPath = clip || "none";
        sp_.style.filter = b > 0.05 || sh > 0.01 ? `${b > 0.05 ? `blur(${b}px) ` : ""}brightness(${1 + sh * 1.1})` : "none";
      }
    },
    [chars.length]
  );

  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: `${s.x}%`, top: `${s.y}%`, transform: "translate(-50%,-50%)", zIndex: z, whiteSpace: "pre" }}
    >
      <div
        ref={root}
        style={{
          fontFamily: s.font,
          fontWeight: s.weight,
          fontSize: `${s.size}vw`,
          lineHeight: 1.15,
          visibility: "hidden",
          filter: s.glow > 0 ? `drop-shadow(0 0 ${s.glow}px ${s.glowColor})` : "none",
          textAlign: "center",
        }}
      >
        {chars.map((ch, i) => (
          <span
            key={i}
            ref={(el) => {
              spans.current[i] = el;
            }}
            style={{
              display: "inline-block",
              whiteSpace: "pre",
              background: `linear-gradient(to bottom, ${s.color1}, ${s.color2})`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              WebkitTextFillColor: "transparent",
              paddingBottom: "0.08em",
            }}
          >
            {ch === " " ? "\u00A0" : ch}
          </span>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────────── полосы ─────────────────────────────
function BarsLayer({ layer, z }: { layer: Layer; z: number }) {
  const sRef = useRef(layer.s);
  sRef.current = layer.s;
  const top = useRef<HTMLDivElement>(null);
  const bot = useRef<HTMLDivElement>(null);
  useTime((t) => {
    const c = sRef.current;
    const h =
      c.height * smoothstep(0, Math.max(0.05, c.inDur), t) *
      (c.keep ? 1 : 1 - smoothstep(T_BOOM + c.outAfter, T_BOOM + c.outAfter + c.outDur, t));
    if (top.current) top.current.style.height = `${h}vh`;
    if (bot.current) bot.current.style.height = `${h}vh`;
  });
  return (
    <>
      <div ref={top} className="pointer-events-none absolute inset-x-0 top-0" style={{ zIndex: z, background: layer.s.color }} />
      <div ref={bot} className="pointer-events-none absolute inset-x-0 bottom-0" style={{ zIndex: z, background: layer.s.color }} />
    </>
  );
}

// ───────────────────────────── HUD ─────────────────────────────
function HudLayer({ layer, z, duration, onReplay }: { layer: Layer; z: number; duration: number; onReplay: () => void }) {
  const sRef = useRef(layer.s);
  sRef.current = layer.s;
  const durRef = useRef(duration);
  durRef.current = duration;
  const hud = useRef<HTMLDivElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const prog = useRef<HTMLDivElement>(null);
  const lastSec = useRef(-1);
  const [canReplay, setCanReplay] = useState(false);
  const shown = useRef(false);
  useTime((t) => {
    const c = sRef.current;
    if (prog.current) prog.current.style.transform = `scaleX(${clamp(t / durRef.current)})`;
    if (hud.current) hud.current.style.opacity = String(c.hideAfterLogo ? 0.8 * (1 - smoothstep(T_LOGO + 2, T_LOGO + 4, t)) + 0.15 : 0.9);
    const sec = Math.floor(t);
    if (sec !== lastSec.current) {
      lastSec.current = sec;
      if (time.current) time.current.textContent = fmt(t);
    }
    const show = t > T_LOGO + 6;
    if (show !== shown.current) {
      shown.current = show;
      setCanReplay(show);
    }
  });
  const col = layer.s.color;
  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: z }}>
      {layer.s.time && (
        <div ref={hud} className="absolute bottom-5 left-6 flex items-center gap-3 font-mono text-[10px] tracking-[0.3em]" style={{ color: col }}>
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: col, boxShadow: `0 0 8px 2px ${col}` }} />
          <span ref={time}>00:00</span>
        </div>
      )}
      {layer.s.progress && (
        <div className="absolute inset-x-0 bottom-0 h-px bg-white/10">
          <div ref={prog} className="h-px origin-left" style={{ transform: "scaleX(0)", background: `linear-gradient(90deg, transparent, ${col})` }} />
        </div>
      )}
      {layer.s.replay && (
        <button
          onClick={onReplay}
          className={`pointer-events-auto absolute right-6 bottom-5 rounded-full border bg-black/30 px-5 py-2 font-mono text-[10px] tracking-[0.3em] uppercase backdrop-blur transition-all duration-700 hover:bg-white/10 ${canReplay ? "opacity-100" : "pointer-events-none opacity-0"}`}
          style={{ color: col, borderColor: `${col}66` }}
        >
          ↻ Повторить
        </button>
      )}
    </div>
  );
}

// ───────────────────────────── стек 2D-слоёв ─────────────────────────────
export function Overlays({ cfg, onReplay }: { cfg: Config; onReplay: () => void }) {
  const N = cfg.layers.length;
  return (
    <>
      {cfg.layers.map((L, i) => {
        if (!L.on) return null;
        const z = 10 + (N - i);
        if (L.type === "text") return <TextLayer key={L.id} layer={L} z={z} />;
        if (L.type === "bars") return <BarsLayer key={L.id} layer={L} z={z} />;
        if (L.type === "hud") return <HudLayer key={L.id} layer={L} z={z} duration={cfg.g.duration} onReplay={onReplay} />;
        return null;
      })}
    </>
  );
}
