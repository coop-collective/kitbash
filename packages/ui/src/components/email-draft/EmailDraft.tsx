"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Button } from "../button/Button.tsx";
import { Avatar, cx, Icon, Tag } from "../../shared/index.ts";
import "./email-draft.css";

export type EmailTone = "friendly" | "direct" | "formal";

export interface EmailRecipient {
  name: string;
  email: string;
  /** Why this person, in a few words */
  role: string;
}

export interface EmailAttachment {
  name: string;
  size: string;
}

export interface EmailDraftProps {
  /** Who the agent could send to; the first one is the agent's guess */
  recipients?: EmailRecipient[];
  /** Why the agent picked its guess */
  guessReason?: string;
  defaultTone?: EmailTone;
  /** Subject and body per tone; receives the recipient's first name */
  compose?: (tone: EmailTone, firstName: string) => { subject: string; body: string };
  attachment?: EmailAttachment | null;
  agentName?: string;
  /** Seconds the person has to undo a send or discard */
  undoSeconds?: number;
  onSend?: (draft: { to: EmailRecipient; subject: string; body: string; attachment: EmailAttachment | null }) => void;
  onDiscard?: () => void;
  className?: string;
}

export const DEMO_RECIPIENTS: EmailRecipient[] = [
  { name: "Maya Okafor", email: "maya@relaylabs.dev", role: "Owns the eval budget" },
  { name: "Dev Raman", email: "dev@relaylabs.dev", role: "Platform lead" },
  { name: "Priya Shah", email: "priya@relaylabs.dev", role: "Finance partner" },
];

export function demoCompose(tone: EmailTone, first: string): { subject: string; body: string } {
  if (tone === "direct") {
    return {
      subject: "Eval spend is 18% over: approve a model switch?",
      body: `${first},\n\nLast night's eval run cost $1,184 against a $1,000 budget. The long-context suite is most of the overage.\n\nProposal: run the nightly suite on the smaller model and keep the large one for the weekly run. That saves about $410 a month. Numbers are attached.\n\nCan you approve by Thursday?\n\nRelay, for Sam Lee`,
    };
  }
  if (tone === "formal") {
    return {
      subject: "Evaluation budget overage and a proposed change",
      body: `Dear ${first},\n\nLast night's evaluation run exceeded its budget, at $1,184 against an allocation of $1,000. The long-context regression suite accounts for most of the difference.\n\nI propose running the nightly suite on the smaller model while keeping the larger model for the weekly run, which should save approximately $410 per month. The attached summary has the full figures.\n\nPlease let me know whether you approve this change.\n\nKind regards,\nRelay, on behalf of Sam Lee`,
    };
  }
  return {
    subject: "Quick one on last night's eval costs",
    body: `Hi ${first},\n\nHeads-up from last night's eval run: we spent $1,184 against the $1,000 budget, mostly on the long-context suite.\n\nI think we can get back under by moving the nightly suite to the smaller model and keeping the big one for the weekly run. The summary's attached if you want the numbers.\n\nOkay to try that this week?\n\nThanks,\nRelay (for Sam Lee)`,
  };
}

const TONES: Array<{ value: EmailTone; label: string }> = [
  { value: "friendly", label: "Friendly" },
  { value: "direct", label: "Direct" },
  { value: "formal", label: "Formal" },
];

type Phase = "draft" | "sending" | "sent" | "discarding" | "discarded";

/**
 * Agent-written email for review. Switch recipient and tone, edit the subject and body in place,
 * remove the attachment, then send or discard with a short undo window.
 * Anything the agent guessed (here, who it goes to) wears a decal-yellow mark until a person confirms it.
 */
export function EmailDraft({
  recipients = DEMO_RECIPIENTS,
  guessReason = "Approved last month's eval spend",
  defaultTone = "friendly",
  compose = demoCompose,
  attachment = { name: "eval-overage-oct-22.pdf", size: "184 KB" },
  agentName = "Relay",
  undoSeconds = 5,
  onSend,
  onDiscard,
  className,
}: EmailDraftProps) {
  const uid = useId();
  const [toIndex, setToIndex] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [tone, setTone] = useState<EmailTone>(defaultTone);
  const to = recipients[toIndex] ?? recipients[0] ?? { name: "Someone", email: "", role: "" };
  const first = to.name.split(" ")[0] ?? to.name;
  const initial = compose(defaultTone, first);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [edited, setEdited] = useState(false);
  const [pendingTone, setPendingTone] = useState<EmailTone | null>(null);
  const [file, setFile] = useState<EmailAttachment | null>(attachment);
  const [phase, setPhase] = useState<Phase>("draft");
  const [left, setLeft] = useState(undoSeconds);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerActive, setPickerActive] = useState(0);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Grow the body field with its text so it reads like a letter, not a form box.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body, phase]);

  // Undo window for send and discard.
  useEffect(() => {
    if (phase !== "sending" && phase !== "discarding") return;
    if (left <= 0) {
      if (phase === "sending") {
        setPhase("sent");
        onSend?.({ to, subject, body, attachment: file });
      } else {
        setPhase("discarded");
        onDiscard?.();
      }
      return;
    }
    const id = window.setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [phase, left]);

  useEffect(() => {
    if (pickerOpen) listRef.current?.focus();
  }, [pickerOpen]);

  const rewrite = (nextTone: EmailTone, name = first) => {
    const text = compose(nextTone, name);
    setSubject(text.subject);
    setBody(text.body);
    setEdited(false);
  };

  const chooseTone = (nextTone: EmailTone) => {
    if (nextTone === tone) return;
    if (edited) {
      setPendingTone(nextTone);
      return;
    }
    setTone(nextTone);
    rewrite(nextTone);
  };

  const chooseRecipient = (i: number) => {
    const person = recipients[i];
    setPickerOpen(false);
    setConfirmed(true);
    chipRef.current?.focus();
    if (!person) return;
    const prevFirst = first;
    const nextFirst = person.name.split(" ")[0] ?? person.name;
    setToIndex(i);
    // Swap the greeting name in place so edits survive a recipient change.
    setBody((b) => b.replace(new RegExp(`^(Hi |Dear )?${prevFirst}\\b`), (_m, lead: string | undefined) => `${lead ?? ""}${nextFirst}`));
  };

  const onPickerKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const n = recipients.length;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setPickerActive((i) => (i + 1) % n);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setPickerActive((i) => (i - 1 + n) % n);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseRecipient(pickerActive);
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      setPickerOpen(false);
      chipRef.current?.focus();
    }
  };

  const start = (next: "sending" | "discarding") => {
    setLeft(undoSeconds);
    setPhase(next);
  };

  if (phase !== "draft") {
    const pending = phase === "sending" || phase === "discarding";
    return (
      <div className={cx("kb-ed", "kb-ed-folded", className)} data-phase={phase} role="status" aria-live="polite">
        <span className="kb-ed-folded-icon">
          <Icon name={phase === "sending" || phase === "sent" ? "send" : "trash"} size={16} />
        </span>
        <span className="kb-ed-folded-text">
          {phase === "sending" && <>Sending to {to.name} in {left}s</>}
          {phase === "sent" && <>Sent to {to.name}</>}
          {phase === "discarding" && <>Draft discarded</>}
          {phase === "discarded" && <>Draft discarded. {agentName} won’t bring it up again.</>}
          <span className="kb-ed-folded-sub">{subject}</span>
        </span>
        {pending ? (
          <Button size="sm" icon="undo" onClick={() => setPhase("draft")}>Undo</Button>
        ) : phase === "sent" ? (
          <Icon name="check" size={18} strokeWidth={2.2} className="kb-ed-folded-ok" />
        ) : null}
        {pending ? (
          <span className="kb-ed-fuse" aria-hidden style={{ animationDuration: `${undoSeconds}s` }} />
        ) : null}
      </div>
    );
  }

  return (
    <article className={cx("kb-ed", className)} aria-labelledby={`${uid}-title`}>
      <header className="kb-ed-head">
        <span className="kb-ed-agent"><Icon name="mail" size={16} /></span>
        <span className="kb-ed-head-text">
          <span className="kb-ed-head-title" id={`${uid}-title`}>{agentName} drafted an email</span>
          <span className="kb-ed-head-sub">From the eval budget check, 2 min ago</span>
        </span>
        <Tag tone="decal" dot>Needs your review</Tag>
      </header>

      <div className="kb-ed-fields">
        <div className="kb-ed-row">
          <span className="kb-ed-key" id={`${uid}-to`}>To</span>
          <div className="kb-ed-to">
            <button
              ref={chipRef}
              type="button"
              className="kb-ed-chip"
              data-guess={!confirmed || undefined}
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
              aria-labelledby={`${uid}-to ${uid}-chip`}
              onClick={() => {
                setPickerActive(toIndex);
                setPickerOpen((o) => !o);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setPickerActive(toIndex);
                  setPickerOpen(true);
                }
              }}
            >
              <Avatar name={to.name} size={20} />
              <span id={`${uid}-chip`}>{to.name}</span>
              <span className="kb-ed-chip-mail">{to.email}</span>
              <Icon name="chevronDown" size={14} />
            </button>
            {!confirmed ? (
              <span className="kb-ed-guess">
                <span className="kb-ed-guess-mark" aria-hidden />
                Agent’s guess: {guessReason.toLowerCase()}
                <button type="button" className="kb-ed-link" onClick={() => setConfirmed(true)}>Looks right</button>
              </span>
            ) : null}
            {pickerOpen ? (
              <ul
                ref={listRef}
                className="kb-ed-picker"
                role="listbox"
                tabIndex={-1}
                aria-label="Recipient"
                aria-activedescendant={`${uid}-r${pickerActive}`}
                onKeyDown={onPickerKey}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null) && e.relatedTarget !== chipRef.current) setPickerOpen(false);
                }}
              >
                {recipients.map((r, i) => (
                  <li
                    key={r.email}
                    id={`${uid}-r${i}`}
                    role="option"
                    aria-selected={i === toIndex}
                    data-active={i === pickerActive || undefined}
                    onPointerDown={(e) => e.preventDefault()}
                    onPointerMove={() => setPickerActive(i)}
                    onClick={() => chooseRecipient(i)}
                  >
                    <Avatar name={r.name} size={26} />
                    <span className="kb-ed-pick-text">
                      <span>{r.name}</span>
                      <span className="kb-ed-pick-role">{r.role}</span>
                    </span>
                    {i === toIndex ? <Icon name="check" size={14} /> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <div className="kb-ed-row">
          <label className="kb-ed-key" id={`${uid}-subject-label`} htmlFor={`${uid}-subject`}>Subject</label>
          <input
            id={`${uid}-subject`}
            className="kb-ed-subject"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              setEdited(true);
            }}
          />
        </div>

        <div className="kb-ed-row kb-ed-row-tone">
          <span className="kb-ed-key" id={`${uid}-tone`}>Tone</span>
          <div className="kb-ed-tones" role="radiogroup" aria-labelledby={`${uid}-tone`}>
            {TONES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={tone === t.value}
                tabIndex={tone === t.value ? 0 : -1}
                className="kb-ed-tone"
                onClick={() => chooseTone(t.value)}
                onKeyDown={(e) => {
                  const at = TONES.findIndex((x) => x.value === tone);
                  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                  if (!step) return;
                  e.preventDefault();
                  const next = TONES[(at + step + TONES.length) % TONES.length];
                  if (next) {
                    chooseTone(next.value);
                    const group = e.currentTarget.parentElement;
                    window.requestAnimationFrame(() => group?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
                  }
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          {pendingTone ? (
            <span className="kb-ed-confirm" role="alert">
              Rewriting replaces your edits.
              <button
                type="button"
                className="kb-ed-link"
                onClick={() => {
                  setTone(pendingTone);
                  rewrite(pendingTone);
                  setPendingTone(null);
                }}
              >
                Rewrite
              </button>
              <button type="button" className="kb-ed-link kb-ed-link-quiet" onClick={() => setPendingTone(null)}>Keep mine</button>
            </span>
          ) : edited ? (
            <span className="kb-ed-edited"><Icon name="edit" size={13} />Edited by you</span>
          ) : null}
        </div>
      </div>

      <div className="kb-ed-body">
        <textarea
          ref={bodyRef}
          aria-label="Message"
          className="kb-ed-text"
          value={body}
          spellCheck
          onChange={(e) => {
            setBody(e.target.value);
            setEdited(true);
          }}
        />
        {file ? (
          <div className="kb-ed-file">
            <span className="kb-ed-file-icon"><Icon name="file" size={16} /></span>
            <span className="kb-ed-file-name">{file.name}</span>
            <span className="kb-ed-file-size">{file.size}</span>
            <button type="button" className="kb-ed-file-x" aria-label={`Remove ${file.name}`} onClick={() => setFile(null)}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ) : attachment ? (
          <div className="kb-ed-file kb-ed-file-gone" role="status">
            <Icon name="paperclip" size={14} />
            Attachment removed
            <button type="button" className="kb-ed-link" onClick={() => setFile(attachment)}>Undo</button>
          </div>
        ) : null}
      </div>

      <footer className="kb-ed-foot">
        <Button variant="ghost" icon="trash" onClick={() => start("discarding")}>Discard</Button>
        <Button variant="primary" icon="send" onClick={() => start("sending")}>Send to {first}</Button>
      </footer>
    </article>
  );
}
