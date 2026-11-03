"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { EmptyState } from "../empty-state/EmptyState.tsx";
import { ErrorState } from "../error-state/ErrorState.tsx";
import { FreshnessBadge } from "../freshness-badge/FreshnessBadge.tsx";
import { Skeleton, SkeletonCircle, SkeletonRegion } from "../skeleton/Skeleton.tsx";
import { Avatar, cx, Icon, relativeTime, useNow, type LoadStatus } from "../../shared/index.ts";
import "./conversation-list.css";

export type ConversationKind = "channel" | "dm" | "agent";

/** People: active, away or offline. Agents: working, needs-you (waiting on a person) or idle */
export type Presence = "active" | "away" | "offline" | "working" | "needs-you" | "idle";

export interface Conversation {
  id: string;
  kind: ConversationKind;
  /** Channel name without the #, a person's name, or an agent's name */
  name: string;
  /** Last message, already plain text */
  lastMessage?: string;
  /** Who wrote the last message; "You" for your own */
  lastAuthor?: string;
  /** ms since epoch */
  lastAt?: number;
  /** Unread messages */
  unread?: number;
  /** Messages that mention you; DMs count every unread message as a mention */
  mentions?: number;
  muted?: boolean;
  presence?: Presence;
  /** Private channel */
  private?: boolean;
}

export interface ConversationListProps {
  conversations?: Conversation[];
  /** Selected conversation id; controlled when given with onSelect */
  selected?: string | null;
  onSelect?: (id: string, conversation: Conversation) => void;
  /** Search text; controlled when given with onQueryChange */
  query?: string;
  onQueryChange?: (query: string) => void;
  /** Starts a new conversation, from the empty state and the section keys */
  onCreate?: (kind: ConversationKind) => void;
  loading?: boolean;
  /** Shown instead of the list when the conversations failed to load */
  error?: string;
  onRetry?: () => void;
  /** Feed status and updatedAt from useCachedLoader to show how fresh the list is */
  status?: LoadStatus;
  updatedAt?: number | null;
  onRefresh?: () => void;
  /** Workspace name over the list */
  title?: string;
  className?: string;
}

const MIN = 60_000;
const T0 = Date.now();

export const demoConversations: Conversation[] = [
  { id: "c-launch", kind: "channel", name: "launch-checkout-v2", lastAuthor: "Priya Raman", lastMessage: "Flag is at 25%, error rate flat. Going to 50 after lunch.", lastAt: T0 - 4 * MIN, unread: 6, mentions: 2 },
  { id: "c-eng", kind: "channel", name: "eng-platform", lastAuthor: "Jun Park", lastMessage: "Postgres failover drill is Thursday 10:00, runbook linked", lastAt: T0 - 22 * MIN, unread: 14 },
  { id: "c-support", kind: "channel", name: "support-escalations", lastAuthor: "Triage", lastMessage: "3 tickets need a human: refunds over $500", lastAt: T0 - 48 * MIN, private: true },
  { id: "c-random", kind: "channel", name: "random", lastAuthor: "Marta Silva", lastMessage: "who left the oat milk in the fridge since August", lastAt: T0 - 3 * 60 * MIN, unread: 31, muted: true },
  { id: "d-priya", kind: "dm", name: "Priya Raman", presence: "active", lastAuthor: "Priya Raman", lastMessage: "Can you look at the retry budget before I bump the flag?", lastAt: T0 - 2 * MIN, unread: 2, mentions: 2 },
  { id: "d-devon", kind: "dm", name: "Devon Okafor", presence: "away", lastAuthor: "You", lastMessage: "Sounds good, I'll pair with you tomorrow", lastAt: T0 - 95 * MIN },
  { id: "d-marta", kind: "dm", name: "Marta Silva", presence: "offline", lastAuthor: "Marta Silva", lastMessage: "Invoice for October is in the billing folder", lastAt: T0 - 2 * 24 * 60 * MIN },
  { id: "a-atlas", kind: "agent", name: "Atlas", presence: "working", lastAuthor: "Atlas", lastMessage: "Running the checkout test suite, 212 of 340 passed", lastAt: T0 - 1 * MIN },
  { id: "a-triage", kind: "agent", name: "Triage", presence: "needs-you", lastAuthor: "Triage", lastMessage: "Refund of $740 for order #88214 needs your approval", lastAt: T0 - 9 * MIN, unread: 1 },
  { id: "a-scribe", kind: "agent", name: "Scribe", presence: "idle", lastAuthor: "Scribe", lastMessage: "Standup notes for Oct 23 are ready", lastAt: T0 - 20 * 60 * MIN },
];

const SECTIONS: Array<{ kind: ConversationKind; label: string; create: string }> = [
  { kind: "channel", label: "Channels", create: "Create a channel" },
  { kind: "dm", label: "Direct messages", create: "Message someone" },
  { kind: "agent", label: "Agents", create: "Add an agent" },
];

const PRESENCE_TEXT: Record<Presence, string> = {
  active: "active",
  away: "away",
  offline: "offline",
  working: "working",
  "needs-you": "waiting on you",
  idle: "idle",
};

function short(at: number, now: number): string {
  const t = relativeTime(at, now);
  return t === "just now" ? "now" : t.replace(" ago", "");
}

function describe(c: Conversation): string {
  const parts = [c.kind === "channel" ? `${c.private ? "private channel" : "channel"} ${c.name}` : c.name];
  if (c.presence) parts.push(PRESENCE_TEXT[c.presence]);
  if (c.mentions) parts.push(`${c.mentions} ${c.mentions === 1 ? "mention" : "mentions"}`);
  else if (c.unread && !c.muted) parts.push("unread");
  if (c.muted) parts.push("muted");
  return parts.join(", ");
}

/**
 * Channels, direct messages and agents in one sidebar. Unread reads as weight and mentions as a stamped gunmetal
 * count, so each state has one signal. Agents carry the library's status shapes, so the list doubles as a
 * switchboard: a cobalt pulse while one works, a decal diamond when one is waiting on you. Type to filter; the
 * arrow keys walk the list and Enter opens.
 */
export function ConversationList({
  conversations = demoConversations,
  selected: selectedProp,
  onSelect,
  query: queryProp,
  onQueryChange,
  onCreate,
  loading = false,
  error,
  onRetry,
  status,
  updatedAt,
  onRefresh,
  title = "Northwind",
  className,
}: ConversationListProps) {
  const uid = useId();
  const now = useNow(30_000);
  const [ownSelected, setOwnSelected] = useState<string | null>(conversations.find((c) => c.kind === "channel")?.id ?? null);
  const selected = selectedProp !== undefined && onSelect ? selectedProp : ownSelected;
  const [ownQuery, setOwnQuery] = useState("");
  const query = queryProp !== undefined && onQueryChange ? queryProp : ownQuery;
  const [focusId, setFocusId] = useState<string | null>(null);
  const [folded, setFolded] = useState<Set<ConversationKind>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const setQuery = (q: string) => {
    if (!(queryProp !== undefined && onQueryChange)) setOwnQuery(q);
    onQueryChange?.(q);
  };

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? conversations.filter((c) => c.name.toLowerCase().includes(q) || (c.lastMessage ?? "").toLowerCase().includes(q)) : conversations),
    [conversations, q],
  );
  const groups = SECTIONS.map((s) => ({ ...s, items: filtered.filter((c) => c.kind === s.kind) })).filter((g) => g.items.length > 0 || (!q && onCreate));
  const visible = groups.flatMap((g) => (folded.has(g.kind) && !q ? [] : g.items));

  // The roving tab stop: the focused row, else the selected one, else the first
  const tabStop = visible.find((c) => c.id === focusId)?.id ?? visible.find((c) => c.id === selected)?.id ?? visible[0]?.id;

  const focusRow = (id: string | undefined) => {
    if (!id) return;
    setFocusId(id);
    listRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.focus();
  };

  const choose = (c: Conversation) => {
    if (!(selectedProp !== undefined && onSelect)) setOwnSelected(c.id);
    onSelect?.(c.id, c);
  };

  const onRowKey = (ev: ReactKeyboardEvent, c: Conversation) => {
    const i = visible.findIndex((v) => v.id === c.id);
    if (ev.key === "ArrowDown") { ev.preventDefault(); focusRow(visible[Math.min(visible.length - 1, i + 1)]?.id); }
    else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      if (i === 0) searchRef.current?.focus();
      else focusRow(visible[i - 1]?.id);
    }
    else if (ev.key === "Home") { ev.preventDefault(); focusRow(visible[0]?.id); }
    else if (ev.key === "End") { ev.preventDefault(); focusRow(visible[visible.length - 1]?.id); }
    else if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); choose(c); }
    else if (ev.key.length === 1 && /\S/.test(ev.key) && !ev.metaKey && !ev.ctrlKey) {
      // Typing on the list goes to the search field
      searchRef.current?.focus();
    }
  };

  const onSearchKey = (ev: ReactKeyboardEvent) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); focusRow(visible[0]?.id); }
    else if (ev.key === "Enter" && visible[0]) { ev.preventDefault(); choose(visible[0]); focusRow(visible[0].id); }
    else if (ev.key === "Escape" && query) { ev.preventDefault(); setQuery(""); }
  };

  // Keep focus tracking honest when the list changes under it
  useEffect(() => {
    if (focusId && !visible.some((c) => c.id === focusId)) setFocusId(null);
  }, [visible, focusId]);

  const totalMentions = conversations.reduce((n, c) => n + (c.muted ? 0 : c.mentions ?? 0), 0);

  const head = (
    <header className="kb-cl-head">
      <div className="kb-cl-title">
        <h3>{title}</h3>
        {totalMentions && !loading && !error ? <span className="kb-cl-total">{totalMentions} {totalMentions === 1 ? "mention" : "mentions"}</span> : null}
      </div>
      <label className="kb-cl-search">
        <Icon name="search" size={15} />
        <span className="kb-sr">Search conversations</span>
        <input
          ref={searchRef}
          type="search"
          placeholder="Jump to a conversation"
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
          onKeyDown={onSearchKey}
          disabled={loading}
          aria-controls={`${uid}-list`}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
    </header>
  );

  if (loading) {
    return (
      <nav className={cx("kb-cl", className)} aria-label="Conversations">
        {head}
        <SkeletonRegion label="Loading conversations" className="kb-cl-scroll">
          {[5, 3, 2].map((n, s) => (
            <div key={s} className="kb-cl-section">
              <div className="kb-cl-skel-label"><Skeleton width={s === 1 ? 110 : 72} height={10} /></div>
              {Array.from({ length: n }, (_, i) => (
                <div key={i} className="kb-cl-skel-row">
                  <span className="kb-cl-skel-mark">{s === 0 ? <Skeleton width={18} height={18} radius="part" /> : <SkeletonCircle size={28} />}</span>
                  <div className="kb-cl-skel-text">
                    <Skeleton width={`${48 + ((i * 17 + s * 11) % 30)}%`} height={11} />
                    <Skeleton width={`${70 + ((i * 13) % 22)}%`} height={9} />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </SkeletonRegion>
      </nav>
    );
  }

  return (
    <nav className={cx("kb-cl", className)} aria-label="Conversations">
      {head}
      <div className="kb-cl-scroll" ref={listRef}>
        {error ? (
          <ErrorState size="sm" title="Couldn't load conversations" body={error} detail="" onRetry={onRetry} />
        ) : conversations.length === 0 ? (
          <EmptyState
            size="sm"
            title="No conversations yet"
            body="Create a channel for your team, or add an agent to work alongside you."
            action={{ label: "Create a channel", icon: "plus", onClick: () => onCreate?.("channel") }}
          />
        ) : visible.length === 0 && q ? (
          <EmptyState size="sm" title={`Nothing matches "${query.trim()}"`} body="Search covers names and the latest message. Press Escape to clear it." action={undefined} />
        ) : (
          <div id={`${uid}-list`} role="listbox" aria-label="Conversations">
            {groups.map((g) => {
              const isFolded = folded.has(g.kind) && !q;
              const hiddenMentions = isFolded ? g.items.reduce((n, c) => n + (c.muted ? 0 : c.mentions ?? 0), 0) : 0;
              return (
                <div key={g.kind} role="group" aria-labelledby={`${uid}-${g.kind}`} className="kb-cl-section">
                  <div className="kb-cl-section-head">
                    <button
                      type="button"
                      className="kb-cl-fold"
                      id={`${uid}-${g.kind}`}
                      aria-expanded={!isFolded}
                      disabled={Boolean(q)}
                      onClick={() =>
                        setFolded((f) => {
                          const next = new Set(f);
                          if (next.has(g.kind)) next.delete(g.kind);
                          else next.add(g.kind);
                          return next;
                        })
                      }
                    >
                      <Icon name="chevronRight" size={12} />
                      <span>{g.label}</span>
                      {hiddenMentions ? <span className="kb-cl-count" aria-label={`${hiddenMentions} mentions`}>{hiddenMentions}</span> : null}
                    </button>
                    {onCreate ? (
                      <button type="button" className="kb-cl-new" aria-label={g.create} title={g.create} onClick={() => onCreate(g.kind)}>
                        <Icon name="plus" size={14} />
                      </button>
                    ) : null}
                  </div>
                  {isFolded
                    ? null
                    : g.items.map((c) => {
                        const isSel = c.id === selected;
                        const strong = Boolean(c.unread) && !c.muted;
                        const count = c.muted ? 0 : c.kind === "dm" ? c.mentions ?? c.unread ?? 0 : c.mentions ?? 0;
                        return (
                          <div
                            key={c.id}
                            role="option"
                            aria-selected={isSel}
                            aria-label={describe(c)}
                            tabIndex={c.id === tabStop ? 0 : -1}
                            data-id={c.id}
                            data-kind={c.kind}
                            data-unread={strong || undefined}
                            data-muted={c.muted || undefined}
                            className="kb-cl-row"
                            onClick={() => choose(c)}
                            onFocus={() => setFocusId(c.id)}
                            onKeyDown={(ev) => onRowKey(ev, c)}
                          >
                            <span className="kb-cl-mark" aria-hidden>
                              {c.kind === "channel" ? (
                                c.private ? <Icon name="lock" size={14} /> : <span className="kb-cl-hash">#</span>
                              ) : c.kind === "agent" ? (
                                <span className="kb-cl-bot"><Icon name="robot" size={16} /></span>
                              ) : (
                                <Avatar name={c.name} size={28} />
                              )}
                              {c.presence ? <i className="kb-cl-presence" data-presence={c.presence} /> : null}
                            </span>
                            <span className="kb-cl-text" aria-hidden>
                              <span className="kb-cl-line">
                                <span className="kb-cl-name">{c.name}</span>
                                {c.muted ? (
                                  <svg className="kb-cl-muted" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M6 8a6 6 0 0 1 9.3-5M18 8c0 7 3 9 3 9H9M13.7 21a2 2 0 0 1-3.4 0M3 3l18 18M6 8.5V9c0 4.5-1.3 6.9-2.2 8" />
                                  </svg>
                                ) : null}
                                {c.lastAt && now ? <span className="kb-cl-time">{short(c.lastAt, now)}</span> : null}
                              </span>
                              <span className="kb-cl-line">
                                <span className="kb-cl-preview">
                                  {c.lastAuthor && c.kind === "channel" ? <b>{c.lastAuthor === "You" ? "You" : c.lastAuthor.split(" ")[0]}: </b> : c.lastAuthor === "You" ? <b>You: </b> : null}
                                  {c.lastMessage}
                                </span>
                                {count ? <span className="kb-cl-count">{c.kind === "dm" ? count : `@${count}`}</span> : null}
                              </span>
                            </span>
                          </div>
                        );
                      })}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {status ? (
        <footer className="kb-cl-foot">
          <FreshnessBadge status={status} updatedAt={updatedAt ?? null} onRefresh={onRefresh} />
        </footer>
      ) : null}
    </nav>
  );
}
