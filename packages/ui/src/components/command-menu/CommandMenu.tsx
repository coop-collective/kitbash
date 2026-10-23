import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { cx, Icon, type IconName } from "../../shared/index.ts";
import "./command-menu.css";

/** A tool action from a connected service. The first five get ⌘1–⌘5 in order. */
export interface CommandMenuTool {
  id: string;
  /** Service name, e.g. "Linear"; shown under the action */
  service: string;
  label: string;
  /** What the action does, not whose logo it is */
  icon: IconName;
  keywords?: string[];
}

/** An everyday command with an icon and an optional shortcut. */
export interface CommandMenuCommand {
  id: string;
  label: string;
  icon: IconName;
  /** Shortcut keys shown as keycaps, e.g. ["⌘", "N"] */
  keys?: string[];
  keywords?: string[];
}

export type CommandMenuItem =
  | ({ kind: "tool" } & CommandMenuTool)
  | ({ kind: "command" } & CommandMenuCommand);

export interface CommandMenuProps {
  tools?: CommandMenuTool[];
  commands?: CommandMenuCommand[];
  placeholder?: string;
  /** Starting query, e.g. for a filtered or empty state */
  defaultQuery?: string;
  /** Called when an item runs (Enter, click or its ⌘ shortcut) */
  onRun?: (item: CommandMenuItem) => void;
  className?: string;
}

export const DEMO_TOOLS: CommandMenuTool[] = [
  { id: "linear-issue", service: "Linear", label: "Create issue in Platform", icon: "flag", keywords: ["bug", "ticket"] },
  { id: "github-pr", service: "GitHub", label: "Open pull request from agent/fix-retries", icon: "code", keywords: ["code", "review"] },
  { id: "slack-post", service: "Slack", label: "Post run summary to #eval-runs", icon: "message", keywords: ["message", "share"] },
  { id: "notion-append", service: "Notion", label: "Append notes to Weekly agent review", icon: "file", keywords: ["doc", "notes"] },
  { id: "drive-save", service: "Drive", label: "Save transcript to Research / Evals", icon: "folder", keywords: ["file", "upload"] },
];

export const DEMO_COMMANDS: CommandMenuCommand[] = [
  { id: "new-run", label: "Start a new agent run", icon: "play", keys: ["⌘", "N"], keywords: ["create"] },
  { id: "search-runs", label: "Search run history", icon: "clock", keys: ["⌘", "H"] },
  { id: "copy-link", label: "Copy link to this run", icon: "link", keys: ["⌘", "L"] },
  { id: "invite", label: "Invite a teammate", icon: "users" },
  { id: "switch-workspace", label: "Switch workspace", icon: "layers", keys: ["⌘", "O"] },
  { id: "budget", label: "Set a spending limit", icon: "credit" },
  { id: "settings", label: "Open settings", icon: "settings", keys: ["⌘", ","] },
];

function matches(item: CommandMenuItem, q: string): boolean {
  if (!q) return true;
  const hay = [item.label, item.kind === "tool" ? item.service : "", ...(item.keywords ?? [])].join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).every((word) => hay.includes(word));
}

/** Wrap the first case-insensitive occurrence of the query in <mark>. */
function highlight(text: string, q: string): ReactNode {
  const needle = q.trim().toLowerCase();
  if (!needle) return text;
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

function Keycaps({ keys }: { keys: string[] }) {
  return (
    <span className="kb-cmd-keys" aria-hidden>
      <kbd className="kb-cmd-key">{keys.join("")}</kbd>
    </span>
  );
}

/**
 * Command menu: one search field over tool actions (with service tiles and ⌘1–⌘5) and everyday commands.
 * Follows the WAI-ARIA combobox + listbox pattern: focus stays in the field, arrows move the active row.
 * The highlight is one slider part that snaps from row to row; firing a shortcut presses its keycaps in.
 */
export function CommandMenu({
  tools = DEMO_TOOLS,
  commands = DEMO_COMMANDS,
  placeholder = "Search actions and commands",
  defaultQuery = "",
  onRun,
  className,
}: CommandMenuProps) {
  const uid = useId();
  const [query, setQuery] = useState(defaultQuery);
  const [active, setActive] = useState(0);
  const [fired, setFired] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const [slider, setSlider] = useState<{ top: number; height: number } | null>(null);

  const toolItems = useMemo<CommandMenuItem[]>(
    () => tools.filter((t) => matches({ kind: "tool", ...t }, query)).map((t) => ({ kind: "tool", ...t })),
    [tools, query],
  );
  const commandItems = useMemo<CommandMenuItem[]>(
    () => commands.filter((c) => matches({ kind: "command", ...c }, query)).map((c) => ({ kind: "command", ...c })),
    [commands, query],
  );
  const flat = useMemo(() => [...toolItems, ...commandItems], [toolItems, commandItems]);
  const current = flat[Math.min(active, flat.length - 1)];
  const optionId = (id: string) => `${uid}-opt-${id}`;

  // Keep the active index valid as the list filters.
  useEffect(() => setActive(0), [query]);

  // Measure the active row so the slider part can snap to it, and keep it in view.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !current) {
      setSlider(null);
      return;
    }
    const row = list.querySelector<HTMLElement>(`[id="${optionId(current.id)}"]`);
    if (!row) return;
    setSlider({ top: row.offsetTop, height: row.offsetHeight });
    const { scrollTop, clientHeight } = list;
    if (row.offsetTop < scrollTop) list.scrollTop = row.offsetTop - 28;
    else if (row.offsetTop + row.offsetHeight > scrollTop + clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - clientHeight + 6;
  }, [current?.id, flat.length]);

  useEffect(() => {
    if (!fired) return;
    const id = window.setTimeout(() => setFired(null), 420);
    return () => window.clearTimeout(id);
  }, [fired]);

  const run = (item: CommandMenuItem) => {
    setFired(item.id);
    setStatus(item.kind === "tool" ? `Ran ${item.service}: ${item.label}` : `Ran ${item.label}`);
    onRun?.(item);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = flat.length;
    if ((event.metaKey || event.ctrlKey) && /^[1-5]$/.test(event.key)) {
      const tool = tools[Number(event.key) - 1];
      if (tool) {
        event.preventDefault();
        run({ kind: "tool", ...tool });
        const at = flat.findIndex((f) => f.id === tool.id);
        if (at >= 0) setActive(at);
      }
      return;
    }
    if (event.key === "ArrowDown" && count) {
      event.preventDefault();
      setActive((i) => (i + 1) % count);
    } else if (event.key === "ArrowUp" && count) {
      event.preventDefault();
      setActive((i) => (i - 1 + count) % count);
    } else if (event.key === "Enter" && current) {
      event.preventDefault();
      run(current);
    } else if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
    }
  };

  const renderGroup = (label: string, items: CommandMenuItem[], offset: number) => {
    if (!items.length) return null;
    const labelId = `${uid}-${label}`;
    return (
      <div role="group" aria-labelledby={labelId} className="kb-cmd-group">
        <div id={labelId} className="kb-cmd-group-label">{label}</div>
        {items.map((item, i) => {
          const index = offset + i;
          const isActive = current?.id === item.id;
          const shortcut = item.kind === "tool" ? tools.findIndex((t) => t.id === item.id) + 1 : 0;
          const keys = item.kind === "tool" ? (shortcut > 0 && shortcut <= 5 ? ["⌘", String(shortcut)] : undefined) : item.keys;
          return (
            <div
              key={item.id}
              id={optionId(item.id)}
              role="option"
              aria-selected={isActive}
              className="kb-cmd-option"
              data-active={isActive || undefined}
              data-fired={fired === item.id || undefined}
              onPointerMove={() => !isActive && setActive(index)}
              onPointerDown={(e) => e.preventDefault() /* keep focus in the field */}
              onClick={() => run(item)}
            >
              <span className="kb-cmd-glyph" aria-hidden><Icon name={item.icon} size={16} /></span>
              <span className="kb-cmd-text">
                <span className="kb-cmd-label">{highlight(item.label, query)}</span>
                {item.kind === "tool" ? <span className="kb-cmd-service">{highlight(item.service, query)}</span> : null}
              </span>
              {keys ? <Keycaps keys={keys} /> : null}
              {keys ? <span className="kb-sr">, shortcut {keys.join(" ")}</span> : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className={cx("kb-cmd", className)}>
      <div className="kb-cmd-field">
        <Icon name="search" size={18} />
        <input
          className="kb-cmd-input"
          role="combobox"
          aria-label="Command menu"
          aria-expanded={flat.length > 0}
          aria-controls={`${uid}-list`}
          aria-autocomplete="list"
          aria-activedescendant={current ? optionId(current.id) : undefined}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        {query ? (
          <button type="button" className="kb-cmd-clear" aria-label="Clear search" onClick={() => setQuery("")}>
            <Icon name="x" size={14} />
          </button>
        ) : (
          <Keycaps keys={["⌘", "K"]} />
        )}
      </div>

      <div className="kb-cmd-list" id={`${uid}-list`} role="listbox" aria-label="Results" ref={listRef}>
        {slider ? (
          <span className="kb-cmd-slider" aria-hidden style={{ transform: `translateY(${slider.top}px)`, height: slider.height }} />
        ) : null}
        {renderGroup("Tool actions", toolItems, 0)}
        {renderGroup("Commands", commandItems, toolItems.length)}
        {flat.length === 0 ? (
          <div className="kb-cmd-empty">
            <strong>Nothing matches “{query}”</strong>
            <span>Try a service name like Linear or Slack, or a verb like “post”.</span>
          </div>
        ) : null}
      </div>

      <div className="kb-cmd-foot">
        <span><Keycaps keys={["↑", "↓"]} /> move</span>
        <span><Keycaps keys={["↵"]} /> run</span>
        <span><Keycaps keys={["⌘", "1–5"]} /> tool actions</span>
        <span className="kb-cmd-status" role="status" aria-live="polite">
          {status ? <><Icon name="check" size={14} />{status}</> : null}
        </span>
      </div>
    </div>
  );
}
