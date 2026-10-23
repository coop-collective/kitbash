import { useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { cx, Icon, NumberRoll } from "../../shared/index.ts";
import "./compact-breakdown.css";

/** Chart series colors (data): a light and a dark value each. The last one is the neutral "everything else". */
const SERIES = [
  "var(--kb-series-1)",
  "var(--kb-series-4)",
  "var(--kb-series-3)",
  "var(--kb-series-6)",
  "var(--kb-ink-3)",
];

export interface BreakdownPart {
  id: string;
  label: string;
  /** One value per period, in the same order as `periods` */
  values: number[];
  color?: string;
}

export interface CompactBreakdownProps {
  title?: string;
  periods?: string[];
  parts?: BreakdownPart[];
  /** Index into `periods` shown first */
  defaultPeriod?: number;
  format?: (value: number) => string;
  className?: string;
}

export const compactDemoParts: BreakdownPart[] = [
  { id: "triage", label: "Support triage", values: [48.2, 312.4, 1288.9] },
  { id: "review", label: "Code review", values: [61.7, 284.1, 1032.5] },
  { id: "research", label: "Research assistant", values: [22.9, 341.8, 964.2] },
  { id: "sales", label: "Sales drafter", values: [31.4, 128.6, 610.3] },
  { id: "other", label: "Everything else", values: [9.6, 52.3, 187.4] },
];

const ROW = 36;
const money = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A total split into its parts in one small card. The parts sit on a recessed runner like pieces on a sprue;
 * changing the period rolls every figure, glides the runner and lets ranked rows trade places.
 */
export function CompactBreakdown({
  title = "Spend by agent",
  periods = ["24h", "7 days", "30 days"],
  parts = compactDemoParts,
  defaultPeriod = 1,
  format = money,
  className,
}: CompactBreakdownProps) {
  const uid = useId();
  const [period, setPeriod] = useState(defaultPeriod);
  const [hover, setHover] = useState<string | null>(null);
  const prevRanks = useRef<Record<string, number>>({});

  const colored = parts.map((p, i) => ({ ...p, color: p.color ?? SERIES[i % SERIES.length] ?? "currentColor", value: p.values[period] ?? 0 }));
  const total = colored.reduce((sum, p) => sum + p.value, 0);
  // "Everything else" stays at the bottom; the rest rank by value
  const ranked = [...colored].sort((a, b) => (a.id === "other" ? 1 : b.id === "other" ? -1 : b.value - a.value));
  const rank: Record<string, number> = {};
  ranked.forEach((p, i) => (rank[p.id] = i));
  const moved: Record<string, number> = {};
  for (const p of colored) {
    const before = prevRanks.current[p.id];
    if (before !== undefined && before !== rank[p.id]) moved[p.id] = before - (rank[p.id] ?? 0);
  }

  const choose = (i: number) => {
    prevRanks.current = rank;
    setPeriod(i);
  };

  const onTabsKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const n = periods.length;
    const next = event.key === "ArrowRight" ? (period + 1) % n : event.key === "ArrowLeft" ? (period - 1 + n) % n : null;
    if (next === null) return;
    event.preventDefault();
    choose(next);
    event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };

  let offset = 0;
  return (
    <section className={cx("kb-cbd kb-part", className)} aria-labelledby={`${uid}-t`}>
      <header className="kb-cbd-head">
        <h3 id={`${uid}-t`} className="kb-cbd-title">{title}</h3>
        <div className="kb-cbd-tabs" role="radiogroup" aria-label="Period" onKeyDown={onTabsKey}>
          {periods.map((p, i) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={i === period}
              tabIndex={i === period ? 0 : -1}
              className="kb-cbd-tab"
              onClick={() => choose(i)}
            >
              {p}
            </button>
          ))}
          <span className="kb-cbd-thumb" style={{ "--i": period, "--n": periods.length } as CSSProperties} aria-hidden />
        </div>
      </header>

      <NumberRoll value={format(total)} className="kb-cbd-total" />

      <div className="kb-cbd-runner" aria-hidden>
        {colored.map((p) => {
          const share = total ? p.value / total : 0;
          const style = { left: `calc(2px + (100% - 4px) * ${offset})`, width: `calc((100% - 4px) * ${share})`, background: p.color } as CSSProperties;
          offset += share;
          return (
            <span
              key={p.id}
              className="kb-cbd-piece"
              style={style}
              data-dim={(hover && hover !== p.id) || undefined}
              onPointerEnter={() => setHover(p.id)}
              onPointerLeave={() => setHover(null)}
            />
          );
        })}
      </div>

      {/* Rows keep a stable DOM order so they can glide; screen readers get the ranked list below */}
      <ul className="kb-cbd-rows" style={{ height: ranked.length * ROW }} aria-hidden>
        {colored.map((p) => {
          const share = total ? (p.value / total) * 100 : 0;
          const shift = moved[p.id];
          return (
            <li
              key={p.id}
              className="kb-cbd-row"
              style={{ transform: `translateY(${(rank[p.id] ?? 0) * ROW}px)` }}
              data-dim={(hover && hover !== p.id) || undefined}
              data-hot={hover === p.id || undefined}
              onPointerEnter={() => setHover(p.id)}
              onPointerLeave={() => setHover(null)}
            >
              <span className="kb-cbd-swatch" style={{ background: p.color }} />
              <span className="kb-cbd-name">{p.label}</span>
              {shift ? (
                <span key={`${period}`} className="kb-cbd-moved" data-dir={shift > 0 ? "up" : "down"} aria-hidden>
                  <Icon name={shift > 0 ? "chevronUp" : "chevronDown"} size={12} strokeWidth={2.25} />
                </span>
              ) : <span />}
              <NumberRoll value={format(p.value)} className="kb-cbd-num" />
              <span className="kb-cbd-share">{`${share.toFixed(0)}%`}</span>
            </li>
          );
        })}
      </ul>
      <ol className="kb-sr" aria-label={`${title}, ${periods[period]}, largest first`} aria-live="polite">
        {ranked.map((p) => (
          <li key={p.id}>{`${p.label}: ${format(p.value)}, ${total ? Math.round((p.value / total) * 100) : 0}% of ${format(total)}`}</li>
        ))}
      </ol>
    </section>
  );
}
