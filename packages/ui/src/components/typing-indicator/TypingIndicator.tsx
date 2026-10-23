"use client";

import { useEffect, useState } from "react";
import { MemberAvatar } from "../presence-stack/PresenceStack.tsx";
import { Skeleton, SkeletonCircle, SkeletonRegion } from "../skeleton/Skeleton.tsx";
import { cx } from "../../shared/index.ts";
import "./typing-indicator.css";

export interface Typer {
  id: string;
  name: string;
  kind: "person" | "agent";
}

export interface TypingIndicatorProps {
  /** Who is composing right now. Omit to run the demo, which cycles through the common cases */
  typers?: Typer[];
  /** inline sits in a line of text; bar spans the bottom of a thread with faces */
  variant?: "inline" | "bar";
  /** Names spelled out before the rest collapse into "and N others" */
  maxNames?: number;
  /** What an agent is doing, after its name: "is drafting a reply" */
  agentActivity?: string;
  /** Cycle the demo states when no typers are passed */
  autoplay?: boolean;
  loading?: boolean;
  className?: string;
}

const MAYA: Typer = { id: "maya", name: "Maya Chen", kind: "person" };
const DEV: Typer = { id: "dev", name: "Dev Patel", kind: "person" };
const PRIYA: Typer = { id: "priya", name: "Priya Raman", kind: "person" };
const JONAS: Typer = { id: "jonas", name: "Jonas Berg", kind: "person" };
const KITBASH: Typer = { id: "kitbash", name: "Kitbash", kind: "agent" };

/** The demo walks these in turn: one person, two, a crowd, an agent, and people with an agent */
export const typingDemoStates: Typer[][] = [[MAYA], [MAYA, DEV], [MAYA, DEV, PRIYA, JONAS], [KITBASH], [DEV, KITBASH]];

const first = (name: string) => name.split(" ")[0] ?? name;

/** "Maya", "Maya and Dev", or "Maya and 3 others" when there are more than `max`. */
export function joinNames(names: string[], max = 2): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= max) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const shown = names.slice(0, Math.max(1, max - 1));
  const rest = names.length - shown.length;
  return `${shown.join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
}

/** The sentence for a set of typers, people first, then agents. Exported for tests and custom layouts. */
export function typingSentence(typers: Typer[], maxNames = 2, agentActivity = "drafting a reply"): { people: string; agents: string } {
  const people = typers.filter((t) => t.kind === "person").map((t) => first(t.name));
  const agents = typers.filter((t) => t.kind === "agent").map((t) => t.name);
  return {
    people: people.length ? `${joinNames(people, maxNames)} ${people.length === 1 ? "is" : "are"} typing` : "",
    agents: agents.length ? `${joinNames(agents, maxNames)} ${agents.length === 1 ? "is" : "are"} ${agentActivity}` : "",
  };
}

/** Three small keys pressing in turn: a person at a keyboard */
function Keys() {
  return (
    <span className="kb-ti-keys" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

/** The Kitbash mark with its four gates lighting in turn: an agent composing */
function Gates() {
  return (
    <svg className="kb-ti-gates" viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <rect x="8" y="8" width="8" height="8" rx="1" />
      <path className="kb-ti-g" style={{ animationDelay: "0ms" }} d="M12 3v5" />
      <path className="kb-ti-g" style={{ animationDelay: "220ms" }} d="M16 12h5" />
      <path className="kb-ti-g" style={{ animationDelay: "440ms" }} d="M12 16v5" />
      <path className="kb-ti-g" style={{ animationDelay: "660ms" }} d="M3 12h5" />
    </svg>
  );
}

/**
 * Who is composing a message. People get three keys pressing in turn; an agent gets the Kitbash mark with its gates
 * lighting in cobalt, so "a person is typing" and "an agent is writing" never look alike. Names collapse past
 * `maxNames` ("Maya and 3 others"). The sentence is a polite live region; the animation is decoration.
 */
export function TypingIndicator({
  typers: typersProp,
  variant = "inline",
  maxNames = 2,
  agentActivity = "drafting a reply",
  autoplay = true,
  loading = false,
  className,
}: TypingIndicatorProps) {
  const [step, setStep] = useState(1);
  useEffect(() => {
    if (typersProp !== undefined || !autoplay) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % typingDemoStates.length), 3200);
    return () => window.clearInterval(id);
  }, [typersProp, autoplay]);

  if (loading) {
    return (
      <div className={cx("kb-ti", className)} data-variant={variant}>
        <SkeletonRegion label="Loading who is typing">
          <span className="kb-ti-row" data-variant={variant}>
            {variant === "bar" ? <SkeletonCircle size={20} /> : null}
            <Skeleton width={variant === "bar" ? 200 : 150} height={10} />
          </span>
        </SkeletonRegion>
      </div>
    );
  }

  const typers = typersProp ?? typingDemoStates[step] ?? [];
  const { people, agents } = typingSentence(typers, maxNames, agentActivity);
  const peopleList = typers.filter((t) => t.kind === "person");
  const agentList = typers.filter((t) => t.kind === "agent");
  const empty = !people && !agents;

  return (
    <div className={cx("kb-ti", className)} data-variant={variant} data-empty={empty || undefined} role="status" aria-live="polite" aria-atomic="true">
      {people ? (
        <span className="kb-ti-row" data-variant={variant} key={`p-${peopleList.length}`}>
          {variant === "bar" ? (
            <span className="kb-ti-faces" aria-hidden>
              {peopleList.slice(0, 3).map((t) => <MemberAvatar key={t.id} name={t.name} kind="person" size={20} />)}
            </span>
          ) : null}
          <Keys />
          <span className="kb-ti-text">{people}</span>
        </span>
      ) : null}
      {agents ? (
        <span className="kb-ti-row" data-variant={variant} data-agent key={`a-${agentList.length}`}>
          {/* The mark is the agent's face, so the bar shows no avatar beside it */}
          <Gates />
          <span className="kb-ti-text">{agents}</span>
        </span>
      ) : null}
    </div>
  );
}
