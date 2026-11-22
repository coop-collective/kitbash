"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { cx, Icon } from "../../shared/index.ts";
import "./filter-menu.css";

export interface FilterOption {
  value: string;
  label: string;
  /** Decal dot for values that mean "waiting on a person" */
  needsPerson?: boolean;
}

export interface FilterGroup {
  id: string;
  label: string;
  options: FilterOption[];
}

export type FilterValue = Record<string, string[]>;

/** One row of the thing being filtered: group id -> option value */
export type FilterRecord = Record<string, string>;

export const RUN_FILTERS: FilterGroup[] = [
  {
    id: "status",
    label: "Status",
    options: [
      { value: "running", label: "Running" },
      { value: "waiting", label: "Waiting on you", needsPerson: true },
      { value: "failed", label: "Failed" },
      { value: "succeeded", label: "Succeeded" },
      { value: "cancelled", label: "Cancelled" },
    ],
  },
  {
    id: "agent",
    label: "Agent",
    options: [
      { value: "triage", label: "Triage agent" },
      { value: "refund", label: "Refund agent" },
      { value: "notes", label: "Release notes writer" },
      { value: "testfix", label: "Flaky test fixer" },
    ],
  },
  {
    id: "model",
    label: "Model",
    options: [
      { value: "sonnet", label: "claude-sonnet-5" },
      { value: "haiku", label: "claude-haiku-5" },
      { value: "qwen", label: "qwen3-32b-instruct" },
    ],
  },
  {
    id: "trigger",
    label: "Trigger",
    options: [
      { value: "schedule", label: "Schedule" },
      { value: "webhook", label: "Webhook" },
      { value: "manual", label: "Started by a person" },
    ],
  },
];

/** 184 deterministic demo runs so facet counts are real */
export const DEMO_RUNS: FilterRecord[] = (() => {
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (weights: Array<[string, number]>) => {
    const total = weights.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [v, w] of weights) if ((r -= w) <= 0) return v;
    return weights[0]![0];
  };
  return Array.from({ length: 184 }, () => ({
    status: pick([["running", 9], ["waiting", 7], ["failed", 11], ["succeeded", 150], ["cancelled", 3]]),
    agent: pick([["triage", 70], ["refund", 34], ["notes", 22], ["testfix", 46]]),
    model: pick([["sonnet", 90], ["haiku", 70], ["qwen", 24]]),
    trigger: pick([["schedule", 60], ["webhook", 100], ["manual", 24]]),
  }));
})();

export interface FilterMenuProps {
  groups?: FilterGroup[];
  records?: FilterRecord[];
  /** Noun for the result line, plural */
  noun?: string;
  defaultValue?: FilterValue;
  /** Groups that start collapsed */
  defaultCollapsed?: string[];
  defaultOpen?: boolean;
  onChange?: (value: FilterValue) => void;
  className?: string;
}

type Item = { kind: "group"; group: FilterGroup } | { kind: "option"; group: FilterGroup; option: FilterOption };

const matches = (r: FilterRecord, v: FilterValue, skip?: string) =>
  Object.entries(v).every(([g, vals]) => g === skip || !vals.length || vals.includes(r[g] ?? ""));

/**
 * Filter menu for a run list. The menu follows the WAI-ARIA menu pattern with collapsible groups of
 * checkbox items (arrows to move, Right/Left to open and fold a group, Space to toggle, Escape to close).
 * Active filters show as one molded part per group, with a seam between each value, so "Status: Failed,
 * Waiting on you" reads as a single assembly whose pieces can be pulled out one at a time.
 */
export function FilterMenu({
  groups = RUN_FILTERS,
  records = DEMO_RUNS,
  noun = "runs",
  defaultValue = { status: ["failed", "waiting"], agent: ["triage"] },
  defaultCollapsed = ["trigger"],
  defaultOpen = false,
  onChange,
  className,
}: FilterMenuProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [value, setValue] = useState<FilterValue>(defaultValue);
  const [open, setOpen] = useState(defaultOpen);
  const [collapsed, setCollapsed] = useState<string[]>(defaultCollapsed);
  const [focus, setFocus] = useState(0);
  const [announce, setAnnounce] = useState("");
  const focusOnOpen = useRef(false);

  const items = useMemo<Item[]>(
    () =>
      groups.flatMap((group) => [
        { kind: "group", group } as Item,
        ...(collapsed.includes(group.id) ? [] : group.options.map((option) => ({ kind: "option", group, option }) as Item)),
      ]),
    [groups, collapsed],
  );

  const total = records.filter((r) => matches(r, value)).length;
  const activeCount = Object.values(value).reduce((s, v) => s + v.length, 0);

  useEffect(() => {
    if (open && focusOnOpen.current) itemRefs.current[focus]?.focus();
  }, [open, focus]);

  function update(next: FilterValue, message: string) {
    setValue(next);
    onChange?.(next);
    const count = records.filter((r) => matches(r, next)).length;
    setAnnounce(`${message}. ${count} ${noun}.`);
  }

  function toggle(group: FilterGroup, option: FilterOption) {
    const current = value[group.id] ?? [];
    const on = current.includes(option.value);
    update({ ...value, [group.id]: on ? current.filter((v) => v !== option.value) : [...current, option.value] }, `${option.label} ${on ? "off" : "on"}`);
  }

  function clearAll() {
    update({}, "Filters cleared");
  }

  function openMenu(at = 0) {
    focusOnOpen.current = true;
    setFocus(at);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function setGroupOpen(groupId: string, expand: boolean) {
    setCollapsed((c) => (expand ? c.filter((g) => g !== groupId) : c.includes(groupId) ? c : [...c, groupId]));
  }

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const item = items[focus];
    const to = (i: number) => {
      e.preventDefault();
      focusOnOpen.current = true;
      setFocus((i + items.length) % items.length);
    };
    switch (e.key) {
      case "ArrowDown": return to(focus + 1);
      case "ArrowUp": return to(focus - 1);
      case "Home": return to(0);
      case "End": return to(items.length - 1);
      case "ArrowRight":
        if (item?.kind === "group") {
          e.preventDefault();
          setGroupOpen(item.group.id, true);
        }
        return;
      case "ArrowLeft":
        e.preventDefault();
        if (item?.kind === "group") setGroupOpen(item.group.id, false);
        else if (item) to(items.findIndex((i) => i.kind === "group" && i.group.id === item.group.id));
        return;
      case " ":
      case "Enter":
        e.preventDefault();
        if (!item) return;
        if (item.kind === "group") setGroupOpen(item.group.id, collapsed.includes(item.group.id));
        else toggle(item.group, item.option);
        return;
      case "Escape":
      case "Tab":
        if (e.key === "Escape") e.preventDefault();
        close();
        return;
      default:
        // Type-ahead: jump to the next item starting with the typed letter
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const label = (i: Item) => (i.kind === "group" ? i.group.label : i.option.label).toLowerCase();
          for (let n = 1; n <= items.length; n++) {
            const i = (focus + n) % items.length;
            const candidate = items[i];
            if (candidate && label(candidate).startsWith(e.key.toLowerCase())) return to(i);
          }
        }
    }
  }

  const facet = (group: FilterGroup, option: FilterOption) =>
    records.filter((r) => matches(r, value, group.id) && r[group.id] === option.value).length;

  return (
    <div className={cx("kb-root kb-fm", className)}>
      <div className="kb-fm-bar">
        <button
          ref={triggerRef}
          type="button"
          className="kb-fm-trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={`${id}-menu`}
          onClick={() => (open ? setOpen(false) : openMenu())}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              openMenu(0);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              openMenu(items.length - 1);
            }
          }}
        >
          <Icon name="filter" size={15} />
          Filter
          {activeCount ? <span className="kb-fm-count">{activeCount}</span> : null}
        </button>

        <ul className="kb-fm-chips" aria-label="Active filters">
          {groups.map((group) => {
            const vals = value[group.id] ?? [];
            if (!vals.length) return null;
            return (
              <li key={group.id} className="kb-fm-assembly">
                <span className="kb-fm-assembly-key">{group.label}</span>
                {vals.map((v) => {
                  const option = group.options.find((o) => o.value === v);
                  if (!option) return null;
                  return (
                    <button
                      key={v}
                      type="button"
                      className="kb-fm-piece"
                      aria-label={`Remove ${option.label} from ${group.label}`}
                      onClick={() => toggle(group, option)}
                    >
                      {option.needsPerson ? <span className="kb-fm-decal" aria-hidden /> : null}
                      {option.label}
                      <Icon name="x" size={11} strokeWidth={2.4} />
                    </button>
                  );
                })}
              </li>
            );
          })}
        </ul>

        {activeCount ? (
          <button type="button" className="kb-fm-clear" onClick={clearAll}>
            Clear all
          </button>
        ) : null}
        <span className="kb-fm-total" aria-hidden>
          {total} of {records.length} {noun}
        </span>
      </div>

      {open ? (
        <div
          id={`${id}-menu`}
          className="kb-fm-menu"
          role="menu"
          aria-label="Filters"
          onKeyDown={onMenuKey}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null) && e.relatedTarget !== triggerRef.current) setOpen(false);
          }}
        >
          {items.map((item, i) => {
            if (item.kind === "group") {
              const expanded = !collapsed.includes(item.group.id);
              const on = (value[item.group.id] ?? []).length;
              return (
                <div
                  key={`g-${item.group.id}`}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  role="menuitem"
                  aria-expanded={expanded}
                  tabIndex={focus === i ? 0 : -1}
                  className="kb-fm-head"
                  onClick={() => {
                    setFocus(i);
                    setGroupOpen(item.group.id, !expanded);
                  }}
                >
                  <Icon name="chevronRight" size={14} className="kb-fm-caret" />
                  <span>{item.group.label}</span>
                  {on ? <span className="kb-fm-head-on">{on} on</span> : null}
                </div>
              );
            }
            const checked = (value[item.group.id] ?? []).includes(item.option.value);
            const n = facet(item.group, item.option);
            return (
              <div
                key={`${item.group.id}-${item.option.value}`}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                role="menuitemcheckbox"
                aria-checked={checked}
                tabIndex={focus === i ? 0 : -1}
                className="kb-fm-option"
                data-empty={n === 0 || undefined}
                onClick={() => {
                  setFocus(i);
                  toggle(item.group, item.option);
                }}
              >
                <span className="kb-fm-box" aria-hidden>
                  {checked ? <Icon name="check" size={12} strokeWidth={2.6} /> : null}
                </span>
                {item.option.needsPerson ? <span className="kb-fm-decal" aria-hidden /> : null}
                <span className="kb-fm-option-label">{item.option.label}</span>
                <span className="kb-fm-n">{n}</span>
              </div>
            );
          })}
          <div className="kb-fm-menu-foot">
            <span>{total} {noun} match</span>
            <button type="button" className="kb-fm-clear" onClick={clearAll} disabled={!activeCount} tabIndex={-1}>
              Clear all
            </button>
          </div>
        </div>
      ) : null}
      <span className="kb-sr" role="status">{announce}</span>
    </div>
  );
}
