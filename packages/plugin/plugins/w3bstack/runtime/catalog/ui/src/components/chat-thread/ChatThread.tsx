"use client";

import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Button } from "../button/Button.tsx";
import { EmptyState } from "../empty-state/EmptyState.tsx";
import { ErrorState } from "../error-state/ErrorState.tsx";
import { FreshnessBadge } from "../freshness-badge/FreshnessBadge.tsx";
import { ReactionPicker, type Reaction } from "../reaction-picker/ReactionPicker.tsx";
import { Skeleton, SkeletonCircle, SkeletonRegion } from "../skeleton/Skeleton.tsx";
import { Avatar, clockTime, cx, Icon, relativeTime, Spinner, useNow, useReducedMotion, type LoadStatus } from "../../shared/index.ts";
import "./chat-thread.css";

export interface ChatPerson {
  id: string;
  name: string;
  kind?: "person" | "agent";
}

export interface ChatAttachment {
  id: string;
  name: string;
  kind: "file" | "image";
  /** Bytes */
  size?: number;
  /** Image URL; without one an image draws a neutral preview */
  src?: string;
}

export interface ChatThreadInfo {
  count: number;
  lastReplyAt: number;
  /** Person ids, most recent first */
  repliers: string[];
}

export type SendState = "sending" | "sent" | "failed";

export interface ChatMessage {
  id: string;
  authorId: string;
  /** ms since epoch */
  at: number;
  text: string;
  editedAt?: number;
  reactions?: Reaction[];
  thread?: ChatThreadInfo;
  attachments?: ChatAttachment[];
  /** Only for your own messages while they are being delivered */
  state?: SendState;
}

/** The last message a person has read */
export interface ChatReadReceipt {
  personId: string;
  messageId: string;
}

export interface ChatDraft {
  /** Becomes the message id; return a message with this id in `messages` once the server has it */
  clientId: string;
  text: string;
  attachments: ChatAttachment[];
  files: File[];
}

export interface ChatThreadProps {
  /** Conversation name, without the # */
  channel?: string;
  topic?: string;
  people?: ChatPerson[];
  /** You; your messages show delivery state */
  me?: ChatPerson;
  messages?: ChatMessage[];
  reads?: ChatReadReceipt[];
  /** Person ids writing right now */
  typing?: string[];
  /** There are older messages to load at the top */
  hasOlder?: boolean;
  /** Loads the page before the oldest message; the demo simulates one when omitted */
  onLoadOlder?: (before: ChatMessage | undefined) => Promise<ChatMessage[]>;
  /** Delivers a message; the thread shows it at once as sending, then sent, or failed with a retry */
  onSend?: (draft: ChatDraft) => Promise<void>;
  onReactionsChange?: (messageId: string, reactions: Reaction[]) => void;
  onOpenThread?: (message: ChatMessage) => void;
  /** Composer text; controlled when given with onDraftChange */
  draft?: string;
  onDraftChange?: (text: string) => void;
  /** Consecutive messages from one sender within this many ms share a header */
  groupWithin?: number;
  /** Messages keep arriving on a timer */
  demo?: boolean;
  loading?: boolean;
  /** Shown in place of the messages when they failed to load */
  error?: string;
  onRetry?: () => void;
  /** Feed status and updatedAt from useCachedLoader to show how fresh the thread is */
  status?: LoadStatus;
  updatedAt?: number | null;
  onRefresh?: () => void;
  className?: string;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.now();

export const demoChatMe: ChatPerson = { id: "u-sam", name: "Sam Rivera" };

export const demoChatPeople: ChatPerson[] = [
  demoChatMe,
  { id: "u-priya", name: "Priya Raman" },
  { id: "u-devon", name: "Devon Okafor" },
  { id: "u-marta", name: "Marta Silva" },
  { id: "u-jun", name: "Jun Park" },
  { id: "a-atlas", name: "Atlas", kind: "agent" },
];

const P = (id: string): { id: string; name: string } => ({ id, name: demoChatPeople.find((p) => p.id === id)?.name ?? id });

export const demoChatMessages: ChatMessage[] = [
  {
    id: "m1",
    authorId: "u-priya",
    at: T0 - 26 * HOUR,
    text: "Kicking off the checkout v2 rollout tomorrow: 5% at 9:00, then 25, 50 and 100 if the error rate stays under 0.3%.",
    attachments: [{ id: "f1", name: "rollout-plan.pdf", kind: "file", size: 412_000 }],
    thread: { count: 4, lastReplyAt: T0 - 25 * HOUR, repliers: ["u-devon", "u-sam"] },
  },
  { id: "m2", authorId: "u-priya", at: T0 - 26 * HOUR + 40_000, text: "Atlas will post numbers here after each step.", reactions: [{ emoji: "👍", by: [P("u-devon"), P("a-atlas")] }] },
  { id: "m3", authorId: "u-devon", at: T0 - 25 * HOUR, text: "I'll keep the payment provider dashboards open." },
  {
    id: "m4",
    authorId: "a-atlas",
    at: T0 - 52 * MIN,
    text: "Flag `checkout_v2` is at 25%. Error rate 0.12% over the last 30 minutes, p95 latency 410ms.",
    attachments: [{ id: "i1", name: "error-rate-30m.png", kind: "image", size: 88_400 }],
    reactions: [{ emoji: "👀", by: [P("u-priya"), P("u-sam")] }],
  },
  { id: "m5", authorId: "a-atlas", at: T0 - 52 * MIN + 30_000, text: "No new alerts on the payments service." },
  { id: "m6", authorId: "u-priya", at: T0 - 40 * MIN, text: "@Sam can you look at the retry budget before I bump to 50%?" },
  { id: "m7", authorId: "u-sam", at: T0 - 38 * MIN, text: "Looking now. Three retries with jittered backoff, and `retry.ts` caps the wait at 8s.", editedAt: T0 - 37 * MIN },
  { id: "m8", authorId: "u-sam", at: T0 - 38 * MIN + 20_000, text: "Looks right to me, go ahead." },
  {
    id: "m9",
    authorId: "u-marta",
    at: T0 - 12 * MIN,
    text: "Finance is asking whether refunds go through the new flow too.",
    thread: { count: 2, lastReplyAt: T0 - 8 * MIN, repliers: ["a-atlas", "u-priya"] },
  },
  {
    id: "m10",
    authorId: "u-priya",
    at: T0 - 5 * MIN,
    text: "They do, refunds share the same path. Bumping to 50% now.",
    reactions: [
      { emoji: "🚀", by: [P("u-devon"), P("u-marta"), P("u-jun")] },
      { emoji: "🙏", by: [P("u-sam")] },
    ],
  },
];

export const demoChatReads: ChatReadReceipt[] = [
  { personId: "u-devon", messageId: "m10" },
  { personId: "u-marta", messageId: "m10" },
  { personId: "u-jun", messageId: "m8" },
];

export const demoOlderMessages: ChatMessage[] = [
  { id: "o1", authorId: "u-jun", at: T0 - 50 * HOUR, text: "Made this channel for the checkout v2 launch. Decisions and numbers go here." },
  { id: "o2", authorId: "u-jun", at: T0 - 50 * HOUR + 25_000, text: "Runbook and the rollback steps are pinned." },
  { id: "o3", authorId: "u-marta", at: T0 - 49 * HOUR, text: "Added finance so we hear about refund edge cases early.", reactions: [{ emoji: "✅", by: [P("u-jun")] }] },
];

const DEMO_INCOMING: Array<Omit<ChatMessage, "id" | "at">> = [
  { authorId: "a-atlas", text: "Flag is at 50%. Error rate 0.14%, holding steady." },
  { authorId: "u-devon", text: "Provider dashboards look clean on my side." },
  { authorId: "u-priya", text: "Great. I'll check back at 15:00 for 100%." },
];

function sizeLabel(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function dayLabel(at: number, now: number | null): string {
  const d = new Date(at);
  if (now) {
    const today = new Date(now);
    if (d.toDateString() === today.toDateString()) return "Today";
    const y = new Date(now - 24 * HOUR);
    if (d.toDateString() === y.toDateString()) return "Yesterday";
  }
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

/** Inline code in backticks and @mentions; mentions of you are marked */
function renderText(text: string, me: ChatPerson): ReactNode[] {
  const first = me.name.split(" ")[0] ?? me.name;
  return text.split(/(`[^`]+`|@[A-Za-z]+)/g).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("@")) return <span key={i} className="kb-ct-mention" data-me={part.slice(1) === first || undefined}>{part}</span>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function names(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** A neutral picture of a chart for image attachments without a src */
function ImagePreview() {
  const pts = [34, 36, 31, 38, 35, 33, 37, 30, 34, 32, 35, 31, 33, 29, 32];
  const d = pts.map((y, i) => `${i === 0 ? "M" : "L"}${8 + i * 16},${y + 30}`).join(" ");
  return (
    <svg className="kb-ct-img-art" viewBox="0 0 240 110" aria-hidden preserveAspectRatio="none">
      <path d="M8 20H232M8 50H232M8 80H232" className="kb-ct-img-grid" />
      <path d={d} className="kb-ct-img-line" />
      <path d="M8 46H232" className="kb-ct-img-limit" />
    </svg>
  );
}

/**
 * A conversation between people and agents. Messages group under one header per sender and minute, days are split
 * by a seam, and what people have read shows as small avatars where they stopped. Reactions latch, threads fold into
 * a reply count, and your own messages go out at once as sending, then sent, or failed with a retry. Scroll up and
 * older messages load in under a skeleton; new ones arriving meanwhile wait behind a "Jump to latest" key.
 */
export function ChatThread({
  channel = "launch-checkout-v2",
  topic = "Checkout v2 rollout behind the flag, one step at a time",
  people = demoChatPeople,
  me = demoChatMe,
  messages = demoChatMessages,
  reads = demoChatReads,
  typing = ["a-atlas"],
  hasOlder: hasOlderProp = true,
  onLoadOlder,
  onSend,
  onReactionsChange,
  onOpenThread,
  draft: draftProp,
  onDraftChange,
  groupWithin = 2 * MIN,
  demo = false,
  loading = false,
  error,
  onRetry,
  status,
  updatedAt,
  onRefresh,
  className,
}: ChatThreadProps) {
  const uid = useId();
  const now = useNow(30_000);
  const reduced = useReducedMotion();
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [olderDone, setOlderDone] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [incoming, setIncoming] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<ChatMessage[]>([]);
  const [patch, setPatch] = useState<Record<string, Reaction[]>>({});
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [ownDraft, setOwnDraft] = useState("");
  const draft = draftProp !== undefined && onDraftChange ? draftProp : ownDraft;
  const [files, setFiles] = useState<Array<{ att: ChatAttachment; file: File }>>([]);
  const [say, setSay] = useState("");
  const [typingCleared, setTypingCleared] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);

  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const lastSeen = useRef<{ lastId: string | undefined; count: number }>({ lastId: undefined, count: 0 });
  const timers = useRef<number[]>([]);
  const sentFiles = useRef(new Map<string, File[]>());

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const hasOlder = hasOlderProp && !olderDone;
  const person = (id: string): ChatPerson => people.find((p) => p.id === id) ?? { id, name: id };

  // A pending send shows over the host's copy until it is delivered; then the host's copy takes over
  const base = [...older, ...messages, ...incoming];
  const all = [...base.filter((m) => !hidden.includes(m.id)).filter((m) => !pending.some((p) => p.id === m.id)), ...pending].sort((a, b) => a.at - b.at);
  const lastId = all[all.length - 1]?.id;
  const typingNow = typingCleared ? [] : typing.filter((id) => id !== me.id);

  const setDraft = (text: string) => {
    if (!(draftProp !== undefined && onDraftChange)) setOwnDraft(text);
    onDraftChange?.(text);
  };

  const scrollToEnd = (smooth: boolean) => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduced ? "smooth" : "auto" });
  };

  // Start at the newest message
  useLayoutEffect(() => {
    if (loading || error) return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    lastSeen.current = { lastId, count: all.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error]);

  // Older messages or the top skeleton changed the content above: keep what is on screen in place
  useLayoutEffect(() => {
    const el = logRef.current;
    const a = anchor.current;
    if (!el || !a) return;
    el.scrollTop = a.top + (el.scrollHeight - a.height);
    anchor.current = null;
  }, [older.length, loadingOlder]);

  // New messages at the bottom: follow them when at the bottom (or when they are yours), otherwise count them
  useLayoutEffect(() => {
    const prev = lastSeen.current;
    if (lastId === prev.lastId) {
      lastSeen.current = { lastId, count: all.length };
      return;
    }
    const newest = all[all.length - 1];
    const prevIndex = all.findIndex((m) => m.id === prev.lastId);
    const added = prevIndex >= 0 ? all.slice(prevIndex + 1) : [];
    lastSeen.current = { lastId, count: all.length };
    if (!newest || !added.length) return;
    if (atBottom || newest.authorId === me.id) scrollToEnd(true);
    else setUnseen((n) => n + added.filter((m) => m.authorId !== me.id).length);
    const others = added.filter((m) => m.authorId !== me.id);
    if (others.length) setSay(`New message from ${person(others[others.length - 1]!.authorId).name}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

  // Demo: three messages arrive a few seconds apart; the first one ends the typing indicator
  useEffect(() => {
    if (!demo || loading || error) return;
    DEMO_INCOMING.forEach((m, i) => {
      timers.current.push(
        window.setTimeout(() => {
          setIncoming((xs) => [...xs, { ...m, id: `demo-${i}`, at: Date.now() }]);
          if (i === 0) setTypingCleared(true);
        }, 2600 + i * 2200),
      );
    });
  }, [demo, loading, error]);

  const loadOlder = () => {
    if (!hasOlder || loadingOlder) return;
    const el = logRef.current;
    if (el) anchor.current = { height: el.scrollHeight, top: el.scrollTop };
    setLoadingOlder(true);
    const oldest = all[0];
    const load =
      onLoadOlder ??
      (() =>
        new Promise<ChatMessage[]>((ok) => {
          timers.current.push(window.setTimeout(() => ok(demoOlderMessages), 1400));
        }));
    load(oldest).then(
      (page) => {
        const box = logRef.current;
        if (box) anchor.current = { height: box.scrollHeight, top: box.scrollTop };
        setOlder((xs) => [...page.filter((p) => !xs.some((x) => x.id === p.id)), ...xs]);
        if (!onLoadOlder || page.length === 0) setOlderDone(true);
        setLoadingOlder(false);
        setSay(page.length ? `Loaded ${page.length} older messages` : "This is the start of the conversation");
      },
      () => {
        const box = logRef.current;
        if (box) anchor.current = { height: box.scrollHeight, top: box.scrollTop };
        setLoadingOlder(false);
        setSay("Couldn't load older messages");
      },
    );
  };

  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (bottom !== atBottom) setAtBottom(bottom);
    if (bottom && unseen) setUnseen(0);
    if (el.scrollTop < 80) loadOlder();
  };

  // Once delivered and confirmed by the host (a copy with no delivery state), the pending copy retires
  useEffect(() => {
    const confirmed = (p: ChatMessage) => p.state === "sent" && base.some((m) => m.id === p.id && (m.state === undefined || m.state === "sent"));
    if (pending.some(confirmed)) setPending((xs) => xs.filter((p) => !confirmed(p)));
  });

  const deliver = (msg: ChatMessage, filesFor: File[]) => {
    setPending((xs) => (xs.some((m) => m.id === msg.id) ? xs.map((m) => (m.id === msg.id ? { ...m, state: "sending" as const } : m)) : [...xs, { ...msg, state: "sending" as const }]));
    const send =
      onSend ??
      (() =>
        new Promise<void>((ok) => {
          timers.current.push(window.setTimeout(ok, 900));
        }));
    send({ clientId: msg.id, text: msg.text, attachments: msg.attachments ?? [], files: filesFor }).then(
      () => {
        setPending((xs) => xs.map((m) => (m.id === msg.id ? { ...m, state: "sent" } : m)));
        setSay("Message sent");
      },
      () => {
        setPending((xs) => xs.map((m) => (m.id === msg.id ? { ...m, state: "failed" } : m)));
        setSay("Couldn't send your message");
      },
    );
  };

  const send = () => {
    const text = draft.trim();
    if (!text && !files.length) return;
    const msg: ChatMessage = {
      id: `local-${Date.now().toString(36)}`,
      authorId: me.id,
      at: Date.now(),
      text,
      attachments: files.map((f) => f.att),
      state: "sending",
    };
    const fs = files.map((f) => f.file);
    sentFiles.current.set(msg.id, fs);
    setPending((xs) => [...xs, msg]);
    setDraft("");
    setFiles([]);
    setUnseen(0);
    deliver(msg, fs);
    inputRef.current?.focus();
  };

  const onComposerKey = (ev: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) {
      ev.preventDefault();
      send();
    }
  };

  const onPickFiles = (ev: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(ev.target.files ?? []);
    setFiles((xs) => [
      ...xs,
      ...list.map((file, i) => ({ file, att: { id: `att-${Date.now()}-${i}`, name: file.name, size: file.size, kind: file.type.startsWith("image/") ? ("image" as const) : ("file" as const) } })),
    ]);
    ev.target.value = "";
  };

  const reactionsOf = (m: ChatMessage) => patch[m.id] ?? m.reactions ?? [];

  // Read receipts sit under the message each person read last; you are not shown to yourself
  const readersAt = new Map<string, ChatPerson[]>();
  for (const r of reads) {
    if (r.personId === me.id) continue;
    readersAt.set(r.messageId, [...(readersAt.get(r.messageId) ?? []), person(r.personId)]);
  }
  const lastMine = [...all].reverse().find((m) => m.authorId === me.id);
  const readAfterLastMine = lastMine ? all.slice(all.indexOf(lastMine)).some((m) => readersAt.has(m.id)) : false;

  const header = (
    <header className="kb-ct-head">
      <div className="kb-ct-title">
        <h3><span className="kb-ct-hash" aria-hidden>#</span>{channel}</h3>
        {topic ? <p>{topic}</p> : null}
      </div>
      {status ? <FreshnessBadge status={status} updatedAt={updatedAt ?? null} onRefresh={onRefresh} /> : null}
      <span className="kb-ct-members" aria-label={`${people.length} members`}>
        {people.slice(0, 4).map((p) => (
          <span key={p.id} className="kb-ct-member">{p.kind === "agent" ? <span className="kb-ct-bot" title={p.name}><Icon name="robot" size={13} /></span> : <Avatar name={p.name} size={22} />}</span>
        ))}
        <span className="kb-ct-member-count">{people.length}</span>
      </span>
    </header>
  );

  const composerDisabled = loading || Boolean(error);
  const composer = (
    <div className="kb-ct-composer">
      {files.length ? (
        <ul className="kb-ct-pending-files" aria-label="Attachments to send">
          {files.map(({ att }) => (
            <li key={att.id}>
              <Icon name={att.kind === "image" ? "file" : "paperclip"} size={14} />
              <span>{att.name}</span>
              {att.size !== undefined ? <code>{sizeLabel(att.size)}</code> : null}
              <button type="button" aria-label={`Remove ${att.name}`} onClick={() => setFiles((xs) => xs.filter((x) => x.att.id !== att.id))}>
                <Icon name="x" size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="kb-ct-field">
        <button type="button" className="kb-ct-attach" aria-label="Attach files" onClick={() => fileRef.current?.click()} disabled={composerDisabled}>
          <Icon name="paperclip" size={17} />
        </button>
        <input ref={fileRef} type="file" multiple hidden onChange={onPickFiles} tabIndex={-1} />
        <label className="kb-sr" htmlFor={`${uid}-input`}>Message #{channel}</label>
        <textarea
          id={`${uid}-input`}
          ref={inputRef}
          rows={1}
          placeholder={`Message #${channel}`}
          value={draft}
          onChange={(ev) => setDraft(ev.target.value)}
          onKeyDown={onComposerKey}
          disabled={composerDisabled}
        />
        <Button variant="primary" size="sm" icon="send" onClick={send} disabled={composerDisabled || (!draft.trim() && !files.length)}>
          Send
        </Button>
      </div>
      <p className="kb-ct-hint" aria-hidden>Enter sends, Shift+Enter adds a line</p>
    </div>
  );

  if (loading) {
    return (
      <section className={cx("kb-ct", className)} aria-label={`#${channel}`}>
        {header}
        <SkeletonRegion label="Loading messages" className="kb-ct-log kb-ct-log-skel">
          <MessageSkeleton lines={[78, 52]} />
          <MessageSkeleton lines={[90]} attachment />
          <MessageSkeleton lines={[64, 40]} />
          <MessageSkeleton lines={[58]} />
        </SkeletonRegion>
        {composer}
      </section>
    );
  }

  // Lay out day seams and sender groups
  const rows: ReactNode[] = [];
  let prev: ChatMessage | undefined;
  for (const m of all) {
    const newDay = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
    if (newDay) {
      rows.push(
        <div key={`day-${m.id}`} className="kb-ct-day" role="separator" aria-label={dayLabel(m.at, now)}>
          <span>{dayLabel(m.at, now)}</span>
        </div>,
      );
    }
    const grouped = !newDay && prev !== undefined && prev.authorId === m.authorId && m.at - prev.at <= groupWithin && !prev.thread;
    const author = person(m.authorId);
    const mine = m.authorId === me.id;
    const reactions = reactionsOf(m);
    const readers = readersAt.get(m.id) ?? [];
    const showState = mine && (m.state === "sending" || m.state === "failed" || (m.id === lastMine?.id && !readAfterLastMine && m.state === "sent"));
    rows.push(
      <article
        key={m.id}
        className="kb-ct-msg"
        data-grouped={grouped || undefined}
        data-state={m.state}
        data-agent={author.kind === "agent" || undefined}
        aria-label={`${author.name}, ${clockTime(m.at)}`}
      >
        <div className="kb-ct-gutter">
          {grouped ? (
            <time className="kb-ct-gutter-time" dateTime={new Date(m.at).toISOString()}>{clockTime(m.at)}</time>
          ) : author.kind === "agent" ? (
            <span className="kb-ct-bot kb-ct-bot-lg"><Icon name="robot" size={18} /></span>
          ) : (
            <Avatar name={author.name} size={34} />
          )}
        </div>
        <div className="kb-ct-body">
          {grouped ? null : (
            <div className="kb-ct-byline">
              <strong>{author.name}</strong>
              {author.kind === "agent" ? <span className="kb-ct-agent-label">Agent</span> : null}
              <time dateTime={new Date(m.at).toISOString()}>{clockTime(m.at)}</time>
            </div>
          )}
          {m.text ? (
            <p className="kb-ct-text">
              {renderText(m.text, me)}
              {m.editedAt ? <span className="kb-ct-edited" title={`Edited ${clockTime(m.editedAt)}`}> (edited)</span> : null}
            </p>
          ) : null}
          {m.attachments?.length ? (
            <div className="kb-ct-atts">
              {m.attachments.map((a) =>
                a.kind === "image" ? (
                  <figure key={a.id} className="kb-ct-img">
                    {a.src ? <img src={a.src} alt={a.name} /> : <ImagePreview />}
                    <figcaption>
                      <span>{a.name}</span>
                      {a.size !== undefined ? <code>{sizeLabel(a.size)}</code> : null}
                    </figcaption>
                  </figure>
                ) : (
                  <div key={a.id} className="kb-ct-file">
                    <span className="kb-ct-file-icon"><Icon name="file" size={18} /></span>
                    <span className="kb-ct-file-text">
                      <span>{a.name}</span>
                      <code>{a.name.split(".").pop()?.toUpperCase()} {a.size !== undefined ? sizeLabel(a.size) : ""}</code>
                    </span>
                  </div>
                ),
              )}
            </div>
          ) : null}
          {reactions.length || pickerFor === m.id ? (
            <div className="kb-ct-reactions">
              <ReactionPicker
                reactions={reactions}
                me={{ id: me.id, name: me.name }}
                onChange={(next) => {
                  setPatch((p) => ({ ...p, [m.id]: next }));
                  onReactionsChange?.(m.id, next);
                }}
                open={pickerFor === m.id}
                onOpenChange={(o) => setPickerFor(o ? m.id : null)}
                placement="top"
                hideAdd={!reactions.length}
              />
            </div>
          ) : null}
          {m.thread ? (
            <button type="button" className="kb-ct-thread" onClick={() => onOpenThread?.(m)}>
              <span className="kb-ct-thread-faces" aria-hidden>
                {m.thread.repliers.slice(0, 3).map((id) => {
                  const p = person(id);
                  return p.kind === "agent" ? <span key={id} className="kb-ct-bot kb-ct-bot-sm"><Icon name="robot" size={11} /></span> : <Avatar key={id} name={p.name} size={20} />;
                })}
              </span>
              <span className="kb-ct-thread-count">{m.thread.count} {m.thread.count === 1 ? "reply" : "replies"}</span>
              {now ? <span className="kb-ct-thread-last">Last reply {relativeTime(m.thread.lastReplyAt, now)}</span> : null}
            </button>
          ) : null}
          {showState ? (
            <p className="kb-ct-state" data-state={m.state} role={m.state === "failed" ? "alert" : undefined}>
              {m.state === "sending" ? (
                <>
                  <Spinner size={11} label="Sending" />
                  <span>Sending</span>
                </>
              ) : m.state === "failed" ? (
                <>
                  <i className="kb-ct-failed-mark" aria-hidden />
                  <span>Couldn't send</span>
                  <button type="button" className="kb-ct-link" onClick={() => deliver(m, sentFiles.current.get(m.id) ?? [])}>Try again</button>
                  <button type="button" className="kb-ct-link" onClick={() => { setPending((xs) => xs.filter((x) => x.id !== m.id)); setHidden((h) => [...h, m.id]); }}>Delete</button>
                </>
              ) : (
                <>
                  <Icon name="check" size={13} />
                  <span>Sent</span>
                </>
              )}
            </p>
          ) : null}
          {readers.length ? (
            <div className="kb-ct-seen" aria-label={`Seen by ${names(readers.map((r) => r.name))}`}>
              {readers.map((r) => (
                <span key={r.id} title={`${r.name} read up to here`}>
                  {r.kind === "agent" ? <span className="kb-ct-bot kb-ct-bot-xs"><Icon name="robot" size={9} /></span> : <Avatar name={r.name} size={16} />}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {m.state === "sending" || m.state === "failed" ? null : (
          <div className="kb-ct-actions" role="toolbar" aria-label="Message actions">
            <button type="button" aria-label="Add reaction" title="Add reaction" onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                <path d="M20.6 12.9a8.6 8.6 0 1 1-9.5-9.5" />
                <path d="M8.5 14.5a4.2 4.2 0 0 0 7 0M9 9.5h.01M15 9.5h.01M19 2.5v6M16 5.5h6" />
              </svg>
            </button>
            <button type="button" aria-label="Reply in thread" title="Reply in thread" onClick={() => onOpenThread?.(m)}>
              <Icon name="message" size={16} />
            </button>
          </div>
        )}
      </article>,
    );
    prev = m;
  }

  return (
    <section className={cx("kb-ct", className)} aria-label={`#${channel}`}>
      {header}
      <div className="kb-ct-stage">
        <div
          ref={logRef}
          className="kb-ct-log"
          role="log"
          aria-label={`Messages in #${channel}`}
          aria-live="off"
          tabIndex={0}
          onScroll={onScroll}
        >
          {error ? (
            <div className="kb-ct-fill"><ErrorState title="Couldn't load messages" body={error} onRetry={onRetry} /></div>
          ) : all.length === 0 ? (
            <div className="kb-ct-fill">
              <EmptyState
                title="No messages yet"
                body={`This is the start of #${channel}. Say hello, or ask an agent to post updates here.`}
                action={undefined}
              />
            </div>
          ) : (
            <>
              {loadingOlder ? (
                <div className="kb-ct-older-skel" aria-hidden>
                  <MessageSkeleton lines={[70, 44]} />
                  <MessageSkeleton lines={[56]} />
                </div>
              ) : hasOlder ? (
                <div className="kb-ct-older">
                  <Button size="sm" variant="ghost" icon="chevronUp" onClick={loadOlder}>Load older messages</Button>
                </div>
              ) : (
                <p className="kb-ct-start">This is the start of #{channel}.</p>
              )}
              {rows}
              {typingNow.length ? (
                <p className="kb-ct-typing">
                  {typingNow.some((id) => person(id).kind === "agent") ? <Spinner size={12} label="Writing" /> : <span className="kb-ct-dots" aria-hidden><i /><i /><i /></span>}
                  <span>{names(typingNow.map((id) => person(id).name))} {typingNow.length === 1 ? "is" : "are"} writing</span>
                </p>
              ) : null}
            </>
          )}
        </div>
        {!atBottom && !error && all.length ? (
          <button type="button" className="kb-ct-jump" onClick={() => { scrollToEnd(true); setUnseen(0); }}>
            <Icon name="arrowDown" size={14} />
            <span>Jump to latest{unseen ? ` (${unseen} new)` : ""}</span>
          </button>
        ) : null}
      </div>
      {composer}
      <p className="kb-sr" aria-live="polite">{say}</p>
    </section>
  );
}

function MessageSkeleton({ lines, attachment }: { lines: number[]; attachment?: boolean }) {
  return (
    <div className="kb-ct-skel">
      <SkeletonCircle size={34} />
      <div className="kb-ct-skel-body">
        <div className="kb-ct-skel-by">
          <Skeleton width={96} height={11} />
          <Skeleton width={36} height={9} />
        </div>
        {lines.map((w, i) => <Skeleton key={i} width={`${w}%`} height={10} />)}
        {attachment ? <Skeleton width={220} height={52} radius="card" /> : null}
      </div>
    </div>
  );
}
