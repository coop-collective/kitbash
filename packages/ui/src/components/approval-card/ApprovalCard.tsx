import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { cx, Icon, Tag, useInterval } from "../../shared/index.ts";
import type { IconName, Tone } from "../../shared/index.ts";
import { Button } from "../button/Button.tsx";
import "./approval-card.css";

export type ApprovalRisk = "low" | "medium" | "high";
export type ApprovalOutcome = "approved" | "denied" | "expired";

export interface ApprovalRequest {
  /** Agent asking */
  agent: string;
  /** What it wants to do, as a verb phrase: "Send the renewal quote to Dana Whitfield" */
  action: string;
  /** Why, in the agent's words */
  reason: string;
  risk: ApprovalRisk;
  /** Icon for the kind of action */
  icon?: IconName;
  /** Preview of exactly what will go out */
  preview: {
    title: string;
    fields: Array<[label: string, value: string]>;
    body?: string;
  };
}

export const sampleApproval: ApprovalRequest = {
  agent: "Renewals agent",
  action: "Send the renewal quote to Dana Whitfield",
  reason: "Northwind's contract ends on Nov 30 and Dana asked for pricing by Friday.",
  risk: "medium",
  icon: "mail",
  preview: {
    title: "Email from renewals@acme.io",
    fields: [
      ["To", "dana.whitfield@northwind.com"],
      ["Subject", "Your 2027 renewal: 3 options"],
      ["Attachment", "Northwind-renewal-2027.pdf"],
    ],
    body: "Hi Dana, as promised, here are three renewal options for 2027. The annual plan keeps your current 140 seats at $38,400, a 6% discount on list…",
  },
};

const RISK: Record<ApprovalRisk, { tone: Tone; label: string }> = {
  low: { tone: "ok", label: "Low risk" },
  medium: { tone: "decal", label: "Medium risk" },
  high: { tone: "danger", label: "High risk" },
};

const OUTCOME: Record<ApprovalOutcome, { icon: IconName; verb: string }> = {
  approved: { icon: "check", verb: "Approved" },
  denied: { icon: "x", verb: "Denied" },
  expired: { icon: "clock", verb: "Timed out" },
};

export interface ApprovalCardProps {
  request?: ApprovalRequest;
  /** Seconds before the request lapses and is denied. 0 disables the countdown. */
  timeout?: number;
  onApprove?: (request: ApprovalRequest) => void;
  onDeny?: (request: ApprovalRequest) => void;
  onExpire?: (request: ApprovalRequest) => void;
  /** Label on the approve button */
  approveLabel?: string;
  /** Start already resolved, to show the folded row */
  outcome?: ApprovalOutcome;
  className?: string;
}

/**
 * An agent asks before it acts. A strip of decal tape across the top counts down and pauses while you read;
 * A approves and D denies when the card has focus. On a decision the card presses into the page and seats as a
 * single recessed row.
 */
export function ApprovalCard({
  request = sampleApproval,
  timeout = 45,
  onApprove,
  onDeny,
  onExpire,
  approveLabel = "Approve and send",
  outcome: initialOutcome,
  className,
}: ApprovalCardProps) {
  const [outcome, setOutcome] = useState<ApprovalOutcome | undefined>(initialOutcome);
  const [left, setLeft] = useState(timeout);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const paused = hovered || focused;
  const counting = timeout > 0 && !outcome;

  useInterval(() => setLeft((s) => Math.max(0, s - 0.1)), counting && !paused ? 100 : null);

  const resolve = (next: ApprovalOutcome) => {
    if (outcome) return;
    setOutcome(next);
    if (next === "approved") onApprove?.(request);
    if (next === "denied") onDeny?.(request);
    if (next === "expired") onExpire?.(request);
  };

  useEffect(() => {
    if (counting && left <= 0) resolve("expired");
  }, [left, counting]);

  // Keep keyboard focus on the card after it folds, so the person is not dropped to the top of the page
  useEffect(() => {
    if (outcome && !initialOutcome && focused) rowRef.current?.focus();
  }, [outcome]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (outcome || event.metaKey || event.ctrlKey || event.altKey) return;
    if ((event.target as HTMLElement).closest("input, textarea")) return;
    const key = event.key.toLowerCase();
    if (key === "a") { event.preventDefault(); resolve("approved"); }
    if (key === "d") { event.preventDefault(); resolve("denied"); }
  };

  const risk = RISK[request.risk];
  const fraction = timeout > 0 ? left / timeout : 1;

  return (
    <div
      className={cx("kb-root kb-ap", className)}
      data-state={outcome ?? "pending"}
      data-risk={request.risk}
      role="group"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div className="kb-ap-full" aria-hidden={outcome ? true : undefined} inert={outcome ? true : undefined}>
        <div className="kb-ap-clip">
          {timeout > 0 ? (
            <div className="kb-ap-tape" aria-hidden>
              <span style={{ transform: `scaleX(${fraction})` }} />
            </div>
          ) : null}
          <div className="kb-ap-body">
            <header className="kb-ap-head">
              <span className="kb-ap-icon">
                <Icon name={request.icon ?? "bolt"} size={18} />
              </span>
              <div className="kb-ap-heading">
                <span className="kb-ap-agent">{request.agent} wants to</span>
                <h3 id={titleId}>{request.action}</h3>
              </div>
              <Tag tone={risk.tone} dot>
                {risk.label}
              </Tag>
            </header>
            <p className="kb-ap-reason">{request.reason}</p>
            <figure className="kb-ap-preview">
              <figcaption>{request.preview.title}</figcaption>
              <dl>
                {request.preview.fields.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              {request.preview.body ? <p>{request.preview.body}</p> : null}
            </figure>
            <footer className="kb-ap-foot">
              <span className="kb-ap-clock" aria-live="off">
                {timeout > 0 ? (
                  paused ? (
                    <>
                      <Icon name="pause" size={14} /> Paused while you read
                    </>
                  ) : (
                    <>
                      <Icon name="clock" size={14} /> Denies itself in {Math.ceil(left)}s
                    </>
                  )
                ) : (
                  "Waiting for you"
                )}
              </span>
              <Button onClick={() => resolve("denied")} aria-keyshortcuts="D">
                Deny <kbd className="kb-ap-kbd">D</kbd>
              </Button>
              <Button variant="primary" onClick={() => resolve("approved")} aria-keyshortcuts="A">
                {approveLabel} <kbd className="kb-ap-kbd">A</kbd>
              </Button>
            </footer>
          </div>
        </div>
      </div>
      <div className="kb-ap-row-wrap" aria-hidden={outcome ? undefined : true}>
        <div className="kb-ap-row" ref={rowRef} tabIndex={-1} role="status">
          {outcome ? (
            <>
              <span className="kb-ap-stamp" data-outcome={outcome}>
                <Icon name={OUTCOME[outcome].icon} size={14} strokeWidth={2.25} />
              </span>
              <span className="kb-ap-row-text">
                <strong>{OUTCOME[outcome].verb}:</strong> {request.action}
              </span>
              <span className="kb-ap-row-meta">{outcome === "expired" ? "after " + timeout + "s" : "just now"}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
