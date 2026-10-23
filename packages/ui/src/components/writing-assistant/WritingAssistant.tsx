"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cx, Icon, Shimmer, Spinner, useInterval, useReducedMotion } from "../../shared/index.ts";
import "./writing-assistant.css";

export interface WritingSuggestion {
  id: string;
  label: string;
  /** The rewrite the assistant streams back */
  result: string;
}

export const DEFAULT_DRAFT =
  "Hi Jordan, thanks for getting back to us about the renewal. We looked into the numbers again and I think there might be some room to move on the per seat price if you are able to commit to the annual plan instead of monthly, but I'd need to check with finance first before I can promise anything. Let me know what you think and we can go from there.";

export const DEFAULT_SUGGESTIONS: WritingSuggestion[] = [
  {
    id: "shorter",
    label: "Make it shorter",
    result: "Hi Jordan, thanks for the reply. If you move to the annual plan, we can likely lower the per-seat price. I'll confirm the exact number with finance and get back to you.",
  },
  {
    id: "warmer",
    label: "Warmer tone",
    result: "Hi Jordan, thanks so much for coming back to us, and for another year together. We took a second look, and if annual works for your team, I'd love to bring the per-seat price down. Let me check the details with finance so I can promise you something real.",
  },
  {
    id: "ask",
    label: "Add a clear ask",
    result: "Hi Jordan, thanks for getting back to us about the renewal. If you can commit to the annual plan, there's room to lower the per-seat price. Could you let me know by Friday whether annual works for your team? I'll confirm the number with finance and send revised terms the same day.",
  },
  {
    id: "grammar",
    label: "Fix grammar",
    result: "Hi Jordan, thanks for getting back to us about the renewal. We looked at the numbers again, and there may be room to move on the per-seat price if you can commit to the annual plan instead of monthly. I'd need to check with finance before I can promise anything. Let me know what you think, and we can go from there.",
  },
];

const CUSTOM_RESULT =
  "Hi Jordan, thanks for getting back to us. If your team commits to the annual plan, we will lower the per-seat price. Finance signs off on Thursday, and I'll have revised terms in your inbox that afternoon.";
const SPOKEN = "make it sound more confident and mention that finance signs off on Thursday".split(" ");

type Turn = { id: number; ask: string; result: string; state: "thinking" | "streaming" | "done" };

export interface WritingAssistantProps {
  draft?: string;
  /** Who the draft is for, shown in the header */
  context?: string;
  suggestions?: WritingSuggestion[];
  /** Run the first suggestion on mount (catalog demos) */
  demo?: boolean;
  /** Start in voice dictation (catalog states) */
  defaultListening?: boolean;
  /** Time per streamed word, in ms */
  wordMs?: number;
  onApply?: (text: string, mode: "replace" | "insert") => void;
  className?: string;
}

/**
 * AI writing card: quick suggestions, streamed rewrites you can drop into the draft, and live voice dictation.
 * Instead of a decorative glow, the card's rim is edge-lit like clear acrylic: it lights ultramarine only while
 * the assistant is writing or listening, and goes dark again when it is idle.
 */
export function WritingAssistant({
  draft: initialDraft = DEFAULT_DRAFT,
  context = "Reply to Jordan Lee about renewal terms",
  suggestions = DEFAULT_SUGGESTIONS,
  demo = false,
  defaultListening = false,
  wordMs = 40,
  onApply,
  className,
}: WritingAssistantProps) {
  const reduced = useReducedMotion();
  const [draft, setDraft] = useState(initialDraft);
  const [flash, setFlash] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [words, setWords] = useState(0);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(defaultListening);
  const [heard, setHeard] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: 14 }, () => 0.25));
  const nextId = useRef(1);
  const feed = useRef<HTMLDivElement>(null);
  const draftId = useId();

  const active = turns[turns.length - 1];
  const busy = active ? active.state !== "done" : false;

  const ask = (label: string, result: string) => {
    if (busy) return;
    const id = nextId.current++;
    setTurns((t) => [...t.slice(-2), { id, ask: label, result, state: reduced ? "done" : "thinking" }]);
    setWords(0);
  };

  useEffect(() => {
    if (!demo) return;
    const first = suggestions[0];
    if (!first) return;
    const id = window.setTimeout(() => ask(first.label, first.result), 500);
    return () => window.clearTimeout(id);
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Thinking beat, then the rewrite streams word by word.
  useEffect(() => {
    if (!active || active.state === "done") return;
    const total = active.result.split(" ").length;
    const finish = (state: Turn["state"]) => setTurns((t) => t.map((x) => (x.id === active.id ? { ...x, state } : x)));
    if (active.state === "thinking") {
      const id = window.setTimeout(() => finish("streaming"), 900);
      return () => window.clearTimeout(id);
    }
    if (words >= total) {
      finish("done");
      return;
    }
    const id = window.setTimeout(() => setWords((w) => w + 1), wordMs);
    return () => window.clearTimeout(id);
  }, [active, words, wordMs]);

  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [turns, words, reduced]);

  // Dictation: words land in the input while the level meter moves.
  const spoken = SPOKEN;
  useInterval(() => setLevels((l) => [...l.slice(1), 0.2 + Math.random() * 0.8]), listening && !reduced ? 100 : null);
  useInterval(() => setHeard((h) => h + 1), listening && !reduced && heard < spoken.length ? 230 : null);
  useEffect(() => {
    if (!listening) return;
    if (reduced && heard < spoken.length) setHeard(spoken.length);
    setInput(spoken.slice(0, heard).join(" "));
    if (heard >= spoken.length) {
      const id = window.setTimeout(() => setListening(false), 700);
      return () => window.clearTimeout(id);
    }
  }, [listening, heard, reduced, spoken]);

  const toggleMic = () => {
    if (listening) setListening(false);
    else {
      setHeard(0);
      setInput("");
      setListening(true);
    }
  };

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setListening(false);
    ask(text, CUSTOM_RESULT);
    setInput("");
  };

  const apply = (text: string, mode: "replace" | "insert") => {
    setDraft((d) => (mode === "replace" ? text : `${d}\n\n${text}`));
    setFlash((f) => f + 1);
    onApply?.(text, mode);
  };

  const lit = busy || listening;
  return (
    <section className={cx("kb-wa", className)} data-lit={lit || undefined} aria-label="Writing assistant">
      <header className="kb-wa-head">
        <span className="kb-wa-badge" aria-hidden><Icon name="edit" size={14} /></span>
        <span className="kb-wa-title">
          <strong>Writing assistant</strong>
          <span>{context}</span>
        </span>
        {lit ? <span className="kb-wa-live">{listening ? "Listening" : "Writing"}</span> : null}
      </header>

      <div className="kb-wa-draft" key={flash} data-flash={flash > 0 || undefined}>
        <label className="kb-sr" htmlFor={draftId}>Draft</label>
        <textarea id={draftId} value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} />
      </div>

      <div className="kb-wa-chips" role="group" aria-label="Suggestions">
        {suggestions.map((s) => (
          <button key={s.id} type="button" className="kb-wa-chip" disabled={busy} onClick={() => ask(s.label, s.result)}>
            <Icon name="sparkle" size={13} />
            {s.label}
          </button>
        ))}
      </div>

      {turns.length ? (
        <div className="kb-wa-feed" ref={feed} aria-live="polite">
          {turns.map((t) => {
            const isActive = t.id === active?.id;
            const shown = t.state === "done" || !isActive ? t.result : t.result.split(" ").slice(0, words).join(" ");
            return (
              <div key={t.id} className="kb-wa-turn">
                <p className="kb-wa-ask">{t.ask}</p>
                <div className="kb-wa-reply">
                  {t.state === "thinking" ? (
                    <p className="kb-wa-thinking"><Spinner size={12} label="" /><Shimmer>Rewriting your draft</Shimmer></p>
                  ) : (
                    <p className="kb-wa-text">
                      {shown}
                      {t.state === "streaming" ? <span className="kb-wa-caret" aria-hidden /> : null}
                    </p>
                  )}
                  {t.state === "done" ? (
                    <div className="kb-wa-actions">
                      <button type="button" className="kb-wa-apply" onClick={() => apply(t.result, "replace")}>
                        <Icon name="check" size={13} strokeWidth={2.2} /> Replace draft
                      </button>
                      <button type="button" className="kb-wa-ghost" onClick={() => apply(t.result, "insert")}>Insert below</button>
                      <button type="button" className="kb-wa-ghost" onClick={() => ask(t.ask, t.result)} disabled={busy}>
                        <Icon name="refresh" size={13} /> Try again
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="kb-wa-input" data-listening={listening || undefined}>
        {listening ? (
          <span className="kb-wa-meter" aria-hidden>
            {levels.map((l, i) => <i key={i} style={{ transform: `scaleY(${l})` }} />)}
          </span>
        ) : null}
        <input
          value={input}
          placeholder={listening ? "Listening" : "Tell Kitbash what to change"}
          aria-label="Instruction"
          readOnly={listening}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button type="button" className="kb-wa-mic" aria-pressed={listening} aria-label={listening ? "Stop dictation" : "Dictate"} onClick={toggleMic}>
          <Icon name={listening ? "stop" : "mic"} size={listening ? 13 : 16} />
        </button>
        <button type="button" className="kb-wa-send" aria-label="Send instruction" disabled={!input.trim() || busy || listening} onClick={submit}>
          <Icon name="arrowUp" size={15} strokeWidth={2} />
        </button>
      </div>
    </section>
  );
}
