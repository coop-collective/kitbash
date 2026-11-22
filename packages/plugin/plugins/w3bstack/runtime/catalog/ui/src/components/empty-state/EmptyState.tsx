"use client";

import type { ReactNode } from "react";
import { Button } from "../button/Button.tsx";
import { cx, type IconName } from "../../shared/index.ts";
import "./empty-state.css";

export interface EmptyStateProps {
  /** What is empty, said plainly: "No runs yet" */
  title?: string;
  /** What to do about it; null for none */
  body?: ReactNode | null;
  /** The one action that fills it; null for none */
  action?: { label: string; icon?: IconName; onClick: () => void } | null;
  /** Compact form for inside a table or a small card */
  size?: "md" | "sm";
  className?: string;
}

/**
 * An empty socket in a kit tray: the outline of the part that belongs here, and the one action that puts it there.
 * Empty screens are an invitation to act, so the copy says what to do, not how it feels.
 */
export function EmptyState({
  title = "No runs yet",
  body = "Start a run and its plan, tool calls and cost will show up here.",
  action = { label: "Start a run", icon: "play", onClick: () => {} },
  size = "md",
  className,
}: EmptyStateProps) {
  return (
    <div className={cx("kb-empty", className)} data-size={size}>
      <svg className="kb-empty-socket" viewBox="0 0 64 48" aria-hidden>
        <rect x="1" y="1" width="62" height="46" rx="5" />
        <rect x="14" y="11" width="36" height="26" rx="3" />
        <path d="M32 1v10M32 37v10M1 24h13M50 24h13" />
      </svg>
      <div className="kb-empty-text">
        <h3>{title}</h3>
        {body ? <p>{body}</p> : null}
      </div>
      {action ? (
        <Button variant="primary" size={size === "sm" ? "sm" : "md"} icon={action.icon} onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
