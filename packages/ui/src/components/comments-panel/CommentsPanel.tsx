import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Avatar, cx, Icon, Spinner, useReducedMotion } from "../../shared/index.ts";
import "./comments-panel.css";

export interface PanelEdit {
  removed: string;
  added: string;
}

export interface PanelComment {
  id: string;
  author: string;
  assistant?: boolean;
  time: string;
  /** Text in the document the comment is attached to */
  anchor: string;
  body: string;
  /** A runnable "/edit ..." instruction and the change it makes */
  command?: { text: string; edit: PanelEdit };
  /** Assigned to or mentions the current person */
  forYou?: boolean;
  resolved?: boolean;
}

export const DEFAULT_PANEL_COMMENTS: PanelComment[] = [
  {
    id: "p1",
    author: "Priya Raman",
    time: "9:14",
    anchor: "Revenue grew 18% quarter over quarter",
    body: "This should be year over year; the QoQ number was 6%.",
    command: {
      text: "change “quarter over quarter” to “year over year” in the revenue paragraph",
      edit: { removed: "Revenue grew 18% quarter over quarter", added: "Revenue grew 18% year over year" },
    },
    forYou: true,
  },
  {
    id: "p2",
    author: "Kitbash",
    assistant: true,
    time: "9:20",
    anchor: "Churn fell to 2.1%",
    body: "This is logo churn, but the appendix reports revenue churn (3.4%). Label both so the board doesn't compare them?",
    forYou: true,
  },
  {
    id: "p3",
    author: "Tom Becker",
    time: "Yesterday",
    anchor: "Hiring plan",
    body: "Too long for the board deck.",
    command: {
      text: "shorten the hiring section to three bullets",
      edit: { removed: "We plan to hire 14 people next quarter, mostly in engineering, with the rest split across…", added: "6 engineers, 4 in go-to-market, 4 in support" },
    },
  },
  {
    id: "p4",
    author: "Leah Kim",
    time: "Mon",
    anchor: "Gross margin 71%",
    body: "Confirmed with finance, this matches the September close.",
    resolved: true,
  },
];

type Filter = "all" | "open" | "you" | "resolved";
type RunState = "idle" | "running" | "applied";

export interface CommentsPanelProps {
  comments?: PanelComment[];
  you?: string;
  doc?: string;
  defaultFilter?: Filter;
  /** Time a simulated /edit takes, in ms */
  runMs?: number;
  onRun?: (comment: PanelComment) => void;
  onResolve?: (id: string, resolved: boolean) => void;
  className?: string;
}

const COMMANDS = [
  { cmd: "/edit", hint: "Ask Kitbash to change the doc" },
  { cmd: "/assign", hint: "Hand this comment to someone" },
];

/**
 * Comment feed for a document: filters, runnable /edit commands, resolve, and a composer. Comments waiting on you
 * carry a decal-yellow tab; resolving snaps a card shut into a thin cured-green seam you can reopen.
 */
export function CommentsPanel({
  comments: initial = DEFAULT_PANEL_COMMENTS,
  you = "Sam Rivera",
  doc = "Q3 board update",
  defaultFilter = "all",
  runMs = 1600,
  onRun,
  onResolve,
  className,
}: CommentsPanelProps) {
  const reduced = useReducedMotion();
  const [comments, setComments] = useState(initial);
  const [filter, setFilter] = useState<Filter>(defaultFilter);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [draft, setDraft] = useState("");
  const tabsRef = useRef<HTMLDivElement>(null);

  const counts = useMemo(
    () => ({
      all: comments.length,
      open: comments.filter((c) => !c.resolved).length,
      you: comments.filter((c) => c.forYou && !c.resolved).length,
      resolved: comments.filter((c) => c.resolved).length,
    }),
    [comments],
  );
  const visible = comments.filter((c) =>
    filter === "all" ? true : filter === "open" ? !c.resolved : filter === "you" ? c.forYou && !c.resolved : c.resolved,
  );

  const resolve = (id: string, resolved: boolean) => {
    setComments((list) => list.map((c) => (c.id === id ? { ...c, resolved } : c)));
    onResolve?.(id, resolved);
  };

  const run = (c: PanelComment) => {
    setRuns((r) => ({ ...r, [c.id]: "running" }));
    onRun?.(c);
    window.setTimeout(() => setRuns((r) => ({ ...r, [c.id]: "applied" })), reduced ? 0 : runMs);
  };

  const post = () => {
    const text = draft.trim();
    if (!text) return;
    const m = text.match(/^\/edit\s+(.+)/);
    const comment: PanelComment = {
      id: `n${Date.now()}`,
      author: you,
      time: "now",
      anchor: doc,
      body: m ? "" : text,
      command: m ? { text: m[1] ?? "", edit: { removed: "(selected text)", added: `(rewritten: ${m[1]})` } } : undefined,
    };
    setComments((list) => [comment, ...list]);
    setDraft("");
    if (filter === "resolved") setFilter("all");
  };

  const tabs: Array<{ id: Filter; label: string }> = [
    { id: "all", label: "All" },
    { id: "open", label: "Open" },
    { id: "you", label: "For you" },
    { id: "resolved", label: "Resolved" },
  ];
  const onTabsKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = tabs.findIndex((t) => t.id === filter);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
    setFilter(next.id);
    tabsRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  };

  const slash = draft.startsWith("/") && !draft.includes(" ");

  return (
    <aside className={cx("kb-cp kb-part", className)} aria-label={`Comments on ${doc}`}>
      <header className="kb-cp-head">
        <p className="kb-cp-title">
          Comments <span className="kb-cp-total">{counts.open} open</span>
        </p>
        <div className="kb-cp-tabs" role="tablist" aria-label="Filter comments" ref={tabsRef} onKeyDown={onTabsKey}>
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" data-tab={t.id} aria-selected={filter === t.id}
              tabIndex={filter === t.id ? 0 : -1} className="kb-cp-tab" onClick={() => setFilter(t.id)}>
              {t.label}
              <span className="kb-cp-n" data-you={(t.id === "you" && counts.you > 0) || undefined}>{counts[t.id]}</span>
            </button>
          ))}
        </div>
      </header>

      <ol className="kb-cp-feed" role="tabpanel" aria-label={tabs.find((t) => t.id === filter)?.label}>
        {visible.length === 0 ? (
          <li className="kb-cp-empty">{filter === "you" ? "Nothing waiting on you." : "No comments here yet."}</li>
        ) : null}
        {visible.map((c) => {
          const state = runs[c.id] ?? "idle";
          if (c.resolved && filter !== "resolved") {
            return (
              <li key={c.id} className="kb-cp-seam">
                <Icon name="check" size={13} strokeWidth={2.4} />
                <span className="kb-cp-seam-text"><strong>{c.author}</strong> on {c.anchor}</span>
                <button type="button" className="kb-cp-link" onClick={() => resolve(c.id, false)}>Reopen</button>
              </li>
            );
          }
          return (
            <li key={c.id} className="kb-cp-card" data-you={(c.forYou && !c.resolved) || undefined} data-resolved={c.resolved || undefined}>
              {c.forYou && !c.resolved ? <span className="kb-cp-decal">Waiting on you</span> : null}
              <div className="kb-cp-meta">
                {c.assistant ? <span className="kb-cp-bot" aria-hidden><Icon name="sparkle" size={12} /></span> : <Avatar name={c.author} size={22} />}
                <span className="kb-cp-author">{c.author}</span>
                <span className="kb-cp-time">{c.time}</span>
                <button type="button" className="kb-cp-resolve" aria-label={c.resolved ? "Reopen" : "Resolve"} title={c.resolved ? "Reopen" : "Resolve"}
                  aria-pressed={Boolean(c.resolved)} onClick={() => resolve(c.id, !c.resolved)}>
                  <Icon name={c.resolved ? "undo" : "check"} size={14} />
                </button>
              </div>
              <p className="kb-cp-anchor">{c.anchor}</p>
              {c.body ? <p className="kb-cp-body">{c.body}</p> : null}
              {c.command ? (
                <div className="kb-cp-cmd" data-state={state}>
                  <div className="kb-cp-cmd-row">
                    <code className="kb-cp-key">/edit</code>
                    <span className="kb-cp-cmd-text">{c.command.text}</span>
                  </div>
                  {state === "applied" ? (
                    <div className="kb-cp-diff">
                      <span data-kind="del">{c.command.edit.removed}</span>
                      <span data-kind="add">{c.command.edit.added}</span>
                    </div>
                  ) : null}
                  <div className="kb-cp-cmd-foot">
                    {state === "idle" ? (
                      <button type="button" className="kb-cp-run" onClick={() => run(c)}>
                        <Icon name="play" size={12} /> Run edit
                      </button>
                    ) : state === "running" ? (
                      <span className="kb-cp-running" role="status"><Spinner size={12} label="" /> Kitbash is editing</span>
                    ) : (
                      <>
                        <span className="kb-cp-applied" role="status"><Icon name="check" size={13} strokeWidth={2.4} /> Applied to the doc</span>
                        <button type="button" className="kb-cp-link" onClick={() => setRuns((r) => ({ ...r, [c.id]: "idle" }))}>Undo</button>
                        {!c.resolved ? <button type="button" className="kb-cp-link" onClick={() => resolve(c.id, true)}>Resolve</button> : null}
                      </>
                    )}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="kb-cp-compose">
        {slash ? (
          <ul className="kb-cp-slash" aria-label="Commands">
            {COMMANDS.filter((x) => x.cmd.startsWith(draft)).map((x) => (
              <li key={x.cmd}>
                <button type="button" onClick={() => setDraft(`${x.cmd} `)}>
                  <code>{x.cmd}</code>
                  <span>{x.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="kb-cp-field">
          <input
            className="kb-cp-input"
            value={draft}
            placeholder="Comment, or type /edit"
            aria-label="New comment"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") post();
              if (e.key === "Tab" && slash) {
                const first = COMMANDS.find((x) => x.cmd.startsWith(draft));
                if (first) {
                  e.preventDefault();
                  setDraft(`${first.cmd} `);
                }
              }
            }}
          />
          <button type="button" className="kb-cp-post" onClick={post} disabled={!draft.trim()} aria-label="Post comment">
            <Icon name="arrowUp" size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
    </aside>
  );
}
