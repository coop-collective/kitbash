"use client";

import { useEffect, useRef, useState } from "react";
import { cx, Icon, useReducedMotion } from "../../shared/index.ts";
import "./message-actions.css";

export type Feedback = "up" | "down" | null;

export const DEFAULT_FEEDBACK_REASONS = ["Wrong facts", "Ignored my instructions", "Too long", "Broke my code", "Outdated sources"];

export interface MessageActionsProps {
  /** Text placed on the clipboard by Copy */
  text?: string;
  /** How many versions of the reply exist already */
  versions?: number;
  /** Time a regenerate takes in the demo, in ms */
  regenerateMs?: number;
  /** Length of the simulated read-aloud, in seconds */
  speakSeconds?: number;
  /** Reasons offered after a thumbs down */
  reasons?: string[];
  defaultFeedback?: Feedback;
  onCopy?: (text: string) => void;
  onRegenerate?: (version: number) => void;
  onVersionChange?: (version: number) => void;
  onFeedback?: (feedback: Feedback, reasons?: string[]) => void;
  onSpeak?: (speaking: boolean) => void;
  className?: string;
}

/**
 * The quiet bar under an AI message. It is one molded strip split by part seams; toggles latch pressed into the
 * strip instead of filling with color. Copy turns into a check, regenerate spins and unfolds a version switcher,
 * thumbs pop (thumbs down asks why), and read aloud becomes a small equalizer.
 */
export function MessageActions({
  text = "",
  versions = 1,
  regenerateMs = 1400,
  speakSeconds = 9,
  reasons = DEFAULT_FEEDBACK_REASONS,
  defaultFeedback = null,
  onCopy,
  onRegenerate,
  onVersionChange,
  onFeedback,
  onSpeak,
  className,
}: MessageActionsProps) {
  const reduced = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const [count, setCount] = useState(Math.max(1, versions));
  const [current, setCurrent] = useState(Math.max(1, versions));
  const [regenerating, setRegenerating] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(defaultFeedback);
  const [asking, setAsking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [thanked, setThanked] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [announce, setAnnounce] = useState("");
  const timers = useRef<number[]>([]);
  const askRef = useRef<HTMLDivElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

  useEffect(() => {
    if (!speaking) return;
    const id = window.setTimeout(() => {
      setSpeaking(false);
      onSpeak?.(false);
    }, speakSeconds * 1000);
    return () => window.clearTimeout(id);
  }, [speaking, speakSeconds, onSpeak]);

  useEffect(() => {
    if (asking) askRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [asking]);

  const copy = () => {
    navigator.clipboard?.writeText(text).catch(() => undefined);
    onCopy?.(text);
    setCopied(true);
    setAnnounce("Copied to clipboard");
    later(() => setCopied(false), 1800);
  };

  const regenerate = () => {
    if (regenerating) return;
    setRegenerating(true);
    setAnnounce("Regenerating reply");
    later(() => {
      const next = count + 1;
      setCount(next);
      setCurrent(next);
      setRegenerating(false);
      setAnnounce(`Version ${next} of ${next}`);
      onRegenerate?.(next);
    }, reduced ? 0 : regenerateMs);
  };

  const go = (delta: number) => {
    const next = Math.min(count, Math.max(1, current + delta));
    setCurrent(next);
    onVersionChange?.(next);
  };

  const vote = (kind: "up" | "down") => {
    const next = feedback === kind ? null : kind;
    setFeedback(next);
    setThanked(false);
    setPicked([]);
    setAsking(next === "down");
    if (next !== "down") onFeedback?.(next);
  };

  const closeAsk = (send: boolean) => {
    setAsking(false);
    if (send) {
      onFeedback?.("down", picked);
      setThanked(true);
      setAnnounce("Feedback sent");
      later(() => setThanked(false), 2400);
    }
    downRef.current?.focus();
  };

  const speak = () => {
    const next = !speaking;
    setSpeaking(next);
    onSpeak?.(next);
  };

  return (
    <div className={cx("kb-ma", className)}>
      <div className="kb-ma-strip" role="toolbar" aria-label="Message actions">
        <button type="button" className="kb-ma-btn" onClick={copy} aria-label={copied ? "Copied" : "Copy"} title={copied ? "Copied" : "Copy"}>
          <span className="kb-ma-swap" data-on={copied || undefined}>
            <Icon name="copy" size={15} />
            <Icon name="check" size={15} strokeWidth={2.2} className="kb-ma-ok" />
          </span>
        </button>
        <button
          type="button"
          className="kb-ma-btn"
          onClick={regenerate}
          aria-label="Regenerate"
          title="Regenerate"
          aria-busy={regenerating || undefined}
          data-latched={regenerating || undefined}
        >
          <Icon name="refresh" size={15} className="kb-ma-spin" data-on={regenerating || undefined} />
        </button>
        <div className="kb-ma-versions" data-open={count > 1 || undefined} aria-hidden={count <= 1}>
          <button type="button" className="kb-ma-btn kb-ma-step" onClick={() => go(-1)} disabled={current <= 1 || count <= 1} aria-label="Previous version" tabIndex={count > 1 ? 0 : -1}>
            <Icon name="chevronLeft" size={14} />
          </button>
          <span className="kb-ma-count" aria-live="polite">
            {current}/{count}
          </span>
          <button type="button" className="kb-ma-btn kb-ma-step" onClick={() => go(1)} disabled={current >= count || count <= 1} aria-label="Next version" tabIndex={count > 1 ? 0 : -1}>
            <Icon name="chevronRight" size={14} />
          </button>
        </div>

        <span className="kb-ma-seam" aria-hidden />

        <button
          type="button"
          className="kb-ma-btn kb-ma-thumb"
          onClick={() => vote("up")}
          aria-pressed={feedback === "up"}
          aria-label="Good response"
          title="Good response"
          data-latched={feedback === "up" || undefined}
        >
          <Icon name="thumbUp" size={15} />
        </button>
        <button
          ref={downRef}
          type="button"
          className="kb-ma-btn kb-ma-thumb"
          onClick={() => vote("down")}
          aria-pressed={feedback === "down"}
          aria-expanded={asking}
          aria-label="Bad response"
          title="Bad response"
          data-latched={feedback === "down" || undefined}
        >
          <Icon name="thumbDown" size={15} />
        </button>

        <span className="kb-ma-seam" aria-hidden />

        <button
          type="button"
          className="kb-ma-btn kb-ma-speak"
          onClick={speak}
          aria-pressed={speaking}
          aria-label={speaking ? "Stop reading" : "Read aloud"}
          title={speaking ? "Stop reading" : "Read aloud"}
          data-latched={speaking || undefined}
        >
          {speaking ? (
            <span className="kb-ma-eq" aria-hidden>
              {[0, 1, 2, 3].map((i) => <i key={i} style={{ animationDelay: `${i * -0.23}s` }} />)}
            </span>
          ) : (
            <Icon name="speaker" size={15} />
          )}
        </button>
        {thanked ? <span className="kb-ma-thanks">Thanks, this helps</span> : null}
      </div>

      {asking ? (
        <div
          className="kb-ma-ask kb-part"
          ref={askRef}
          role="group"
          aria-label="What went wrong?"
          onKeyDown={(e) => {
            if (e.key === "Escape") closeAsk(false);
          }}
        >
          <p className="kb-ma-ask-title">What went wrong?</p>
          <div className="kb-ma-reasons">
            {reasons.map((r) => {
              const on = picked.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  className="kb-ma-reason"
                  aria-pressed={on}
                  onClick={() => setPicked(on ? picked.filter((p) => p !== r) : [...picked, r])}
                >
                  {r}
                </button>
              );
            })}
          </div>
          <div className="kb-ma-ask-foot">
            <button type="button" className="kb-ma-link" onClick={() => closeAsk(false)}>Skip</button>
            <button type="button" className="kb-ma-send" onClick={() => closeAsk(true)} disabled={!picked.length}>
              Send feedback
            </button>
          </div>
        </div>
      ) : null}
      <span className="kb-sr" role="status" aria-live="polite">{announce}</span>
    </div>
  );
}
