"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../button/Button.tsx";
import { cx, Icon, NumberRoll, type IconName } from "../../shared/index.ts";
import "./tips-panel.css";

export interface Tip {
  id: string;
  icon: IconName;
  title: string;
  body: string;
  /** The one action, as a verb: "Connect GitHub" */
  action: string;
  /** What the done state says: "GitHub connected" */
  doneLabel: string;
  done?: boolean;
}

export interface TipsPanelProps {
  title?: string;
  tips?: Tip[];
  /** Milliseconds the action shows as working before the tip turns done (demo) */
  actionDelay?: number;
  /** Called when a tip's action is taken; the panel marks it done itself */
  onAction?: (id: string) => void;
  className?: string;
}

export const DEMO_TIPS: Tip[] = [
  { id: "github", icon: "code", title: "Let agents open pull requests", body: "Connect GitHub so fixes arrive as reviewable branches instead of pasted diffs.", action: "Connect GitHub", doneLabel: "GitHub connected", done: true },
  { id: "limit", icon: "credit", title: "Cap what a run can spend", body: "A monthly limit stops a runaway loop at $100, not at the end of the invoice.", action: "Set a limit", doneLabel: "Limit set to $100" },
  { id: "cmdk", icon: "command", title: "Run any tool from one field", body: "Press ⌘K in any chat to search tool actions and run them without switching tabs.", action: "Try it now", doneLabel: "Command menu tried", done: true },
  { id: "memory", icon: "brain", title: "Teach it your conventions once", body: "Pin a memory with your code style and review rules; every agent reads it first.", action: "Add a memory", doneLabel: "Memory pinned" },
  { id: "approval", icon: "shield", title: "Ask before anything ships", body: "Agents pause for a person before deploys, payments and emails to customers.", action: "Turn on approvals", doneLabel: "Approvals on" },
  { id: "invite", icon: "users", title: "Share the approval queue", body: "Invite a reviewer so requests go to whoever is around, not only to you.", action: "Invite a reviewer", doneLabel: "Invite sent to dev@relaylabs.dev" },
];

/**
 * Grid of short tips, one action each. Taking a tip presses its card down into the panel: the raised part
 * becomes a recessed, cured-green socket with a check, so what's left to do still stands up off the surface.
 */
export function TipsPanel({ title = "Get more from Relay", tips = DEMO_TIPS, actionDelay = 700, onAction, className }: TipsPanelProps) {
  const uid = useId();
  const [done, setDone] = useState<Record<string, boolean>>(() => Object.fromEntries(tips.map((t) => [t.id, Boolean(t.done)])));
  const [busy, setBusy] = useState<string | null>(null);
  const [justDone, setJustDone] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const take = (tip: Tip) => {
    setBusy(tip.id);
    onAction?.(tip.id);
    timer.current = window.setTimeout(() => {
      setBusy(null);
      setDone((d) => ({ ...d, [tip.id]: true }));
      setJustDone(tip.id);
    }, actionDelay);
  };

  const doneCount = tips.filter((t) => done[t.id]).length;
  const all = doneCount === tips.length;

  return (
    <section className={cx("kb-tips", className)} aria-labelledby={`${uid}-title`}>
      <header className="kb-tips-head">
        <h3 id={`${uid}-title`} className="kb-tips-title">{all ? "You’re all set" : title}</h3>
        <span className="kb-tips-count" aria-live="polite">
          <NumberRoll value={doneCount} /> of {tips.length} done
        </span>
      </header>
      <ul className="kb-tips-grid">
        {tips.map((tip) => {
          const isDone = Boolean(done[tip.id]);
          return (
            <li key={tip.id} className="kb-tip" data-done={isDone || undefined} data-just={justDone === tip.id || undefined}>
              <span className="kb-tip-icon" aria-hidden>
                <Icon name={isDone ? "check" : tip.icon} size={18} strokeWidth={isDone ? 2.4 : 1.75} />
              </span>
              <span className="kb-tip-title">{tip.title}</span>
              <span className="kb-tip-body">{tip.body}</span>
              <span className="kb-tip-foot">
                {isDone ? (
                  <span className="kb-tip-done">
                    <span>{tip.doneLabel}</span>
                    <button
                      type="button"
                      className="kb-tip-undo"
                      aria-label={`Undo: ${tip.doneLabel}`}
                      onClick={() => setDone((d) => ({ ...d, [tip.id]: false }))}
                    >
                      Undo
                    </button>
                  </span>
                ) : (
                  <Button size="sm" loading={busy === tip.id} loadingLabel="Working" disabled={busy !== null && busy !== tip.id} onClick={() => take(tip)}>
                    {tip.action}
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
