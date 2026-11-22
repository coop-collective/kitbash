"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { cx, Icon, NumberRoll } from "../../shared/index.ts";
import { Button } from "../button/Button.tsx";
import "./inline-diff.css";

export interface DiffEdit {
  id: string;
  /** Words the AI wants to remove ("" for a pure insertion) */
  del: string;
  /** Words the AI wants to add ("" for a pure deletion) */
  ins: string;
  /** One-line reason shown in the popover */
  why?: string;
}

/** Prose as a list of plain strings and edits, in reading order */
export type DiffPart = string | DiffEdit;

export type DiffDecision = "accepted" | "rejected";

export const sampleDiff: DiffPart[] = [
  "Hi team, ",
  { id: "e1", del: "I wanted to quickly reach out and let you all know that", ins: "quick update:", why: "Gets to the point" },
  " the 4.0 release ",
  { id: "e2", del: "will hopefully be going", ins: "goes", why: "Commits to the date" },
  " live on Thursday, November 5 ",
  { id: "e3", del: "sometime in the morning", ins: "at 10:00 PT", why: "Gives an exact time" },
  ". ",
  { id: "e4", del: "Basically, the", ins: "The", why: "Drops a filler word" },
  " new billing page lets customers switch plans without ",
  { id: "e5", del: "having to contact", ins: "contacting", why: "Shorter" },
  " support, and we expect it to cut plan-change tickets by ",
  { id: "e6", del: "a lot", ins: "about 30%", why: "Uses the number from the October pilot" },
  ". Please flag anything that blocks the launch in #launch-team ",
  { id: "e7", del: "soon", ins: "by end of day Wednesday", why: "Uses the deadline from the launch plan" },
  ".",
];

export interface InlineDiffProps {
  parts?: DiffPart[];
  /** Title over the prose, e.g. the document name */
  title?: string;
  /** Decisions already made, by edit id */
  defaultDecisions?: Record<string, DiffDecision>;
  /** Edit whose popover starts open */
  defaultActive?: string;
  onChange?: (decisions: Record<string, DiffDecision>) => void;
  className?: string;
}

/**
 * AI edits shown inline in the prose. Each pending edit sits on a strip of decal tape (it is waiting on you):
 * struck words and added words side by side. Accept or reject one at a time with Y and N, move with J and K or Tab,
 * and Undo steps back. A decided edit peels its tape and the kept words snap into the sentence.
 */
export function InlineDiff({
  parts = sampleDiff,
  title = "Launch announcement, draft 3",
  defaultDecisions = {},
  defaultActive,
  onChange,
  className,
}: InlineDiffProps) {
  const edits = parts.filter((p): p is DiffEdit => typeof p !== "string");
  const [decisions, setDecisions] = useState<Record<string, DiffDecision>>(defaultDecisions);
  const [history, setHistory] = useState<string[][]>([]);
  const [active, setActive] = useState<string | null>(defaultActive ?? null);
  const [pop, setPop] = useState<{ left: number; top: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLSpanElement>());
  const closeTimer = useRef<number | undefined>(undefined);
  const hintId = useId();

  const pending = edits.filter((e) => !decisions[e.id]);
  const activeEdit = edits.find((e) => e.id === active && !decisions[e.id]);

  // Place the popover under the last line box of the active edit
  useLayoutEffect(() => {
    const el = active ? nodes.current.get(active) : undefined;
    const wrap = wrapRef.current;
    if (!el || !wrap || !activeEdit) return setPop(null);
    const rects = el.getClientRects();
    const r = rects[rects.length - 1] ?? el.getBoundingClientRect();
    const box = wrap.getBoundingClientRect();
    const left = Math.min(Math.max(r.left - box.left + r.width / 2, 120), box.width - 120);
    setPop({ left, top: r.bottom - box.top + 6 });
  }, [active, activeEdit, decisions]);

  const commit = (next: Record<string, DiffDecision>, ids: string[]) => {
    setDecisions(next);
    setHistory((h) => [...h, ids]);
    onChange?.(next);
  };

  const decide = (id: string, decision: DiffDecision) => {
    if (decisions[id]) return;
    commit({ ...decisions, [id]: decision }, [id]);
    // Hand focus to the next edit still waiting, so a keyboard run is Y, Y, N, Y…
    const order = pending.map((e) => e.id);
    const at = order.indexOf(id);
    const nextId = order[at + 1] ?? order[at - 1];
    if (nextId) {
      setActive(nextId);
      requestAnimationFrame(() => nodes.current.get(nextId)?.focus());
    } else {
      setActive(null);
      requestAnimationFrame(() => wrapRef.current?.querySelector<HTMLElement>(".kb-id-done")?.focus());
    }
  };

  const decideAll = (decision: DiffDecision) => {
    if (!pending.length) return;
    const next = { ...decisions };
    pending.forEach((e) => (next[e.id] = decision));
    commit(next, pending.map((e) => e.id));
    setActive(null);
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    const next = { ...decisions };
    last.forEach((id) => delete next[id]);
    setDecisions(next);
    setHistory((h) => h.slice(0, -1));
    onChange?.(next);
    const first = last[0];
    if (first) {
      setActive(first);
      requestAnimationFrame(() => nodes.current.get(first)?.focus());
    }
  };

  const move = (from: string, step: 1 | -1) => {
    const order = pending.map((e) => e.id);
    const nextId = order[order.indexOf(from) + step];
    if (!nextId) return;
    setActive(nextId);
    nodes.current.get(nextId)?.focus();
  };

  const onEditKey = (event: KeyboardEvent, id: string) => {
    const k = event.key.toLowerCase();
    if (k === "y" || k === "enter") { event.preventDefault(); decide(id, "accepted"); }
    else if (k === "n" || k === "backspace" || k === "delete") { event.preventDefault(); decide(id, "rejected"); }
    else if (k === "j" || k === "arrowright") { event.preventDefault(); move(id, 1); }
    else if (k === "k" || k === "arrowleft") { event.preventDefault(); move(id, -1); }
    else if (k === "escape") { setActive(null); }
  };

  const onRootKey = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
    }
  };

  const hover = (id: string | null) => {
    window.clearTimeout(closeTimer.current);
    if (id) setActive(id);
    else closeTimer.current = window.setTimeout(() => setActive(null), 180);
  };

  const accepted = Object.values(decisions).filter((d) => d === "accepted").length;

  return (
    <div className={cx("kb-root kb-id kb-part", className)} onKeyDown={onRootKey}>
      <header className="kb-id-bar">
        <Icon name="sparkle" size={18} className="kb-id-mark" />
        <div className="kb-id-title">
          <span>{title}</span>
          <span className="kb-id-left" aria-live="polite">
          {pending.length ? (
            <>
              <NumberRoll value={pending.length} /> of {edits.length} edits waiting
            </>
          ) : (
            `All ${edits.length} edits decided, ${accepted} accepted`
          )}
          </span>
        </div>
        <div className="kb-id-actions">
          <Button size="sm" variant="ghost" icon="undo" onClick={undo} disabled={!history.length} aria-keyshortcuts="Meta+Z Control+Z">
            Undo
          </Button>
          <Button size="sm" onClick={() => decideAll("rejected")} disabled={!pending.length}>
            Reject all
          </Button>
          <Button size="sm" variant="primary" onClick={() => decideAll("accepted")} disabled={!pending.length}>
            Accept all
          </Button>
        </div>
      </header>

      <div className="kb-id-prose" ref={wrapRef}>
        <p>
          {parts.map((part, i) => {
            if (typeof part === "string") return <span key={i}>{part}</span>;
            const d = decisions[part.id];
            if (d) {
              const kept = d === "accepted" ? part.ins : part.del;
              return (
                <span key={part.id} className="kb-id-done" data-decision={d} tabIndex={-1}>
                  {kept}
                </span>
              );
            }
            return (
              <span
                key={part.id}
                ref={(el) => {
                  if (el) nodes.current.set(part.id, el);
                  else nodes.current.delete(part.id);
                }}
                className="kb-id-edit"
                data-active={active === part.id || undefined}
                role="button"
                tabIndex={0}
                aria-label={describe(part)}
                aria-describedby={hintId}
                onFocus={() => setActive(part.id)}
                onClick={() => setActive(part.id)}
                onKeyDown={(e) => onEditKey(e, part.id)}
                onPointerEnter={() => hover(part.id)}
                onPointerLeave={() => hover(null)}
              >
                {part.del ? <del>{part.del}</del> : null}
                {part.del && part.ins ? " " : null}
                {part.ins ? <ins>{part.ins}</ins> : null}
              </span>
            );
          })}
        </p>

        {activeEdit && pop ? (
          <div
            className="kb-id-pop"
            style={{ left: pop.left, top: pop.top }}
            onPointerEnter={() => hover(activeEdit.id)}
            onPointerLeave={() => hover(null)}
          >
            {activeEdit.why ? <span className="kb-id-why">{activeEdit.why}</span> : null}
            <div className="kb-id-pop-row">
              <button type="button" tabIndex={-1} className="kb-id-pop-btn" data-kind="reject" onClick={() => decide(activeEdit.id, "rejected")}>
                <Icon name="x" size={14} /> Keep original <kbd>N</kbd>
              </button>
              <button type="button" tabIndex={-1} className="kb-id-pop-btn" data-kind="accept" onClick={() => decide(activeEdit.id, "accepted")}>
                <Icon name="check" size={14} /> Accept <kbd>Y</kbd>
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <p className="kb-id-keys" id={hintId}>
        <kbd>Y</kbd> accept <kbd>N</kbd> keep original <kbd>J</kbd> <kbd>K</kbd> next and previous <kbd>⌘Z</kbd> undo
      </p>
    </div>
  );
}

function describe(edit: DiffEdit) {
  if (!edit.del) return `Suggested addition: ${edit.ins}`;
  if (!edit.ins) return `Suggested removal: ${edit.del}`;
  return `Suggested edit: replace "${edit.del}" with "${edit.ins}"`;
}
