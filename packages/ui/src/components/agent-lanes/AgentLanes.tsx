import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "../button/Button.tsx";
import { cx, Icon, Tag, useInterval, useReducedMotion } from "../../shared/index.ts";
import "./agent-lanes.css";

export interface LaneAgent {
  id: string;
  name: string;
  role: string;
}

export interface AgentLanesProps {
  /** Run the clock on mount */
  autoplay?: boolean;
  /** Simulated second the clock starts at, so the first frame already shows work in flight */
  startAt?: number;
  /** Simulated seconds per real second */
  speed?: number;
  /** Seconds the approval waits before the demo approves itself; null waits for a person */
  approveAfter?: number | null;
  /** Called when a person approves the merge from the block */
  onApprove?: () => void;
  className?: string;
}

export const laneAgents: LaneAgent[] = [
  { id: "planner", name: "Planner", role: "Orchestrator" },
  { id: "research", name: "Researcher", role: "Docs and APIs" },
  { id: "coder", name: "Coder", role: "Writes patches" },
  { id: "tester", name: "Tester", role: "Runs e2e" },
  { id: "review", name: "Reviewer", role: "Review and release" },
];

interface Block {
  id: string;
  lane: string;
  label: string;
  start: number;
  end: number;
  /** Block that handed this one its work */
  from?: string;
  approval?: boolean;
  /** Finished with a failure that sent work back */
  failed?: boolean;
}

const APPROVAL_AT = 86;
const DEPLOY_FOR = 12;

/** The run, in simulated seconds. The tail depends on when a person approves the merge. */
function buildRun(approvedAt: number | null): Block[] {
  const run: Block[] = [
    { id: "plan", lane: "planner", label: "Plan", start: 0, end: 8 },
    { id: "docs", lane: "research", label: "Read docs", start: 8, end: 26, from: "plan" },
    { id: "patch", lane: "coder", label: "Patch retry loop", start: 8, end: 40, from: "plan" },
    { id: "tests", lane: "tester", label: "Write tests", start: 12, end: 38, from: "plan" },
    { id: "libs", lane: "research", label: "Compare libs", start: 26, end: 46 },
    { id: "e2e", lane: "tester", label: "Run e2e", start: 40, end: 56, from: "patch", failed: true },
    { id: "pr", lane: "review", label: "Review diff", start: 43, end: 61, from: "patch" },
    { id: "fix", lane: "coder", label: "Fix flake", start: 56, end: 70, from: "e2e" },
    { id: "rerun", lane: "tester", label: "Re-run e2e", start: 70, end: 86, from: "fix" },
    { id: "merge", lane: "review", label: "Merge to main", start: APPROVAL_AT, end: approvedAt ?? Infinity, from: "rerun", approval: true },
  ];
  if (approvedAt !== null) {
    run.push({ id: "deploy", lane: "review", label: "Deploy", start: approvedAt, end: approvedAt + DEPLOY_FOR });
  }
  return run;
}

/** Text width in the block label's font, measured once per string so the fit rules use real widths */
const widths = new Map<string, number>();
function textWidth(text: string): number {
  const cached = widths.get(text);
  if (cached !== undefined) return cached;
  const ctx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * 6.4;
  const family = getComputedStyle(document.documentElement).getPropertyValue("--kb-font") || "sans-serif";
  ctx.font = `500 12px ${family}`;
  const w = ctx.measureText(text).width;
  widths.set(text, w);
  return w;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * Where every agent is right now, read like a logic analyzer: a channel per agent on a live clock. Running blocks
 * are cobalt and grow into the now line, finished ones carry their duration, hand-offs are directed elbows into the
 * next block, and an approval waits on its own block, still growing, until a person approves it there.
 */
export function AgentLanes({ autoplay = true, startAt = 34, speed = 3, approveAfter = null, onApprove, className }: AgentLanesProps) {
  const reduced = useReducedMotion();
  const [clock, setClock] = useState(startAt);
  const [running, setRunning] = useState(autoplay);
  const [approvedAt, setApprovedAt] = useState<number | null>(null);
  const tracks = useRef<HTMLDivElement>(null);
  const [trackW, setTrackW] = useState(700);
  useEffect(() => {
    const el = tracks.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setTrackW(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const finish = approvedAt === null ? null : approvedAt + DEPLOY_FOR;
  // The axis fits the run: a little headroom past now, rounded to the next 20 seconds
  const fit = (s: number) => Math.max(40, Math.ceil((s * 1.1) / 5) * 5);
  const span = fit(Math.max(clock, finish ?? 0));

  useInterval(
    () => {
      setClock((c) => {
        const next = c + speed / 10;
        if (approvedAt === null && approveAfter !== null && next >= APPROVAL_AT + approveAfter) {
          setApprovedAt(next);
        }
        if (finish !== null && next >= finish + 2) {
          setRunning(false);
          return finish + 2;
        }
        // Without approval the clock runs on for forty seconds, then holds while the block waits
        return approvedAt === null ? Math.min(next, APPROVAL_AT + 40) : next;
      });
    },
    running && !reduced ? 100 : null,
  );

  // Reduced motion: show the run waiting on you, or finished once approved
  const now = reduced ? (finish !== null ? finish + 2 : APPROVAL_AT + 16) : clock;
  const run = buildRun(approvedAt).filter((b) => b.start <= now);
  const byId = new Map(run.map((b) => [b.id, b]));
  const pct = (s: number) => `${(Math.min(s, span) / span) * 100}%`;
  const step = span > 120 ? 30 : span > 60 ? 20 : 10;
  const ticks = Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => i * step);
  const laneIndex = (id: string) => laneAgents.findIndex((l) => l.id === id);
  const waiting = run.find((b) => b.approval && b.end === Infinity && now >= b.start);

  const approve = () => {
    setApprovedAt(now);
    if (!reduced) setRunning(true);
    onApprove?.();
  };

  const busy = (lane: string) => run.filter((b) => b.lane === lane).reduce((sum, b) => sum + Math.max(0, Math.min(b.end, now) - b.start), 0);

  const status = (lane: string) => {
    const active = run.find((b) => b.lane === lane && now >= b.start && now < b.end);
    if (!active) return { text: "Idle", tone: "neutral" as const };
    if (active.approval) return { text: "Needs you", tone: "decal" as const };
    return { text: active.label, tone: "agent" as const };
  };

  const LANE = 36;

  return (
    <section className={cx("kb-al", className)} aria-label="Agent lanes" data-done={(finish !== null && now >= finish) || undefined}>
      <header className="kb-al-head">
        <div>
          <h3>Release 4.12: checkout retries</h3>
          <p>
            {laneAgents.length} agents,{" "}
            {finish !== null && now >= finish
              ? `shipped in ${fmt(finish)}`
              : waiting
                ? `waiting on you for ${fmt(now - APPROVAL_AT)}`
                : `running for ${fmt(now)}`}
          </p>
        </div>
        {waiting ? <Tag tone="decal" dot>Waiting on you</Tag> : finish !== null && now >= finish ? <Tag tone="ok">Shipped</Tag> : <Tag tone="agent" live>Running</Tag>}
        <Button
          size="sm"
          variant="ghost"
          icon={running ? "pause" : "play"}
          aria-label={running ? "Pause clock" : "Resume clock"}
          disabled={reduced || (finish !== null && now >= finish)}
          onClick={() => setRunning((r) => !r)}
        />
      </header>

      <div className="kb-al-grid">
        <div className="kb-al-axis" aria-hidden>
          <span className="kb-al-gutter">Agent, time busy</span>
          <div className="kb-al-scale">
            {ticks.map((s) => (
              <span key={s} style={{ left: pct(s) }}>{fmt(s)}</span>
            ))}
          </div>
        </div>

        <div className="kb-al-body">
          <ul className="kb-al-names">
            {laneAgents.map((a) => {
              const st = status(a.id);
              return (
                <li key={a.id} style={{ height: LANE }}>
                  <span className="kb-al-dot" data-tone={st.tone} />
                  <span className="kb-al-who">
                    <strong>{a.name}</strong>
                    <span className="kb-al-busy">{busy(a.id) > 0 ? fmt(busy(a.id)) : "–"}</span>
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="kb-al-tracks" ref={tracks} style={{ "--lane": `${LANE}px` } as CSSProperties}>
            {ticks.map((s) => (
              <span key={s} className="kb-al-rule" style={{ left: pct(s) }} aria-hidden />
            ))}

            <svg className="kb-al-runners" aria-hidden preserveAspectRatio="none" viewBox={`0 0 1000 ${laneAgents.length * LANE}`}>
              <defs>
                <marker id="kb-al-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="8" markerHeight="8" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M0 0L6 3L0 6z" />
                </marker>
              </defs>
              {run.map((b) => {
                const src = b.from ? byId.get(b.from) : undefined;
                if (!src) return null;
                // Leave from the exact end of the source block, land on the start of the block it unblocks
                const x = (Math.min(b.start, span) / span) * 1000;
                const from = (Math.min(src.end, span) / span) * 1000;
                const down = laneIndex(b.lane) > laneIndex(src.lane);
                const y1 = laneIndex(src.lane) * LANE + LANE / 2;
                const y2 = laneIndex(b.lane) * LANE + (down ? 8 : LANE - 8);
                const land = x + (8 / Math.max(1, trackW)) * 1000;
                return <path key={b.id} d={`M${Math.min(from, land)} ${y1} H${land} V${y2}`} vectorEffect="non-scaling-stroke" markerEnd="url(#kb-al-arrow)" />;
              })}
            </svg>

            {laneAgents.map((a, i) => (
              <div key={a.id} className="kb-al-lane" style={{ top: i * LANE }} role="list" aria-label={`${a.name} tasks`}>
                {run
                  .filter((b) => b.lane === a.id)
                  .map((b) => {
                    const end = Math.min(b.end, now);
                    const live = now < b.end;
                    const state = b.approval && live ? "waiting" : live ? "running" : b.failed ? "failed" : "done";
                    const dur = Math.round(end - b.start);
                    // Fit the label: inside with its duration, inside alone, or outside to the right when the gap
                    // before the lane's next block can hold it. Truncating is the last resort.
                    const px = (s: number) => (s / span) * trackW;
                    const labelPx = textWidth(b.label) + 18 + (state === "failed" || (state === "done" && b.approval) ? 16 : 0);
                    const durPx = state === "done" || state === "failed" ? textWidth(`${dur}s`) + 8 : 0;
                    const next = run.filter((o) => o.lane === b.lane && o.start >= b.end).sort((x, y) => x.start - y.start)[0];
                    const gap = px((next ? next.start : span) - end);
                    const width = px(end - b.start);
                    // Durations live in one place: right-aligned inside the block, or left to the tooltip when the
                    // block is too short. A label only moves outside when the block cannot hold it and does not hand off.
                    const handsOff = run.some((o) => o.from === b.id);
                    const fit =
                      state === "waiting" || width >= labelPx + durPx
                        ? "both"
                        : width >= labelPx
                          ? "label"
                          : !handsOff && gap >= labelPx + 8
                            ? "outside-label"
                            : "label";
                    const short = fit === "outside-label";
                    return (
                      <div
                        key={b.id}
                        role="listitem"
                        className="kb-al-block"
                        data-state={state}
                        data-short={short || undefined}
                        style={{ left: pct(b.start), width: live ? pct(end - b.start) : `calc(${pct(end - b.start)} - 2px)` }}
                        aria-label={`${b.label}, ${state === "waiting" ? "waiting for approval" : state}, from ${fmt(b.start)}${live ? "" : ` to ${fmt(b.end)}`}`}
                        title={`${b.label}, ${live ? `since ${fmt(b.start)}` : `${dur}s (${fmt(b.start)} to ${fmt(b.end)})`}`}
                      >
                        {state === "done" && b.approval ? <Icon name="check" size={12} /> : null}
                        {state === "failed" ? <Icon name="x" size={12} /> : null}
                        <span className="kb-al-label">
                          {b.label}
                          {(state === "done" || state === "failed") && fit === "both" ? <span className="kb-al-dur">{dur}s</span> : null}
                        </span>
                        {state === "waiting" ? (
                          <Button size="sm" variant="primary" className="kb-al-approve" onClick={approve}>
                            Approve
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            ))}

            {finish !== null && now >= finish ? null : (
              <div className="kb-al-now" style={{ left: pct(now) }} aria-hidden>
                <span>{fmt(now)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
      <p className="kb-sr" aria-live="polite">
        {waiting ? "Reviewer is waiting for you to approve the merge to main." : approvedAt !== null ? "Merge approved. Planner is deploying." : ""}
      </p>
    </section>
  );
}
