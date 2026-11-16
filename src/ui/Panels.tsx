import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  GLOBAL_FIELDS,
  LAYER_TYPES,
  LAYER_TYPE_IDS,
  type Config,
  type Layer,
  type LayerTypeId,
} from "../intro/schema";
import { FieldList } from "./Controls";
import { useTime } from "./store";

export interface Api {
  getCfg: () => Config;
  setG: (k: string, v: any) => void;
  setS: (id: string, k: string, v: any) => void;
  patchLayer: (id: string, p: Partial<Pick<Layer, "name" | "on">>) => void;
  move: (from: number, to: number) => void;
  add: (t: LayerTypeId) => void;
  dup: (id: string) => void;
  remove: (id: string) => void;
  replace: (c: unknown) => string | null;
  reset: () => void;
  selected: string | null;
  select: (id: string | null) => void;
  seek: (t: number) => void;
  toggle: () => void;
  restart: () => void;
}

// ───────────────────────────── иконки ─────────────────────────────
const I = ({ children, size = 16 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
export const IconGear = () => (
  <I>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </I>
);
export const IconLayers = () => (
  <I>
    <path d="M12 3 3 8l9 5 9-5-9-5z" />
    <path d="m3 13 9 5 9-5" />
    <path d="m3 17.5 9 5 9-5" opacity=".5" />
  </I>
);
export const IconPlay = () => (
  <I>
    <path d="M7 4.5v15l12-7.5-12-7.5z" />
  </I>
);
export const IconPause = () => (
  <I>
    <path d="M8 5v14M16 5v14" />
  </I>
);
export const IconRestart = () => (
  <I>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </I>
);
const IconEye = ({ on }: { on: boolean }) => (
  <I size={14}>
    {on ? (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ) : (
      <>
        <path d="M3 3l18 18" />
        <path d="M10.6 6.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.1 4M6.6 6.7A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.2-1" />
      </>
    )}
  </I>
);

export function ToolBtn({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${active ? "bg-amber-300/20 text-amber-200" : "text-white/70 hover:bg-white/10 hover:text-white"}`}
    >
      {children}
    </button>
  );
}

// ───────────────────────────── плавающая панель ─────────────────────────────
export function FloatPanel({
  title,
  x,
  y,
  width = 340,
  onClose,
  children,
  z = 100,
  right,
}: {
  title: string;
  x: number;
  y: number;
  width?: number;
  onClose: () => void;
  children: ReactNode;
  z?: number;
  right?: boolean;
}) {
  const [pos, setPos] = useState(() => ({ x: right ? Math.max(8, window.innerWidth - width - x) : x, y }));
  const [collapsed, setCollapsed] = useState(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setPos({
      x: Math.min(window.innerWidth - 60, Math.max(-width + 80, e.clientX - drag.current.dx)),
      y: Math.min(window.innerHeight - 40, Math.max(0, e.clientY - drag.current.dy)),
    });
  };
  const onUp = () => (drag.current = null);
  const onCancel = () => (drag.current = null);

  // переклеmpiт позицию при ресайзе окна, чтобы панель не застряла за экраном
  useEffect(() => {
    const onResize = () => {
      setPos((p) => ({
        x: Math.min(window.innerWidth - 60, Math.max(-width + 80, right ? Math.max(8, window.innerWidth - width - p.x) : p.x)),
        y: Math.min(window.innerHeight - 40, Math.max(0, p.y)),
      }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [width, right]);

  return (
    <div
      className="pointer-events-auto fixed flex flex-col overflow-hidden rounded-xl border border-white/10 bg-black/55 text-white opacity-80 shadow-2xl shadow-black/50 backdrop-blur-xl transition-opacity duration-300 hover:opacity-100 focus-within:opacity-100"
      style={{ left: pos.x, top: pos.y, width, zIndex: z, maxHeight: `calc(100vh - ${pos.y + 12}px)` }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        className="flex shrink-0 cursor-grab items-center justify-between border-b border-white/10 px-3 py-2 select-none active:cursor-grabbing"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
      >
        <div className="text-[10px] font-semibold tracking-[0.25em] text-amber-200 uppercase">{title}</div>
        <div className="flex items-center gap-1 text-white/50">
          <button onClick={() => setCollapsed(!collapsed)} className="px-1.5 text-sm leading-none hover:text-white" title="Свернуть">
            {collapsed ? "▢" : "–"}
          </button>
          <button onClick={onClose} className="px-1.5 text-sm leading-none hover:text-white" title="Закрыть">
            ✕
          </button>
        </div>
      </div>
      {!collapsed && <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 [scrollbar-width:thin]">{children}</div>}
    </div>
  );
}

// ───────────────────────────── плеер ─────────────────────────────
function Scrubber({ api }: { api: Api }) {
  const input = useRef<HTMLInputElement>(null);
  const lab = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  const dur = api.getCfg().g.duration;
  useTime(
    (t, p) => {
      if (input.current && document.activeElement !== input.current) input.current.value = String(Math.min(t, dur));
      if (lab.current) lab.current.textContent = `${t.toFixed(1)} / ${dur}с`;
      setPlaying(p);
    },
    [dur]
  );
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5">
      <ToolBtn onClick={api.toggle} title="Пауза / воспроизведение (Space)">
        {playing ? <IconPause /> : <IconPlay />}
      </ToolBtn>
      <ToolBtn onClick={api.restart} title="С начала (R)">
        <IconRestart />
      </ToolBtn>
      <input ref={input} type="range" className="rng min-w-0 flex-1" min={0} max={dur} step={0.05} defaultValue={0} onInput={(e) => api.seek(parseFloat((e.target as HTMLInputElement).value))} />
      <span ref={lab} className="w-[74px] shrink-0 text-right font-mono text-[10px] text-white/50" />
    </div>
  );
}

// ───────────────────────────── JSON ─────────────────────────────
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

const btn =
  "rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/80 transition-colors hover:border-amber-300/40 hover:bg-amber-300/10 hover:text-amber-100";

function JsonTab({ api }: { api: Api }) {
  const text = useMemo(() => JSON.stringify(api.getCfg(), null, 2), [api.getCfg()]);
  const [draft, setDraft] = useState(text);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!dirty) setDraft(text);
  }, [text, dirty]);
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 3200);
    return () => clearTimeout(id);
  }, [msg]);

  const apply = (src: string) => {
    try {
      const err = api.replace(JSON.parse(src));
      if (err) setMsg({ ok: false, t: err });
      else {
        setDirty(false);
        setMsg({ ok: true, t: "Настройки применены" });
      }
    } catch (e) {
      setMsg({ ok: false, t: "Ошибка JSON: " + (e as Error).message });
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-[11px] leading-snug text-white/50">Скопируйте JSON и отправьте — вставьте его сюда и нажмите «Применить», чтобы получить точно такую же композицию.</div>
      <div className="flex flex-wrap gap-1.5">
        <button
          className={btn}
          onClick={async () => setMsg({ ok: await copyText(dirty ? draft : text), t: "Скопировано в буфер обмена" })}
        >
          Копировать
        </button>
        <button className={btn} onClick={async () => setMsg({ ok: await copyText(JSON.stringify(api.getCfg())), t: "Скопирован компактный JSON" })}>
          Компактно
        </button>
        <button
          className={btn}
          onClick={() => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
            a.download = "cinematic-lab-composition.json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          }}
        >
          Скачать .json
        </button>
        <button className={btn} onClick={() => file.current?.click()}>
          Из файла
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) apply(await f.text());
            e.target.value = "";
          }}
        />
      </div>
      <textarea
        value={draft}
        spellCheck={false}
        onChange={(e) => {
          setDraft(e.target.value);
          setDirty(true);
        }}
        className="h-[300px] w-full resize-y rounded-md border border-white/10 bg-black/40 p-2 font-mono text-[10px] leading-snug text-amber-100/90 outline-none focus:border-amber-300/50"
      />
      <div className="flex items-center gap-1.5">
        <button className={`${btn} border-amber-300/40 text-amber-100`} onClick={() => apply(draft)}>
          Применить
        </button>
        <button
          className={btn}
          onClick={() => {
            setDraft(text);
            setDirty(false);
          }}
          disabled={!dirty}
        >
          Отмена
        </button>
        <button
          className={`${btn} ml-auto`}
          onClick={() => {
            if (confirm("Сбросить все настройки к значениям по умолчанию?")) {
              api.reset();
              setDirty(false);
            }
          }}
        >
          Сбросить всё
        </button>
      </div>
      {msg && <div className={`text-[11px] ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>{msg.t}</div>}
    </div>
  );
}

// ───────────────────────────── панель настроек ─────────────────────────────
export type Tab = "general" | "layer" | "json";

export function SettingsPanel({ api, tab, setTab, onClose }: { api: Api; tab: Tab; setTab: (t: Tab) => void; onClose: () => void }) {
  const layer = api.getCfg().layers.find((l) => l.id === api.selected) ?? null;
  const def = layer ? LAYER_TYPES[layer.type] : null;
  const tabs: [Tab, string][] = [
    ["general", "Общие"],
    ["layer", "Слой"],
    ["json", "JSON"],
  ];
  return (
    <FloatPanel title="Настройки" x={16} y={56} right onClose={onClose} width={348}>
      <div className="mb-2 flex gap-1 rounded-lg bg-white/5 p-0.5">
        {tabs.map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 rounded-md py-1 text-[11px] transition-colors ${tab === k ? "bg-amber-300/20 text-amber-100" : "text-white/50 hover:text-white/80"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "general" && (
        <>
          <Scrubber api={api} />
          <FieldList scope="g" fields={GLOBAL_FIELDS} values={api.getCfg().g} onChange={api.setG} />
        </>
      )}

      {tab === "layer" &&
        (layer && def ? (
          <>
            <div className="mb-2 flex items-center gap-2">
              <input
                value={layer.name}
                onChange={(e) => api.patchLayer(layer.id, { name: e.target.value })}
                className="min-w-0 flex-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-[12px] text-amber-100 outline-none focus:border-amber-300/50"
              />
              <button onClick={() => api.patchLayer(layer.id, { on: !layer.on })} className={`rounded p-1.5 ${layer.on ? "text-amber-200" : "text-white/30"}`} title="Включить / отключить слой">
                <IconEye on={layer.on} />
              </button>
            </div>
            <div className="mb-1 text-[10px] tracking-wider text-white/40 uppercase">
              {def.kind === "3d" ? "3D слой" : "2D слой"} · {def.label}
            </div>
            <FieldList scope={layer.id} fields={def.fields} values={layer.s} onChange={(k, v) => api.setS(layer.id, k, v)} />
          </>
        ) : (
          <div className="py-6 text-center text-[12px] text-white/40">Выберите слой в панели «Композиция»</div>
        ))}

      {tab === "json" && <JsonTab api={api} />}
    </FloatPanel>
  );
}

// ───────────────────────────── панель композиции ─────────────────────────────
export function CompositionPanel({ api, onClose, onOpenLayer }: { api: Api; onClose: () => void; onOpenLayer: () => void }) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const layers = api.getCfg().layers;
  const present = new Set(layers.map((l) => l.type));

  return (
    <FloatPanel title="Композиция" x={16} y={56} width={300} onClose={onClose}>
      <div className="mb-1.5 text-[10px] leading-snug text-white/40">Верх списка — передний план. Перетаскивайте слои, чтобы менять порядок.</div>
      <div className="space-y-1">
        {layers.map((L, i) => {
          const d = LAYER_TYPES[L.type];
          const sel = api.selected === L.id;
          return (
            <div
              key={L.id}
              draggable
              onDragStart={(e) => {
                setDragIdx(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIdx(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIdx !== null && dragIdx !== i) api.move(dragIdx, i);
                setDragIdx(null);
                setOverIdx(null);
              }}
              onDragEnd={() => {
                setDragIdx(null);
                setOverIdx(null);
              }}
              onClick={() => {
                api.select(L.id);
                onOpenLayer();
              }}
              className={`group flex cursor-pointer items-center gap-1.5 rounded-lg border px-1.5 py-1.5 transition-colors ${
                sel ? "border-amber-300/40 bg-amber-300/10" : "border-transparent bg-white/5 hover:bg-white/10"
              } ${overIdx === i && dragIdx !== null && dragIdx !== i ? "!border-amber-300 " : ""} ${dragIdx === i ? "opacity-40" : ""}`}
            >
              <span className="cursor-grab px-0.5 text-white/30 select-none group-hover:text-white/60" title="Перетащить">
                ⋮⋮
              </span>
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${d.kind === "3d" ? "bg-amber-400" : "bg-sky-300"}`}
                title={d.kind === "3d" ? "3D слой" : "2D слой"}
              />
              <span className={`min-w-0 flex-1 truncate text-[12px] ${L.on ? "text-white/90" : "text-white/30"}`}>{L.name}</span>
              <span className="hidden items-center gap-0.5 group-hover:flex" onClick={(e) => e.stopPropagation()}>
                <button className="px-1 text-[10px] text-white/50 hover:text-white disabled:opacity-20" disabled={i === 0} onClick={() => api.move(i, i - 1)} title="Выше">
                  ▲
                </button>
                <button className="px-1 text-[10px] text-white/50 hover:text-white disabled:opacity-20" disabled={i === layers.length - 1} onClick={() => api.move(i, i + 1)} title="Ниже">
                  ▼
                </button>
                {d.multi && (
                  <button className="px-1 text-[11px] text-white/50 hover:text-white" onClick={() => api.dup(L.id)} title="Дублировать">
                    2×
                  </button>
                )}
                <button className="px-1 text-[11px] text-white/50 hover:text-rose-300" onClick={() => api.remove(L.id)} title="Удалить">
                  ✕
                </button>
              </span>
              <button
                className={`p-1 ${L.on ? "text-amber-200" : "text-white/30"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  api.patchLayer(L.id, { on: !L.on });
                }}
                title={L.on ? "Отключить слой" : "Включить слой"}
              >
                <IconEye on={L.on} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="relative mt-2">
        <button className={`${btn} w-full`} onClick={() => setMenu(!menu)}>
          + Добавить слой
        </button>
        {menu && (
          <div className="mt-1 space-y-0.5 rounded-lg border border-white/10 bg-black/60 p-1">
            {LAYER_TYPE_IDS.map((t) => {
              const d = LAYER_TYPES[t];
              const disabled = !d.multi && present.has(t);
              return (
                <button
                  key={t}
                  disabled={disabled}
                  onClick={() => {
                    api.add(t);
                    setMenu(false);
                    onOpenLayer();
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] text-white/80 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${d.kind === "3d" ? "bg-amber-400" : "bg-sky-300"}`} />
                  {d.label}
                  {disabled && <span className="ml-auto text-[9px] text-white/40">уже есть</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </FloatPanel>
  );
}
