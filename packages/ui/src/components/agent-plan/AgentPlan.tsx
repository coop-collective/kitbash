import { useEffect, useRef, useState } from "react";
import type { CSSProperties, DragEvent, KeyboardEvent } from "react";
import { cx, formatDuration, Icon, Spinner, useInterval } from "../../shared/index.ts";
import { Button } from "../button/Button.tsx";
import "./agent-plan.css";

export type PlanStepStatus = "idle" | "running" | "done" | "failed";

export interface PlanStep {
  id: string;
  title: string;
  /** Tool the step will call, shown as a code chip */
  tool?: string;
  /** Demo: seconds the step takes to run */
  seconds?: number;
  /** Demo: the first attempt fails with this message */
  failsWith?: string;
}

export const samplePlan: PlanStep[] = [
  { id: "s1", title: "Collect pull requests merged since v3.9", tool: "github.list_pulls", seconds: 1.6 },
  { id: "s2", title: "Group the changes by product area", seconds: 1.2 },
  { id: "s3", title: "Draft the changelog in docs/changelog.md", tool: "fs.write_file", seconds: 2.2 },
  {
    id: "s4",
    title: "Check every link in the new entry",
    tool: "docs.check_links",
    seconds: 1.4,
    failsWith: "2 broken links: /billing/plans-v2 and /billing/tax-ids",
  },
  { id: "s5", title: "Open a pull request and ask Maya to review", tool: "github.create_pull", seconds: 1 },
];

type Phase = "review" | "running" | "paused" | "done";
type Run = { status: PlanStepStatus; started?: number; took?: number; error?: string; failedBefore?: boolean };

export interface AgentPlanProps {
  steps?: PlanStep[];
  /** What the plan is for */
  goal?: string;
  /** Start running as soon as it mounts (for demos) */
  autoRun?: boolean;
  onRun?: (steps: PlanStep[]) => void;
  className?: string;
}

let nextId = 100;

/**
 * An agent's step-by-step plan to review before it runs. Rename, reorder (drag, or Alt+Up and Alt+Down), remove or
 * add steps, then run it: the runner on the left fills step by step like styrene flowing through a mold, each step
 * keeps a live clock, and a failed step can be retried from where it stopped.
 */
export function AgentPlan({ steps: initial = samplePlan, goal = "Publish the 4.0 billing changelog", autoRun = false, onRun, className }: AgentPlanProps) {
  const [steps, setSteps] = useState(initial);
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const [phase, setPhase] = useState<Phase>("review");
  const [now, setNow] = useState(() => performance.now());
  const [editing, setEditing] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [draft, setDraft] = useState("");
  const grips = useRef(new Map<string, HTMLButtonElement>());

  const running = phase === "running";
  useInterval(() => setNow(performance.now()), running ? 100 : null);

  // Advance the run: finish the current step when its time is up, then start the next
  useEffect(() => {
    if (!running) return;
    const current = steps.find((s) => runs[s.id]?.status === "running");
    if (!current) {
      const next = steps.find((s) => runs[s.id]?.status !== "done");
      if (!next) {
        setPhase("done");
        return;
      }
      setRuns((r) => ({ ...r, [next.id]: { status: "running", started: performance.now(), failedBefore: r[next.id]?.failedBefore } }));
      return;
    }
    const run = runs[current.id]!;
    const took = (now - (run.started ?? now)) / 1000;
    if (took < (current.seconds ?? 1.5)) return;
    if (current.failsWith && !run.failedBefore) {
      setRuns((r) => ({ ...r, [current.id]: { ...run, status: "failed", took, error: current.failsWith, failedBefore: true } }));
      setPhase("paused");
      return;
    }
    setRuns((r) => ({ ...r, [current.id]: { ...run, status: "done", took } }));
  }, [now, running, runs, steps]);

  const start = () => {
    setRuns({});
    setEditing(null);
    setPhase("running");
    setNow(performance.now());
    onRun?.(steps);
  };
  const resume = () => {
    setPhase("running");
    setNow(performance.now());
  };
  // Pausing parks the running step; resuming starts that step over
  const pause = () => {
    setRuns((r) => {
      const next = { ...r };
      for (const [id, run] of Object.entries(r)) if (run.status === "running") next[id] = { status: "idle", failedBefore: run.failedBefore };
      return next;
    });
    setPhase("paused");
  };

  const move = (id: string, by: number) => {
    const from = steps.findIndex((s) => s.id === id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= steps.length) return;
    const next = [...steps];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setSteps(next);
    setAnnounce(`Moved "${item!.title}" to step ${to + 1} of ${next.length}`);
  };

  const remove = (id: string) => {
    const step = steps.find((s) => s.id === id);
    setSteps(steps.filter((s) => s.id !== id));
    setAnnounce(`Removed "${step?.title}"`);
  };

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    setSteps([...steps, { id: `n${nextId++}`, title, seconds: 1.2 }]);
    setDraft("");
    setAnnounce(`Added "${title}" as step ${steps.length + 1}`);
  };

  const onDrop = (event: DragEvent, targetId: string) => {
    event.preventDefault();
    if (!dragId || dragId === targetId) return;
    move(dragId, steps.findIndex((s) => s.id === targetId) - steps.findIndex((s) => s.id === dragId));
    setDragId(null);
  };

  const onGripKey = (event: KeyboardEvent, id: string) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    move(id, event.key === "ArrowUp" ? -1 : 1);
    requestAnimationFrame(() => grips.current.get(id)?.focus());
  };

  useEffect(() => {
    if (autoRun) start();
  }, []);

  const doneCount = steps.filter((s) => runs[s.id]?.status === "done").length;
  // The runner fills to the middle of the step that is running, or to the last finished step
  const fillTo = phase === "review" ? 0 : (doneCount + (steps.some((s) => runs[s.id]?.status === "running") ? 0.5 : 0)) / Math.max(steps.length, 1);
  const total = steps.reduce((t, s) => t + (runs[s.id]?.took ?? 0), 0);
  const failed = steps.find((s) => runs[s.id]?.status === "failed");
  const editable = phase === "review";

  return (
    <div className={cx("kb-root kb-pl kb-part", className)} data-phase={phase}>
      <header className="kb-pl-head">
        <div>
          <span className="kb-pl-kicker">{phase === "review" ? "Plan to review" : phase === "done" ? "Plan finished" : phase === "paused" ? "Plan stopped" : "Running plan"}</span>
          <h3>{goal}</h3>
        </div>
        <span className="kb-pl-progress" aria-live="polite">
          {phase === "review"
            ? `${steps.length} steps`
            : phase === "done"
              ? `Done in ${formatDuration(total)}`
              : `${doneCount} of ${steps.length} done`}
        </span>
      </header>

      <ol className="kb-pl-list" style={{ "--fill": fillTo } as CSSProperties}>
        {steps.map((step, i) => {
          const run = runs[step.id];
          const status = run?.status ?? "idle";
          const seconds = status === "running" ? (now - (run?.started ?? now)) / 1000 : run?.took;
          return (
            <li
              key={step.id}
              className="kb-pl-step"
              data-status={status}
              data-dragging={dragId === step.id || undefined}
              draggable={editable && editing !== step.id}
              onDragStart={(e) => {
                setDragId(step.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", step.id);
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => editable && e.preventDefault()}
              onDrop={(e) => onDrop(e, step.id)}
            >
              <span className="kb-pl-gate" aria-hidden>
                {status === "running" ? (
                  <Spinner size={12} label="Running" />
                ) : status === "done" ? (
                  <Icon name="check" size={13} strokeWidth={2.5} />
                ) : status === "failed" ? (
                  <Icon name="x" size={13} strokeWidth={2.5} />
                ) : (
                  i + 1
                )}
              </span>
              <div className="kb-pl-main">
                {editing === step.id ? (
                  <input
                    className="kb-pl-input"
                    defaultValue={step.title}
                    aria-label={`Rename step ${i + 1}`}
                    autoFocus
                    onBlur={(e) => {
                      const title = e.target.value.trim();
                      if (title) setSteps(steps.map((s) => (s.id === step.id ? { ...s, title } : s)));
                      setEditing(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  <span className="kb-pl-title" onDoubleClick={() => editable && setEditing(step.id)}>
                    {step.title}
                  </span>
                )}
                {step.tool || run?.error ? (
                  <span className="kb-pl-meta">
                    {step.tool ? <code>{step.tool}</code> : null}
                    {run?.error ? <span className="kb-pl-error">{run.error}</span> : null}
                  </span>
                ) : null}
              </div>
              {editable ? (
                <div className="kb-pl-tools">
                  <button type="button" className="kb-pl-tool" onClick={() => setEditing(step.id)} aria-label={`Rename step ${i + 1}`}>
                    <Icon name="edit" size={15} />
                  </button>
                  <button type="button" className="kb-pl-tool" data-kind="remove" onClick={() => remove(step.id)} aria-label={`Remove step ${i + 1}`}>
                    <Icon name="trash" size={15} />
                  </button>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) grips.current.set(step.id, el);
                      else grips.current.delete(step.id);
                    }}
                    className="kb-pl-tool kb-pl-grip"
                    aria-label={`Reorder step ${i + 1}, ${step.title}. Use up and down arrows`}
                    onKeyDown={(e) => onGripKey(e, step.id)}
                  >
                    <span className="kb-ribs" aria-hidden />
                  </button>
                </div>
              ) : seconds !== undefined ? (
                <span className="kb-pl-time">{formatDuration(seconds)}</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {editable ? (
        <form
          className="kb-pl-add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Icon name="plus" size={16} />
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a step, e.g. Post the link in #launch-team" aria-label="New step" />
          {draft.trim() ? (
            <Button size="sm" type="submit">
              Add step
            </Button>
          ) : null}
        </form>
      ) : null}

      <footer className="kb-pl-foot">
        {phase === "review" ? (
          <>
            <span className="kb-pl-note">Double-click a step to rename it, or drag to reorder.</span>
            <Button variant="primary" icon="play" onClick={start} disabled={!steps.length}>
              Run plan
            </Button>
          </>
        ) : phase === "paused" && failed ? (
          <>
            <span className="kb-pl-note" data-tone="danger">
              Stopped at step {steps.indexOf(failed) + 1}. Steps before it are kept.
            </span>
            <Button onClick={() => { setRuns({}); setPhase("review"); }}>Edit plan</Button>
            <Button variant="primary" icon="refresh" onClick={resume}>
              Retry from step {steps.indexOf(failed) + 1}
            </Button>
          </>
        ) : phase === "paused" ? (
          <>
            <span className="kb-pl-note">Paused after {doneCount} of {steps.length} steps.</span>
            <Button onClick={() => { setRuns({}); setPhase("review"); }}>Edit plan</Button>
            <Button variant="primary" icon="play" onClick={resume}>
              Resume
            </Button>
          </>
        ) : phase === "done" ? (
          <>
            <span className="kb-pl-note" data-tone="ok">
              All {steps.length} steps finished.
            </span>
            <Button icon="refresh" onClick={() => { setRuns({}); setPhase("review"); }}>
              Plan again
            </Button>
          </>
        ) : (
          <>
            <span className="kb-pl-note">The agent is working through the plan.</span>
            <Button onClick={pause} icon="pause">
              Pause
            </Button>
          </>
        )}
      </footer>
      <span className="kb-sr" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
