"use client";

import { useId, useState } from "react";
import type { KeyboardEvent } from "react";
import { cx, Icon, NumberRoll } from "../../shared/index.ts";
import "./change-summary.css";

export interface ChangeMetric {
  id: string;
  label: string;
  /** Value now, then the value at each baseline, in the same order as `baselines` */
  now: number;
  before: number[];
  format?: (value: number) => string;
  /** Set when a rise is bad news (latency, escalations, spend) */
  lowerIsBetter?: boolean;
  /** Changes larger than this (as a fraction, 0.15 = 15%) in the bad direction need a person to look */
  alertAt?: number;
  /** Show the change in points instead of percent, for rates that are already percentages */
  points?: boolean;
}

export interface ChangeSummaryProps {
  title?: string;
  /** Baselines to compare against, e.g. "Last visit", "Last week" */
  baselines?: string[];
  metrics?: ChangeMetric[];
  /** Called when the person opens a flagged metric */
  onReview?: (metric: ChangeMetric) => void;
  className?: string;
}

const count = (v: number) => Math.round(v).toLocaleString("en-US");

export const changeDemoMetrics: ChangeMetric[] = [
  { id: "resolved", label: "Tasks resolved", now: 1284, before: [1142, 1301] },
  { id: "escalated", label: "Handed to a person", now: 37, before: [29, 41], lowerIsBetter: true, alertAt: 0.2 },
  { id: "latency", label: "Median run time", now: 42, before: [46, 39], lowerIsBetter: true, format: (v) => `${v}s` },
  { id: "spend", label: "Model spend", now: 412.8, before: [400.3, 377.9], lowerIsBetter: true, alertAt: 0.25, format: (v) => `$${v.toFixed(2)}` },
  { id: "errors", label: "Tool error rate", now: 0.6, before: [1.0, 0.7], lowerIsBetter: true, points: true, format: (v) => `${v.toFixed(1)}%` },
  { id: "csat", label: "Customer rating", now: 4.6, before: [4.5, 4.6], format: (v) => v.toFixed(1) },
];

/** 0..4 notches: how far a metric moved, like clicks on a detent dial */
function notches(change: number): number {
  const size = Math.abs(change);
  if (size < 0.005) return 0;
  if (size < 0.05) return 1;
  if (size < 0.12) return 2;
  if (size < 0.25) return 3;
  return 4;
}

/**
 * What moved since last time, one metric per row. Each change reads as a colored trend plus detent notches for
 * its size, judged by whether the move is good for that metric; rows that cross their alert line wear the
 * decal-yellow flag because they wait on a person.
 */
export function ChangeSummary({
  title = "Since your last visit",
  baselines = ["Last visit", "Last week"],
  metrics = changeDemoMetrics,
  onReview,
  className,
}: ChangeSummaryProps) {
  const uid = useId();
  const [base, setBase] = useState(0);
  const [reviewed, setReviewed] = useState<Set<string>>(() => new Set());

  const onTabsKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const n = baselines.length;
    const next = event.key === "ArrowRight" ? (base + 1) % n : event.key === "ArrowLeft" ? (base - 1 + n) % n : null;
    if (next === null) return;
    event.preventDefault();
    setBase(next);
    event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };

  const rows = metrics.map((m) => {
    const fmt = m.format ?? count;
    const was = m.before[base] ?? m.now;
    const diff = m.now - was;
    const change = was ? diff / was : 0;
    const flat = notches(change) === 0;
    const good = flat ? null : (diff > 0) !== Boolean(m.lowerIsBetter);
    const alert = !flat && good === false && m.alertAt !== undefined && Math.abs(change) >= m.alertAt && !reviewed.has(m.id);
    const deltaText = flat
      ? "No change"
      : m.points
        ? `${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)} pts`
        : `${diff > 0 ? "+" : "−"}${Math.abs(change * 100).toFixed(1)}%`;
    return { m, fmt, was, diff, change, flat, good, alert, deltaText };
  });
  const flagged = rows.filter((r) => r.alert).length;

  return (
    <section className={cx("kb-chg kb-part", className)} aria-labelledby={`${uid}-t`}>
      <header className="kb-chg-head">
        <div>
          <h3 id={`${uid}-t`} className="kb-chg-title">{title}</h3>
          <p className="kb-chg-sub">
            {flagged ? `${flagged} ${flagged === 1 ? "change needs" : "changes need"} a look` : "Nothing needs your attention"}
          </p>
        </div>
        <div className="kb-chg-tabs" role="radiogroup" aria-label="Compare with" onKeyDown={onTabsKey}>
          {baselines.map((b, i) => (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={i === base}
              tabIndex={i === base ? 0 : -1}
              className="kb-chg-tab"
              onClick={() => setBase(i)}
            >
              {b}
            </button>
          ))}
        </div>
      </header>

      <ul className="kb-chg-list">
        {rows.map(({ m, fmt, was, flat, good, alert, deltaText, change }) => {
          const n = notches(change);
          const tone = flat ? "flat" : good ? "good" : "bad";
          return (
            <li
              key={m.id}
              className="kb-chg-row"
              data-alert={alert || undefined}
            >
              <span className="kb-sr">
                {`${m.label}: ${fmt(m.now)}, ${flat ? "no change" : `${deltaText}, ${good ? "an improvement" : "worse"}`} from ${fmt(was)}.${alert ? " Needs a look." : ""}`}
              </span>
              <span className="kb-chg-label" aria-hidden>
                {m.label}
                <span className="kb-chg-was" aria-hidden>{`was ${fmt(was)}`}</span>
              </span>
              <span aria-hidden className="kb-chg-now">
                <NumberRoll value={fmt(m.now)} />
              </span>
              <span className="kb-chg-delta" data-tone={tone} aria-hidden>
                {flat ? <Icon name="minus" size={14} /> : <Icon name={change > 0 ? "trendUp" : "trendDown"} size={14} />}
                <span className="kb-chg-delta-text">{deltaText}</span>
                <span className="kb-chg-notches">
                  {[0, 1, 2, 3].map((i) => <i key={i} data-on={i < n || undefined} />)}
                </span>
              </span>
              {alert ? (
                <button
                  type="button"
                  className="kb-chg-flag"
                  onClick={() => {
                    onReview?.(m);
                    setReviewed((prev) => new Set(prev).add(m.id));
                  }}
                >
                  Mark as seen
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
