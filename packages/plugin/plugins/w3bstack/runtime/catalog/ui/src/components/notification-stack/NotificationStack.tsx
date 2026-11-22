"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { cx, Icon, useReducedMotion } from "../../shared/index.ts";
import type { IconName } from "../../shared/index.ts";
import "./notification-stack.css";

export type NoticeTone = "needs-you" | "ok" | "danger" | "info" | "agent";

export interface Notice {
  id: string;
  tone: NoticeTone;
  title: string;
  body?: string;
  source: string;
  /** e.g. "2m ago" */
  time: string;
  action?: { label: string; onClick?: () => void };
}

export interface NotificationStackProps {
  notices?: Notice[];
  /** How many cards peek out behind the front one */
  peek?: number;
  onDismiss?: (notice: Notice) => void;
  className?: string;
}

export const demoNotices: Notice[] = [
  {
    id: "n1",
    tone: "needs-you",
    title: "Atlas paused for your sign-off",
    body: "The refund on order 88213 is $742.10, over the $500 limit you set.",
    source: "Atlas",
    time: "2m ago",
    action: { label: "Review refund" },
  },
  {
    id: "n2",
    tone: "danger",
    title: "Linear sync is failing",
    body: "Rate limited 3 times in the last hour. Retrying with backoff.",
    source: "Integrations",
    time: "9m ago",
    action: { label: "Open logs" },
  },
  {
    id: "n3",
    tone: "ok",
    title: "Nightly eval passed",
    body: "212 of 214 cases in 6m 41s. Two cases are flaky.",
    source: "Evals",
    time: "38m ago",
  },
  {
    id: "n4",
    tone: "agent",
    title: "Memory compacted",
    body: "Forge merged 41 notes about the billing service into 6.",
    source: "Forge",
    time: "1h ago",
  },
  {
    id: "n5",
    tone: "info",
    title: "New model ready to try",
    body: "Swap it into the support agent from the model picker.",
    source: "Workspace",
    time: "3h ago",
  },
];

const TONE_ICON: Record<NoticeTone, IconName> = {
  "needs-you": "bell",
  danger: "alert",
  ok: "check",
  agent: "sparkle",
  info: "info",
};

const TONE_NAME: Record<NoticeTone, string> = {
  "needs-you": "Needs you",
  danger: "Problem",
  ok: "Done",
  agent: "Agent update",
  info: "Info",
};

/**
 * Notices stacked one behind another. Only the front card shows its content; the cards behind show just their
 * colored molding lip, so a decal-yellow edge tells you a person-needed notice is coming before you reach it.
 * Dismissing slides the front card off and the next one snaps up into its socket.
 */
export function NotificationStack({ notices = demoNotices, peek = 3, onDismiss, className }: NotificationStackProps) {
  const [queue, setQueue] = useState(notices);
  const [leaving, setLeaving] = useState<Notice | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const frontRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => setQueue(notices), [notices]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const dismissFront = () => {
    const [front, ...rest] = queue;
    if (!front) return;
    const hadFocus = frontRef.current?.contains(document.activeElement) ?? false;
    onDismiss?.(front);
    setQueue(rest);
    if (!reduced) {
      setLeaving(front);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setLeaving(null), 300);
    }
    // Keep focus on the stack so Escape can keep working through it
    if (hadFocus) window.requestAnimationFrame(() => frontRef.current?.focus());
  };

  const clearAll = () => {
    queue.forEach((n) => onDismiss?.(n));
    setQueue([]);
    setLeaving(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" || e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      dismissFront();
    }
  };

  const [front, ...behind] = queue;
  const shells = behind.slice(0, peek);
  const waiting = behind.filter((n) => n.tone === "needs-you").length;

  return (
    <section className={cx("kb-root kb-ns", className)} aria-label="Notifications">
      <div className="kb-ns-stack" style={{ marginBottom: shells.length * 8 }}>
        {shells
          .map((n, i) => (
            <div
              key={n.id}
              className="kb-ns-shell"
              data-tone={n.tone}
              style={{ transform: `translateY(${(i + 1) * 8}px) scale(${1 - (i + 1) * 0.04})`, zIndex: 10 - i }}
              aria-hidden
            />
          ))
          .reverse()}

        {front ? (
          <div
            key={front.id}
            ref={frontRef}
            className="kb-ns-card"
            data-tone={front.tone}
            data-entering={leaving ? true : undefined}
            tabIndex={-1}
            role="group"
            aria-roledescription="notification"
            aria-label={`${TONE_NAME[front.tone]}: ${front.title}`}
            onKeyDown={onKeyDown}
          >
            <span className="kb-ns-icon" data-tone={front.tone}>
              <Icon name={TONE_ICON[front.tone]} size={16} strokeWidth={2.1} />
            </span>
            <div className="kb-ns-text">
              <p className="kb-ns-meta">
                <span className="kb-ns-source">{front.source}</span>
                <span className="kb-ns-time">{front.time}</span>
              </p>
              <p className="kb-ns-title">{front.title}</p>
              {front.body ? <p className="kb-ns-body">{front.body}</p> : null}
              {front.action ? (
                <button type="button" className="kb-ns-action" data-tone={front.tone} onClick={() => front.action?.onClick?.()}>
                  {front.action.label}
                </button>
              ) : null}
            </div>
            <button type="button" className="kb-ns-dismiss" aria-label={`Dismiss ${front.title}`} onClick={dismissFront}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ) : (
          <div className="kb-ns-empty" ref={frontRef} tabIndex={-1}>
            <Icon name="check" size={16} strokeWidth={2.25} />
            You are all caught up.
          </div>
        )}

        {leaving ? (
          <div className="kb-ns-card kb-ns-leaving" data-tone={leaving.tone} aria-hidden>
            <span className="kb-ns-icon" data-tone={leaving.tone}>
              <Icon name={TONE_ICON[leaving.tone]} size={16} strokeWidth={2.1} />
            </span>
            <div className="kb-ns-text">
              <p className="kb-ns-meta">
                <span className="kb-ns-source">{leaving.source}</span>
                <span className="kb-ns-time">{leaving.time}</span>
              </p>
              <p className="kb-ns-title">{leaving.title}</p>
              {leaving.body ? <p className="kb-ns-body">{leaving.body}</p> : null}
            </div>
          </div>
        ) : null}
      </div>

      {behind.length > 0 ? (
        <footer className="kb-ns-foot">
          <span aria-live="polite">
            {behind.length} more
            {waiting > 0 ? <span className="kb-ns-waiting">, {waiting} waiting on you</span> : null}
          </span>
          <button type="button" className="kb-ns-clear" onClick={clearAll}>
            Clear all
          </button>
        </footer>
      ) : null}
    </section>
  );
}
