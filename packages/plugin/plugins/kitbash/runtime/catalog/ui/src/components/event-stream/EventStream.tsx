"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../button/Button.tsx";
import { EmptyState, type EmptyStateProps } from "../empty-state/EmptyState.tsx";
import { ErrorState } from "../error-state/ErrorState.tsx";
import { FreshnessBadge } from "../freshness-badge/FreshnessBadge.tsx";
import { Skeleton, SkeletonCircle, SkeletonRegion } from "../skeleton/Skeleton.tsx";
import { Avatar, Icon, Tag, clockTime, cx, useInterval, useNow, useReducedMotion, type LoadStatus } from "../../shared/index.ts";
import "./event-stream.css";

export type EventValue = string | number | boolean | null;

export interface ProductEvent {
  id: string;
  /** When it happened, ms since epoch */
  at: number;
  /** Who did it */
  user: string;
  /** Their workspace */
  org?: string;
  /** Event name, snake_case as sent */
  event: string;
  properties: Record<string, EventValue>;
}

export interface EventStreamProps {
  /** Newest first. With `autoplay`, the demo generator adds to these on a timer */
  events?: ProductEvent[];
  /** Stream made-up events every so often, for demos */
  autoplay?: boolean;
  /** Milliseconds between demo events */
  interval?: number;
  /** Paused: new events queue behind a key instead of moving the list. Omit to let the stream keep its own */
  paused?: boolean;
  defaultPaused?: boolean;
  onPausedChange?: (paused: boolean) => void;
  /** Event name to show, or "" for all */
  filter?: string;
  defaultFilter?: string;
  onFilterChange?: (event: string) => void;
  /** Event ids open at first */
  defaultExpanded?: string[];
  /** Most rows kept on screen */
  maxRows?: number;
  title?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Technical detail under the error, e.g. a status and request id */
  errorDetail?: string;
  status?: LoadStatus;
  updatedAt?: number | null;
  onRefresh?: () => void;
  emptyAction?: EmptyStateProps["action"];
  className?: string;
}

const PEOPLE: Array<[string, string]> = [
  ["Priya Raman", "Lattice Freight"],
  ["Tomás Ibarra", "Northwind Labs"],
  ["Hana Okafor", "Quarry Health"],
  ["Jonas Weber", "Brightline"],
  ["Mei Tanaka", "Sable & Co"],
  ["Dev Patel", "Outpost Robotics"],
  ["Ana Souza", "Tidepool"],
];

const AGENTS = ["triage-bot", "refund-agent", "release-notes", "pr-reviewer"];

/** The n-th made-up event: deterministic, so stories and server renders agree. */
export function demoEvent(n: number, at: number): ProductEvent {
  const [user, org] = PEOPLE[(n * 3) % PEOPLE.length] ?? ["Priya Raman", "Lattice Freight"];
  const agent = AGENTS[n % AGENTS.length] ?? "triage-bot";
  const kinds: Array<Pick<ProductEvent, "event" | "properties">> = [
    { event: "run_started", properties: { agent, trigger: n % 2 ? "slack" : "schedule", repo: "acme/web", run_id: `run_${(4810 + n * 37).toString(36)}` } },
    { event: "tool_called", properties: { agent, tool: n % 2 ? "github.create_pr" : "linear.update_issue", latency_ms: 300 + ((n * 211) % 1400), ok: true } },
    { event: "run_finished", properties: { agent, status: n % 7 === 3 ? "failed" : "ok", duration_ms: 18000 + ((n * 7919) % 52000), tokens: 9000 + ((n * 431) % 21000), cost_usd: Math.round((0.08 + ((n * 13) % 40) / 100) * 100) / 100 } },
    { event: "approval_requested", properties: { agent: "refund-agent", amount_usd: 40 + ((n * 61) % 400), customer: `cus_${(9120 + n * 17).toString(36)}` } },
    { event: "page_viewed", properties: { path: n % 2 ? "/settings/billing" : "/agents/triage-bot/runs", referrer: n % 3 ? "app" : "email" } },
    { event: "seat_added", properties: { plan: "team", seats: 3 + (n % 9), by: "admin" } },
    { event: "signup_completed", properties: { plan: "free", source: n % 2 ? "docs" : "github", invited: n % 3 === 0 } },
  ];
  const kind = kinds[(n * 5 + Math.floor(n / 3)) % kinds.length] ?? kinds[0]!;
  return { id: `evt_${n}`, at, user, org, ...kind };
}

const BASE = Date.now();
export const demoEvents: ProductEvent[] = Array.from({ length: 14 }, (_, i) => demoEvent(13 - i, BASE - i * 9_000 - ((i * 37) % 7) * 1000));

function ago(at: number, now: number | null): string {
  if (now === null) return clockTime(at);
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return clockTime(at);
}

function show(v: EventValue): string {
  if (v === null) return "null";
  if (typeof v === "string") return v;
  return String(v);
}

function preview(props: Record<string, EventValue>): string {
  return Object.entries(props)
    .map(([k, v]) => `${k}=${show(v)}`)
    .join("  ");
}

/**
 * A live feed of product events, read like a serial monitor: time, who, the event name in mono, and its properties
 * on one line. New events slide in at the top. Pause and the list holds still while new events queue behind a
 * "12 new" key; press it to let them in. Filter by event name, and open a row to read its properties as key/value.
 */
export function EventStream({
  events = demoEvents,
  autoplay = true,
  interval = 1800,
  paused,
  defaultPaused = false,
  onPausedChange,
  filter,
  defaultFilter = "",
  onFilterChange,
  defaultExpanded = [],
  maxRows = 40,
  title = "Live events",
  loading = false,
  error = null,
  onRetry,
  errorDetail = "",
  status,
  updatedAt = null,
  onRefresh,
  emptyAction = { label: "Copy install snippet", icon: "copy", onClick: () => {} },
  className,
}: EventStreamProps) {
  const uid = useId();
  const reduced = useReducedMotion();
  const now = useNow(1000);
  const [stream, setStream] = useState(events);
  const counter = useRef(events.length);
  const [innerPaused, setInnerPaused] = useState(defaultPaused);
  const isPaused = paused ?? innerPaused;
  const [innerFilter, setInnerFilter] = useState(defaultFilter);
  const current = filter ?? innerFilter;
  const [open, setOpen] = useState<Set<string>>(() => new Set(defaultExpanded));
  // Ids on screen when paused; anything newer waits in the queue
  const [held, setHeld] = useState<Set<string> | null>(() => (defaultPaused || paused ? new Set(events.map((e) => e.id)) : null));
  // Rows that arrived after the first paint, so only they animate in
  const seen = useRef<Set<string> | null>(null);

  const source = autoplay ? stream : events;

  useInterval(
    () => {
      const n = counter.current++;
      setStream((s) => [demoEvent(n, Date.now()), ...s].slice(0, Math.max(maxRows * 2, 80)));
    },
    autoplay && !loading && !error ? interval : null,
  );

  // Follow a controlled `paused` prop
  useEffect(() => {
    if (paused === undefined) return;
    setHeld((h) => (paused ? (h ?? new Set(source.map((e) => e.id))) : null));
    // source is read once at the moment of pausing
  }, [paused]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (seen.current === null) seen.current = new Set(source.map((e) => e.id));
    else source.forEach((e) => seen.current?.add(e.id));
  });

  const setPaused = (next: boolean) => {
    if (paused === undefined) {
      setInnerPaused(next);
      setHeld(next ? new Set(source.map((e) => e.id)) : null);
    }
    onPausedChange?.(next);
  };
  const setFilter = (next: string) => {
    if (filter === undefined) setInnerFilter(next);
    onFilterChange?.(next);
  };
  const letIn = () => setHeld(new Set(source.map((e) => e.id)));
  const toggle = (id: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const matches = (e: ProductEvent) => !current || e.event === current;
  const visible = (isPaused && held ? source.filter((e) => held.has(e.id)) : source).filter(matches).slice(0, maxRows);
  const queued = isPaused && held ? source.filter((e) => !held.has(e.id) && matches(e)).length : 0;
  const names = Array.from(new Set([...source.map((e) => e.event), ...(current ? [current] : [])])).sort();
  const counts = new Map<string, number>();
  source.forEach((e) => counts.set(e.event, (counts.get(e.event) ?? 0) + 1));

  let body;
  if (loading) {
    body = (
      <SkeletonRegion label="Loading events">
        <ol className="kb-es-list" aria-hidden>
          {Array.from({ length: 12 }, (_, i) => (
            <li key={i} className="kb-es-row kb-es-skel">
              <span />
              <Skeleton width={28} height={10} />
              <span className="kb-es-who"><SkeletonCircle size={22} /><Skeleton width={`${60 + ((i * 23) % 30)}%`} height={10} /></span>
              <Skeleton width={`${55 + ((i * 31) % 40)}%`} height={10} />
              <Skeleton width={`${40 + ((i * 17) % 50)}%`} height={10} />
            </li>
          ))}
        </ol>
      </SkeletonRegion>
    );
  } else if (error) {
    body = <ErrorState className="kb-es-state" title="The event stream disconnected" body={error} detail={errorDetail} onRetry={onRetry} />;
  } else if (source.length === 0) {
    body = <EmptyState className="kb-es-state" title="No events yet" body="Events show up here a second after your app sends them." action={emptyAction} />;
  } else if (visible.length === 0) {
    body = (
      <EmptyState
        className="kb-es-state"
        size="sm"
        title={`No ${current} events yet`}
        body={queued ? `${queued} waiting while paused.` : "They show up here as soon as one arrives."}
        action={{ label: "Show all events", icon: "filter", onClick: () => setFilter("") }}
      />
    );
  } else {
    body = (
      <ol className="kb-es-list" aria-label={current ? `${current} events, newest first` : "Events, newest first"}>
        {visible.map((e) => {
          const isOpen = open.has(e.id);
          const fresh = seen.current !== null && !seen.current.has(e.id) && !reduced;
          const panel = `${uid}-${e.id}`;
          return (
            <li key={e.id} className="kb-es-item" data-new={fresh || undefined} data-open={isOpen || undefined}>
              <button type="button" className="kb-es-row" aria-expanded={isOpen} aria-controls={panel} onClick={() => toggle(e.id)}>
                <Icon name="chevronRight" size={14} className="kb-es-chev" />
                <time className="kb-es-time" dateTime={new Date(e.at).toISOString()} title={clockTime(e.at)}>{ago(e.at, now)}</time>
                <span className="kb-es-who">
                  <Avatar name={e.user} size={22} />
                  <span>{e.user}</span>
                </span>
                <code className="kb-es-name">{e.event}</code>
                <span className="kb-es-props">{preview(e.properties)}</span>
              </button>
              {isOpen ? (
                <div id={panel} className="kb-es-detail">
                  <dl>
                    <div><dt>user</dt><dd className="kb-es-plain">{e.user}{e.org ? <span>{e.org}</span> : null}</dd></div>
                    <div><dt>time</dt><dd>{new Date(e.at).toISOString().replace("T", " ").slice(0, 19)} UTC</dd></div>
                    {Object.entries(e.properties).map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd data-type={v === null ? "null" : typeof v}>{show(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <section className={cx("kb-es", className)} aria-label={title} aria-busy={loading || undefined}>
      <header className="kb-es-head">
        <h3>{title}</h3>
        {loading || error ? null : isPaused ? <Tag tone="neutral">Paused</Tag> : <Tag tone="ok" live={!reduced}>Streaming</Tag>}
        <span className="kb-es-spacer" />
        {status ? <FreshnessBadge status={status} updatedAt={updatedAt} onRefresh={onRefresh} /> : null}
        <label className="kb-es-filter">
          <span className="kb-sr">Event name</span>
          <select value={current} onChange={(e) => setFilter(e.target.value)} disabled={loading}>
            <option value="">All events</option>
            {names.map((n) => (
              <option key={n} value={n}>{n} ({counts.get(n) ?? 0})</option>
            ))}
          </select>
        </label>
        {queued > 0 ? (
          <Button size="sm" className="kb-es-queue" onClick={letIn} aria-label={`Show ${queued} new ${queued === 1 ? "event" : "events"}`}>
            {queued} new
          </Button>
        ) : null}
        <Button size="sm" icon={isPaused ? "play" : "pause"} onClick={() => setPaused(!isPaused)} disabled={loading || Boolean(error)}>
          {isPaused ? "Resume" : "Pause"}
        </Button>
      </header>
      {body}
    </section>
  );
}
