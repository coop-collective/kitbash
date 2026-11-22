import type { CSSProperties, ReactNode } from "react";
import { cx } from "../../shared/index.ts";
import "./skeleton.css";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** "part" (3px), "control" (5px), "card" (7px) or "round" */
  radius?: "part" | "control" | "card" | "round";
  className?: string;
  style?: CSSProperties;
}

/**
 * A placeholder part in unpainted primer gray. Every skeleton on the page shares one light sweep (the gradient is
 * fixed to the viewport), so a loading screen reads as one surface, not dozens of blinking boxes.
 */
export function Skeleton({ width = "100%", height = 12, radius = "part", className, style }: SkeletonProps) {
  return <span className={cx("kb-skel", className)} data-radius={radius} style={{ width, height, ...style }} aria-hidden />;
}

export interface SkeletonTextProps {
  lines?: number;
  /** Width of the last line, so a paragraph ends ragged like real text */
  lastWidth?: string;
  lineHeight?: number;
  className?: string;
}

/** Lines of placeholder text at the body line height. */
export function SkeletonText({ lines = 3, lastWidth = "62%", lineHeight = 20, className }: SkeletonTextProps) {
  return (
    <span className={cx("kb-skel-text", className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={10} width={i === lines - 1 && lines > 1 ? lastWidth : "100%"} style={{ marginBlock: (lineHeight - 10) / 2 }} />
      ))}
    </span>
  );
}

/** Round placeholder for an avatar. */
export function SkeletonCircle({ size = 28 }: { size?: number }) {
  return <Skeleton width={size} height={size} radius="round" />;
}

/**
 * Announces loading to assistive tech once for a whole region; put skeletons inside it.
 * `label` names what is loading, e.g. "Loading members".
 */
export function SkeletonRegion({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx("kb-skel-region", className)} role="status" aria-live="polite" aria-busy="true">
      <span className="kb-sr">{label}</span>
      {children}
    </div>
  );
}
