"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cx, Icon, NumberRoll } from "../../shared/index.ts";
import "./model-picker.css";

export type Effort = "low" | "medium" | "high" | "max";

export interface ModelOption {
  id: string;
  name: string;
  blurb: string;
  /** 1 to 5 */
  speed: number;
  quality: number;
  cost: number;
  /** Typical time to first token, in seconds */
  firstToken: number;
  /** USD per million input / output tokens */
  priceIn: number;
  priceOut: number;
  /** Context window, e.g. "200K" */
  context: string;
  thinking?: boolean;
  tag?: string;
}

export interface ModelSelection {
  model: string;
  thinking: boolean;
  effort: Effort;
}

export const DEFAULT_MODELS: ModelOption[] = [
  { id: "kestrel-mini", context: "128K", name: "Kestrel Mini", blurb: "Quick answers and triage", speed: 5, quality: 2, cost: 1, firstToken: 0.3, priceIn: 0.25, priceOut: 1.25 },
  { id: "kestrel", context: "200K", name: "Kestrel", blurb: "Balanced for most work", speed: 4, quality: 4, cost: 3, firstToken: 0.6, priceIn: 3, priceOut: 15, thinking: true, tag: "Default" },
  { id: "kestrel-max", context: "1M", name: "Kestrel Max", blurb: "Hard reasoning and long agent runs", speed: 2, quality: 5, cost: 5, firstToken: 1.4, priceIn: 15, priceOut: 75, thinking: true },
  { id: "osprey-code", context: "400K", name: "Osprey Code", blurb: "Repo-scale edits and refactors", speed: 3, quality: 4, cost: 3, firstToken: 0.8, priceIn: 2, priceOut: 10 },
];

const EFFORTS: Array<{ id: Effort; label: string; delay: number }> = [
  { id: "low", label: "Low", delay: 2 },
  { id: "medium", label: "Medium", delay: 6 },
  { id: "high", label: "High", delay: 14 },
  { id: "max", label: "Max", delay: 32 },
];

export interface ModelPickerProps {
  models?: ModelOption[];
  defaultModel?: string;
  defaultThinking?: boolean;
  defaultEffort?: Effort;
  defaultOpen?: boolean;
  onChange?: (selection: ModelSelection) => void;
  className?: string;
}

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * The model menu of an AI chat. Point at a model and its speed, quality and cost read out as rows of molded pips
 * that click in one by one; extended thinking unfolds an effort selector, and the tray at the bottom rolls the
 * first-token time and price like odometers.
 */
export function ModelPicker({
  models = DEFAULT_MODELS,
  defaultModel = "kestrel",
  defaultThinking = false,
  defaultEffort = "medium",
  defaultOpen = false,
  onChange,
  className,
}: ModelPickerProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [selected, setSelected] = useState(defaultModel);
  const [pointed, setPointed] = useState(defaultModel);
  const [thinking, setThinking] = useState(defaultThinking);
  const [effort, setEffort] = useState<Effort>(defaultEffort);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const uid = useId();

  const current = models.find((m) => m.id === selected) ?? models[0];
  const shown = models.find((m) => m.id === pointed) ?? current;
  const canThink = Boolean(current?.thinking);
  const thinkingOn = thinking && canThink;
  const effortInfo = EFFORTS.find((e) => e.id === effort) ?? EFFORTS[1]!;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const emit = (next: Partial<ModelSelection>) =>
    onChange?.({ model: selected, thinking, effort, ...next });

  const openMenu = () => {
    setOpen(true);
    setPointed(selected);
    window.requestAnimationFrame(() => listRef.current?.focus());
  };
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const choose = (id: string) => {
    setSelected(id);
    setPointed(id);
    emit({ model: id });
  };

  const onListKey = (e: KeyboardEvent) => {
    const i = models.findIndex((m) => m.id === pointed);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = models[(i + (e.key === "ArrowDown" ? 1 : -1) + models.length) % models.length];
      if (next) setPointed(next.id);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const next = e.key === "Home" ? models[0] : models[models.length - 1];
      if (next) setPointed(next.id);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(pointed);
    }
  };

  const onEffortKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = EFFORTS.findIndex((x) => x.id === effort);
    const next = EFFORTS[Math.min(EFFORTS.length - 1, Math.max(0, i + (e.key === "ArrowRight" ? 1 : -1)))];
    if (next) {
      setEffort(next.id);
      emit({ effort: next.id });
      (e.currentTarget.querySelector(`[data-effort="${next.id}"]`) as HTMLElement | null)?.focus();
    }
  };

  // Tray figures describe the selected configuration, previewing whatever model is pointed at.
  const trayModel = shown ?? current;
  const trayThinking = thinkingOn && Boolean(trayModel?.thinking);
  const firstToken = (trayModel?.firstToken ?? 0) + (trayThinking ? effortInfo.delay : 0);

  return (
    <div
      className={cx("kb-mp", className)}
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="kb-mp-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${uid}-menu`}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        <Icon name="sparkle" size={15} />
        <span className="kb-mp-trigger-name">{current?.name}</span>
        {thinkingOn ? <span className="kb-mp-trigger-think">Thinking {effortInfo.label.toLowerCase()}</span> : null}
        <Icon name="chevronDown" size={15} className="kb-mp-caret" />
      </button>

      {open ? (
        <div className="kb-mp-menu" id={`${uid}-menu`} role="dialog" aria-label="Choose a model">
          <div className="kb-mp-main">
            <ul
              ref={listRef}
              className="kb-mp-list"
              role="listbox"
              tabIndex={0}
              aria-label="Models"
              aria-activedescendant={`${uid}-${pointed}`}
              onKeyDown={onListKey}
            >
              {models.map((m) => (
                <li
                  key={m.id}
                  id={`${uid}-${m.id}`}
                  role="option"
                  aria-selected={m.id === selected}
                  className="kb-mp-option"
                  data-pointed={m.id === pointed || undefined}
                  onPointerEnter={() => setPointed(m.id)}
                  onClick={() => choose(m.id)}
                >
                  <span className="kb-mp-radio" aria-hidden />
                  <span className="kb-mp-option-text">
                    <span className="kb-mp-option-name">
                      {m.name}
                      {m.tag ? <span className="kb-mp-badge">{m.tag}</span> : null}
                    </span>
                    <span className="kb-mp-option-blurb">{m.blurb}</span>
                  </span>
                </li>
              ))}
            </ul>

            <div className="kb-mp-spec" aria-live="polite">
              <p className="kb-mp-spec-name">{shown?.name}</p>
              {shown ? (
                <dl className="kb-mp-bars" key={shown.id}>
                  <Pips label="Speed" value={shown.speed} />
                  <Pips label="Quality" value={shown.quality} />
                  <Pips label="Cost" value={shown.cost} tone="cost" />
                </dl>
              ) : null}
              {shown ? (
                <p className="kb-mp-note">
                  {shown.context} token context{shown.thinking ? ", extended thinking" : ", no extended thinking"}
                </p>
              ) : null}
            </div>
          </div>

          <div className="kb-mp-think" data-disabled={!canThink || undefined}>
            <div className="kb-mp-think-row">
              <span className="kb-mp-think-text">
                <span className="kb-mp-think-title" id={`${uid}-think`}>Extended thinking</span>
                <span className="kb-mp-think-sub">
                  {canThink ? "Reasons step by step before answering" : `${current?.name} answers directly`}
                </span>
              </span>
              <button
                type="button"
                role="switch"
                className="kb-mp-switch"
                aria-checked={thinkingOn}
                aria-labelledby={`${uid}-think`}
                disabled={!canThink}
                onClick={() => {
                  setThinking(!thinking);
                  emit({ thinking: !thinking });
                }}
              >
                <span className="kb-mp-knob" />
              </button>
            </div>
            <div className="kb-mp-effort-fold" data-open={thinkingOn || undefined}>
              <div className="kb-mp-effort" role="radiogroup" aria-label="Thinking effort" onKeyDown={onEffortKey} inert={!thinkingOn}>
                {EFFORTS.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    role="radio"
                    data-effort={e.id}
                    aria-checked={effort === e.id}
                    tabIndex={effort === e.id ? 0 : -1}
                    className="kb-mp-seg"
                    onClick={() => {
                      setEffort(e.id);
                      emit({ effort: e.id });
                    }}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="kb-mp-tray">
            <span className="kb-mp-stat">
              <span className="kb-mp-stat-label">First token</span>
              <span className="kb-mp-stat-value">
                ~<NumberRoll value={firstToken.toFixed(1)} />s
              </span>
            </span>
            <span className="kb-mp-stat">
              <span className="kb-mp-stat-label">Per 1M tokens in / out</span>
              <span className="kb-mp-stat-value">
                <NumberRoll value={money(trayModel?.priceIn ?? 0)} />
                <span className="kb-mp-slash">/</span>
                <NumberRoll value={money(trayModel?.priceOut ?? 0)} />
              </span>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Five molded pips; filled ones click in one after another. */
function Pips({ label, value, tone }: { label: string; value: number; tone?: "cost" }) {
  return (
    <div className="kb-mp-bar">
      <dt>{label}</dt>
      <dd>
        <span className="kb-mp-pips" data-tone={tone} role="img" aria-label={`${value} of 5`}>
          {Array.from({ length: 5 }, (_, i) => (
            <i key={i} data-on={i < value || undefined} style={{ animationDelay: `${i * 55}ms` }} />
          ))}
        </span>
      </dd>
    </div>
  );
}
