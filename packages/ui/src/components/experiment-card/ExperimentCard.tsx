"use client";

import { useId, useState } from "react";
import type { KeyboardEvent } from "react";
import { cx, Icon, NumberRoll, Tag } from "../../shared/index.ts";
import "./experiment-card.css";

/** Chart series colors (data): control is slate, the challenger ultramarine; a light and a dark value each. */
const SERIES = ["var(--kb-ink-3)", "var(--kb-series-1)", "var(--kb-series-3)"];

export interface ExperimentVariant {
  id: string;
  name: string;
  description: string;
  /** Runs assigned so far */
  samples: number;
}

export interface ExperimentMetric {
  id: string;
  label: string;
  format: (value: number) => string;
  lowerIsBetter?: boolean;
  /** Show the gap in points (for rates) instead of percent */
  points?: boolean;
  /** Chance the leader really is better, 0 to 1 */
  confidence: number;
  /** Daily running value per variant, keyed by variant id; the last value is the current one */
  series: Record<string, number[]>;
}

export interface ExperimentCardProps {
  name?: string;
  day?: number;
  length?: number;
  variants?: ExperimentVariant[];
  metrics?: ExperimentMetric[];
  /** Confidence needed before the card asks for a decision */
  decideAt?: number;
  /** Start with a winner already chosen */
  defaultWinner?: string | null;
  /** Start unfolded */
  defaultOpen?: boolean;
  onPickWinner?: (variantId: string | null) => void;
  className?: string;
}

export const experimentDemoVariants: ExperimentVariant[] = [
  { id: "a", name: "Control", description: "Current triage prompt", samples: 4812 },
  { id: "b", name: "Shorter prompt", description: "Half the instructions, plus tool hints", samples: 4790 },
];

export const experimentDemoMetrics: ExperimentMetric[] = [
  {
    id: "resolved",
    label: "Resolved without a person",
    format: (v) => `${v.toFixed(1)}%`,
    points: true,
    confidence: 0.96,
    series: {
      a: [70.1, 71.8, 70.9, 71.4, 70.6, 71.0, 71.3, 71.1, 71.2],
      b: [69.4, 72.6, 73.9, 74.2, 75.1, 74.8, 75.4, 75.0, 75.3],
    },
  },
  {
    id: "cost",
    label: "Cost per run",
    format: (v) => `$${v.toFixed(3)}`,
    lowerIsBetter: true,
    confidence: 0.99,
    series: {
      a: [0.022, 0.021, 0.021, 0.022, 0.021, 0.021, 0.021, 0.021, 0.021],
      b: [0.019, 0.018, 0.017, 0.017, 0.017, 0.018, 0.017, 0.017, 0.017],
    },
  },
  {
    id: "latency",
    label: "Median run time",
    format: (v) => `${v.toFixed(1)}s`,
    lowerIsBetter: true,
    confidence: 0.62,
    series: {
      a: [38.4, 37.9, 38.6, 38.1, 38.0, 38.3, 37.8, 38.2, 38.1],
      b: [41.2, 40.6, 39.8, 40.4, 40.9, 40.1, 40.6, 40.3, 40.5],
    },
  },
];

const CW = 460;
const CH = 72;

/**
 * An A/B test in two lines that unfolds on hover or focus. Variants link to their lines in a tiny chart, the
 * metric switch rolls every figure, and once the result is clear the card wears the decal-yellow tag until a
 * person picks a winner, which then snaps into its socket.
 */
export function ExperimentCard({
  name = "Shorter triage prompt",
  day = 9,
  length = 14,
  variants = experimentDemoVariants,
  metrics = experimentDemoMetrics,
  decideAt = 0.95,
  defaultWinner = null,
  defaultOpen = false,
  onPickWinner,
  className,
}: ExperimentCardProps) {
  const uid = useId();
  const [metricId, setMetricId] = useState(metrics[0]?.id ?? "");
  const [winner, setWinner] = useState<string | null>(defaultWinner);
  const [pinned, setPinned] = useState(defaultOpen);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hot, setHot] = useState<string | null>(null);
  const open = pinned || hovered || focused;

  const metric = metrics.find((m) => m.id === metricId) ?? metrics[0];
  const control = variants[0];
  const now = (id: string) => {
    const s = metric?.series[id];
    return s?.[s.length - 1] ?? 0;
  };
  const better = (a: number, b: number) => (metric?.lowerIsBetter ? a < b : a > b);
  const leader = variants.reduce<ExperimentVariant | undefined>((best, v) => (!best || better(now(v.id), now(best.id)) ? v : best), undefined);
  const gap = (v: ExperimentVariant) => {
    if (!metric || !control) return "";
    const a = now(control.id);
    const b = now(v.id);
    const d = metric.points ? b - a : a ? ((b - a) / a) * 100 : 0;
    return `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}${metric.points ? " pts" : "%"}`;
  };
  const decided = (metric?.confidence ?? 0) >= decideAt;
  const anyDecided = metrics.some((m) => m.confidence >= decideAt);
  const needsCall = anyDecided && winner === null;
  const winnerVariant = variants.find((v) => v.id === winner);

  const pick = (id: string | null) => {
    setWinner(id);
    onPickWinner?.(id);
  };

  const onMetricKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const i = metrics.findIndex((m) => m.id === metricId);
    const n = metrics.length;
    const next = event.key === "ArrowRight" ? (i + 1) % n : event.key === "ArrowLeft" ? (i - 1 + n) % n : null;
    if (next === null) return;
    event.preventDefault();
    setMetricId(metrics[next]?.id ?? metricId);
    event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };

  // Tiny chart: every variant's running value for the chosen metric
  const all = metric ? variants.flatMap((v) => metric.series[v.id] ?? []) : [];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const points = (values: number[]) =>
    values.map((v, i) => `${(4 + (i / Math.max(1, values.length - 1)) * (CW - 8)).toFixed(1)},${(6 + (1 - (v - lo) / span) * (CH - 12)).toFixed(1)}`).join(" ");

  const summary = winnerVariant
    ? `${winnerVariant.name} chosen. Rolling out to all traffic.`
    : leader && control && leader.id !== control.id && metric
      ? `${leader.name} leads on ${metric.label.toLowerCase()} by ${gap(leader).replace(/^[+−]/, "")}, ${Math.round(metric.confidence * 100)}% confidence`
      : metric
        ? `${control?.name ?? "Control"} is ahead on ${metric.label.toLowerCase()}, ${Math.round(metric.confidence * 100)}% confidence`
        : "";

  return (
    <article
      className={cx("kb-exp kb-part", className)}
      data-open={open || undefined}
      data-call={needsCall || undefined}
      aria-labelledby={`${uid}-t`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <header className="kb-exp-head">
        <div className="kb-exp-line1">
          <h3 id={`${uid}-t`} className="kb-exp-name">{name}</h3>
          {winnerVariant ? <Tag tone="ok" dot>Decided</Tag> : needsCall ? <Tag tone="decal" dot>Needs your call</Tag> : <Tag tone="agent" live>Running</Tag>}
          <span className="kb-exp-day">{`Day ${day} of ${length}`}</span>
          <button
            type="button"
            className="kb-exp-pin"
            aria-expanded={open}
            aria-controls={`${uid}-body`}
            aria-label={pinned ? "Fold details" : "Keep details open"}
            onClick={() => setPinned((p) => !p)}
          >
            <Icon name="chevronDown" size={16} />
          </button>
        </div>
        <p className="kb-exp-line2" aria-live="polite">
          {winnerVariant ? <Icon name="check" size={14} /> : null}
          {summary}
        </p>
      </header>

      <div className="kb-exp-fold" id={`${uid}-body`} inert={!open || undefined}>
        <div className="kb-exp-body">
          <div className="kb-exp-metrics" role="radiogroup" aria-label="Metric" onKeyDown={onMetricKey}>
            {metrics.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={m.id === metricId}
                tabIndex={m.id === metricId ? 0 : -1}
                onClick={() => setMetricId(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="kb-exp-grid">
            <ul className="kb-exp-variants">
              {variants.map((v, i) => {
                const color = SERIES[i % SERIES.length];
                const isWinner = winner === v.id;
                const isLeader = leader?.id === v.id;
                return (
                  <li
                    key={v.id}
                    className="kb-exp-variant"
                    data-hot={hot === v.id || undefined}
                    data-dim={(hot && hot !== v.id) || (winner && !isWinner) || undefined}
                    data-winner={isWinner || undefined}
                    onPointerEnter={() => setHot(v.id)}
                    onPointerLeave={() => setHot(null)}
                  >
                    <span className="kb-exp-letter" style={{ background: color }} aria-hidden>{String.fromCharCode(65 + i)}</span>
                    <span className="kb-exp-vtext">
                      <span className="kb-exp-vname">{v.name}</span>
                      <span className="kb-exp-vdesc">{`${v.description}, ${v.samples.toLocaleString("en-US")} runs`}</span>
                    </span>
                    <span className="kb-exp-vfig">
                      <NumberRoll value={metric?.format(now(v.id)) ?? ""} className="kb-exp-vnum" />
                      {i > 0 ? (
                        <span className="kb-exp-gap" data-good={(isLeader && decided) || undefined}>{gap(v)}</span>
                      ) : (
                        <span className="kb-exp-gap">baseline</span>
                      )}
                    </span>
                    <span className="kb-exp-socket">
                      {isWinner ? (
                        <span className="kb-exp-seated">
                          <Icon name="check" size={14} strokeWidth={2.25} />
                          Winner
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="kb-exp-pick"
                          onClick={() => pick(v.id)}
                          onFocus={() => setHot(v.id)}
                          onBlur={() => setHot(null)}
                          aria-label={`Pick ${v.name} as the winner`}
                        >
                          Pick
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>

            <figure className="kb-exp-chart">
              <svg viewBox={`0 0 ${CW} ${CH}`} role="img" aria-label={`${metric?.label ?? ""} by day: ${variants.map((v) => `${v.name} ${metric?.format(now(v.id)) ?? ""}`).join(", ")}`}>
                <line x1={0} x2={CW} y1={CH - 1} y2={CH - 1} className="kb-exp-axis" />
                {variants.map((v, i) => {
                  const pts = points(metric?.series[v.id] ?? []);
                  return (
                    <g key={`${metricId}-${v.id}`} data-dim={(hot && hot !== v.id) || undefined} className="kb-exp-series">
                      <polyline points={pts} className="kb-exp-line" style={{ stroke: SERIES[i % SERIES.length] }} pathLength={1} />
                      <polyline
                        points={pts}
                        className="kb-exp-hit"
                        onPointerEnter={() => setHot(v.id)}
                        onPointerLeave={() => setHot(null)}
                      />
                    </g>
                  );
                })}
              </svg>
              <figcaption className="kb-exp-cap">{`Running value, days 1 to ${day}`}</figcaption>
            </figure>
          </div>

          <footer className="kb-exp-foot">
            <span className="kb-exp-conf">
              <span className="kb-exp-conf-track" aria-hidden>
                <i style={{ width: `${(metric?.confidence ?? 0) * 100}%` }} data-met={decided || undefined} />
                <b style={{ left: `${decideAt * 100}%` }} />
              </span>
              {`${Math.round((metric?.confidence ?? 0) * 100)}% confidence on this metric`}
            </span>
            {winner ? (
              <button type="button" className="kb-exp-undo" onClick={() => pick(null)}>Change winner</button>
            ) : null}
          </footer>
        </div>
      </div>
    </article>
  );
}
