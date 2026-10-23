"use client";

import { useEffect, useId, useState } from "react";
import { cx, NumberRoll, Tag, useInterval, useReducedMotion } from "../../shared/index.ts";
import "./progress-tracker.css";

export interface TrackerStep {
  id: string;
  label: string;
  detail?: string;
}

export interface ProgressTrackerProps {
  title?: string;
  steps?: TrackerStep[];
  /** Ids already complete on mount */
  defaultDone?: string[];
  /** Demo mode: ticks the next step on a timer, then starts over. Stops as soon as someone clicks a step. */
  autoplay?: boolean;
  /** Milliseconds between autoplay ticks */
  interval?: number;
  onChange?: (done: string[]) => void;
  className?: string;
}

export const demoTrackerSteps: TrackerStep[] = [
  { id: "repo", label: "Connect a repository", detail: "Atlas reads code from GitHub or GitLab." },
  { id: "key", label: "Add a model API key", detail: "Stored in the workspace vault, never in prompts." },
  { id: "tools", label: "Pick the tools Atlas may call", detail: "Start with read-only; widen later." },
  { id: "eval", label: "Run the starter eval suite", detail: "40 cases, about 3 minutes." },
  { id: "invite", label: "Invite a reviewer", detail: "Someone to approve risky actions." },
];

/**
 * Onboarding checklist. Progress is a rail of separate molded cells, one per step, that clip in with a snap as
 * steps complete (and cure green when the last one lands); each tick draws itself.
 */
export function ProgressTracker({
  title = "Get Atlas ready",
  steps = demoTrackerSteps,
  defaultDone = ["repo"],
  autoplay = false,
  interval = 1300,
  onChange,
  className,
}: ProgressTrackerProps) {
  const reduced = useReducedMotion();
  const [done, setDone] = useState<string[]>(defaultDone);
  const [playing, setPlaying] = useState(autoplay);
  const uid = useId();

  useEffect(() => setPlaying(autoplay), [autoplay]);
  // Reduced motion: show where autoplay would end instead of animating there
  useEffect(() => {
    if (autoplay && reduced) setDone(steps.map((s) => s.id));
  }, [autoplay, reduced, steps]);

  const complete = steps.filter((s) => done.includes(s.id)).length;
  const allDone = complete === steps.length;
  const nextStep = steps.find((s) => !done.includes(s.id));

  useInterval(
    () => {
      if (nextStep) setDone((d) => [...d, nextStep.id]);
      else setDone([]); // linger one tick on the finished state, then start over
    },
    playing && !reduced ? (allDone ? interval * 2.5 : interval) : null,
  );

  const toggle = (id: string) => {
    setPlaying(false);
    const next = done.includes(id) ? done.filter((d) => d !== id) : [...done, id];
    setDone(next);
    onChange?.(next);
  };

  const pct = steps.length ? Math.round((complete / steps.length) * 100) : 0;

  return (
    <section className={cx("kb-root kb-part kb-pt", className)} aria-labelledby={`${uid}-t`}>
      <header className="kb-pt-head">
        <h2 className="kb-pt-title" id={`${uid}-t`}>{title}</h2>
        <span className="kb-pt-count">
          <NumberRoll value={complete} />
          <span> of {steps.length}</span>
        </span>
      </header>

      <div
        className="kb-pt-rail"
        data-done={allDone || undefined}
        role="progressbar"
        aria-label={`${title} progress`}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={complete}
        aria-valuetext={`${complete} of ${steps.length} steps, ${pct}%`}
      >
        {steps.map((s, i) => (
          <span key={s.id} className="kb-pt-cell" data-on={i < complete || undefined} />
        ))}
      </div>

      <ul className="kb-pt-list">
        {steps.map((s) => {
          const isDone = done.includes(s.id);
          const isNext = s === nextStep;
          return (
            <li key={s.id} className="kb-pt-item" data-done={isDone || undefined} data-next={isNext || undefined}>
              <button
                type="button"
                role="checkbox"
                aria-checked={isDone}
                aria-describedby={s.detail ? `${uid}-${s.id}` : undefined}
                className="kb-pt-row"
                onClick={() => toggle(s.id)}
              >
                <span className="kb-pt-box" aria-hidden>
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
                  </svg>
                </span>
                <span className="kb-pt-text">
                  <span className="kb-pt-label">{s.label}</span>
                  {s.detail ? <span className="kb-pt-detail" id={`${uid}-${s.id}`}>{s.detail}</span> : null}
                </span>
                {isNext && !playing ? <Tag tone="accent">Up next</Tag> : null}
              </button>
            </li>
          );
        })}
      </ul>

      <p className="kb-pt-foot" aria-live="polite">
        {allDone ? "All set. Atlas is ready for its first task." : `${steps.length - complete} left, about ${(steps.length - complete) * 2} minutes`}
      </p>
    </section>
  );
}
