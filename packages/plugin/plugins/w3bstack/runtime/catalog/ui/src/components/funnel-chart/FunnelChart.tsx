"use client";

import { useId, useState, type CSSProperties, type KeyboardEvent } from "react";
import { EmptyState, type EmptyStateProps } from "../empty-state/EmptyState.tsx";
import { ErrorState } from "../error-state/ErrorState.tsx";
import { FreshnessBadge } from "../freshness-badge/FreshnessBadge.tsx";
import { SegmentedControl } from "../segmented-control/SegmentedControl.tsx";
import { Skeleton, SkeletonRegion } from "../skeleton/Skeleton.tsx";
import { Avatar, cx, type LoadStatus } from "../../shared/index.ts";
import "./funnel-chart.css";

export interface FunnelDropout {
  name: string;
  /** Workspace or company */
  org: string;
  /** The last thing they did, an event name */
  lastEvent: string;
  /** How long ago, said plainly: "6d ago" */
  when: string;
}

export interface FunnelStep {
  id: string;
  label: string;
  /** How many reached this step */
  count: number;
  /** Median seconds from the previous step to this one */
  medianFromPrev?: number;
  /** A sample of who reached the previous step but not this one */
  dropped?: FunnelDropout[];
}

export interface FunnelSegment {
  value: string;
  label: string;
  steps: FunnelStep[];
}

export interface FunnelChartProps {
  segments?: FunnelSegment[];
  /** Selected segment value. Omit to let the chart keep its own */
  segment?: string;
  defaultSegment?: string;
  onSegmentChange?: (value: string) => void;
  /** Step whose drop-off is open in the detail; defaults to the step that loses the most */
  activeStep?: string | null;
  onActiveStepChange?: (id: string | null) => void;
  title?: string;
  /** Period and who counts, e.g. "Teams that signed up in the last 30 days" */
  subtitle?: string;
  /** What a count counts */
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

const people: FunnelDropout[] = [
  { name: "Priya Raman", org: "Lattice Freight", lastEvent: "repo_connect_failed", when: "6d ago" },
  { name: "Tomás Ibarra", org: "Northwind Labs", lastEvent: "settings_viewed", when: "4d ago" },
  { name: "Hana Okafor", org: "Quarry Health", lastEvent: "agent_draft_saved", when: "3d ago" },
  { name: "Jonas Weber", org: "Brightline", lastEvent: "invite_modal_closed", when: "9d ago" },
  { name: "Mei Tanaka", org: "Sable & Co", lastEvent: "pricing_viewed", when: "2d ago" },
  { name: "Dev Patel", org: "Outpost Robotics", lastEvent: "run_failed", when: "5d ago" },
  { name: "Ana Souza", org: "Tidepool", lastEvent: "docs_opened", when: "8d ago" },
  { name: "Olu Adeyemi", org: "Kestrel AI", lastEvent: "billing_viewed", when: "1d ago" },
];
const pick = (from: number) => [0, 3, 5, 6].map((k) => people[(from + k) % people.length] as FunnelDropout);

function steps(counts: [number, number, number, number, number], medians: [number, number, number, number]): FunnelStep[] {
  const labels = ["Signed up", "Connected a repo", "First agent run", "Invited a teammate", "Upgraded"];
  const ids = ["signup", "repo", "run", "invite", "upgrade"];
  return counts.map((count, i) => ({
    id: ids[i] ?? String(i),
    label: labels[i] ?? "",
    count,
    medianFromPrev: i > 0 ? medians[i - 1] : undefined,
    dropped: i > 0 ? pick(i * 2) : undefined,
  }));
}

export const demoFunnelSegments: FunnelSegment[] = [
  { value: "all", label: "All teams", steps: steps([2480, 1736, 1210, 548, 186], [840, 12000, 187200, 777600]) },
  { value: "self", label: "Self-serve", steps: steps([1920, 1302, 870, 352, 98], [660, 15600, 223200, 950400]) },
  { value: "sales", label: "Sales-led", steps: steps([560, 434, 340, 196, 88], [2400, 6100, 104400, 432000]) },
];

/** 840 -> "14m", 12000 -> "3h 20m", 187200 -> "2d 4h" */
export function formatSpan(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

const pct = (n: number) => (n >= 0.1 ? `${Math.round(n * 100)}%` : `${(n * 100).toFixed(1)}%`);
const num = (n: number) => n.toLocaleString("en-US");

/**
 * Conversion through product milestones as horizontal bars on one scale. Each bar keeps the previous step's
 * length as a hatched offcut, so the drop-off is the part cut away. Hover or focus a step to open its drop-off:
 * how many stopped, the median time between steps, and a sample of who stopped with the last thing they did.
 */
export function FunnelChart({
  segments = demoFunnelSegments,
  segment,
  defaultSegment,
  onSegmentChange,
  activeStep,
  onActiveStepChange,
  title = "Activation funnel",
  subtitle = "Teams that signed up in the last 30 days",
  unit = "teams",
  loading = false,
  error = null,
  onRetry,
  errorDetail = "",
  status,
  updatedAt = null,
  onRefresh,
  emptyAction = { label: "Edit funnel steps", icon: "edit", onClick: () => {} },
  className,
}: FunnelChartProps) {
  const detailId = useId();
  const [innerSeg, setInnerSeg] = useState(defaultSegment ?? segments[0]?.value ?? "");
  const segValue = segment ?? innerSeg;
  const seg = segments.find((s) => s.value === segValue) ?? segments[0];
  const list = seg?.steps ?? [];
  const top = list[0]?.count ?? 0;

  // The step that loses the most people is open by default
  const worst = list.reduce<{ id: string | null; lost: number }>((acc, s, i) => {
    const prev = list[i - 1];
    const lost = prev ? prev.count - s.count : 0;
    return lost > acc.lost ? { id: s.id, lost } : acc;
  }, { id: null, lost: 0 }).id;
  const [innerActive, setInnerActive] = useState<string | null>(null);
  const activeId = activeStep !== undefined ? activeStep : innerActive ?? worst;
  const activeIndex = Math.max(0, list.findIndex((s) => s.id === activeId));
  const active = list[activeIndex];
  const prev = list[activeIndex - 1];

  const setActive = (id: string | null) => {
    if (activeStep === undefined) setInnerActive(id);
    onActiveStepChange?.(id);
  };
  const changeSegment = (v: string) => {
    if (segment === undefined) setInnerSeg(v);
    onSegmentChange?.(v);
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : null;
    if (next === null || next < 0 || next >= list.length) return;
    e.preventDefault();
    const el = e.currentTarget.closest("ol")?.querySelectorAll<HTMLButtonElement>("button.kb-fn-row")[next];
    el?.focus();
  };

  let body;
  if (loading) {
    body = (
      <SkeletonRegion label="Loading funnel">
        <div className="kb-fn-steps">
          <div className="kb-fn-row kb-fn-axis" aria-hidden><span /><span /><span /><span /></div>
          {[1, 0.7, 0.49, 0.22, 0.08].map((w, i) => (
            <div key={i} className="kb-fn-row" aria-hidden>
              <Skeleton width={`${50 + ((i * 17) % 35)}%`} height={10} />
              <span className="kb-fn-track"><Skeleton width={`${w * 100}%`} height={18} style={{ minWidth: 6 }} /></span>
              <Skeleton width={44} height={10} style={{ justifySelf: "end" }} />
              <Skeleton width={34} height={10} style={{ justifySelf: "end" }} />
            </div>
          ))}
        </div>
        <div className="kb-fn-detail">
          <Skeleton width="44%" height={12} />
          <Skeleton width="52%" height={10} style={{ marginTop: 12 }} />
          <div className="kb-fn-who" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={22} width={`${70 + ((i * 13) % 25)}%`} style={{ marginTop: 14 }} />
            ))}
          </div>
        </div>
      </SkeletonRegion>
    );
  } else if (error) {
    body = <ErrorState className="kb-fn-state" title="Couldn't load the funnel" body={error} detail={errorDetail} onRetry={onRetry} />;
  } else if (!seg || list.length === 0 || top === 0) {
    body = (
      <EmptyState
        className="kb-fn-state"
        title={list.length === 0 ? "No funnel steps yet" : `No ${unit} entered this funnel`}
        body={list.length === 0 ? "Pick the events that mark each milestone, in order." : "Try a longer period, or check that the first step's event is being sent."}
        action={emptyAction}
      />
    );
  } else {
    const lost = prev && active ? prev.count - active.count : 0;
    body = (
      <>
        <ol className="kb-fn-steps" aria-label={`${title}, ${seg.label}`}>
          <li className="kb-fn-row kb-fn-axis" aria-hidden>
            <span>Step</span>
            <span className="kb-fn-scale">
              <i style={{ left: 0 }}>0</i>
              <i style={{ left: "50%" }}>{num(Math.round(top / 2))}</i>
              <i style={{ left: "100%" }}>{num(top)}</i>
            </span>
            <span className="kb-fn-num">{unit[0]?.toUpperCase()}{unit.slice(1)}</span>
            <span className="kb-fn-num">Kept</span>
          </li>
          {list.map((s, i) => {
            const before = list[i - 1];
            const kept = before ? (before.count ? s.count / before.count : 0) : 1;
            const isActive = i === activeIndex;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className="kb-fn-row"
                  aria-pressed={isActive}
                  aria-controls={detailId}
                  aria-label={
                    before
                      ? `${s.label}: ${num(s.count)} ${unit}, ${pct(kept)} of ${before.label.toLowerCase()}, ${num(before.count - s.count)} dropped`
                      : `${s.label}: ${num(s.count)} ${unit}`
                  }
                  data-active={isActive || undefined}
                  onMouseEnter={() => setActive(s.id)}
                  onFocus={() => setActive(s.id)}
                  onClick={() => setActive(s.id)}
                  onKeyDown={(e) => onKey(e, i)}
                >
                  <span className="kb-fn-label">
                    <b className="kb-fn-n">{i + 1}</b>
                    <span>{s.label}</span>
                  </span>
                  <span className="kb-fn-track" style={{ "--w": top ? s.count / top : 0, "--p": before && top ? before.count / top : 0 } as CSSProperties}>
                    {before ? <i className="kb-fn-cut" /> : null}
                    <i className="kb-fn-bar" />
                  </span>
                  <span className="kb-fn-num">{num(s.count)}</span>
                  <span className="kb-fn-num" data-weak={before && kept < 0.5 ? "" : undefined}>{before ? pct(kept) : "–"}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="kb-fn-detail" id={detailId} aria-live="polite">
          {active && prev ? (
            <>
              <p className="kb-fn-detail-head">
                <strong>{num(lost)} {unit} stopped</strong> between {prev.label.toLowerCase()} and {active.label.toLowerCase()}
              </p>
              <dl className="kb-fn-facts">
                <div><dt>Kept</dt><dd>{pct(prev.count ? active.count / prev.count : 0)}</dd></div>
                <div><dt>Of all signups</dt><dd>{pct(top ? active.count / top : 0)}</dd></div>
                {active.medianFromPrev !== undefined ? <div><dt>Median time to this step</dt><dd>{formatSpan(active.medianFromPrev)}</dd></div> : null}
              </dl>
              {active.dropped?.length ? (
                <ul className="kb-fn-who" aria-label={`Some of the ${unit} that stopped`}>
                  {active.dropped.map((p) => (
                    <li key={p.name}>
                      <Avatar name={p.name} size={22} />
                      <span className="kb-fn-who-name">{p.name}<span>{p.org}</span></span>
                      <code>{p.lastEvent}</code>
                      <span className="kb-fn-who-when">{p.when}</span>
                    </li>
                  ))}
                  {lost > active.dropped.length ? <li className="kb-fn-more">and {num(lost - active.dropped.length)} more</li> : null}
                </ul>
              ) : null}
            </>
          ) : active ? (
            <p className="kb-fn-detail-head">
              <strong>{num(active.count)} {unit}</strong> {active.label.toLowerCase()}. Pick a later step to see who stopped before it.
            </p>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <section className={cx("kb-fn", className)} aria-label={title} aria-busy={loading || undefined}>
      <header className="kb-fn-head">
        <div className="kb-fn-title">
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {status ? <FreshnessBadge status={status} updatedAt={updatedAt} onRefresh={onRefresh} /> : null}
        {segments.length > 1 ? (
          <SegmentedControl
            size="sm"
            label="Segment"
            draggable={false}
            options={segments.map((s) => ({ value: s.value, label: s.label }))}
            value={seg?.value ?? segValue}
            onChange={changeSegment}
          />
        ) : null}
      </header>
      {body}
    </section>
  );
}
