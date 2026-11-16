import { useState, type ReactNode } from "react";
import type { FieldDef, Settings } from "../intro/schema";

const labelCls = "min-w-0 flex-1 truncate text-[11px] leading-tight text-white/60";

function fmtNum(v: number, step: number) {
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 4;
  return Number(v).toFixed(d);
}

export function Row({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`py-[3px] ${wide ? "" : "flex items-center gap-2"}`}>
      <div className={wide ? "mb-1 text-[11px] text-white/60" : labelCls} title={label}>
        {label}
      </div>
      {children}
    </div>
  );
}

export function Field({ def, value, onChange }: { def: Exclude<FieldDef, { t: "head" }>; value: any; onChange: (v: any) => void }) {
  switch (def.t) {
    case "num": {
      const v = typeof value === "number" ? value : def.min;
      return (
        <Row label={def.label + (def.unit ? `, ${def.unit}` : "")}>
          <input
            type="range"
            className="rng w-[104px] shrink-0"
            min={def.min}
            max={def.max}
            step={def.step}
            value={v}
            onChange={(e) => onChange(parseFloat(e.target.value))}
          />
          <input
            type="number"
            className="w-[54px] shrink-0 rounded border border-white/10 bg-white/5 px-1 py-0.5 text-right font-mono text-[10px] text-amber-100 outline-none focus:border-amber-300/50"
            min={def.min}
            max={def.max}
            step={def.step}
            value={fmtNum(v, def.step)}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (isFinite(n)) onChange(n);
            }}
            onBlur={(e) => {
              const n = parseFloat(e.target.value);
              if (isFinite(n)) onChange(Math.min(def.max, Math.max(def.min, n)));
              else e.target.value = fmtNum(v, def.step);
            }}
          />
        </Row>
      );
    }
    case "color":
      return (
        <Row label={def.label}>
          <input
            type="text"
            spellCheck={false}
            className="w-[76px] rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-amber-100 outline-none focus:border-amber-300/50"
            value={value}
            onChange={(e) => {
              const t = e.target.value;
              if (/^#[0-9a-fA-F]{6}$/.test(t)) onChange(t.toLowerCase());
            }}
            onBlur={(e) => (e.target.value = value)}
            defaultValue={value}
          />
          <input type="color" className="clr" value={value} onChange={(e) => onChange(e.target.value)} />
        </Row>
      );
    case "bool":
      return (
        <Row label={def.label}>
          <button
            role="switch"
            aria-checked={!!value}
            onClick={() => onChange(!value)}
            className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${value ? "bg-amber-400/90" : "bg-white/15"}`}
          >
            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-black transition-all ${value ? "left-[14px]" : "left-0.5 bg-white/70"}`} />
          </button>
        </Row>
      );
    case "sel":
      return (
        <Row label={def.label}>
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="max-w-[170px] min-w-0 shrink-0 rounded border border-white/10 bg-neutral-900 px-1 py-0.5 text-[11px] text-amber-100 outline-none focus:border-amber-300/50"
          >
            {def.opts.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Row>
      );
    case "text":
      return (
        <Row label={def.label} wide>
          {def.multiline ? (
            <textarea
              rows={4}
              spellCheck={false}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="https://…/video1.mp4"
              className="w-full resize-y rounded border border-white/10 bg-white/5 px-2 py-1 font-mono text-[10px] text-amber-100 outline-none focus:border-amber-300/50"
            />
          ) : (
            <input
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-[12px] text-amber-100 outline-none focus:border-amber-300/50"
            />
          )}
        </Row>
      );
  }
}

/** Рендер списка полей по схеме; заголовки (head) = сворачиваемые секции */
export function FieldList({ fields, values, onChange, scope }: { fields: FieldDef[]; values: Settings; onChange: (k: string, v: any) => void; scope: string }) {
  const sections: { title: string | null; items: Exclude<FieldDef, { t: "head" }>[] }[] = [];
  for (const f of fields) {
    if (f.t === "head") sections.push({ title: f.label, items: [] });
    else {
      if (!sections.length) sections.push({ title: null, items: [] });
      sections[sections.length - 1].items.push(f);
    }
  }
  return (
    <div>
      {sections.map((sec, i) => (
        <Section key={scope + i + sec.title} title={sec.title} defaultOpen={i < 2}>
          {sec.items.map((f) => (
            <Field key={f.k} def={f} value={values[f.k]} onChange={(v) => onChange(f.k, v)} />
          ))}
        </Section>
      ))}
    </div>
  );
}

function Section({ title, defaultOpen, children }: { title: string | null; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!title) return <div className="pb-1">{children}</div>;
  return (
    <div className="border-t border-white/5 first:border-t-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-1.5 text-left text-[10px] font-medium tracking-[0.18em] text-amber-200/80 uppercase hover:text-amber-100"
      >
        <span>{title}</span>
        <span className={`text-[9px] transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}
