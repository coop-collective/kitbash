import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "../button/Button.tsx";
import { cx, Icon, NumberRoll, useInterval, useReducedMotion } from "../../shared/index.ts";
import "./context-window.css";

export type ContextPartKind = "system" | "tools" | "memory" | "file" | "conversation";

export interface ContextPart {
  id: string;
  kind: ContextPartKind;
  label: string;
  tokens: number;
  /** Extra line under the label, e.g. "46 turns" */
  detail?: string;
}

export interface ContextWindowProps {
  parts?: ContextPart[];
  /** Model context limit in tokens */
  limit?: number;
  /** Tokens per cell in the field */
  perCell?: number;
  /** The conversation keeps growing on a timer */
  autoplay?: boolean;
  /** Tokens left after compacting the conversation */
  compactTo?: number;
  /** Share of the window at which the agent compacts on its own; cells past it are hatched */
  autoCompactAt?: number;
  onRemove?: (part: ContextPart) => void;
  onCompact?: (before: number, after: number) => void;
  className?: string;
}

export const defaultContextParts: ContextPart[] = [
  { id: "sys", kind: "system", label: "System prompt", tokens: 3200 },
  { id: "tools", kind: "tools", label: "Tool definitions", tokens: 14800, detail: "23 tools" },
  { id: "mem", kind: "memory", label: "Project memory", tokens: 4100 },
  { id: "f1", kind: "file", label: "checkout/retry.ts", tokens: 8400 },
  { id: "f2", kind: "file", label: "retry.test.ts", tokens: 5100 },
  { id: "f3", kind: "file", label: "payments-sdk.md", tokens: 22600 },
  { id: "conv", kind: "conversation", label: "Conversation", tokens: 92300, detail: "46 turns" },
];

type Phase = "leaving" | "compacting";

/** Cells per line of the map; each line is labeled with the token address it starts at, like a memory dump */
const COLS = 50;

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${tokens / 1000}k` : String(tokens);
}

function formatK(tokens: number): string {
  return tokens === 0 ? "0" : `${Math.round(tokens / 1000)}k`;
}

/**
 * What fills the model's context, drawn as a memory dump: one cell per `perCell` tokens, fifty to a line, each line
 * addressed by the token offset it starts at. Hover or focus a part to light its cells, remove files, or compact
 * the conversation: its cells shimmer and clear, and a small summary takes their place.
 */
export function ContextWindow({
  parts: initialParts = defaultContextParts,
  limit = 200000,
  perCell = 1000,
  autoplay = true,
  compactTo = 6400,
  autoCompactAt = 0.9,
  onRemove,
  onCompact,
  className,
}: ContextWindowProps) {
  const reduced = useReducedMotion();
  const [parts, setParts] = useState(initialParts);
  const [lit, setLit] = useState<string | null>(null);
  const [phase, setPhase] = useState<Record<string, Phase>>({});
  const [compacted, setCompacted] = useState(false);
  const [say, setSay] = useState("");
  const turn = useRef(47);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);
  const later = (fn: () => void, ms: number) => {
    if (reduced) fn();
    else timers.current.push(window.setTimeout(fn, ms));
  };

  const used = parts.reduce((sum, p) => sum + p.tokens, 0);
  const full = used / limit;

  // The conversation grows a message at a time until the window is nearly full
  useInterval(
    () => {
      if (used > limit * 0.93 || phase.conv) return;
      const add = 600 + ((turn.current * 7919) % 1500);
      turn.current++;
      setParts((ps) => ps.map((p) => (p.kind === "conversation" ? { ...p, tokens: p.tokens + add, detail: `${turn.current - 1} turns` } : p)));
    },
    autoplay && !reduced ? 1600 : null,
  );

  const remove = (part: ContextPart) => {
    setPhase((ph) => ({ ...ph, [part.id]: "leaving" }));
    setLit(null);
    later(() => {
      setParts((ps) => ps.filter((p) => p.id !== part.id));
      setPhase(({ [part.id]: _gone, ...rest }) => rest);
      setSay(`Removed ${part.label}, freed ${part.tokens.toLocaleString()} tokens`);
    }, 420);
    onRemove?.(part);
  };

  const compact = () => {
    const conv = parts.find((p) => p.kind === "conversation");
    if (!conv) return;
    setPhase((ph) => ({ ...ph, [conv.id]: "compacting" }));
    later(() => {
      setParts((ps) => ps.map((p) => (p.id === conv.id ? { ...p, label: "Conversation summary", tokens: compactTo, detail: `from ${p.detail ?? "earlier turns"}` } : p)));
      setPhase(({ [conv.id]: _done, ...rest }) => rest);
      setCompacted(true);
      setSay(`Compacted the conversation from ${conv.tokens.toLocaleString()} to ${compactTo.toLocaleString()} tokens`);
      onCompact?.(conv.tokens, compactTo);
    }, 1300);
  };

  // Lay parts out as cells, rounding on the running total so cell counts always add up
  const totalCells = Math.ceil(limit / perCell);
  const cells: Array<{ key: string; part?: ContextPart; index: number }> = [];
  let run = 0;
  for (const p of parts) {
    const from = Math.round(run / perCell);
    run += p.tokens;
    const to = Math.min(totalCells, Math.round(run / perCell));
    for (let i = from; i < to; i++) cells.push({ key: `${p.id}-${i - from}`, part: p, index: i - from });
  }
  for (let i = cells.length; i < totalCells; i++) cells.push({ key: `free-${i}`, index: i });

  const reserveFrom = Math.round((limit * autoCompactAt) / perCell);
  const turnsLeft = Math.max(0, Math.round((limit * autoCompactAt - used) / 1200));

  const conv = parts.find((p) => p.kind === "conversation");
  const level = full >= autoCompactAt ? "danger" : full >= autoCompactAt - 0.1 ? "near" : "ok";

  return (
    <section className={cx("kb-cw", className)} aria-label="Context window">
      <header className="kb-cw-head">
        <div className="kb-cw-title">
          <h3>Context window</h3>
        </div>
        <p className="kb-cw-reading" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label="Context used" data-level={level}>
          <strong>{Math.round(full * 100)}%</strong>
          <span>
            <NumberRoll value={used.toLocaleString()} /> / {limit.toLocaleString()}
          </span>
        </p>
      </header>

      <div className="kb-cw-body">
        <div className="kb-cw-map" onMouseLeave={() => setLit(null)} aria-hidden>
          {Array.from({ length: Math.ceil(cells.length / COLS) }, (_, row) => (
            <div key={row} className="kb-cw-line">
              <span className="kb-cw-addr">{formatK(row * COLS * perCell)}</span>
              <span className="kb-cw-cells">
                {cells.slice(row * COLS, row * COLS + COLS).map((c, col) => (
                  <span
                    key={c.key}
                    className="kb-cw-cell"
                    data-kind={c.part?.kind}
                    data-reserve={!c.part && row * COLS + col >= reserveFrom ? "" : undefined}
                    data-over={c.part && row * COLS + col >= reserveFrom ? "" : undefined}
                    data-first={c.part && c.index === 0 ? "" : undefined}
                    data-line={row * COLS + col === reserveFrom ? "" : undefined}
                    data-phase={c.part ? phase[c.part.id] : undefined}
                    data-lit={c.part && lit === c.part.id ? "" : undefined}
                    data-dim={lit && (!c.part || lit !== c.part.id) ? "" : undefined}
                    style={{ "--i": c.index } as CSSProperties}
                    onMouseEnter={() => setLit(c.part?.id ?? null)}
                  />
                ))}
              </span>
            </div>
          ))}
          <p className="kb-cw-caption">
            <span>1 cell = {formatTokens(perCell)} tokens</span>
            <span><i className="kb-cw-hatch" /> Agent compacts on its own past {formatK(limit * autoCompactAt)}</span>
          </p>
        </div>

        <table className="kb-cw-table" aria-label="What is in context">
          <thead>
            <tr>
              <th scope="col">Part</th>
              <th scope="col" className="kb-cw-num">Tokens</th>
              <th scope="col"><span className="kb-sr">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => (
              <tr
                key={p.id}
                data-kind={p.kind}
                data-lit={lit === p.id || undefined}
                data-phase={phase[p.id]}
                onMouseEnter={() => setLit(p.id)}
                onMouseLeave={() => setLit(null)}
              >
                <td>
                  <button
                    type="button"
                    className="kb-cw-row"
                    onFocus={() => setLit(p.id)}
                    onBlur={() => setLit(null)}
                    aria-label={`${p.label}, ${p.tokens.toLocaleString()} tokens. Highlight in the map`}
                  >
                    <span className="kb-cw-swatch" />
                    <span className="kb-cw-name">{p.kind === "file" ? <code>{p.label}</code> : p.label}</span>
                    {p.detail ? <span className="kb-cw-detail">{p.detail}</span> : null}
                  </button>
                </td>
                <td className="kb-cw-num">{p.tokens.toLocaleString()}</td>
                <td className="kb-cw-act">
                  {p.kind === "file" ? (
                    <button type="button" className="kb-cw-remove" aria-label={`Remove ${p.label} from context`} onClick={() => remove(p)} disabled={Boolean(phase[p.id])}>
                      <Icon name="x" size={14} />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            <tr className="kb-cw-free" onMouseEnter={() => setLit(null)}>
              <td>
                <span className="kb-cw-row">
                  <span className="kb-cw-swatch" />
                  <span className="kb-cw-name">Free</span>
                </span>
              </td>
              <td className="kb-cw-num">{Math.max(0, limit - used).toLocaleString()}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <footer className="kb-cw-foot">
        <span className="kb-cw-forecast" data-level={level}>
          {compacted
            ? `Compacted. About ${turnsLeft} more turns fit.`
            : turnsLeft > 0
              ? `About ${turnsLeft} more turns fit before the agent compacts on its own.`
              : `Past ${formatK(limit * autoCompactAt)}: the agent compacts on its next turn unless you do.`}
        </span>
        <Button
          size="sm"
          variant={level === "ok" ? "secondary" : "primary"}
          icon="compress"
          onClick={compact}
          onPointerEnter={() => conv && setLit(conv.id)}
          onPointerLeave={() => setLit(null)}
          onFocus={() => conv && setLit(conv.id)}
          onBlur={() => setLit(null)}
          disabled={!conv || conv.tokens <= compactTo || Boolean(conv && phase[conv.id])}
          loading={Boolean(conv && phase[conv.id] === "compacting")}
          loadingLabel="Compacting"
        >
          {conv && conv.tokens > compactTo ? `Compact, frees ${formatK(conv.tokens - compactTo)}` : "Compact conversation"}
        </Button>
      </footer>
      <p className="kb-sr" aria-live="polite">{say}</p>
    </section>
  );
}
