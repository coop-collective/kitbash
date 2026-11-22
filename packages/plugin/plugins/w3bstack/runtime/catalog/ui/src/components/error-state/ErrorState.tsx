"use client";

import { Button } from "../button/Button.tsx";
import { cx } from "../../shared/index.ts";
import "./error-state.css";

export interface ErrorStateProps {
  /** What failed, plainly: "Couldn't load members" */
  title?: string;
  /** How to fix it, or what happens next; null for none */
  body?: string | null;
  /** Technical detail people can copy into a report, e.g. a status and request id; null for none */
  detail?: string | null;
  /** Shows the retry key; null hides it */
  onRetry?: (() => void) | null;
  /** Disables the button and shows the spinner while a retry runs */
  retrying?: boolean;
  size?: "md" | "sm";
  className?: string;
}

/**
 * A failure explained, not apologized for: what went wrong, how to fix it, the detail to copy into a report, and a
 * retry key. The crimson square is the library's failed shape.
 */
export function ErrorState({
  title = "Couldn't load members",
  body = "The workspace API didn't answer in time. Your data is safe; try again.",
  detail = "504 Gateway Timeout, request 7f3c9a2e",
  onRetry = () => {},
  retrying = false,
  size = "md",
  className,
}: ErrorStateProps) {
  return (
    <div className={cx("kb-err", className)} data-size={size} role="alert">
      <i className="kb-err-mark" aria-hidden />
      <div className="kb-err-text">
        <h3>{title}</h3>
        {body ? <p>{body}</p> : null}
        {detail ? <code>{detail}</code> : null}
      </div>
      {onRetry ? (
        <Button size={size === "sm" ? "sm" : "md"} icon="refresh" onClick={onRetry} loading={retrying} loadingLabel="Retrying">
          Try again
        </Button>
      ) : null}
    </div>
  );
}
