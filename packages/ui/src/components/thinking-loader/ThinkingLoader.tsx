import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cx, formatDuration, Icon, Shimmer, Spinner, useElapsed, useReducedMotion } from "../../shared/index.ts";
import "./thinking-loader.css";

export const DEFAULT_THINKING_PHASES = ["Reading 4 files", "Checking the billing schema", "Planning the migration", "Writing the answer"];

export interface ThinkingLoaderProps {
  /** Labels the pill rolls through, in order */
  phases?: string[];
  /** How long each phase shows while autoplaying, in ms */
  phaseMs?: number;
  /** Controlled phase index; when set, autoplay does not advance phases */
  phase?: number;
  /** Controlled finish; when set, the pill settles on the check */
  done?: boolean;
  /** Label once settled; defaults to "Done in 4.2s" from the live timer */
  doneLabel?: string;
  /** Roll through the phases on a timer and settle on its own */
  autoplay?: boolean;
  /** Start again a moment after settling (catalog demos) */
  loop?: boolean;
  /** Show the running timer at the end of the pill */
  showTimer?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Small working pill for an AI reply. The eight-ray spinner turns while a shimmering label clicks through
 * phases in a drum window; on finish the rays retract and a green check stud snaps into the socket.
 */
export function ThinkingLoader(props: ThinkingLoaderProps) {
  // Each loop is a fresh run: remounting resets the phase and the timer together.
  const [run, setRun] = useState(0);
  return <LoaderRun key={run} {...props} onRestart={() => setRun((r) => r + 1)} />;
}

function LoaderRun({
  phases = DEFAULT_THINKING_PHASES,
  phaseMs = 1500,
  phase,
  done,
  doneLabel,
  autoplay = true,
  loop = false,
  showTimer = true,
  size = "md",
  className,
  onRestart,
}: ThinkingLoaderProps & { onRestart: () => void }) {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const index = Math.min(phase ?? step, Math.max(phases.length - 1, 0));
  // Uncontrolled autoplay finishes after the last phase; reduced motion shows that end state straight away.
  const autoDone = autoplay && phase === undefined && (reduced || step >= phases.length);
  const isDone = done ?? autoDone;
  const elapsed = useElapsed(!isDone);

  useEffect(() => {
    if (!autoplay || phase !== undefined || done !== undefined || reduced) return;
    const id = window.setTimeout(() => setStep((s) => s + 1), phaseMs);
    if (step >= phases.length) {
      window.clearTimeout(id);
      if (!loop) return;
      const again = window.setTimeout(onRestart, 2600);
      return () => window.clearTimeout(again);
    }
    return () => window.clearTimeout(id);
  }, [autoplay, phase, done, reduced, step, phases.length, phaseMs, loop, onRestart]);

  const label = isDone ? doneLabel ?? `Done in ${formatDuration(elapsed)}` : phases[index] ?? "Thinking";

  // The drum window eases to the width of whichever label is seated in it.
  const measure = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (measure.current) setWidth(measure.current.offsetWidth);
  }, [label, isDone]);

  const iconSize = size === "sm" ? 12 : 14;
  return (
    <span className={cx("kb-tl", className)} data-size={size} data-done={isDone || undefined}>
      <span className="kb-tl-mark" aria-hidden>
        <span className="kb-tl-spin">
          <Spinner size={iconSize} label="" />
        </span>
        <span className="kb-tl-stud">
          <Icon name="check" size={iconSize - 3} strokeWidth={2.6} />
        </span>
      </span>
      <span className="kb-tl-drum" style={{ width }} aria-hidden>
        <span className="kb-tl-label" key={isDone ? "done" : `p${index}`}>
          {isDone ? label : <Shimmer>{label}</Shimmer>}
        </span>
        <span className="kb-tl-measure" ref={measure}>{label}</span>
      </span>
      {showTimer && !isDone ? <span className="kb-tl-time" aria-hidden>{formatDuration(elapsed)}</span> : null}
      <span className="kb-sr" role="status" aria-live="polite">{isDone ? label : `${label}…`}</span>
    </span>
  );
}
