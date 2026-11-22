"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "../button/Button.tsx";
import { EmptyState, type EmptyStateProps } from "../empty-state/EmptyState.tsx";
import { ErrorState } from "../error-state/ErrorState.tsx";
import { FreshnessBadge } from "../freshness-badge/FreshnessBadge.tsx";
import { SegmentedControl } from "../segmented-control/SegmentedControl.tsx";
import { Skeleton, SkeletonRegion } from "../skeleton/Skeleton.tsx";
import { cx, useReducedMotion, type LoadStatus } from "../../shared/index.ts";
import "./top-list.css";

export type TopListFormat = "number" | "currency" | "percent";

export interface TopListMetric {
  value: string;
  label: string;
  format?: TopListFormat;
  /** Which direction is good: more ("up"), less ("down"), or neither */
  good?: "up" | "down" | "neutral";
}

export interface TopListRow {
  id: string;
  label: string;
  /** Second line, e.g. the owning team */
  detail?: string;
  /** The label is a machine value (an id, a path) and is set in mono */
  code?: boolean;
  /** This period and the previous one, per metric */
  values: Record<string, { value: number; previous: number }>;
}

export interface TopListProps {
  rows?: TopListRow[];
  metrics?: TopListMetric[];
  /** Metric to rank by. Omit to let the list keep its own */
  metric?: string;
  defaultMetric?: string;
  onMetricChange?: (metric: string) => void;
  /** Header over the names column */
  itemLabel?: string;
  /** Rows shown before "Show more" */
  limit?: number;
  title?: string;
  subtitle?: string;
  /** Rows become buttons */
  onSelect?: (row: TopListRow) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Technical detail under the error, e.g. a status and request id */
  errorDetail?: string;
  status?: LoadStatus;
  updatedAt?: number | null;
  onRefresh?: () => void;
  emptyAction?: EmptyStateProps["action"];
  className?: string;
}

export const demoTopListMetrics: TopListMetric[] = [
  { value: "runs", label: "Runs" },
  { value: "spend", label: "Spend", format: "currency", good: "neutral" },
  { value: "handoffs", label: "Handoffs", good: "down" },
];

const agent = (id: string, detail: string, runs: [number, number], spend: [number, number], handoffs: [number, number]): TopListRow => ({
  id,
  label: id,
  detail,
  code: true,
  values: {
    runs: { value: runs[0], previous: runs[1] },
    spend: { value: spend[0], previous: spend[1] },
    handoffs: { value: handoffs[0], previous: handoffs[1] },
  },
});

export const demoTopListRows: TopListRow[] = [
  agent("triage-bot", "Support", [14820, 12940], [1840, 1610], [212, 260]),
  agent("pr-reviewer", "Platform", [9310, 9480], [4120, 3980], [38, 41]),
  agent("refund-agent", "Support", [6240, 5110], [920, 760], [486, 402]),
  agent("release-notes", "Product", [4180, 3920], [610, 590], [12, 9]),
  agent("sql-analyst", "Data", [3960, 2210], [2780, 1530], [64, 51]),
  agent("invoice-chaser", "Finance", [2870, 2940], [240, 250], [131, 118]),
  agent("flaky-test-hunter", "Platform", [2410, 1980], [1460, 1210], [7, 11]),
  agent("incident-scribe", "Infra", [1290, 1410], [380, 420], [22, 30]),
  agent("onboarding-guide", "Growth", [1170, 640], [150, 90], [96, 44]),
  agent("docs-writer", "Product", [860, 910], [520, 540], [5, 6]),
];

function fmt(n: number, format: TopListFormat = "number"): string {
  if (format === "currency") return `$${Math.round(n).toLocaleString("en-US")}`;
  if (format === "percent") return `${n.toFixed(1)}%`;
  return Math.round(n).toLocaleString("en-US");
}

function change(value: number, previous: number, m: TopListMetric) {
  if (previous === 0) return { text: "new", spoken: "new this period", tone: "flat" as const, dir: "flat" as const };
  const rel = (value - previous) / previous;
  const dir = Math.abs(rel) < 0.005 ? ("flat" as const) : rel > 0 ? ("up" as const) : ("down" as const);
  const good = m.good ?? "up";
  const tone = dir === "flat" || good === "neutral" ? ("flat" as const) : dir === good ? ("good" as const) : ("bad" as const);
  const pct = Math.abs(rel * 100);
  const text = dir === "flat" ? "0%" : `${dir === "up" ? "+" : "−"}${pct >= 100 ? Math.round(pct) : pct.toFixed(1)}%`;
  const spoken = dir === "flat" ? "no change" : `${dir} ${pct.toFixed(1)} percent${tone === "good" ? ", better" : tone === "bad" ? ", worse" : ""}`;
  return { text, spoken, tone, dir };
}

/**
 * A ranked list with each row's magnitude drawn as a rail under its name, measured against the leader. Switch the
 * metric and the rows re-rank with a glide, so you can follow where each one went; the change against the previous
 * period is colored by whether it is better or worse for that metric.
 */
export function TopList({
  rows = demoTopListRows,
  metrics = demoTopListMetrics,
  metric,
  defaultMetric,
  onMetricChange,
  itemLabel = "Agent",
  limit = 6,
  title = "Top agents",
  subtitle = "Last 30 days, compared with the 30 before",
  onSelect,
  loading = false,
  error = null,
  onRetry,
  errorDetail = "",
  status,
  updatedAt = null,
  onRefresh,
  emptyAction = { label: "Create an agent", icon: "plus", onClick: () => {} },
  className,
}: TopListProps) {
  const reduced = useReducedMotion();
  const [inner, setInner] = useState(defaultMetric ?? metrics[0]?.value ?? "");
  const key = metric ?? inner;
  const m = metrics.find((x) => x.value === key) ?? metrics[0];
  const [expanded, setExpanded] = useState(false);

  const ranked = m ? [...rows].filter((r) => r.values[m.value]).sort((a, b) => (b.values[m.value]?.value ?? 0) - (a.values[m.value]?.value ?? 0)) : [];
  const shown = expanded ? ranked : ranked.slice(0, limit);
  const lead = ranked[0]?.values[m?.value ?? ""]?.value ?? 0;

  const setMetric = (v: string) => {
    if (metric === undefined) setInner(v);
    onMetricChange?.(v);
  };

  // Re-rank with a glide: each row starts where it was and slides to its new place (FLIP)
  const els = useRef(new Map<string, HTMLLIElement>());
  const tops = useRef(new Map<string, number>());
  const order = shown.map((r) => r.id).join("|");
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    els.current.forEach((el, id) => {
      const top = el.offsetTop;
      next.set(id, top);
      const before = tops.current.get(id);
      if (reduced || before === undefined || before === top) return;
      el.style.transition = "none";
      el.style.transform = `translateY(${before - top}px)`;
      void el.offsetWidth;
      requestAnimationFrame(() => {
        el.style.transition = "";
        el.style.transform = "";
      });
    });
    tops.current = next;
  }, [order, reduced]);

  let body;
  if (loading) {
    body = (
      <SkeletonRegion label="Loading ranking">
        <ol className="kb-tl-list" aria-hidden>
          <li className="kb-tl-row kb-tl-axis"><span /><Skeleton width={44} height={9} /><span /><span /></li>
          {Array.from({ length: limit }, (_, i) => (
            <li key={i} className="kb-tl-row">
              <Skeleton width={14} height={10} />
              <span className="kb-tl-main">
                <Skeleton width={`${40 + ((i * 19) % 30)}%`} height={11} />
                <Skeleton width={`${Math.max(8, 96 - i * 15)}%`} height={4} style={{ marginTop: 9 }} />
              </span>
              <Skeleton width={52} height={11} style={{ justifySelf: "end" }} />
              <Skeleton width={44} height={10} style={{ justifySelf: "end" }} />
            </li>
          ))}
        </ol>
      </SkeletonRegion>
    );
  } else if (error) {
    body = <ErrorState className="kb-tl-state" size="sm" title="Couldn't load the ranking" body={error} detail={errorDetail} onRetry={onRetry} />;
  } else if (!m || ranked.length === 0) {
    body = <EmptyState className="kb-tl-state" size="sm" title="Nothing to rank yet" body="Rows appear once there is activity in this period." action={emptyAction} />;
  } else {
    body = (
      <>
        <ol className="kb-tl-list" aria-label={`${title}, by ${m.label.toLowerCase()}`}>
          <li className="kb-tl-row kb-tl-axis" aria-hidden>
            <span>#</span>
            <span>{itemLabel}</span>
            <span className="kb-tl-num">{m.label}</span>
            <span className="kb-tl-num">Change</span>
          </li>
          {shown.map((r, i) => {
            const v = r.values[m.value] ?? { value: 0, previous: 0 };
            const c = change(v.value, v.previous, m);
            const inside = (
              <>
                <span className="kb-tl-rank">{i + 1}</span>
                <span className="kb-tl-main">
                  <span className="kb-tl-name">
                    <span className={r.code ? "kb-tl-code" : undefined}>{r.label}</span>
                    {r.detail ? <span className="kb-tl-detail">{r.detail}</span> : null}
                  </span>
                  <span className="kb-tl-rail" aria-hidden>
                    <i style={{ "--w": lead ? v.value / lead : 0 } as CSSProperties} />
                  </span>
                </span>
                <span className="kb-tl-num kb-tl-value">{fmt(v.value, m.format)}</span>
                <span className="kb-tl-num kb-tl-change" data-tone={c.tone}>
                  <span aria-hidden>{c.text}</span>
                  <span className="kb-sr">{c.spoken}</span>
                </span>
              </>
            );
            return (
              <li
                key={r.id}
                ref={(el) => {
                  if (el) els.current.set(r.id, el);
                  else els.current.delete(r.id);
                }}
                className="kb-tl-item"
              >
                {onSelect ? (
                  <button type="button" className="kb-tl-row" onClick={() => onSelect(r)}>{inside}</button>
                ) : (
                  <div className="kb-tl-row">{inside}</div>
                )}
              </li>
            );
          })}
        </ol>
        {ranked.length > limit ? (
          <div className="kb-tl-foot">
            <Button variant="ghost" size="sm" icon={expanded ? "chevronUp" : "chevronDown"} onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
              {expanded ? "Show top " + limit : `Show ${ranked.length - limit} more`}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <section className={cx("kb-tl", className)} aria-label={title} aria-busy={loading || undefined}>
      <header className="kb-tl-head">
        <div className="kb-tl-title">
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {status ? <FreshnessBadge status={status} updatedAt={updatedAt} onRefresh={onRefresh} /> : null}
      </header>
      {metrics.length > 1 ? (
        <div className="kb-tl-switch">
          <SegmentedControl
            size="sm"
            variant="underline"
            label="Rank by"
            draggable={false}
            options={metrics.map((x) => ({ value: x.value, label: x.label }))}
            value={m?.value ?? key}
            onChange={setMetric}
          />
        </div>
      ) : null}
      {body}
    </section>
  );
}
