"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cx, Icon, NumberRoll, Tag, useReducedMotion } from "../../shared/index.ts";
import "./setup-guide.css";

export interface SetupTask {
  id: string;
  label: string;
  detail?: string;
  /** Someone other than the viewer has to do this; shown with the decal "waiting" tag */
  waitingOn?: string;
}

export interface SetupGroup {
  id: string;
  title: string;
  tasks: SetupTask[];
}

export interface SetupGuideProps {
  title?: string;
  groups?: SetupGroup[];
  /** Task ids complete on mount */
  defaultDone?: string[];
  onChange?: (done: string[]) => void;
  className?: string;
}

export const demoSetupGroups: SetupGroup[] = [
  {
    id: "connect",
    title: "Connect your workspace",
    tasks: [
      { id: "gh", label: "Install the GitHub app", detail: "Read access to kitbash/feature-registry." },
      { id: "slack", label: "Connect Slack", detail: "Atlas posts summaries to #eng-updates." },
      { id: "model", label: "Choose a default model" },
    ],
  },
  {
    id: "teach",
    title: "Teach Atlas your codebase",
    tasks: [
      { id: "index", label: "Index the main repository", detail: "2,184 chunks across 412 files." },
      { id: "rules", label: "Write two house rules for code review", detail: "For example: no new dependencies without a note." },
      { id: "owners", label: "Map CODEOWNERS to reviewers" },
    ],
  },
  {
    id: "live",
    title: "Go live",
    tasks: [
      { id: "eval", label: "Run the starter eval suite", detail: "40 cases, about 3 minutes." },
      { id: "budget", label: "Set a monthly budget", detail: "Most teams this size start at $400." },
      { id: "prod", label: "Approve production access", waitingOn: "Priya Raman" },
      { id: "help", label: "Turn Atlas on in #help" },
    ],
  },
];

const DEFAULT_DONE = ["gh", "slack", "model", "index"];

function summary(tasks: number, steps: number): string {
  if (tasks === 0) return "Everything is in place.";
  const t = `${tasks} ${tasks === 1 ? "task" : "tasks"} left`;
  return steps === 1 ? `${t} in the last step` : `${t} across ${steps} steps`;
}

/**
 * Onboarding panel with an overall progress groove and collapsible task groups numbered like kit instruction steps.
 * Finishing a task scores a line through it from left to right; a finished group cures its step badge green,
 * folds itself away and opens the next unfinished group.
 */
export function SetupGuide({
  title = "Set up Atlas",
  groups = demoSetupGroups,
  defaultDone = DEFAULT_DONE,
  onChange,
  className,
}: SetupGuideProps) {
  const reduced = useReducedMotion();
  const uid = useId();
  const [done, setDone] = useState<string[]>(defaultDone);
  const isGroupDone = (g: SetupGroup, list = done) => g.tasks.every((t) => list.includes(t.id));
  const [open, setOpen] = useState<string[]>(() => {
    const first = groups.find((g) => !isGroupDone(g));
    return first ? [first.id] : [];
  });
  const foldTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(foldTimer.current), []);

  const all = groups.flatMap((g) => g.tasks);
  const complete = all.filter((t) => done.includes(t.id)).length;
  const pct = all.length ? Math.round((complete / all.length) * 100) : 0;

  const toggleTask = (group: SetupGroup, taskId: string) => {
    const next = done.includes(taskId) ? done.filter((d) => d !== taskId) : [...done, taskId];
    setDone(next);
    onChange?.(next);
    if (!isGroupDone(group, done) && isGroupDone(group, next)) {
      // Let the last score line finish drawing, then fold this group and open the next unfinished one
      const after = groups.find((g) => !isGroupDone(g, next));
      window.clearTimeout(foldTimer.current);
      foldTimer.current = window.setTimeout(
        () => setOpen((o) => [...o.filter((id) => id !== group.id), ...(after && !o.includes(after.id) ? [after.id] : [])]),
        reduced ? 0 : 650,
      );
    }
  };

  const toggleGroup = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));

  return (
    <section className={cx("kb-root kb-part kb-sg", className)} aria-labelledby={`${uid}-t`}>
      <header className="kb-sg-head">
        <div>
          <h2 className="kb-sg-title" id={`${uid}-t`}>{title}</h2>
          <p className="kb-sg-sub">
            {summary(all.length - complete, groups.filter((g) => !isGroupDone(g)).length)}
          </p>
        </div>
        <span className="kb-sg-pct" aria-hidden>
          <NumberRoll value={pct} />%
        </span>
      </header>
      <div
        className="kb-sg-groove"
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span className="kb-sg-fill" data-done={pct === 100 || undefined} style={{ width: `${pct}%` }} />
      </div>

      <ol className="kb-sg-groups">
        {groups.map((g, gi) => {
          const groupDone = isGroupDone(g);
          const isOpen = open.includes(g.id);
          const count = g.tasks.filter((t) => done.includes(t.id)).length;
          return (
            <li key={g.id} className="kb-sg-group" data-done={groupDone || undefined} data-open={isOpen || undefined}>
              <h3 className="kb-sg-gh">
                <button
                  type="button"
                  className="kb-sg-toggle"
                  aria-expanded={isOpen}
                  aria-controls={`${uid}-${g.id}`}
                  onClick={() => toggleGroup(g.id)}
                >
                  <span className="kb-sg-step" aria-hidden>
                    {groupDone ? <Icon name="check" size={14} strokeWidth={2.6} /> : gi + 1}
                  </span>
                  <span className="kb-sg-gtitle">
                    <span className="kb-sr">Step {gi + 1}: </span>
                    {g.title}
                  </span>
                  <span className="kb-sg-gcount">
                    {count}/{g.tasks.length}
                    <span className="kb-sr"> done</span>
                  </span>
                  <Icon name="chevronDown" size={16} className="kb-sg-chev" />
                </button>
              </h3>
              <div className="kb-sg-panel" id={`${uid}-${g.id}`} role="region" aria-label={g.title} inert={!isOpen || undefined}>
                <ul className="kb-sg-tasks">
                  {g.tasks.map((t) => {
                    const isDone = done.includes(t.id);
                    return (
                      <li key={t.id} className="kb-sg-task" data-done={isDone || undefined}>
                        <label className="kb-sg-row">
                          <input type="checkbox" className="kb-sg-check" checked={isDone} onChange={() => toggleTask(g, t.id)} />
                          <span className="kb-sg-box" aria-hidden>
                            <Icon name="check" size={12} strokeWidth={3} />
                          </span>
                          <span className="kb-sg-text">
                            <span className="kb-sg-label">{t.label}</span>
                            {t.detail ? <span className="kb-sg-detail">{t.detail}</span> : null}
                          </span>
                          {t.waitingOn && !isDone ? <Tag tone="decal" dot>Waiting on {t.waitingOn.split(" ")[0]}</Tag> : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
