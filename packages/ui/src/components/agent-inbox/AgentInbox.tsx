"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cx, Icon, NumberRoll, Spinner, Tag, useInterval, useReducedMotion } from "../../shared/index.ts";
import type { IconName, Tone } from "../../shared/index.ts";
import { Button } from "../button/Button.tsx";
import "./agent-inbox.css";

export type InboxStatus = "needs-you" | "running" | "failed" | "done" | "stopped";

export interface InboxTask {
  id: string;
  title: string;
  agent: string;
  icon: IconName;
  status: InboxStatus;
  /** Seconds ago the task started (running) or last changed (everything else) */
  since: number;
  /** Latest steps, oldest first; the last one is what is happening now */
  steps: string[];
  /** What the person is being asked, for needs-you tasks */
  ask?: string;
  /** Demo: a running task finishes after this many seconds */
  finishesIn?: number;
}

export const sampleInbox: InboxTask[] = [
  {
    id: "t1",
    title: "Draft Q4 renewal emails for 38 accounts",
    agent: "Renewals agent",
    icon: "mail",
    status: "needs-you",
    since: 340,
    steps: ["Pulled 38 accounts renewing before Dec 31", "Drafted 38 emails from the renewal template", "Flagged 4 accounts with open support tickets"],
    ask: "Send 34 emails from renewals@acme.io and hold the 4 flagged ones?",
  },
  {
    id: "t2",
    title: "Fix the flaky checkout test on Safari",
    agent: "Coding agent",
    icon: "code",
    status: "running",
    since: 252,
    steps: ["Reproduced on Safari 18.1, 3 of 5 runs fail", "Found a race in the payment-intent mock", "Running the suite 20 times to confirm the fix"],
    finishesIn: 7,
  },
  {
    id: "t3",
    title: "Reconcile October Stripe payouts",
    agent: "Finance agent",
    icon: "credit",
    status: "failed",
    since: 1260,
    steps: ["Fetched 4,810 payouts for October", "Matched 1,200 payouts to ledger entries", "Stopped: Stripe returned 429 Too Many Requests"],
  },
  {
    id: "t4",
    title: "Triage 46 new GitHub issues",
    agent: "Triage agent",
    icon: "flag",
    status: "running",
    since: 64,
    steps: ["Labelled 21 issues", "Closed 5 duplicates of #2194", "Reading issue #2231"],
  },
  {
    id: "t5",
    title: "Update the pricing page FAQ",
    agent: "Content agent",
    icon: "edit",
    status: "needs-you",
    since: 900,
    steps: ["Compared the FAQ against the new Team plan", "Rewrote 3 answers about seat limits"],
    ask: "Publish 3 changed answers to acme.io/pricing?",
  },
  {
    id: "t6",
    title: "Summarize 212 NPS comments",
    agent: "Research agent",
    icon: "chart",
    status: "done",
    since: 1080,
    steps: ["Grouped comments into 7 themes", "Pulled 14 quotes for the board deck", "Saved the summary to Notion"],
  },
  {
    id: "t7",
    title: "Rotate staging database credentials",
    agent: "Ops agent",
    icon: "key",
    status: "done",
    since: 3900,
    steps: ["Created new credentials in Vault", "Restarted 6 staging services", "Revoked the old credentials"],
  },
];

const ORDER: Record<InboxStatus, number> = { "needs-you": 0, failed: 1, running: 2, done: 3, stopped: 4 };
const STATUS: Record<InboxStatus, { label: string; tone: Tone }> = {
  "needs-you": { label: "Needs you", tone: "decal" },
  running: { label: "Running", tone: "agent" },
  failed: { label: "Failed", tone: "danger" },
  done: { label: "Done", tone: "ok" },
  stopped: { label: "Stopped", tone: "neutral" },
};
const FILTERS: Array<{ id: "all" | InboxStatus; label: string }> = [
  { id: "all", label: "All" },
  { id: "needs-you", label: "Needs you" },
  { id: "running", label: "Running" },
  { id: "failed", label: "Failed" },
  { id: "done", label: "Done" },
];

export interface AgentInboxProps {
  tasks?: InboxTask[];
  /** Running tasks with `finishesIn` complete on their own; approved and retried tasks finish too */
  demo?: boolean;
  /** Task to start unfolded */
  defaultOpen?: string;
  onOpen?: (task: InboxTask) => void;
  className?: string;
}

/**
 * Every background agent task in one calm list. Tasks that need a person sort to the top and carry a decal pull-tab
 * on their edge; acting on one tucks the tab away and the row glides to its new place. Running rows keep a live clock,
 * filter tabs roll their counts, and a row unfolds to its last steps with Approve, Reject, Retry or Open.
 */
export function AgentInbox({ tasks: initial = sampleInbox, demo = true, defaultOpen = "t1", onOpen, className }: AgentInboxProps) {
  const [tasks, setTasks] = useState(() => initial.map((t) => ({ ...t, at: Date.now() - t.since * 1000 })));
  const [filter, setFilter] = useState<"all" | InboxStatus>("all");
  const [open, setOpen] = useState<string | null>(defaultOpen);
  const [now, setNow] = useState(() => Date.now());
  const reduced = useReducedMotion();
  const listId = useId();

  useInterval(() => setNow(Date.now()), 1000);

  // Demo: running tasks with a finish time complete, which moves them down the list
  useEffect(() => {
    if (!demo) return;
    const due = tasks.filter((t) => t.status === "running" && t.finishesIn !== undefined && now - t.at >= (t.since + t.finishesIn) * 1000);
    if (!due.length) return;
    setTasks((ts) =>
      ts.map((t) =>
        due.some((d) => d.id === t.id)
          ? { ...t, status: "done", at: Date.now(), since: 0, finishesIn: undefined, steps: [...t.steps.slice(-2), "Finished and posted a summary"] }
          : t,
      ),
    );
  }, [now, demo, tasks]);

  const sorted = [...tasks].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.at - a.at);
  const visible = sorted.filter((t) => filter === "all" || t.status === filter || (filter === "done" && t.status === "stopped"));
  const count = (f: "all" | InboxStatus) =>
    f === "all" ? tasks.length : tasks.filter((t) => t.status === f || (f === "done" && t.status === "stopped")).length;

  const flip = useFlip(reduced, [tasks, filter, open]);

  const act = (id: string, next: InboxStatus, step: string, finishesIn?: number) => {
    setTasks((ts) =>
      ts.map((t) => (t.id === id ? { ...t, status: next, at: Date.now(), since: 0, ask: undefined, finishesIn, steps: [...t.steps.slice(-2), step] } : t)),
    );
  };

  return (
    <div className={cx("kb-root kb-ib kb-part", className)}>
      <header className="kb-ib-head">
        <h3>Agent tasks</h3>
        <div className="kb-ib-filters" role="group" aria-label="Filter tasks" aria-controls={listId}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="kb-ib-filter"
              data-id={f.id}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              <span className="kb-ib-count">
                <NumberRoll value={count(f.id)} />
              </span>
            </button>
          ))}
        </div>
      </header>

      <ul className="kb-ib-list" id={listId}>
        {visible.map((t) => {
          const expanded = open === t.id;
          const s = STATUS[t.status];
          const seconds = Math.max(0, Math.floor((now - t.at) / 1000));
          return (
            <li key={t.id} ref={flip(t.id)} className="kb-ib-row" data-status={t.status} data-open={expanded || undefined}>
              <span className="kb-ib-tab" aria-hidden />
              <button
                type="button"
                className="kb-ib-line"
                aria-expanded={expanded}
                aria-controls={`${listId}-${t.id}`}
                onClick={() => setOpen(expanded ? null : t.id)}
              >
                <span className="kb-ib-icon">
                  <Icon name={t.icon} size={16} />
                </span>
                <span className="kb-ib-text">
                  <span className="kb-ib-title">{t.title}</span>
                  <span className="kb-ib-sub">
                    {t.agent}
                    {t.status === "needs-you" && t.ask && !expanded ? <span className="kb-ib-ask">{t.ask}</span> : null}
                  </span>
                </span>
                <span className="kb-ib-clock" aria-label={t.status === "running" ? "Running for" : "Updated"}>
                  {t.status === "running" ? clock(seconds) : ago(seconds)}
                </span>
                <span className="kb-ib-status">
                  <Tag tone={s.tone} live={t.status === "running"} dot={t.status !== "running"}>
                    {s.label}
                  </Tag>
                </span>
                <Icon name="chevronDown" size={16} className="kb-ib-chev" />
              </button>
              <div className="kb-ib-fold" id={`${listId}-${t.id}`} hidden={!expanded}>
                <ol className="kb-ib-steps">
                  {t.steps.map((step, i) => {
                    const last = i === t.steps.length - 1;
                    return (
                      <li key={step} data-last={last || undefined}>
                        <span className="kb-ib-dot">
                          {last && t.status === "running" ? <Spinner size={10} /> : null}
                        </span>
                        {step}
                      </li>
                    );
                  })}
                </ol>
                {t.status === "needs-you" && t.ask ? <p className="kb-ib-question">{t.ask}</p> : null}
                <div className="kb-ib-actions">
                  {t.status === "needs-you" ? (
                    <>
                      <Button size="sm" variant="primary" icon="check" onClick={() => act(t.id, "running", "Approved by you, continuing", demo ? 5 : undefined)}>
                        Approve
                      </Button>
                      <Button size="sm" icon="x" onClick={() => act(t.id, "stopped", "Rejected by you, nothing was sent")}>
                        Reject
                      </Button>
                    </>
                  ) : null}
                  {t.status === "failed" ? (
                    <Button size="sm" variant="primary" icon="refresh" onClick={() => act(t.id, "running", "Retrying from payout 1,201 with backoff", demo ? 6 : undefined)}>
                      Retry
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" icon="external" onClick={() => onOpen?.(t)}>
                    Open
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
        {visible.length === 0 ? <li className="kb-ib-empty">Nothing here right now.</li> : null}
      </ul>
    </div>
  );
}

function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ago(seconds: number) {
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

/** FLIP: remember where each row was and slide it from there after a re-render */
function useFlip(reduced: boolean, deps: unknown[]) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const last = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    nodes.current.forEach((el, id) => {
      const next = el.getBoundingClientRect();
      const prev = last.current.get(id);
      last.current.set(id, next);
      if (!prev || reduced) return;
      const dy = prev.top - next.top;
      if (Math.abs(dy) < 1) return;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], {
        duration: 460,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      });
    });
  }, deps);
  return (id: string) => (el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  };
}
