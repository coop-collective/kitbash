"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Avatar, cx, Icon, Tag, type IconName } from "../../shared/index.ts";
import "./profile-menu.css";

export interface ProfileUser {
  name: string;
  email: string;
  workspace: string;
  plan: string;
}

export interface ProfileSetupStep {
  id: string;
  label: string;
  done: boolean;
}

export interface ProfileMenuAction {
  id: string;
  label: string;
  icon: IconName;
  /** Small trailing text, e.g. usage */
  meta?: string;
  /** Shortcut keys shown as keycaps */
  keys?: string[];
  tone?: "danger";
}

export interface ProfileMenuProps {
  user?: ProfileUser;
  steps?: ProfileSetupStep[];
  actions?: ProfileMenuAction[];
  defaultOpen?: boolean;
  /** Called when a menu action is chosen */
  onAction?: (id: string) => void;
  /** Called when the next setup step is started; by default it is marked done (demo) */
  onStep?: (id: string) => void;
  className?: string;
}

export const DEMO_USER: ProfileUser = {
  name: "Maya Okafor",
  email: "maya@relaylabs.dev",
  workspace: "Relay Labs",
  plan: "Team plan",
};

export const DEMO_STEPS: ProfileSetupStep[] = [
  { id: "email", label: "Verify your email", done: true },
  { id: "photo", label: "Add a profile photo", done: true },
  { id: "key", label: "Add a model API key", done: true },
  { id: "invite", label: "Invite a teammate", done: false },
  { id: "limit", label: "Set a monthly spending limit", done: false },
];

export const DEMO_ACTIONS: ProfileMenuAction[] = [
  { id: "profile", label: "Profile and preferences", icon: "user" },
  { id: "usage", label: "Usage and billing", icon: "credit", meta: "$42.18 of $100" },
  { id: "shortcuts", label: "Keyboard shortcuts", icon: "command", keys: ["?"] },
  { id: "workspace", label: "Switch workspace", icon: "layers" },
  { id: "signout", label: "Sign out", icon: "logout", tone: "danger" },
];

/**
 * Profile menu: a trigger with the signed-in person and an account card holding their details,
 * menu actions and profile setup. Setup is a parts tray: each finished step is a part seated in its slot,
 * and the next step waiting on the person is marked decal yellow.
 */
export function ProfileMenu({
  user = DEMO_USER,
  steps = DEMO_STEPS,
  actions = DEMO_ACTIONS,
  defaultOpen = false,
  onAction,
  onStep,
  className,
}: ProfileMenuProps) {
  const uid = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [done, setDone] = useState<Record<string, boolean>>(() => Object.fromEntries(steps.map((s) => [s.id, s.done])));
  const [justSeated, setJustSeated] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const focusFirstOnOpen = useRef(false);

  const doneCount = steps.filter((s) => done[s.id]).length;
  const next = steps.find((s) => !done[s.id]);

  const items = () => Array.from(cardRef.current?.querySelectorAll<HTMLElement>("[data-pm-item]") ?? []);

  useEffect(() => {
    if (!open) return;
    if (focusFirstOnOpen.current) {
      items()[0]?.focus();
      focusFirstOnOpen.current = false;
    }
    const onDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (!justSeated) return;
    const id = window.setTimeout(() => setJustSeated(null), 600);
    return () => window.clearTimeout(id);
  }, [justSeated]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || ((event.key === "Enter" || event.key === " ") && !open)) {
      event.preventDefault();
      focusFirstOnOpen.current = true;
      if (open) items()[0]?.focus();
      else setOpen(true);
    }
  };

  const onCardKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    let to: number | null = null;
    if (event.key === "ArrowDown") to = (at + 1) % list.length;
    else if (event.key === "ArrowUp") to = (at - 1 + list.length) % list.length;
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = list.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (to === null) return;
    event.preventDefault();
    list[to]?.focus();
  };

  const startStep = (id: string) => {
    if (onStep) onStep(id);
    setDone((d) => ({ ...d, [id]: true }));
    setJustSeated(id);
    // Keep focus inside the card when the step button is replaced.
    window.requestAnimationFrame(() => items()[0]?.focus());
  };

  return (
    <div className={cx("kb-pm", className)} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="kb-pm-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={`${uid}-card`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
      >
        <Avatar name={user.name} size={26} />
        <span className="kb-pm-trigger-name">{user.name}</span>
        {next ? <span className="kb-pm-trigger-dot" aria-label="Profile setup not finished" role="img" /> : null}
        <Icon name="chevronDown" size={14} />
      </button>

      {open ? (
        <div className="kb-pm-card" id={`${uid}-card`} ref={cardRef} role="dialog" aria-label="Account" onKeyDown={onCardKey}>
          <div className="kb-pm-who">
            <Avatar name={user.name} size={42} />
            <div className="kb-pm-who-text">
              <span className="kb-pm-name">{user.name}</span>
              <span className="kb-pm-email">{user.email}</span>
            </div>
          </div>
          <div className="kb-pm-ws">
            <Icon name="layers" size={14} />
            <span>{user.workspace}</span>
            <Tag tone="accent">{user.plan}</Tag>
          </div>

          <section className="kb-pm-setup" aria-labelledby={`${uid}-setup`}>
            <div className="kb-pm-setup-head">
              <span id={`${uid}-setup`} className="kb-pm-setup-title">{next ? "Finish setting up" : "Profile complete"}</span>
              <span className="kb-pm-setup-count">{doneCount} of {steps.length} done</span>
            </div>
            <ol className="kb-pm-tray" aria-label="Setup steps">
              {steps.map((s) => (
                <li
                  key={s.id}
                  className="kb-pm-slot"
                  data-state={done[s.id] ? "done" : s.id === next?.id ? "next" : "open"}
                  data-seated={justSeated === s.id || undefined}
                  title={s.label}
                >
                  <span className="kb-pm-part" aria-hidden />
                  <span className="kb-sr">{s.label}: {done[s.id] ? "done" : "not done"}</span>
                </li>
              ))}
            </ol>
            {next ? (
              <button type="button" className="kb-pm-next" data-pm-item onClick={() => startStep(next.id)}>
                <span className="kb-pm-next-text">
                  <span className="kb-pm-next-kicker">Next step</span>
                  <span className="kb-pm-next-label">{next.label}</span>
                </span>
                <span className="kb-pm-next-go">Start</span>
              </button>
            ) : (
              <div className="kb-pm-complete" role="status">
                <Icon name="check" size={14} strokeWidth={2.2} />
                Every part is in. Your agents can run unattended.
              </div>
            )}
          </section>

          <div className="kb-pm-menu" role="menu" aria-label="Account actions">
            {actions.map((a) => (
              <button
                key={a.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                data-pm-item
                data-tone={a.tone}
                className="kb-pm-item"
                onClick={() => {
                  onAction?.(a.id);
                  close();
                }}
              >
                <Icon name={a.icon} size={16} />
                <span className="kb-pm-item-label">{a.label}</span>
                {a.meta ? <span className="kb-pm-item-meta">{a.meta}</span> : null}
                {a.keys ? (
                  <span className="kb-pm-keys" aria-hidden>
                    {a.keys.map((k) => <kbd key={k}>{k}</kbd>)}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
