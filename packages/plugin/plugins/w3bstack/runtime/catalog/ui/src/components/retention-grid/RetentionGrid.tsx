"use client";

import { useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { EmptyState, type EmptyStateProps } from "../empty-state/EmptyState.tsx";
import { ErrorState } from "../error-state/ErrorState.tsx";
import { FreshnessBadge } from "../freshness-badge/FreshnessBadge.tsx";
import { SegmentedControl } from "../segmented-control/SegmentedControl.tsx";
import { Skeleton, SkeletonRegion } from "../skeleton/Skeleton.tsx";
import { cx, type LoadStatus } from "../../shared/index.ts";
import "./retention-grid.css";

export interface RetentionCohort {
  id: string;
  /** When the cohort started, e.g. "Sep 8" */
  label: string;
  /** How many joined in that week */
  size: number;
  /** Percent still active in each week since joining, week 0 first. Younger cohorts have fewer weeks */
  retention: number[];
}

export type RetentionView = "percent" | "count";

export interface RetentionGridProps {
  cohorts?: RetentionCohort[];
  /** Show percentages or head counts. Omit to let the grid keep its own */
  view?: RetentionView;
  defaultView?: RetentionView;
  onViewChange?: (view: RetentionView) => void;
  title?: string;
  subtitle?: string;
  /** What a cohort is made of, plural */
  unit?: string;
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

const CURVE = [100, 54, 44, 39, 36, 34, 33, 32, 31];
// Newer cohorts retain a little better, with some week-to-week noise
const NOISE = [0, -1.6, 2.1, -0.8, 1.2, -1.9, 0.7, 1.5, -0.4, 0.9, -1.1, 0.3];
const STARTS = ["Aug 18", "Aug 25", "Sep 1", "Sep 8", "Sep 15", "Sep 22", "Sep 29", "Oct 6", "Oct 13"];
const SIZES = [962, 1034, 1118, 1248, 1190, 1302, 1276, 1411, 1389];

export const demoRetentionCohorts: RetentionCohort[] = STARTS.map((label, k) => ({
  id: `c${k}`,
  label,
  size: SIZES[k] ?? 1000,
  retention: CURVE.slice(0, CURVE.length - k).map((v, w) => (w === 0 ? 100 : Math.round((v + k * 0.9 + (NOISE[(k + w) % NOISE.length] ?? 0)) * 10) / 10)),
}));

type Cell = { r: number; c: number };

/**
 * Weekly cohort retention as a heatmap that stays a real table: one row per signup week, one column per week since,
 * each cell shaded in a single series hue by the share still active. Hover or arrow through the cells to read one;
 * its row and column headers light up like a crosshair, and the reading is spoken. The average row is weighted by
 * cohort size and only counts cohorts old enough to have that week.
 */
export function RetentionGrid({
  cohorts = demoRetentionCohorts,
  view,
  defaultView = "percent",
  onViewChange,
  title = "Weekly retention",
  subtitle = "Teams that ran an agent, by the week they signed up",
  unit = "teams",
  loading = false,
  error = null,
  onRetry,
  errorDetail = "",
  status,
  updatedAt = null,
  onRefresh,
  emptyAction = { label: "Change the date range", icon: "calendar", onClick: () => {} },
  className,
}: RetentionGridProps) {
  const uid = useId();
  const [innerView, setInnerView] = useState<RetentionView>(defaultView);
  const shown = view ?? innerView;
  const [focus, setFocus] = useState<Cell>({ r: 0, c: 1 });
  const [lit, setLit] = useState<Cell | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const weeks = cohorts.reduce((n, c) => Math.max(n, c.retention.length), 0);
  const total = cohorts.reduce((n, c) => n + c.size, 0);
  // Size-weighted average for each week, over cohorts that have reached it
  const average = Array.from({ length: weeks }, (_, w) => {
    const have = cohorts.filter((c) => c.retention[w] !== undefined);
    const people = have.reduce((n, c) => n + c.size, 0);
    if (!people) return undefined;
    return have.reduce((sum, c) => sum + (c.retention[w] ?? 0) * c.size, 0) / people;
  });

  // Shade over the range the cells actually span (week 0 is always 100% and stays unshaded), so differences read
  const later = cohorts.flatMap((c) => c.retention.slice(1));
  const lo = later.length ? Math.min(...later) : 0;
  const hi = later.length ? Math.max(...later) : 100;
  const depth = (pct: number) => (hi > lo ? (pct - lo) / (hi - lo) : 0.5);
  const shade = (pct: number) => `${Math.round(10 + depth(pct) * 82)}%`;

  const setView = (v: string) => {
    const next = v === "count" ? "count" : "percent";
    if (view === undefined) setInnerView(next);
    onViewChange?.(next);
  };

  const fmt = (pct: number, size: number) => (shown === "percent" ? `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%` : Math.round((pct / 100) * size).toLocaleString("en-US"));
  const reading = (cell: Cell | null): string => {
    if (!cell) return "";
    const cohort = cohorts[cell.r];
    const pct = cohort?.retention[cell.c];
    if (!cohort || pct === undefined) return cohort ? `${cohort.label} cohort hasn't reached week ${cell.c} yet` : "";
    const people = Math.round((pct / 100) * cohort.size).toLocaleString("en-US");
    return cell.c === 0
      ? `${cohort.label} cohort: ${cohort.size.toLocaleString("en-US")} ${unit} signed up`
      : `${cohort.label} cohort, week ${cell.c}: ${Math.round(pct)}% still active, ${people} of ${cohort.size.toLocaleString("en-US")} ${unit}`;
  };

  // Without a cell under the pointer, say what the grid shows: is week 1 holding up for newer cohorts?
  const first = cohorts[0]?.retention[1];
  const latest = [...cohorts].reverse().find((c) => c.retention[1] !== undefined);
  const summary =
    first !== undefined && latest && latest !== cohorts[0]
      ? `Week 1 retention is ${Math.round(latest.retention[1] ?? 0)}% for the ${latest.label} cohort, ${Math.abs(Math.round((latest.retention[1] ?? 0) - first))} points ${(latest.retention[1] ?? 0) >= first ? "above" : "below"} ${cohorts[0]?.label}.`
      : "Hover or arrow through the cells to read one.";

  const move = (e: KeyboardEvent<HTMLTableElement>) => {
    const { r, c } = focus;
    let next: Cell | null = null;
    if (e.key === "ArrowRight") next = { r, c: Math.min(weeks - 1, c + 1) };
    else if (e.key === "ArrowLeft") next = { r, c: Math.max(0, c - 1) };
    else if (e.key === "ArrowDown") next = { r: Math.min(cohorts.length - 1, r + 1), c };
    else if (e.key === "ArrowUp") next = { r: Math.max(0, r - 1), c };
    else if (e.key === "Home") next = { r, c: 0 };
    else if (e.key === "End") next = { r, c: Math.max(0, (cohorts[r]?.retention.length ?? 1) - 1) };
    if (!next) return;
    e.preventDefault();
    setFocus(next);
    setLit(next);
    tableRef.current?.querySelector<HTMLElement>(`[data-cell="${next.r}-${next.c}"]`)?.focus();
  };

  let body;
  if (loading) {
    body = (
      <SkeletonRegion label="Loading retention">
        <div className="kb-rg-scroll">
          <div className="kb-rg-skel" style={{ "--weeks": 9 } as CSSProperties} aria-hidden>
            {Array.from({ length: 10 }, (_, r) => (
              <div key={r} className="kb-rg-skel-row">
                <Skeleton width={48} height={10} />
                <Skeleton width={36} height={10} style={{ justifySelf: "end" }} />
                {Array.from({ length: 9 }, (_, c) => (c < 9 - r || r === 9 ? <Skeleton key={c} height={28} radius="part" /> : <span key={c} />))}
              </div>
            ))}
          </div>
        </div>
      </SkeletonRegion>
    );
  } else if (error) {
    body = <ErrorState className="kb-rg-state" title="Couldn't load retention" body={error} detail={errorDetail} onRetry={onRetry} />;
  } else if (cohorts.length === 0) {
    body = <EmptyState className="kb-rg-state" title="No cohorts in this range" body={`Cohorts appear a week after the first ${unit} sign up.`} action={emptyAction} />;
  } else {
    body = (
      <>
        <div className="kb-rg-scroll">
          <table ref={tableRef} className="kb-rg-table" onKeyDown={move} onMouseLeave={() => setLit(null)} aria-describedby={`${uid}-read`}>
            <caption className="kb-sr">
              {title}. Rows are signup weeks, columns are weeks since signup, cells are {shown === "percent" ? `the percent of ${unit} still active` : `${unit} still active`}.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="kb-rg-cohort">Cohort</th>
                <th scope="col" className="kb-rg-size">{unit[0]?.toUpperCase()}{unit.slice(1)}</th>
                {Array.from({ length: weeks }, (_, w) => (
                  <th key={w} scope="col" className="kb-rg-week" data-lit={lit?.c === w || undefined}>
                    {w === 0 ? "Wk 0" : w}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map((cohort, r) => (
                <tr key={cohort.id}>
                  <th scope="row" className="kb-rg-cohort" data-lit={lit?.r === r || undefined}>{cohort.label}</th>
                  <td className="kb-rg-size">{cohort.size.toLocaleString("en-US")}</td>
                  {Array.from({ length: weeks }, (_, c) => {
                    const pct = cohort.retention[c];
                    const isFocus = focus.r === r && focus.c === c;
                    return (
                      <td
                        key={c}
                        className="kb-rg-cell"
                        data-cell={`${r}-${c}`}
                        data-empty={pct === undefined || undefined}
                        data-lit={(lit?.r === r && lit.c === c) || undefined}
                        data-base={c === 0 || undefined}
                        data-strong={c > 0 && pct !== undefined && depth(pct) > 0.6 ? "" : undefined}
                        style={pct !== undefined && c > 0 ? ({ "--v": shade(pct) } as CSSProperties) : undefined}
                        tabIndex={isFocus ? 0 : -1}
                        onMouseEnter={() => setLit({ r, c })}
                        onFocus={() => {
                          setFocus({ r, c });
                          setLit({ r, c });
                        }}
                      >
                        {pct === undefined ? <span className="kb-sr">No data yet</span> : fmt(pct, cohort.size)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="kb-rg-cohort">Average</th>
                <td className="kb-rg-size">{Math.round(total / cohorts.length).toLocaleString("en-US")}</td>
                {average.map((pct, w) => {
                  const have = cohorts.filter((c) => c.retention[w] !== undefined);
                  const mean = have.reduce((n, c) => n + c.size, 0) / Math.max(1, have.length);
                  return (
                    <td key={w} className="kb-rg-avg" data-lit={lit?.c === w || undefined}>
                      {pct === undefined ? "" : fmt(pct, mean)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
        <footer className="kb-rg-foot">
          <p id={`${uid}-read`} className="kb-rg-read" aria-live="polite">{lit ? reading(lit) : summary}</p>
          <span className="kb-rg-legend" aria-hidden>
            {Math.round(lo)}%
            {[0, 0.25, 0.5, 0.75, 1].map((t) => <i key={t} style={{ "--v": `${Math.round(10 + t * 82)}%` } as CSSProperties} />)}
            {Math.round(hi)}%
          </span>
        </footer>
      </>
    );
  }

  return (
    <section className={cx("kb-rg", className)} aria-label={title} aria-busy={loading || undefined}>
      <header className="kb-rg-head">
        <div className="kb-rg-title">
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {status ? <FreshnessBadge status={status} updatedAt={updatedAt} onRefresh={onRefresh} /> : null}
        <SegmentedControl
          size="sm"
          label="Show"
          draggable={false}
          options={[
            { value: "percent", label: "Percent" },
            { value: "count", label: `${unit[0]?.toUpperCase()}${unit.slice(1)}` },
          ]}
          value={shown}
          onChange={setView}
        />
      </header>
      {body}
    </section>
  );
}
