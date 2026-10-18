/**
 * The CLI's environment (injected, so tests run in-process with a mocked fetch and temp dirs) and the output
 * helpers. Everything a block author wrote is printed only through `untrusted()`, sanitized and fenced.
 */
import { UNTRUSTED_NOTICE } from "@kitbash/core";
import type { Runner } from "./verify.ts";

export interface Io {
  cwd: string;
  env: Record<string, string | undefined>;
  /** The user's home (for `~/.kit`); `KIT_HOME` overrides the `.kit` directory itself. */
  home: string;
  fetch: typeof fetch;
  out(s: string): void;
  err(s: string): void;
  /** Reads a pasted token (kit login). */
  readStdin(): Promise<string>;
  /** ISO time, injectable for deterministic tests. */
  now(): string;
  /** Runs one allowlisted verify command (argv, never a shell). */
  runner: Runner;
  platform: NodeJS.Platform;
}

// C0/C1 controls except \n and \t, ANSI escapes, bidi controls, zero-width and invisible characters, tag characters,
// variation-selector supplement and private use: an author must not be able to restyle the terminal, hide text or
// fake the end of the untrusted fence.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)?|\u001b[@-_]/g;
// eslint-disable-next-line no-control-regex
const HIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f­؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￰-￻]|[\u{e0000}-\u{e007f}]|[\u{e0100}-\u{e01ef}]|[\u{f0000}-\u{10ffff}]|[-]/gu;

/** Makes text safe to print: escapes and invisible characters become visible `\u{…}` markers. */
export function sanitize(s: unknown): string {
  const t = typeof s === "string" ? s : String(s);
  return t.replace(ANSI, (m) => `\\u{1b}${JSON.stringify(m.slice(1)).slice(1, -1)}`).replace(HIDDEN, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`);
}

/** One-line variant (newlines become spaces). */
export function sanitizeLine(s: unknown, max = 300): string {
  const t = sanitize(s).replace(/[\r\n]+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export const UNTRUSTED_BEGIN = "┌─ UNTRUSTED AUTHOR TEXT ─";
export const UNTRUSTED_END = "└─ end of untrusted author text ─";

/**
 * Fences author text: a header with the notice, every line prefixed with `│ ` (so the text can't print a fake end
 * marker at column 0), and a footer.
 */
export function untrusted(lines: string[]): string {
  const body = lines.flatMap((l) => sanitize(l).split(/\r?\n/)).map((l) => `│ ${l}`);
  return [`${UNTRUSTED_BEGIN} ${UNTRUSTED_NOTICE}`, ...body, UNTRUSTED_END].join("\n");
}

/** Renders an `untrusted_author_text` envelope (or any object of author strings) as fenced lines. */
export function untrustedEnvelope(u: Record<string, unknown> | undefined): string | null {
  if (!u) return null;
  const lines: string[] = [];
  const add = (label: string, v: unknown) => {
    if (v === undefined || v === null || v === "") return;
    if (Array.isArray(v)) {
      if (!v.length) return;
      lines.push(`${label}:`);
      for (const x of v) {
        if (x && typeof x === "object") {
          const o = x as Record<string, unknown>;
          lines.push(`  - [${o.required ? "required" : "optional"}] ${o.id ?? ""}: ${o.title ?? ""}`);
          for (const k of ["where", "do", "check"]) if (o[k] !== undefined) lines.push(`      ${k}: ${o[k]}`);
        } else lines.push(`  - ${x}`);
      }
      return;
    }
    const s = String(v);
    if (s.includes("\n")) lines.push(`${label}:`, ...s.split("\n").map((l) => `  ${l}`));
    else lines.push(`${label}: ${s}`);
  };
  for (const [k, v] of Object.entries(u)) if (k !== "notice") add(k, v);
  return lines.length ? untrusted(lines) : null;
}

export function json(io: Io, value: unknown): void {
  io.out(`${JSON.stringify(value, null, 2)}\n`);
}

export function line(io: Io, s = ""): void {
  io.out(`${s}\n`);
}
