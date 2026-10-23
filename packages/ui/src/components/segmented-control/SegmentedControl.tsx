import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { cx, Icon, type IconName } from "../../shared/index.ts";
import "./segmented-control.css";

export interface SegmentOption {
  value: string;
  label: string;
  icon?: IconName;
  /** Tabular count shown in a small recessed chip */
  count?: number;
  /** A dot badge. "decal" means something here waits on a person */
  badge?: "decal" | "danger" | "accent";
  /** Read by screen readers for the badge, e.g. "needs review" */
  badgeLabel?: string;
  /** Hide the label visually (icon-only); it stays as the accessible name */
  iconOnly?: boolean;
}

export interface SegmentedControlProps {
  /** Two to six options */
  options?: SegmentOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** "pill" slides a raised part in a recessed track; "underline" slides a bar under the labels */
  variant?: "pill" | "underline";
  size?: "sm" | "md";
  /** Accessible name of the group */
  label?: string;
  /** Let the indicator be dragged across and dropped on an option */
  draggable?: boolean;
  /** Stretch options to fill the container */
  fill?: boolean;
  className?: string;
}

export const DEMO_SEGMENTS: SegmentOption[] = [
  { value: "all", label: "All runs", count: 128 },
  { value: "running", label: "Running", icon: "play", count: 4 },
  { value: "review", label: "Needs review", count: 3, badge: "decal", badgeLabel: "waiting on you" },
  { value: "failed", label: "Failed", count: 2 },
];

type Edges = { left: number; right: number };

/**
 * Segmented control: a radiogroup of two to six options. The indicator is one molded slider in a recessed
 * track with a detent seam between options. It glides with its leading edge first (so it stretches a little),
 * lifts when you drag it, and snaps with a small overshoot into the detent it is dropped on.
 */
export function SegmentedControl({
  options = DEMO_SEGMENTS,
  value,
  defaultValue,
  onChange,
  variant = "pill",
  size = "md",
  label = "Filter runs",
  draggable = true,
  fill = false,
  className,
}: SegmentedControlProps) {
  const uid = useId();
  const [inner, setInner] = useState(defaultValue ?? options[0]?.value ?? "");
  const current = value ?? inner;
  const index = Math.max(0, options.findIndex((o) => o.value === current));

  const trackRef = useRef<HTMLDivElement>(null);
  const segRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [edges, setEdges] = useState<Edges | null>(null);
  const [dir, setDir] = useState<"left" | "right">("right");
  const [drag, setDrag] = useState<{ left: number; width: number; near: number } | null>(null);
  const press = useRef<{ x: number; pointer: number; dragging: boolean; grabOffset: number } | null>(null);
  const suppressClick = useRef(false);
  const prevIndex = useRef(index);

  const select = useCallback(
    (next: number) => {
      const opt = options[next];
      if (!opt) return;
      if (value === undefined) setInner(opt.value);
      if (opt.value !== current) onChange?.(opt.value);
    },
    [options, value, current, onChange],
  );

  const measure = useCallback(() => {
    const track = trackRef.current;
    const seg = segRefs.current[index];
    if (!track || !seg) return;
    setEdges({ left: seg.offsetLeft, right: track.clientWidth - seg.offsetLeft - seg.offsetWidth });
  }, [index]);

  useLayoutEffect(() => {
    if (index !== prevIndex.current) setDir(index > prevIndex.current ? "right" : "left");
    prevIndex.current = index;
    measure();
  }, [index, measure, options.length]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(track);
    return () => observer.disconnect();
  }, [measure]);

  /** Which option's center is closest to x (track coordinates). */
  const nearest = (x: number) => {
    let best = 0;
    let bestDist = Infinity;
    segRefs.current.forEach((seg, i) => {
      if (!seg) return;
      const d = Math.abs(seg.offsetLeft + seg.offsetWidth / 2 - x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // A drag's pointerup may not produce a click on an option, so clear the guard at the next press.
    suppressClick.current = false;
    if (!draggable || event.button !== 0) return;
    const seg = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-kb-seg]");
    const track = trackRef.current;
    // Only the selected option (the one under the slider) starts a drag.
    if (!seg || !track || Number(seg.dataset.kbSeg) !== index) return;
    const x = event.clientX - track.getBoundingClientRect().left;
    press.current = { x: event.clientX, pointer: event.pointerId, dragging: false, grabOffset: x - seg.offsetLeft };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    const track = trackRef.current;
    const seg = segRefs.current[index];
    if (!p || !track || !seg || p.pointer !== event.pointerId) return;
    if (!p.dragging) {
      if (Math.abs(event.clientX - p.x) < 4) return;
      p.dragging = true;
      track.setPointerCapture(event.pointerId);
    }
    const width = seg.offsetWidth;
    const x = event.clientX - track.getBoundingClientRect().left;
    const pad = variant === "pill" ? 3 : 0;
    const left = Math.min(Math.max(x - p.grabOffset, pad), track.clientWidth - width - pad);
    setDrag({ left, width, near: nearest(left + width / 2) });
  };

  const endPress = (event: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    press.current = null;
    if (!p || !p.dragging) return;
    suppressClick.current = true;
    if (trackRef.current?.hasPointerCapture(event.pointerId)) trackRef.current.releasePointerCapture(event.pointerId);
    const near = drag?.near ?? index;
    setDrag(null);
    setDir(near >= index ? "right" : "left");
    select(near);
    segRefs.current[near]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const n = options.length;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % n;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + n) % n;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = n - 1;
    if (next === null) return;
    event.preventDefault();
    select(next);
    segRefs.current[next]?.focus();
  };

  const indicatorStyle =
    drag !== null && trackRef.current
      ? { left: drag.left, right: trackRef.current.clientWidth - drag.left - drag.width }
      : edges
        ? { left: edges.left, right: edges.right }
        : { opacity: 0 };
  const lit = drag ? drag.near : index;

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={label}
      className={cx("kb-seg", className)}
      data-variant={variant}
      data-size={size}
      data-fill={fill || undefined}
      data-dir={dir}
      data-dragging={drag ? true : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPress}
      onPointerCancel={endPress}
    >
      <span className="kb-seg-slider" aria-hidden style={indicatorStyle} />
      {options.map((opt, i) => {
        const checked = i === index;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              segRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            id={`${uid}-${opt.value}`}
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="kb-seg-option"
            data-kb-seg={i}
            data-lit={i === lit || undefined}
            data-seam={i > 0 && i !== lit && i - 1 !== lit ? true : undefined}
            aria-label={opt.iconOnly ? opt.label : undefined}
            title={opt.iconOnly ? opt.label : undefined}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              select(i);
            }}
          >
            {opt.icon ? <Icon name={opt.icon} size={size === "sm" ? 14 : 16} /> : null}
            {opt.iconOnly ? null : <span className="kb-seg-label">{opt.label}</span>}
            {opt.count !== undefined ? <span className="kb-seg-count">{opt.count.toLocaleString("en-US")}</span> : null}
            {opt.badge ? (
              <span className="kb-seg-badge" data-tone={opt.badge}>
                {opt.badgeLabel ? <span className="kb-sr">, {opt.badgeLabel}</span> : null}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
