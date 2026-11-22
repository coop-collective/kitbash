"use client";

import { useState, type KeyboardEvent } from "react";
import { cx, Icon, Spinner, formatDuration, useInterval, useReducedMotion } from "../../shared/index.ts";
import "./agent-tree.css";

export interface TreeAgent {
  id: string;
  name: string;
  task: string;
  model: string;
  /** Simulated second the agent was started */
  start: number;
  /** Seconds it runs; the orchestrator runs until its last child ends */
  duration?: number;
  /** Dollars per second while running */
  rate: number;
  /** Ends in failure instead of success */
  fails?: string;
  children?: TreeAgent[];
}

export interface AgentTreeProps {
  root?: TreeAgent;
  /** Run the clock on mount */
  autoplay?: boolean;
  /** Simulated seconds per real second */
  speed?: number;
  /** Simulated second to open on */
  startAt?: number;
  /** Ids of branches folded at first */
  defaultFolded?: string[];
  className?: string;
}

export const defaultAgentTree: TreeAgent = {
  id: "orch",
  name: "Orchestrator",
  task: "Ship the new pricing page",
  model: "opus-4",
  start: 0,
  rate: 0.004,
  children: [
    {
      id: "research",
      name: "Researcher",
      task: "Collect competitor pricing",
      model: "sonnet-4",
      start: 1,
      duration: 15,
      rate: 0.0018,
      children: [
        { id: "browse", name: "Browser", task: "Read 6 pricing pages", model: "haiku-4", start: 2, duration: 9, rate: 0.0006 },
        { id: "norm", name: "Analyst", task: "Normalize plans to per-seat", model: "haiku-4", start: 11, duration: 5, rate: 0.0007 },
      ],
    },
    {
      id: "copy",
      name: "Copywriter",
      task: "Draft headline, tiers and FAQ",
      model: "sonnet-4",
      start: 6,
      duration: 13,
      rate: 0.0021,
      children: [{ id: "critic", name: "Critic", task: "Check claims against sources", model: "sonnet-4", start: 14, duration: 5, rate: 0.0019 }],
    },
    {
      id: "build",
      name: "Builder",
      task: "Implement /pricing in Next.js",
      model: "sonnet-4",
      start: 9,
      duration: 20,
      rate: 0.0024,
      children: [
        { id: "art", name: "Illustrator", task: "Generate hero artwork", model: "image-2", start: 12, duration: 4, rate: 0.01, fails: "Safety filter, needs a new prompt" },
        { id: "test", name: "Tester", task: "Run visual diffs on 3 breakpoints", model: "haiku-4", start: 21, duration: 7, rate: 0.0008 },
      ],
    },
  ],
};

type Status = "queued" | "running" | "done" | "failed";

interface Snap {
  status: Status;
  elapsed: number;
  cost: number;
}

function endOf(a: TreeAgent): number {
  if (a.duration !== undefined) return a.start + a.duration;
  return Math.max(a.start + 1, ...(a.children ?? []).map(endOf));
}

function snapshot(a: TreeAgent, t: number): Snap {
  const end = endOf(a);
  if (t < a.start) return { status: "queued", elapsed: 0, cost: 0 };
  const elapsed = Math.min(t, end) - a.start;
  const status: Status = t < end ? "running" : a.fails ? "failed" : "done";
  return { status, elapsed, cost: elapsed * a.rate };
}

function branchCost(a: TreeAgent, t: number): number {
  return snapshot(a, t).cost + (a.children ?? []).reduce((sum, c) => sum + branchCost(c, t), 0);
}

function countAgents(a: TreeAgent, t: number): { total: number; running: number } {
  const kids = (a.children ?? []).filter((c) => t >= c.start);
  return kids.reduce(
    (acc, c) => {
      const sub = countAgents(c, t);
      return { total: acc.total + 1 + sub.total, running: acc.running + (snapshot(c, t).status === "running" ? 1 : 0) + sub.running };
    },
    { total: 0, running: 0 },
  );
}

const money = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;

/**
 * Who started whom: an orchestrator and its sub-agents as a live tree. Every card carries status, cost and
 * time; costs roll up each branch. The tree hangs off sprue runners, and a branch folds shut to a single line.
 */
export function AgentTree({ root = defaultAgentTree, autoplay = true, speed = 2, startAt = 7, defaultFolded = [], className }: AgentTreeProps) {
  const reduced = useReducedMotion();
  const end = endOf(root);
  const [clock, setClock] = useState(() => Math.min(startAt, end));
  const [folded, setFolded] = useState<Set<string>>(() => new Set(defaultFolded));

  useInterval(() => setClock((c) => Math.min(end, c + speed / 10)), autoplay && !reduced && clock < end ? 100 : null);

  const t = reduced ? end : clock;
  const toggle = (id: string, open?: boolean) =>
    setFolded((f) => {
      const next = new Set(f);
      const shouldFold = open === undefined ? !next.has(id) : !open;
      if (shouldFold) next.add(id);
      else next.delete(id);
      return next;
    });

  const total = branchCost(root, t);
  const counts = countAgents(root, t);

  return (
    <section className={cx("kb-at", className)} aria-label="Agent tree">
      <header className="kb-at-head">
        <div>
          <h3>Pricing page run</h3>
          <p>
            {counts.total} sub-agents, {counts.running} running
          </p>
        </div>
        <div className="kb-at-total">
          <span>{money(total)}</span>
          <span>{formatDuration(t)}</span>
        </div>
      </header>
      <ul className="kb-at-tree" role="tree" aria-label="Agents and who started them">
        <Node agent={root} t={t} folded={folded} toggle={toggle} depth={0} />
      </ul>
    </section>
  );
}

function Node({
  agent,
  t,
  folded,
  toggle,
  depth,
}: {
  agent: TreeAgent;
  t: number;
  folded: Set<string>;
  toggle: (id: string, open?: boolean) => void;
  depth: number;
}) {
  const snap = snapshot(agent, t);
  const kids = (agent.children ?? []).filter((c) => t >= c.start);
  const hasKids = kids.length > 0;
  const isFolded = hasKids && folded.has(agent.id);
  const rolled = branchCost(agent, t);
  const sub = countAgents(agent, t);

  const onKey = (e: KeyboardEvent) => {
    if (!hasKids) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      toggle(agent.id, false);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      toggle(agent.id, true);
    }
  };

  return (
    <li
      className="kb-at-item"
      role="treeitem"
      aria-expanded={hasKids ? !isFolded : undefined}
      aria-level={depth + 1}
      aria-label={`${agent.name}, ${snap.status}`}
      data-depth={depth}
    >
      <div className="kb-at-card" data-status={snap.status} data-folded={isFolded || undefined}>
        {hasKids ? (
          <button
            type="button"
            className="kb-at-fold"
            aria-label={isFolded ? `Unfold ${agent.name}` : `Fold ${agent.name}`}
            aria-expanded={!isFolded}
            onClick={() => toggle(agent.id)}
            onKeyDown={onKey}
          >
            <Icon name="chevronRight" size={14} />
          </button>
        ) : (
          <span className="kb-at-leaf" aria-hidden />
        )}
        <span className="kb-at-state">
          {snap.status === "running" ? <Spinner size={13} label="Running" /> : null}
          {snap.status === "done" ? <Icon name="check" size={14} label="Done" /> : null}
          {snap.status === "failed" ? <Icon name="x" size={14} label="Failed" /> : null}
        </span>
        <div className="kb-at-main">
          <div className="kb-at-line">
            <strong>{agent.name}</strong>
            <span className="kb-at-model">{agent.model}</span>
          </div>
          <div className="kb-at-task">
            {isFolded ? `${sub.total} sub-agents folded${sub.running ? `, ${sub.running} running` : ""}` : snap.status === "failed" ? agent.fails : agent.task}
          </div>
        </div>
        <dl className="kb-at-nums">
          <div>
            <dt className="kb-sr">Cost</dt>
            <dd>{money(isFolded ? rolled : snap.cost)}</dd>
          </div>
          <div>
            <dt className="kb-sr">Time</dt>
            <dd>{formatDuration(snap.elapsed)}</dd>
          </div>
        </dl>
        {hasKids && !isFolded ? (
          <span className="kb-at-roll" title="This agent plus everything it started">
            Branch {money(rolled)}
          </span>
        ) : null}
      </div>
      {hasKids && !isFolded ? (
        <ul className="kb-at-kids" role="group">
          {kids.map((c) => (
            <Node key={c.id} agent={c} t={t} folded={folded} toggle={toggle} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
