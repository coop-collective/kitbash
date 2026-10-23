"use client";

import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Avatar, cx, Icon, Shimmer, Spinner, useReducedMotion } from "../../shared/index.ts";
import "./comment-thread.css";

export interface WorkItem {
  label: string;
  /** Monospace detail line: a path, a call, a diff line */
  detail?: string;
  /** Removed / added lines for a tiny diff */
  diff?: { removed: string; added: string };
  /** The item is waiting on a person */
  needsYou?: boolean;
}

export interface ThreadComment {
  id: string;
  author: string;
  /** Marks the assistant's replies */
  assistant?: boolean;
  time: string;
  body: string;
  work?: WorkItem[];
}

const ASSISTANT = "Kitbash";

export const DEFAULT_THREAD: ThreadComment[] = [
  {
    id: "c1",
    author: "Maya Okafor",
    time: "10:42",
    body: "@Kitbash can you update the FAQ so it matches the new annual price, and flag anything else that still says $19?",
  },
  {
    id: "c2",
    author: ASSISTANT,
    assistant: true,
    time: "10:43",
    body: "Updated the FAQ. Two other places still said $19: I fixed the pricing table and flagged one email I shouldn't edit.",
    work: [
      { label: "Edited pricing-faq.md", diff: { removed: "Team annual is $19 per seat per month.", added: "Team annual is $24 per seat per month." } },
      { label: "Edited PricingTable.tsx", detail: "src/marketing/PricingTable.tsx:41" },
      { label: "Searched 48 docs for “$19”", detail: "3 matches, 1 left" },
      { label: "Flagged onboarding-email-3 for review", detail: "Owned by Lifecycle; not edited", needsYou: true },
    ],
  },
  {
    id: "c3",
    author: "Dev Patel",
    time: "10:51",
    body: "@Kitbash leave the email, marketing owns it. Can you check the in-app upgrade modal too?",
  },
];

const PENDING_REPLY: ThreadComment = {
  id: "c4",
  author: ASSISTANT,
  assistant: true,
  time: "10:51",
  body: "Checked the upgrade modal: it reads the price from the plans API, so it already shows $24. Nothing to change, and I left the email alone.",
  work: [
    { label: "Read UpgradeModal.tsx", detail: "src/billing/UpgradeModal.tsx" },
    { label: "Called the plans API", detail: "GET /v1/plans/team-annual → 24.00 USD" },
  ],
};

const CANNED_REPLIES: ThreadComment[] = [
  {
    id: "r",
    author: ASSISTANT,
    assistant: true,
    time: "now",
    body: "Done. I added a note to the Lifecycle board so marketing sees the $19 email before Friday's send.",
    work: [{ label: "Created a card on Lifecycle", detail: "LIF-118 Update onboarding-email-3 price" }],
  },
  {
    id: "r",
    author: ASSISTANT,
    assistant: true,
    time: "now",
    body: "Looked again: no other copy mentions $19. The only match left is the changelog entry from August, which should stay as written.",
    work: [{ label: "Searched 48 docs and 2 repos", detail: "1 match in CHANGELOG.md, kept" }],
  },
];

export interface CommentThreadProps {
  comments?: ThreadComment[];
  /** Who is replying from this composer */
  you?: string;
  /** People offered in @mention suggestions, besides the assistant */
  people?: string[];
  /** Where the comment is anchored */
  anchor?: { doc: string; quote: string };
  /** Play the assistant answering the last @mention */
  autoplay?: boolean;
  onReply?: (body: string) => void;
  className?: string;
}

/** Split a body into text and @mention pills. */
function renderBody(body: string, names: string[]): ReactNode {
  const pattern = new RegExp(`@(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(pattern)) {
    parts.push(body.slice(last, m.index));
    parts.push(
      <span key={m.index} className="kb-ct-mention" data-assistant={m[1] === ASSISTANT || undefined}>@{m[1]}</span>,
    );
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(body.slice(last));
  return parts;
}

/**
 * One comment with its replies. The assistant reports what it did in a work receipt that folds down on a hinge,
 * items that wait on a person carry a decal-yellow stripe, and @mentioning the assistant gets an answer in-thread.
 */
export function CommentThread({
  comments: initial = DEFAULT_THREAD,
  you = "Sam Rivera",
  people = ["Maya Okafor", "Dev Patel"],
  anchor = { doc: "Pricing page copy", quote: "Team annual: $24 per seat" },
  autoplay = true,
  onReply,
  className,
}: CommentThreadProps) {
  const reduced = useReducedMotion();
  const [comments, setComments] = useState(initial);
  const [pending, setPending] = useState<ThreadComment | null>(autoplay ? PENDING_REPLY : null);
  const [streamed, setStreamed] = useState(0);
  const [thinking, setThinking] = useState(autoplay);
  const [open, setOpen] = useState<Record<string, boolean>>({ c2: true });
  const [draft, setDraft] = useState("");
  const [suggest, setSuggest] = useState<{ query: string; index: number } | null>(null);
  const canned = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const uid = useId();
  const names = [ASSISTANT, ...people, you];

  // The assistant thinks for a beat, then streams its reply word by word.
  useEffect(() => {
    if (!pending) return;
    if (reduced) {
      setComments((c) => [...c, pending]);
      setPending(null);
      setThinking(false);
      return;
    }
    if (thinking) {
      const id = window.setTimeout(() => setThinking(false), 1600);
      return () => window.clearTimeout(id);
    }
    const words = pending.body.split(" ").length;
    if (streamed < words) {
      const id = window.setTimeout(() => setStreamed((n) => n + 1), 55);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => {
      setComments((c) => [...c, pending]);
      setOpen((o) => ({ ...o, [pending.id]: false }));
      setPending(null);
      setStreamed(0);
    }, 200);
    return () => window.clearTimeout(id);
  }, [pending, thinking, streamed, reduced]);

  const options = suggest
    ? names.filter((n) => n !== you && n.toLowerCase().startsWith(suggest.query.toLowerCase())).slice(0, 4)
    : [];

  const onDraft = (value: string, caret: number) => {
    setDraft(value);
    const m = value.slice(0, caret).match(/@(\w*)$/);
    setSuggest(m ? { query: m[1] ?? "", index: 0 } : null);
  };

  const pick = (name: string) => {
    const el = input.current;
    const caret = el?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret).replace(/@(\w*)$/, `@${name} `);
    const next = before + draft.slice(caret);
    setDraft(next);
    setSuggest(null);
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  };

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    const id = `y${Date.now()}`;
    setComments((c) => [...c, { id, author: you, time: "now", body }]);
    setDraft("");
    onReply?.(body);
    if (body.includes(`@${ASSISTANT}`) && !pending) {
      const reply = CANNED_REPLIES[canned.current % CANNED_REPLIES.length]!;
      canned.current += 1;
      setPending({ ...reply, id: `${id}-r` });
      setThinking(true);
      setStreamed(0);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggest && options.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setSuggest({ ...suggest, index: (suggest.index + d + options.length) % options.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(options[suggest.index] ?? options[0]!);
        return;
      }
      if (e.key === "Escape") {
        setSuggest(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const renderComment = (c: ThreadComment, live?: { words: number; thinking: boolean }) => {
    const isOpen = open[c.id] ?? false;
    const needs = c.work?.filter((w) => w.needsYou).length ?? 0;
    const body = live ? c.body.split(" ").slice(0, live.words).join(" ") : c.body;
    return (
      <li key={c.id} className="kb-ct-item" data-assistant={c.assistant || undefined}>
        <span className="kb-ct-avatar">
          {c.assistant ? (
            <span className="kb-ct-bot" aria-hidden><Icon name="sparkle" size={14} /></span>
          ) : (
            <Avatar name={c.author} size={28} />
          )}
        </span>
        <div className="kb-ct-main">
          <p className="kb-ct-meta">
            <span className="kb-ct-author">{c.author}</span>
            {c.assistant ? <span className="kb-ct-role">Assistant</span> : null}
            <span className="kb-ct-time">{c.time}</span>
          </p>
          {live?.thinking ? (
            <p className="kb-ct-thinking"><Spinner size={12} label="" /><Shimmer>Checking the upgrade flow</Shimmer></p>
          ) : (
            <p className="kb-ct-body">
              {renderBody(body, names)}
              {live ? <span className="kb-ct-caret" aria-hidden /> : null}
            </p>
          )}
          {c.work && !live ? (
            <div className="kb-ct-work">
              <button type="button" className="kb-ct-toggle" aria-expanded={isOpen} aria-controls={`${uid}-${c.id}`}
                onClick={() => setOpen({ ...open, [c.id]: !isOpen })}>
                <Icon name="chevronRight" size={14} className="kb-ct-chev" />
                What I did
                <span className="kb-ct-count">{c.work.length} steps</span>
                {needs ? <span className="kb-ct-needs">{needs} needs you</span> : null}
              </button>
              <div className="kb-ct-flap-wrap" data-open={isOpen || undefined}>
                <ul className="kb-ct-flap" id={`${uid}-${c.id}`} inert={!isOpen}>
                  {c.work.map((w) => (
                    <li key={w.label} className="kb-ct-step" data-needs={w.needsYou || undefined}>
                      <span className="kb-ct-step-icon" aria-hidden>
                        <Icon name={w.needsYou ? "flag" : "check"} size={12} strokeWidth={2.2} />
                      </span>
                      <span className="kb-ct-step-text">
                        <span>{w.label}</span>
                        {w.detail ? <code>{w.detail}</code> : null}
                        {w.diff ? (
                          <span className="kb-ct-diff">
                            <code data-kind="del">- {w.diff.removed}</code>
                            <code data-kind="add">+ {w.diff.added}</code>
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <section className={cx("kb-ct kb-part", className)} aria-label={`Comment thread on ${anchor.doc}`}>
      <header className="kb-ct-anchor">
        <Icon name="message" size={14} />
        <span className="kb-ct-doc">{anchor.doc}</span>
        <q className="kb-ct-quote">{anchor.quote}</q>
      </header>
      <ol className="kb-ct-list">
        {comments.map((c) => <Fragment key={c.id}>{renderComment(c)}</Fragment>)}
        {pending ? renderComment(pending, { words: streamed, thinking }) : null}
      </ol>
      <div className="kb-ct-reply">
        <Avatar name={you} size={28} />
        <div className="kb-ct-field">
          <textarea
            ref={input}
            className="kb-ct-input"
            rows={1}
            value={draft}
            placeholder="Reply, or @mention Kitbash"
            aria-label="Reply"
            aria-autocomplete="list"
            aria-expanded={Boolean(suggest && options.length)}
            aria-controls={`${uid}-mentions`}
            aria-activedescendant={suggest && options.length ? `${uid}-m${suggest.index}` : undefined}
            onChange={(e) => onDraft(e.target.value, e.target.selectionStart)}
            onKeyDown={onKey}
            onBlur={() => window.setTimeout(() => setSuggest(null), 120)}
          />
          {suggest && options.length ? (
            <ul className="kb-ct-mentions" id={`${uid}-mentions`} role="listbox" aria-label="Mention someone">
              {options.map((n, i) => (
                <li key={n} id={`${uid}-m${i}`} role="option" aria-selected={i === suggest.index}
                  onPointerDown={(e) => { e.preventDefault(); pick(n); }}>
                  {n === ASSISTANT ? <span className="kb-ct-bot kb-ct-bot-sm" aria-hidden><Icon name="sparkle" size={11} /></span> : <Avatar name={n} size={20} />}
                  {n}
                  {n === ASSISTANT ? <span className="kb-ct-role">Assistant</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="kb-ct-send" aria-label="Send reply" disabled={!draft.trim()} onClick={send}>
            <Icon name="arrowUp" size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
    </section>
  );
}
