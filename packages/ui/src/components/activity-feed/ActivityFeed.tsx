"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../button/Button.tsx";
import { EmptyState } from "../empty-state/EmptyState.tsx";
import { ErrorState } from "../error-state/ErrorState.tsx";
import { FreshnessBadge } from "../freshness-badge/FreshnessBadge.tsx";
import { MemberAvatar } from "../presence-stack/PresenceStack.tsx";
import { Skeleton, SkeletonCircle, SkeletonRegion } from "../skeleton/Skeleton.tsx";
import { clockTime, cx, relativeTime, Tag, useNow, useReducedMotion, type LoadStatus } from "../../shared/index.ts";
import "./activity-feed.css";

export type ActivityVerb = "edited" | "commented" | "approved" | "joined" | "ran" | "requested";

export interface ActivityActor {
  id: string;
  name: string;
  kind: "person" | "agent";
  src?: string;
}

export interface ActivityItem {
  id: string;
  actor: ActivityActor;
  verb: ActivityVerb;
  /** What it happened to, linked */
  object: { label: string; href: string };
  /** When, ms since epoch */
  at: number;
  /** A comment excerpt or an edit summary */
  detail?: string;
  /** How an agent run ended (or that it is still going) */
  outcome?: { state: "ok" | "failed" | "running"; text: string };
}

export interface ActivityFeedProps {
  /** Newest first or in any order; the feed sorts. Omit to run the demo with live arrivals */
  items?: ActivityItem[];
  /** Ask for the next page of older items. Without it the demo appends its own */
  onLoadOlder?: () => void;
  /** Older items are on their way: skeleton rows show where they will land */
  loadingOlder?: boolean;
  /** Whether there is anything older to load */
  hasOlder?: boolean;
  /** Demo only: new items arrive on a timer */
  autoplay?: boolean;
  /** Consecutive items by one actor within this many ms hang from one avatar */
  groupWithin?: number;
  title?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  status?: LoadStatus;
  updatedAt?: number | null;
  onRefresh?: () => void;
  /** Action for the empty state */
  onInvite?: () => void;
  className?: string;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const base = Date.now();

const maya: ActivityActor = { id: "maya", name: "Maya Chen", kind: "person" };
const dev: ActivityActor = { id: "dev", name: "Dev Patel", kind: "person" };
const priya: ActivityActor = { id: "priya", name: "Priya Raman", kind: "person" };
const jonas: ActivityActor = { id: "jonas", name: "Jonas Berg", kind: "person" };
const kitbash: ActivityActor = { id: "kitbash", name: "Kitbash", kind: "agent" };
const reviewer: ActivityActor = { id: "reviewer", name: "Review agent", kind: "agent" };

const doc = (label: string) => ({ label, href: `#${label.toLowerCase().replace(/\W+/g, "-")}` });

export const defaultActivity: ActivityItem[] = [
  { id: "a1", actor: kitbash, verb: "ran", object: doc("Weekly churn report"), at: base - 3 * MIN, outcome: { state: "ok", text: "Finished in 42s" } },
  {
    id: "a2",
    actor: maya,
    verb: "commented",
    object: doc("Pricing table"),
    at: base - 12 * MIN,
    detail: "Can we show the annual price first? Most teams on Growth pay yearly.",
  },
  { id: "a3", actor: maya, verb: "edited", object: doc("Pricing table"), at: base - 15 * MIN, detail: "Changed 3 rows in the Growth tier" },
  { id: "a4", actor: maya, verb: "approved", object: doc("Refund policy v4"), at: base - 21 * MIN },
  { id: "a5", actor: dev, verb: "joined", object: doc("Launch plan"), at: base - 48 * MIN },
  {
    id: "a6",
    actor: reviewer,
    verb: "ran",
    object: doc("Link check on Rollout plan"),
    at: base - 70 * MIN,
    outcome: { state: "failed", text: "2 links broken" },
  },
  { id: "a7", actor: priya, verb: "edited", object: doc("Rollout plan"), at: base - 2 * HOUR, detail: "Moved week two to November 19" },
  { id: "a8", actor: priya, verb: "requested", object: doc("Rollout plan"), at: base - 26 * HOUR },
  { id: "a9", actor: kitbash, verb: "ran", object: doc("Import from Linear"), at: base - 27 * HOUR, outcome: { state: "ok", text: "Imported 38 issues" } },
  {
    id: "a10",
    actor: jonas,
    verb: "commented",
    object: doc("Open questions"),
    at: base - 29 * HOUR,
    detail: "Finance wants the agent meter split out. I'll bring numbers on Thursday.",
  },
  { id: "a11", actor: jonas, verb: "edited", object: doc("Open questions"), at: base - 29.2 * HOUR },
];

/** Older pages the demo loads */
export const olderActivity: ActivityItem[] = [
  { id: "o1", actor: maya, verb: "edited", object: doc("Launch plan"), at: base - 50 * HOUR, detail: "Added the pricing section" },
  { id: "o2", actor: dev, verb: "approved", object: doc("Billing page copy"), at: base - 52 * HOUR },
  { id: "o3", actor: kitbash, verb: "ran", object: doc("Competitor price scan"), at: base - 53 * HOUR, outcome: { state: "ok", text: "Found 6 changes" } },
  { id: "o4", actor: priya, verb: "joined", object: doc("Launch plan"), at: base - 74 * HOUR },
];

/** What arrives while the demo runs */
export const incomingActivity: Array<Omit<ActivityItem, "at">> = [
  { id: "n1", actor: dev, verb: "commented", object: doc("Rollout plan"), detail: "10% feels small for week one. Can we start at 20?" },
  { id: "n2", actor: kitbash, verb: "ran", object: doc("Draft launch FAQ"), outcome: { state: "ok", text: "Finished in 1m 12s" } },
  { id: "n3", actor: maya, verb: "approved", object: doc("Pricing table") },
];

const PHRASE: Record<ActivityVerb, string> = {
  edited: "edited",
  commented: "commented on",
  approved: "approved",
  joined: "joined",
  ran: "ran",
  requested: "asked for a review of",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(at: number, now: number | null): string {
  const date = new Date(at);
  if (now !== null) {
    if (dayKey(at) === dayKey(now)) return "Today";
    if (dayKey(at) === dayKey(now - 24 * HOUR)) return "Yesterday";
  }
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

interface Run {
  actor: ActivityActor;
  items: ActivityItem[];
}

/** Split a newest-first list into days, and each day into runs of one actor. */
export function groupActivity(items: ActivityItem[], groupWithin = 45 * MIN): Array<{ key: string; at: number; runs: Run[] }> {
  const sorted = [...items].sort((a, b) => b.at - a.at);
  const days: Array<{ key: string; at: number; runs: Run[] }> = [];
  for (const item of sorted) {
    const key = dayKey(item.at);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, at: item.at, runs: [] };
      days.push(day);
    }
    const run = day.runs[day.runs.length - 1];
    const prev = run?.items[run.items.length - 1];
    if (run && prev && run.actor.id === item.actor.id && prev.at - item.at <= groupWithin) run.items.push(item);
    else day.runs.push({ actor: item.actor, items: [item] });
  }
  return days;
}

const OUTCOME_TONE = { ok: "ok", failed: "danger", running: "agent" } as const;

function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="kb-af-skel">
          <SkeletonCircle size={28} />
          <div>
            <Skeleton width={`${58 - (i % 3) * 9}%`} height={11} />
            <Skeleton width={`${34 + (i % 2) * 18}%`} height={9} style={{ marginTop: 8 }} />
          </div>
          <Skeleton width={44} height={9} />
        </div>
      ))}
    </>
  );
}

/**
 * What happened, recently, and who did it. Days are split by seams; consecutive actions by one person or agent
 * hang from a single avatar on a runner, like parts on a sprue. Every object links out, times stay relative,
 * new items slot in at the top, and loading older activity draws skeleton rows where the items will land.
 */
export function ActivityFeed({
  items: itemsProp,
  onLoadOlder,
  loadingOlder: loadingOlderProp,
  hasOlder: hasOlderProp,
  autoplay = true,
  groupWithin = 45 * MIN,
  title = "Activity",
  loading = false,
  error,
  onRetry,
  status,
  updatedAt,
  onRefresh,
  onInvite,
  className,
}: ActivityFeedProps) {
  const demo = itemsProp === undefined;
  const reduced = useReducedMotion();
  const now = useNow(30_000);
  const [ownItems, setOwnItems] = useState<ActivityItem[]>(defaultActivity);
  const [ownLoadingOlder, setOwnLoadingOlder] = useState(false);
  const [ownHasOlder, setOwnHasOlder] = useState(true);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [say, setSay] = useState("");
  const timers = useRef<number[]>([]);
  const seen = useRef<Set<string> | null>(null);

  const items = itemsProp ?? ownItems;
  const loadingOlder = loadingOlderProp ?? ownLoadingOlder;
  const hasOlder = hasOlderProp ?? (demo ? ownHasOlder : Boolean(onLoadOlder));

  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  // Demo: new activity arrives every few seconds
  useEffect(() => {
    if (!demo || !autoplay) return;
    let i = 0;
    const id = window.setInterval(() => {
      const next = incomingActivity[i];
      if (!next) {
        window.clearInterval(id);
        return;
      }
      i++;
      setOwnItems((list) => [{ ...next, at: Date.now() } as ActivityItem, ...list]);
    }, 5200);
    return () => window.clearInterval(id);
  }, [demo, autoplay]);

  // Anything not seen before arrived live: mark it so it slots in, and say it once
  useEffect(() => {
    const ids = new Set(items.map((it) => it.id));
    if (seen.current === null) {
      seen.current = ids;
      return;
    }
    // Only items newer than everything already shown count as arrivals; an older page loading is not news
    const before = seen.current;
    const latest = Math.max(0, ...items.filter((it) => before.has(it.id)).map((it) => it.at));
    const arrived = items.filter((it) => !before.has(it.id) && it.at > latest).sort((a, b) => b.at - a.at);
    seen.current = ids;
    if (!arrived.length) return;
    const top = arrived[0];
    if (top) setSay(`${top.actor.name} ${PHRASE[top.verb]} ${top.object.label}`);
    setFresh((f) => new Set([...f, ...arrived.map((a) => a.id)]));
    const t = window.setTimeout(() => setFresh(new Set()), 1600);
    timers.current.push(t);
  }, [items]);

  const loadOlder = () => {
    if (onLoadOlder) {
      onLoadOlder();
      return;
    }
    setOwnLoadingOlder(true);
    timers.current.push(
      window.setTimeout(
        () => {
          setOwnItems((list) => [...list, ...olderActivity.filter((o) => !list.some((it) => it.id === o.id))]);
          setOwnLoadingOlder(false);
          setOwnHasOlder(false);
        },
        reduced ? 600 : 1400,
      ),
    );
  };

  const head = (
    <header className="kb-af-head">
      <h3>{title}</h3>
      {status ? <FreshnessBadge status={status} updatedAt={updatedAt ?? null} onRefresh={onRefresh} /> : null}
    </header>
  );

  if (loading) {
    return (
      <section className={cx("kb-af", className)} aria-label={title}>
        {head}
        <SkeletonRegion label="Loading activity" className="kb-af-body">
          <div className="kb-af-day-label">
            <Skeleton width={56} height={10} />
          </div>
          <SkeletonRows count={5} />
        </SkeletonRegion>
      </section>
    );
  }

  if (error) {
    return (
      <section className={cx("kb-af", className)} aria-label={title}>
        {head}
        <ErrorState title="Couldn't load activity" body={error} detail="" onRetry={onRetry ?? (() => {})} />
      </section>
    );
  }

  if (!items.length) {
    return (
      <section className={cx("kb-af", className)} aria-label={title}>
        {head}
        <div className="kb-af-empty">
          <EmptyState
            title="No activity yet"
            body="Edits, comments, approvals and agent runs in this workspace show up here as they happen."
            action={{ label: "Invite your team", icon: "users", onClick: () => onInvite?.() }}
          />
        </div>
      </section>
    );
  }

  const days = groupActivity(items, groupWithin);

  return (
    <section className={cx("kb-af", className)} aria-label={title}>
      {head}
      <div className="kb-af-body">
        {days.map((day) => (
          <section key={day.key} className="kb-af-day" aria-label={dayLabel(day.at, now)}>
            <h4 className="kb-af-day-label">{dayLabel(day.at, now)}</h4>
            <ol className="kb-af-runs">
              {day.runs.map((run) => (
                <li key={run.items[0]?.id} className="kb-af-run" data-many={run.items.length > 1 || undefined}>
                  <span className="kb-af-face">
                    <MemberAvatar name={run.actor.name} kind={run.actor.kind} src={run.actor.src} size={28} />
                  </span>
                  <ol className="kb-af-items">
                    {run.items.map((it, i) => (
                      <li key={it.id} className="kb-af-item" data-new={fresh.has(it.id) || undefined}>
                        <p className="kb-af-line">
                          {i === 0 ? <strong className="kb-af-who">{run.actor.name}</strong> : null}
                          <span>{i === 0 ? ` ${PHRASE[it.verb]} ` : `${cap(PHRASE[it.verb])} `}</span>
                          <a className="kb-af-obj" href={it.object.href}>
                            {it.object.label}
                          </a>
                        </p>
                        <time className="kb-af-time" dateTime={new Date(it.at).toISOString()} title={clockTime(it.at)}>
                          {now ? relativeTime(it.at, now) : clockTime(it.at)}
                        </time>
                        {it.detail ? <p className={cx("kb-af-detail", it.verb === "commented" && "kb-af-quote")}>{it.detail}</p> : null}
                        {it.outcome ? (
                          <span className="kb-af-outcome">
                            <Tag tone={OUTCOME_TONE[it.outcome.state]} live={it.outcome.state === "running"}>
                              {it.outcome.text}
                            </Tag>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
          </section>
        ))}

        {loadingOlder ? (
          <SkeletonRegion label="Loading older activity" className="kb-af-older-skel">
            <SkeletonRows count={3} />
          </SkeletonRegion>
        ) : null}
      </div>

      {loadingOlder ? null : (
        <footer className="kb-af-foot">
          {hasOlder ? (
            <Button size="sm" icon="clock" onClick={loadOlder}>
              Load older activity
            </Button>
          ) : (
            <span>That's everything in the last 30 days</span>
          )}
        </footer>
      )}
      <p className="kb-sr" aria-live="polite">
        {say}
      </p>
    </section>
  );
}
