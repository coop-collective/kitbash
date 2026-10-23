"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { cx, Icon, Spinner, useReducedMotion } from "../../shared/index.ts";
import type { IconName } from "../../shared/index.ts";
import "./toaster.css";

/* ------------------------------------------------------------------ */
/* Store: a tiny module-level queue so `toast()` works from anywhere.  */
/* ------------------------------------------------------------------ */

export type ToastKind = "default" | "success" | "error" | "info" | "loading" | "needs-you";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Reuse an id to update a toast in place (that is how promise toasts morph) */
  id?: string;
  kind?: ToastKind;
  description?: ReactNode;
  action?: ToastAction;
  /** Milliseconds before it leaves on its own; Infinity keeps it until dismissed */
  duration?: number;
  /** Which <Toaster id> shows it; only needed when a page hosts more than one */
  toaster?: string;
  /** Text for screen readers when `title` is not a plain string */
  announce?: string;
}

export interface ToastData {
  id: string;
  kind: ToastKind;
  title: ReactNode;
  description?: ReactNode;
  action?: ToastAction;
  duration: number;
  toaster: string;
  announce: string;
  /** Bumps on every update so timers restart and the live region re-announces */
  version: number;
  dismissed: boolean;
}

export interface PromiseMessages<T> {
  loading: ReactNode;
  success: ReactNode | ((value: T) => ReactNode);
  error: ReactNode | ((reason: unknown) => ReactNode);
  description?: ReactNode;
  toaster?: string;
}

const DEFAULT_DURATION: Record<ToastKind, number> = {
  default: 4500,
  info: 4500,
  success: 4000,
  error: 8000,
  loading: Infinity,
  "needs-you": Infinity,
};

let queue: ToastData[] = [];
let counter = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  return queue;
}

function textOf(node: ReactNode): string {
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}

function upsert(title: ReactNode, options: ToastOptions = {}): string {
  const id = options.id ?? `toast-${++counter}`;
  const existing = queue.find((t) => t.id === id);
  const kind = options.kind ?? "default";
  const next: ToastData = {
    id,
    kind,
    title,
    description: options.description,
    action: options.action,
    duration: options.duration ?? DEFAULT_DURATION[kind],
    toaster: options.toaster ?? existing?.toaster ?? "default",
    announce: options.announce ?? [textOf(title), textOf(options.description)].filter(Boolean).join(". "),
    version: (existing?.version ?? 0) + 1,
    dismissed: false,
  };
  queue = existing ? queue.map((t) => (t.id === id ? next : t)) : [...queue, next];
  emit();
  return id;
}

function remove(id: string) {
  queue = queue.filter((t) => t.id !== id);
  emit();
}

/** Mark a toast as leaving; the host plays the exit and the store drops it a beat later. Omit `id` to clear all. */
function dismiss(id?: string) {
  const targets = queue.filter((t) => (id === undefined || t.id === id) && !t.dismissed);
  if (!targets.length) return;
  queue = queue.map((t) => (targets.includes(t) ? { ...t, dismissed: true } : t));
  emit();
  for (const t of targets) window.setTimeout(() => remove(t.id), 240);
}

function kindShortcut(kind: ToastKind) {
  return (title: ReactNode, options: Omit<ToastOptions, "kind"> = {}) => upsert(title, { ...options, kind });
}

/**
 * Show a toast from anywhere: event handlers, effects, plain modules. Returns the toast id.
 * `toast.promise` shows a loading toast that morphs into success or error when the promise settles.
 */
export const toast = Object.assign((title: ReactNode, options?: ToastOptions) => upsert(title, options), {
  success: kindShortcut("success"),
  error: kindShortcut("error"),
  info: kindShortcut("info"),
  loading: kindShortcut("loading"),
  /** Decal-yellow toast that stays until someone acts on it */
  needsYou: kindShortcut("needs-you"),
  dismiss,
  /** Dismiss every toast shown by one host */
  clear(toasterId = "default") {
    for (const t of queue) if (t.toaster === toasterId) dismiss(t.id);
  },
  promise<T>(promise: Promise<T>, messages: PromiseMessages<T>): Promise<T> {
    const base = { description: messages.description, toaster: messages.toaster };
    const id = upsert(messages.loading, { ...base, kind: "loading" });
    promise.then(
      (value) => {
        const title = typeof messages.success === "function" ? messages.success(value) : messages.success;
        upsert(title, { ...base, id, kind: "success", description: undefined });
      },
      (reason: unknown) => {
        const title = typeof messages.error === "function" ? messages.error(reason) : messages.error;
        upsert(title, { ...base, id, kind: "error", description: undefined });
      },
    );
    return promise;
  },
});

/** Subscribe to the live toast list, e.g. to show a count elsewhere. */
export function useToasts(toasterId = "default"): ToastData[] {
  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  return all.filter((t) => t.toaster === toasterId);
}

/* ------------------------------------------------------------------ */
/* Host                                                                */
/* ------------------------------------------------------------------ */

export type ToasterPosition = "bottom-right" | "bottom-left" | "bottom-center" | "top-right" | "top-center";

export interface ToasterProps {
  /** Matches `toast(..., { toaster })`; leave as "default" for a single host */
  id?: string;
  position?: ToasterPosition;
  /** Pin the stack inside the nearest positioned ancestor instead of the viewport (previews, panels) */
  contained?: boolean;
  /** How many toasts peek out behind the front one while collapsed */
  peek?: number;
  /** Always fan the stack out instead of only on hover or focus */
  expand?: boolean;
  className?: string;
}

const KIND_ICON: Partial<Record<ToastKind, IconName>> = {
  default: "sparkle",
  success: "check",
  error: "alert",
  info: "info",
  "needs-you": "bell",
};

/** Distance a toast must be pulled before it unseats; under it the toast resists like a part held by its socket */
const DETENT = 64;
const GAP = 8;

/**
 * Host for `toast()` calls. Render one near the app root. Toasts stack with only their molded top edges showing,
 * fan out on hover or focus (timers pause while fanned), and can be pulled sideways past a detent to dismiss.
 */
export function Toaster({ id = "default", position = "bottom-right", contained = false, peek = 3, expand = false, className }: ToasterProps) {
  const toasts = useToasts(id);
  const ordered = [...toasts].reverse(); // newest in front
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const expanded = expand || hovered || focused;
  const [heights, setHeights] = useState<Record<string, number>>({});
  const reduced = useReducedMotion();
  const top = position.startsWith("top");

  const onHeight = useCallback((toastId: string, h: number) => {
    setHeights((prev) => (prev[toastId] === h ? prev : { ...prev, [toastId]: h }));
  }, []);

  // Live region: append one line per new or changed toast so repeats are still read out
  const [lines, setLines] = useState<Array<{ key: string; text: string; urgent: boolean }>>([]);
  const seen = useRef(new Map<string, number>());
  useEffect(() => {
    const fresh: typeof lines = [];
    for (const t of toasts) {
      if (t.dismissed || seen.current.get(t.id) === t.version) continue;
      seen.current.set(t.id, t.version);
      if (t.announce) fresh.push({ key: `${t.id}-${t.version}`, text: t.announce, urgent: t.kind === "error" });
    }
    if (fresh.length) setLines((prev) => [...prev, ...fresh].slice(-4));
  }, [toasts]);

  const live = ordered.filter((t) => !t.dismissed);
  const frontHeight = heights[live[0]?.id ?? ""] ?? 64;
  let running = 0;
  const offsets = new Map<string, number>();
  for (const t of live) {
    offsets.set(t.id, running);
    running += (heights[t.id] ?? 64) + GAP;
  }
  const stackHeight = live.length === 0 ? 0 : expanded ? running - GAP : frontHeight + Math.min(live.length - 1, peek) * 10;

  return (
    <section
      className={cx("kb-root kb-toaster", className)}
      data-position={position}
      data-contained={contained || undefined}
      aria-label="Notifications"
    >
      <ol
        className="kb-toaster-list"
        data-expanded={expanded || undefined}
        style={{ height: stackHeight }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
        }}
      >
        {ordered.map((t) => {
          const index = live.indexOf(t);
          const depth = index < 0 ? 0 : index;
          const offset = expanded ? (offsets.get(t.id) ?? 0) : depth * 10;
          const style: CSSProperties = {
            transform: `translateY(${top ? offset : -offset}px) scale(${expanded ? 1 : 1 - depth * 0.05})`,
            zIndex: 100 - depth,
            height: !expanded && depth > 0 ? frontHeight : undefined,
          };
          return (
            <ToastItem
              key={t.id}
              data={t}
              style={style}
              hidden={!expanded && depth > peek}
              behind={!expanded && depth > 0}
              paused={hovered || focused}
              reduced={reduced}
              onHeight={onHeight}
            />
          );
        })}
      </ol>
      <div className="kb-sr" role="status" aria-live="polite" aria-atomic="false">
        {lines.filter((l) => !l.urgent).map((l) => <p key={l.key}>{l.text}</p>)}
      </div>
      <div className="kb-sr" role="alert" aria-live="assertive" aria-atomic="false">
        {lines.filter((l) => l.urgent).map((l) => <p key={l.key}>{l.text}</p>)}
      </div>
    </section>
  );
}

interface ToastItemProps {
  data: ToastData;
  style: CSSProperties;
  hidden: boolean;
  behind: boolean;
  paused: boolean;
  reduced: boolean;
  onHeight: (id: string, h: number) => void;
}

function ToastItem({ data, style, hidden, behind, paused, reduced, onHeight }: ToastItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const remaining = useRef(data.duration);
  const [drag, setDrag] = useState<{ x: number; dx: number } | null>(null);
  const [exitDir, setExitDir] = useState(1);

  // Measure the natural height of the body so the fanned stack can lay toasts end to end
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onHeight(data.id, el.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [data.id, onHeight]);

  // Each update (loading -> success) restarts the clock with the new kind's duration
  useEffect(() => {
    remaining.current = data.duration;
  }, [data.version, data.duration]);

  useEffect(() => {
    if (paused || data.dismissed || !Number.isFinite(remaining.current)) return;
    const started = Date.now();
    const timer = window.setTimeout(() => dismiss(data.id), Math.max(0, remaining.current));
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused, data.dismissed, data.version, data.id]);

  const dx = drag?.dx ?? 0;
  // Under the detent the toast barely moves (held by its socket); past it, it follows the pointer freely
  const shown = Math.abs(dx) < DETENT ? dx * 0.28 : dx;
  const unseated = Math.abs(dx) >= DETENT;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ x: e.clientX, dx: 0 });
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag) setDrag({ ...drag, dx: e.clientX - drag.x });
  };
  const onPointerUp = () => {
    if (!drag) return;
    if (unseated) {
      setExitDir(Math.sign(drag.dx) || 1);
      dismiss(data.id);
    }
    setDrag(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" || e.key === "Delete") {
      e.stopPropagation();
      dismiss(data.id);
    }
  };

  const icon = KIND_ICON[data.kind];
  return (
    <li
      className="kb-toast"
      data-kind={data.kind}
      data-leaving={data.dismissed || undefined}
      data-behind={behind || undefined}
      aria-hidden={hidden || behind || undefined}
      inert={hidden || behind || undefined}
      style={{ ...style, opacity: hidden ? 0 : undefined, "--exit-x": `${exitDir * 120}%` } as CSSProperties}
    >
      <div
        ref={ref}
        className="kb-toast-body"
        data-dragging={drag ? true : undefined}
        data-unseated={unseated || undefined}
        style={{ transform: drag ? `translateX(${shown}px) rotate(${unseated && !reduced ? shown / 60 : 0}deg)` : undefined }}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={onKeyDown}
      >
        <span className="kb-toast-icon" data-kind={data.kind} key={data.kind}>
          {data.kind === "loading" ? <Spinner size={14} label="In progress" /> : icon ? <Icon name={icon} size={15} strokeWidth={2.25} /> : null}
        </span>
        <div className="kb-toast-text">
          <p className="kb-toast-title">{data.title}</p>
          {data.description ? <p className="kb-toast-desc">{data.description}</p> : null}
        </div>
        {data.action ? (
          <button
            type="button"
            className="kb-toast-action"
            onClick={() => {
              data.action?.onClick();
              dismiss(data.id);
            }}
          >
            {data.action.label}
          </button>
        ) : null}
        <button type="button" className="kb-toast-close" aria-label="Dismiss notification" onClick={() => dismiss(data.id)}>
          <Icon name="x" size={14} />
        </button>
      </div>
    </li>
  );
}
