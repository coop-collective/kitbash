import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx.ts";
import "./shared.css";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Odometer number: every digit rolls to its new value at its natural width. Non-digits (commas, $, %) render statically. */
export function NumberRoll({ value, className }: { value: string | number; className?: string }) {
  const text = String(value);
  return (
    <span className={cx("kb-roll", className)} aria-label={text} role="text">
      {[...text].map((char, i) => {
        const digit = DIGITS.indexOf(char);
        if (digit < 0) return <span key={`s${i}`} aria-hidden>{char}</span>;
        return (
          <span key={text.length - i} className="kb-roll-digit" aria-hidden>
            {/* An invisible copy of the current digit sizes the slot, so figures keep their natural widths */}
            <span className="kb-roll-size">{char}</span>
            <span className="kb-roll-strip" style={{ transform: `translateY(-${digit}em)` }}>
              {DIGITS.map((d) => <span key={d}>{d}</span>)}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** The eight-ray Styrene spinner. */
export function Spinner({ size = 14, label = "Working" }: { size?: number; label?: string }) {
  return (
    <span className="kb-spinner" style={{ width: size, height: size }} role="status" aria-label={label}>
      {Array.from({ length: 8 }, (_, i) => (
        <i key={i} style={{ transform: `rotate(${i * 45}deg)`, animationDelay: `${(i - 8) * 0.1}s` }} />
      ))}
    </span>
  );
}

/** Text with a moving light sweep, for "Thinking…" style labels. */
export function Shimmer({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("kb-shimmer", className)}>{children}</span>;
}

const AVATAR_COLORS = ["#3b3fd6", "#23885c", "#c2571a", "#1f7fb8", "#8a3fd6", "#b8325a", "#4d6b1f"];

/** Initials avatar; color is derived from the name so it is stable. */
export function Avatar({ name, size = 24, src }: { name: string; size?: number; src?: string }) {
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: size * 0.4,
    background: src ? `center / cover url(${src})` : AVATAR_COLORS[hash % AVATAR_COLORS.length],
  };
  return <span className="kb-avatar" style={style} title={name}>{src ? null : initials}</span>;
}

export type Tone = "neutral" | "accent" | "agent" | "decal" | "ok" | "danger" | "info";

/** Status pill. `live` makes the dot breathe. */
export function Tag({ tone = "neutral", dot, live, children }: { tone?: Tone; dot?: boolean; live?: boolean; children: ReactNode }) {
  return (
    <span className="kb-tag" data-tone={tone} data-live={live || undefined}>
      {live || dot !== false ? <span className="kb-tag-dot" /> : null}
      {children}
    </span>
  );
}
