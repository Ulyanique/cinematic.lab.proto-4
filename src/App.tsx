import { useCallback, useEffect, useRef, useState } from "react";
import { IntroEngine } from "./intro/engine";
import { BRAND, TAGLINE, T_BOOM, T_LOGO } from "./intro/config";
import { smoothstep } from "./intro/math";

const fmt = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export default function App() {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<IntroEngine | null>(null);
  const brandRef = useRef<HTMLDivElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);
  const topBar = useRef<HTMLDivElement>(null);
  const botBar = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const progRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [canReplay, setCanReplay] = useState(false);
  const replayShown = useRef(false);

  const replay = useCallback(() => {
    engine.current?.restart();
    replayShown.current = false;
    setCanReplay(false);
  }, []);

  useEffect(() => {
    if (!host.current) return;
    const params = new URLSearchParams(window.location.search);
    const startAt = parseFloat(params.get("t") ?? "0") || 0;
    const total = T_LOGO + 8;
    let lastTime = -1;

    try {
      const eng = new IntroEngine(host.current, {
        startAt,
        onTime: (t) => {
          // лёгкий HUD напрямую в DOM — без перерисовок React
          const bars = 6.2 * smoothstep(0, 1.2, t) * (1 - smoothstep(T_BOOM + 0.2, T_BOOM + 3.2, t));
          if (topBar.current) topBar.current.style.height = `${bars}vh`;
          if (botBar.current) botBar.current.style.height = `${bars}vh`;

          const b = smoothstep(T_LOGO + 3.0, T_LOGO + 5.2, t);
          if (brandRef.current) {
            brandRef.current.style.opacity = String(b);
            brandRef.current.style.letterSpacing = `${0.9 - 0.35 * b}em`;
            brandRef.current.style.transform = `translateY(${(1 - b) * 10}px)`;
          }
          if (tagRef.current) tagRef.current.style.opacity = String(smoothstep(T_LOGO + 4.2, T_LOGO + 6.2, t) * 0.8);

          if (progRef.current) progRef.current.style.transform = `scaleX(${Math.min(1, t / total)})`;
          if (hudRef.current) hudRef.current.style.opacity = String(0.8 * (1 - smoothstep(T_LOGO + 2, T_LOGO + 4, t)) + 0.15);
          const sec = Math.floor(t);
          if (sec !== lastTime) {
            lastTime = sec;
            if (timeRef.current) timeRef.current.textContent = fmt(t);
          }
          const show = t > T_LOGO + 6;
          if (show !== replayShown.current) {
            replayShown.current = show;
            setCanReplay(show);
          }
        },
      });
      engine.current = eng;
      (window as unknown as { __intro: IntroEngine }).__intro = eng;
      return () => {
        eng.dispose();
        engine.current = null;
      };
    } catch (e) {
      console.error(e);
      setError("Не удалось запустить WebGL. Попробуйте другой браузер или включите аппаратное ускорение.");
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R" || e.key === "к" || e.key === "К") replay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [replay]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black select-none">
      <div ref={host} className="absolute inset-0" />

      {/* кинематографические полосы */}
      <div ref={topBar} className="pointer-events-none absolute inset-x-0 top-0 bg-black" style={{ height: 0 }} />
      <div ref={botBar} className="pointer-events-none absolute inset-x-0 bottom-0 bg-black" style={{ height: 0 }} />

      {/* HUD */}
      <div
        ref={hudRef}
        className="pointer-events-none absolute left-6 bottom-5 flex items-center gap-3 font-mono text-[10px] tracking-[0.3em] text-amber-200/70"
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_8px_2px_rgba(255,190,80,0.8)]" />
        <span ref={timeRef}>00:00</span>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-amber-100/10">
        <div
          ref={progRef}
          className="h-px origin-left bg-gradient-to-r from-amber-700 via-amber-300 to-amber-100"
          style={{ transform: "scaleX(0)" }}
        />
      </div>

      {/* титры */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[5vh] flex flex-col items-center gap-3 text-center">
        <div
          ref={brandRef}
          className="bg-gradient-to-b from-amber-50 via-amber-200 to-amber-500 bg-clip-text text-[clamp(28px,4.2vw,64px)] font-extralight uppercase text-transparent"
          style={{
            opacity: 0,
            letterSpacing: "0.9em",
            paddingLeft: "0.9em",
            filter: "drop-shadow(0 0 18px rgba(255,170,50,0.45))",
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          }}
        >
          {BRAND}
        </div>
        <div
          ref={tagRef}
          className="text-[clamp(9px,0.9vw,13px)] font-light uppercase text-amber-200/80"
          style={{ opacity: 0, letterSpacing: "0.5em", paddingLeft: "0.5em" }}
        >
          {TAGLINE}
        </div>
      </div>

      {/* повтор */}
      <button
        onClick={replay}
        className={`absolute right-6 bottom-5 rounded-full border border-amber-300/40 bg-black/30 px-5 py-2 font-mono text-[10px] uppercase tracking-[0.3em] text-amber-200 backdrop-blur transition-all duration-700 hover:border-amber-200 hover:bg-amber-300/10 hover:text-amber-50 ${
          canReplay ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        ↻ Повторить
      </button>

      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-amber-200">{error}</div>
      )}
    </div>
  );
}
