"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { EmptyState } from "../empty-state/EmptyState.tsx";
import { ErrorState } from "../error-state/ErrorState.tsx";
import { Skeleton, SkeletonRegion } from "../skeleton/Skeleton.tsx";
import { cx, Icon } from "../../shared/index.ts";
import "./reaction-picker.css";

export interface ReactionUser {
  id: string;
  name: string;
}

export interface Reaction {
  /** The Unicode emoji, skin tone included */
  emoji: string;
  by: ReactionUser[];
}

export interface EmojiEntry {
  emoji: string;
  /** Short name, also the shortcode: "eyes" reads as :eyes: */
  name: string;
  keywords?: string[];
  /** Takes a skin tone modifier */
  tones?: boolean;
}

export interface EmojiGroup {
  id: string;
  label: string;
  emojis: EmojiEntry[];
}

/** 0 is the default yellow; 1 to 5 are the Fitzpatrick modifiers, light to dark */
export type SkinTone = 0 | 1 | 2 | 3 | 4 | 5;

export interface ReactionPickerProps {
  /** Reactions on the message. Controlled when given with onChange */
  reactions?: Reaction[];
  onChange?: (reactions: Reaction[], change: { emoji: string; added: boolean }) => void;
  /** Who "you" are; your own reactions latch in */
  me?: ReactionUser;
  /** Emoji shown first in the popover */
  frequent?: string[];
  groups?: EmojiGroup[];
  /** Popover open state; uncontrolled when omitted */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  skinTone?: SkinTone;
  defaultSkinTone?: SkinTone;
  onSkinToneChange?: (tone: SkinTone) => void;
  /** Open the popover above the chips, e.g. near the bottom of a scrolling thread */
  placement?: "bottom" | "top";
  /** Hide the add key, e.g. when the host opens the popover from its own action */
  hideAdd?: boolean;
  /** Draws chip placeholders while reactions load */
  loading?: boolean;
  /** The emoji set failed to load; the popover explains and offers a retry */
  error?: string;
  onRetry?: () => void;
  className?: string;
}

export const demoMe: ReactionUser = { id: "u-you", name: "You" };

export const demoReactions: Reaction[] = [
  { emoji: "👀", by: [{ id: "u-priya", name: "Priya Raman" }, { id: "a-atlas", name: "Atlas" }, demoMe] },
  { emoji: "✅", by: [{ id: "u-devon", name: "Devon Okafor" }] },
  { emoji: "🚀", by: [{ id: "u-priya", name: "Priya Raman" }, { id: "u-marta", name: "Marta Silva" }, { id: "u-devon", name: "Devon Okafor" }, { id: "u-jun", name: "Jun Park" }] },
  { emoji: "👍🏽", by: [{ id: "u-marta", name: "Marta Silva" }] },
];

export const demoFrequent = ["👍", "👀", "✅", "🎉", "🙏", "🔥", "😂", "🚀"];

const e = (emoji: string, name: string, keywords: string[] = [], tones = false): EmojiEntry => ({ emoji, name, keywords, tones });

export const demoEmojiGroups: EmojiGroup[] = [
  {
    id: "smileys",
    label: "Smileys",
    emojis: [
      e("😀", "grinning", ["happy", "smile"]), e("😂", "joy", ["laugh", "lol", "tears"]), e("🙂", "slight_smile", ["ok"]), e("😉", "wink"),
      e("😍", "heart_eyes", ["love"]), e("🤔", "thinking", ["hmm", "consider"]), e("😎", "sunglasses", ["cool", "nailed it"]), e("😅", "sweat_smile", ["phew", "close call"]),
      e("😬", "grimacing", ["yikes", "awkward"]), e("🙃", "upside_down", ["sarcasm"]), e("😮", "open_mouth", ["wow", "surprised"]), e("😴", "sleeping", ["tired", "zzz"]),
      e("🤯", "exploding_head", ["mind blown"]), e("🥲", "smiling_tear", ["bittersweet"]), e("😭", "sob", ["cry"]), e("😤", "triumph", ["determined", "huff"]),
    ],
  },
  {
    id: "people",
    label: "Hands and people",
    emojis: [
      e("👍", "thumbsup", ["yes", "+1", "approve", "like"], true), e("👎", "thumbsdown", ["no", "-1"], true), e("👏", "clap", ["applause", "bravo"], true), e("🙌", "raised_hands", ["hooray", "celebrate"], true),
      e("👋", "wave", ["hello", "hi", "bye"], true), e("🙏", "pray", ["thanks", "please"], true), e("💪", "muscle", ["strong"], true), e("👌", "ok_hand", ["perfect"], true),
      e("🤞", "crossed_fingers", ["luck", "hope"], true), e("✋", "raised_hand", ["stop", "me"], true), e("👉", "point_right", ["this"], true), e("🤙", "call_me", ["shaka", "chill"], true),
      e("🤝", "handshake", ["deal", "agree"]), e("👀", "eyes", ["looking", "watching", "review"]), e("🧠", "brain", ["smart", "think"]), e("🤖", "robot", ["agent", "bot", "ai"]),
    ],
  },
  {
    id: "nature",
    label: "Nature and food",
    emojis: [
      e("🔥", "fire", ["hot", "lit"]), e("🌱", "seedling", ["new", "grow"]), e("🌊", "wave_water", ["ocean"]), e("⚡", "zap", ["fast", "lightning"]),
      e("🌈", "rainbow"), e("🐛", "bug", ["issue", "defect"]), e("🦄", "unicorn", ["rare"]), e("🐢", "turtle", ["slow"]),
      e("☕", "coffee", ["break"]), e("🍕", "pizza", ["lunch"]), e("🍩", "doughnut", ["treat"]), e("🌮", "taco"),
    ],
  },
  {
    id: "objects",
    label: "Objects",
    emojis: [
      e("🎉", "tada", ["party", "congrats", "ship"]), e("🚀", "rocket", ["launch", "ship", "deploy"]), e("💡", "bulb", ["idea"]), e("📌", "pushpin", ["pin"]),
      e("📎", "paperclip", ["attach"]), e("🔒", "lock", ["secure", "private"]), e("🧪", "test_tube", ["test", "experiment"]), e("🛠️", "tools", ["fix", "build"]),
      e("📈", "chart_up", ["growth", "metrics"]), e("📉", "chart_down", ["drop"]), e("🧾", "receipt", ["invoice", "billing"]), e("⏳", "hourglass", ["waiting", "soon"]),
    ],
  },
  {
    id: "symbols",
    label: "Symbols",
    emojis: [
      e("✅", "white_check_mark", ["done", "yes", "approved"]), e("❌", "x", ["no", "wrong", "reject"]), e("❗", "exclamation", ["important"]), e("❓", "question", ["unclear"]),
      e("➕", "plus", ["add", "+1"]), e("💯", "100", ["perfect", "agree"]), e("❤️", "heart", ["love", "thanks"]), e("💜", "purple_heart"),
      e("⚠️", "warning", ["careful", "risk"]), e("🔁", "repeat", ["retry", "again"]), e("🆗", "ok"), e("🆕", "new"),
    ],
  },
];

/** Paint-pot swatches for the tone key; hex lives in data, like avatar colors */
const TONES: Array<{ tone: SkinTone; label: string; swatch: string; modifier: string }> = [
  { tone: 0, label: "Default", swatch: "#f6c64a", modifier: "" },
  { tone: 1, label: "Light", swatch: "#f7dbc4", modifier: "\u{1F3FB}" },
  { tone: 2, label: "Medium light", swatch: "#e5bc94", modifier: "\u{1F3FC}" },
  { tone: 3, label: "Medium", swatch: "#bf8f68", modifier: "\u{1F3FD}" },
  { tone: 4, label: "Medium dark", swatch: "#9b643d", modifier: "\u{1F3FE}" },
  { tone: 5, label: "Dark", swatch: "#5e4232", modifier: "\u{1F3FF}" },
];

const MODIFIERS = /[\u{1F3FB}-\u{1F3FF}]/gu;
const COLS = 8;

/** The emoji with its tone modifier removed, for lookups */
export function baseEmoji(emoji: string): string {
  return emoji.replace(MODIFIERS, "");
}

/** Applies a skin tone to an emoji that takes one */
export function withTone(entry: EmojiEntry, tone: SkinTone): string {
  const mod = TONES[tone]?.modifier ?? "";
  if (!entry.tones || !mod) return entry.emoji;
  return entry.emoji.replace(/️/g, "") + mod;
}

/** "Priya Raman, Atlas and you" */
function whoReacted(by: ReactionUser[], me: ReactionUser): string {
  const names = [...by.filter((u) => u.id !== me.id).map((u) => u.name), ...(by.some((u) => u.id === me.id) ? ["you"] : [])];
  if (names.length <= 1) return names[0] ?? "";
  if (names.length > 4) return `${names.slice(0, 3).join(", ")} and ${names.length - 3} others`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Toggles your reaction with an emoji in a list of reactions */
export function toggleReaction(reactions: Reaction[], emoji: string, me: ReactionUser): { next: Reaction[]; added: boolean } {
  const existing = reactions.find((r) => r.emoji === emoji);
  if (!existing) return { next: [...reactions, { emoji, by: [me] }], added: true };
  const mine = existing.by.some((u) => u.id === me.id);
  const by = mine ? existing.by.filter((u) => u.id !== me.id) : [...existing.by, me];
  return { next: reactions.map((r) => (r.emoji === emoji ? { ...r, by } : r)).filter((r) => r.by.length > 0), added: !mine };
}

/**
 * Reactions on a message as latching count keys, and the popover that adds one. Your own reactions stay pressed in
 * like a latched switch; hover or focus a key to see who reacted. The popover is a parts tray: a frequent row, a
 * searchable grid you walk with the arrow keys, and paint-pot swatches for skin tone.
 */
export function ReactionPicker({
  reactions: reactionsProp,
  onChange,
  me = demoMe,
  frequent = demoFrequent,
  groups = demoEmojiGroups,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  skinTone: toneProp,
  defaultSkinTone = 0,
  onSkinToneChange,
  placement = "bottom",
  hideAdd = false,
  loading = false,
  error,
  onRetry,
  className,
}: ReactionPickerProps) {
  const uid = useId();
  const [ownReactions, setOwnReactions] = useState<Reaction[]>(reactionsProp ?? demoReactions);
  const reactions = reactionsProp && onChange ? reactionsProp : ownReactions;
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const open = openProp ?? ownOpen;
  const [ownTone, setOwnTone] = useState<SkinTone>(defaultSkinTone);
  const tone = toneProp ?? ownTone;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [toneOpen, setToneOpen] = useState(false);
  const [tip, setTip] = useState<string | null>(null);
  const [say, setSay] = useState("");

  const rootRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Keep an uncontrolled copy in step when the host swaps the message
  useEffect(() => {
    if (reactionsProp && !onChange) setOwnReactions(reactionsProp);
  }, [reactionsProp, onChange]);

  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOwnOpen(next);
    onOpenChange?.(next);
    if (!next) {
      setQuery("");
      setToneOpen(false);
    }
  };

  const setTone = (t: SkinTone) => {
    if (toneProp === undefined) setOwnTone(t);
    onSkinToneChange?.(t);
  };

  const byEmoji = useMemo(() => {
    const map = new Map<string, EmojiEntry>();
    groups.forEach((g) => g.emojis.forEach((x) => map.set(baseEmoji(x.emoji).replace(/️/g, ""), x)));
    return map;
  }, [groups]);
  const lookup = (emoji: string) => byEmoji.get(baseEmoji(emoji).replace(/️/g, ""));
  const nameOf = (emoji: string) => lookup(emoji)?.name ?? "emoji";

  // Sections shown in the tray: frequent first, or one results section while searching
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^:|:$/g, "");
    if (q) {
      const all = groups.flatMap((g) => g.emojis);
      const hits = all.filter((x) => x.name.includes(q) || (x.keywords ?? []).some((k) => k.includes(q)));
      return [{ id: "results", label: `Results for "${query.trim()}"`, emojis: hits }];
    }
    const freq = frequent.map((f) => lookup(f) ?? { emoji: f, name: "emoji" });
    return [{ id: "frequent", label: "Frequently used", emojis: freq }, ...groups];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, groups, frequent, byEmoji]);

  const flat = sections.flatMap((s) => s.emojis);
  // Rows of flat indices, so the arrow keys walk the grid across section breaks
  const rows: number[][] = [];
  let at = 0;
  for (const s of sections) {
    for (let i = 0; i < s.emojis.length; i += COLS) {
      rows.push(Array.from({ length: Math.min(COLS, s.emojis.length - i) }, (_, k) => at + i + k));
    }
    at += s.emojis.length;
  }
  const safeActive = Math.min(active, Math.max(0, flat.length - 1));
  const activeEntry = flat[safeActive];

  useEffect(() => setActive(0), [query]);

  // Focus the search when the tray opens; close on a press outside it
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onDown = (ev: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the active cell in view
  useEffect(() => {
    if (!open) return;
    const cell = gridRef.current?.querySelector<HTMLElement>(`[data-index="${safeActive}"]`);
    cell?.scrollIntoView({ block: "nearest" });
  }, [safeActive, open]);

  const react = (emoji: string) => {
    const { next, added } = toggleReaction(reactions, emoji, me);
    if (!(reactionsProp && onChange)) setOwnReactions(next);
    onChange?.(next, { emoji, added });
    setSay(`${added ? "Reacted" : "Removed your reaction"} with ${nameOf(emoji)}`);
  };

  const pick = (entry: EmojiEntry) => {
    react(withTone(entry, tone));
    setOpen(false);
    addRef.current?.focus();
  };

  const onSearchKey = (ev: ReactKeyboardEvent) => {
    const r = rows.findIndex((row) => row.includes(safeActive));
    const c = rows[r]?.indexOf(safeActive) ?? 0;
    const go = (row: number, col: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, row))];
      if (target) setActive(target[Math.min(col, target.length - 1)] ?? 0);
    };
    if (ev.key === "ArrowRight") { ev.preventDefault(); setActive(Math.min(flat.length - 1, safeActive + 1)); }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); setActive(Math.max(0, safeActive - 1)); }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); go(r + 1, c); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); go(r - 1, c); }
    else if (ev.key === "PageDown") { ev.preventDefault(); go(r + 4, c); }
    else if (ev.key === "PageUp") { ev.preventDefault(); go(r - 4, c); }
    else if (ev.key === "Enter") { ev.preventDefault(); if (activeEntry) pick(activeEntry); }
  };

  const onRootKey = (ev: ReactKeyboardEvent) => {
    if (ev.key === "Escape" && open) {
      ev.stopPropagation();
      if (toneOpen) setToneOpen(false);
      else {
        setOpen(false);
        addRef.current?.focus();
      }
    }
  };

  if (loading) {
    return (
      <SkeletonRegion label="Loading reactions" className={cx("kb-rp", className)}>
        <div className="kb-rp-chips">
          <Skeleton width={52} height={28} radius="control" />
          <Skeleton width={44} height={28} radius="control" />
          <Skeleton width={52} height={28} radius="control" />
          <Skeleton width={34} height={28} radius="control" />
        </div>
      </SkeletonRegion>
    );
  }

  const gridId = `${uid}-grid`;
  const cellId = (i: number) => `${uid}-cell-${i}`;
  const toneSample = withTone({ emoji: "✋", name: "raised_hand", tones: true }, tone);

  return (
    <div ref={rootRef} className={cx("kb-rp", className)} onKeyDown={onRootKey}>
      <ul className="kb-rp-chips" aria-label="Reactions">
        {reactions.map((r) => {
          const mine = r.by.some((u) => u.id === me.id);
          const tipId = `${uid}-tip-${r.emoji}`;
          const who = whoReacted(r.by, me);
          return (
            <li key={r.emoji} className="kb-rp-chip-wrap">
              <button
                type="button"
                className="kb-rp-chip"
                aria-pressed={mine}
                aria-label={`${nameOf(r.emoji)}, ${r.by.length}`}
                aria-describedby={tip === r.emoji ? tipId : undefined}
                onClick={() => react(r.emoji)}
                onPointerEnter={() => setTip(r.emoji)}
                onPointerLeave={() => setTip((t) => (t === r.emoji ? null : t))}
                onFocus={() => setTip(r.emoji)}
                onBlur={() => setTip((t) => (t === r.emoji ? null : t))}
              >
                <span className="kb-rp-glyph" aria-hidden>{r.emoji}</span>
                <span className="kb-rp-count">{r.by.length}</span>
              </button>
              {tip === r.emoji ? (
                <span className="kb-rp-tip" role="tooltip" id={tipId} data-place={placement}>
                  <span className="kb-rp-tip-glyph" aria-hidden>{r.emoji}</span>
                  <span>
                    <strong>{who}</strong> reacted with <code>:{nameOf(r.emoji)}:</code>
                  </span>
                </span>
              ) : null}
            </li>
          );
        })}
        {hideAdd ? null : (
          <li>
            <button
              ref={addRef}
              type="button"
              className="kb-rp-add"
              aria-label="Add reaction"
              aria-haspopup="dialog"
              aria-expanded={open}
              data-open={open || undefined}
              onClick={() => setOpen(!open)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                <path d="M20.6 12.9a8.6 8.6 0 1 1-9.5-9.5" />
                <path d="M8.5 14.5a4.2 4.2 0 0 0 7 0M9 9.5h.01M15 9.5h.01M19 2.5v6M16 5.5h6" />
              </svg>
            </button>
          </li>
        )}
      </ul>

      {open ? (
        <div className="kb-rp-pop" role="dialog" aria-label="Add a reaction" data-place={placement}>
          {error ? (
            <ErrorState size="sm" title="Couldn't load emoji" body={error} detail="" onRetry={onRetry} />
          ) : (
            <>
              <div className="kb-rp-head">
                <label className="kb-rp-search">
                  <Icon name="search" size={15} />
                  <span className="kb-sr">Search reactions</span>
                  <input
                    ref={searchRef}
                    type="text"
                    role="combobox"
                    aria-expanded="true"
                    aria-controls={gridId}
                    aria-haspopup="grid"
                    aria-activedescendant={activeEntry ? cellId(safeActive) : undefined}
                    aria-autocomplete="list"
                    placeholder="Search, e.g. ship"
                    value={query}
                    onChange={(ev) => setQuery(ev.target.value)}
                    onKeyDown={onSearchKey}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </label>
                <button
                  type="button"
                  className="kb-rp-tone-key"
                  aria-label={`Skin tone: ${TONES[tone]?.label ?? "Default"}`}
                  aria-expanded={toneOpen}
                  onClick={() => setToneOpen((v) => !v)}
                >
                  <span aria-hidden>{toneSample}</span>
                </button>
              </div>

              {toneOpen ? (
                <div className="kb-rp-tones" role="radiogroup" aria-label="Skin tone">
                  {TONES.map((t) => (
                    <button
                      key={t.tone}
                      type="button"
                      role="radio"
                      aria-checked={tone === t.tone}
                      aria-label={t.label}
                      title={t.label}
                      className="kb-rp-pot"
                      style={{ background: t.swatch }}
                      tabIndex={tone === t.tone ? 0 : -1}
                      onClick={() => {
                        setTone(t.tone);
                        setToneOpen(false);
                        searchRef.current?.focus();
                      }}
                      onKeyDown={(ev) => {
                        const dir = ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1 : ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 0;
                        if (!dir) return;
                        ev.preventDefault();
                        const next = ((t.tone + dir + TONES.length) % TONES.length) as SkinTone;
                        setTone(next);
                        (ev.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
                      }}
                    />
                  ))}
                  <span className="kb-rp-tones-label">{TONES[tone]?.label} tone</span>
                </div>
              ) : null}

              <div ref={gridRef} className="kb-rp-tray" id={gridId} role="grid" aria-label="Emoji" aria-readonly="true">
                {flat.length === 0 ? (
                  <EmptyState size="sm" title={`No reactions match "${query.trim()}"`} body="Try a feeling or an object, like thanks or ship." action={undefined} />
                ) : (
                  sections.map((s, si) => {
                    const offset = sections.slice(0, si).reduce((n, x) => n + x.emojis.length, 0);
                    return (
                      <div key={s.id} role="rowgroup" aria-label={s.label} className="kb-rp-section">
                        <p className="kb-rp-section-label" aria-hidden>{s.label}</p>
                        {Array.from({ length: Math.ceil(s.emojis.length / COLS) }, (_, ri) => (
                          <div key={ri} role="row" className="kb-rp-row">
                            {s.emojis.slice(ri * COLS, ri * COLS + COLS).map((x, ci) => {
                              const i = offset + ri * COLS + ci;
                              const glyph = withTone(x, tone);
                              const mine = reactions.some((r) => r.emoji === glyph && r.by.some((u) => u.id === me.id));
                              return (
                                <span
                                  key={`${s.id}-${x.name}`}
                                  id={cellId(i)}
                                  role="gridcell"
                                  aria-label={x.name.replace(/_/g, " ")}
                                  aria-selected={i === safeActive}
                                  data-index={i}
                                  data-active={i === safeActive || undefined}
                                  data-mine={mine || undefined}
                                  className="kb-rp-cell"
                                  onPointerEnter={() => setActive(i)}
                                  onPointerDown={(ev) => ev.preventDefault()}
                                  onClick={() => pick(x)}
                                >
                                  {glyph}
                                </span>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="kb-rp-foot" aria-hidden>
                {activeEntry ? (
                  <>
                    <span className="kb-rp-foot-glyph">{withTone(activeEntry, tone)}</span>
                    <code>:{activeEntry.name}:</code>
                    <span className="kb-rp-hint">Enter to react</span>
                  </>
                ) : (
                  <span className="kb-rp-hint">Arrow keys move, Enter reacts</span>
                )}
              </div>
            </>
          )}
        </div>
      ) : null}
      <p className="kb-sr" aria-live="polite">{say}</p>
    </div>
  );
}
