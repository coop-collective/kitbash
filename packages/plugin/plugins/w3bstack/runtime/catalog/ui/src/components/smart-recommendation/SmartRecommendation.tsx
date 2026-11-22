"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "../button/Button.tsx";
import { cx, Icon } from "../../shared/index.ts";
import "./smart-recommendation.css";

export interface RecommendationOption {
  id: string;
  title: string;
  detail: string;
  /** 0 to 1 */
  confidence: number;
  /** The headline gain, e.g. "Saves about $410 a month" */
  impact: string;
  /** What it costs you, plainly */
  tradeoff: string;
}

export interface SmartRecommendationProps {
  /** Question the recommendation answers */
  context?: string;
  /** The first option is the agent's pick; the rest are alternatives */
  options?: RecommendationOption[];
  /** Why the agent leans this way */
  reasons?: string[];
  /** Seconds the undo stays available after accepting */
  undoSeconds?: number;
  agentName?: string;
  onAccept?: (option: RecommendationOption) => void;
  onDismiss?: () => void;
  className?: string;
}

export const DEMO_OPTIONS: RecommendationOption[] = [
  {
    id: "small-nightly",
    title: "Run nightly evals on the small model",
    detail: "Keep the large model for the Sunday regression run only.",
    confidence: 0.84,
    impact: "Saves about $410 a month",
    tradeoff: "Nightly scores drift up to 1.2 points from the large model",
  },
  {
    id: "sample-suite",
    title: "Sample 40% of the long-context suite",
    detail: "Rotate which cases run so every case runs at least twice a week.",
    confidence: 0.61,
    impact: "Saves about $290 a month",
    tradeoff: "A rare regression can take up to 3 days to show",
  },
  {
    id: "raise-budget",
    title: "Raise the eval budget to $1,200",
    detail: "Nothing changes in the runs; finance approves the increase.",
    confidence: 0.38,
    impact: "No coverage lost",
    tradeoff: "Costs $200 more each month",
  },
];

export const DEMO_REASONS = [
  "Small and large models agreed on 96% of nightly cases over the last 30 runs",
  "Every regression caught in October also showed up in the Sunday run",
  "The long-context suite is 71% of nightly spend",
];

function confidenceWord(c: number): string {
  if (c >= 0.75) return "High confidence";
  if (c >= 0.5) return "Medium confidence";
  return "Low confidence";
}

/** Five molded pips pressed into the card; the filled count is the confidence. */
function Pips({ value, small }: { value: number; small?: boolean }) {
  const filled = Math.round(value * 5);
  return (
    <span className="kb-rec-pips" data-small={small || undefined} data-level={value >= 0.75 ? "high" : value >= 0.5 ? "mid" : "low"} aria-hidden>
      {Array.from({ length: 5 }, (_, i) => <i key={i} data-on={i < filled || undefined} style={{ transitionDelay: `${i * 40}ms` }} />)}
    </span>
  );
}

type Phase = "open" | "accepted" | "applied" | "dismissed";

/**
 * Suggestion card. The agent's pick sits in the main slot with its confidence shown as five molded pips
 * pressed into the card. Alternatives below can be swapped in; the swapped pick snaps into the slot.
 * Accepting leaves a short undo window before the change is applied.
 */
export function SmartRecommendation({
  context = "Eval spend ran 18% over budget last month",
  options = DEMO_OPTIONS,
  reasons = DEMO_REASONS,
  undoSeconds = 6,
  agentName = "Relay",
  onAccept,
  onDismiss,
  className,
}: SmartRecommendationProps) {
  const uid = useId();
  const [pickedId, setPickedId] = useState(options[0]?.id ?? "");
  const [phase, setPhase] = useState<Phase>("open");
  const [left, setLeft] = useState(undoSeconds);
  const [showWhy, setShowWhy] = useState(false);
  const picked = options.find((o) => o.id === pickedId) ?? options[0];
  const agentPick = options[0];
  const alternatives = options.filter((o) => o.id !== picked?.id);

  useEffect(() => {
    if (phase !== "accepted") return;
    if (left <= 0) {
      setPhase("applied");
      if (picked) onAccept?.(picked);
      return;
    }
    const id = window.setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [phase, left]);

  if (!picked) return null;

  if (phase === "dismissed") {
    return (
      <div className={cx("kb-rec", "kb-rec-quiet", className)} role="status">
        <Icon name="sparkle" size={16} />
        <span>Suggestion dismissed. {agentName} will check again after next month’s runs.</span>
        <Button size="sm" variant="ghost" icon="undo" onClick={() => setPhase("open")}>Undo</Button>
      </div>
    );
  }

  const locked = phase !== "open";

  return (
    <article className={cx("kb-rec", className)} data-phase={phase} aria-labelledby={`${uid}-title`}>
      <header className="kb-rec-head">
        <span className="kb-rec-spark"><Icon name="sparkle" size={16} /></span>
        <span className="kb-rec-context">{context}</span>
        {!locked ? (
          <button type="button" className="kb-rec-x" aria-label="Dismiss suggestion" onClick={() => { setPhase("dismissed"); onDismiss?.(); }}>
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </header>

      <div className="kb-rec-main" key={picked.id}>
        <div className="kb-rec-kicker">
          {picked.id === agentPick?.id ? `${agentName} recommends` : "Your pick"}
          <span className="kb-rec-conf">
            <Pips value={picked.confidence} />
            <span>{confidenceWord(picked.confidence)}</span>
            <span className="kb-sr">, {Math.round(picked.confidence * 100)} percent</span>
          </span>
        </div>
        <h3 className="kb-rec-title" id={`${uid}-title`}>{picked.title}</h3>
        <p className="kb-rec-detail">{picked.detail}</p>
        <dl className="kb-rec-facts">
          <div className="kb-rec-fact" data-kind="gain">
            <dt><Icon name="trendUp" size={14} />Gain</dt>
            <dd>{picked.impact}</dd>
          </div>
          <div className="kb-rec-fact" data-kind="cost">
            <dt><Icon name="alert" size={14} />Trade-off</dt>
            <dd>{picked.tradeoff}</dd>
          </div>
        </dl>

        {reasons.length ? (
          <div className="kb-rec-why">
            <button
              type="button"
              className="kb-rec-why-toggle"
              aria-expanded={showWhy}
              aria-controls={`${uid}-why`}
              onClick={() => setShowWhy((s) => !s)}
            >
              <Icon name="chevronRight" size={14} />
              Why {agentName} suggests this
            </button>
            {showWhy ? (
              <ul id={`${uid}-why`}>
                {reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      {alternatives.length && !locked ? (
        <div className="kb-rec-alts" role="group" aria-label="Alternatives">
          <div className="kb-rec-alts-title">Other options</div>
          {alternatives.map((alt) => (
            <div key={alt.id} className="kb-rec-alt">
              <Pips value={alt.confidence} small />
              <span className="kb-rec-alt-text">
                <span className="kb-rec-alt-title">{alt.title}</span>
                <span className="kb-rec-alt-impact">{alt.impact}</span>
              </span>
              <Button size="sm" onClick={() => setPickedId(alt.id)} aria-label={`Switch to: ${alt.title}`}>Switch</Button>
            </div>
          ))}
        </div>
      ) : null}

      <footer className="kb-rec-foot" aria-live="polite">
        {phase === "open" ? (
          <>
            <Button variant="ghost" onClick={() => { setPhase("dismissed"); onDismiss?.(); }}>Not now</Button>
            <Button variant="primary" icon="check" onClick={() => { setLeft(undoSeconds); setPhase("accepted"); }}>Accept</Button>
          </>
        ) : phase === "accepted" ? (
          <>
            <span className="kb-rec-status">
              <Icon name="clock" size={14} />
              Applying in {left}s
            </span>
            <Button icon="undo" onClick={() => setPhase("open")}>Undo</Button>
          </>
        ) : (
          <span className="kb-rec-status kb-rec-status-ok">
            <Icon name="check" size={16} strokeWidth={2.2} />
            Applied. You can change it any time in settings.
          </span>
        )}
      </footer>
    </article>
  );
}
