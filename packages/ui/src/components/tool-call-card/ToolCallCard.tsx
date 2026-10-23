"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cx, formatDuration, Icon, useElapsed, useReducedMotion } from "../../shared/index.ts";
import { Button } from "../button/Button.tsx";
import "./tool-call-card.css";

export type ToolCallStatus = "running" | "ok" | "error";

export interface ToolCall {
  id: string;
  /** Tool name as the agent called it, e.g. "github.search_issues" */
  tool: string;
  /** One-line, human summary of what the call did or is doing */
  summary: string;
  status: ToolCallStatus;
  /** Duration in seconds once finished; running calls show a live clock instead */
  duration?: number;
  args: Record<string, unknown>;
  result?: unknown;
  /** Error message for failed calls */
  error?: string;
}

export const sampleToolCall: ToolCall = {
  id: "call_8f2a",
  tool: "github.search_issues",
  summary: "Found 4 open issues labelled checkout-flake",
  status: "ok",
  duration: 1.8,
  args: { repo: "acme/storefront", query: "is:open label:checkout-flake", sort: "updated", limit: 10 },
  result: {
    total: 4,
    items: [
      { number: 2194, title: "Checkout e2e times out on Safari 18", updated: "2h ago" },
      { number: 2188, title: "Flaky payment-intent mock in CI", updated: "1d ago" },
    ],
  },
};

export const sampleToolCalls: ToolCall[] = [
  sampleToolCall,
  {
    id: "call_8f2b",
    tool: "fs.read_file",
    summary: "Read tests/e2e/checkout.spec.ts (212 lines)",
    status: "ok",
    duration: 0.3,
    args: { path: "tests/e2e/checkout.spec.ts" },
    result: { bytes: 7841, lines: 212 },
  },
  {
    id: "call_8f2c",
    tool: "ci.rerun_job",
    summary: "Rerun of e2e-safari was rejected by CI",
    status: "error",
    duration: 4.6,
    args: { pipeline: 58213, job: "e2e-safari", attempts: 1 },
    error: "403 Forbidden: token lacks actions:write on acme/storefront",
  },
  {
    id: "call_8f2d",
    tool: "web.fetch",
    summary: "Fetching the Safari 18 WebDriver release notes",
    status: "running",
    args: { url: "https://webkit.org/blog/safari-18-webdriver", timeout_ms: 15000 },
  },
];

export interface ToolCallCardProps {
  call?: ToolCall;
  /** Start unfolded */
  defaultOpen?: boolean;
  /** Running calls (and retries) finish on their own after `demoSeconds` */
  demo?: boolean;
  demoSeconds?: number;
  /** Called when the person retries a failed call */
  onRetry?: (call: ToolCall) => void;
  /** Called whenever the call's status changes (demo settle, retry) */
  onChange?: (call: ToolCall) => void;
  className?: string;
}

/**
 * An agent's tool call in one line: a lamp molded into the part, the tool, a plain summary and a live clock.
 * It folds open to syntax-highlighted arguments and result with copy, and failed calls offer Retry.
 */
export function ToolCallCard({
  call = sampleToolCall,
  defaultOpen = false,
  demo = true,
  demoSeconds = 2.4,
  onRetry,
  onChange,
  className,
}: ToolCallCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [state, setState] = useState(call);
  const running = state.status === "running";
  const elapsed = useElapsed(running);
  const bodyId = useId();

  useEffect(() => setState(call), [call]);
  const report = useRef(onChange);
  report.current = onChange;
  useEffect(() => {
    if (state !== call) report.current?.(state);
  }, [state, call]);

  // Demo: a running call settles after a moment so the clock and lamp have somewhere to go
  useEffect(() => {
    if (!demo || !running) return;
    const id = window.setTimeout(() => {
      setState((s) => ({
        ...s,
        status: "ok",
        duration: demoSeconds,
        error: undefined,
        summary: s.summary.replace(/^Fetching/, "Fetched").replace(/^Retrying: /, ""),
        result: s.result ?? { ok: true },
      }));
    }, demoSeconds * 1000);
    return () => window.clearTimeout(id);
  }, [demo, running, demoSeconds]);

  const retry = () => {
    onRetry?.(state);
    setState((s) => ({ ...s, status: "running", summary: `Retrying: ${s.summary}` }));
    setOpen(false);
  };

  const seconds = running ? elapsed : state.duration ?? 0;

  return (
    <div className={cx("kb-root kb-tc", className)} data-status={state.status} data-open={open || undefined}>
      <button
        type="button"
        className="kb-tc-line"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        <Lamp status={state.status} />
        <span className="kb-tc-tool">{state.tool}</span>
        <span className="kb-tc-summary">{state.summary}</span>
        <span className="kb-tc-time" aria-label={running ? "Elapsed" : "Took"}>
          {formatDuration(seconds)}
        </span>
        <Icon name="chevronDown" size={16} className="kb-tc-chev" />
      </button>
      <div className="kb-tc-fold" id={bodyId} hidden={!open}>
        <div className="kb-tc-body">
          <Section label="Arguments" text={JSON.stringify(state.args, null, 2)} />
          {state.status === "error" ? (
            <div className="kb-tc-error" role="alert">
              <Icon name="alert" size={16} />
              <span>{state.error ?? "The tool returned an error."}</span>
              <Button size="sm" icon="refresh" onClick={retry}>
                Retry call
              </Button>
            </div>
          ) : state.status === "ok" ? (
            <Section label="Result" text={JSON.stringify(state.result ?? null, null, 2)} />
          ) : (
            <p className="kb-tc-wait">Waiting for the tool to respond…</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** The status lamp: a lens set into the part. Lit blue and pulsing while running, green when cured, red on a fault. */
function Lamp({ status }: { status: ToolCallStatus }) {
  const label = status === "running" ? "Running" : status === "ok" ? "Succeeded" : "Failed";
  return <span className="kb-tc-lamp" data-status={status} role="img" aria-label={label} />;
}

function Section({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = () => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <section className="kb-tc-section">
      <header>
        <span>{label}</span>
        <button type="button" className="kb-tc-copy" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`}>
          <Icon name={copied ? "check" : "copy"} size={14} />
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      </header>
      <pre className="kb-tc-code">
        <code>{highlightJson(text)}</code>
      </pre>
    </section>
  );
}

/** Tiny JSON highlighter: keys, strings, numbers, literals. Enough for argument payloads. */
function highlightJson(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(-?\d+(?:\.\d+)?)\b|\b(true|false|null)\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      out.push(
        <span key={k++} className={m[2] ? "kb-tc-k" : "kb-tc-s"}>
          {m[1]}
        </span>,
      );
      if (m[2]) out.push(m[2]);
    } else if (m[3]) {
      out.push(<span key={k++} className="kb-tc-n">{m[3]}</span>);
    } else if (m[4]) {
      out.push(<span key={k++} className="kb-tc-l">{m[4]}</span>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export interface ToolCallGroupProps {
  calls?: ToolCall[];
  /** What the agent was doing, e.g. "Investigating the checkout flake" */
  title?: string;
  demo?: boolean;
  className?: string;
}

/**
 * A run of tool calls under one header. The header sums them up and draws a runner bar: one segment per call,
 * sized by how long it took and lit by its status.
 */
export function ToolCallGroup({
  calls = sampleToolCalls,
  title = "Investigating the checkout flake",
  demo = true,
  className,
}: ToolCallGroupProps) {
  const [open, setOpen] = useState(true);
  const [live, setLive] = useState(calls);
  const reduced = useReducedMotion();
  const listId = useId();
  useEffect(() => setLive(calls), [calls]);
  const update = (next: ToolCall) => setLive((ls) => ls.map((c) => (c.id === next.id ? next : c)));
  const total = live.reduce((t, c) => t + (c.duration ?? 1), 0);
  const failed = live.filter((c) => c.status === "error").length;
  const running = live.filter((c) => c.status === "running").length;
  const done = live.length - running;
  const time = live.reduce((t, c) => t + (c.duration ?? 0), 0);

  return (
    <div className={cx("kb-root kb-tcg kb-part", className)}>
      <button
        type="button"
        className="kb-tcg-head"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="kb-tcg-title">
          <Icon name="tool" size={16} />
          {title}
        </span>
        <span className="kb-tcg-sum">
          {running ? `${done} of ${live.length} done` : `${live.length} calls`}
          {failed ? `, ${failed} failed` : ""}, {formatDuration(time)} total
        </span>
        <Icon name="chevronDown" size={16} className="kb-tc-chev" />
        <span className="kb-tcg-runner" aria-hidden data-reduced={reduced || undefined}>
          {live.map((c) => (
            <i key={c.id} data-status={c.status} style={{ flexGrow: (c.duration ?? 1) / total }} />
          ))}
        </span>
      </button>
      <div id={listId} className="kb-tcg-list" hidden={!open}>
        {calls.map((c) => (
          <ToolCallCard key={c.id} call={c} demo={demo} onChange={update} />
        ))}
      </div>
    </div>
  );
}
