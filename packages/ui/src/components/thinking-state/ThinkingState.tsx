"use client";

import { useEffect, useId, useState, type CSSProperties } from "react";
import { cx, formatDuration, Icon, NumberRoll, Shimmer, Spinner, useElapsed, useReducedMotion } from "../../shared/index.ts";
import "./thinking-state.css";

export interface ThinkingSource {
  domain: string;
  title: string;
  /** Disc color for the source's mark (data, so raw hex is fine) */
  color?: string;
}

export interface ThinkingStep {
  label: string;
  /** What the step found, shown once it is done */
  detail?: string;
}

export const DEFAULT_THINKING_SOURCES: ThinkingSource[] = [
  { domain: "docs.stripe.com", title: "Prorations on plan changes", color: "#635bff" },
  { domain: "metabase.internal", title: "Churn by plan, last 6 months", color: "#509ee3" },
  { domain: "linear.app", title: "BIL-482 Team annual price change", color: "#5e6ad2" },
  { domain: "notion.so", title: "Pricing review, Sept 4", color: "#37352f" },
  { domain: "intercom.com", title: "Cancellation reasons export", color: "#1f8ded" },
];

export const DEFAULT_THINKING_STEPS: ThinkingStep[] = [
  { label: "Searching billing docs and dashboards", detail: "5 sources, 2 internal" },
  { label: "Comparing Team and Pro churn", detail: "Team went from 4.1% to 6.8% in September; Pro held at 2.9%" },
  { label: "Checking the September 12 price change", detail: "Annual Team renewals moved from $19 to $24 per seat" },
  { label: "Reading 212 cancellation reasons", detail: "38% mention price, up from 11%" },
  { label: "Drafting the answer" },
];

export interface ThinkingStateProps {
  sources?: ThinkingSource[];
  steps?: ThinkingStep[];
  /** Reveal sources and steps on a timer */
  autoplay?: boolean;
  /** Time each step stays active, in ms */
  stepMs?: number;
  /** Start again a few seconds after finishing (catalog demos) */
  loop?: boolean;
  /** Controlled finish: shows everything as done */
  done?: boolean;
  defaultOpen?: boolean;
  /** Fold the panel shut once thinking finishes */
  collapseOnDone?: boolean;
  className?: string;
}

const BEATS_PER_STEP = 3;

/**
 * AI working panel. A live timer runs in the header, searched sources drop in one by one, and thinking steps
 * seat themselves on a rail that fills like resin running down a mold channel, each finished step getting a peg.
 */
export function ThinkingState(props: ThinkingStateProps) {
  const [run, setRun] = useState(0);
  return <ThinkingRun key={run} {...props} onRestart={() => setRun((r) => r + 1)} />;
}

function ThinkingRun({
  sources = DEFAULT_THINKING_SOURCES,
  steps = DEFAULT_THINKING_STEPS,
  autoplay = true,
  stepMs = 1350,
  loop = false,
  done,
  defaultOpen = true,
  collapseOnDone = false,
  className,
  onRestart,
}: ThinkingStateProps & { onRestart: () => void }) {
  const reduced = useReducedMotion();
  const total = steps.length * BEATS_PER_STEP;
  const [beat, setBeat] = useState(autoplay ? 0 : total);
  const [open, setOpen] = useState(defaultOpen);
  const finished = done ?? (reduced || beat >= total);
  const shownBeat = finished ? total : beat;
  const elapsed = useElapsed(!finished);
  const bodyId = useId();

  useEffect(() => {
    if (!autoplay || done !== undefined || reduced) return;
    if (beat < total) {
      const id = window.setTimeout(() => setBeat((b) => b + 1), stepMs / BEATS_PER_STEP);
      return () => window.clearTimeout(id);
    }
    const timers: number[] = [];
    if (collapseOnDone) timers.push(window.setTimeout(() => setOpen(false), 900));
    if (loop) timers.push(window.setTimeout(onRestart, 3600));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [autoplay, done, reduced, beat, total, stepMs, collapseOnDone, loop, onRestart]);

  const active = Math.min(Math.floor(shownBeat / BEATS_PER_STEP), steps.length);
  const visibleSources = finished ? sources.length : Math.min(sources.length, shownBeat + 1);
  // The fill runs from the first socket to the last finished one (the active step is the rail's last node).
  const fill = finished ? 1 : active > 0 ? (active - 1) / active : 0;

  return (
    <section className={cx("kb-ts kb-part", className)} data-done={finished || undefined} aria-label="Assistant thinking">
      <button type="button" className="kb-ts-head" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
        <span className="kb-ts-socket" aria-hidden>
          {finished ? <Icon name="check" size={13} strokeWidth={2.4} /> : <Spinner size={13} label="" />}
        </span>
        <span className="kb-ts-title">
          {finished ? `Thought for ${formatDuration(elapsed)}` : <Shimmer>Thinking</Shimmer>}
        </span>
        {!finished ? <span className="kb-ts-clock">{formatDuration(elapsed)}</span> : null}
        <span className="kb-ts-chev" aria-hidden><Icon name="chevronDown" size={16} /></span>
      </button>
      <span className="kb-sr" role="status" aria-live="polite">
        {finished ? "Finished thinking" : steps[active]?.label ?? ""}
      </span>

      <div className="kb-ts-fold" id={bodyId} data-open={open || undefined}>
        <div className="kb-ts-body" inert={!open}>
          <div className="kb-ts-sources">
            <p className="kb-ts-caption">
              Searched <NumberRoll value={visibleSources} /> {visibleSources === 1 ? "source" : "sources"}
            </p>
            <ul className="kb-ts-chips">
              {sources.slice(0, visibleSources).map((s) => (
                <li key={s.domain + s.title} className="kb-ts-chip" title={s.title}>
                  <span className="kb-ts-fav" style={{ background: s.color ?? "#4d5b66" }} aria-hidden>
                    {s.domain.charAt(0).toUpperCase()}
                  </span>
                  <span className="kb-ts-chip-text">
                    <span className="kb-ts-chip-title">{s.title}</span>
                    <span className="kb-ts-chip-domain">{s.domain}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <ol className="kb-ts-steps" style={{ "--kb-ts-fill": fill } as CSSProperties}>
            {steps.slice(0, Math.min(active + 1, steps.length)).map((step, i) => {
              const state = i < active ? "done" : "active";
              return (
                <li key={step.label} className="kb-ts-step" data-state={state} aria-current={state === "active" ? "step" : undefined}>
                  <span className="kb-ts-node" aria-hidden><span className="kb-ts-peg" /></span>
                  <span className="kb-ts-step-text">
                    <span className="kb-ts-step-label">
                      {state === "active" ? <Shimmer>{step.label}</Shimmer> : step.label}
                    </span>
                    {state === "done" && step.detail ? <span className="kb-ts-detail">{step.detail}</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
