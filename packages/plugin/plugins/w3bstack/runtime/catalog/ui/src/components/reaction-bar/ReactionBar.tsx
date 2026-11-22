"use client";

import { useEffect, useRef, useState } from "react";
import { cx, Icon, NumberRoll } from "../../shared/index.ts";
import type { IconName } from "../../shared/index.ts";
import "./reaction-bar.css";

export interface ReactionCounts {
  likes: number;
  comments: number;
  reposts: number;
  shares: number;
}

export interface ReactionBarProps {
  counts?: ReactionCounts;
  /** Whether the viewer has already liked / reposted */
  liked?: boolean;
  reposted?: boolean;
  /** Link copied by the share segment */
  shareUrl?: string;
  onLikeChange?: (liked: boolean) => void;
  onRepostChange?: (reposted: boolean) => void;
  onComment?: () => void;
  onShare?: (url: string) => void;
  size?: "sm" | "md";
  className?: string;
}

export const demoReactionCounts: ReactionCounts = { likes: 1284, comments: 96, reposts: 219, shares: 41 };

/** 1,284 stays exact; 12,840 becomes 12.8k so the pill keeps its width. */
function compact(n: number): string {
  if (n < 10_000) return n.toLocaleString("en-US");
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

/**
 * Like, comment, repost and share molded as one pill with seams between the segments. Like and repost are
 * push-latch switches: pressed once they stay sunk into the pill until pressed again. Counts roll digit by digit.
 */
export function ReactionBar({
  counts = demoReactionCounts,
  liked: likedProp = false,
  reposted: repostedProp = false,
  shareUrl = "https://atlas.dev/runs/r_8Fq2",
  onLikeChange,
  onRepostChange,
  onComment,
  onShare,
  size = "md",
  className,
}: ReactionBarProps) {
  const [liked, setLiked] = useState(likedProp);
  const [reposted, setReposted] = useState(repostedProp);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => setLiked(likedProp), [likedProp]);
  useEffect(() => setReposted(repostedProp), [repostedProp]);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  // Counts passed in exclude the viewer's own reaction unless it was already set
  const likes = counts.likes + (liked && !likedProp ? 1 : !liked && likedProp ? -1 : 0);
  const reposts = counts.reposts + (reposted && !repostedProp ? 1 : !reposted && repostedProp ? -1 : 0);

  const share = () => {
    void navigator.clipboard?.writeText(shareUrl).catch(() => undefined);
    onShare?.(shareUrl);
    setCopied(true);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className={cx("kb-root kb-rx", className)} data-size={size} role="group" aria-label="Reactions">
      <Segment
        icon="heart"
        tone="like"
        count={likes}
        pressed={liked}
        label={liked ? "Unlike" : "Like"}
        onClick={() => {
          setLiked(!liked);
          onLikeChange?.(!liked);
        }}
      />
      <Segment icon="message" count={counts.comments} label="Comment" onClick={() => onComment?.()} />
      <Segment
        icon="repost"
        tone="repost"
        count={reposts}
        pressed={reposted}
        label={reposted ? "Undo repost" : "Repost"}
        onClick={() => {
          setReposted(!reposted);
          onRepostChange?.(!reposted);
        }}
      />
      <Segment
        icon={copied ? "check" : "share"}
        count={counts.shares + (copied ? 1 : 0)}
        label={copied ? "Link copied" : "Copy link to share"}
        flash={copied}
        onClick={share}
      />
      <span className="kb-sr" aria-live="polite">{copied ? "Link copied" : ""}</span>
    </div>
  );
}

interface SegmentProps {
  icon: IconName;
  count: number;
  label: string;
  onClick: () => void;
  tone?: "like" | "repost";
  pressed?: boolean;
  flash?: boolean;
}

function Segment({ icon, count, label, onClick, tone, pressed, flash }: SegmentProps) {
  // `pop` restarts the icon pop animation each time the segment turns on
  const [pop, setPop] = useState(0);
  return (
    <button
      type="button"
      className="kb-rx-seg"
      data-tone={tone}
      data-flash={flash || undefined}
      aria-pressed={pressed}
      aria-label={`${label}, ${count.toLocaleString("en-US")}`}
      onClick={() => {
        if (!pressed) setPop((p) => p + 1);
        onClick();
      }}
    >
      <span className="kb-rx-icon" key={pop} data-pop={pop > 0 || undefined}>
        <Icon name={icon} size={17} />
        {pressed && tone === "like" ? <span className="kb-rx-burst" aria-hidden /> : null}
      </span>
      <NumberRoll value={compact(count)} className="kb-rx-count" />
    </button>
  );
}
