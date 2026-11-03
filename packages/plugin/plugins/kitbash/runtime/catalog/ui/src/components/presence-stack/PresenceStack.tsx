"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "../button/Button.tsx";
import { EmptyState } from "../empty-state/EmptyState.tsx";
import { ErrorState } from "../error-state/ErrorState.tsx";
import { FreshnessBadge } from "../freshness-badge/FreshnessBadge.tsx";
import { Skeleton, SkeletonCircle, SkeletonRegion } from "../skeleton/Skeleton.tsx";
import { Avatar, Icon, clockTime, cx, useNow, type LoadStatus } from "../../shared/index.ts";
import "./presence-stack.css";

export type MemberKind = "person" | "agent";
export type PresenceState = "active" | "idle" | "away";

export interface PresenceMember {
  id: string;
  name: string;
  kind: MemberKind;
  /** active: moving or typing now; idle: tab open, no input for a while; away: tab in the background */
  state: PresenceState;
  /** What they have open, e.g. "Pricing table" */
  viewing: string;
  /** When they arrived, ms since epoch */
  since: number;
  /** Photo URL for people; agents always wear the Kitbash mark */
  src?: string;
}

export interface PresenceStackProps {
  members?: PresenceMember[];
  /** Avatars shown before the rest fold into the overflow key */
  max?: number;
  /** Who you follow (controlled). Pass with onFollow; omit both to let the component keep it */
  following?: string | null;
  onFollow?: (id: string | null) => void;
  /** Open the full list on mount (useful for docs and tests) */
  defaultOpen?: boolean;
  /** Names the place, read to screen readers: "People in Pricing experiment" */
  label?: string;
  loading?: boolean;
  /** Presence could not be read; shown inside the list with a retry */
  error?: string | null;
  onRetry?: () => void;
  /** Freshness of the presence feed, from useCachedLoader or your socket */
  status?: LoadStatus;
  updatedAt?: number | null;
  onRefresh?: () => void;
  /** Shown as the empty state's action when nobody else is here */
  onInvite?: () => void;
  className?: string;
}

const MIN = 60_000;
const base = Date.now();

export const defaultPresenceMembers: PresenceMember[] = [
  { id: "maya", name: "Maya Chen", kind: "person", state: "active", viewing: "Pricing table", since: base - 42 * MIN },
  { id: "kitbash", name: "Kitbash", kind: "agent", state: "active", viewing: "Drafting the launch FAQ", since: base - 6 * MIN },
  { id: "dev", name: "Dev Patel", kind: "person", state: "active", viewing: "Rollout plan", since: base - 18 * MIN },
  { id: "priya", name: "Priya Raman", kind: "person", state: "idle", viewing: "Pricing table", since: base - 75 * MIN },
  { id: "jonas", name: "Jonas Berg", kind: "person", state: "active", viewing: "Open questions", since: base - 3 * MIN },
  { id: "reviewer", name: "Review agent", kind: "agent", state: "idle", viewing: "Waiting for the next edit", since: base - 51 * MIN },
  { id: "amara", name: "Amara Okafor", kind: "person", state: "away", viewing: "Pricing table", since: base - 128 * MIN },
  { id: "leo", name: "Leo Duarte", kind: "person", state: "idle", viewing: "Rollout plan", since: base - 9 * MIN },
];

const STATE_RANK: Record<PresenceState, number> = { active: 0, idle: 1, away: 2 };

/**
 * Who comes first: active before idle before away; within a state, people before agents (agents are present
 * because people asked for them), then whoever arrived last. The person you follow always leads.
 */
export function sortPresence(members: PresenceMember[], following?: string | null): PresenceMember[] {
  return [...members].sort((a, b) => {
    if (a.id === following) return -1;
    if (b.id === following) return 1;
    const s = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (s) return s;
    if (a.kind !== b.kind) return a.kind === "person" ? -1 : 1;
    return b.since - a.since;
  });
}

function stayed(since: number, now: number | null): string {
  if (!now) return `since ${clockTime(since)}`;
  const m = Math.max(1, Math.round((now - since) / MIN));
  if (m < 60) return `for ${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `for ${h}h ${rest}m` : `for ${h}h`;
}

const STATE_WORD: Record<PresenceState, string> = { active: "Active", idle: "Idle", away: "Away" };

export interface MemberAvatarProps {
  name: string;
  kind: MemberKind;
  size?: number;
  src?: string;
  /** Draws the presence indicator on the avatar's shoulder */
  state?: PresenceState;
}

/**
 * A member's face. People are round initials discs; agents are square parts that carry the Kitbash sprue mark,
 * so a glance at any stack tells people from agents. The shoulder light is green for an active person, cobalt
 * for an agent at work, a hollow ring when idle, and nothing (the face dims) when away.
 */
export function MemberAvatar({ name, kind, size = 28, src, state }: MemberAvatarProps) {
  return (
    <span className="kb-mav" data-kind={kind} data-state={state} style={{ width: size, height: size }}>
      {kind === "agent" ? (
        <span className="kb-mav-agent" title={name}>
          <Icon name="sparkle" size={Math.round(size * 0.62)} strokeWidth={2} />
        </span>
      ) : (
        <Avatar name={name} size={size} src={src} />
      )}
      {state && state !== "away" ? <i className="kb-mav-light" aria-hidden /> : null}
    </span>
  );
}

/**
 * Who is here right now. Faces overlap in a tray, the overflow is a key that opens everyone with what they are
 * looking at and for how long, and any face can be followed.
 */
export function PresenceStack({
  members = defaultPresenceMembers,
  max = 4,
  following: followingProp,
  onFollow,
  defaultOpen = false,
  label = "People in Launch plan",
  loading = false,
  error,
  onRetry,
  status,
  updatedAt,
  onRefresh,
  onInvite,
  className,
}: PresenceStackProps) {
  const [ownFollowing, setOwnFollowing] = useState<string | null>(null);
  const following = followingProp !== undefined ? followingProp : ownFollowing;
  const [open, setOpen] = useState(defaultOpen);
  const [say, setSay] = useState("");
  const now = useNow(30_000);
  const rootRef = useRef<HTMLDivElement>(null);
  const keyRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const follow = (m: PresenceMember) => {
    const next = following === m.id ? null : m.id;
    if (followingProp === undefined) setOwnFollowing(next);
    onFollow?.(next);
    setSay(next ? `Following ${m.name}. Your view moves with theirs.` : `Stopped following ${m.name}.`);
  };

  // Close on a press outside; Escape is handled on the list itself
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Opening moves focus to the first row's follow key, so the list is usable from the keyboard at once
  const opened = useRef(false);
  useEffect(() => {
    if (open && opened.current) listRef.current?.querySelector<HTMLElement>("button")?.focus();
    opened.current = true;
  }, [open]);

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      keyRef.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const keys = [...(listRef.current?.querySelectorAll<HTMLElement>(".kb-ps-row .kb-btn") ?? [])];
    const at = keys.indexOf(document.activeElement as HTMLElement);
    const next = keys[(at + (e.key === "ArrowDown" ? 1 : keys.length - 1)) % keys.length];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  if (loading) {
    return (
      <SkeletonRegion label="Loading who is here" className={cx("kb-ps", className)}>
        <div className="kb-ps-tray">
          {Array.from({ length: Math.min(max, 4) }, (_, i) => (
            <span key={i} className="kb-ps-skel-face"><SkeletonCircle size={28} /></span>
          ))}
          <Skeleton width={34} height={28} radius="control" style={{ marginLeft: 6 }} />
        </div>
      </SkeletonRegion>
    );
  }

  const sorted = sortPresence(members, following);
  const failed = Boolean(error);
  // A failed feed shows no faces: stale presence would claim people are here who may have left
  const shown = failed ? [] : sorted.slice(0, max);
  const rest = failed ? 0 : sorted.length - shown.length;
  const activeCount = members.filter((m) => m.state === "active").length;
  const empty = !failed && members.length === 0;

  return (
    <div ref={rootRef} className={cx("kb-ps", className)} role="group" aria-label={label}>
      <div className="kb-ps-tray">
        {empty ? <span className="kb-ps-alone">Just you</span> : null}
        {failed ? <span className="kb-ps-alone">Presence unavailable</span> : null}
        {shown.map((m, i) => (
          <button
            key={m.id}
            type="button"
            className="kb-ps-face"
            data-following={following === m.id || undefined}
            style={{ zIndex: shown.length - i }}
            aria-pressed={following === m.id}
            aria-label={`${m.name}${m.kind === "agent" ? ", agent" : ""}, ${STATE_WORD[m.state].toLowerCase()}, on ${m.viewing}. ${following === m.id ? "Stop following" : "Follow"}`}
            onClick={() => follow(m)}
          >
            <MemberAvatar name={m.name} kind={m.kind} src={m.src} state={m.state} />
            <span className="kb-ps-tip" aria-hidden>
              <strong>{m.name}</strong>
              <span>{m.viewing}</span>
            </span>
          </button>
        ))}
        <button
          ref={keyRef}
          type="button"
          className="kb-ps-key"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={rest > 0 ? `${rest} more here, show everyone` : "Show everyone here"}
          onClick={() => setOpen((o) => !o)}
          data-bare={rest <= 0 || undefined}
        >
          {rest > 0 ? `+${rest}` : <Icon name="chevronDown" size={14} />}
        </button>
      </div>

      {open ? (
        <div id={listId} ref={listRef} className="kb-ps-pop" role="dialog" aria-label="Everyone here" onKeyDown={onListKey}>
          <header className="kb-ps-pop-head">
            <h3>Here now</h3>
            {!failed && !empty ? <span>{activeCount} active of {members.length}</span> : null}
          </header>
          {failed ? (
            <ErrorState size="sm" title="Couldn't load who is here" body={error ?? ""} detail="" onRetry={onRetry ?? (() => {})} />
          ) : empty ? (
            <EmptyState
              size="sm"
              title="Nobody else is here"
              body="People and agents who open this page show up here."
              action={{ label: "Invite people", icon: "users", onClick: () => onInvite?.() }}
            />
          ) : (
            <ul className="kb-ps-list">
              {sorted.map((m) => (
                <li key={m.id} className="kb-ps-row" data-state={m.state} data-following={following === m.id || undefined}>
                  <MemberAvatar name={m.name} kind={m.kind} src={m.src} state={m.state} size={32} />
                  <span className="kb-ps-who">
                    <strong>{m.name}</strong>
                    <span>
                      {m.state === "active" ? "" : `${STATE_WORD[m.state]}, `}
                      {m.viewing}
                    </span>
                  </span>
                  <span className="kb-ps-since">{stayed(m.since, now)}</span>
                  <Button size="sm" variant={following === m.id ? "secondary" : "ghost"} aria-pressed={following === m.id} onClick={() => follow(m)} data-on={following === m.id || undefined}>
                    {following === m.id ? "Following" : "Follow"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {status ? (
            <footer className="kb-ps-pop-foot">
              <FreshnessBadge status={status} updatedAt={updatedAt ?? null} onRefresh={onRefresh} />
            </footer>
          ) : null}
        </div>
      ) : null}
      <p className="kb-sr" aria-live="polite">{say}</p>
    </div>
  );
}
