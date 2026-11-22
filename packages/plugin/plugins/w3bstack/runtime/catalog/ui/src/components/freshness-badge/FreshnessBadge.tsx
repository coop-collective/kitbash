"use client";

import { Icon, Spinner, clockTime, cx, relativeTime, useNow, type LoadStatus } from "../../shared/index.ts";
import "./freshness-badge.css";

export interface FreshnessBadgeProps {
  /** Status from useCachedLoader (or your own loader) */
  status: LoadStatus;
  /** When the shown data was loaded, ms since epoch */
  updatedAt: number | null;
  /** Data older than this reads as cached rather than current */
  staleAfter?: number;
  /** Offer a refresh; called on press */
  onRefresh?: () => void;
  className?: string;
}

/**
 * Says how fresh the numbers on screen are, in one line: "Updated 2m ago", "Refreshing", "Showing cached data
 * from 14:02", or "Couldn't refresh". The indicator follows the library's status shapes; the refresh key presses in.
 */
export function FreshnessBadge({ status, updatedAt, staleAfter = 5 * 60_000, onRefresh, className }: FreshnessBadgeProps) {
  const now = useNow(15_000);
  const age = updatedAt && now ? now - updatedAt : 0;
  const state = status === "refreshing" || status === "loading" ? "refreshing" : status === "error" ? "error" : age > staleAfter ? "stale" : "fresh";
  const text =
    state === "refreshing"
      ? updatedAt
        ? "Refreshing"
        : "Loading"
      : state === "error"
        ? updatedAt
          ? `Couldn't refresh, showing ${clockTime(updatedAt)}`
          : "Couldn't load"
        : !updatedAt || !now
          ? "Up to date"
          : state === "stale"
            ? `Showing cached data from ${clockTime(updatedAt)}`
            : `Updated ${relativeTime(updatedAt, now)}`;

  return (
    <span className={cx("kb-fresh", className)} data-state={state} role="status" aria-live="polite">
      {state === "refreshing" ? <Spinner size={12} label={text} /> : <i className="kb-fresh-mark" aria-hidden />}
      <span>{text}</span>
      {onRefresh && state !== "refreshing" ? (
        <button type="button" className="kb-fresh-btn" onClick={onRefresh} aria-label={state === "error" ? "Try again" : "Refresh now"}>
          <Icon name="refresh" size={13} />
        </button>
      ) : null}
    </span>
  );
}
