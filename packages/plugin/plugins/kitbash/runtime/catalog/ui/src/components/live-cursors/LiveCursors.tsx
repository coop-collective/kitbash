"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { EmptyState } from "../empty-state/EmptyState.tsx";
import { ErrorState } from "../error-state/ErrorState.tsx";
import { FreshnessBadge } from "../freshness-badge/FreshnessBadge.tsx";
import { Skeleton, SkeletonRegion, SkeletonText } from "../skeleton/Skeleton.tsx";
import { cx, Icon, useNow, useReducedMotion, type LoadStatus } from "../../shared/index.ts";
import "./live-cursors.css";

export interface CursorParticipant {
  id: string;
  name: string;
  kind: "person" | "agent";
  /** Pointer, flag and selection color. Use a kit-paint series token; agents always draw in cobalt */
  color: string;
}

export interface CursorSelection {
  /** Block id the selection sits in */
  block: string;
  /** The selected text; the first match in the block is highlighted */
  text: string;
}

export interface CursorPosition {
  id: string;
  /** Pointer position as a share of the surface, 0 to 1. Ignored while a selection is set */
  x: number;
  y: number;
  selection?: CursorSelection;
  /** Last pointer or keyboard activity, ms since epoch; cursors fade once this is older than idleAfter */
  lastActiveAt: number;
}

export interface CursorDocBlock {
  id: string;
  kind: "title" | "heading" | "paragraph";
  text: string;
}

export interface LiveCursorsProps {
  participants?: CursorParticipant[];
  blocks?: CursorDocBlock[];
  /** Live positions from your realtime layer (controlled). Omit to run the built-in simulation */
  cursors?: CursorPosition[];
  /** Run the simulation when no cursors are passed */
  autoplay?: boolean;
  /** Milliseconds without activity before a cursor fades */
  idleAfter?: number;
  /** Document name shown in the header */
  title?: string;
  loading?: boolean;
  /** The live connection dropped: cursors hide, the document stays */
  error?: string | null;
  onRetry?: () => void;
  status?: LoadStatus;
  updatedAt?: number | null;
  onRefresh?: () => void;
  /** Action for the empty state, when nobody else is here */
  onInvite?: () => void;
  className?: string;
}

export const defaultCursorParticipants: CursorParticipant[] = [
  { id: "maya", name: "Maya Chen", kind: "person", color: "var(--kb-series-5)" },
  { id: "dev", name: "Dev Patel", kind: "person", color: "var(--kb-series-3)" },
  { id: "priya", name: "Priya Raman", kind: "person", color: "var(--kb-series-6)" },
  { id: "kitbash", name: "Kitbash", kind: "agent", color: "var(--kb-agent)" },
];

export const defaultCursorBlocks: CursorDocBlock[] = [
  { id: "t", kind: "title", text: "Usage-based pricing rollout" },
  {
    id: "p1",
    kind: "paragraph",
    text: "We move every workspace to usage-based pricing on November 12. Teams on the legacy seat plan keep their price for one renewal cycle, then switch to the metered plan with a credit for unused seats.",
  },
  { id: "h1", kind: "heading", text: "Rollout" },
  {
    id: "p2",
    kind: "paragraph",
    text: "Week one opens the new billing page to 10% of workspaces. If refund requests stay under 0.5%, we widen to half, then to everyone by the end of the month.",
  },
  { id: "h2", kind: "heading", text: "Open questions" },
  {
    id: "p3",
    kind: "paragraph",
    text: "Do agent runs count toward the free tier? Finance wants a separate meter; support thinks one number is easier to explain on an invoice.",
  },
];

type Step = { x: number; y: number } | { sel: CursorSelection } | "rest";

/* The simulation: each participant walks a loop of steps, one per tick. "rest" leaves the cursor where it is,
   so a run of rests lets it go idle. */
const SCRIPT: Record<string, Step[]> = {
  maya: [
    { x: 0.32, y: 0.3 },
    { x: 0.55, y: 0.27 },
    { sel: { block: "p1", text: "keep their price for one renewal cycle" } },
    "rest",
    "rest",
    { x: 0.8, y: 0.42 },
    { x: 0.62, y: 0.6 },
    { sel: { block: "p2", text: "10% of workspaces" } },
    "rest",
    { x: 0.4, y: 0.5 },
  ],
  dev: [
    { x: 0.7, y: 0.66 },
    { sel: { block: "p2", text: "under 0.5%" } },
    "rest",
    "rest",
    { x: 0.5, y: 0.72 },
    { x: 0.3, y: 0.62 },
    { x: 0.18, y: 0.66 },
    { sel: { block: "p2", text: "then to everyone by the end of the month" } },
    "rest",
    { x: 0.6, y: 0.58 },
  ],
  priya: [
    { x: 0.86, y: 0.16 },
    { x: 0.9, y: 0.22 },
    "rest",
    "rest",
    "rest",
    "rest",
    "rest",
    "rest",
    { x: 0.72, y: 0.2 },
    { x: 0.82, y: 0.1 },
  ],
  kitbash: [
    { sel: { block: "p3", text: "Do agent runs count toward the free tier?" } },
    "rest",
    "rest",
    { x: 0.62, y: 0.83 },
    { sel: { block: "p3", text: "a separate meter" } },
    "rest",
    "rest",
    { x: 0.45, y: 0.8 },
    { sel: { block: "p3", text: "one number is easier to explain" } },
    "rest",
  ],
};

const TICK = 1100;

function initialCursors(participants: CursorParticipant[], at: number): CursorPosition[] {
  return participants.map((p, i) => ({ id: p.id, x: 0.2 + i * 0.18, y: 0.35 + (i % 2) * 0.3, lastActiveAt: at }));
}

/** Advance the simulation one tick. Pure, so reduced motion and tests can call it directly. */
function stepCursors(prev: CursorPosition[], tick: number, at: number): CursorPosition[] {
  return prev.map((c) => {
    const script = SCRIPT[c.id];
    if (!script) return c;
    const step = script[tick % script.length];
    if (!step || step === "rest") return c;
    if ("sel" in step) return { ...c, selection: step.sel, lastActiveAt: at };
    return { ...c, x: step.x, y: step.y, selection: undefined, lastActiveAt: at };
  });
}

type Spot = { x: number; y: number; h: number };

/**
 * People working on one surface together: each pointer carries a name flag in its owner's paint, text they select
 * is washed in that paint with a caret at the end, cursors glide between updates, and anyone who stops moving fades
 * back to a ghost until they move again. The legend underneath is the keyboard path: it says where everyone is and
 * pings their cursor.
 */
export function LiveCursors({
  participants = defaultCursorParticipants,
  blocks = defaultCursorBlocks,
  cursors: cursorsProp,
  autoplay = true,
  idleAfter = 6000,
  title = "Usage-based pricing rollout",
  loading = false,
  error,
  onRetry,
  status,
  updatedAt,
  onRefresh,
  onInvite,
  className,
}: LiveCursorsProps) {
  const reduced = useReducedMotion();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [anchors, setAnchors] = useState<Record<string, Spot>>({});
  const [sim, setSim] = useState<CursorPosition[] | null>(null);
  const [ping, setPing] = useState<string | null>(null);
  const tick = useRef(0);
  const clock = useNow(1000);

  const simulate = cursorsProp === undefined;
  const cursors = cursorsProp ?? sim ?? [];
  const failed = Boolean(error);

  // Start the simulation on the client; reduced motion still updates positions, it just jumps between them
  useEffect(() => {
    if (!simulate) return;
    const start = Date.now();
    setSim(stepCursors(initialCursors(participants, start), 0, start));
    if (!autoplay) return;
    const id = window.setInterval(() => {
      tick.current += 1;
      const at = Date.now();
      setSim((prev) => stepCursors(prev ?? initialCursors(participants, at), tick.current, at));
    }, TICK);
    return () => window.clearInterval(id);
    // Restart only when who is simulated changes, not when a caller passes a new array with the same people
  }, [simulate, autoplay, participants.map((p) => p.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track the surface size so share-of-surface positions become pixels
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  // Selections pin the cursor to the end of the selected text: measure each end mark after layout
  useLayoutEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const next: Record<string, Spot> = {};
    el.querySelectorAll<HTMLElement>("[data-end]").forEach((mark) => {
      const r = mark.getBoundingClientRect();
      const id = mark.dataset.end;
      if (id) next[id] = { x: Math.round(r.left - box.left), y: Math.round(r.top - box.top), h: Math.round(r.height) };
    });
    setAnchors((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  });

  useEffect(() => {
    if (!ping) return;
    const id = window.setTimeout(() => setPing(null), 1400);
    return () => window.clearTimeout(id);
  }, [ping]);

  if (loading) {
    return (
      <section className={cx("kb-lc", className)} aria-label={`${title}, loading`}>
        <SkeletonRegion label="Loading the document and who is in it">
          <div className="kb-lc-bar"><Skeleton width={220} height={14} /></div>
          <div className="kb-lc-surface kb-lc-skel">
            <Skeleton width="58%" height={22} />
            <SkeletonText lines={3} />
            <Skeleton width={90} height={14} />
            <SkeletonText lines={2} lastWidth="40%" />
            <Skeleton width={130} height={14} />
            <SkeletonText lines={2} lastWidth="74%" />
          </div>
          <div className="kb-lc-legend">
            {[120, 104, 132].map((w) => <Skeleton key={w} width={w} height={28} radius="control" />)}
          </div>
        </SkeletonRegion>
      </section>
    );
  }

  const byId = new Map(participants.map((p) => [p.id, p]));
  const now = clock ?? 0;
  const isIdle = (c: CursorPosition) => clock !== null && now - c.lastActiveAt > idleAfter;
  const live = failed ? [] : cursors.filter((c) => byId.has(c.id));

  // Selections per block, in paint order
  const selections = live.filter((c) => c.selection);
  const renderBlock = (b: CursorDocBlock): ReactNode => {
    const mine = selections
      .map((c) => {
        const s = c.selection as CursorSelection;
        if (s.block !== b.id) return null;
        const from = b.text.indexOf(s.text);
        return from < 0 ? null : { id: c.id, from, to: from + s.text.length, idle: isIdle(c) };
      })
      .filter((s): s is { id: string; from: number; to: number; idle: boolean } => s !== null);
    if (!mine.length) return b.text;
    const cuts = [...new Set([0, b.text.length, ...mine.flatMap((s) => [s.from, s.to])])].sort((a, z) => a - z);
    const out: ReactNode[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const from = cuts[i] as number;
      const to = cuts[i + 1] as number;
      const text = b.text.slice(from, to);
      const owner = [...mine].reverse().find((s) => s.from <= from && s.to >= to);
      const p = owner ? byId.get(owner.id) : undefined;
      out.push(
        owner && p ? (
          <mark key={from} className="kb-lc-sel" data-idle={owner.idle || undefined} style={{ "--c": p.color } as CSSProperties}>{text}</mark>
        ) : (
          <span key={from}>{text}</span>
        ),
      );
      for (const s of mine) if (s.to === to) out.push(<span key={`end-${s.id}`} className="kb-lc-end" data-end={s.id} aria-hidden />);
    }
    return out;
  };

  const where = (c: CursorPosition | undefined): string => {
    if (!c) return "Connecting";
    if (isIdle(c)) return "Idle";
    if (c.selection) return `Selecting “${c.selection.text}”`;
    return "Moving around";
  };

  const others = participants.length;

  return (
    <section className={cx("kb-lc", className)} aria-label={title} data-reduced={reduced || undefined}>
      <header className="kb-lc-bar">
        <Icon name="file" size={15} />
        <h3>{title}</h3>
        <span className="kb-lc-count">{failed ? "Offline" : others === 0 ? "Only you" : `${others + 1} editing`}</span>
      </header>

      <div className="kb-lc-surface" ref={surfaceRef}>
        {blocks.map((b) =>
          b.kind === "title" ? (
            <h4 key={b.id} className="kb-lc-title">{renderBlock(b)}</h4>
          ) : b.kind === "heading" ? (
            <h5 key={b.id} className="kb-lc-h">{renderBlock(b)}</h5>
          ) : (
            <p key={b.id}>{renderBlock(b)}</p>
          ),
        )}

        {size
          ? live.map((c) => {
              const p = byId.get(c.id);
              if (!p) return null;
              const spot = c.selection ? anchors[c.id] : undefined;
              const x = spot ? spot.x : c.x * size.w;
              const y = spot ? spot.y : c.y * size.h;
              return (
                <span
                  key={c.id}
                  className="kb-lc-cursor"
                  data-kind={p.kind}
                  data-mode={spot ? "caret" : "pointer"}
                  data-idle={isIdle(c) || undefined}
                  data-ping={ping === c.id || undefined}
                  style={{ "--c": p.color, "--h": `${spot?.h ?? 18}px`, transform: `translate(${x}px, ${y}px)` } as CSSProperties}
                  aria-hidden
                >
                  {spot ? (
                    <i className="kb-lc-caret" />
                  ) : (
                    <svg className="kb-lc-pointer" width="16" height="20" viewBox="0 0 16 20">
                      <path d="M1.5 1.5v15.2l4.1-3.9 2.6 5.7 2.6-1.2-2.6-5.6h5.6z" />
                    </svg>
                  )}
                  <span className="kb-lc-flag">
                    {p.kind === "agent" ? <Icon name="sparkle" size={12} strokeWidth={2.2} /> : null}
                    {p.name.split(" ")[0]}
                  </span>
                </span>
              );
            })
          : null}
      </div>

      <footer className="kb-lc-legend">
        {failed ? (
          <ErrorState size="sm" title="Live cursors paused" body={error ?? ""} detail="" onRetry={onRetry ?? (() => {})} />
        ) : others === 0 ? (
          <EmptyState
            size="sm"
            title="Only you are here"
            body="Share the page and you will see others' cursors as they work."
            action={{ label: "Copy invite link", icon: "link", onClick: () => onInvite?.() }}
          />
        ) : (
          <ul aria-label="Who is in this document">
            {participants.map((p) => {
              const c = live.find((k) => k.id === p.id);
              const text = where(c);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className="kb-lc-who"
                    data-idle={(c && isIdle(c)) || undefined}
                    style={{ "--c": p.color } as CSSProperties}
                    onClick={() => setPing(p.id)}
                    aria-label={`${p.name}${p.kind === "agent" ? ", agent" : ""}: ${text}. Show their cursor`}
                  >
                    <i className="kb-lc-swatch" data-kind={p.kind} aria-hidden>{p.kind === "agent" ? <Icon name="sparkle" size={11} strokeWidth={2.4} /> : null}</i>
                    <strong>{p.name.split(" ")[0]}</strong>
                    <span>{text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {status ? <FreshnessBadge className="kb-lc-fresh" status={status} updatedAt={updatedAt ?? null} onRefresh={onRefresh} /> : null}
      </footer>
    </section>
  );
}
