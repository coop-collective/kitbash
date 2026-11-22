"use client";

import { useId, useState } from "react";
import { cx, Icon, Tag } from "../../shared/index.ts";
import { Button } from "../button/Button.tsx";
import "./decision-tree.css";

export interface DecisionConsequence {
  kind: "gain" | "cost";
  text: string;
}

export interface DecisionOption {
  id: string;
  title: string;
  consequences: DecisionConsequence[];
  /** Marked as a hazard: the branch can hurt something that is hard to undo */
  risky?: boolean;
  /** The agent's own recommendation */
  pick?: boolean;
}

export interface Decision {
  agent: string;
  question: string;
  /** What the agent knows, one or two sentences */
  context: string;
  options: DecisionOption[];
}

export const sampleDecision: Decision = {
  agent: "Release agent",
  question: "Checkout tests fail only on Safari 18. How should I unblock the 4.0 release?",
  context: "The failures started when CI picked up safaridriver 18.1 last night. Every other browser passes.",
  options: [
    {
      id: "skip",
      title: "Skip Safari in CI for this release",
      risky: true,
      consequences: [
        { kind: "gain", text: "Release ships today" },
        { kind: "cost", text: "Safari, 18% of checkout traffic, goes untested" },
      ],
    },
    {
      id: "pin",
      title: "Pin the driver to Safari 17.6",
      pick: true,
      consequences: [
        { kind: "gain", text: "Green build in about 20 minutes" },
        { kind: "gain", text: "Safari stays covered on 17.6" },
        { kind: "cost", text: "A Safari 18-only bug could slip through" },
      ],
    },
    {
      id: "hold",
      title: "Hold the release until the driver is fixed",
      consequences: [
        { kind: "gain", text: "No untested path ships" },
        { kind: "cost", text: "Release slips 2 to 3 days, past the Nov 5 launch" },
      ],
    },
  ],
};

const OWN = "__own";

export interface DecisionTreeProps {
  decision?: Decision;
  /** Called with the chosen option id, or with the person's own instruction */
  onChoose?: (choice: { optionId: string } | { instruction: string }) => void;
  className?: string;
}

/**
 * An agent stuck on a decision lays out its options as a tree hanging from one runner, like parts on a sprue:
 * what each branch gains and costs, the hazardous ones marked, its own pick highlighted. Choose a branch or write your
 * own; confirming clips every other branch off the runner.
 */
export function DecisionTree({ decision = sampleDecision, onChoose, className }: DecisionTreeProps) {
  const [selected, setSelected] = useState<string>(decision.options.find((o) => o.pick)?.id ?? decision.options[0]?.id ?? OWN);
  const [own, setOwn] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const name = useId();
  const ownId = useId();

  const decided = chosen !== null;
  const canConfirm = selected !== OWN || own.trim().length > 0;
  const selectedOption = decision.options.find((o) => o.id === selected);

  const confirm = () => {
    if (!canConfirm) return;
    setChosen(selected);
    onChoose?.(selected === OWN ? { instruction: own.trim() } : { optionId: selected });
  };

  const branches = [...decision.options.map((o) => o.id), OWN];

  return (
    <div className={cx("kb-root kb-dt", className)} data-decided={decided || undefined}>
      <div className="kb-dt-root kb-part">
        <div className="kb-dt-root-top">
          <span className="kb-dt-agent">
            <Icon name="robot" size={15} />
            {decision.agent} is stuck
          </span>
          {decided ? <Tag tone="ok" dot>Decided</Tag> : <Tag tone="decal" dot>Waiting for you</Tag>}
        </div>
        <h3>{decision.question}</h3>
        <p>{decision.context}</p>
      </div>

      <div className="kb-dt-runner" style={{ gridTemplateColumns: `repeat(${branches.length}, minmax(0, 1fr))` }} aria-hidden>
        {branches.map((id) => (
          <span key={id} className="kb-dt-gate" data-on={(decided ? chosen === id : selected === id) || undefined} data-cut={(decided && chosen !== id) || undefined} />
        ))}
      </div>

      <div
        className="kb-dt-branches"
        role="radiogroup"
        aria-label="Options"
        style={{ gridTemplateColumns: `repeat(${branches.length}, minmax(0, 1fr))` }}
      >
        {decision.options.map((o) => (
          <label
            key={o.id}
            className="kb-dt-branch"
            data-selected={selected === o.id || undefined}
            data-cut={(decided && chosen !== o.id) || undefined}
            data-chosen={(decided && chosen === o.id) || undefined}
            data-risky={o.risky || undefined}
          >
            <input
              type="radio"
              name={name}
              value={o.id}
              className="kb-sr"
              checked={selected === o.id}
              disabled={decided}
              onChange={() => setSelected(o.id)}
            />
            <span className="kb-dt-branch-top">
              {o.pick ? (
                <span className="kb-dt-pick">
                  <Icon name="sparkle" size={13} /> Agent's pick
                </span>
              ) : null}
              {o.risky ? (
                <span className="kb-dt-risk">
                  <Icon name="alert" size={13} /> Risky
                </span>
              ) : null}
            </span>
            <span className="kb-dt-title">{o.title}</span>
            <ul className="kb-dt-leaves">
              {o.consequences.map((c) => (
                <li key={c.text} data-kind={c.kind}>
                  <span className="kb-dt-sign" aria-label={c.kind === "gain" ? "Gain" : "Cost"}>
                    {c.kind === "gain" ? "+" : "−"}
                  </span>
                  {c.text}
                </li>
              ))}
            </ul>
          </label>
        ))}

        <label
          className="kb-dt-branch kb-dt-own"
          data-selected={selected === OWN || undefined}
          data-cut={(decided && chosen !== OWN) || undefined}
          data-chosen={(decided && chosen === OWN) || undefined}
        >
          <input
            type="radio"
            name={name}
            value={OWN}
            className="kb-sr"
            checked={selected === OWN}
            disabled={decided}
            onChange={() => setSelected(OWN)}
          />
          <span className="kb-dt-branch-top">
            <span className="kb-dt-pick" data-tone="you">
              <Icon name="edit" size={13} /> Your own
            </span>
          </span>
          <span className="kb-dt-title">Something else</span>
          <textarea
            id={ownId}
            className="kb-dt-text"
            rows={4}
            value={own}
            disabled={decided}
            placeholder="Tell the agent what to do instead"
            aria-label="Your own instruction"
            onFocus={() => setSelected(OWN)}
            onChange={(e) => setOwn(e.target.value)}
          />
        </label>
      </div>

      <footer className="kb-dt-foot">
        {decided ? (
          <>
            <span className="kb-dt-note" role="status">
              <Icon name="check" size={15} />
              {chosen === OWN ? `Sent your instruction to ${decision.agent}.` : `${decision.agent} will ${lowerFirst(selectedOption?.title ?? "")}.`}
            </span>
            <Button variant="ghost" icon="undo" onClick={() => setChosen(null)}>
              Change my mind
            </Button>
          </>
        ) : (
          <>
            <span className="kb-dt-note">
              {selected === OWN ? "Your instruction replaces every option above." : selectedOption?.risky ? "This branch is marked risky." : "Pick a branch, or write your own."}
            </span>
            <Button variant="primary" onClick={confirm} disabled={!canConfirm}>
              {selected === OWN ? "Send instruction" : "Go with this path"}
            </Button>
          </>
        )}
      </footer>
    </div>
  );
}

function lowerFirst(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
