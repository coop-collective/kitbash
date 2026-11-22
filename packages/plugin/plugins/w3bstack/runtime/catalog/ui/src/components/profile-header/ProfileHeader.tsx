"use client";

import { useState } from "react";
import { Button } from "../button/Button.tsx";
import { ErrorState } from "../error-state/ErrorState.tsx";
import { FreshnessBadge } from "../freshness-badge/FreshnessBadge.tsx";
import { Skeleton, SkeletonCircle, SkeletonRegion, SkeletonText } from "../skeleton/Skeleton.tsx";
import { Avatar, Icon, Tag, cx, useNow, type LoadStatus } from "../../shared/index.ts";
import "./profile-header.css";

export interface PersonHeaderProfile {
  kind: "person";
  name: string;
  handle: string;
  title: string;
  team: string;
  location: string;
  /** IANA time zone for their local time */
  timeZone: string;
  bio: string;
  /** ms since epoch */
  joinedAt: number;
  runsApproved: number;
  reviews: number;
  avatarUrl?: string;
}

export type AgentPermissionLevel = "read" | "act" | "ask";

export interface AgentPermission {
  level: AgentPermissionLevel;
  /** What it covers, plainly: "Zendesk tickets", "Refunds up to $200" */
  scope: string;
}

export interface AgentHeaderProfile {
  kind: "agent";
  name: string;
  /** Agent id */
  handle: string;
  bio: string;
  model: string;
  owner: { name: string };
  permissions: AgentPermission[];
  working: boolean;
  runsThisWeek: number;
  /** 0..1 */
  successRate: number;
  /** Dollars per run */
  avgCost: number;
  createdAt: number;
}

export type HeaderProfile = PersonHeaderProfile | AgentHeaderProfile;

export interface ProfileHeaderProps {
  profile?: HeaderProfile;
  /** Whether you follow this person; with onFollowChange it is controlled */
  following?: boolean;
  onFollowChange?: (following: boolean) => void;
  onMessage?: () => void;
  /** Agent variant actions */
  onViewRuns?: () => void;
  onEditPermissions?: () => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Freshness of the stats */
  status?: LoadStatus;
  updatedAt?: number | null;
  onRefresh?: () => void;
  className?: string;
}

export const DEMO_PERSON_HEADER: PersonHeaderProfile = {
  kind: "person",
  name: "Priya Shah",
  handle: "priya",
  title: "Staff engineer",
  team: "Agent platform",
  location: "Bengaluru",
  timeZone: "Asia/Kolkata",
  bio: "I build the guardrails our agents run inside: permission scopes, approval routing and the replay tooling. Ask me about tool sandboxes or why a run got stopped.",
  joinedAt: Date.UTC(2023, 2, 14),
  runsApproved: 1284,
  reviews: 312,
};

export const DEMO_AGENT_HEADER: AgentHeaderProfile = {
  kind: "agent",
  name: "Refund agent",
  handle: "agt_refund_v3",
  bio: "Reads a support ticket, checks the order and the customer's history, and issues a refund or a store credit with a reply drafted in the customer's language.",
  model: "claude-sonnet-4.5",
  owner: { name: "Priya Shah" },
  permissions: [
    { level: "read", scope: "Zendesk tickets" },
    { level: "read", scope: "Stripe customers and charges" },
    { level: "act", scope: "Refunds up to $200" },
    { level: "act", scope: "Reply to tickets" },
    { level: "ask", scope: "Refunds over $200" },
    { level: "ask", scope: "Closing a ticket" },
  ],
  working: true,
  runsThisWeek: 214,
  successRate: 0.963,
  avgCost: 0.042,
  createdAt: Date.UTC(2025, 7, 2),
};

const LEVELS: Array<{ id: AgentPermissionLevel; label: string }> = [
  { id: "read", label: "Can read" },
  { id: "act", label: "Can do on its own" },
  { id: "ask", label: "Asks a person first" },
];

const monthYear = (at: number) => new Date(at).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

function localClock(timeZone: string, now: number) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now).replace(/^24/, "00");
  } catch {
    return null;
  }
}

/**
 * The top of a profile page. For a person: who they are, where and when they are, what they've reviewed, and a
 * Follow key that latches down while you follow. For an agent: the model it runs on, who owns it, and what it may
 * read, do on its own, or must ask a person about, with its run record.
 */
export function ProfileHeader({
  profile = DEMO_PERSON_HEADER,
  following: followingProp,
  onFollowChange,
  onMessage,
  onViewRuns,
  onEditPermissions,
  loading = false,
  error = null,
  onRetry,
  status,
  updatedAt = null,
  onRefresh,
  className,
}: ProfileHeaderProps) {
  const now = useNow(30_000);
  const [innerFollow, setInnerFollow] = useState(false);
  const following = followingProp ?? innerFollow;
  const toggleFollow = () => {
    if (followingProp === undefined) setInnerFollow(!following);
    onFollowChange?.(!following);
  };

  if (loading) {
    return (
      <section className={cx("kb-ph", className)} aria-label="Profile">
        <SkeletonRegion label="Loading profile">
          <div className="kb-ph-main">
            <SkeletonCircle size={80} />
            <div className="kb-ph-id">
              <Skeleton width={220} height={22} />
              <Skeleton width={280} height={12} style={{ marginTop: 12 }} />
              <Skeleton width={200} height={12} style={{ marginTop: 10 }} />
            </div>
            <div className="kb-ph-actions">
              <Skeleton width={104} height={36} radius="control" />
              <Skeleton width={96} height={36} radius="control" />
            </div>
          </div>
          <div className="kb-ph-bio"><SkeletonText lines={2} lastWidth="48%" /></div>
          <div className="kb-ph-foot kb-ph-stats">
            {[0, 1, 2].map((i) => (
              <div key={i} className="kb-ph-stat">
                <Skeleton width={64} height={20} />
                <Skeleton width={96} height={10} style={{ marginTop: 8 }} />
              </div>
            ))}
          </div>
        </SkeletonRegion>
      </section>
    );
  }

  if (error) {
    return (
      <section className={cx("kb-ph", className)} aria-label="Profile">
        <div className="kb-ph-state">
          <ErrorState title="Couldn't load this profile" body={error} onRetry={onRetry} />
        </div>
      </section>
    );
  }

  const fresh = status ? <FreshnessBadge className="kb-ph-fresh" status={status} updatedAt={updatedAt} onRefresh={onRefresh} /> : null;

  if (profile.kind === "agent") {
    const a = profile;
    return (
      <section className={cx("kb-ph", className)} data-kind="agent" aria-label={`${a.name}, agent profile`}>
        <div className="kb-ph-main">
          <span className="kb-ph-agent-mark" aria-hidden><Icon name="sparkle" size={36} /></span>
          <div className="kb-ph-id">
            <div className="kb-ph-name-row">
              <h2>{a.name}</h2>
              {a.working ? <Tag tone="agent" live>Working</Tag> : <Tag tone="neutral">Idle</Tag>}
            </div>
            <p className="kb-ph-handle"><code>{a.handle}</code></p>
            <ul className="kb-ph-meta">
              <li><Icon name="brain" size={15} />Runs on <code>{a.model}</code></li>
              <li><Icon name="user" size={15} />Owned by {a.owner.name}</li>
            </ul>
          </div>
          <div className="kb-ph-actions">
            <Button icon="play" onClick={onViewRuns}>View runs</Button>
            <Button variant="ghost" icon="shield" onClick={onEditPermissions}>Edit permissions</Button>
          </div>
        </div>
        <p className="kb-ph-bio">{a.bio}</p>
        <div className="kb-ph-perms" role="list" aria-label="Permissions">
          {LEVELS.map((l) => {
            const items = a.permissions.filter((p) => p.level === l.id);
            if (!items.length) return null;
            return (
              <div key={l.id} className="kb-ph-perm" data-level={l.id} role="listitem">
                <h3>{l.id === "ask" ? <i className="kb-ph-ask" aria-hidden /> : null}{l.label}</h3>
                <ul>{items.map((p) => <li key={p.scope}>{p.scope}</li>)}</ul>
              </div>
            );
          })}
        </div>
        <div className="kb-ph-foot">
          <dl className="kb-ph-stats">
            <div className="kb-ph-stat"><dt>Runs this week</dt><dd><code>{a.runsThisWeek.toLocaleString("en-US")}</code></dd></div>
            <div className="kb-ph-stat"><dt>Finished without help</dt><dd><code>{(a.successRate * 100).toFixed(1)}%</code></dd></div>
            <div className="kb-ph-stat"><dt>Average cost per run</dt><dd><code>${a.avgCost.toFixed(3)}</code></dd></div>
            <div className="kb-ph-stat"><dt>Created</dt><dd>{monthYear(a.createdAt)}</dd></div>
          </dl>
          {fresh}
        </div>
      </section>
    );
  }

  const p = profile;
  const clock = now ? localClock(p.timeZone, now) : null;
  return (
    <section className={cx("kb-ph", className)} aria-label={`${p.name}, profile`}>
      <div className="kb-ph-main">
        <Avatar name={p.name} size={80} src={p.avatarUrl} />
        <div className="kb-ph-id">
          <div className="kb-ph-name-row">
            <h2>{p.name}</h2>
          </div>
          <p className="kb-ph-handle">@{p.handle}</p>
          <ul className="kb-ph-meta">
            <li><Icon name="user" size={15} />{p.title}, {p.team}</li>
            <li><Icon name="globe" size={15} />{p.location}</li>
            <li><Icon name="clock" size={15} /><span><code>{clock ?? "--:--"}</code> local time</span></li>
          </ul>
        </div>
        <div className="kb-ph-actions">
          <Button icon="message" onClick={onMessage}>Message</Button>
          <Button
            className="kb-ph-follow"
            variant={following ? "secondary" : "primary"}
            icon={following ? "check" : "plus"}
            aria-pressed={following}
            data-latched={following || undefined}
            onClick={toggleFollow}
          >
            {following ? "Following" : "Follow"}
          </Button>
        </div>
      </div>
      <p className="kb-ph-bio">{p.bio}</p>
      <div className="kb-ph-foot">
        <dl className="kb-ph-stats">
          <div className="kb-ph-stat"><dt>Runs approved</dt><dd><code>{p.runsApproved.toLocaleString("en-US")}</code></dd></div>
          <div className="kb-ph-stat"><dt>Reviews</dt><dd><code>{p.reviews.toLocaleString("en-US")}</code></dd></div>
          <div className="kb-ph-stat"><dt>Joined</dt><dd>{monthYear(p.joinedAt)}</dd></div>
        </dl>
        {fresh}
      </div>
    </section>
  );
}
