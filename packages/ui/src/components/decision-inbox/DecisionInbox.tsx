"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cx, Avatar, Icon, NumberRoll, useReducedMotion } from "../../shared/index.ts";
import "./decision-inbox.css";

export interface DecisionAnswer {
  label: string;
  /** What the agent will do, shown in the confirmation */
  outcome: string;
  /** "go" answers lean primary; "hold" answers are the cautious side */
  kind?: "go" | "hold";
}

export interface Decision {
  id: string;
  agent: string;
  question: string;
  context?: string;
  /** e.g. "4m", "1h" */
  waiting: string;
  answers: [DecisionAnswer, DecisionAnswer];
}

export interface DecisionInboxProps {
  decisions?: Decision[];
  title?: string;
  /** How long the confirmation (with undo) shows before the row folds away, in ms */
  confirmFor?: number;
  onAnswer?: (decision: Decision, answer: DecisionAnswer) => void;
  className?: string;
}

export const demoDecisions: Decision[] = [
  {
    id: "d1",
    agent: "Atlas",
    question: "Send 38 renewal reminders to the churn-risk list?",
    context: "Drafts reviewed by the tone checker. Sends from renewals@northwind.io.",
    waiting: "4m",
    answers: [
      { label: "Send", outcome: "Atlas is sending 38 emails.", kind: "go" },
      { label: "Hold", outcome: "Drafts kept in the outbox.", kind: "hold" },
    ],
  },
  {
    id: "d2",
    agent: "Ledger",
    question: "Refund $742.10 on order 88213?",
    context: "Above the $500 auto-refund limit. Customer reported a duplicate charge.",
    waiting: "12m",
    answers: [
      { label: "Refund", outcome: "Refund issued to the card ending 4417.", kind: "go" },
      { label: "Decline", outcome: "Ledger will reply with the charge details.", kind: "hold" },
    ],
  },
  {
    id: "d3",
    agent: "Forge",
    question: "Merge the dependency bump in PR 1129?",
    context: "react-dom 19.3.0 to 19.3.1. All 412 checks passed.",
    waiting: "1h",
    answers: [
      { label: "Merge", outcome: "Forge merged PR 1129 into main.", kind: "go" },
      { label: "Leave open", outcome: "PR left open for review.", kind: "hold" },
    ],
  },
];

type RowState = { phase: "open" } | { phase: "confirmed"; answer: number } | { phase: "folding"; answer: number };

/**
 * Questions agents are blocked on, each with exactly two answers. The answers are one molded rocker: the chosen half
 * presses in and locks, the row's decal-yellow edge cures to green, and after a short undo window the row folds away.
 */
export function DecisionInbox({
  decisions = demoDecisions,
  title = "Waiting on you",
  confirmFor = 2200,
  onAnswer,
  className,
}: DecisionInboxProps) {
  const [rows, setRows] = useState(decisions);
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [answered, setAnswered] = useState(0);
  const timers = useRef(new Map<string, number>());
  const listRef = useRef<HTMLOListElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const reduced = useReducedMotion();
  const uid = useId();

  useEffect(() => {
    setRows(decisions);
    setStates({});
  }, [decisions]);
  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => window.clearTimeout(t));
  }, []);

  const later = (key: string, ms: number, fn: () => void) => {
    window.clearTimeout(timers.current.get(key));
    timers.current.set(key, window.setTimeout(fn, ms));
  };

  const finish = (decision: Decision, answer: number) => {
    const chosen = decision.answers[answer];
    if (chosen) onAnswer?.(decision, chosen);
    setAnswered((n) => n + 1);
    // Keep keyboard users in the list: move focus to the next open row before this one disappears
    const row = listRef.current?.querySelector<HTMLElement>(`[data-id="${decision.id}"]`);
    if (row?.contains(document.activeElement)) {
      const next =
        (row.nextElementSibling ?? row.previousElementSibling)?.querySelector<HTMLButtonElement>(".kb-di-half") ?? null;
      (next ?? headRef.current)?.focus();
    }
    setRows((list) => list.filter((d) => d.id !== decision.id));
  };

  const answer = (decision: Decision, index: number) => {
    setStates((s) => ({ ...s, [decision.id]: { phase: "confirmed", answer: index } }));
    later(decision.id, confirmFor, () => {
      setStates((s) => ({ ...s, [decision.id]: { phase: "folding", answer: index } }));
      later(decision.id, reduced ? 0 : 320, () => finish(decision, index));
    });
  };

  const undo = (decision: Decision) => {
    window.clearTimeout(timers.current.get(decision.id));
    setStates((s) => ({ ...s, [decision.id]: { phase: "open" } }));
    // The undo button unmounts; hand focus back to the rocker
    window.requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLButtonElement>(`[data-id="${decision.id}"] .kb-di-half`)?.focus(),
    );
  };

  const open = rows.filter((d) => (states[d.id]?.phase ?? "open") === "open").length;

  return (
    <section className={cx("kb-root kb-part kb-di", className)} aria-labelledby={`${uid}-title`}>
      <header className="kb-di-head">
        <h2 id={`${uid}-title`} className="kb-di-title" ref={headRef} tabIndex={-1}>
          {title}
        </h2>
        <span className="kb-di-count" data-zero={open === 0 || undefined} aria-label={`${open} open`}>
          <NumberRoll value={open} />
        </span>
        {answered > 0 ? <span className="kb-di-done">{answered} answered</span> : null}
      </header>

      {rows.length === 0 ? (
        <div className="kb-di-empty">
          <span className="kb-di-empty-icon"><Icon name="check" size={18} strokeWidth={2.25} /></span>
          <p>Nothing is waiting on you. Agents will ask here when they need a call.</p>
        </div>
      ) : (
        <ol className="kb-di-list" ref={listRef}>
          {rows.map((d) => {
            const state = states[d.id] ?? { phase: "open" as const };
            const chosen = state.phase === "open" ? undefined : state.answer;
            const chosenAnswer = chosen === undefined ? undefined : d.answers[chosen];
            return (
              <li key={d.id} className="kb-di-row" data-id={d.id} data-phase={state.phase}>
                <div className="kb-di-fold">
                  <div className="kb-di-inner">
                    <span className="kb-di-edge" aria-hidden />
                    <div className="kb-di-meta">
                      <Avatar name={d.agent} size={20} />
                      <span className="kb-di-agent">{d.agent}</span>
                      <span className="kb-di-wait">waiting {d.waiting}</span>
                    </div>
                    <p className="kb-di-q" id={`${uid}-${d.id}`}>{d.question}</p>
                    {d.context ? <p className="kb-di-ctx">{d.context}</p> : null}
                    <div className="kb-di-foot">
                      <div className="kb-di-rocker" role="group" aria-labelledby={`${uid}-${d.id}`} data-chosen={chosen}>
                        {d.answers.map((a, i) => (
                          <button
                            key={a.label}
                            type="button"
                            className="kb-di-half"
                            data-kind={a.kind ?? (i === 0 ? "go" : "hold")}
                            aria-pressed={chosen === i}
                            aria-disabled={chosen !== undefined && chosen !== i ? true : undefined}
                            onClick={() => {
                              if (chosen === undefined) answer(d, i);
                            }}
                          >
                            {chosen === i ? <Icon name="check" size={14} strokeWidth={2.4} /> : null}
                            {a.label}
                          </button>
                        ))}
                      </div>
                      {chosenAnswer ? (
                        <p className="kb-di-confirm" role="status">
                          <span>{chosenAnswer.outcome}</span>
                          <button type="button" className="kb-di-undo" onClick={() => undo(d)} disabled={state.phase === "folding"}>
                            <Icon name="undo" size={13} />
                            Undo
                          </button>
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
