import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Avatar, cx, Icon, Spinner } from "../../shared/index.ts";
import "./project-card.css";

export type SubtaskState = "done" | "active" | "waiting" | "todo";
export type ProjectStatus = "on-track" | "at-risk" | "blocked" | "shipped";

export interface ProjectPerson {
  id: string;
  name: string;
  /** Agents get a molded robot badge instead of initials */
  agent?: boolean;
}

export interface Subtask {
  id: string;
  title: string;
  owner: string;
  /** done; active means an agent is working on it; waiting means it needs a person */
  state: SubtaskState;
}

export interface ProjectCardProps {
  name?: string;
  due?: string;
  people?: ProjectPerson[];
  subtasks?: Subtask[];
  defaultStatus?: ProjectStatus;
  defaultOpen?: boolean;
  onStatusChange?: (status: ProjectStatus) => void;
  onSubtaskToggle?: (id: string, done: boolean) => void;
  className?: string;
}

export const projectDemoPeople: ProjectPerson[] = [
  { id: "maya", name: "Maya Chen" },
  { id: "dev", name: "Dev Patel" },
  { id: "lena", name: "Lena Ortiz" },
  { id: "bot", name: "Billing agent", agent: true },
];

export const projectDemoSubtasks: Subtask[] = [
  { id: "s1", title: "Inventory current webhook consumers", owner: "bot", state: "done" },
  { id: "s2", title: "Map v1 events to the v2 schema", owner: "dev", state: "done" },
  { id: "s3", title: "Verify signatures on every delivery", owner: "dev", state: "done" },
  { id: "s4", title: "Dual-write events behind a flag", owner: "bot", state: "done" },
  { id: "s5", title: "Backfill the last 30 days of events", owner: "bot", state: "active" },
  { id: "s6", title: "Approve the backfill on production", owner: "maya", state: "waiting" },
  { id: "s7", title: "Update partner integration docs", owner: "lena", state: "todo" },
  { id: "s8", title: "Load test at three times peak", owner: "dev", state: "todo" },
  { id: "s9", title: "Switch traffic and retire v1", owner: "maya", state: "todo" },
];

const STATUSES: { id: ProjectStatus; label: string }[] = [
  { id: "on-track", label: "On track" },
  { id: "at-risk", label: "At risk" },
  { id: "blocked", label: "Blocked" },
  { id: "shipped", label: "Shipped" },
];

const STATE_LABEL: Record<SubtaskState, string> = { done: "Done", active: "Agent working", waiting: "Waiting on a person", todo: "To do" };

/** One arc of the ring, in a 0..100 box, from angle a0 to a1 (degrees, 0 at the top) */
function arc(a0: number, a1: number, r = 40): string {
  const p = (a: number) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return `${(50 + r * Math.cos(rad)).toFixed(2)},${(50 + r * Math.sin(rad)).toFixed(2)}`;
  };
  return `M${p(a0)}A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p(a1)}`;
}

function RobotBadge({ size = 24, name }: { size?: number; name: string }) {
  return (
    <span className="kb-pc-bot" style={{ width: size, height: size }} title={name}>
      <Icon name="robot" size={size * 0.62} />
    </span>
  );
}

/** Status picker: a molded button that opens a listbox, with arrow keys, Enter and Escape */
function StatusPicker({ value, onChange }: { value: ProjectStatus; onChange: (s: ProjectStatus) => void }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = STATUSES.find((s) => s.id === value) ?? STATUSES[0];

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const away = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  const choose = (s: ProjectStatus) => {
    onChange(s);
    setOpen(false);
    button.current?.focus();
  };

  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === "ArrowDown") setCursor((c) => (c + 1) % STATUSES.length);
    else if (event.key === "ArrowUp") setCursor((c) => (c - 1 + STATUSES.length) % STATUSES.length);
    else if (event.key === "Home") setCursor(0);
    else if (event.key === "End") setCursor(STATUSES.length - 1);
    else if (event.key === "Enter" || event.key === " ") {
      const s = STATUSES[cursor];
      if (s) choose(s.id);
    } else if (event.key === "Escape" || event.key === "Tab") {
      setOpen(false);
      if (event.key === "Escape") button.current?.focus();
      if (event.key === "Tab") return;
    } else return;
    event.preventDefault();
  };

  return (
    <div className="kb-pc-status" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="kb-pc-status-btn"
        data-status={value}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${uid}-list`}
        aria-label={`Status: ${current?.label}. Change status`}
        onClick={() => {
          setCursor(Math.max(0, STATUSES.findIndex((s) => s.id === value)));
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setCursor(Math.max(0, STATUSES.findIndex((s) => s.id === value)));
            setOpen(true);
          }
        }}
      >
        <span className="kb-pc-status-dot" />
        {current?.label}
        <Icon name="chevronDown" size={13} />
      </button>
      {open ? (
        <ul
          ref={list}
          id={`${uid}-list`}
          className="kb-pc-status-list"
          role="listbox"
          tabIndex={-1}
          aria-label="Project status"
          aria-activedescendant={`${uid}-${cursor}`}
          onKeyDown={onListKey}
        >
          {STATUSES.map((s, i) => (
            <li
              key={s.id}
              id={`${uid}-${i}`}
              role="option"
              aria-selected={s.id === value}
              data-status={s.id}
              data-cursor={i === cursor || undefined}
              onPointerEnter={() => setCursor(i)}
              onClick={() => choose(s.id)}
            >
              <span className="kb-pc-status-dot" />
              {s.label}
              {s.id === value ? <Icon name="check" size={14} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * A two-line project summary that unfolds on hover or focus. The progress ring is built from snap-fit arc
 * parts, one per subtask, colored by who holds it: cured green when done, ultramarine while an agent works,
 * decal yellow when it waits on a person. People, ring parts and rows are linked by hover.
 */
export function ProjectCard({
  name = "Migrate billing webhooks to v2",
  due = "Fri, Oct 30",
  people = projectDemoPeople,
  subtasks: initialSubtasks = projectDemoSubtasks,
  defaultStatus = "on-track",
  defaultOpen = false,
  onStatusChange,
  onSubtaskToggle,
  className,
}: ProjectCardProps) {
  const uid = useId();
  const [subtasks, setSubtasks] = useState(initialSubtasks);
  const [status, setStatus] = useState<ProjectStatus>(defaultStatus);
  const [pinned, setPinned] = useState(defaultOpen);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [hotPerson, setHotPerson] = useState<string | null>(null);
  const [hotTask, setHotTask] = useState<string | null>(null);
  const open = pinned || hovered || focused;

  const person = (id: string) => people.find((p) => p.id === id);
  const done = subtasks.filter((s) => s.state === "done").length;
  const waiting = subtasks.filter((s) => s.state === "waiting");
  const firstWaiting = waiting[0] ? person(waiting[0].owner) : undefined;

  // A task is lit when it or its owner is pointed at; everything else dims while something is lit
  const lit = (s: Subtask) => (hotTask ? hotTask === s.id : hotPerson ? hotPerson === s.owner : filter ? filter === s.owner : true);
  const anyLit = Boolean(hotTask || hotPerson || filter);

  const toggle = (s: Subtask) => {
    if (s.state === "active") return;
    const next = s.state === "done" ? "todo" : "done";
    setSubtasks((list) => list.map((t) => (t.id === s.id ? { ...t, state: next } : t)));
    onSubtaskToggle?.(s.id, next === "done");
  };

  const n = subtasks.length;
  const gapDeg = n > 1 ? 7 : 0;
  const left = n - done;
  const line2 = waiting.length
    ? `${waiting.length} waiting on ${firstWaiting?.name.split(" ")[0] ?? "a person"}, due ${due}`
    : left
      ? `${left} left, due ${due}`
      : `All ${n} done`;

  const visible = filter ? subtasks.filter((s) => s.owner === filter) : subtasks;

  return (
    <article
      className={cx("kb-pc kb-part", className)}
      data-open={open || undefined}
      aria-labelledby={`${uid}-t`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        setHovered(false);
        setHotPerson(null);
        setHotTask(null);
      }}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <header className="kb-pc-head">
        <svg className="kb-pc-ring" viewBox="0 0 100 100" role="img" aria-label={`${done} of ${n} subtasks done`}>
          {subtasks.map((s, i) => {
            const a0 = (i * 360) / n + gapDeg / 2;
            const a1 = ((i + 1) * 360) / n - gapDeg / 2;
            return (
              <path
                key={s.id}
                d={arc(a0, a1)}
                className="kb-pc-arc"
                data-state={s.state}
                data-dim={(anyLit && !lit(s)) || undefined}
                data-hot={hotTask === s.id || undefined}
                onPointerEnter={() => setHotTask(s.id)}
                onPointerLeave={() => setHotTask(null)}
              />
            );
          })}
          <text x="50" y="50" className="kb-pc-ring-num" textAnchor="middle" dominantBaseline="central">
            {`${done}/${n}`}
          </text>
        </svg>
        <div className="kb-pc-titles">
          <h3 id={`${uid}-t`} className="kb-pc-name">{name}</h3>
          <p className="kb-pc-line2">
            {waiting.length ? <span className="kb-pc-decal" aria-hidden /> : null}
            {line2}
          </p>
        </div>
        <StatusPicker
          value={status}
          onChange={(s) => {
            setStatus(s);
            onStatusChange?.(s);
          }}
        />
        <button
          type="button"
          className="kb-pc-pin"
          aria-expanded={open}
          aria-controls={`${uid}-body`}
          aria-label={pinned ? "Fold subtasks" : "Keep subtasks open"}
          onClick={() => setPinned((p) => !p)}
        >
          <Icon name="chevronDown" size={16} />
        </button>
      </header>

      <div className="kb-pc-fold" id={`${uid}-body`} inert={!open || undefined}>
        <div className="kb-pc-body">
          <div className="kb-pc-people" role="group" aria-label="Show subtasks for">
            <button type="button" className="kb-pc-everyone" aria-pressed={filter === null} onClick={() => setFilter(null)}>
              Everyone
            </button>
            {people.map((p) => {
              const count = subtasks.filter((s) => s.owner === p.id && s.state !== "done").length;
              return (
                <button
                  key={p.id}
                  type="button"
                  className="kb-pc-person"
                  aria-pressed={filter === p.id}
                  aria-label={`${p.name}, ${count} open`}
                  data-hot={hotPerson === p.id || (hotTask ? subtasks.find((s) => s.id === hotTask)?.owner === p.id : false) || undefined}
                  onClick={() => setFilter((f) => (f === p.id ? null : p.id))}
                  onPointerEnter={() => setHotPerson(p.id)}
                  onPointerLeave={() => setHotPerson(null)}
                  onFocus={() => setHotPerson(p.id)}
                  onBlur={() => setHotPerson(null)}
                >
                  {p.agent ? <RobotBadge size={22} name={p.name} /> : <Avatar name={p.name} size={22} />}
                  {count ? <span className="kb-pc-count">{count}</span> : null}
                </button>
              );
            })}
          </div>

          <ul className="kb-pc-tasks">
            {visible.map((s) => {
              const owner = person(s.owner);
              return (
                <li
                  key={s.id}
                  className="kb-pc-task"
                  data-state={s.state}
                  data-dim={(anyLit && !lit(s)) || undefined}
                  data-hot={hotTask === s.id || undefined}
                  onPointerEnter={() => setHotTask(s.id)}
                  onPointerLeave={() => setHotTask(null)}
                >
                  {s.state === "active" ? (
                    <span className="kb-pc-check" data-state="active" title={STATE_LABEL.active}>
                      <Spinner size={12} label="Agent working" />
                    </span>
                  ) : (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={s.state === "done"}
                      aria-label={`${s.title}, ${STATE_LABEL[s.state]}`}
                      className="kb-pc-check"
                      data-state={s.state}
                      onClick={() => toggle(s)}
                      onFocus={() => setHotTask(s.id)}
                      onBlur={() => setHotTask(null)}
                    >
                      {s.state === "done" ? <Icon name="check" size={12} strokeWidth={2.5} /> : null}
                    </button>
                  )}
                  <span className="kb-pc-task-title">{s.title}</span>
                  {s.state === "waiting" ? <span className="kb-pc-ask">Needs you</span> : null}
                  {owner ? (owner.agent ? <RobotBadge size={20} name={owner.name} /> : <Avatar name={owner.name} size={20} />) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </article>
  );
}
