import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "../button/Button.tsx";
import { cx, Icon, Tag, useInterval, useReducedMotion } from "../../shared/index.ts";
import "./agent-cursors.css";

export interface CursorAgent {
  name: string;
  /** Pointer and flag color (data color, so raw hex is fine) */
  color: string;
}

export type CursorEditId = "copy" | "code" | "figure";
export type CursorEditState = "accepted" | "rejected";

export interface AgentCursorsProps {
  /** The three agents in the room: writer, reviewer, layout */
  agents?: [CursorAgent, CursorAgent, CursorAgent];
  /** Run the scripted session on mount */
  autoplay?: boolean;
  /** Replay the session when it ends, until someone accepts or rejects an edit */
  loop?: boolean;
  /** Called when a person accepts or rejects an agent's edit */
  onResolve?: (edit: CursorEditId, state: CursorEditState) => void;
  className?: string;
}

export const defaultCursorAgents: [CursorAgent, CursorAgent, CursorAgent] = [
  { name: "Scout", color: "#3b3fd6" },
  { name: "Lint", color: "#23885c" },
  { name: "Layout", color: "#c2571a" },
];

/* The session script, in ticks of TICK ms. Every visible value is a pure function of the tick,
   so reduced motion simply renders the last tick. */
const TICK = 90;
const COPY = ", cutting p95 checkout latency from 840 ms to 310 ms";
const OLD_LINE = "if (attempt > MAX_RETRIES) throw res.error;";
const NEW_LINE = "if (attempt >= MAX_RETRIES) throw res.error;";
const T = {
  copyStart: 9,
  codeArrive: 16,
  codeStrike: 26,
  codeStart: 30,
  figArrive: 64,
  figStart: 72,
  figEnd: 100,
  end: 104,
  loopAt: 150,
};
const copyEnd = T.copyStart + COPY.length;
const codeEnd = T.codeStart + NEW_LINE.length;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ease = (p: number) => 1 - Math.pow(1 - p, 3);

type Point = { x: number; y: number };

/**
 * Agents editing a document like teammates in a multiplayer editor: named pointers glide to their spot,
 * copy is typed letter by letter, a code line is fixed, a figure is resized, and each agent leaves a note
 * in the margin. Agent edits stay unglued (dashed seam) until a person accepts them.
 */
export function AgentCursors({
  agents = defaultCursorAgents,
  autoplay = true,
  loop = true,
  onResolve,
  className,
}: AgentCursorsProps) {
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(autoplay);
  const [resolved, setResolved] = useState<Partial<Record<CursorEditId, CursorEditState>>>({});
  const touched = Object.keys(resolved).length > 0;

  useInterval(
    () => {
      setTick((t) => {
        if (t >= T.loopAt) {
          if (loop && !touched) return 0;
          setRunning(false);
          return t;
        }
        return t + 1;
      });
    },
    running && !reduced ? TICK : null,
  );

  // Reduced motion shows the finished session instead of animating it
  const t = reduced ? T.end : tick;
  const [writer, reviewer, layout] = agents;

  const copyState = resolved.copy;
  const codeState = resolved.code;
  const figState = resolved.figure;
  const typed = copyState === "rejected" ? "" : COPY.slice(0, clamp(t - T.copyStart, 0, COPY.length));
  const newLine = NEW_LINE.slice(0, clamp(t - T.codeStart, 0, NEW_LINE.length));
  const struck = t >= T.codeStrike && codeState !== "rejected";
  const figP = figState === "rejected" ? 0 : ease(clamp((t - T.figStart) / (T.figEnd - T.figStart), 0, 1));
  const figWidth = 56 + figP * 44;

  const notes: Array<{ id: CursorEditId; agent: CursorAgent; at: number; text: string }> = [
    { id: "copy", agent: writer, at: copyEnd + 1, text: "Added the measured gain. Numbers are from the Oct 21 load test, run 4471." },
    { id: "code", agent: reviewer, at: codeEnd + 1, text: "Off by one: the old check allowed four retries, not three." },
    { id: "figure", agent: layout, at: T.figEnd + 1, text: "Widened the chart so the axis labels stop overlapping." },
  ];

  // Cursor targets are measured from anchors in the page, so they follow the text as it reflows
  const pageRef = useRef<HTMLDivElement>(null);
  const copyCaret = useRef<HTMLSpanElement>(null);
  const codeCaret = useRef<HTMLSpanElement>(null);
  const figHandle = useRef<HTMLSpanElement>(null);
  const [points, setPoints] = useState<[Point, Point, Point]>([
    { x: 560, y: 10 },
    { x: 560, y: 380 },
    { x: 560, y: 200 },
  ]);

  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const base = page.getBoundingClientRect();
    const at = (el: HTMLElement | null, fallback: Point): Point => {
      if (!el) return fallback;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.right - base.left), y: Math.round(r.top - base.top + r.height * 0.55) };
    };
    const home: [Point, Point, Point] = [
      { x: base.width - 30, y: 14 },
      { x: base.width - 30, y: base.height - 40 },
      { x: base.width - 30, y: base.height * 0.45 },
    ];
    const next: [Point, Point, Point] = [
      t >= 1 ? at(copyCaret.current, home[0]) : home[0],
      t >= T.codeArrive - 8 ? at(codeCaret.current, home[1]) : home[1],
      t >= T.figArrive - 8 ? at(figHandle.current, home[2]) : home[2],
    ];
    setPoints((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [t, resolved]);

  const action = (start: number, end: number, verb: string) => (t >= start && t < end ? verb : undefined);
  const cursors = [
    { agent: writer, point: points[0], doing: action(T.copyStart, copyEnd, "typing"), fast: t >= T.copyStart && t < copyEnd },
    { agent: reviewer, point: points[1], doing: action(T.codeStrike, codeEnd, "fixing a bug"), fast: t >= T.codeStart && t < codeEnd },
    { agent: layout, point: points[2], doing: action(T.figStart, T.figEnd, "resizing"), fast: t >= T.figStart && t < T.figEnd },
  ];

  const resolve = (id: CursorEditId, state: CursorEditState) => {
    setResolved((r) => ({ ...r, [id]: state }));
    onResolve?.(id, state);
  };
  const pending = notes.filter((n) => t >= n.at && !resolved[n.id]).length;

  return (
    <section className={cx("kb-ac", className)} aria-label="Shared document with agent collaborators">
      <header className="kb-ac-bar">
        <Icon name="file" size={16} />
        <span className="kb-ac-docname">Checkout latency incident review</span>
        <span className="kb-ac-presence" aria-label={`${agents.length} agents in this document`}>
          {agents.map((a) => (
            <span key={a.name} className="kb-ac-face" style={{ background: a.color }} title={a.name}>
              {a.name[0]}
            </span>
          ))}
        </span>
        {pending > 0 ? (
          <Tag tone="decal" dot>{pending} to review</Tag>
        ) : notes.some((n) => t >= n.at) ? (
          <Tag tone="ok">All reviewed</Tag>
        ) : (
          <Tag tone="agent" live>Agents editing</Tag>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={running ? "pause" : "play"}
          aria-label={running ? "Pause agents" : "Resume agents"}
          disabled={reduced}
          onClick={() => {
            if (!running && t >= T.loopAt) setTick(0);
            setRunning((r) => !r);
          }}
        />
      </header>

      <div className="kb-ac-body">
        <div className="kb-ac-page" ref={pageRef}>
          <h3 className="kb-ac-h">Oct 14 checkout timeouts</h3>
          <p>
            Between 09:12 and 10:40 UTC, checkout requests timed out for 6.8% of sessions in eu-west. The payment
            client retried every failure without backoff, which tripled load on the gateway.
          </p>
          <p>
            On Oct 15 we shipped a fix that caps retries and adds jittered backoff
            <span
              className="kb-ac-insert"
              data-state={copyState ?? (typed ? "pending" : undefined)}
              style={{ "--who": writer.color } as CSSProperties}
            >
              {typed}
            </span>
            <span ref={copyCaret} className="kb-ac-anchor" />.
          </p>

          <figure className="kb-ac-fig" data-state={figState ?? (figP > 0 ? "pending" : undefined)} style={{ width: `${figWidth}%`, "--who": layout.color } as CSSProperties}>
            <LatencyChart />
            {t >= T.figArrive && t < T.figEnd + 4 && !figState ? (
              <>
                <span className="kb-ac-handle" data-corner="tl" />
                <span className="kb-ac-handle" data-corner="tr" />
                <span className="kb-ac-handle" data-corner="bl" />
              </>
            ) : null}
            <span ref={figHandle} className="kb-ac-handle" data-corner="br" data-show={(t >= T.figArrive && t < T.figEnd + 4 && !figState) || undefined} />
            <figcaption>p95 checkout latency, Oct 13 to Oct 21</figcaption>
          </figure>

          <pre className="kb-ac-code" aria-label="retry.ts">
            <code>
              <span className="kb-ac-ln">for (let attempt = 0; ; attempt++) {"{"}</span>
              <span className="kb-ac-ln">{"  "}const res = await charge(order);</span>
              <span className="kb-ac-ln">{"  "}if (res.ok) return res;</span>
              {codeState !== "accepted" ? (
                <span className="kb-ac-ln" data-diff={struck ? "del" : undefined}>
                  {"  "}{OLD_LINE}
                  {!newLine || codeState === "rejected" ? <span ref={codeCaret} className="kb-ac-anchor" /> : null}
                </span>
              ) : null}
              {newLine && codeState !== "rejected" ? (
                <span className="kb-ac-ln" data-diff={codeState === "accepted" ? undefined : "add"} style={{ "--who": reviewer.color } as CSSProperties}>
                  {"  "}{newLine}
                  <span ref={codeCaret} className="kb-ac-anchor" />
                </span>
              ) : null}
              <span className="kb-ac-ln">{"  "}await sleep(backoff(attempt));</span>
              <span className="kb-ac-ln">{"}"}</span>
            </code>
          </pre>

          {cursors.map(({ agent, point, doing, fast }) => (
            <span
              key={agent.name}
              className="kb-ac-cursor"
              data-fast={fast || undefined}
              style={{ transform: `translate(${point.x}px, ${point.y}px)`, "--who": agent.color } as CSSProperties}
              aria-hidden
            >
              <svg width="16" height="18" viewBox="0 0 16 18">
                <path d="M1.5 1.5l12 7-5.2 1.3-2.6 5.2z" fill="var(--who)" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
              <span className="kb-ac-flag">
                {agent.name}
                {doing ? <span className="kb-ac-doing">{doing}</span> : null}
              </span>
            </span>
          ))}
        </div>

        <aside className="kb-ac-margin" aria-label="Agent notes">
          {notes.map((n) =>
            t >= n.at ? (
              <article key={n.id} className="kb-ac-note" data-state={resolved[n.id] ?? "pending"}>
                <header>
                  <span className="kb-ac-face" style={{ background: n.agent.color }} aria-hidden>
                    {n.agent.name[0]}
                  </span>
                  <strong>{n.agent.name}</strong>
                  {resolved[n.id] === "accepted" ? <Tag tone="ok">Accepted</Tag> : null}
                  {resolved[n.id] === "rejected" ? <Tag>Rejected</Tag> : null}
                </header>
                <p>{n.text}</p>
                {!resolved[n.id] ? (
                  <div className="kb-ac-actions">
                    <Button size="sm" variant="primary" icon="check" onClick={() => resolve(n.id, "accepted")}>
                      Accept
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => resolve(n.id, "rejected")}>
                      Reject
                    </Button>
                  </div>
                ) : null}
              </article>
            ) : null,
          )}
          {t < notes[0]!.at ? <p className="kb-ac-empty">Notes from agents show up here as they finish.</p> : null}
        </aside>
      </div>
      <p className="kb-sr" aria-live="polite">
        {cursors.filter((c) => c.doing).map((c) => `${c.agent.name} is ${c.doing}`).join(". ")}
      </p>
    </section>
  );
}

/** The figure the layout agent resizes: p95 latency falling after the fix. */
function LatencyChart() {
  const pts = [820, 840, 790, 610, 380, 330, 310, 305, 312];
  const x = (i: number) => 28 + (i * 264) / (pts.length - 1);
  const y = (v: number) => 110 - (v / 900) * 96;
  const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 300 124" className="kb-ac-chart" role="img" aria-label="p95 latency fell from 840 ms to 310 ms">
      {[0, 300, 600, 900].map((v) => (
        <g key={v}>
          <line x1="28" x2="292" y1={y(v)} y2={y(v)} className="kb-ac-grid" />
          <text x="22" y={y(v) + 3} textAnchor="end">{v}</text>
        </g>
      ))}
      <line x1={x(2.5)} x2={x(2.5)} y1="10" y2="110" className="kb-ac-mark" />
      <text x={x(2.5) + 4} y="18">fix shipped</text>
      <path d={`${d} L${x(pts.length - 1)} 110 L28 110 Z`} className="kb-ac-area" />
      <path d={d} className="kb-ac-line" />
    </svg>
  );
}
