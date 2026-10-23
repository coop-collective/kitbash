import { useRef, useState, type KeyboardEvent } from "react";
import { Button } from "../button/Button.tsx";
import { cx, Icon, Spinner, Tag, useInterval } from "../../shared/index.ts";
import "./agent-steering.css";

export interface SteeringStep {
  id: string;
  title: string;
  /** Seconds the step takes */
  duration: number;
  /** Tool calls shown under the step while it runs */
  activity?: string[];
}

export interface AgentSteeringProps {
  agentName?: string;
  goal?: string;
  steps?: SteeringStep[];
  /** Notes already waiting for the next step */
  initialNotes?: string[];
  /** Index of the step running when the story opens, and how far along it is (0..1) */
  startAt?: [number, number];
  autoplay?: boolean;
  onSteer?: (note: string, mode: "queue" | "interrupt") => void;
  className?: string;
}

export const defaultSteeringSteps: SteeringStep[] = [
  { id: "s1", title: "Read the auth module and session store", duration: 4, activity: ["read src/auth/session.ts", "grep -r \"createSession\""] },
  { id: "s2", title: "Add a WebAuthn registration endpoint", duration: 7, activity: ["edit src/auth/webauthn.ts", "edit src/routes/register.ts", "run pnpm typecheck"] },
  { id: "s3", title: "Build the passkey sign-in flow", duration: 7, activity: ["edit app/sign-in/page.tsx", "edit src/auth/verify.ts"] },
  { id: "s4", title: "Move 3 login tests to the new flow", duration: 6, activity: ["edit tests/login.spec.ts", "run pnpm test login"] },
  { id: "s5", title: "Open a PR with a summary", duration: 3, activity: ["git push origin passkeys", "gh pr create"] },
];

type Kind = "plan" | "note" | "resume";
interface PlanItem extends SteeringStep {
  kind: Kind;
  state: "done" | "running" | "todo" | "stopped";
  progress: number;
  stoppedAt?: number;
}

const NOTE_SECONDS = 3.5;

/**
 * Steer an agent while it works. A queued note clips onto the seam after the running step; when the agent
 * finishes that step it picks the note up and the note snaps into the plan as its own step. Interrupt stops
 * the running step on the spot, runs your note first, and puts the stopped step back after it.
 */
export function AgentSteering({
  agentName = "Coder",
  goal = "Add passkey sign-in",
  steps = defaultSteeringSteps,
  initialNotes = ["Keep password sign-in as a fallback for 30 days"],
  startAt = [1, 0.35],
  autoplay = true,
  onSteer,
  className,
}: AgentSteeringProps) {
  const [plan, setPlan] = useState<PlanItem[]>(() =>
    steps.map((s, i) => ({
      ...s,
      kind: "plan",
      state: i < startAt[0] ? "done" : i === startAt[0] ? "running" : "todo",
      progress: i < startAt[0] ? 1 : i === startAt[0] ? startAt[1] : 0,
    })),
  );
  const [queued, setQueued] = useState<Array<{ id: string; text: string }>>(() => initialNotes.map((text, i) => ({ id: `n${i}`, text })));
  const [draft, setDraft] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [say, setSay] = useState("");
  const ids = useRef(100);

  const current = plan.findIndex((p) => p.state === "running");
  const finished = current < 0 && plan.every((p) => p.state === "done" || p.state === "stopped");

  const advance = (items: PlanItem[], notes: typeof queued): { items: PlanItem[]; notes: typeof queued } => {
    // The running step just finished: queued notes go in next, then the plan carries on
    const at = items.findIndex((p) => p.state === "running");
    const next = items.map((p, i) => (i === at ? { ...p, state: "done" as const, progress: 1 } : p));
    const inserts: PlanItem[] = notes.map((n) => ({ id: n.id, title: n.text, duration: NOTE_SECONDS, kind: "note", state: "todo", progress: 0, activity: ["re-read plan with your note", "edit plan.md"] }));
    next.splice(at + 1, 0, ...inserts);
    const following = next.findIndex((p, i) => i > at && p.state === "todo");
    if (following >= 0) next[following] = { ...next[following]!, state: "running" };
    if (inserts[0]) {
      setFresh(inserts[0].id);
      setSay(`${agentName} picked up your note: ${inserts[0].title}`);
    }
    return { items: next, notes: [] };
  };

  useInterval(
    () => {
      if (current < 0) return;
      const step = plan[current]!;
      const progress = step.progress + 0.1 / step.duration;
      if (progress < 1) {
        setPlan(plan.map((p, i) => (i === current ? { ...p, progress } : p)));
        return;
      }
      const { items } = advance(plan, queued);
      setPlan(items);
      setQueued([]);
    },
    // The agent's progress is the content here, not decoration, so it runs under reduced motion too;
    // only the glides and snaps in the stylesheet are switched off
    autoplay && !finished ? 100 : null,
  );

  const queue = () => {
    const text = draft.trim();
    if (!text) return;
    setQueued((q) => [...q, { id: `n${ids.current++}`, text }]);
    setDraft("");
    setSay(`Queued for after "${plan[current]?.title ?? "this step"}"`);
    onSteer?.(text, "queue");
  };

  const interrupt = () => {
    const text = draft.trim();
    if (!text || current < 0) return;
    const step = plan[current]!;
    const note: PlanItem = { id: `n${ids.current++}`, title: text, duration: NOTE_SECONDS, kind: "note", state: "running", progress: 0, activity: ["stop current edit", "re-read plan with your note"] };
    const resume: PlanItem = { ...step, id: `${step.id}-r${ids.current++}`, kind: "resume", state: "todo", progress: 0 };
    const next = [...plan];
    next.splice(current, 1, { ...step, state: "stopped", stoppedAt: step.progress }, note, resume);
    setPlan(next);
    setFresh(note.id);
    setDraft("");
    setSay(`Interrupted ${step.title}. ${agentName} is working on your note now.`);
    onSteer?.(text, "interrupt");
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (e.metaKey || e.ctrlKey) interrupt();
    else queue();
  };

  const running = current >= 0 ? plan[current] : undefined;
  const activity = running?.activity ?? [];
  const line = activity.length ? activity[Math.min(activity.length - 1, Math.floor((running?.progress ?? 0) * activity.length))] : undefined;
  const doneCount = plan.filter((p) => p.state === "done").length;

  return (
    <section className={cx("kb-st", className)} aria-label={`Steer ${agentName}`}>
      <header className="kb-st-head">
        <span className="kb-st-avatar" aria-hidden>
          <Icon name="robot" size={18} />
        </span>
        <div className="kb-st-title">
          <h3>{goal}</h3>
          <p>
            {agentName}, step {Math.min(plan.length, doneCount + 1)} of {plan.length}
          </p>
        </div>
        {finished ? <Tag tone="ok">Done</Tag> : <Tag tone="agent" live>Working</Tag>}
      </header>

      <ol className="kb-st-plan" aria-label="Plan">
        {plan.map((p, i) => (
          <li key={p.id} className="kb-st-step" data-state={p.state} data-kind={p.kind} data-fresh={fresh === p.id || undefined}>
            <span className="kb-st-mark" aria-hidden>
              {p.state === "done" ? <Icon name="check" size={13} /> : p.state === "running" ? <Spinner size={12} label="Running" /> : p.state === "stopped" ? <Icon name="stop" size={11} /> : <span className="kb-st-num">{i + 1}</span>}
            </span>
            <div className="kb-st-body">
              <span className="kb-st-text">
                {p.kind === "note" ? <span className="kb-st-from">Your note</span> : null}
                {p.kind === "resume" ? <span className="kb-st-from">Resume</span> : null}
                {p.title}
              </span>
              {p.state === "running" ? (
                <>
                  <span className="kb-st-bar"><span style={{ width: `${p.progress * 100}%` }} /></span>
                  {line ? <code className="kb-st-log">{line}</code> : null}
                </>
              ) : null}
              {p.state === "stopped" ? <span className="kb-st-sub">Stopped at {Math.round((p.stoppedAt ?? 0) * 100)}% by you</span> : null}
              <span className="kb-sr">{p.state === "todo" ? "Not started" : p.state}</span>
            </div>
            {/* Queued notes clip onto the seam right after the running step */}
            {p.state === "running" && queued.length ? (
              <ul className="kb-st-clips" aria-label="Queued for the next step">
                {queued.map((n) => (
                  <li key={n.id} className="kb-st-clip">
                    <Icon name="pin" size={13} />
                    <span>{n.text}</span>
                    <button type="button" aria-label={`Remove queued note: ${n.text}`} onClick={() => setQueued((q) => q.filter((x) => x.id !== n.id))}>
                      <Icon name="x" size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="kb-st-compose">
        <label className="kb-sr" htmlFor="kb-st-note">Note for {agentName}</label>
        <textarea
          id="kb-st-note"
          rows={2}
          value={draft}
          placeholder={finished ? `${agentName} is done` : `Tell ${agentName} something for the next step`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          disabled={finished}
        />
        <div className="kb-st-actions">
          <span className="kb-st-hint">Enter queues, {navigator.platform.includes("Mac") ? "Cmd" : "Ctrl"}+Enter interrupts</span>
          <Button size="sm" variant="ghost" icon="stop" onClick={interrupt} disabled={!draft.trim() || finished}>
            Interrupt now
          </Button>
          <Button size="sm" variant="primary" icon="plus" onClick={queue} disabled={!draft.trim() || finished}>
            Queue for next step
          </Button>
        </div>
      </div>
      <p className="kb-sr" aria-live="polite">{say}</p>
    </section>
  );
}
