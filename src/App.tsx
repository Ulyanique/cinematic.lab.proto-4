import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IntroEngine } from "./intro/engine";
import {
  LAYER_TYPES,
  defaultConfig,
  makeLayer,
  newId,
  normalizeConfig,
  type Config,
  type LayerTypeId,
} from "./intro/schema";
import { Overlays } from "./ui/Overlays";
import {
  CompositionPanel,
  IconGear,
  IconLayers,
  IconPause,
  IconPlay,
  IconRestart,
  SettingsPanel,
  ToolBtn,
  type Api,
  type Tab,
} from "./ui/Panels";
import { loadConfig, saveConfig, timeBus, useTime } from "./ui/store";

declare global {
  interface Window {
    __intro?: IntroEngine;
    __lab?: { getCfg: () => Config; replace: (c: unknown) => string | null; engine: () => IntroEngine | null };
  }
}

export default function App() {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<IntroEngine | null>(null);
  const [cfg, setCfg] = useState<Config>(loadConfig);
  const cfgRef = useRef(cfg);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>("logo");
  const [openSet, setOpenSet] = useState(false);
  const [openComp, setOpenComp] = useState(false);
  const [tab, setTab] = useState<Tab>("general");
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [uiVisible, setUiVisible] = useState(params.get("ui") !== "0");
  const [idle, setIdle] = useState(false);
  const [playing, setPlaying] = useState(false);

  // синхронная фиксация конфига (движок читает cfgRef каждый кадр)
  const commit = useCallback((fn: (c: Config) => Config) => {
    const next = fn(cfgRef.current);
    cfgRef.current = next;
    setCfg(next);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => saveConfig(cfg), 300);
    return () => clearTimeout(id);
  }, [cfg]);

  // ── движок ──
  useEffect(() => {
    if (!host.current) return;
    try {
      const g = cfgRef.current.g;
      const startAt = params.has("t") ? parseFloat(params.get("t") ?? "0") || 0 : g.startAt;
      const eng = new IntroEngine(host.current, {
        startAt,
        getCfg: () => cfgRef.current,
        onTime: (t, p) => timeBus.emit(t, p),
        paused: params.has("freeze") ? true : !g.autoplay,
      });
      engine.current = eng;
      window.__intro = eng;
      return () => {
        eng.dispose();
        engine.current = null;
      };
    } catch (e) {
      console.error(e);
      setError("Не удалось запустить WebGL. Попробуйте другой браузер или включите аппаратное ускорение.");
    }
  }, [params]);

  useTime((_, p) => setPlaying(p));

  // ── действия над композицией ──
  const api: Api = useMemo(
    () => ({
      cfg,
      selected,
      select: setSelected,
      setG: (k, v) => commit((c) => ({ ...c, g: { ...c.g, [k]: v } })),
      setS: (id, k, v) =>
        commit((c) => ({
          ...c,
          layers: c.layers.map((l) => {
            if (l.id !== id) return l;
            const def = LAYER_TYPES[l.type];
            let s = { ...l.s, [k]: v };
            if (def.presetKey === k) {
              const p = def.presets?.find((x) => x.key === v);
              if (p) s = { ...s, ...p.values };
            }
            return { ...l, s };
          }),
        })),
      patchLayer: (id, p) => commit((c) => ({ ...c, layers: c.layers.map((l) => (l.id === id ? { ...l, ...p } : l)) })),
      move: (from, to) =>
        commit((c) => {
          const arr = [...c.layers];
          const [it] = arr.splice(from, 1);
          arr.splice(to, 0, it);
          return { ...c, layers: arr };
        }),
      add: (t: LayerTypeId) => {
        const L = makeLayer(t, t === "text" ? "Новый текст" : t === "logo" ? "Новый логотип" : undefined, t === "text" ? { text: "TITLE", y: 50, delay: 0, anchor: "logo" } : {});
        commit((c) => ({ ...c, layers: [L, ...c.layers] }));
        setSelected(L.id);
      },
      dup: (id) => {
        const nid = newId("copy");
        commit((c) => {
          const i = c.layers.findIndex((l) => l.id === id);
          if (i < 0) return c;
          const src = c.layers[i];
          const copy = { ...src, id: nid, name: src.name + " копия", s: { ...src.s } };
          const arr = [...c.layers];
          arr.splice(i, 0, copy);
          return { ...c, layers: arr };
        });
        setSelected(nid);
      },
      remove: (id) => {
        commit((c) => ({ ...c, layers: c.layers.filter((l) => l.id !== id) }));
        setSelected((s) => (s === id ? null : s));
      },
      replace: (inp) => {
        if (!inp || typeof inp !== "object" || (!("layers" in (inp as object)) && !("g" in (inp as object)))) return "Неверный формат: ожидался объект с полями g и layers";
        const n = normalizeConfig(inp);
        commit(() => n);
        setSelected((s) => (n.layers.some((l) => l.id === s) ? s : (n.layers[0]?.id ?? null)));
        return null;
      },
      reset: () => commit(() => defaultConfig()),
      seek: (t) => engine.current?.seek(t),
      toggle: () => engine.current?.toggle(),
      restart: () => engine.current?.restart(),
    }),
    [cfg, selected, commit]
  );

  useEffect(() => {
    window.__lab = { getCfg: () => cfgRef.current, replace: api.replace, engine: () => engine.current };
  }, [api.replace]);

  // ── горячие клавиши и авто-скрытие тулбара ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && (el as HTMLInputElement).type !== "range") return;
      const k = e.key.toLowerCase();
      if (e.code === "Space") {
        e.preventDefault();
        engine.current?.toggle();
      } else if (k === "r" || k === "к") engine.current?.restart();
      else if (k === "h" || k === "р") setUiVisible((v) => !v);
      else if (k === "s" || k === "ы") setOpenSet((v) => !v);
      else if (k === "c" || k === "с") setOpenComp((v) => !v);
      else if (e.key === "ArrowRight") engine.current?.seek((engine.current?.time ?? 0) + 2);
      else if (e.key === "ArrowLeft") engine.current?.seek(Math.max(0, (engine.current?.time ?? 0) - 2));
    };
    let timer = 0;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), 3200);
    };
    wake();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      clearTimeout(timer);
    };
  }, []);

  const replay = useCallback(() => engine.current?.restart(), []);
  const dim = idle && !openSet && !openComp;

  return (
    <div className="fixed inset-0 overflow-hidden bg-black select-none" style={{ cursor: idle && !openSet && !openComp ? "none" : "default" }}>
      <div ref={host} className="absolute inset-0" />

      <Overlays cfg={cfg} onReplay={replay} />

      {/* UI */}
      {uiVisible && (
        <div className="pointer-events-none fixed inset-0" style={{ zIndex: 1000 }}>
          <div
            className={`pointer-events-auto fixed top-4 right-4 flex items-center gap-0.5 rounded-full border border-white/10 bg-black/40 p-1 text-white backdrop-blur-md transition-opacity duration-700 ${
              dim ? "opacity-0 hover:opacity-100" : "opacity-100"
            }`}
          >
            <ToolBtn onClick={() => engine.current?.toggle()} title="Пауза / воспроизведение (Space)">
              {playing ? <IconPause /> : <IconPlay />}
            </ToolBtn>
            <ToolBtn onClick={replay} title="С начала (R)">
              <IconRestart />
            </ToolBtn>
            <div className="mx-0.5 h-4 w-px bg-white/15" />
            <ToolBtn active={openComp} onClick={() => setOpenComp((v) => !v)} title="Композиция — слои (C)">
              <IconLayers />
            </ToolBtn>
            <ToolBtn active={openSet} onClick={() => setOpenSet((v) => !v)} title="Настройки (S)">
              <IconGear />
            </ToolBtn>
          </div>

          {openComp && <CompositionPanel api={api} onClose={() => setOpenComp(false)} onOpenLayer={() => { setOpenSet(true); setTab("layer"); }} />}
          {openSet && <SettingsPanel api={api} tab={tab} setTab={setTab} onClose={() => setOpenSet(false)} />}
        </div>
      )}

      {error && <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-amber-200">{error}</div>}
    </div>
  );
}
