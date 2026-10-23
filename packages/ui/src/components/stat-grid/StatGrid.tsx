"use client";

import { useState } from "react";
import { EmptyState, type EmptyStateProps } from "../empty-state/EmptyState.tsx";
import { ErrorState } from "../error-state/ErrorState.tsx";
import { FreshnessBadge } from "../freshness-badge/FreshnessBadge.tsx";
import { Skeleton, SkeletonRegion } from "../skeleton/Skeleton.tsx";
import { cx, Icon, type LoadStatus } from "../../shared/index.ts";
import "./stat-grid.css";

export type StatFormat = "number" | "currency" | "percent" | "duration";

/** Which direction is good for a metric: more ("up"), less ("down"), or neither ("neutral") */
export type StatPolarity = "up" | "down" | "neutral";

export interface StatMetric {
  id: string;
  label: string;
  /** This period's value. Percent values are 0 to 100; durations are seconds */
  value: number;
  /** The comparison period's value */
  previous: number;
  format?: StatFormat;
  /** Which direction is good. Defaults to "up" */
  good?: StatPolarity;
  /** This period, oldest first, drawn as the sparkline */
  series?: number[];
  /** The comparison period, same length, drawn as a dotted line under it */
  previousSeries?: number[];
}

export interface StatGridProps {
  metrics?: StatMetric[];
  /** Heading over the grid; pass null for a bare grid */
  title?: string | null;
  /** The period shown, e.g. "Last 7 days" */
  period?: string;
  /** How the comparison period is named after its value: "1,187 the week before" */
  previousLabel?: string;
  /** Tiles per row; defaults to the count up to 4, then 3 */
  columns?: 2 | 3 | 4 | 5 | 6;
  /** Selected tile, e.g. the metric a chart below plots. Omit to let the grid keep its own */
  selected?: string | null;
  defaultSelected?: string | null;
  onSelect?: (id: string) => void;
  /** Tiles are plain readouts, not buttons */
  readOnly?: boolean;
  loading?: boolean;
  /** Shows ErrorState in place of the tiles */
  error?: string | null;
  onRetry?: () => void;
  /** Technical detail under the error, e.g. a status and request id */
  errorDetail?: string;
  /** From useCachedLoader; shows a FreshnessBadge in the header */
  status?: LoadStatus;
  updatedAt?: number | null;
  onRefresh?: () => void;
  emptyAction?: EmptyStateProps["action"];
  className?: string;
}

const series = (base: number, drift: number, wobble: number[]) => wobble.map((w, i) => Math.round((base + drift * i + w) * 10) / 10);

export const demoStatMetrics: StatMetric[] = [
  {
    id: "teams",
    label: "Weekly active teams",
    value: 1284,
    previous: 1187,
    series: series(168, 2.4, [0, 6, -4, 9, 3, -12, 8]),
    previousSeries: series(160, 1.2, [3, -2, 5, 1, -6, -9, 4]),
  },
  {
    id: "runs",
    label: "Agent runs",
    value: 48920,
    previous: 44310,
    series: series(6600, 90, [0, 410, -220, 380, 120, -640, 300]),
    previousSeries: series(6200, 40, [-100, 200, 90, -300, 260, -520, 120]),
  },
  {
    id: "success",
    label: "Runs that finished",
    value: 94.1,
    previous: 92.8,
    format: "percent",
    series: series(93.4, 0.1, [0, 0.6, -0.4, 0.3, 0.9, -0.2, 0.5]),
    previousSeries: series(92.9, 0, [0.2, -0.3, 0.4, -0.6, 0.1, 0.3, -0.2]),
  },
  {
    id: "duration",
    label: "Median run time",
    value: 42,
    previous: 51,
    format: "duration",
    good: "down",
    series: series(49, -1.2, [0, 2, -1, 3, -2, 1, -1]),
    previousSeries: series(51, 0, [1, -2, 2, 0, 3, -1, -2]),
  },
  {
    id: "spend",
    label: "Model spend",
    value: 12480,
    previous: 11920,
    format: "currency",
    good: "neutral",
    series: series(1700, 12, [0, 80, -40, 120, 60, -150, 90]),
    previousSeries: series(1690, 4, [30, -60, 70, 10, -40, -90, 50]),
  },
  {
    id: "escalations",
    label: "Handed to a person",
    value: 316,
    previous: 288,
    good: "down",
    series: series(40, 0.9, [0, 3, -2, 5, 1, -4, 2]),
    previousSeries: series(41, 0, [2, -1, 3, -3, 1, 0, -2]),
  },
];

function formatValue(n: number, format: StatFormat = "number"): string {
  if (format === "percent") return `${n.toFixed(1)}%`;
  if (format === "currency") return `$${Math.round(n).toLocaleString("en-US")}`;
  if (format === "duration") {
    if (n < 60) return `${Math.round(n)}s`;
    const m = Math.floor(n / 60);
    return `${m}m ${String(Math.round(n % 60)).padStart(2, "0")}s`;
  }
  return Math.round(n).toLocaleString("en-US");
}

interface Delta {
  text: string;
  spoken: string;
  dir: "up" | "down" | "flat";
  tone: "good" | "bad" | "flat";
}

function delta(m: StatMetric): Delta {
  const diff = m.value - m.previous;
  const format = m.format ?? "number";
  const rel = m.previous === 0 ? 0 : diff / Math.abs(m.previous);
  const flat = format === "percent" ? Math.abs(diff) < 0.05 : Math.abs(rel) < 0.005;
  const dir = flat ? "flat" : diff > 0 ? "up" : "down";
  const good = m.good ?? "up";
  const tone = dir === "flat" || good === "neutral" ? "flat" : dir === good ? "good" : "bad";
  // The trend icon carries the direction, so the figure goes unsigned
  const text =
    dir === "flat"
      ? "No change"
      : format === "percent"
        ? `${Math.abs(diff).toFixed(1)} pts`
        : format === "duration"
          ? formatValue(Math.abs(diff), "duration")
          : `${(Math.abs(rel) * 100).toFixed(1)}%`;
  const word = dir === "up" ? "Up" : "Down";
  const verdict = tone === "good" ? ", better" : tone === "bad" ? ", worse" : "";
  const spoken = dir === "flat" ? "No change" : `${word} ${text}${verdict}`;
  return { text, spoken, dir, tone };
}

/** Points for a polyline in a 100 x 28 box, scaled over both periods so their heights compare. */
function points(values: number[], lo: number, hi: number): string {
  const span = hi - lo || 1;
  const last = Math.max(1, values.length - 1);
  return values.map((v, i) => `${((i / last) * 100).toFixed(2)},${(25 - ((v - lo) / span) * 22).toFixed(2)}`).join(" ");
}

function Sparkline({ metric }: { metric: StatMetric }) {
  const now = metric.series ?? [];
  const before = metric.previousSeries ?? [];
  if (now.length < 2) return <span className="kb-sg-spark" />;
  const all = [...now, ...before];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const lastV = now[now.length - 1] ?? 0;
  const y = 25 - ((lastV - lo) / (hi - lo || 1)) * 22;
  return (
    <span className="kb-sg-spark" aria-hidden>
      <svg viewBox="0 0 100 28" preserveAspectRatio="none">
        {before.length > 1 ? <polyline className="kb-sg-before" points={points(before, lo, hi)} /> : null}
        <polyline className="kb-sg-now" points={points(now, lo, hi)} />
      </svg>
      <i className="kb-sg-end" style={{ top: `${(y / 28) * 100}%` }} />
    </span>
  );
}

/**
 * A row of three to six metrics read as one instrument panel: hairline-divided cells of a single part, every value
 * on one baseline and one type size. Each cell has the change against the comparison period (its color says
 * better or worse for that metric, not just up or down) and a sparkline with the comparison period dotted under it.
 */
export function StatGrid({
  metrics = demoStatMetrics,
  title = "Product health",
  period = "Last 7 days",
  previousLabel = "the week before",
  columns,
  selected,
  defaultSelected = null,
  onSelect,
  readOnly = false,
  loading = false,
  error = null,
  onRetry,
  errorDetail = "",
  status,
  updatedAt = null,
  onRefresh,
  emptyAction = { label: "Track your first event", icon: "code", onClick: () => {} },
  className,
}: StatGridProps) {
  const [inner, setInner] = useState<string | null>(defaultSelected);
  const current = selected === undefined ? inner : selected;
  const count = loading ? metrics.length || 4 : metrics.length;
  const cols = columns ?? (count <= 4 ? Math.max(2, count) : count === 5 ? 5 : 3);

  const pick = (id: string) => {
    if (selected === undefined) setInner(id);
    onSelect?.(id);
  };

  const head =
    title !== null || status ? (
      <header className="kb-sg-head">
        <div className="kb-sg-title">
          {title !== null ? <h3>{title}</h3> : null}
          {period ? <p>{period}</p> : null}
        </div>
        {status ? <FreshnessBadge status={status} updatedAt={updatedAt} onRefresh={onRefresh} /> : null}
      </header>
    ) : null;

  let body;
  if (loading) {
    body = (
      <SkeletonRegion label="Loading metrics">
        <div className="kb-sg-grid" data-cols={cols}>
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className="kb-sg-tile" data-skeleton>
              <Skeleton width="58%" height={10} style={{ alignSelf: "center" }} />
              <Skeleton width="62%" height={26} style={{ alignSelf: "center" }} />
              <Skeleton height={28} />
              <Skeleton width="70%" height={10} style={{ alignSelf: "center" }} />
            </div>
          ))}
        </div>
      </SkeletonRegion>
    );
  } else if (error) {
    body = <ErrorState className="kb-sg-state" title="Couldn't load these metrics" body={error} detail={errorDetail} onRetry={onRetry} />;
  } else if (metrics.length === 0) {
    body = (
      <EmptyState
        className="kb-sg-state"
        title="No data for this period"
        body="Metrics fill in a minute after your app sends its first event."
        action={emptyAction}
      />
    );
  } else {
    body = (
      <div className="kb-sg-grid" data-cols={cols} role="list" aria-label={title ?? "Metrics"}>
        {metrics.map((m) => {
          const d = delta(m);
          const isSel = current === m.id;
          const inside = (
            <>
              <span className="kb-sg-label">{m.label}</span>
              <span className="kb-sg-reading">
                <span className="kb-sg-value">{formatValue(m.value, m.format)}</span>
                <span className="kb-sg-delta" data-tone={d.tone}>
                  {d.dir === "flat" ? <Icon name="minus" size={14} /> : <Icon name={d.dir === "up" ? "trendUp" : "trendDown"} size={14} />}
                  <span aria-hidden>{d.text}</span>
                  <span className="kb-sr">{d.spoken}</span>
                </span>
              </span>
              <Sparkline metric={m} />
              <span className="kb-sg-prev">
                vs <span className="kb-sg-mono">{formatValue(m.previous, m.format)}</span> {previousLabel}
              </span>
            </>
          );
          return (
            <div key={m.id} role="listitem" className="kb-sg-cell">
              {readOnly ? (
                <div className="kb-sg-tile">{inside}</div>
              ) : (
                <button type="button" className="kb-sg-tile" aria-pressed={isSel} data-selected={isSel || undefined} onClick={() => pick(m.id)}>
                  {inside}
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section className={cx("kb-sg", className)} aria-label={title ?? "Metrics"} aria-busy={loading || undefined}>
      {head}
      {body}
    </section>
  );
}
