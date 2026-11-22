"use client";

import { useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { cx } from "../../shared/index.ts";
import "./breakdown-chart.css";

/** Chart series colors (data): one hue per segment, a light and a dark value each. */
const SERIES = [
  "var(--kb-series-1)",
  "var(--kb-series-4)",
  "var(--kb-series-3)",
  "var(--kb-series-6)",
  "var(--kb-ink-3)",
  "var(--kb-series-2)",
];

/** One row of raw data: a day, the dimensions it belongs to, and its measures. */
export interface BreakdownFact {
  /** ISO date, e.g. 2026-10-22 */
  date: string;
  dims: Record<string, string>;
  measures: Record<string, number>;
}

export interface BreakdownMeasure {
  id: string;
  label: string;
  format: (value: number) => string;
}

export interface BreakdownDimension {
  id: string;
  label: string;
}

export type BreakdownSlice = "day" | "week";

export interface BreakdownChartProps {
  title?: string;
  facts?: BreakdownFact[];
  measures?: BreakdownMeasure[];
  /** Dimensions the bars can be segmented by */
  dimensions?: BreakdownDimension[];
  defaultMeasure?: string;
  defaultSlice?: BreakdownSlice;
  defaultSegment?: string;
  /** How many days or weeks to show */
  days?: number;
  weeks?: number;
  className?: string;
}

// ---------------------------------------------------------------------------------------------
// Demo data: four weeks of agent runs, seeded so every render is the same

function seeded(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildDemoFacts(): BreakdownFact[] {
  const rand = seeded(42);
  const agents = { "Support triage": 1180, "Code review": 520, Research: 260, "Sales drafter": 410 } as Record<string, number>;
  const models = {
    "Large reasoning": { share: 0.22, tokens: 14_200, price: 15 },
    "Fast chat": { share: 0.58, tokens: 5_600, price: 3 },
    "Small router": { share: 0.2, tokens: 1_900, price: 0.8 },
  } as Record<string, { share: number; tokens: number; price: number }>;
  const facts: BreakdownFact[] = [];
  const end = Date.UTC(2026, 9, 22);
  for (let d = 27; d >= 0; d--) {
    const date = new Date(end - d * 86_400_000);
    const weekday = date.getUTCDay();
    const weekend = weekday === 0 || weekday === 6 ? 0.45 : 1;
    const growth = 1 + (27 - d) * 0.012;
    for (const [agent, base] of Object.entries(agents)) {
      for (const [model, m] of Object.entries(models)) {
        const runs = Math.round(base * m.share * weekend * growth * (0.8 + rand() * 0.4));
        const tokens = Math.round(runs * m.tokens * (0.85 + rand() * 0.3));
        facts.push({
          date: date.toISOString().slice(0, 10),
          dims: { agent, model },
          measures: { runs, tokens, spend: (tokens / 1_000_000) * m.price },
        });
      }
    }
  }
  return facts;
}

export const breakdownDemoFacts = buildDemoFacts();

const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : Math.round(n).toLocaleString("en-US");

export const breakdownDemoMeasures: BreakdownMeasure[] = [
  { id: "spend", label: "Spend", format: (v) => `$${v.toLocaleString("en-US", { minimumFractionDigits: v && v < 100 ? 2 : 0, maximumFractionDigits: v < 100 ? 2 : 0 })}` },
  { id: "tokens", label: "Tokens", format: compact },
  { id: "runs", label: "Runs", format: (v) => Math.round(v).toLocaleString("en-US") },
];

export const breakdownDemoDimensions: BreakdownDimension[] = [
  { id: "agent", label: "Agent" },
  { id: "model", label: "Model" },
];

// ---------------------------------------------------------------------------------------------

const W = 680;
const H = 232;
const PAD = { top: 10, right: 6, bottom: 26, left: 52 };
const SEAM = 2;

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** A round tick step (1, 2 or 5 times a power of ten) that gives three to five gridlines */
function niceStep(max: number): number {
  if (max <= 0) return 1;
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const r = raw / pow;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * pow;
}

/** Segmented picker: a recessed channel with the chosen option raised in it */
function Picker({ label, options, value, onChange }: { label: string; options: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  const index = options.findIndex((o) => o.id === value);
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const n = options.length;
    const next = event.key === "ArrowRight" ? (index + 1) % n : event.key === "ArrowLeft" ? (index - 1 + n) % n : null;
    if (next === null) return;
    event.preventDefault();
    const option = options[next];
    if (option) onChange(option.id);
    event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };
  return (
    <div className="kb-bdc-picker">
      <span className="kb-bdc-picker-label">{label}</span>
      <div className="kb-bdc-seg" role="radiogroup" aria-label={label} onKeyDown={onKey}>
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={o.id === value} tabIndex={o.id === value ? 0 : -1} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Stacked bar chart with measure, slice and segment pickers. Each bar is a stack of molded bricks with a seam
 * between them; pointing at a bar (or arrowing through them) opens its breakdown and lights the matching column
 * in the linked table, and pointing at a segment anywhere lights that segment everywhere.
 */
export function BreakdownChart({
  title = "Agent usage",
  facts = breakdownDemoFacts,
  measures = breakdownDemoMeasures,
  dimensions = breakdownDemoDimensions,
  defaultMeasure,
  defaultSlice = "day",
  defaultSegment,
  days = 14,
  weeks = 4,
  className,
}: BreakdownChartProps) {
  const uid = useId();
  const plotRef = useRef<HTMLDivElement>(null);
  const [measureId, setMeasureId] = useState(defaultMeasure ?? measures[0]?.id ?? "");
  const [slice, setSlice] = useState<BreakdownSlice>(defaultSlice);
  const [segmentBy, setSegmentBy] = useState(defaultSegment ?? dimensions[0]?.id ?? "");
  const [active, setActive] = useState<number | null>(null);
  const [focusSeg, setFocusSeg] = useState<string | null>(null);

  const measure = measures.find((m) => m.id === measureId) ?? measures[0];
  const format = measure?.format ?? ((v: number) => String(v));

  const model = useMemo(() => {
    const dates = [...new Set(facts.map((f) => f.date))].sort();
    const count = slice === "day" ? days : weeks;
    const span = slice === "day" ? 1 : 7;
    const recent = dates.slice(-count * span);
    const buckets = Array.from({ length: Math.ceil(recent.length / span) }, (_, i) => recent.slice(i * span, i * span + span));
    const bucketOf = new Map<string, number>();
    buckets.forEach((b, i) => b.forEach((d) => bucketOf.set(d, i)));

    const sums = buckets.map(() => new Map<string, number>());
    const totals = new Map<string, number>();
    for (const f of facts) {
      const b = bucketOf.get(f.date);
      if (b === undefined) continue;
      const key = f.dims[segmentBy] ?? "Other";
      const v = f.measures[measureId] ?? 0;
      const sum = sums[b];
      if (sum) sum.set(key, (sum.get(key) ?? 0) + v);
      totals.set(key, (totals.get(key) ?? 0) + v);
    }
    // Biggest segment sits at the bottom of every stack and the top of the table
    const segments = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([key, total], i) => ({ key, total, color: SERIES[i % SERIES.length] ?? "currentColor" }));
    const bars = buckets.map((b, i) => {
      const values = segments.map((s) => sums[i]?.get(s.key) ?? 0);
      const first = b[0] ?? "";
      return {
        label: slice === "day" ? dayLabel(first) : `Week of ${dayLabel(first)}`,
        short: slice === "day" ? dayLabel(first) : dayLabel(first),
        values,
        total: values.reduce((a, c) => a + c, 0),
      };
    });
    const grand = segments.reduce((a, s) => a + s.total, 0);
    const peak = Math.max(0, ...bars.map((b) => b.total));
    const step = niceStep(peak);
    return { segments, bars, grand, step, max: Math.max(step, Math.ceil(peak / step) * step) };
  }, [facts, slice, days, weeks, segmentBy, measureId]);

  const { segments, bars, grand, step, max } = model;
  const n = bars.length;
  const band = (W - PAD.left - PAD.right) / Math.max(1, n);
  const barW = Math.min(44, band * 0.64);
  const plotH = H - PAD.top - PAD.bottom;
  const yOf = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const at = active !== null && active < n ? active : null;
  const activeBar = at !== null ? bars[at] : undefined;

  const onPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = plotRef.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((event.clientX - box.left) / box.width) * W;
    const i = Math.floor((px - PAD.left) / band);
    setActive(i >= 0 && i < n ? i : null);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const cur = at ?? (event.key === "ArrowLeft" ? n : -1);
    const segIndex = segments.findIndex((s) => s.key === focusSeg);
    let handled = true;
    if (event.key === "ArrowRight") setActive(Math.min(n - 1, cur + 1));
    else if (event.key === "ArrowLeft") setActive(Math.max(0, cur - 1));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(n - 1);
    else if (event.key === "ArrowUp") setFocusSeg(segments[Math.min(segments.length - 1, segIndex + 1)]?.key ?? null);
    else if (event.key === "ArrowDown") setFocusSeg(segIndex <= 0 ? null : (segments[segIndex - 1]?.key ?? null));
    else if (event.key === "Escape") {
      setActive(null);
      setFocusSeg(null);
    } else handled = false;
    if (handled) event.preventDefault();
  };

  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.ceil(n / 7);
  const tipLeft = at !== null ? ((PAD.left + band * (at + 0.5)) / W) * 100 : 0;
  const measureLabel = measure?.label ?? "";
  const geom = (x: number, y: number, w: number, h: number) => ({ x: `${x}px`, y: `${y}px`, width: `${w}px`, height: `${h}px` }) as CSSProperties;

  return (
    <section className={cx("kb-bdc kb-part", className)} aria-labelledby={`${uid}-t`}>
      <header className="kb-bdc-head">
        <div>
          <h3 id={`${uid}-t`} className="kb-bdc-title">{title}</h3>
          <p className="kb-bdc-sub">{`${format(grand)} ${measureLabel.toLowerCase()} over the last ${n} ${slice === "day" ? "days" : "weeks"}`}</p>
        </div>
        <div className="kb-bdc-pickers">
          <Picker label="Measure" options={measures} value={measureId} onChange={setMeasureId} />
          <Picker label="Slice" options={[{ id: "day", label: "Day" }, { id: "week", label: "Week" }]} value={slice} onChange={(v) => { setSlice(v as BreakdownSlice); setActive(null); }} />
          <Picker label="Segment" options={dimensions} value={segmentBy} onChange={(v) => { setSegmentBy(v); setFocusSeg(null); }} />
        </div>
      </header>

      <div
        ref={plotRef}
        className="kb-bdc-plot"
        tabIndex={0}
        role="group"
        aria-label={`${measureLabel} by ${slice} stacked by ${dimensions.find((d) => d.id === segmentBy)?.label.toLowerCase() ?? "segment"}. Left and right arrows move between bars, up and down pick a segment.`}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => { setActive(null); setFocusSeg(null); }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="kb-bdc-svg" aria-hidden>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={yOf(t)} y2={yOf(t)} className="kb-bdc-grid" data-base={t === 0 || undefined} />
              <text x={PAD.left - 8} y={yOf(t)} textAnchor="end" dominantBaseline="middle" className="kb-bdc-tick">{format(t).replace(/\.0+$/, "")}</text>
            </g>
          ))}
          {bars.map((bar, i) => {
            const x = PAD.left + band * i + (band - barW) / 2;
            let base = 0;
            const top = bar.values.reduce((last, v, j) => (v > 0 ? j : last), -1);
            return (
              <g key={i} className="kb-bdc-bar" data-active={at === i || undefined} data-faded={(at !== null && at !== i) || undefined}>
                <rect x={PAD.left + band * i + 1} y={PAD.top} width={band - 2} height={plotH} rx={4} className="kb-bdc-band" />
                {bar.values.map((v, j) => {
                  const seg = segments[j];
                  if (!seg) return null;
                  const y0 = yOf(base);
                  base += v;
                  const y1 = yOf(base);
                  const h = Math.max(0, y0 - y1 - (j === top ? 0 : SEAM));
                  const y = y0 - h;
                  return (
                    <g key={seg.key} className="kb-bdc-brick" data-dim={(focusSeg && focusSeg !== seg.key) || undefined} onPointerEnter={() => setFocusSeg(seg.key)} onPointerLeave={() => setFocusSeg(null)}>
                      <rect style={{ ...geom(x, y, barW, h), fill: seg.color }} rx={1} />
                      {h > 3 ? <rect className="kb-bdc-catch" style={geom(x + 1.5, y + (j === top ? 1 : 0.5), barW - 3, 1.25)} /> : null}
                    </g>
                  );
                })}
              </g>
            );
          })}
          {bars.map((bar, i) =>
            i % labelEvery === (n - 1) % labelEvery ? (
              <text key={i} x={PAD.left + band * (i + 0.5)} y={H - 7} textAnchor="middle" className="kb-bdc-tick" data-active={at === i || undefined}>
                {bar.short}
              </text>
            ) : null,
          )}
        </svg>

        {activeBar && at !== null ? (
          <div className="kb-bdc-tip" style={{ left: `${tipLeft}%` }} data-flip={at > n / 2 || undefined} aria-live="polite">
            <div className="kb-bdc-tip-head">
              <span>{activeBar.label}</span>
              <strong>{format(activeBar.total)}</strong>
            </div>
            {[...segments].reverse().map((s) => {
              const j = segments.indexOf(s);
              const v = activeBar.values[j] ?? 0;
              return (
                <div key={s.key} className="kb-bdc-tip-row" data-hot={focusSeg === s.key || undefined}>
                  <span className="kb-bdc-swatch" style={{ background: s.color }} />
                  <span className="kb-bdc-tip-name">{s.key}</span>
                  <span className="kb-bdc-tip-num">{format(v)}</span>
                  <span className="kb-bdc-tip-share">{activeBar.total ? `${Math.round((v / activeBar.total) * 100)}%` : "0%"}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <table className="kb-bdc-table">
        <caption className="kb-sr">{`${measureLabel} by ${segmentBy}`}</caption>
        <thead>
          <tr>
            <th scope="col">{dimensions.find((d) => d.id === segmentBy)?.label ?? "Segment"}</th>
            <th scope="col" className="kb-bdc-num" data-live={activeBar ? true : undefined}>{activeBar ? activeBar.label : `Latest ${slice}`}</th>
            <th scope="col" className="kb-bdc-num">{`${n} ${slice === "day" ? "days" : "weeks"}`}</th>
            <th scope="col" className="kb-bdc-num">Share</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((s, j) => {
            const shown = (activeBar ?? bars[n - 1])?.values[j] ?? 0;
            const share = grand ? s.total / grand : 0;
            return (
              <tr
                key={s.key}
                data-hot={focusSeg === s.key || undefined}
                data-dim={(focusSeg && focusSeg !== s.key) || undefined}
                onPointerEnter={() => setFocusSeg(s.key)}
                onPointerLeave={() => setFocusSeg(null)}
              >
                <th scope="row">
                  <span className="kb-bdc-swatch" style={{ background: s.color }} />
                  {s.key}
                </th>
                <td className="kb-bdc-num" data-live={activeBar ? true : undefined}>{format(shown)}</td>
                <td className="kb-bdc-num">{format(s.total)}</td>
                <td className="kb-bdc-num">
                  <span className="kb-bdc-share">
                    <span className="kb-bdc-share-bar"><i style={{ width: `${share * 100}%`, background: s.color }} /></span>
                    {`${Math.round(share * 100)}%`}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className="kb-bdc-num">{format((activeBar ?? bars[n - 1])?.total ?? 0)}</td>
            <td className="kb-bdc-num">{format(grand)}</td>
            <td className="kb-bdc-num">100%</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
