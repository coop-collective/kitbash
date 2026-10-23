"use client";

import { useEffect, useId, useState } from "react";
import { cx, Icon, NumberRoll, useInterval, useReducedMotion } from "../../shared/index.ts";
import { Button } from "../button/Button.tsx";
import "./usage-meter.css";

/** Chart series colors (data): a light and a dark value each. */
const SERIES = [
  "var(--kb-series-1)",
  "var(--kb-series-4)",
  "var(--kb-series-3)",
  "var(--kb-series-6)",
  "var(--kb-ink-3)",
];

export interface UsageCategory {
  id: string;
  label: string;
  /** Credits used so far this cycle */
  used: number;
  color?: string;
}

export interface UsageMeterProps {
  plan?: string;
  /** Credits included in the plan this cycle */
  limit?: number;
  /** Fraction of the limit where the meter starts asking for a decision */
  warnAt?: number;
  categories?: UsageCategory[];
  /** Credits used per day so far this cycle, oldest first */
  daily?: number[];
  /** Days left in the billing cycle */
  daysLeft?: number;
  resetLabel?: string;
  /** Live demo: agents keep spending credits until the limit is reached */
  demo?: boolean;
  onRaiseLimit?: () => void;
  onManage?: () => void;
  className?: string;
}

export const usageDemoCategories: UsageCategory[] = [
  { id: "agents", label: "Agent runs", used: 18_420 },
  { id: "chat", label: "Chat", used: 9_310 },
  { id: "search", label: "Web search", used: 4_870 },
  { id: "embed", label: "Embeddings", used: 2_160 },
];

export const usageDemoDaily = [
  610, 720, 840, 790, 410, 380, 920, 1080, 1130, 1010, 980, 470, 430, 1240, 1310, 1420, 1360, 1290, 560, 520, 1580, 1660, 1720,
];

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * Plan usage and AI credits. A recessed tray holds one molded strip per category; the limit is a tab clipped to
 * the tray. Near the limit the tab and the action turn decal yellow, because a person has to choose what happens
 * next, and the button says plainly when credits run out.
 */
export function UsageMeter({
  plan = "Team plan",
  limit = 40_000,
  warnAt = 0.85,
  categories = usageDemoCategories,
  daily = usageDemoDaily,
  daysLeft = 8,
  resetLabel = "Resets Nov 1",
  demo = false,
  onRaiseLimit,
  onManage,
  className,
}: UsageMeterProps) {
  const uid = useId();
  const reduced = useReducedMotion();
  const [extra, setExtra] = useState<Record<string, number>>({});
  const [hover, setHover] = useState<string | null>(null);

  const base = categories.reduce((sum, c) => sum + c.used, 0);
  const totalNow = base + Object.values(extra).reduce((a, b) => a + b, 0);
  const running = demo && !reduced && totalNow < limit;

  // Demo: agents keep spending until the cap. Reduced motion jumps straight to the end state.
  useInterval(() => {
    setExtra((prev) => {
      const pick = categories[Math.floor(Math.random() * Math.min(2, categories.length))];
      if (!pick) return prev;
      const room = limit - totalNow;
      return { ...prev, [pick.id]: (prev[pick.id] ?? 0) + Math.min(room, 180 + Math.round(Math.random() * 260)) };
    });
  }, running ? 700 : null);
  useEffect(() => {
    if (demo && reduced) {
      const first = categories[0];
      if (first) setExtra({ [first.id]: Math.max(0, limit - base) });
    }
  }, [demo, reduced, categories, limit, base]);

  const parts = categories.map((c, i) => ({ ...c, used: c.used + (extra[c.id] ?? 0), color: c.color ?? SERIES[i % SERIES.length] ?? "currentColor" }));
  const total = parts.reduce((sum, c) => sum + c.used, 0);
  const share = total / limit;
  const state = share >= 1 ? "out" : share >= warnAt ? "warn" : "ok";
  const pace = daily.slice(-7).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(7, daily.length));
  const runwayDays = pace ? Math.max(0, (limit - total) / pace) : Infinity;
  const runsOutEarly = runwayDays < daysLeft;

  const message =
    state === "out"
      ? "Credits used up. Agent runs are paused until you add credits or the plan resets."
      : state === "warn"
        ? `About ${Math.max(1, Math.round(runwayDays))} ${Math.round(runwayDays) === 1 ? "day" : "days"} of credits left at this pace, and the plan resets in ${daysLeft}.`
        : runsOutEarly
          ? `At this pace credits run out in about ${Math.round(runwayDays)} days.`
          : `On pace to finish the cycle with ${fmt(limit - total - pace * daysLeft)} credits to spare.`;

  // Sparkline geometry
  const SW = 300;
  const SH = 44;
  const peak = Math.max(1, ...daily);
  const step = SW / Math.max(1, daily.length);

  let offset = 0;
  return (
    <section className={cx("kb-um kb-part", className)} data-state={state} aria-labelledby={`${uid}-t`}>
      <header className="kb-um-head">
        <div>
          <h3 id={`${uid}-t`} className="kb-um-title">AI credits</h3>
          <p className="kb-um-plan">{`${plan}, ${resetLabel.charAt(0).toLowerCase()}${resetLabel.slice(1)}`}</p>
        </div>
        <div className="kb-um-figure">
          <NumberRoll value={fmt(total)} className="kb-um-used" />
          <span className="kb-um-of">{`of ${fmt(limit)}`}</span>
        </div>
      </header>

      <div
        className="kb-um-tray"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(total, limit)}
        aria-valuetext={`${fmt(total)} of ${fmt(limit)} credits used, ${Math.round(share * 100)} percent`}
        aria-label="Credits used this cycle"
      >
        <div className="kb-um-strips">
          {parts.map((c) => {
            const w = Math.min(c.used / limit, Math.max(0, 1 - offset));
            const left = offset;
            offset += w;
            return (
              <span
                key={c.id}
                className="kb-um-strip"
                style={{ left: `${left * 100}%`, width: `${w * 100}%`, background: c.color }}
                data-dim={(hover && hover !== c.id) || undefined}
              />
            );
          })}
        </div>
        <span className="kb-um-warn" style={{ left: `${warnAt * 100}%` }} aria-hidden>
          <span className="kb-um-tab">{`${Math.round(warnAt * 100)}%`}</span>
        </span>
      </div>

      <ul className="kb-um-legend">
        {parts.map((c) => (
          <li
            key={c.id}
            className="kb-um-key"
            data-dim={(hover && hover !== c.id) || undefined}
            onPointerEnter={() => setHover(c.id)}
            onPointerLeave={() => setHover(null)}
          >
            <span className="kb-um-swatch" style={{ background: c.color }} />
            <span className="kb-um-key-name">{c.label}</span>
            <NumberRoll value={fmt(c.used)} className="kb-um-key-num" />
          </li>
        ))}
      </ul>

      <figure className="kb-um-spark">
        <figcaption className="kb-um-spark-cap">
          <span>Daily use</span>
          <span>{`${fmt(pace)} a day lately`}</span>
        </figcaption>
        <svg viewBox={`0 0 ${SW} ${SH}`} preserveAspectRatio="none" className="kb-um-spark-svg" role="img" aria-label={`Daily credits, last ${daily.length} days, from ${fmt(daily[0] ?? 0)} to ${fmt(daily[daily.length - 1] ?? 0)}`}>
          {daily.map((d, i) => {
            const h = Math.max(2, (d / peak) * (SH - 2));
            return <rect key={i} x={i * step + 1} y={SH - h} width={Math.max(1, step - 2)} height={h} rx={1.5} className="kb-um-day" data-last={i === daily.length - 1 || undefined} />;
          })}
        </svg>
      </figure>

      <footer className="kb-um-foot" aria-live="polite">
        <p className="kb-um-msg">
          {state !== "ok" ? <Icon name={state === "out" ? "alert" : "bell"} size={15} /> : null}
          {message}
        </p>
        {state === "ok" ? (
          <Button size="sm" variant="ghost" onClick={onManage}>Manage plan</Button>
        ) : (
          <Button size="sm" variant="primary" icon="plus" className="kb-um-cta" onClick={onRaiseLimit}>
            {state === "out" ? "Add credits" : "Raise limit"}
          </Button>
        )}
      </footer>
    </section>
  );
}
