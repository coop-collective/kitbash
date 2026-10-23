import { useMemo, useRef, useState } from "react";
import { Button } from "../button/Button.tsx";
import { cx, Icon, NumberRoll, Tag, useInterval, useReducedMotion } from "../../shared/index.ts";
import "./agent-queue.css";

export interface QueueJob {
  id: number;
  name: string;
  /** Seconds of work */
  duration: number;
  /** 0..1 */
  progress: number;
  /** Set when the job finishes badly */
  error?: string;
}

export interface AgentQueueProps {
  /** Number of worker slots */
  workers?: number;
  /** New jobs per second, on average */
  arrivalRate?: number;
  /** Run the simulation on mount */
  autoplay?: boolean;
  /** A rate limit pauses every worker this often (seconds); null only pauses when you press the button */
  rateLimitEvery?: number | null;
  /** How long each automatic rate limit lasts (seconds) */
  rateLimitFor?: number;
  className?: string;
}

const TICK = 0.2; // seconds per step
const HISTORY = 110; // depth samples kept for the chart

const TEMPLATES = [
  (n: number) => `Embed help-center/article-${n}`,
  (n: number) => `Summarize call #${n}`,
  (n: number) => `Classify ticket #${n}`,
  (n: number) => `Sync Zendesk org ${n}`,
  (n: number) => `Transcribe voicemail ${n}`,
  (n: number) => `Re-rank search set ${n}`,
];
const ERRORS = ["Timed out after 30s", "Context too long (212k)", "Tool returned 500"];

interface Sim {
  t: number;
  nextId: number;
  queue: QueueJob[];
  slots: Array<QueueJob | null>;
  done: QueueJob[];
  failed: QueueJob[];
  doneCount: number;
  failedCount: number;
  history: Array<{ depth: number; paused: boolean }>;
  pausedUntil: number;
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeJob(id: number, rnd: () => number): QueueJob {
  const pick = TEMPLATES[Math.floor(rnd() * TEMPLATES.length)] ?? TEMPLATES[0]!;
  return { id, name: pick(41800 + Math.floor(rnd() * 900)), duration: 1.4 + rnd() * 2.6, progress: 0 };
}

function initial(workers: number): Sim {
  return { t: 0, nextId: 1, queue: [], slots: Array.from({ length: workers }, () => null), done: [], failed: [], doneCount: 0, failedCount: 0, history: [], pausedUntil: -1 };
}

/** One step of the queue: arrivals, workers pulling, progress, finishing. Pure apart from `rnd`. */
function step(s: Sim, rnd: () => number, arrivalRate: number, autoPause: { every: number | null; length: number }, manualPause: boolean): Sim {
  const t = s.t + TICK;
  let { nextId, pausedUntil } = s;
  if (autoPause.every !== null && Math.floor(t / autoPause.every) > Math.floor(s.t / autoPause.every)) {
    pausedUntil = t + autoPause.length;
  }
  const paused = manualPause || t < pausedUntil;
  const queue = [...s.queue];
  // Arrivals: a little bursty so the queue never looks mechanical
  const expected = arrivalRate * TICK * (0.5 + rnd());
  for (let k = 0; k < Math.floor(expected + rnd()); k++) queue.push(makeJob(nextId++, rnd));

  const done = [...s.done];
  const failed = [...s.failed];
  let { doneCount, failedCount } = s;
  const slots = s.slots.map((job) => {
    if (!job) return null;
    if (paused) return job;
    const progress = Math.min(1, job.progress + TICK / job.duration);
    if (progress < 1) return { ...job, progress };
    if (rnd() < 0.08) {
      failed.unshift({ ...job, progress: 1, error: ERRORS[Math.floor(rnd() * ERRORS.length)] ?? "Failed" });
      failedCount++;
    } else {
      done.unshift({ ...job, progress: 1 });
      doneCount++;
    }
    return null;
  });
  if (!paused) {
    for (let i = 0; i < slots.length; i++) {
      if (!slots[i] && queue.length) slots[i] = queue.shift() ?? null;
    }
  }
  const history = [...s.history, { depth: queue.length, paused }].slice(-HISTORY);
  return { t, nextId, queue, slots, done: done.slice(0, 4), failed: failed.slice(0, 3), doneCount, failedCount, history, pausedUntil };
}

/**
 * The work waiting for your agents, and how fast it moves. Jobs drop into the queue, seat into free worker
 * sockets as growing bars and land in Done or Failed. A rate limit clamps every socket shut; the depth gauge
 * underneath shows the backlog build up behind it and drain once the workers resume.
 */
export function AgentQueue({
  workers = 4,
  arrivalRate = 1.15,
  autoplay = true,
  rateLimitEvery = 16,
  rateLimitFor = 5,
  className,
}: AgentQueueProps) {
  const reduced = useReducedMotion();
  const rnd = useRef(rng(11));
  const [manualPause, setManualPause] = useState(false);

  // Warm up so the board opens mid-flight, with one rate limit already in the chart
  const warm = useMemo(() => {
    const r = rng(3);
    let s = initial(workers);
    const steps = Math.round(((rateLimitEvery ?? 12) + rateLimitFor + 6) / TICK);
    for (let i = 0; i < steps; i++) s = step(s, r, arrivalRate, { every: rateLimitEvery ?? 12, length: rateLimitFor }, false);
    return { ...s, pausedUntil: -1 };
  }, [workers, arrivalRate, rateLimitEvery, rateLimitFor]);

  const [sim, setSim] = useState<Sim>(warm);

  useInterval(
    () => setSim(step(sim, rnd.current, arrivalRate, { every: rateLimitEvery, length: rateLimitFor }, manualPause)),
    autoplay && !reduced ? TICK * 1000 : null,
  );

  const view = reduced ? warm : sim;
  const paused = manualPause || view.t < view.pausedUntil;
  const resumeIn = Math.max(0, Math.ceil(view.pausedUntil - view.t));
  const busy = view.slots.filter(Boolean).length;
  const shown = view.queue.slice(0, 7);
  const throughput = Math.round((view.doneCount / Math.max(1, view.t)) * 60);

  // Depth chart
  const W = 600;
  const H = 72;
  const max = Math.max(8, ...view.history.map((h) => h.depth));
  const x = (i: number) => (i / (HISTORY - 1)) * W;
  const y = (d: number) => H - 4 - (d / max) * (H - 12);
  const line = view.history.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(h.depth).toFixed(1)}`).join(" ");
  const bands: Array<[number, number]> = [];
  view.history.forEach((h, i) => {
    const last = bands[bands.length - 1];
    if (h.paused && last && last[1] === i - 1) last[1] = i;
    else if (h.paused) bands.push([i, i]);
  });

  return (
    <section className={cx("kb-aq", className)} aria-label="Agent work queue">
      <header className="kb-aq-head">
        <div className="kb-aq-title">
          <h3>Support backlog</h3>
          <p>{workers} workers on claude-haiku, {throughput} jobs a minute</p>
        </div>
        {paused ? <Tag tone="danger" dot>Rate limited</Tag> : <Tag tone="agent" live>Draining</Tag>}
        <Button
          size="sm"
          variant={manualPause ? "primary" : "secondary"}
          icon={manualPause ? "play" : "pause"}
          onClick={() => setManualPause((p) => !p)}
          disabled={reduced || !autoplay}
        >
          {manualPause ? "Resume workers" : "Pause workers"}
        </Button>
      </header>

      <div className="kb-aq-board">
        <div className="kb-aq-col">
          <h4>
            Queued <span className="kb-aq-n"><NumberRoll value={view.queue.length} /></span>
          </h4>
          <ol className="kb-aq-stack" aria-label={`${view.queue.length} jobs queued`}>
            {shown.map((j) => (
              <li key={j.id} className="kb-aq-chip">{j.name}</li>
            ))}
            {view.queue.length > shown.length ? <li className="kb-aq-more">and {view.queue.length - shown.length} more</li> : null}
            {view.queue.length === 0 ? <li className="kb-aq-more">Nothing waiting</li> : null}
          </ol>
        </div>

        <div className="kb-aq-col kb-aq-workers" data-paused={paused || undefined}>
          <h4>
            Workers <span className="kb-aq-n">{busy} of {workers} busy</span>
          </h4>
          <ul className="kb-aq-slots">
            {view.slots.map((job, i) => (
              <li key={i} className="kb-aq-slot" aria-label={job ? `Worker ${i + 1}: ${job.name}, ${Math.round(job.progress * 100)}%` : `Worker ${i + 1}: free`}>
                <span className="kb-aq-slot-n">{i + 1}</span>
                {job ? (
                  <div key={job.id} className="kb-aq-plug">
                    <span className="kb-aq-plug-name">{job.name}</span>
                    <span className="kb-aq-bar"><span style={{ width: `${job.progress * 100}%` }} /></span>
                  </div>
                ) : (
                  <span className="kb-aq-free">Free</span>
                )}
              </li>
            ))}
          </ul>
          {paused ? (
            <div className="kb-aq-clamp" role="status">
              <Icon name="alert" size={14} />
              {manualPause ? "Paused by you" : `429 from the model API, resuming in ${resumeIn}s`}
            </div>
          ) : null}
        </div>

        <div className="kb-aq-col">
          <h4>
            Done <span className="kb-aq-n kb-aq-ok"><NumberRoll value={view.doneCount} /></span>
          </h4>
          <ul className="kb-aq-out">
            {view.done.map((j) => (
              <li key={j.id}><Icon name="check" size={12} /> <span>{j.name}</span></li>
            ))}
          </ul>
          <h4 className="kb-aq-failed-h">
            Failed <span className="kb-aq-n kb-aq-bad"><NumberRoll value={view.failedCount} /></span>
          </h4>
          <ul className="kb-aq-out" data-kind="failed">
            {view.failed.map((j) => (
              <li key={j.id} title={j.error}><Icon name="x" size={12} /> <span>{j.name}</span></li>
            ))}
          </ul>
        </div>
      </div>

      <figure className="kb-aq-depth">
        <figcaption>
          <span>Queue depth, last {Math.round(HISTORY * TICK)}s</span>
          <span className="kb-aq-key"><i /> Rate limited</span>
        </figcaption>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Queue depth now ${view.queue.length}, peak ${max}`}>
          {bands.map(([a, b]) => (
            <rect key={a} className="kb-aq-band" x={x(a)} y="0" width={Math.max(2, x(b) - x(a))} height={H} />
          ))}
          <path className="kb-aq-area" d={`${line} L${x(view.history.length - 1)} ${H} L0 ${H} Z`} />
          <path className="kb-aq-line" d={line} vectorEffect="non-scaling-stroke" />
        </svg>
      </figure>
    </section>
  );
}
