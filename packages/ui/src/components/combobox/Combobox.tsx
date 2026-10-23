import { useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Avatar, cx, Icon } from "../../shared/index.ts";
import "./combobox.css";

export interface ComboOption {
  id: string;
  label: string;
  group: string;
  /** Secondary line, matched by search too */
  description?: string;
  /** "person" shows an initials avatar, "agent" a molded robot badge */
  kind?: "person" | "agent" | "team";
}

export const DEMO_ASSIGNEES: ComboOption[] = [
  { id: "dana", label: "Dana Whitfield", group: "People", description: "Support lead", kind: "person" },
  { id: "marcus", label: "Marcus Oyelaran", group: "People", description: "Billing engineer", kind: "person" },
  { id: "priya", label: "Priya Raman", group: "People", description: "Platform on-call this week", kind: "person" },
  { id: "tomas", label: "Tomás Ferreira", group: "People", description: "Security reviewer", kind: "person" },
  { id: "lin", label: "Lin Zhao", group: "People", description: "Product, payments", kind: "person" },
  { id: "triage", label: "Triage agent", group: "Agents", description: "Labels and routes new tickets", kind: "agent" },
  { id: "refund", label: "Refund agent", group: "Agents", description: "Issues refunds under $200", kind: "agent" },
  { id: "notes", label: "Release notes writer", group: "Agents", description: "Drafts notes from merged PRs", kind: "agent" },
  { id: "testfix", label: "Flaky test fixer", group: "Agents", description: "Retries and patches CI failures", kind: "agent" },
  { id: "platform", label: "Platform on-call", group: "Teams", description: "6 people, PagerDuty rotation", kind: "team" },
  { id: "tier2", label: "Support tier 2", group: "Teams", description: "11 people", kind: "team" },
];

export interface ComboboxProps {
  label?: string;
  options?: ComboOption[];
  /** Pick many (chips) or one */
  multiple?: boolean;
  defaultValue?: string[];
  placeholder?: string;
  /** Offer "Create …" when the query matches nothing exactly */
  allowCreate?: boolean;
  /** Group new entries land in */
  createGroup?: string;
  /** Start with the list open (for docs) */
  defaultOpen?: boolean;
  /** Start with text in the search (for docs) */
  defaultQuery?: string;
  onChange?: (ids: string[]) => void;
  className?: string;
}

interface Row {
  option: ComboOption;
  create?: boolean;
}

/** Wrap every case-insensitive occurrence of `query` in <mark>. */
function highlight(text: string, query: string): ReactNode {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  const out: ReactNode[] = [];
  const lower = text.toLowerCase();
  let from = 0;
  let at = lower.indexOf(q);
  while (at >= 0) {
    if (at > from) out.push(text.slice(from, at));
    out.push(<mark key={at}>{text.slice(at, at + q.length)}</mark>);
    from = at + q.length;
    at = lower.indexOf(q, from);
  }
  if (from < text.length) out.push(text.slice(from));
  return out;
}

function Badge({ option, size }: { option: ComboOption; size: number }) {
  if (option.kind === "person") return <Avatar name={option.label} size={size} />;
  return (
    <span className="kb-cb-badge" data-kind={option.kind ?? "team"} style={{ width: size, height: size }}>
      <Icon name={option.kind === "agent" ? "robot" : "users"} size={Math.round(size * 0.62)} />
    </span>
  );
}

/**
 * Searchable, grouped picker following the WAI-ARIA combobox pattern: focus stays in the input while
 * arrow keys move the active option. Picked items snap into the well as chips; Backspace on an empty
 * query first lifts the last chip, a second Backspace pulls it out.
 */
export function Combobox({
  label = "Assign to",
  options: initialOptions = DEMO_ASSIGNEES,
  multiple = true,
  defaultValue = ["priya", "triage"],
  placeholder = "Search people, agents or teams",
  allowCreate = true,
  createGroup = "Added",
  defaultOpen = false,
  defaultQuery = "",
  onChange,
  className,
}: ComboboxProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [options, setOptions] = useState(initialOptions);
  const [selected, setSelected] = useState<string[]>(multiple ? defaultValue : defaultValue.slice(0, 1));
  const [query, setQuery] = useState(defaultQuery);
  const [open, setOpen] = useState(defaultOpen);
  const [active, setActive] = useState(0);
  const [armed, setArmed] = useState(false);
  const [announce, setAnnounce] = useState("");

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const hits = options.filter((o) => !q || o.label.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q));
    const result: Row[] = hits.map((option) => ({ option }));
    const exact = options.some((o) => o.label.toLowerCase() === q);
    if (allowCreate && q && !exact) {
      result.push({ option: { id: `new:${query.trim()}`, label: query.trim(), group: "Create", kind: "team" }, create: true });
    }
    return result;
  }, [options, query, allowCreate]);

  const groups = useMemo(() => {
    const map = new Map<string, Array<{ row: Row; index: number }>>();
    rows.forEach((row, index) => {
      const list = map.get(row.option.group) ?? [];
      list.push({ row, index });
      map.set(row.option.group, list);
    });
    return [...map.entries()];
  }, [rows]);

  const activeIndex = Math.min(active, rows.length - 1);
  const activeRow = rows[activeIndex];
  const optionId = (i: number) => `${id}-opt-${i}`;

  function commit(next: string[]) {
    setSelected(next);
    onChange?.(next);
  }

  function scrollTo(index: number) {
    window.requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }

  function move(delta: number) {
    if (!rows.length) return;
    const next = open ? (activeIndex + delta + rows.length) % rows.length : delta > 0 ? 0 : rows.length - 1;
    setOpen(true);
    setActive(next);
    scrollTo(next);
  }

  function choose(row: Row) {
    let option = row.option;
    if (row.create) {
      option = { id: `added-${Date.now()}`, label: option.label, group: createGroup, description: "Added just now", kind: "person" };
      setOptions((list) => [...list, option]);
    }
    const has = selected.includes(option.id);
    if (multiple) {
      commit(has ? selected.filter((s) => s !== option.id) : [...selected, option.id]);
      setAnnounce(`${option.label} ${has ? "removed" : "added"}`);
      setQuery("");
    } else {
      commit([option.id]);
      setAnnounce(`${option.label} selected`);
      setQuery("");
      setOpen(false);
    }
    setArmed(false);
    inputRef.current?.focus();
  }

  function remove(optionId: string) {
    const option = byId.get(optionId);
    commit(selected.filter((s) => s !== optionId));
    setArmed(false);
    if (option) setAnnounce(`${option.label} removed`);
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Backspace") setArmed(false);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (e.altKey) setOpen(true);
        else move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (e.altKey) setOpen(false);
        else move(-1);
        break;
      case "Home":
      case "End":
        if (open && rows.length) {
          e.preventDefault();
          const next = e.key === "Home" ? 0 : rows.length - 1;
          setActive(next);
          scrollTo(next);
        }
        break;
      case "Enter":
        if (open && activeRow) {
          e.preventDefault();
          choose(activeRow);
        }
        break;
      case "Escape":
        if (open) setOpen(false);
        else setQuery("");
        break;
      case "Tab":
        setOpen(false);
        break;
      case "Backspace": {
        if (query || !selected.length) break;
        e.preventDefault();
        const last = selected[selected.length - 1];
        if (!last) break;
        if (armed) remove(last);
        else {
          setArmed(true);
          setAnnounce(`Press Backspace again to remove ${byId.get(last)?.label ?? "the last item"}`);
        }
        break;
      }
    }
  }

  const chips = selected.map((s) => byId.get(s)).filter((o): o is ComboOption => Boolean(o));

  return (
    <div className={cx("kb-root kb-cb", className)}>
      <label className="kb-cb-label" htmlFor={id}>{label}</label>
      <div
        className="kb-cb-well"
        data-open={open || undefined}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            inputRef.current?.focus();
            setOpen(true);
          }
        }}
      >
        <ul className="kb-cb-chips" aria-label={`Selected, ${chips.length}`}>
          {chips.map((option, i) => (
            <li key={option.id} className="kb-cb-chip" data-armed={armed && i === chips.length - 1 ? "" : undefined}>
              <Badge option={option} size={18} />
              <span className="kb-cb-chip-text">{option.label}</span>
              <button
                type="button"
                className="kb-cb-chip-x"
                aria-label={`Remove ${option.label}`}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => remove(option.id)}
              >
                <Icon name="x" size={12} strokeWidth={2.25} />
              </button>
            </li>
          ))}
        </ul>
        <input
          ref={inputRef}
          id={id}
          className="kb-cb-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && activeRow ? optionId(activeIndex) : undefined}
          aria-describedby={`${id}-help`}
          value={query}
          placeholder={chips.length ? "Add more" : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
            setArmed(false);
          }}
          onClick={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setArmed(false);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="kb-cb-toggle"
          tabIndex={-1}
          aria-label={open ? "Close list" : "Open list"}
          onMouseDown={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
            setOpen((o) => !o);
          }}
        >
          <Icon name="chevronDown" size={16} />
        </button>
      </div>
      <p className="kb-cb-help" id={`${id}-help`}>
        {armed ? "Press Backspace again to remove the lifted item." : "Enter picks. Backspace twice removes the last one."}
      </p>

      {open ? (
        <div
          ref={listRef}
          className="kb-cb-pop"
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          aria-multiselectable={multiple || undefined}
          onMouseDown={(e) => e.preventDefault()}
        >
          {rows.length === 0 ? <p className="kb-cb-empty">Nothing matches “{query}”.</p> : null}
          {groups.map(([group, items]) => (
            <div key={group} role="group" aria-labelledby={`${id}-g-${group}`} className="kb-cb-group">
              <div className="kb-cb-group-head" id={`${id}-g-${group}`} role="presentation">
                {group === "Create" ? "Not in the list" : group}
              </div>
              {items.map(({ row, index }) => {
                const isSelected = !row.create && selected.includes(row.option.id);
                return (
                    <div
                      key={row.option.id}
                      id={optionId(index)}
                      data-index={index}
                      role="option"
                      aria-selected={isSelected}
                      className="kb-cb-option"
                      data-active={index === activeIndex || undefined}
                      data-create={row.create || undefined}
                      onMouseMove={() => setActive(index)}
                      onClick={() => choose(row)}
                    >
                      {row.create ? (
                        <span className="kb-cb-badge" data-kind="create" style={{ width: 24, height: 24 }}>
                          <Icon name="plus" size={14} />
                        </span>
                      ) : (
                        <Badge option={row.option} size={24} />
                      )}
                      <span className="kb-cb-option-text">
                        <span className="kb-cb-option-label">
                          {row.create ? <>Add “{row.option.label}” as a new person</> : highlight(row.option.label, query)}
                        </span>
                        {row.option.description && !row.create ? (
                          <span className="kb-cb-option-desc">{highlight(row.option.description, query)}</span>
                        ) : null}
                      </span>
                      <span className="kb-cb-check" aria-hidden>
                        {isSelected ? <Icon name="check" size={14} strokeWidth={2.25} /> : null}
                      </span>
                    </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
      <span className="kb-sr" role="status">{announce}</span>
    </div>
  );
}
