"use client";

import { Fragment, useId, useState, type ReactNode } from "react";
import { cx, Icon } from "../../shared/index.ts";
import "./cited-answer.css";

export interface CitedSource {
  title: string;
  domain: string;
  /** The passage the answer quotes from */
  passage: string;
  color?: string;
}

export interface Citation {
  /** Index into `sources` */
  source: number;
  /** Words from the source passage that back the sentence; marked when the passage unfolds */
  quote: string;
}

export interface CitedSentence {
  text: string;
  cites: Citation[];
}

export const DEFAULT_CITED_SOURCES: CitedSource[] = [
  {
    title: "INC-2291 timeline",
    domain: "pagerduty.com",
    color: "#06ac38",
    passage: "09:12 deploy cfg-8812 applied to payments-api; pool size changed from 200 to 20. 09:14 alert fired and paged secondary because primary handoff was in progress. 09:31 incident channel opened.",
  },
  {
    title: "Postmortem: EU checkout outage",
    domain: "notion.so",
    color: "#37352f",
    passage: "Once the config diff was identified at 09:55, the rollback completed in 4 minutes. Action items: enforce a minimum pool size in config validation; schedule on-call handoffs at :30 instead of on the hour.",
  },
  {
    title: "checkout-5xx alert rule",
    domain: "grafana.internal",
    color: "#f46800",
    passage: "Rule checkout-5xx: fire when 5xx rate above 5% for 2m in any EU region. Last fired 09:14:07 UTC on Oct 14.",
  },
  {
    title: "Cardrail status, Oct 14",
    domain: "status.cardrail.com",
    color: "#1f7fb8",
    passage: "Investigating: some merchants may see degraded latency in eu-west. Resolved at 10:02 UTC; no transactions were lost.",
  },
];

export const DEFAULT_CITED_PARAGRAPHS: CitedSentence[][] = [
  [
    { text: "The outage started at 09:12 UTC, when a config push cut the payments-api connection pool from 200 to 20.", cites: [{ source: 0, quote: "pool size changed from 200 to 20" }] },
    {
      text: "Errors crossed the alert threshold two minutes later, but the page went to the secondary on-call because the primary was mid-handoff.",
      cites: [{ source: 2, quote: "5xx rate above 5% for 2m" }, { source: 0, quote: "paged secondary because primary handoff was in progress" }],
    },
  ],
  [
    { text: "Most of the 47 minutes went to diagnosis: the team first suspected the card processor, whose status page showed slow responses in the same region.", cites: [{ source: 3, quote: "degraded latency in eu-west" }] },
    { text: "Once someone spotted the config diff, the rollback took four minutes.", cites: [{ source: 1, quote: "the rollback completed in 4 minutes" }] },
    { text: "The postmortem adds a pool-size floor to config validation and moves handoffs off the hour.", cites: [{ source: 1, quote: "enforce a minimum pool size in config validation" }] },
  ],
];

/** Wrap the quote inside the passage in <mark>; falls back to the plain passage when the words are not found. */
function markQuote(passage: string, quote: string): ReactNode {
  const at = passage.toLowerCase().indexOf(quote.toLowerCase());
  if (at < 0) return passage;
  return (
    <>
      {passage.slice(0, at)}
      <mark className="kb-ca-mark">{passage.slice(at, at + quote.length)}</mark>
      {passage.slice(at + quote.length)}
    </>
  );
}

export interface CitedAnswerProps {
  question?: string;
  sources?: CitedSource[];
  paragraphs?: CitedSentence[][];
  /** Citation unfolded on first render, as "paragraph-sentence-cite" (e.g. "0-1-0") */
  defaultOpen?: string | null;
  className?: string;
}

type Point = { p: number; s: number; c: number };
const keyOf = ({ p, s, c }: Point) => `${p}-${s}-${c}`;

/**
 * An AI answer wired to its sources. Point at a citation and its sentence and source light up together; click it
 * and the quoted passage opens as a recessed well cut into the answer, with the matching words raised and marked.
 */
export function CitedAnswer({
  question = "Why did the EU checkout outage on Oct 14 last 47 minutes?",
  sources = DEFAULT_CITED_SOURCES,
  paragraphs = DEFAULT_CITED_PARAGRAPHS,
  defaultOpen = null,
  className,
}: CitedAnswerProps) {
  const [hot, setHot] = useState<Point | null>(null);
  const [open, setOpen] = useState<string | null>(defaultOpen);
  const uid = useId();

  const openPoint = open ? (open.split("-").map(Number) as [number, number, number]) : null;
  const lit = hot ?? (openPoint ? { p: openPoint[0], s: openPoint[1], c: openPoint[2] } : null);
  const litSource = lit ? paragraphs[lit.p]?.[lit.s]?.cites[lit.c]?.source : undefined;

  // Number citations by the source they point at so the same source keeps the same number everywhere.
  return (
    <article className={cx("kb-ca kb-part", className)}>
      <header className="kb-ca-head">
        <span className="kb-ca-badge" aria-hidden><Icon name="sparkle" size={14} /></span>
        <h3 className="kb-ca-q">{question}</h3>
      </header>

      <div className="kb-ca-body">
        {paragraphs.map((para, p) => {
          const openHere = openPoint && openPoint[0] === p ? openPoint : null;
          const cite = openHere ? para[openHere[1]]?.cites[openHere[2]] : undefined;
          const src = cite ? sources[cite.source] : undefined;
          return (
            <Fragment key={p}>
              <p className="kb-ca-p">
                {para.map((sentence, s) => (
                  <Fragment key={s}>
                    <span className="kb-ca-sentence" data-lit={(lit && lit.p === p && lit.s === s) || undefined}>
                      {sentence.text}
                    </span>
                    {sentence.cites.map((c, ci) => {
                      const point = { p, s, c: ci };
                      const k = keyOf(point);
                      const isOpen = open === k;
                      return (
                        <button
                          key={ci}
                          type="button"
                          className="kb-ca-cite"
                          data-lit={litSource === c.source || undefined}
                          aria-expanded={isOpen}
                          aria-controls={isOpen ? `${uid}-well` : undefined}
                          aria-label={`Source ${c.source + 1}, ${sources[c.source]?.title ?? ""}. ${isOpen ? "Hide" : "Show"} quoted passage`}
                          onPointerEnter={() => setHot(point)}
                          onPointerLeave={() => setHot(null)}
                          onFocus={() => setHot(point)}
                          onBlur={() => setHot(null)}
                          onClick={() => setOpen(isOpen ? null : k)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setOpen(null);
                          }}
                        >
                          {c.source + 1}
                        </button>
                      );
                    })}{" "}
                  </Fragment>
                ))}
              </p>
              {cite && src ? (
                <div className="kb-ca-well" id={`${uid}-well`} role="region" aria-label={`Quoted from ${src.title}`} key={open ?? ""}>
                  <div className="kb-ca-well-head">
                    <span className="kb-ca-fav" style={{ background: src.color ?? "#4d5b66" }} aria-hidden />
                    <span className="kb-ca-well-title">{src.title}</span>
                    <span className="kb-ca-well-domain">{src.domain}</span>
                    <button type="button" className="kb-ca-close" aria-label="Close passage" onClick={() => setOpen(null)}>
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                  <blockquote className="kb-ca-passage">{markQuote(src.passage, cite.quote)}</blockquote>
                </div>
              ) : null}
            </Fragment>
          );
        })}
      </div>

      <footer className="kb-ca-sources">
        <p className="kb-ca-sources-title">Sources</p>
        <ol>
          {sources.map((s, i) => (
            <li key={s.title} className="kb-ca-source" data-lit={litSource === i || undefined}>
              <span className="kb-ca-num" aria-hidden>{i + 1}</span>
              <span className="kb-ca-fav" style={{ background: s.color ?? "#4d5b66" }} aria-hidden />
              <span className="kb-ca-source-title">{s.title}</span>
              <span className="kb-ca-source-domain">{s.domain}</span>
            </li>
          ))}
        </ol>
      </footer>
    </article>
  );
}
