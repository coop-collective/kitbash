"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "../button/Button.tsx";
import { ErrorState } from "../error-state/ErrorState.tsx";
import { Skeleton, SkeletonCircle, SkeletonRegion } from "../skeleton/Skeleton.tsx";
import { Avatar, cx, useNow } from "../../shared/index.ts";
import "./profile-card.css";

export type Presence = "online" | "away" | "focus" | "offline";

export interface PersonProfile {
  id: string;
  name: string;
  handle: string;
  role: string;
  team?: string;
  /** IANA time zone, e.g. "America/Los_Angeles" */
  timeZone: string;
  statusMessage?: string;
  presence: Presence;
  avatarUrl?: string;
  /** Working hours in their time zone, 24h clock */
  workHours?: [number, number];
}

export interface ProfileCardProps {
  person?: PersonProfile;
  onMessage?: (person: PersonProfile) => void;
  onViewProfile?: (person: PersonProfile) => void;
  loading?: boolean;
  /** The profile failed to load */
  error?: string | null;
  onRetry?: () => void;
  className?: string;
  id?: string;
}

export const DEMO_PERSON: PersonProfile = {
  id: "u_priya",
  name: "Priya Shah",
  handle: "priya",
  role: "Staff engineer, agent platform",
  team: "Platform",
  timeZone: "Asia/Kolkata",
  statusMessage: "Reviewing the refund agent's permission changes until Friday",
  presence: "online",
  workHours: [10, 19],
};

const PRESENCE_TEXT: Record<Presence, string> = { online: "Online", away: "Away", focus: "Focusing, notifications paused", offline: "Offline" };

/** Minutes east of UTC for a zone at a moment, e.g. 330 for Asia/Kolkata. */
export function zoneOffset(timeZone: string, at: number): number {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
    if (!m) return 0;
    return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  } catch {
    return 0;
  }
}

/** "14:02" in their zone, the hour as a number, and how far that is from the viewer: "4h 30m ahead of you". */
export function localTime(timeZone: string, now: number) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
  const text = fmt.format(now).replace(/^24/, "00");
  const [h = 0, mi = 0] = text.split(":").map(Number);
  const diff = zoneOffset(timeZone, now) + new Date(now).getTimezoneOffset();
  const abs = Math.abs(diff);
  const span = `${Math.floor(abs / 60) ? `${Math.floor(abs / 60)}h` : ""}${abs % 60 ? ` ${abs % 60}m` : ""}`.trim();
  const relation = diff === 0 ? "same time as you" : `${span} ${diff > 0 ? "ahead of" : "behind"} you`;
  return { text, hour: h + mi / 60, relation };
}

/**
 * A compact card for a person, made to float over a name on hover or focus. Their local time sits on an hour rail,
 * so "is now a good time to message" reads at a glance: their working hours are the solid run, and the tick is now.
 */
export function ProfileCard({ person = DEMO_PERSON, onMessage, onViewProfile, loading = false, error = null, onRetry, className, id }: ProfileCardProps) {
  const now = useNow(30_000);

  if (loading) {
    return (
      <span className={cx("kb-pc", className)} id={id}>
        <SkeletonRegion label="Loading profile">
          <span className="kb-pc-top">
            <SkeletonCircle size={48} />
            <span className="kb-pc-id">
              <Skeleton width="60%" height={13} />
              <Skeleton width="40%" height={10} style={{ marginTop: 8 }} />
              <Skeleton width="80%" height={10} style={{ marginTop: 8 }} />
            </span>
          </span>
          <span className="kb-pc-body">
            <Skeleton height={10} />
            <Skeleton width="70%" height={10} style={{ marginTop: 8 }} />
            <Skeleton height={6} style={{ marginTop: 14 }} />
          </span>
          <span className="kb-pc-actions">
            <Skeleton width={104} height={28} radius="control" />
            <Skeleton width={96} height={28} radius="control" />
          </span>
        </SkeletonRegion>
      </span>
    );
  }

  if (error) {
    return (
      <span className={cx("kb-pc", className)} id={id}>
        <ErrorState size="sm" title="Couldn't load this profile" body={error} detail={undefined} onRetry={onRetry} />
      </span>
    );
  }

  const t = now ? localTime(person.timeZone, now) : null;
  const [from, to] = person.workHours ?? [9, 18];
  const working = t ? t.hour >= from && t.hour < to : true;

  return (
    <span className={cx("kb-pc", className)} id={id}>
      <span className="kb-pc-top">
        <span className="kb-pc-avatar">
          <Avatar name={person.name} size={48} src={person.avatarUrl} />
          {person.presence !== "offline" ? <i className="kb-pc-presence" data-presence={person.presence} role="img" aria-label={PRESENCE_TEXT[person.presence]} /> : null}
        </span>
        <span className="kb-pc-id">
          <strong className="kb-pc-name">{person.name}</strong>
          <span className="kb-pc-handle">@{person.handle}{person.presence === "offline" ? <span className="kb-pc-off">Offline</span> : null}</span>
          <span className="kb-pc-role">{person.role}</span>
        </span>
      </span>

      <span className="kb-pc-body">
        {person.presence === "focus" ? <span className="kb-pc-focus">Notifications paused while they focus</span> : null}
        {person.statusMessage ? <span className="kb-pc-status">{person.statusMessage}</span> : null}
        <span className="kb-pc-time">
          <span>
            <code>{t?.text ?? "--:--"}</code> local{t && !working ? ", after hours" : ""}
          </span>
          {t ? <span className="kb-pc-rel">{t.relation}</span> : null}
        </span>
        <HourRail hour={t?.hour ?? null} from={from} to={to} />
      </span>

      <span className="kb-pc-actions">
        <Button size="sm" icon="message" onClick={() => onMessage?.(person)}>Message</Button>
        <Button size="sm" variant="ghost" icon="user" onClick={() => onViewProfile?.(person)}>View profile</Button>
      </span>
    </span>
  );
}

function HourRail({ hour, from, to }: { hour: number | null; from: number; to: number }) {
  return (
    <span className="kb-pc-rail" aria-hidden>
      <i className="kb-pc-rail-work" style={{ left: `${(from / 24) * 100}%`, width: `${((to - from) / 24) * 100}%` }} />
      {hour !== null ? <i className="kb-pc-rail-now" style={{ left: `${(hour / 24) * 100}%` }} /> : null}
    </span>
  );
}

export interface ProfileLinkProps {
  /** The person to show; while undefined the card shows its skeleton */
  person?: PersonProfile;
  /** Trigger text; defaults to the person's name */
  children?: ReactNode;
  /** Hover delay before opening, ms */
  openDelay?: number;
  closeDelay?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  /** Placement of the card under the name */
  align?: "start" | "end";
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onMessage?: (person: PersonProfile) => void;
  onViewProfile?: (person: PersonProfile) => void;
  className?: string;
}

/**
 * An inline name that opens the person's ProfileCard: after a short hover delay (so passing the pointer over a list
 * doesn't flash cards), at once on keyboard focus, and on click or tap. Escape closes it and keeps focus on the name.
 */
export function ProfileLink({
  person = DEMO_PERSON,
  children,
  openDelay = 450,
  closeDelay = 220,
  open: openProp,
  onOpenChange,
  defaultOpen = false,
  align = "start",
  loading = false,
  error = null,
  onRetry,
  onMessage,
  onViewProfile,
  className,
}: ProfileLinkProps) {
  const id = useId();
  const [inner, setInner] = useState(defaultOpen);
  const open = openProp ?? inner;
  const openRef = useRef(open);
  openRef.current = open;
  const timer = useRef<number | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const [flip, setFlip] = useState(false);

  // Keep the card on screen: open toward the side with room
  useEffect(() => {
    if (!open) return setFlip(false);
    const el = pop.current;
    if (!el || align === "end") return;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) setFlip(true);
  }, [open, align]);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);

  const set = (next: boolean) => {
    clear();
    if (next === openRef.current) return;
    if (openProp === undefined) setInner(next);
    onOpenChange?.(next);
  };
  const later = (next: boolean, ms: number) => {
    clear();
    timer.current = window.setTimeout(() => set(next), ms);
  };

  return (
    <span
      ref={wrap}
      className={cx("kb-pc-anchor", className)}
      onMouseEnter={() => (open ? clear() : later(true, openDelay))}
      onMouseLeave={() => (open ? later(false, closeDelay) : clear())}
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node | null)) set(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          set(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="kb-pc-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? `${id}-card` : undefined}
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) set(true);
        }}
        onClick={() => set(!open)}
      >
        {children ?? person.name}
      </button>
      {open ? (
        <span ref={pop} className="kb-pc-pop" data-align={flip ? "end" : align} role="dialog" aria-label={`${person.name}'s profile`}>
          <ProfileCard id={`${id}-card`} person={person} loading={loading} error={error} onRetry={onRetry} onMessage={onMessage} onViewProfile={onViewProfile} />
        </span>
      ) : null}
    </span>
  );
}
