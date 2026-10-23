import { useState, type CSSProperties } from "react";
import { cx, Icon, Tag, formatDuration, useInterval, useReducedMotion, type IconName } from "../../shared/index.ts";
import "./trace-waterfall.css";

export type SpanKind = "llm" | "tool" | "agent";

export interface TraceSpan {
  id: string;
  name: string;
  kind: SpanKind;
  /** Milliseconds from the start of the run */
  start: number;
  end: number;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  /** Dollars; LLM spans compute it from tokens when omitted */
  cost?: number;
  error?: string;
  children?: TraceSpan[];
}

export interface TraceWaterfallProps {
  trace?: TraceSpan;
  /** Replay the run as it happened */
  autoplay?: boolean;
  /** Playback speed relative to real time */
  speed?: number;
  /** Milliseconds into the run the replay starts at, so the first frame already shows the trace taking shape */
  startAt?: number;
  /** Ids folded at first */
  defaultFolded?: string[];
  className?: string;
}

export const defaultTrace: TraceSpan = {
  id: "run",
  name: "support-agent",
  kind: "agent",
  start: 0,
  end: 9400,
  children: [
    { id: "plan", name: "Plan the reply", kind: "llm", model: "opus-4", start: 0, end: 1780, tokensIn: 3240, tokensOut: 410 },
    { id: "tickets", name: "search_tickets", kind: "tool", start: 1820, end: 2580 },
    { id: "customer", name: "get_customer", kind: "tool", start: 1820, end: 2190 },
    {
      id: "refund",
      name: "refund-subagent",
      kind: "agent",
      start: 2640,
      end: 7300,
      children: [
        { id: "decide", name: "Decide refund amount", kind: "llm", model: "sonnet-4", start: 2700, end: 4080, tokensIn: 2110, tokensOut: 224 },
        { id: "stripe", name: "stripe.refunds.create", kind: "tool", start: 4120, end: 6880, cost: 0.0005 },
        { id: "confirm", name: "Summarize result", kind: "llm", model: "haiku-4", start: 6920, end: 7290, tokensIn: 940, tokensOut: 88 },
      ],
    },
    { id: "draft", name: "Draft customer reply", kind: "llm", model: "sonnet-4", start: 7340, end: 8990, tokensIn: 5420, tokensOut: 690 },
    { id: "send", name: "zendesk.reply", kind: "tool", start: 9030, end: 9400 },
  ],
};

/** Dollars per million tokens, in and out */
const PRICES: Record<string, [number, number]> = {
  "opus-4": [15, 75],
  "sonnet-4": [3, 15],
  "haiku-4": [0.8, 4],
};

function spanCost(s: TraceSpan): number {
  if (s.cost !== undefined) return s.cost;
  const p = s.model ? PRICES[s.model] : undefined;
  if (!p) return 0;
  return ((s.tokensIn ?? 0) * p[0] + (s.tokensOut ?? 0) * p[1]) / 1e6;
}

function flatten(s: TraceSpan, depth = 0, parent?: string): Array<{ span: TraceSpan; depth: number; parent?: string }> {
  return [{ span: s, depth, parent }, ...(s.children ?? []).flatMap((c) => flatten(c, depth + 1, s.id))];
}

/** Rolled-up tokens and cost for a span and everything under it, counting only work started by `now`. */
function rollup(s: TraceSpan, now: number): { tokens: number; cost: number } {
  const own = s.start <= now && s.end <= now ? { tokens: (s.tokensIn ?? 0) + (s.tokensOut ?? 0), cost: spanCost(s) } : { tokens: 0, cost: 0 };
  return (s.children ?? []).reduce((acc, c) => {
    const r = rollup(c, now);
    return { tokens: acc.tokens + r.tokens, cost: acc.cost + r.cost };
  }, own);
}

const ICON: Record<SpanKind, IconName> = { llm: "sparkle", tool: "tool", agent: "robot" };
const money = (n: number) => (n === 0 ? "–" : `$${n.toFixed(4)}`);
const tok = (n: number) => (n === 0 ? "–" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/**
 * Where the time and money of an agent run go. Every LLM call, tool call and sub-agent is a bar on a live
 * timeline with its tokens and cost share; folding a branch presses its children into
 * the parent's bar as seams, so you still see where they ran.
 */
export function TraceWaterfall({ trace = defaultTrace, autoplay = true, speed = 1.4, startAt = 5600, defaultFolded = [], className }: TraceWaterfallProps) {
  const reduced = useReducedMotion();
  const total = trace.end - trace.start;
  const [clock, setClock] = useState(autoplay ? Math.min(startAt, total) : total);
  const [folded, setFolded] = useState<Set<string>>(() => new Set(defaultFolded));
  const [selected, setSelected] = useState<string | null>(null);

  useInterval(() => setClock((c) => Math.min(total, c + 100 * speed)), autoplay && !reduced && clock < total ? 100 : null);
  const now = reduced ? total : clock;
  const live = now < total;

  const rows = flatten(trace);
  const leaves = rows.filter((r) => r.span.kind !== "agent");

  // A row is hidden when any ancestor is folded
  const parentOf = new Map(rows.map((r) => [r.span.id, r.parent]));
  const hidden = (id: string): boolean => {
    let p = parentOf.get(id);
    while (p) {
      if (folded.has(p)) return true;
      p = parentOf.get(p);
    }
    return false;
  };
  const visible = rows.filter((r) => r.span.start <= now && !hidden(r.span.id));
  // While running the axis only knows what has happened, with a little room ahead; once finished it fits the run.
  // Positions leave a fixed gutter on the right so every duration label fits after its bar.
  const scale = live ? Math.max(2000, Math.ceil((now * 1.25) / 1000) * 1000) : total;
  const pct = (ms: number) => `calc((100% - var(--gutter)) * ${Math.min(ms, scale) / scale})`;
  const step = scale > 12000 ? 4000 : scale > 5000 ? 2000 : 1000;
  const regular = Array.from({ length: Math.floor(scale / step) + 1 }, (_, i) => i * step);
  // A finished run also marks where it ended, unless that lands on top of a regular tick
  const ticks = !live && scale % step > step * 0.35 ? [...regular, scale] : regular;
  const sum = rollup(trace, now);

  // The header answers where the run went, not what the root row already says: time per kind of call,
  // time when nothing was running, and the single call that cost the most.
  const ran = (s: TraceSpan) => Math.max(0, Math.min(s.end, now) - s.start);
  const kindTime = (kind: SpanKind) => leaves.filter((r) => r.span.kind === kind).reduce((t, r) => t + ran(r.span), 0);
  const topCost = leaves
    .filter((r) => r.span.end <= now && spanCost(r.span) > 0)
    .map((r) => r.span)
    .reduce<TraceSpan | null>((best, s) => (!best || spanCost(s) > spanCost(best) ? s : best), null);
  const sel = rows.find((r) => r.span.id === selected)?.span;

  const toggle = (id: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className={cx("kb-tw", className)} aria-label="Trace waterfall">
      <header className="kb-tw-head">
        <div className="kb-tw-title">
          <h3>Refund request #88214</h3>
          <p><code>7f3c9a2e</code> {live ? `${rows.filter((r) => r.span.start <= now).length} of ${rows.length} spans so far` : `${rows.length} spans`}</p>
        </div>
        <dl className="kb-tw-stats">
          <div className="kb-tw-lead"><dt>Wall time</dt><dd>{formatDuration(now / 1000)}</dd></div>
          <div className="kb-tw-lead"><dt>Cost</dt><dd>${sum.cost.toFixed(4)}</dd></div>
          <div><dt>In model calls</dt><dd>{formatDuration(kindTime("llm") / 1000)}</dd></div>
          <div><dt>In tool calls</dt><dd>{formatDuration(kindTime("tool") / 1000)}</dd></div>
          {topCost ? (
            <div><dt>Most cost</dt><dd className="kb-tw-top">{topCost.name} <span>{Math.round((spanCost(topCost) / sum.cost) * 100)}%</span></dd></div>
          ) : null}
        </dl>
        {live ? <Tag tone="agent" live>Running</Tag> : <Tag tone="ok">Finished</Tag>}
      </header>

      <div className="kb-tw-grid" role="table" aria-label="Spans">
        <div className="kb-tw-row kb-tw-axis" role="row">
          <span role="columnheader">Span</span>
          <span role="columnheader" className="kb-tw-scale">
            {ticks.map((t) => (
              <i key={t} style={{ left: pct(t) }}>{t % 1000 ? (t / 1000).toFixed(1) : t / 1000}s</i>
            ))}
            {live ? <b className="kb-tw-now-chip" style={{ left: pct(now) }}>{(now / 1000).toFixed(1)}s</b> : null}
          </span>
          <span role="columnheader" className="kb-tw-num">Tokens</span>
          <span role="columnheader" className="kb-tw-num">Cost</span>
        </div>

        {visible.map(({ span, depth }) => {
          const hasKids = (span.children ?? []).length > 0;
          const isFolded = folded.has(span.id);
          const end = Math.min(span.end, now);
          const running = now < span.end;
          const r = isFolded || span.kind === "agent" ? rollup(span, now) : { tokens: span.end <= now ? (span.tokensIn ?? 0) + (span.tokensOut ?? 0) : 0, cost: span.end <= now ? spanCost(span) : 0 };
          const hiddenCount = isFolded ? flatten(span).length - 1 : 0;
          return (
            <div
              key={span.id}
              className="kb-tw-row"
              role="row"
              data-selected={selected === span.id || undefined}
            >
              <span role="cell" className="kb-tw-name" style={{ "--depth": depth } as CSSProperties}>
                {hasKids ? (
                  <button type="button" className="kb-tw-fold" aria-expanded={!isFolded} aria-label={`${isFolded ? "Unfold" : "Fold"} ${span.name}`} onClick={() => toggle(span.id)}>
                    <Icon name="chevronRight" size={13} />
                  </button>
                ) : (
                  <span className="kb-tw-fold-gap" />
                )}
                <button type="button" className="kb-tw-pick" data-kind={span.kind} aria-pressed={selected === span.id} onClick={() => setSelected((s) => (s === span.id ? null : span.id))}>
                  <Icon name={ICON[span.kind]} size={13} />
                  <span className={span.kind === "tool" ? "kb-tw-code" : undefined}>{span.name}</span>
                  {hiddenCount ? <span className="kb-tw-hidden">{hiddenCount} spans</span> : null}
                </button>
              </span>
              <span role="cell" className="kb-tw-track">
                {ticks.map((t) => <i key={t} className="kb-tw-tick" style={{ left: pct(t) }} />)}
                {live ? <i className="kb-tw-now" style={{ left: pct(now) }} /> : null}
                <span
                  className="kb-tw-bar"
                  data-kind={span.kind}
                  data-running={running || undefined}
                  style={{ left: pct(span.start), width: `max(3px, ${pct(end - span.start)})` }}
                  aria-label={`${span.name}: ${running ? "running" : `${((span.end - span.start) / 1000).toFixed(2)}s`}`}
                >
                  {isFolded
                    ? (span.children ?? [])
                        .filter((c) => c.start <= now && c.start > span.start)
                        .map((c) => <i key={c.id} className="kb-tw-seam" style={{ left: `${((c.start - span.start) / (span.end - span.start)) * 100}%` }} />)
                    : null}
                </span>
                <span className="kb-tw-dur" style={{ left: `calc(${pct(end)} + 6px)` }}>
                  {`${((end - span.start) / 1000).toFixed(2)}s`}
                </span>
              </span>
              <span role="cell" className="kb-tw-num">{tok(r.tokens)}</span>
              <span role="cell" className="kb-tw-num kb-tw-cost">
                {money(r.cost)}
              </span>
            </div>
          );
        })}
      </div>

      <footer className="kb-tw-detail" aria-live="polite" data-empty={!sel || undefined}>
        {sel ? (
          <>
            <strong>{sel.name}</strong>
            <span>{sel.kind === "llm" ? `Model call on ${sel.model}` : sel.kind === "tool" ? "Tool call" : "Sub-agent"}</span>
            <span>Started at {(sel.start / 1000).toFixed(2)}s, took {((sel.end - sel.start) / 1000).toFixed(2)}s</span>
            {sel.tokensIn ? <span>{sel.tokensIn.toLocaleString()} in, {sel.tokensOut?.toLocaleString()} out</span> : null}
            {spanCost(sel) ? <span>{money(spanCost(sel))}</span> : null}
          </>
        ) : null}
      </footer>
    </section>
  );
}
