import { Fragment, useEffect, useId, useMemo, useState } from "react";
import { cx, Icon, Shimmer, Spinner, useReducedMotion } from "../../shared/index.ts";
import { MessageActions } from "../message-actions/MessageActions.tsx";
import "./ai-answer.css";

export interface AnswerSource {
  title: string;
  domain: string;
  /** The passage the answer leans on */
  snippet: string;
  /** Mark color (data) */
  color?: string;
}

export const DEFAULT_ANSWER_SOURCES: AnswerSource[] = [
  { title: "Prorations", domain: "docs.stripe.com", color: "#635bff", snippet: "When a subscription changes mid-cycle, Stripe credits unused time on the old price and charges the new price for the rest of the period." },
  { title: "Billing policy v3", domain: "notion.so", color: "#37352f", snippet: "Downgrades take effect at the end of the current billing period. Support may approve a prorated credit as an exception." },
  { title: "Refund requests, Q3", domain: "metabase.internal", color: "#509ee3", snippet: "62% of downgrade tickets asked for money back; median wait for a reply was 19 hours." },
  { title: "BIL-511 Self-serve downgrade credits", domain: "linear.app", color: "#5e6ad2", snippet: "Proposal: issue an account credit automatically when a Team workspace downgrades with more than 14 days left." },
];

/** Answer text: blank lines split paragraphs, [n] cites source n (1-based). Each entry is one version. */
export const DEFAULT_ANSWERS = [
  "Downgrade at the end of the billing period by default; that is already our written policy [2] and it keeps invoices simple.\n\nWhen someone downgrades with a lot of the period left, issue a prorated account credit instead of a refund. Stripe calculates the unused time for you when the subscription item changes [1], so the credit matches what the customer expects.\n\nDoing this automatically would remove most of the support load: 62% of downgrade tickets ask for money back [3], and BIL-511 already proposes a 14-day threshold [4].",
  "Keep end-of-period downgrades as the default [2], but credit unused time automatically when more than 14 days remain [4]. Stripe's proration handles the math [1].\n\nThis turns the most common downgrade ticket into a no-touch flow; most of those tickets are refund requests today [3].",
];

export const DEFAULT_FOLLOW_UPS = [
  "Draft the support macro for mid-cycle downgrades",
  "How much credit did we issue for downgrades last quarter?",
  "What changes in the Stripe integration to automate this?",
];

type Token = { kind: "word"; text: string } | { kind: "cite"; n: number } | { kind: "break" };

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  text.split(/\n\n+/).forEach((para, p) => {
    if (p > 0) out.push({ kind: "break" });
    for (const part of para.split(/(\[\d+\])|\s+/).filter(Boolean)) {
      const m = part.match(/^\[(\d+)\]$/);
      if (m) out.push({ kind: "cite", n: Number(m[1]) });
      else out.push({ kind: "word", text: part });
    }
  });
  return out;
}

export interface AiAnswerProps {
  question?: string;
  sources?: AnswerSource[];
  /** One entry per version; regenerate moves to the next */
  answers?: string[];
  followUps?: string[];
  /** Stream on mount */
  autoplay?: boolean;
  /** Time per streamed word, in ms */
  wordMs?: number;
  onFollowUp?: (question: string) => void;
  className?: string;
}

/**
 * Streamed answer with numbered source cards, citation studs that preview their source, a quiet action bar and
 * follow-ups. Each stud and its source card are a peg and socket: point at one and the other presses in.
 */
export function AiAnswer({
  question = "How should we handle proration when a Team customer downgrades mid-cycle?",
  sources = DEFAULT_ANSWER_SOURCES,
  answers = DEFAULT_ANSWERS,
  followUps = DEFAULT_FOLLOW_UPS,
  autoplay = true,
  wordMs = 45,
  onFollowUp,
  className,
}: AiAnswerProps) {
  const reduced = useReducedMotion();
  const [version, setVersion] = useState(0);
  const [run, setRun] = useState(0);
  const tokens = useMemo(() => tokenize(answers[version] ?? ""), [answers, version]);
  const [shown, setShown] = useState(autoplay ? -6 : Number.MAX_SAFE_INTEGER);
  const [hot, setHot] = useState<number | null>(null);
  const [peek, setPeek] = useState<{ n: number; key: string; align: "start" | "center" | "end" } | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const uid = useId();

  // Negative counts are the "searching" beat before the first word; sources drop in during it.
  const streaming = !reduced && shown < tokens.length;
  useEffect(() => {
    if (!streaming) return;
    const id = window.setTimeout(() => setShown((s) => s + 1), shown < 0 ? 180 : wordMs);
    return () => window.clearTimeout(id);
  }, [streaming, shown, wordMs, run]);

  const count = reduced ? tokens.length : shown;
  const searching = count < 0;
  const visibleSources = searching ? Math.max(0, sources.length + count + 2) : sources.length;
  const done = count >= tokens.length;

  // Regenerate streams the new version; switching between existing versions shows them whole.
  const restream = (v: number, stream: boolean) => {
    setVersion(v);
    setShown(reduced || !stream ? Number.MAX_SAFE_INTEGER : 0);
    setRun((r) => r + 1);
    setPeek(null);
  };

  // Group visible tokens into paragraphs.
  const paragraphs: Array<Array<{ t: Token; i: number }>> = [[]];
  tokens.slice(0, Math.max(0, count)).forEach((t, i) => {
    if (t.kind === "break") paragraphs.push([]);
    else paragraphs[paragraphs.length - 1]!.push({ t, i });
  });

  // Keep the preview card inside the answer: align it to whichever side of the stud has room.
  const openPeek = (n: number, key: string, el: HTMLElement) => {
    setHot(n);
    const box = el.closest(".kb-aa")?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const x = box ? r.left - box.left : 200;
    const w = box?.width ?? 600;
    setPeek({ n, key, align: x < 150 ? "start" : x > w - 150 ? "end" : "center" });
  };

  const plain = (answers[version] ?? "").replace(/\s?\[\d+\]/g, "");

  return (
    <article className={cx("kb-aa", className)} aria-busy={!done}>
      <h3 className="kb-aa-q">{question}</h3>

      <ol className="kb-aa-sources" aria-label="Sources">
        {sources.map((s, i) => {
          const n = i + 1;
          return (
            <li key={s.title} className="kb-aa-source" data-hot={hot === n || undefined} data-in={i < visibleSources || undefined}
              onPointerEnter={() => setHot(n)} onPointerLeave={() => setHot(null)}>
              <a href={`https://${s.domain}`} onClick={(e) => e.preventDefault()} onFocus={() => setHot(n)} onBlur={() => setHot(null)}>
                <span className="kb-aa-socket" aria-hidden>{n}</span>
                <span className="kb-aa-source-title">{s.title}</span>
                <span className="kb-aa-source-domain">
                  <span className="kb-aa-fav" style={{ background: s.color ?? "#4d5b66" }} aria-hidden />
                  {s.domain}
                </span>
              </a>
            </li>
          );
        })}
      </ol>

      <div className="kb-aa-body" aria-live="off">
        {searching ? (
          <p className="kb-aa-status"><Spinner size={13} label="" /><Shimmer>Reading {sources.length} sources</Shimmer></p>
        ) : (
          paragraphs.map((para, p) => (
            <p key={p} className="kb-aa-p">
              {para.map(({ t, i }) => {
                if (t.kind === "word") return <Fragment key={i}>{(i > 0 && !/^[,.;:)]/.test(t.text) ? " " : "") + t.text}</Fragment>;
                if (t.kind !== "cite") return null;
                const src = sources[t.n - 1];
                const key = `${p}-${i}`;
                const open = peek?.key === key;
                return (
                  <span key={i} className="kb-aa-cite-wrap">
                    {" "}
                    <button
                      type="button"
                      className="kb-aa-stud"
                      data-hot={hot === t.n || undefined}
                      aria-label={`Source ${t.n}: ${src?.title ?? ""}`}
                      aria-expanded={open}
                      aria-describedby={open ? `${uid}-peek` : undefined}
                      onPointerEnter={(e) => openPeek(t.n, key, e.currentTarget)}
                      onPointerLeave={() => { setHot(null); setPeek(null); }}
                      onFocus={(e) => openPeek(t.n, key, e.currentTarget)}
                      onBlur={() => { setHot(null); setPeek(null); }}
                      onKeyDown={(e) => e.key === "Escape" && setPeek(null)}
                    >
                      {t.n}
                    </button>
                    {open && src ? (
                      <span className="kb-aa-peek" role="tooltip" id={`${uid}-peek`} data-align={peek?.align}>
                        <span className="kb-aa-peek-head">
                          <span className="kb-aa-fav" style={{ background: src.color ?? "#4d5b66" }} aria-hidden />
                          {src.domain}
                        </span>
                        <span className="kb-aa-peek-title">{src.title}</span>
                        <span className="kb-aa-peek-snip">{src.snippet}</span>
                      </span>
                    ) : null}
                  </span>
                );
              })}
              {!done && p === paragraphs.length - 1 ? <span className="kb-aa-caret" aria-hidden /> : null}
            </p>
          ))
        )}
        {done ? <p className="kb-sr" role="status">Answer ready</p> : null}
      </div>

      <div className="kb-aa-foot" data-in={done || undefined} inert={!done}>
        <MessageActions
          key={answers.length}
          text={plain}
          versions={1}
          onRegenerate={(v) => restream((v - 1) % answers.length, true)}
          onVersionChange={(v) => restream((v - 1) % answers.length, false)}
        />
        <div className="kb-aa-follow">
          <p className="kb-aa-follow-title">Ask next</p>
          {followUps.map((f) => (
            <button key={f} type="button" className="kb-aa-follow-btn" data-asked={asked === f || undefined}
              onClick={() => { setAsked(f); onFollowUp?.(f); }}>
              <Icon name={asked === f ? "check" : "plus"} size={14} />
              <span>{f}</span>
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}
