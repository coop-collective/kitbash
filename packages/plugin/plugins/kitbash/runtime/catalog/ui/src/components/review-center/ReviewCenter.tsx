"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { cx, Icon, NumberRoll, Tag, useReducedMotion } from "../../shared/index.ts";
import type { IconName, Tone } from "../../shared/index.ts";
import { Button } from "../button/Button.tsx";
import "./review-center.css";

export type ReviewRisk = "high" | "medium" | "low";
export type ReviewVerdict = "approved" | "edited" | "rejected";

/** Text with the spans the agent is unsure about marked, each with a note */
export type ReviewText = Array<string | { text: string; note: string }>;

export interface ReviewItem {
  id: string;
  agent: string;
  icon: IconName;
  title: string;
  risk: ReviewRisk;
  /** Where the action lands, e.g. "Email to dana.whitfield@northwind.com" */
  target: string;
  body: ReviewText;
}

export const sampleReviews: ReviewItem[] = [
  {
    id: "r1",
    agent: "Renewals agent",
    icon: "mail",
    title: "Reply to Dana Whitfield about the renewal",
    risk: "medium",
    target: "Email to dana.whitfield@northwind.com",
    body: [
      "Hi Dana, thanks for the quick reply. We can keep your 140 seats at ",
      { text: "$38,400 a year", note: "Calculated from the 2026 list price; the 2027 sheet isn't published yet" },
      ", which includes ",
      { text: "a 6% multi-year discount", note: "Not in the approved discount table for this tier" },
      ". If you sign by November 30, onboarding for the new Analytics add-on is included at no charge.",
    ],
  },
  {
    id: "r2",
    agent: "Ops agent",
    icon: "trash",
    title: "Delete 312 inactive user accounts",
    risk: "high",
    target: "Production, auth-db",
    body: [
      "Deletes 312 accounts with no sign-in for ",
      { text: "18 months or more", note: "The retention policy says 24 months; 18 is from an older draft" },
      ". Their projects move to the workspace owner first. ",
      { text: "None of them are on a paid plan", note: "Checked against Stripe, but 9 accounts have no Stripe customer id" },
      ".",
    ],
  },
  {
    id: "r3",
    agent: "Launch agent",
    icon: "message",
    title: "Post the 4.0 release note in #general",
    risk: "medium",
    target: "Slack, #general (1,240 members)",
    body: [
      "Billing 4.0 is live. Customers can now switch plans and add seats themselves from the new billing page, ",
      { text: "available on every plan", note: "Seat changes are Team and Enterprise only according to the spec" },
      ". Thanks to everyone who tested the beta.",
    ],
  },
  {
    id: "r4",
    agent: "Support agent",
    icon: "credit",
    title: "Refund $1,140 to Northwind Traders",
    risk: "high",
    target: "Stripe, invoice #48214",
    body: [
      "Refunds the duplicate charge on invoice #48214. ",
      { text: "The original charge on #48213 stays", note: "Assumed from the ticket; the customer didn't say which invoice to keep" },
      ". The customer gets a confirmation email from billing@acme.io.",
    ],
  },
  {
    id: "r5",
    agent: "Coding agent",
    icon: "code",
    title: "Merge Dependabot PR #2240, eslint 9.14",
    risk: "low",
    target: "GitHub, acme/storefront main",
    body: ["All 412 checks pass. The lockfile changes 3 packages and no source files change."],
  },
  {
    id: "r6",
    agent: "Triage agent",
    icon: "flag",
    title: "Close 5 duplicates of issue #2194",
    risk: "low",
    target: "GitHub, acme/storefront issues",
    body: ["Closes #2201, #2203, #2207, #2210 and #2214 with a link to #2194. All five report the Safari checkout timeout."],
  },
];

const RISK: Record<ReviewRisk, { label: string; tone: Tone; rank: number }> = {
  high: { label: "High risk", tone: "danger", rank: 0 },
  medium: { label: "Medium risk", tone: "decal", rank: 1 },
  low: { label: "Low risk", tone: "neutral", rank: 2 },
};
const VERDICT: Record<ReviewVerdict, { label: string; icon: IconName }> = {
  approved: { label: "Approved", icon: "check" },
  edited: { label: "Edited", icon: "edit" },
  rejected: { label: "Rejected", icon: "x" },
};
const STAMP_MS = 620;

export interface ReviewCenterProps {
  items?: ReviewItem[];
  onDecide?: (item: ReviewItem, verdict: ReviewVerdict, text?: string) => void;
  className?: string;
}

/**
 * A focused workspace for what your agents want to do. The queue is sorted by risk; one item is shown at a time with
 * the spans the agent is unsure of marked in decal. A approves, E edits, R rejects and S skips. Each decision presses a
 * stamp into the card before it leaves, and the next item rises into its place.
 */
export function ReviewCenter({ items = sampleReviews, onDecide, className }: ReviewCenterProps) {
  const [queue, setQueue] = useState(() => [...items].sort((a, b) => RISK[a.risk].rank - RISK[b.risk].rank));
  const [done, setDone] = useState<Array<{ item: ReviewItem; verdict: ReviewVerdict }>>([]);
  const [leaving, setLeaving] = useState<ReviewVerdict | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const reduced = useReducedMotion();
  const timer = useRef<number | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = queue[0];

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const decide = (verdict: ReviewVerdict, text?: string) => {
    if (!current || leaving) return;
    setLeaving(verdict);
    setEditing(false);
    onDecide?.(current, verdict, text);
    timer.current = window.setTimeout(() => {
      setDone((d) => [...d, { item: current, verdict }]);
      setQueue((q) => q.slice(1));
      setLeaving(null);
      rootRef.current?.focus();
    }, reduced ? 0 : STAMP_MS);
  };

  const skip = () => {
    if (!current || leaving || queue.length < 2) return;
    setEditing(false);
    setQueue((q) => [...q.slice(1), q[0]!]);
  };

  const startEdit = () => {
    if (!current || leaving) return;
    setDraft(plain(current.body));
    setEditing(true);
  };

  const jump = (id: string) => {
    if (leaving) return;
    setEditing(false);
    setQueue((q) => {
      const i = q.findIndex((x) => x.id === id);
      return i <= 0 ? q : [q[i]!, ...q.slice(0, i), ...q.slice(i + 1)];
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (editing || event.metaKey || event.ctrlKey || event.altKey) return;
    if ((event.target as HTMLElement).closest("textarea, input")) return;
    const k = event.key.toLowerCase();
    if (k === "a") decide("approved");
    else if (k === "r") decide("rejected");
    else if (k === "s") skip();
    else if (k === "e") { event.preventDefault(); startEdit(); }
    else return;
  };

  return (
    <div
      ref={rootRef}
      className={cx("kb-root kb-rc kb-part", className)}
      tabIndex={0}
      aria-label="Review center. A approves, E edits, R rejects, S skips."
      onKeyDown={onKeyDown}
    >
      <aside className="kb-rc-queue" aria-label="Queue">
        <header>
          <span>Queue</span>
          <span className="kb-rc-left">
            <NumberRoll value={queue.length} /> left
          </span>
        </header>
        <ol>
          {queue.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                className="kb-rc-q"
                data-risk={item.risk}
                aria-current={i === 0 || undefined}
                onClick={() => jump(item.id)}
                tabIndex={-1}
              >
                <span className="kb-rc-q-risk" aria-label={RISK[item.risk].label} />
                <span className="kb-rc-q-title">{item.title}</span>
              </button>
            </li>
          ))}
        </ol>
        {done.length ? (
          <div className="kb-rc-done">
            <span>Done</span>
            <ul>
              {done.map(({ item, verdict }) => (
                <li key={item.id} data-verdict={verdict}>
                  <Icon name={VERDICT[verdict].icon} size={13} strokeWidth={2.25} />
                  <span>{item.title}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>

      <section className="kb-rc-stage" aria-live="polite">
        {current ? (
          <article key={current.id} className="kb-rc-card" data-leaving={leaving ?? undefined}>
            <header className="kb-rc-card-head">
              <span className="kb-rc-icon">
                <Icon name={current.icon} size={18} />
              </span>
              <div>
                <span className="kb-rc-agent">{current.agent}</span>
                <h3>{current.title}</h3>
              </div>
              <Tag tone={RISK[current.risk].tone} dot>
                {RISK[current.risk].label}
              </Tag>
            </header>
            <p className="kb-rc-target">
              <Icon name="external" size={14} />
              {current.target}
            </p>
            {editing ? (
              <textarea
                className="kb-rc-edit"
                value={draft}
                rows={5}
                aria-label="Edit before approving"
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setEditing(false);
                    rootRef.current?.focus();
                  }
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) decide("edited", draft);
                }}
              />
            ) : (
              <p className="kb-rc-body">
                {current.body.map((part, i) =>
                  typeof part === "string" ? (
                    <span key={i}>{part}</span>
                  ) : (
                    <mark key={i} className="kb-rc-shaky" tabIndex={0} aria-label={`${part.text}. Agent is unsure: ${part.note}`}>
                      {part.text}
                      <span className="kb-rc-note" role="tooltip">
                        {part.note}
                      </span>
                    </mark>
                  ),
                )}
              </p>
            )}
            {!editing && current.body.some((p) => typeof p !== "string") ? (
              <p className="kb-rc-hint">
                <span className="kb-rc-swatch" aria-hidden /> The agent is unsure about {current.body.filter((p) => typeof p !== "string").length} marked
                {current.body.filter((p) => typeof p !== "string").length === 1 ? " part" : " parts"}. Hover or focus one to see why.
              </p>
            ) : null}
            <footer className="kb-rc-actions">
              {editing ? (
                <>
                  <span className="kb-rc-keys">Cmd+Enter saves and approves, Esc cancels</span>
                  <Button variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" icon="check" onClick={() => decide("edited", draft)}>
                    Save and approve
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" onClick={skip} disabled={queue.length < 2} aria-keyshortcuts="S">
                    Skip <kbd>S</kbd>
                  </Button>
                  <Button onClick={() => decide("rejected")} aria-keyshortcuts="R">
                    Reject <kbd>R</kbd>
                  </Button>
                  <Button onClick={startEdit} aria-keyshortcuts="E">
                    Edit <kbd>E</kbd>
                  </Button>
                  <Button variant="primary" onClick={() => decide("approved")} aria-keyshortcuts="A">
                    Approve <kbd>A</kbd>
                  </Button>
                </>
              )}
            </footer>
            {leaving ? (
              <span className="kb-rc-stamp" data-verdict={leaving} aria-hidden>
                <Icon name={VERDICT[leaving].icon} size={20} strokeWidth={2.5} />
                {VERDICT[leaving].label}
              </span>
            ) : null}
          </article>
        ) : (
          <div className="kb-rc-clear">
            <span className="kb-rc-clear-icon">
              <Icon name="check" size={22} strokeWidth={2.25} />
            </span>
            <h3>Queue clear</h3>
            <p>
              {count(done, "approved") + count(done, "edited")} approved, {count(done, "rejected")} rejected. New requests show up here.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function plain(body: ReviewText) {
  return body.map((p) => (typeof p === "string" ? p : p.text)).join("");
}

function count(done: Array<{ verdict: ReviewVerdict }>, v: ReviewVerdict) {
  return done.filter((d) => d.verdict === v).length;
}
