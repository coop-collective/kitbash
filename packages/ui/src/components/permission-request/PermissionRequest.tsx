import { useEffect, useId, useRef, useState } from "react";
import { cx, Icon, Tag, useInterval } from "../../shared/index.ts";
import type { IconName } from "../../shared/index.ts";
import { Button } from "../button/Button.tsx";
import "./permission-request.css";

export type PermissionGrant = "once" | "hour" | "always";

export interface PermissionAsk {
  /** Agent asking */
  agent: string;
  /** The one right it wants, as a short phrase: "post in #launch-team" */
  right: string;
  /** Where the right applies, e.g. "Slack, Acme workspace" */
  resource: string;
  icon?: IconName;
  /** Why it needs the right now */
  reason: string;
  /** Exactly what will happen if allowed, step by step */
  effects: string[];
  /** What it will never do with this right */
  limits?: string[];
}

export const samplePermission: PermissionAsk = {
  agent: "Launch agent",
  right: "post in #launch-team",
  resource: "Slack, Acme workspace",
  icon: "message",
  reason: "The 4.0 release checklist is done and the team asked for a go-live note once QA signs off.",
  effects: [
    "Post one message in #launch-team as Launch agent",
    "Mention @maya.chen and @devon.ruiz",
    "Attach the release checklist (14 of 14 items done)",
  ],
  limits: ["It cannot read other channels or send direct messages."],
};

const GRANT_LABEL: Record<PermissionGrant, string> = {
  once: "Allow once",
  hour: "For an hour",
  always: "Always allow",
};

export interface PermissionRequestProps {
  ask?: PermissionAsk;
  /** Start already granted, to show the folded line */
  granted?: PermissionGrant;
  /** Length of the "for an hour" grant in seconds; shorten it for demos */
  hourSeconds?: number;
  /** With `granted="hour"`, seconds already left on the grant */
  secondsLeft?: number;
  onGrant?: (grant: PermissionGrant) => void;
  onDeny?: () => void;
  onRevoke?: () => void;
  className?: string;
}

type State = { kind: "asking" } | { kind: "granted"; grant: PermissionGrant } | { kind: "denied" } | { kind: "revoked" };

/**
 * An agent asks for one specific right: who, why and exactly what will happen. Allow it once, for an hour or always;
 * the card then folds into a key tag on one line, with a ring that drains as the grant runs out and Revoke beside it.
 */
export function PermissionRequest({
  ask = samplePermission,
  granted,
  hourSeconds = 3600,
  secondsLeft,
  onGrant,
  onDeny,
  onRevoke,
  className,
}: PermissionRequestProps) {
  const [state, setState] = useState<State>(granted ? { kind: "granted", grant: granted } : { kind: "asking" });
  const [left, setLeft] = useState(Math.min(secondsLeft ?? hourSeconds, hourSeconds));
  const titleId = useId();
  const lineRef = useRef<HTMLDivElement>(null);
  const timed = state.kind === "granted" && state.grant === "hour";

  useInterval(() => setLeft((s) => Math.max(0, s - 1)), timed && left > 0 ? 1000 : null);
  useEffect(() => {
    if (timed && left === 0) setState({ kind: "revoked" });
  }, [timed, left]);

  const grant = (g: PermissionGrant) => {
    setLeft(hourSeconds);
    setState({ kind: "granted", grant: g });
    onGrant?.(g);
    requestAnimationFrame(() => lineRef.current?.focus());
  };

  const folded = state.kind !== "asking";

  return (
    <div className={cx("kb-root kb-pr", className)} data-state={state.kind}>
      <div className="kb-pr-card" hidden={folded} role="group" aria-labelledby={titleId}>
        <header className="kb-pr-head">
          <span className="kb-pr-icon">
            <Icon name={ask.icon ?? "key"} size={18} />
          </span>
          <div>
            <h3 id={titleId}>
              {ask.agent} wants to {ask.right}
            </h3>
            <span className="kb-pr-resource">{ask.resource}</span>
          </div>
          <Tag tone="decal" dot>
            Needs you
          </Tag>
        </header>
        <p className="kb-pr-reason">{ask.reason}</p>
        <div className="kb-pr-effects">
          <span className="kb-pr-label">If you allow it, it will</span>
          <ol>
            {ask.effects.map((effect, i) => (
              <li key={effect}>
                <span className="kb-pr-num" aria-hidden>
                  {i + 1}
                </span>
                {effect}
              </li>
            ))}
          </ol>
          {ask.limits?.map((limit) => (
            <p className="kb-pr-limit" key={limit}>
              <Icon name="shield" size={14} />
              {limit}
            </p>
          ))}
        </div>
        <footer className="kb-pr-foot">
          <Button
            variant="ghost"
            onClick={() => {
              setState({ kind: "denied" });
              onDeny?.();
              requestAnimationFrame(() => lineRef.current?.focus());
            }}
          >
            Don't allow
          </Button>
          <div className="kb-pr-grants" role="group" aria-label="Allow for how long">
            {(["once", "hour", "always"] as const).map((g) => (
              <button key={g} type="button" className="kb-pr-grant" data-grant={g} onClick={() => grant(g)}>
                {GRANT_LABEL[g]}
              </button>
            ))}
          </div>
        </footer>
      </div>

      {folded ? (
        <div className="kb-pr-line" ref={lineRef} tabIndex={-1} role="status">
          <span className="kb-pr-tag" aria-hidden>
            <span className="kb-pr-hole" />
            {state.kind === "granted" && state.grant === "once" ? (
              <Icon name="key" size={16} />
            ) : state.kind === "granted" ? (
              <Ring fraction={state.grant === "hour" ? left / hourSeconds : 1} kind={state.grant} />
            ) : (
              <Icon name={state.kind === "denied" ? "x" : "lock"} size={14} />
            )}
          </span>
          <span className="kb-pr-line-text">
            {state.kind === "granted" ? (
              <>
                <strong>{ask.agent}</strong> can {ask.right}
              </>
            ) : state.kind === "denied" ? (
              <>
                <strong>Not allowed:</strong> {ask.agent} won't {ask.right}
              </>
            ) : (
              <>
                <strong>Revoked:</strong> {ask.agent} will ask before it can {ask.right}
              </>
            )}
          </span>
          {state.kind === "granted" ? (
            <>
              <span className="kb-pr-left">
                {state.grant === "hour" ? `${clock(left)} left` : state.grant === "once" ? "This time only" : "Always"}
              </span>
              <Button
                size="sm"
                onClick={() => {
                  setState({ kind: "revoked" });
                  onRevoke?.();
                }}
              >
                Revoke
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setState({ kind: "asking" })}>
              Review again
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** The grant's ring: full for once/always, draining clockwise for an hour */
function Ring({ fraction, kind }: { fraction: number; kind: PermissionGrant }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="kb-pr-ring" data-kind={kind}>
      <circle cx="9" cy="9" r={r} className="kb-pr-ring-track" />
      <circle
        cx="9"
        cy="9"
        r={r}
        className="kb-pr-ring-fill"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - fraction)}
        transform="rotate(-90 9 9)"
      />
    </svg>
  );
}

function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
