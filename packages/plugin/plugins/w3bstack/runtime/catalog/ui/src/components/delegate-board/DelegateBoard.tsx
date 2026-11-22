"use client";

import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { cx, Avatar, Icon, Tag, useInterval, useReducedMotion } from "../../shared/index.ts";
import "./delegate-board.css";

export interface DelegateTask {
  id: string;
  title: string;
  /** Minutes of work at pace 1 */
  estimate: number;
}

export interface DelegateAgent {
  id: string;
  name: string;
  role: string;
  /** Multiplier on estimates: 0.8 is faster, 1.3 slower */
  pace: number;
  /** Work already on the agent's plate */
  queue: DelegateTask[];
}

export interface DelegateBoardProps {
  agents?: DelegateAgent[];
  tasks?: DelegateTask[];
  /** Start in Auto: new tasks go to whoever is free first */
  defaultAuto?: boolean;
  /** Run the clock and bring in new tasks */
  autoplay?: boolean;
  /** Called on every assignment, manual or automatic */
  onAssign?: (task: DelegateTask, agent: DelegateAgent, auto: boolean) => void;
  className?: string;
}

export const defaultDelegateAgents: DelegateAgent[] = [
  { id: "ada", name: "Ada", role: "Coding agent", pace: 1, queue: [{ id: "q1", title: "Refactor billing webhooks", estimate: 22 }] },
  { id: "bram", name: "Bram", role: "Research agent", pace: 1, queue: [{ id: "q2", title: "Compare vector DB pricing", estimate: 9 }] },
  { id: "cleo", name: "Cleo", role: "Writing agent", pace: 0.8, queue: [] },
  { id: "dex", name: "Dex", role: "QA agent", pace: 1.25, queue: [{ id: "q3", title: "Smoke test staging", estimate: 14 }, { id: "q4", title: "Verify iOS deep links", estimate: 8 }] },
];

export const defaultDelegateTasks: DelegateTask[] = [
  { id: "t1", title: "Fix flaky checkout test", estimate: 12 },
  { id: "t2", title: "Summarize 40 NPS comments", estimate: 7 },
  { id: "t3", title: "Draft 4.12 release notes", estimate: 10 },
  { id: "t4", title: "Triage 6 new Sentry errors", estimate: 15 },
];

const INCOMING: DelegateTask[] = [
  { id: "n1", title: "Update pricing FAQ", estimate: 6 },
  { id: "n2", title: "Benchmark embeddings v3", estimate: 18 },
  { id: "n3", title: "Reply to Acme security review", estimate: 11 },
  { id: "n4", title: "Rename env vars in CI", estimate: 5 },
  { id: "n5", title: "Tag 120 support tickets", estimate: 9 },
];

const WINDOW = 60; // minutes shown on each rail
const START = 14 * 60 + 5; // 14:05

const clockText = (m: number) => {
  const h = Math.floor(m / 60) % 24;
  const mm = Math.floor(m % 60);
  return `${h}:${String(mm).padStart(2, "0")}`;
};

/** Work on an agent's plate, with the remaining minutes of the first item already worn down by `spent`. */
interface Load {
  agent: DelegateAgent;
  items: Array<{ task: DelegateTask; minutes: number }>;
  until: number;
}

/**
 * Hand work to agents by dragging it onto them. Each agent's load is a rail of task parts on a shared
 * hour scale; hovering a task over an agent snaps a ghost part onto the end and shows the new busy-until.
 * Switch to Auto and every new task goes to whoever frees up first. Keyboard: pick a task up with Enter,
 * move to an agent, Enter to drop, Escape to put it back.
 */
export function DelegateBoard({
  agents: initialAgents = defaultDelegateAgents,
  tasks: initialTasks = defaultDelegateTasks,
  defaultAuto = false,
  autoplay = true,
  onAssign,
  className,
}: DelegateBoardProps) {
  const reduced = useReducedMotion();
  const [agents, setAgents] = useState(initialAgents);
  const [tray, setTray] = useState(initialTasks);
  const [auto, setAuto] = useState(defaultAuto);
  const [now, setNow] = useState(START);
  const [spent, setSpent] = useState<Record<string, number>>({});
  const [held, setHeld] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const [say, setSay] = useState("");
  const incoming = useRef(0);
  const ticks = useRef(0);

  const loadOf = (a: DelegateAgent): Load => {
    let until = now;
    const items = a.queue.map((task, i) => {
      const full = task.estimate * a.pace;
      const minutes = i === 0 ? Math.max(0, full - (spent[a.id] ?? 0)) : full;
      until += minutes;
      return { task, minutes };
    });
    return { agent: a, items, until };
  };
  const loads = agents.map(loadOf);

  const assign = (taskId: string, agentId: string, viaAuto = false) => {
    const task = tray.find((t) => t.id === taskId);
    const agent = agents.find((a) => a.id === agentId);
    if (!task || !agent) return;
    setTray((ts) => ts.filter((t) => t.id !== taskId));
    setAgents((as) => as.map((a) => (a.id === agentId ? { ...a, queue: [...a.queue, task] } : a)));
    setLanded(task.id);
    setHeld(null);
    setOver(null);
    const until = loadOf(agent).until + task.estimate * agent.pace;
    setSay(`${task.title} assigned to ${agent.name}, busy until ${clockText(until)}`);
    onAssign?.(task, agent, viaAuto);
  };

  // Whoever frees up first takes the next task
  const freest = () => [...loads].sort((a, b) => a.until - b.until)[0]?.agent;

  // The clock: one simulated minute every 1.2s; work drains; new tasks arrive now and then
  useInterval(
    () => {
      ticks.current++;
      setNow((n) => n + 1);
      const nextSpent = { ...spent };
      const done: string[] = [];
      for (const a of agents) {
        const head = a.queue[0];
        if (!head) continue;
        nextSpent[a.id] = (nextSpent[a.id] ?? 0) + 1;
        if ((nextSpent[a.id] ?? 0) >= head.estimate * a.pace) {
          nextSpent[a.id] = 0;
          done.push(a.id);
        }
      }
      setSpent(nextSpent);
      if (done.length) setAgents((as) => as.map((a) => (done.includes(a.id) ? { ...a, queue: a.queue.slice(1) } : a)));
      if (ticks.current % 4 === 0 && incoming.current < INCOMING.length) {
        const task = INCOMING[incoming.current++];
        if (task) setTray((ts) => [...ts, task]);
      }
      if (auto && tray.length && !held) {
        const first = tray[0];
        const target = freest();
        if (first && target) assign(first.id, target.id, true);
      }
    },
    autoplay && !reduced ? 1200 : null,
  );

  // In Auto with no clock (reduced motion), place everything at once when switched on
  const switchAuto = (on: boolean) => {
    setAuto(on);
    if (on && (reduced || !autoplay)) {
      let as = agents;
      for (const t of tray) {
        const sorted = as.map(loadOf).sort((a, b) => a.until - b.until);
        const target = sorted[0]?.agent;
        if (!target) continue;
        as = as.map((a) => (a.id === target.id ? { ...a, queue: [...a.queue, t] } : a));
        onAssign?.(t, target, true);
      }
      setAgents(as);
      setTray([]);
      setSay("All waiting tasks were placed with whoever frees up first.");
    }
  };

  const heldTask = tray.find((t) => t.id === held);
  const onDragStart = (e: DragEvent, id: string) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    setHeld(id);
  };
  const onTaskKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setHeld(null);
  };
  const onAgentKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setHeld(null);
      setOver(null);
    }
  };

  return (
    <section className={cx("kb-db", className)} aria-label="Delegate board" data-holding={heldTask ? "" : undefined}>
      <header className="kb-db-head">
        <div className="kb-db-title">
          <h3>Delegate</h3>
          <p>It is {clockText(now)}. Drag a task onto an agent, or let Auto place it.</p>
        </div>
        <div className="kb-db-mode" role="radiogroup" aria-label="Assignment mode">
          <button type="button" role="radio" aria-checked={!auto} onClick={() => switchAuto(false)}>Manual</button>
          <button type="button" role="radio" aria-checked={auto} onClick={() => switchAuto(true)}>
            <Icon name="bolt" size={14} /> Auto
          </button>
        </div>
      </header>

      <div className="kb-db-body">
        <div className="kb-db-tray">
          <h4>
            To hand off <span>{tray.length}</span>
          </h4>
          <ul aria-label="Unassigned tasks">
            {tray.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="kb-db-task"
                  draggable
                  data-held={held === t.id || undefined}
                  aria-pressed={held === t.id}
                  aria-label={`${t.title}, about ${t.estimate} minutes. ${held === t.id ? "Picked up, choose an agent" : "Press Enter to pick up"}`}
                  onDragStart={(e) => onDragStart(e, t.id)}
                  onDragEnd={() => {
                    setHeld(null);
                    setOver(null);
                  }}
                  onClick={() => setHeld((h) => (h === t.id ? null : t.id))}
                  onKeyDown={onTaskKey}
                >
                  <span className="kb-ribs" aria-hidden />
                  <span className="kb-db-task-title">{t.title}</span>
                  <span className="kb-db-est">{t.estimate}m</span>
                </button>
              </li>
            ))}
            {tray.length === 0 ? <li className="kb-db-empty">{auto ? "Auto is placing new tasks as they arrive." : "Everything is handed off."}</li> : null}
          </ul>
        </div>

        <ul className="kb-db-agents" aria-label="Agents">
          <li className="kb-db-scale" aria-hidden>
            <span />
            <span className="kb-db-scale-rail">
              {[0, 15, 30, 45, 60].map((m) => (
                <i key={m} style={{ left: `${(m / WINDOW) * 100}%` }}>{m === 0 ? "now" : clockText(now + m)}</i>
              ))}
            </span>
          </li>
          {loads.map(({ agent, items, until }) => {
            const preview = heldTask && over === agent.id ? heldTask.estimate * agent.pace : 0;
            const newUntil = until + preview;
            const free = items.length === 0;
            return (
              <li key={agent.id}>
                <button
                  type="button"
                  className="kb-db-agent"
                  data-over={(over === agent.id && heldTask) || undefined}
                  disabled={!heldTask}
                  aria-label={
                    heldTask
                      ? `Give ${heldTask.title} to ${agent.name}, busy until ${clockText(until + heldTask.estimate * agent.pace)}`
                      : `${agent.name}, ${free ? "free now" : `busy until ${clockText(until)}`}`
                  }
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (over !== agent.id) setOver(agent.id);
                  }}
                  onDragLeave={() => setOver((o) => (o === agent.id ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain") || held;
                    if (id) assign(id, agent.id);
                  }}
                  onMouseEnter={() => heldTask && setOver(agent.id)}
                  onMouseLeave={() => setOver((o) => (o === agent.id ? null : o))}
                  onFocus={() => heldTask && setOver(agent.id)}
                  onBlur={() => setOver((o) => (o === agent.id ? null : o))}
                  onKeyDown={onAgentKey}
                  onClick={() => held && assign(held, agent.id)}
                >
                  <span className="kb-db-who">
                    <Avatar name={agent.name} size={28} />
                    <span>
                      <strong>{agent.name}</strong>
                      <span>{agent.role}</span>
                    </span>
                  </span>
                  <span className="kb-db-rail" aria-hidden>
                    {items.map(({ task, minutes }) => (
                      <span
                        key={task.id}
                        className="kb-db-part"
                        data-landed={landed === task.id || undefined}
                        style={{ flexBasis: `${(Math.min(minutes, WINDOW) / WINDOW) * 100}%` }}
                        title={`${task.title}, ${Math.round(minutes)}m left`}
                      >
                        <span>{task.title}</span>
                      </span>
                    ))}
                    {preview ? (
                      <span className="kb-db-part kb-db-ghost" style={{ flexBasis: `${(Math.min(preview, WINDOW) / WINDOW) * 100}%` }}>
                        <span>{heldTask?.title}</span>
                      </span>
                    ) : null}
                  </span>
                  <span className="kb-db-until">
                    {preview ? (
                      <>
                        <strong>{clockText(newUntil)}</strong>
                        <span className="kb-db-delta">+{Math.round(preview)}m</span>
                      </>
                    ) : free ? (
                      <Tag tone="ok">Free now</Tag>
                    ) : (
                      <>
                        <strong>{clockText(until)}</strong>
                        <span>busy until</span>
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="kb-sr" aria-live="polite">{say}</p>
    </section>
  );
}
