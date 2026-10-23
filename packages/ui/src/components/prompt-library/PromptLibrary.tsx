import { Fragment, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Button } from "../button/Button.tsx";
import { cx, Icon } from "../../shared/index.ts";
import "./prompt-library.css";

export interface PromptVariable {
  /** Hint shown in the empty slot */
  hint: string;
  /** Suggested values, offered as a datalist */
  suggestions?: string[];
}

export interface PromptTemplate {
  id: string;
  title: string;
  /** Who saved it, or which team owns it */
  owner: string;
  uses: number;
  /** Sentence with {variables} */
  body: string;
  variables: Record<string, PromptVariable>;
}

export const DEMO_PROMPTS: PromptTemplate[] = [
  {
    id: "thread",
    title: "Summarize a support thread",
    owner: "Support",
    uses: 1284,
    body: "Summarize {thread} for {audience} in {count} bullet points. Flag any refund over {limit} and say who approved it.",
    variables: {
      thread: { hint: "ticket or thread", suggestions: ["ticket #48213", "the #billing-escalations thread"] },
      audience: { hint: "who reads it", suggestions: ["the on-call engineer", "an account manager", "the customer"] },
      count: { hint: "how many", suggestions: ["3", "5"] },
      limit: { hint: "amount", suggestions: ["$200", "$500"] },
    },
  },
  {
    id: "notes",
    title: "Draft release notes",
    owner: "Platform",
    uses: 342,
    body: "Write release notes for {version} from PRs merged since {last_tag}. Group them by {grouping} and keep each line under {words} words.",
    variables: {
      version: { hint: "version", suggestions: ["v4.18.0"] },
      last_tag: { hint: "previous tag", suggestions: ["v4.17.2"] },
      grouping: { hint: "grouping", suggestions: ["product area", "customer impact"] },
      words: { hint: "limit", suggestions: ["20", "30"] },
    },
  },
  {
    id: "triage",
    title: "Triage a bug report",
    owner: "Priya Raman",
    uses: 97,
    body: "Read {issue} and label it with one of {labels}. If it touches {area}, assign it to {owner} instead of the queue.",
    variables: {
      issue: { hint: "issue link", suggestions: ["KIT-2291"] },
      labels: { hint: "label set", suggestions: ["bug, regression, needs-repro"] },
      area: { hint: "sensitive area", suggestions: ["payments", "auth"] },
      owner: { hint: "person or team", suggestions: ["Tomás Ferreira", "Platform on-call"] },
    },
  },
  {
    id: "digest",
    title: "Weekly metrics digest",
    owner: "Lin Zhao",
    uses: 51,
    body: "Compare {metric} for the week of {week} with the four weeks before it and explain any change bigger than {threshold}.",
    variables: {
      metric: { hint: "metric", suggestions: ["agent resolution rate", "refund volume"] },
      week: { hint: "week", suggestions: ["Oct 19"] },
      threshold: { hint: "threshold", suggestions: ["5%", "10%"] },
    },
  },
];

export interface PromptLibraryProps {
  prompts?: PromptTemplate[];
  /** Pre-filled variable values, keyed by prompt id then variable */
  defaultValues?: Record<string, Record<string, string>>;
  defaultSelected?: string;
  /** Who receives the prompt, shown on the button */
  target?: string;
  onUse?: (prompt: PromptTemplate, text: string) => void;
  className?: string;
}

type Part = { text: string } | { name: string };

function parse(body: string): Part[] {
  return body.split(/(\{[a-z_]+\})/g).filter(Boolean).map((chunk) => (/^\{[a-z_]+\}$/.test(chunk) ? { name: chunk.slice(1, -1) } : { text: chunk }));
}

/**
 * Saved prompt templates with variables. You type straight into the sentence: every empty variable is a
 * decal-yellow slot (it's waiting on a person), and a filled one snaps in as a molded part. The finished
 * prompt assembles in the well below, and Use unlocks once every slot is filled.
 */
export function PromptLibrary({
  prompts = DEMO_PROMPTS,
  defaultValues = { thread: { thread: "ticket #48213", audience: "the on-call engineer" } },
  defaultSelected,
  target = "Support agent",
  onUse,
  className,
}: PromptLibraryProps) {
  const id = useId();
  const [selected, setSelected] = useState(defaultSelected ?? prompts[0]?.id ?? "");
  const [values, setValues] = useState(defaultValues);
  const [sent, setSent] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const slotRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const prompt = prompts.find((p) => p.id === selected) ?? prompts[0];
  const parts = useMemo(() => (prompt ? parse(prompt.body) : []), [prompt]);
  if (!prompt) return null;

  const names = Object.keys(prompt.variables);
  const vals = values[prompt.id] ?? {};
  const filled = names.filter((n) => vals[n]?.trim()).length;
  const ready = filled === names.length;
  const text = parts.map((p) => ("text" in p ? p.text : vals[p.name]?.trim() || `{${p.name}}`)).join("");

  function setVar(name: string, v: string) {
    setValues((all) => ({ ...all, [prompt!.id]: { ...(all[prompt!.id] ?? {}), [name]: v } }));
    setSent(null);
  }

  function use() {
    if (!ready) {
      const firstEmpty = names.find((n) => !vals[n]?.trim());
      if (firstEmpty) slotRefs.current[firstEmpty]?.focus();
      return;
    }
    onUse?.(prompt!, text);
    setSent(target);
  }

  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length];
    next?.focus();
  }

  return (
    <div className={cx("kb-root kb-pl kb-part", className)}>
      <nav className="kb-pl-side" aria-label="Saved prompts">
        <p className="kb-pl-side-title">Saved prompts</p>
        <ul ref={listRef} className="kb-pl-list" onKeyDown={onListKey}>
          {prompts.map((p) => {
            const count = Object.keys(p.variables).length;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="kb-pl-item"
                  aria-current={p.id === prompt.id ? "true" : undefined}
                  onClick={() => {
                    setSelected(p.id);
                    setSent(null);
                  }}
                >
                  <span className="kb-pl-item-title">{p.title}</span>
                  <span className="kb-pl-item-meta">
                    {p.owner}, {count} {count === 1 ? "blank" : "blanks"}, {p.uses.toLocaleString("en-US")} uses
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <section className="kb-pl-main" aria-labelledby={`${id}-title`}>
        <header className="kb-pl-head">
          <h3 id={`${id}-title`}>{prompt.title}</h3>
          <span className="kb-pl-progress" aria-live="polite">
            <span className="kb-pl-pips" aria-hidden>
              {names.map((n) => (
                <i key={n} data-on={vals[n]?.trim() ? "" : undefined} />
              ))}
            </span>
            {ready ? "Ready to use" : `${names.length - filled} ${names.length - filled === 1 ? "blank" : "blanks"} left`}
          </span>
        </header>

        <p className="kb-pl-sentence">
          {parts.map((p, i) => {
            if ("text" in p) return <Fragment key={i}>{p.text}</Fragment>;
            const v = prompt.variables[p.name];
            const value = vals[p.name] ?? "";
            const listId = `${id}-${prompt.id}-${p.name}`;
            return (
              <span key={i} className="kb-pl-slot" data-filled={value.trim() ? "" : undefined}>
                {/* Invisible twin that sizes the input to its text */}
                <span className="kb-pl-sizer" aria-hidden>{value || v?.hint || p.name}</span>
                <input
                  ref={(el) => {
                    slotRefs.current[p.name] = el;
                  }}
                  className="kb-pl-input"
                  value={value}
                  placeholder={v?.hint}
                  aria-label={`${p.name.replace(/_/g, " ")}, ${v?.hint ?? ""}`}
                  list={v?.suggestions ? listId : undefined}
                  onChange={(e) => setVar(p.name, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      use();
                    }
                  }}
                  spellCheck={false}
                  autoComplete="off"
                />
                {v?.suggestions ? (
                  <datalist id={listId}>
                    {v.suggestions.map((s) => <option key={s} value={s} />)}
                  </datalist>
                ) : null}
              </span>
            );
          })}
        </p>

        <div className="kb-pl-preview">
          <span className="kb-pl-preview-label">Prompt the agent will get</span>
          <p className="kb-pl-preview-text">
            {parts.map((p, i) =>
              "text" in p ? (
                <Fragment key={i}>{p.text}</Fragment>
              ) : vals[p.name]?.trim() ? (
                <mark key={i} className="kb-pl-set">{vals[p.name]!.trim()}</mark>
              ) : (
                <span key={i} className="kb-pl-gap">{prompt.variables[p.name]?.hint ?? p.name}</span>
              ),
            )}
          </p>
        </div>

        <footer className="kb-pl-foot">
          <p className="kb-pl-status" role="status">
            {sent ? (
              <>
                <Icon name="check" size={14} strokeWidth={2.25} /> Sent to {sent}
              </>
            ) : ready ? (
              "Press Enter in any blank to send."
            ) : (
              "Fill every blank to use this prompt."
            )}
          </p>
          <Button
            size="sm"
            variant="ghost"
            icon={copied ? "check" : "copy"}
            disabled={!ready}
            onClick={() => {
              void navigator.clipboard?.writeText(text).catch(() => undefined);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button size="sm" variant="primary" icon="send" onClick={use} aria-disabled={!ready || undefined} data-ready={ready || undefined}>
            Use with {target}
          </Button>
        </footer>
      </section>
    </div>
  );
}
