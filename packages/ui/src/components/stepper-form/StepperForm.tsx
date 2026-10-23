import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "../button/Button.tsx";
import { cx, Icon } from "../../shared/index.ts";
import "./stepper-form.css";

export interface WorkspaceSetup {
  name: string;
  slug: string;
  model: "sonnet" | "haiku" | "opus";
  budget: string;
  invites: string;
}

export interface StepperFormProps {
  initial?: Partial<WorkspaceSetup>;
  /** Step to open on (0-based), for docs */
  initialStep?: number;
  /** Show the finished state, for docs */
  initialDone?: boolean;
  onComplete?: (setup: WorkspaceSetup) => Promise<void> | void;
  className?: string;
}

const STEPS = [
  { title: "Workspace", hint: "Name it" },
  { title: "Model", hint: "Pick a default" },
  { title: "Team", hint: "Invite people" },
  { title: "Review", hint: "Check and create" },
] as const;

const MODELS: Array<{ id: WorkspaceSetup["model"]; name: string; note: string; price: string }> = [
  { id: "haiku", name: "claude-haiku-5", note: "Fast routing and triage", price: "$0.80 / M input" },
  { id: "sonnet", name: "claude-sonnet-5", note: "Most agents start here", price: "$3 / M input" },
  { id: "opus", name: "claude-opus-5-5", note: "Long, hard reasoning", price: "$15 / M input" },
];

const EMPTY: WorkspaceSetup = { name: "", slug: "", model: "sonnet", budget: "500", invites: "" };

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
const emails = (s: string) => s.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

type Errors = Partial<Record<keyof WorkspaceSetup, string>>;

function check(step: number, d: WorkspaceSetup): Errors {
  const e: Errors = {};
  if (step === 0) {
    if (d.name.trim().length < 2) e.name = "Give the workspace a name of at least 2 characters.";
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(d.slug)) e.slug = "Use lowercase letters, numbers and dashes.";
    else if (["admin", "api", "www"].includes(d.slug)) e.slug = `“${d.slug}” is reserved. Try another.`;
  }
  if (step === 1) {
    const n = Number(d.budget);
    if (!d.budget.trim() || Number.isNaN(n)) e.budget = "Enter a monthly budget in dollars.";
    else if (n < 20) e.budget = "The smallest budget is $20 a month.";
    else if (n > 50000) e.budget = "Budgets over $50,000 need a sales contract.";
  }
  if (step === 2) {
    const bad = emails(d.invites).filter((x) => !EMAIL.test(x));
    if (bad.length) e.invites = `Check ${bad.length === 1 ? "this address" : "these addresses"}: ${bad.join(", ")}`;
  }
  return e;
}

/** Height-morphing frame: measures its content and glides to the new height when a step swaps */
function Morph({ children, deps }: { children: ReactNode; deps: unknown }) {
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    setH(el.offsetHeight);
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [deps]);
  return (
    <div className="kb-sf-morph" style={{ height: h }}>
      <div ref={inner}>{children}</div>
    </div>
  );
}

/**
 * A four-step setup flow for a new agent workspace. Steps sit on a rail of keys: finished steps stay latched
 * (pressed in, cured green), the current one stands raised, and the seam between them fills as you advance.
 * Each step slides in, the card glides to its height, fields validate inline, and the last step turns into
 * a success state.
 */
export function StepperForm({ initial, initialStep = 0, initialDone = false, onComplete, className }: StepperFormProps) {
  const id = useId();
  const [data, setData] = useState<WorkspaceSetup>({ ...EMPTY, ...initial });
  const [step, setStep] = useState(Math.min(initialStep, STEPS.length - 1));
  const [reached, setReached] = useState(Math.min(initialStep, STEPS.length - 1));
  const [dir, setDir] = useState<1 | -1>(1);
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof WorkspaceSetup, boolean>>>({});
  const [slugEdited, setSlugEdited] = useState(Boolean(initial?.slug));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(initialDone);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  // Move focus to the new step's heading so screen readers hear where they are
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step, done]);

  function set<K extends keyof WorkspaceSetup>(k: K, v: WorkspaceSetup[K]) {
    const next = { ...data, [k]: v };
    if (k === "name" && !slugEdited) next.slug = slugify(String(v));
    setData(next);
    if (touched[k] || errors[k]) setErrors(check(step, next));
  }

  function go(to: number) {
    setDir(to > step ? 1 : -1);
    setStep(to);
    setErrors({});
  }

  async function next(e?: FormEvent) {
    e?.preventDefault();
    const found = check(step, data);
    setErrors(found);
    setTouched(Object.fromEntries(Object.keys(found).map((k) => [k, true])));
    if (Object.keys(found).length) {
      const firstBad = Object.keys(found)[0];
      document.getElementById(`${id}-${firstBad}`)?.focus();
      return;
    }
    if (step < STEPS.length - 1) {
      setReached((r) => Math.max(r, step + 1));
      go(step + 1);
      return;
    }
    setBusy(true);
    await (onComplete ? onComplete(data) : new Promise((r) => window.setTimeout(r, 1100)));
    setBusy(false);
    setDone(true);
  }

  const blur = (k: keyof WorkspaceSetup) => () => {
    setTouched((t) => ({ ...t, [k]: true }));
    setErrors(check(step, data));
  };
  const err = (k: keyof WorkspaceSetup) => (touched[k] ? errors[k] : undefined);
  const invites = emails(data.invites);
  const model = MODELS.find((m) => m.id === data.model)!;

  function field(k: keyof WorkspaceSetup, label: string, input: ReactNode, help: string) {
    return (
      <div className="kb-sf-field" data-invalid={err(k) ? "" : undefined}>
        <label htmlFor={`${id}-${k}`}>{label}</label>
        {input}
        <p className="kb-sf-help" id={`${id}-${k}-help`} data-tone={err(k) ? "danger" : undefined}>
          {err(k) ? <Icon name="alert" size={13} /> : null}
          {err(k) ?? help}
        </p>
      </div>
    );
  }

  const aria = (k: keyof WorkspaceSetup) => ({
    id: `${id}-${k}`,
    "aria-invalid": err(k) ? true : undefined,
    "aria-describedby": `${id}-${k}-help`,
    onBlur: blur(k),
  });

  return (
    <div className={cx("kb-root kb-sf kb-part", className)}>
      <ol className="kb-sf-rail" aria-label="Setup progress">
        {STEPS.map((s, i) => {
          const state = done || i < step ? "done" : i === step ? "current" : "todo";
          const canGo = !done && i <= reached && i !== step;
          return [
            <li key={s.title} className="kb-sf-stop" data-state={state}>
              <button
                type="button"
                className="kb-sf-key"
                disabled={!canGo}
                aria-current={state === "current" ? "step" : undefined}
                aria-label={`Step ${i + 1}, ${s.title}: ${s.hint}${state === "done" ? ", done" : ""}`}
                onClick={() => go(i)}
              >
                {state === "done" ? <Icon name="check" size={14} strokeWidth={2.5} /> : i + 1}
              </button>
              <span className="kb-sf-stop-text" aria-hidden>
                <span className="kb-sf-stop-title">{s.title}</span>
              </span>
            </li>,
            i < STEPS.length - 1 ? <li key={`${s.title}-seam`} className="kb-sf-seam" data-filled={done || i < step ? "" : undefined} aria-hidden /> : null,
          ];
        })}
      </ol>

      <Morph deps={`${step}-${done}`}>
        {done ? (
          <div className="kb-sf-done">
            <span className="kb-sf-done-badge" aria-hidden>
              <Icon name="check" size={26} strokeWidth={2.4} />
            </span>
            <h3 ref={headingRef} tabIndex={-1}>{data.name || "Your workspace"} is ready</h3>
            <p>
              Agents in <strong>{data.slug || "your-workspace"}</strong> will use {model.name} by default, within ${Number(data.budget || 0).toLocaleString("en-US")} a month.
              {invites.length ? ` We sent ${invites.length} ${invites.length === 1 ? "invite" : "invites"}.` : ""}
            </p>
            <Button variant="primary">Open workspace</Button>
          </div>
        ) : (
          <form key={step} className="kb-sf-step" data-dir={dir} onSubmit={next} noValidate>
            <h3 ref={headingRef} tabIndex={-1} className="kb-sf-title">
              {["Name your workspace", "Choose a default model", "Invite your team", "Review and create"][step]}
            </h3>

            {step === 0 ? (
              <>
                {field("name", "Workspace name", <input className="kb-sf-input" value={data.name} onChange={(e) => set("name", e.target.value)} placeholder="Northwind Support" autoComplete="organization" {...aria("name")} />, "Shown to everyone you invite.")}
                {field(
                  "slug",
                  "Address",
                  <div className="kb-sf-affix-well">
                    <span className="kb-sf-affix">kitbash.run/</span>
                    <input className="kb-sf-input kb-sf-bare" value={data.slug} onChange={(e) => { setSlugEdited(true); set("slug", e.target.value.toLowerCase()); }} placeholder="northwind-support" spellCheck={false} {...aria("slug")} />
                  </div>,
                  "Filled in from the name. Change it if you like.",
                )}
              </>
            ) : null}

            {step === 1 ? (
              <>
                <fieldset className="kb-sf-models">
                  <legend>Default model</legend>
                  {MODELS.map((m) => (
                    <label key={m.id} className="kb-sf-model" data-on={data.model === m.id ? "" : undefined}>
                      <input type="radio" name={`${id}-model`} value={m.id} checked={data.model === m.id} onChange={() => set("model", m.id)} />
                      <span className="kb-sf-model-name">{m.name}</span>
                      <span className="kb-sf-model-note">{m.note}</span>
                      <span className="kb-sf-model-price">{m.price}</span>
                    </label>
                  ))}
                </fieldset>
                {field(
                  "budget",
                  "Monthly budget",
                  <div className="kb-sf-affix-well kb-sf-budget">
                    <span className="kb-sf-affix">$</span>
                    <input className="kb-sf-input kb-sf-bare" inputMode="numeric" value={data.budget} onChange={(e) => set("budget", e.target.value.replace(/[^\d.]/g, ""))} {...aria("budget")} />
                    <span className="kb-sf-affix">a month</span>
                  </div>,
                  "Agents pause and ask you before going over.",
                )}
              </>
            ) : null}

            {step === 2 ? (
              field(
                "invites",
                "Email addresses",
                <textarea className="kb-sf-input kb-sf-area" rows={3} value={data.invites} onChange={(e) => set("invites", e.target.value)} placeholder="dana@northwind.com, marcus@northwind.com" spellCheck={false} {...aria("invites")} />,
                invites.length ? `${invites.length} ${invites.length === 1 ? "person" : "people"} will get an invite. You can skip this.` : "Separate addresses with commas. You can skip this.",
              )
            ) : null}

            {step === 3 ? (
              <dl className="kb-sf-review">
                {[
                  ["Workspace", `${data.name}`, 0],
                  ["Address", `kitbash.run/${data.slug}`, 0],
                  ["Default model", model.name, 1],
                  ["Budget", `$${Number(data.budget).toLocaleString("en-US")} a month`, 1],
                  ["Invites", invites.length ? invites.join(", ") : "Nobody yet", 2],
                ].map(([k, v, s]) => (
                  <div key={k as string} className="kb-sf-review-row">
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                    <button type="button" className="kb-sf-edit" onClick={() => go(s as number)} aria-label={`Edit ${String(k).toLowerCase()}`}>
                      Edit
                    </button>
                  </div>
                ))}
              </dl>
            ) : null}

            <div className="kb-sf-foot">
              {step > 0 ? (
                <Button variant="ghost" icon="chevronLeft" onClick={() => go(step - 1)} disabled={busy}>Back</Button>
              ) : <span />}
              <span className="kb-sf-count">Step {step + 1} of {STEPS.length}</span>
              <Button type="submit" variant="primary" loading={busy} loadingLabel="Creating">
                {step === STEPS.length - 1 ? "Create workspace" : step === 2 && !invites.length ? "Skip for now" : "Continue"}
              </Button>
            </div>
          </form>
        )}
      </Morph>
    </div>
  );
}
