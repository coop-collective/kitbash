import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { cx, Icon, NumberRoll } from "../../shared/index.ts";
import type { IconName } from "../../shared/index.ts";
import { Button } from "../button/Button.tsx";
import "./memory-panel.css";

export type MemoryCategory = "about" | "work" | "preferences" | "projects";

export interface Memory {
  id: string;
  category: MemoryCategory;
  text: string;
  /** Where it was learned, in plain words */
  source: string;
  paused?: boolean;
}

export const sampleMemories: Memory[] = [
  { id: "m1", category: "about", text: "Goes by Maya; full name Maya Chen", source: "From your profile" },
  { id: "m2", category: "about", text: "Based in Lisbon, works Pacific hours on Tuesdays and Thursdays", source: "Chat on Oct 2" },
  { id: "m3", category: "work", text: "Product lead for Billing at Acme, reports to Devon Ruiz", source: "Chat on Sep 18" },
  { id: "m4", category: "work", text: "The team ships releases on Thursdays after the 10:00 PT standup", source: "Chat on Oct 9" },
  { id: "m5", category: "preferences", text: "Wants the recommendation first, then the reasoning, in under 150 words", source: "You asked on Sep 22" },
  { id: "m6", category: "preferences", text: "Writes in British English", source: "Noticed in 6 chats" },
  { id: "m7", category: "preferences", text: "Code examples in TypeScript, never JavaScript", source: "You asked on Oct 1" },
  { id: "m8", category: "projects", text: "Leading the 4.0 billing launch, go-live Thursday Nov 5", source: "Chat on Oct 20" },
  { id: "m9", category: "projects", text: "Moving invoices off Stripe Billing to the in-house ledger by Q1", source: "Chat on Aug 30", paused: true },
];

const CATEGORIES: Array<{ id: MemoryCategory; label: string; icon: IconName }> = [
  { id: "about", label: "About you", icon: "user" },
  { id: "work", label: "Work", icon: "users" },
  { id: "preferences", label: "Preferences", icon: "settings" },
  { id: "projects", label: "Projects", icon: "folder" },
];

export interface MemoryPanelProps {
  memories?: Memory[];
  /** Master switch starts on */
  defaultEnabled?: boolean;
  /** Seconds the Undo tray stays up after a memory is forgotten */
  undoSeconds?: number;
  onChange?: (memories: Memory[], enabled: boolean) => void;
  className?: string;
}

type Forgotten = { memory: Memory; index: number };

/**
 * What the assistant remembers about you, grouped and editable. A master switch turns memory off; filters narrow by
 * category; every memory can be edited in place, paused or forgotten. A paused memory is pushed down into the panel
 * rather than greyed out, and forgetting slides up a tray with Undo.
 */
export function MemoryPanel({
  memories: initial = sampleMemories,
  defaultEnabled = true,
  undoSeconds = 6,
  onChange,
  className,
}: MemoryPanelProps) {
  const [memories, setMemories] = useState(initial);
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [filter, setFilter] = useState<MemoryCategory | "all">("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [forgotten, setForgotten] = useState<Forgotten | null>(null);
  const trayTimer = useRef<number | undefined>(undefined);
  const switchId = useId();

  useEffect(() => () => window.clearTimeout(trayTimer.current), []);

  const update = (next: Memory[], on = enabled) => {
    setMemories(next);
    onChange?.(next, on);
  };

  const forget = (memory: Memory) => {
    const index = memories.findIndex((m) => m.id === memory.id);
    update(memories.filter((m) => m.id !== memory.id));
    setForgotten({ memory, index });
    window.clearTimeout(trayTimer.current);
    trayTimer.current = window.setTimeout(() => setForgotten(null), undoSeconds * 1000);
  };

  const undo = () => {
    if (!forgotten) return;
    const next = [...memories];
    next.splice(forgotten.index, 0, forgotten.memory);
    update(next);
    setForgotten(null);
    window.clearTimeout(trayTimer.current);
  };

  const count = (c: MemoryCategory | "all") => (c === "all" ? memories.length : memories.filter((m) => m.category === c).length);
  const groups = CATEGORIES.filter((c) => filter === "all" || c.id === filter)
    .map((c) => ({ ...c, items: memories.filter((m) => m.category === c.id) }))
    .filter((g) => g.items.length);

  return (
    <div className={cx("kb-root kb-mp kb-part", className)} data-enabled={enabled || undefined}>
      <header className="kb-mp-head">
        <div>
          <h3>Memory</h3>
          <p>
            {enabled
              ? `${memories.filter((m) => !m.paused).length} things the assistant uses to tailor its answers`
              : "Off. Nothing is used or saved until you turn it back on."}
          </p>
        </div>
        <label className="kb-mp-switch" htmlFor={switchId}>
          <span className="kb-sr">Use memory</span>
          <input
            id={switchId}
            type="checkbox"
            role="switch"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              onChange?.(memories, e.target.checked);
            }}
          />
          <span className="kb-mp-track" aria-hidden>
            <span className="kb-mp-thumb" />
          </span>
        </label>
      </header>

      <div className="kb-mp-filters" role="radiogroup" aria-label="Show">
        {(["all", ...CATEGORIES.map((c) => c.id)] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={filter === id}
            className="kb-mp-filter"
            onClick={() => setFilter(id)}
          >
            {id === "all" ? "All" : CATEGORIES.find((c) => c.id === id)?.label}
            <span className="kb-mp-n">
              <NumberRoll value={count(id)} />
            </span>
          </button>
        ))}
      </div>

      <div className="kb-mp-body" inert={!enabled || undefined}>
        {groups.length === 0 ? <p className="kb-mp-empty">No memories here yet.</p> : null}
        {groups.map((g) => (
          <section key={g.id} className="kb-mp-group" aria-label={g.label}>
            <h4>
              <Icon name={g.icon} size={14} />
              {g.label}
            </h4>
            <ul>
              {g.items.map((m) => (
                <MemoryRow
                  key={m.id}
                  memory={m}
                  editing={editing === m.id}
                  onEdit={() => setEditing(m.id)}
                  onSave={(text) => {
                    update(memories.map((x) => (x.id === m.id ? { ...x, text, source: "Edited by you just now" } : x)));
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                  onPause={() => update(memories.map((x) => (x.id === m.id ? { ...x, paused: !x.paused } : x)))}
                  onForget={() => forget(m)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="kb-mp-tray" data-open={forgotten ? true : undefined} role="status" aria-live="polite">
        {forgotten ? (
          <>
            <Icon name="trash" size={16} />
            <span className="kb-mp-tray-text">
              Forgot <q>{forgotten.memory.text}</q>
            </span>
            <Button size="sm" icon="undo" onClick={undo}>
              Undo
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function MemoryRow({
  memory,
  editing,
  onEdit,
  onSave,
  onCancel,
  onPause,
  onForget,
}: {
  memory: Memory;
  editing: boolean;
  onEdit: () => void;
  onSave: (text: string) => void;
  onCancel: () => void;
  onPause: () => void;
  onForget: () => void;
}) {
  const [draft, setDraft] = useState(memory.text);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (editing) {
      setDraft(memory.text);
      requestAnimationFrame(() => {
        fieldRef.current?.focus();
        fieldRef.current?.select();
      });
    } else if (wasEditing.current) {
      editRef.current?.focus();
    }
    wasEditing.current = editing;
  }, [editing, memory.text]);

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (draft.trim()) onSave(draft.trim());
    }
    if (event.key === "Escape") onCancel();
  };

  return (
    <li className="kb-mp-row" data-paused={memory.paused || undefined} data-editing={editing || undefined}>
      {editing ? (
        <div className="kb-mp-edit">
          <textarea
            ref={fieldRef}
            value={draft}
            rows={2}
            aria-label="Edit memory"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
          />
          <div className="kb-mp-edit-bar">
            <span>Enter saves, Esc cancels</span>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={() => draft.trim() && onSave(draft.trim())}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="kb-mp-text">
            <span>{memory.text}</span>
            <small>{memory.paused ? "Paused, not used in answers" : memory.source}</small>
          </div>
          <div className="kb-mp-tools">
            <button ref={editRef} type="button" className="kb-mp-tool" onClick={onEdit} aria-label={`Edit: ${memory.text}`} title="Edit">
              <Icon name="edit" size={15} />
            </button>
            <button
              type="button"
              className="kb-mp-tool"
              onClick={onPause}
              aria-pressed={!!memory.paused}
              aria-label={memory.paused ? `Resume: ${memory.text}` : `Pause: ${memory.text}`}
              title={memory.paused ? "Resume" : "Pause"}
            >
              <Icon name={memory.paused ? "play" : "pause"} size={15} />
            </button>
            <button type="button" className="kb-mp-tool" data-kind="forget" onClick={onForget} aria-label={`Forget: ${memory.text}`} title="Forget">
              <Icon name="trash" size={15} />
            </button>
          </div>
        </>
      )}
    </li>
  );
}
