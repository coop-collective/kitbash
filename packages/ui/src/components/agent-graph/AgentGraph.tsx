"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "../button/Button.tsx";
import { cx, Icon, Tag, useInterval, useReducedMotion } from "../../shared/index.ts";
import "./agent-graph.css";

export interface GraphNode {
  id: string;
  kind: "agent" | "tool";
  label: string;
  /** Two letters on an agent's disc; defaults to the first two of the label */
  short?: string;
  /** Position in the 640 x 380 drawing */
  x: number;
  y: number;
}

export interface GraphLink {
  from: string;
  to: string;
  /** Calls already made before the demo starts; sets the starting thickness */
  calls?: number;
}

export interface GraphApproval {
  agent: string;
  tool: string;
  /** The exact call the agent wants to make */
  command: string;
}

export interface AgentGraphProps {
  nodes?: GraphNode[];
  links?: GraphLink[];
  /** Fire simulated calls along the links */
  autoplay?: boolean;
  /** Milliseconds between new calls */
  rate?: number;
  /** An agent that stops and waits for a person after `approvalAfter` ms; null for none */
  approval?: GraphApproval | null;
  approvalAfter?: number;
  onApprove?: (approval: GraphApproval, approved: boolean) => void;
  className?: string;
}

export const defaultGraphNodes: GraphNode[] = [
  { id: "planner", kind: "agent", label: "Planner", x: 92, y: 190 },
  { id: "research", kind: "agent", label: "Researcher", short: "Rs", x: 300, y: 76 },
  { id: "coder", kind: "agent", label: "Coder", x: 300, y: 190 },
  { id: "review", kind: "agent", label: "Reviewer", short: "Rv", x: 300, y: 304 },
  { id: "web", kind: "tool", label: "web.search", x: 540, y: 40 },
  { id: "docs", kind: "tool", label: "docs.fetch", x: 540, y: 112 },
  { id: "sandbox", kind: "tool", label: "sandbox.exec", x: 540, y: 190 },
  { id: "github", kind: "tool", label: "github.pr", x: 540, y: 268 },
  { id: "slack", kind: "tool", label: "slack.post", x: 540, y: 340 },
];

export const defaultGraphLinks: GraphLink[] = [
  { from: "planner", to: "research", calls: 3 },
  { from: "planner", to: "coder", calls: 4 },
  { from: "planner", to: "review", calls: 1 },
  { from: "research", to: "web", calls: 9 },
  { from: "research", to: "docs", calls: 4 },
  { from: "coder", to: "github", calls: 2 },
  { from: "coder", to: "sandbox", calls: 6 },
  { from: "review", to: "github", calls: 3 },
  { from: "review", to: "slack", calls: 0 },
];

const defaultApproval: GraphApproval = {
  agent: "coder",
  tool: "sandbox",
  command: "pnpm db:migrate --env staging",
};

/** One call in flight: out to the tool, a short dwell, and the answer back. */
interface Pulse {
  id: number;
  link: number;
  start: number;
}
const OUT = 650;
const DWELL = 250;
const BACK = 650;
const LIFE = OUT + DWELL + BACK;

/** Small deterministic random so the demo plays the same way each time. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Agents and the tools they call as a living network. Every call travels out as a pellet and its answer
 * comes back; the socket on the tool presses in when a call lands; links thicken as they get busy; working
 * agents breathe; an agent that needs a person turns decal yellow and waits.
 */
export function AgentGraph({
  nodes = defaultGraphNodes,
  links = defaultGraphLinks,
  autoplay = true,
  rate = 520,
  approval = defaultApproval,
  approvalAfter = 4200,
  onApprove,
  className,
}: AgentGraphProps) {
  const reduced = useReducedMotion();
  const [now, setNow] = useState(0);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [counts, setCounts] = useState<number[]>(() => links.map((l) => l.calls ?? 0));
  const [waiting, setWaiting] = useState<GraphApproval | null>(null);
  const [asked, setAsked] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const random = useRef(rng(7));
  const nextId = useRef(1);
  const lastFire = useRef(0);
  const live = autoplay && !reduced;

  // With reduced motion there is no traffic to watch, so the approval (if any) is shown straight away
  useEffect(() => {
    if (reduced && approval && !asked) {
      setWaiting(approval);
      setAsked(true);
    }
  }, [reduced, approval, asked]);

  useInterval(
    () => {
      const t = now + 50;
      setNow(t);
      // A call counts when it lands on the tool
      const arrived = pulses.filter((p) => now - p.start < OUT && t - p.start >= OUT).map((p) => p.link);
      if (arrived.length) setCounts((c) => c.map((n, i) => n + arrived.filter((a) => a === i).length));
      setPulses((ps) => ps.filter((p) => t - p.start < LIFE));
      if (approval && !asked && t >= approvalAfter) {
        setWaiting(approval);
        setAsked(true);
        setLog(`${labelOf(approval.agent)} is waiting for you`);
      }
      if (t - lastFire.current >= rate) {
        lastFire.current = t;
        const open = links
          .map((l, i) => ({ l, i }))
          .filter(({ l }) => !waiting || (l.from !== waiting.agent && l.to !== waiting.agent));
        const pick = open[Math.floor(random.current() * open.length)];
        if (pick) {
          setPulses((ps) => [...ps, { id: nextId.current++, link: pick.i, start: t }]);
        }
      }
    },
    live ? 50 : null,
  );

  const byId = new Map(nodes.map((n) => [n.id, n]));
  function labelOf(id: string) {
    return byId.get(id)?.label ?? id;
  }

  // Busy agents breathe: they have a call in flight right now
  const busy = new Set<string>();
  const landed = new Set<string>();
  for (const p of pulses) {
    const link = links[p.link];
    if (!link) continue;
    busy.add(link.from);
    const age = now - p.start;
    if (age >= OUT && age < OUT + DWELL + 100) landed.add(link.to);
  }

  const decide = (approved: boolean) => {
    if (!waiting) return;
    onApprove?.(waiting, approved);
    setLog(`${approved ? "Approved" : "Denied"} ${labelOf(waiting.agent)}: ${waiting.command}`);
    if (approved && live) {
      const idx = links.findIndex((l) => l.from === waiting.agent && l.to === waiting.tool);
      if (idx >= 0) setPulses((ps) => [...ps, { id: nextId.current++, link: idx, start: now }]);
    }
    setWaiting(null);
  };

  const agents = nodes.filter((n) => n.kind === "agent");
  const callsBy = (id: string) => links.reduce((sum, l, i) => sum + (l.from === id ? counts[i] ?? 0 : 0), 0);
  const total = counts.reduce((a, b) => a + b, 0);

  const onNodeKey = (e: KeyboardEvent, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSelected((s) => (s === id ? null : id));
    }
  };

  return (
    <section className={cx("kb-ag", className)} aria-label="Agent network">
      <div className="kb-ag-canvas">
        <svg viewBox="0 0 640 380" className="kb-ag-svg" role="group" aria-label={`Agents and tools, ${total} calls so far`}>
          {links.map((l, i) => {
            const a = byId.get(l.from);
            const b = byId.get(l.to);
            if (!a || !b) return null;
            const width = 1.5 + Math.min(counts[i] ?? 0, 24) * 0.32;
            const dim = selected !== null && l.from !== selected && l.to !== selected;
            const delegation = b.kind === "agent";
            return (
              <g key={`${l.from}-${l.to}`} className="kb-ag-link" data-dim={dim || undefined} data-kind={delegation ? "delegate" : "call"}>
                <line x1={a.x} y1={a.y} x2={b.x - (b.kind === "tool" ? 52 : 0)} y2={b.y} style={{ strokeWidth: width }} />
              </g>
            );
          })}

          {pulses.map((p) => {
            const l = links[p.link];
            const a = l && byId.get(l.from);
            const b = l && byId.get(l.to);
            if (!a || !b) return null;
            const bx = b.x - (b.kind === "tool" ? 52 : 0);
            const age = now - p.start;
            const back = age > OUT + DWELL;
            const f = age < OUT ? age / OUT : back ? 1 - (age - OUT - DWELL) / BACK : 1;
            const k = Math.max(0, Math.min(1, f));
            return (
              <circle
                key={p.id}
                className="kb-ag-pellet"
                data-dir={back ? "answer" : "call"}
                cx={a.x + (bx - a.x) * k}
                cy={a.y + (b.y - a.y) * k}
                r={back ? 3.5 : 4.5}
              />
            );
          })}

          {nodes.map((n) => {
            const isWaiting = waiting?.agent === n.id;
            const dim = selected !== null && selected !== n.id && !links.some((l) => (l.from === selected && l.to === n.id) || (l.to === selected && l.from === n.id));
            const label = n.kind === "agent" ? `${n.label}, ${isWaiting ? "waiting for you" : busy.has(n.id) ? "working" : "idle"}, ${callsBy(n.id)} calls` : `${n.label} tool`;
            return (
              <g
                key={n.id}
                className="kb-ag-node"
                data-kind={n.kind}
                data-busy={(busy.has(n.id) && !isWaiting) || undefined}
                data-waiting={isWaiting || undefined}
                data-hit={landed.has(n.id) || undefined}
                data-selected={selected === n.id || undefined}
                data-dim={dim || undefined}
                transform={`translate(${n.x} ${n.y})`}
                tabIndex={0}
                role="button"
                aria-pressed={selected === n.id}
                aria-label={label}
                onClick={() => setSelected((s) => (s === n.id ? null : n.id))}
                onKeyDown={(e) => onNodeKey(e, n.id)}
              >
                {n.kind === "agent" ? (
                  <>
                    <circle className="kb-ag-halo" r="30" />
                    <circle className="kb-ag-disc" r="24" />
                    <text className="kb-ag-initial" y="5">{n.short ?? n.label.slice(0, 2)}</text>
                    <text className="kb-ag-name" y="44">{n.label}</text>
                    {isWaiting ? (
                      <g transform="translate(17 -19)">
                        <circle r="8" className="kb-ag-badge" />
                        <text className="kb-ag-badge-mark" y="3.5">!</text>
                      </g>
                    ) : null}
                  </>
                ) : (
                  <>
                    <rect className="kb-ag-socket" x="-52" y="-15" width="104" height="30" rx="8" />
                    <rect className="kb-ag-plug" x="-48" y="-11" width="96" height="22" rx="6" />
                    <text className="kb-ag-tool" y="4">{n.label}</text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <aside className="kb-ag-side">
        <div className="kb-ag-total">
          <span className="kb-ag-total-n">{total}</span>
          <span>tool calls this run</span>
        </div>

        {waiting ? (
          <div className="kb-ag-ask" role="alert">
            <p>
              <strong>{labelOf(waiting.agent)}</strong> wants to call <strong>{labelOf(waiting.tool)}</strong>
            </p>
            <code>{waiting.command}</code>
            <div className="kb-ag-ask-actions">
              <Button size="sm" variant="primary" icon="check" onClick={() => decide(true)}>Approve</Button>
              <Button size="sm" variant="ghost" onClick={() => decide(false)}>Deny</Button>
            </div>
          </div>
        ) : null}

        <ul className="kb-ag-list" aria-label="Agents">
          {agents.map((a) => {
            const isWaiting = waiting?.agent === a.id;
            const state = isWaiting ? "Needs you" : busy.has(a.id) ? "Working" : "Idle";
            return (
              <li key={a.id}>
                <button
                  type="button"
                  className="kb-ag-row"
                  aria-pressed={selected === a.id}
                  onClick={() => setSelected((s) => (s === a.id ? null : a.id))}
                >
                  <span className="kb-ag-row-dot" data-state={state} />
                  <span className="kb-ag-row-name">{a.label}</span>
                  <span className="kb-ag-row-n">{callsBy(a.id)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {selected ? (
          <p className="kb-ag-hint">
            <Icon name="link" size={14} /> Showing links for {labelOf(selected)}
          </p>
        ) : (
          <p className="kb-ag-hint">Select an agent or tool to trace its links.</p>
        )}
        {!live && !waiting ? <Tag>Paused</Tag> : null}
      </aside>
      <p className="kb-sr" aria-live="polite">{log}</p>
    </section>
  );
}
