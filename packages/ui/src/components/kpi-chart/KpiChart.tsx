import { useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { cx, Icon, NumberRoll } from "../../shared/index.ts";
import "./kpi-chart.css";

/** Chart series colors (data): one hue per line, a light and a dark value each. */
const SERIES = [
  "var(--kb-series-1)",
  "var(--kb-series-4)",
  "var(--kb-series-3)",
  "var(--kb-series-6)",
  "var(--kb-ink-3)",
];

export interface KpiSeries {
  id: string;
  label: string;
  values: number[];
  /** Any CSS color; defaults to the Styrene series palette */
  color?: string;
}

export interface KpiChartProps {
  title?: string;
  /** One label per point, e.g. dates */
  labels?: string[];
  series?: KpiSeries[];
  /** Formats every figure in the card */
  format?: (value: number) => string;
  /** What the delta compares against, read as "vs <value> <comparison>" */
  comparison?: string;
  /** Time the latest point was read; today is partial, so the comparison is to the same time a week ago */
  asOf?: string;
  /** Set when a rise is bad news (escalations, latency); flips the delta's color */
  lowerIsBetter?: boolean;
  /** Shaded spans that explain the data, as inclusive point indexes, e.g. weekends */
  bands?: Array<{ from: number; to: number; label: string }>;
  className?: string;
}

const DAYS = ["Oct 7", "Oct 8", "Oct 9", "Oct 10", "Oct 11", "Oct 12", "Oct 13", "Oct 14", "Oct 15", "Oct 16", "Oct 17", "Oct 18", "Oct 19", "Oct 20"];

/** Oct 10–11 and Oct 17–18 are weekends, which is where every line dips */
export const kpiDemoBands = [
  { from: 3, to: 4, label: "Weekend" },
  { from: 10, to: 11, label: "Weekend" },
];

export const kpiDemoSeries: KpiSeries[] = [
  { id: "triage", label: "Support triage", values: [212, 228, 197, 164, 241, 259, 266, 248, 274, 233, 182, 279, 301, 318] },
  { id: "review", label: "Code review", values: [96, 104, 118, 61, 54, 122, 131, 127, 140, 117, 66, 59, 148, 156] },
  { id: "research", label: "Research", values: [44, 51, 39, 28, 33, 58, 62, 71, 66, 74, 41, 37, 83, 92] },
];

const W = 640;
const H = 210;
/** The right pad holds the end-of-line labels; y labels sit in a gutter on the header's left edge */
const PAD = { top: 12, right: 150, bottom: 24, left: 40 };
const LABEL_GAP = 30;

/** A round step that gives three or four gridlines, and the top of the scale just above the data */
function niceScale(n: number): { max: number; step: number } {
  const raw = Math.max(n, 1) / 3.5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  // The top sits half a step above the data at most, so the plot does not waste its height
  return { max: Math.ceil(n / (step / 2)) * (step / 2), step };
}

/**
 * Metric card with a multi-line chart, labeled where the lines end rather than in a legend. Last week is laid over
 * this week as dashed ghosts with their own end values, so the delta can be read off the chart, and shaded bands
 * explain the shape of the data (weekends, incidents). The crosshair is a seam pin that snaps from day to day; the
 * headline, the end labels and the tooltip follow it, and arrow keys move it just like the pointer does.
 */
export function KpiChart({
  title = "Tasks resolved by agents",
  labels = DAYS,
  series = kpiDemoSeries,
  format = (v) => Math.round(v).toLocaleString("en-US"),
  comparison = "at the same time last week",
  asOf = "14:20",
  lowerIsBetter = false,
  bands = kpiDemoBands,
  className,
}: KpiChartProps) {
  const uid = useId();
  const plotRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [index, setIndex] = useState<number | null>(null);
  const [emphasis, setEmphasis] = useState<string | null>(null);

  const colored = series.map((s, i) => ({ ...s, color: s.color ?? SERIES[i % SERIES.length] ?? "currentColor" }));
  const visible = colored.filter((s) => !hidden.has(s.id));
  const count = labels.length;
  const last = count - 1;
  const at = index ?? last;

  const { max, step } = useMemo(() => niceScale(Math.max(1, ...visible.flatMap((s) => s.values))), [visible]);
  const x = (i: number) => PAD.left + (i / Math.max(1, last)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  // Each line is labeled at its end; labels are nudged apart so they never overlap
  const ends = (() => {
    const placed = colored
      .map((s) => ({ s, ty: y(s.values[last] ?? 0) }))
      .sort((a, b) => a.ty - b.ty);
    for (let i = 1; i < placed.length; i++) {
      const prev = placed[i - 1];
      const cur = placed[i];
      if (prev && cur && cur.ty - prev.ty < LABEL_GAP) cur.ty = prev.ty + LABEL_GAP;
    }
    return placed;
  })();

  const total = (i: number) => visible.reduce((sum, s) => sum + (s.values[i] ?? 0), 0);
  const current = total(at);
  const prior = at >= 7 ? total(at - 7) : null;
  const delta = prior ? (current - prior) / prior : null;

  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (colored.length - next.size > 1) next.add(id); // keep at least one line on the chart
      return next;
    });

  const onPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = plotRef.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((event.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * last);
    setIndex(Math.min(last, Math.max(0, i)));
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: last };
    if (event.key in moves) {
      event.preventDefault();
      setIndex(Math.min(last, Math.max(0, moves[event.key] ?? at)));
    } else if (event.key === "Escape") {
      setIndex(null);
    }
  };

  // Today is partial, so the last segment is drawn dashed and the last point open
  const path = (values: number[]) =>
    values
      .slice(0, last)
      .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .join("");
  const todaySegment = (values: number[]) =>
    `M${x(last - 1).toFixed(1)},${y(values[last - 1] ?? 0).toFixed(1)}L${x(last).toFixed(1)},${y(values[last] ?? 0).toFixed(1)}`;
  const leftPct = (x(at) / W) * 100;
  const flip = at > last / 2;

  return (
    <section className={cx("kb-kpi kb-part", className)} aria-labelledby={`${uid}-t`}>
      <header className="kb-kpi-head">
        <div>
          <h3 id={`${uid}-t`} className="kb-kpi-title">{title}</h3>
          <div className="kb-kpi-figure">
            <NumberRoll value={format(current)} className="kb-kpi-value" />
            {delta !== null ? (
              <span className="kb-kpi-delta" data-good={(delta >= 0) !== lowerIsBetter || undefined}>
                <Icon name={delta >= 0 ? "trendUp" : "trendDown"} size={14} />
                {`${delta >= 0 ? "+" : "−"}${Math.abs(delta * 100).toFixed(1)}%`}
              </span>
            ) : null}
          </div>
          <p className="kb-kpi-sub">
            {index === null ? `Today as of ${asOf}` : labels[at]}
            {prior !== null ? `, vs ${format(prior)} ${index === null ? comparison : "a week earlier"}` : null}
          </p>
        </div>
      </header>

      <div
        ref={plotRef}
        className="kb-kpi-plot"
        tabIndex={0}
        role="group"
        aria-label={`${title} chart. Use left and right arrow keys to read each day.`}
        aria-describedby={`${uid}-live`}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setIndex(null)}
        onKeyDown={onKey}
        onBlur={() => setIndex(null)}
        data-active={index !== null || undefined}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="kb-kpi-svg" aria-hidden>
          {bands.map((b) => (
            <g key={`${b.from}-${b.to}`} className="kb-kpi-band">
              <rect x={x(b.from) - 6} y={PAD.top} width={x(b.to) - x(b.from) + 12} height={H - PAD.top - PAD.bottom}>
                <title>{b.label}</title>
              </rect>
            </g>
          ))}
          <line x1={PAD.left} x2={W - PAD.right} y1={y(max)} y2={y(max)} className="kb-kpi-grid kb-kpi-top" />
          {max % step ? (
            <text x={0} y={y(max)} className="kb-kpi-tick" dominantBaseline="middle">
              {format(max)}
            </text>
          ) : null}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="kb-kpi-grid" />
              <text x={0} y={y(t)} className="kb-kpi-tick" dominantBaseline="middle">
                {format(t)}
              </text>
            </g>
          ))}
          {labels.map((label, i) =>
            (last - i) % 3 === 0 ? (
              <text key={label} x={x(i)} y={H - 6} className="kb-kpi-tick" textAnchor="middle">
                {label}
              </text>
            ) : null,
          )}
          <g className="kb-kpi-seam" style={{ transform: `translateX(${x(at)}px)` }} data-show={index !== null || undefined}>
            <line x1={0} x2={0} y1={PAD.top - 4} y2={H - PAD.bottom} />
            <rect x={-3} y={H - PAD.bottom - 3} width={6} height={6} rx={1.5} />
          </g>
          {/* Last week, laid over this week as dashed ghosts, so the delta can be read off the chart */}
          {visible.map((s) => (
            <path
              key={`${s.id}-ghost`}
              className="kb-kpi-ghost"
              style={{ stroke: s.color }}
              d={s.values
                .slice(0, Math.max(0, count - 7))
                .map((v, i) => `${i ? "L" : "M"}${x(i + 7).toFixed(1)},${y(v).toFixed(1)}`)
                .join("")}
            />
          ))}
          {visible.map((s) => (
            <path
              key={s.id}
              d={path(s.values)}
              className="kb-kpi-line"
              pathLength={1}
              style={{ stroke: s.color }}
              data-dim={(emphasis && emphasis !== s.id) || undefined}
            />
          ))}
          {visible.map((s) => (
            <path key={`${s.id}-today`} className="kb-kpi-today" d={todaySegment(s.values)} style={{ stroke: s.color }} />
          ))}
          {visible.map((s) => (
            <circle key={`${s.id}-end`} className="kb-kpi-end" cx={x(last)} cy={y(s.values[last] ?? 0)} r={3} style={{ stroke: s.color }} />
          ))}
          {visible[0] && count > 7 ? (
            <text className="kb-kpi-ghost-tag" x={x(7)} y={y(visible[0].values[0] ?? 0) - 8} textAnchor="middle">
              last week
            </text>
          ) : null}
          {index !== null
            ? visible.map((s) => (
                <circle
                  key={s.id}
                  className="kb-kpi-dot"
                  cx={x(at)}
                  cy={y(s.values[at] ?? 0)}
                  r={4}
                  style={{ fill: s.color }}
                />
              ))
            : null}
        </svg>

        <div className="kb-kpi-ends" role="group" aria-label="Show or hide lines">
          {ends.map(({ s, ty }) => (
            <button
              key={s.id}
              type="button"
              className="kb-kpi-key"
              style={{ top: `${(ty / H) * 100}%`, left: `${((x(last) + 10) / W) * 100}%` }}
              aria-pressed={!hidden.has(s.id)}
              onClick={() => toggle(s.id)}
              onPointerEnter={() => setEmphasis(s.id)}
              onPointerLeave={() => setEmphasis(null)}
              onFocus={() => setEmphasis(s.id)}
              onBlur={() => setEmphasis(null)}
            >
              <span className="kb-kpi-key-name">{s.label}</span>
              <span className="kb-kpi-key-num">{format(s.values[at] ?? 0)}</span>
              {s.values[at - 7] !== undefined ? <span className="kb-kpi-key-prev">last wk {format(s.values[at - 7] ?? 0)}</span> : null}
            </button>
          ))}
        </div>

        {index !== null ? (
          <div className="kb-kpi-tip" style={{ left: `${leftPct}%` }} data-flip={flip || undefined} aria-hidden>
            <div className="kb-kpi-tip-date">{labels[at]}</div>
            {visible.map((s) => (
              <div key={s.id} className="kb-kpi-tip-row">
                <span className="kb-kpi-swatch" style={{ background: s.color }} />
                <span className="kb-kpi-tip-name">{s.label}</span>
                <span className="kb-kpi-tip-num">{format(s.values[at] ?? 0)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <p id={`${uid}-live`} className="kb-sr" aria-live="polite">
        {index === null
          ? ""
          : `${labels[at]}: ${visible.map((s) => `${s.label} ${format(s.values[at] ?? 0)}`).join(", ")}. Total ${format(current)}.`}
      </p>

      <table className="kb-sr">
        <caption>{title} by day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {colored.map((s) => <th key={s.id} scope="col">{s.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {labels.map((label, i) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {colored.map((s) => <td key={s.id}>{format(s.values[i] ?? 0)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
