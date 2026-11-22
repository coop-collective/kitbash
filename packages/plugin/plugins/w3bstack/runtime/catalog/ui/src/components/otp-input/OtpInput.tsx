"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cx, Icon, Spinner, useInterval, useReducedMotion } from "../../shared/index.ts";
import "./otp-input.css";

/* Cell geometry, mirrored in otp-input.css so the ring can glide to an exact offset */
const CELL = 46;
const GAP = 8;
const SPLIT = 14;

export type OtpState = "idle" | "verifying" | "error" | "verified";

export interface OtpInputProps {
  /** Number of digits */
  length?: number;
  label?: string;
  /** Where the code was sent, shown in the hint */
  destination?: string;
  /** Checks a complete code. Resolve true to verify. Defaults to matching `demoCode`. */
  onVerify?: (code: string) => boolean | Promise<boolean>;
  /** The code the default verifier accepts */
  demoCode?: string;
  /** Wrong attempts allowed before the field locks */
  attempts?: number;
  /** Seconds before "Send a new code" unlocks */
  resendAfter?: number;
  /** Start in a given state (for docs) */
  initialState?: OtpState;
  initialValue?: string;
  autoFocus?: boolean;
  onVerified?: (code: string) => void;
  className?: string;
}

/**
 * Verification code field. One real input (so paste, SMS autofill and screen readers all work) drawn as
 * recessed cells with a single focus ring that glides to the next empty cell. A wrong code shakes once and
 * clears; a right one fuses the cells into one cured part.
 */
export function OtpInput({
  length = 6,
  label = "Verification code",
  destination = "+1 (415) 555-0142",
  onVerify,
  demoCode = "428916",
  attempts = 3,
  resendAfter = 30,
  initialState = "idle",
  initialValue = "",
  autoFocus = false,
  onVerified,
  className,
}: OtpInputProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const reduced = useReducedMotion();
  const [value, setValue] = useState(initialValue.slice(0, length));
  const [state, setState] = useState<OtpState>(initialState);
  const [focused, setFocused] = useState(false);
  const [left, setLeft] = useState(attempts);
  const [shakeKey, setShakeKey] = useState(0);
  const [cooldown, setCooldown] = useState(resendAfter);
  const [notice, setNotice] = useState("");

  useInterval(() => setCooldown((c) => Math.max(0, c - 1)), cooldown > 0 && state !== "verified" ? 1000 : null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const locked = left <= 0;
  const busy = state === "verifying" || state === "verified" || locked;

  async function verify(code: string) {
    setState("verifying");
    setNotice("Checking code");
    const check = onVerify ?? ((c: string) => new Promise<boolean>((r) => window.setTimeout(() => r(c === demoCode), 700)));
    const ok = await check(code);
    if (ok) {
      setState("verified");
      setNotice("Code verified");
      onVerified?.(code);
      return;
    }
    const remaining = left - 1;
    setLeft(remaining);
    setState("error");
    setShakeKey((k) => k + 1);
    setNotice(remaining > 0 ? `That code didn't match. ${remaining} ${remaining === 1 ? "try" : "tries"} left.` : "Too many tries. Send a new code.");
    // Keep the wrong digits visible for a beat, then clear for the next attempt
    window.setTimeout(() => {
      setValue("");
      inputRef.current?.focus();
    }, reduced ? 0 : 520);
  }

  function onChange(raw: string) {
    if (busy) return;
    const digits = raw.replace(/\D/g, "").slice(0, length);
    setValue(digits);
    if (state === "error") setState("idle");
    if (digits.length === length) void verify(digits);
  }

  function resend() {
    setCooldown(resendAfter);
    setLeft(attempts);
    setValue("");
    setState("idle");
    setNotice(`New code sent to ${destination}`);
    inputRef.current?.focus();
  }

  const active = Math.min(value.length, length - 1);
  const half = Math.ceil(length / 2);
  const hintId = `${id}-hint`;
  const msgId = `${id}-msg`;

  return (
    <div className={cx("kb-root kb-otp", className)} data-state={state}>
      <label className="kb-otp-label" htmlFor={id}>{label}</label>
      <p className="kb-otp-hint" id={hintId}>
        Enter the {length}-digit code we sent to <strong>{destination}</strong>.
      </p>

      <div
        className="kb-otp-field"
        data-focused={focused || undefined}
        style={{ ["--otp-x" as string]: `${active * (CELL + GAP) + (active >= half ? SPLIT : 0)}px` }}
        onMouseDown={(e) => {
          // Clicking any cell focuses the one real input
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <input
          ref={inputRef}
          id={id}
          className="kb-otp-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={length}
          readOnly={busy}
          aria-invalid={state === "error" || undefined}
          aria-describedby={`${hintId} ${msgId}`}
          spellCheck={false}
        />
        {/* Keyed so each wrong attempt replays the shake; the input stays mounted and keeps focus */}
        <div key={shakeKey} className="kb-otp-cells" data-shake={state === "error" && !reduced ? "" : undefined} aria-hidden>
          {Array.from({ length }, (_, i) => {
            const char = value[i];
            return (
              <span key={i} className={cx("kb-otp-cell", i === half - 1 && "kb-otp-cell-split")} data-filled={char ? "" : undefined}>
                {char ? <span className="kb-otp-digit">{char}</span> : null}
              </span>
            );
          })}
          <span className="kb-otp-ring" />
          <span className="kb-otp-verified">
            <Icon name="check" size={18} strokeWidth={2.25} />
            Verified
          </span>
        </div>
      </div>

      <div className="kb-otp-foot">
        <p className="kb-otp-msg" id={msgId} role="status" data-tone={state === "error" || locked ? "danger" : state === "verified" ? "ok" : undefined}>
          {state === "verifying" ? (
            <>
              <Spinner size={12} label="Checking code" /> Checking code
            </>
          ) : state === "error" || locked ? (
            notice
          ) : state === "verified" ? (
            "You're signed in on this device."
          ) : notice ? (
            notice
          ) : (
            "Paste works too, or let your phone fill it in."
          )}
        </p>
        {state !== "verified" ? (
          <button type="button" className="kb-otp-resend" onClick={resend} disabled={cooldown > 0 && !locked}>
            {cooldown > 0 && !locked ? `Send a new code in 0:${String(cooldown).padStart(2, "0")}` : "Send a new code"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
