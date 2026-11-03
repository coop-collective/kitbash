"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { cx, Icon, useReducedMotion } from "../../shared/index.ts";
import type { IconName } from "../../shared/index.ts";
import "./autonomy-dial.css";

export type AutonomyLevel = 0 | 1 | 2;

export interface AutonomyAction {
  id: string;
  label: string;
  icon: IconName;
  /** 0 reads, 1 changes things you can undo, 2 reaches outside or cannot be undone */
  risk: AutonomyLevel;
  /** Locked actions always ask, whatever the dial says */
  locked?: boolean;
}

export const sampleAutonomyActions: AutonomyAction[] = [
  { id: "read", label: "Read files in the repo", icon: "file", risk: 0 },
  { id: "search", label: "Search the web", icon: "globe", risk: 0 },
  { id: "tests", label: "Run the test suite", icon: "terminal", risk: 0 },
  { id: "edit", label: "Edit files on its branch", icon: "edit", risk: 1 },
  { id: "install", label: "Install npm packages", icon: "layers", risk: 1 },
  { id: "pr", label: "Open pull requests", icon: "code", risk: 1 },
  { id: "comment", label: "Comment on issues", icon: "message", risk: 1 },
  { id: "branches", label: "Delete stale branches", icon: "trash", risk: 2 },
  { id: "merge", label: "Merge to main", icon: "link", risk: 2, locked: true },
  { id: "deploy", label: "Deploy to production", icon: "bolt", risk: 2, locked: true },
];

const STOPS: Array<{ label: string; hint: string; angle: number }> = [
  { label: "Ask first", hint: "Only reads on its own. Every change waits for you.", angle: -60 },
  { label: "Ask when risky", hint: "Makes changes you can undo. Asks before anything outward or permanent.", angle: 0 },
  { label: "On its own", hint: "Does everything it can. Only locked actions ask.", angle: 60 },
];

export interface AutonomyDialProps {
  /** Starting position of the dial */
  defaultLevel?: AutonomyLevel;
  actions?: AutonomyAction[];
  /** Agent the dial controls, shown in the heading */
  agent?: string;
  onChange?: (level: AutonomyLevel, actions: AutonomyAction[]) => void;
  className?: string;
}

/**
 * How much an agent may do on its own. A knurled knob clicks between three detents, and the agent's real actions
 * glide between "Runs on its own" and "Asks you first". A lock pins an action to asking, whatever the dial says.
 */
export function AutonomyDial({
  defaultLevel = 1,
  actions: initialActions = sampleAutonomyActions,
  agent = "Coding agent",
  onChange,
  className,
}: AutonomyDialProps) {
  const [level, setLevel] = useState<AutonomyLevel>(defaultLevel);
  const [actions, setActions] = useState(initialActions);
  const reduced = useReducedMotion();
  const knobRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const hintId = useId();

  const runsAlone = (a: AutonomyAction) => !a.locked && a.risk <= level;
  const own = actions.filter(runsAlone);
  const asks = actions.filter((a) => !runsAlone(a));

  const flip = useFlip(reduced, [level, actions]);

  const set = (next: number) => {
    const clamped = Math.max(0, Math.min(2, next)) as AutonomyLevel;
    if (clamped === level) return;
    setLevel(clamped);
    onChange?.(clamped, actions);
  };

  const toggleLock = (id: string) => {
    const next = actions.map((a) => (a.id === id ? { ...a, locked: !a.locked } : a));
    setActions(next);
    onChange?.(level, next);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const map: Record<string, number> = {
      ArrowRight: level + 1,
      ArrowUp: level + 1,
      ArrowLeft: level - 1,
      ArrowDown: level - 1,
      Home: 0,
      End: 2,
    };
    const next = map[event.key];
    if (next === undefined) return;
    event.preventDefault();
    set(next);
  };

  // Turning the knob: the pointer's angle around the center snaps to the nearest detent
  const turn = (event: PointerEvent) => {
    const box = knobRef.current?.getBoundingClientRect();
    if (!box) return;
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    set(angle < -30 ? 0 : angle > 30 ? 2 : 1);
  };

  const stop = STOPS[level] ?? STOPS[1]!;

  return (
    <div className={cx("kb-root kb-ad kb-part", className)}>
      <div className="kb-ad-dial">
        <div>
          <h3 className="kb-ad-title">{agent}</h3>
          <p className="kb-ad-sub">How much it does without asking</p>
        </div>
        <div className="kb-ad-face">
          {STOPS.map((s, i) => (
            <button
              key={s.label}
              type="button"
              className="kb-ad-stop"
              data-pos={i}
              data-active={i === level || undefined}
              tabIndex={-1}
              onClick={() => set(i)}
            >
              {s.label}
            </button>
          ))}
          <div className="kb-ad-ticks" aria-hidden>
            {STOPS.map((s, i) => (
              <i key={i} data-active={i === level || undefined} style={{ transform: `rotate(${s.angle}deg)` }} />
            ))}
          </div>
          <div
            ref={knobRef}
            className="kb-ad-knob"
            role="slider"
            tabIndex={0}
            aria-label="Autonomy"
            aria-valuemin={0}
            aria-valuemax={2}
            aria-valuenow={level}
            aria-valuetext={stop.label}
            aria-describedby={hintId}
            onKeyDown={onKeyDown}
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => dragging.current && turn(e)}
            onPointerUp={(e) => {
              if (dragging.current) turn(e);
              dragging.current = false;
            }}
            onPointerCancel={() => (dragging.current = false)}
          >
            <span className="kb-ad-cap" style={{ transform: `rotate(${stop.angle}deg)` }}>
              <span className="kb-ad-pointer" />
            </span>
          </div>
        </div>
        <p className="kb-ad-hint" id={hintId} aria-live="polite">
          <strong>{stop.label}.</strong> {stop.hint}
        </p>
      </div>

      <div className="kb-ad-cols">
        <Column title="Runs on its own" tone="own" items={own} flip={flip} onLock={toggleLock} />
        <Column title="Asks you first" tone="ask" items={asks} flip={flip} onLock={toggleLock} />
      </div>
    </div>
  );
}

function Column({
  title,
  tone,
  items,
  flip,
  onLock,
}: {
  title: string;
  tone: "own" | "ask";
  items: AutonomyAction[];
  flip: (id: string) => (el: HTMLElement | null) => void;
  onLock: (id: string) => void;
}) {
  return (
    <section className="kb-ad-col" data-tone={tone} aria-label={title}>
      <header>
        <span>{title}</span>
        <span className="kb-ad-count">{items.length}</span>
      </header>
      <ul>
        {items.map((a) => (
          <li key={a.id} ref={flip(a.id)} className="kb-ad-chip" data-locked={a.locked || undefined}>
            <Icon name={a.icon} size={15} />
            <span className="kb-ad-chip-label">{a.label}</span>
            <button
              type="button"
              className="kb-ad-lock"
              aria-pressed={!!a.locked}
              aria-label={a.locked ? `Unlock ${a.label}` : `Always ask before: ${a.label}`}
              title={a.locked ? "Always asks. Click to unlock" : "Lock so it always asks"}
              onClick={() => onLock(a.id)}
            >
              <Icon name={a.locked ? "lock" : "unlock"} size={14} />
            </button>
          </li>
        ))}
        {items.length === 0 ? <li className="kb-ad-empty">Nothing here at this setting</li> : null}
      </ul>
    </section>
  );
}

/**
 * FLIP: remember where each chip was, and after a re-render slide it from there to its new place.
 * Returns a ref factory keyed by id.
 */
function useFlip(reduced: boolean, deps: unknown[]) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const last = useRef(new Map<string, DOMRect>());

  useLayoutEffect(() => {
    nodes.current.forEach((el, id) => {
      const next = el.getBoundingClientRect();
      const prev = last.current.get(id);
      last.current.set(id, next);
      if (!prev || reduced) return;
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: 420, easing: "cubic-bezier(0.3, 1.25, 0.5, 1)" },
      );
    });
  }, deps);

  return (id: string) => (el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  };
}
