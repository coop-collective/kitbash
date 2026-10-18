/**
 * Declared config merges (BLOCK-SPEC §5): `jsonc-deep`, `json-merge-patch`, `append-missing-lines`.
 *
 * Rules shared by all merges: they only ADD. A key the project already has keeps the project's value (a differing
 * value is a warning naming the path); a patch that would remove a key (a `null` in a merge patch) or change a
 * value's type is a conflict and is not applied. Comments and formatting of the project's file are preserved
 * (edits go through jsonc-parser's `modify`).
 *
 * `jsonc-deep` unions arrays: arrays of objects by their identity key (`binding`, then `name`, `id`, `pattern`,
 * `class_name`, `queue`), arrays of scalars by value.
 */
import * as jsonc from "jsonc-parser";
import { parseJsonc } from "./profile.ts";

export interface MergeConflict {
  name: string;
  detail: string;
}

export interface MergeResult {
  text: string;
  changed: boolean;
  warnings: string[];
  conflicts: MergeConflict[];
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Path = (string | number)[];

const ID_KEYS = ["binding", "name", "id", "pattern", "class_name", "queue"];

/** Top-level keys a block may never add to a wrangler config: `build` runs shell commands on `wrangler dev`. */
export const WRANGLER_FORBIDDEN_KEYS = ["build"];

function isObj(v: unknown): v is Record<string, Json> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function identity(v: unknown): string | undefined {
  if (!isObj(v)) return undefined;
  for (const k of ID_KEYS) if (typeof v[k] === "string") return `${k}=${v[k]}`;
  return undefined;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function fmtPath(p: Path): string {
  return p.map((x) => (typeof x === "number" ? `[${x}]` : `.${x}`)).join("").replace(/^\./, "");
}

export function detectFormatting(text: string): jsonc.FormattingOptions {
  const m = /\n([ \t]+)["/]/.exec(text);
  const indent = m ? m[1]! : "  ";
  const tabs = indent.startsWith("\t");
  return { insertSpaces: !tabs, tabSize: tabs ? 1 : indent.length, eol: text.includes("\r\n") ? "\r\n" : "\n", insertFinalNewline: text.endsWith("\n") };
}

interface Edit {
  path: Path;
  value: Json;
  arrayAppend?: boolean;
}

/**
 * Merges a JSON/JSONC patch into a project file. `base` null means the file doesn't exist: the result is the
 * patch text itself (comments in the patch are kept).
 */
export function mergeJsonc(
  base: string | null,
  patchText: string,
  kind: "jsonc-deep" | "json-merge-patch",
  opts: { file: string; forbiddenTopLevel?: string[] } = { file: "config" },
): MergeResult {
  const warnings: string[] = [];
  const conflicts: MergeConflict[] = [];
  let patch: Json;
  try {
    patch = parseJsonc(patchText) as Json;
  } catch (e) {
    return { text: base ?? "", changed: false, warnings, conflicts: [{ name: opts.file, detail: `config patch is not valid JSONC: ${(e as Error).message}` }] };
  }
  if (!isObj(patch)) return { text: base ?? "", changed: false, warnings, conflicts: [{ name: opts.file, detail: "a config patch must be a JSON object" }] };
  for (const k of opts.forbiddenTopLevel ?? []) {
    if (Object.hasOwn(patch, k)) {
      conflicts.push({ name: `${opts.file}:${k}`, detail: `a block may not set ${k} in ${opts.file}` });
      delete patch[k];
    }
  }
  const removals = (v: Json, p: Path): void => {
    if (v === null) conflicts.push({ name: `${opts.file}:${fmtPath(p)}`, detail: `the patch would remove ${fmtPath(p)}; config patches never remove keys` });
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) removals(x, [...p, k]);
  };
  removals(patch, []);
  if (base === null) {
    if (conflicts.length) return { text: "", changed: false, warnings, conflicts };
    return { text: patchText.endsWith("\n") ? patchText : `${patchText}\n`, changed: true, warnings, conflicts };
  }
  let baseVal: Json;
  try {
    baseVal = parseJsonc(base) as Json;
  } catch (e) {
    return { text: base, changed: false, warnings, conflicts: [{ name: opts.file, detail: `project file is not valid JSONC: ${(e as Error).message}` }] };
  }
  if (!isObj(baseVal)) return { text: base, changed: false, warnings, conflicts: [{ name: opts.file, detail: "project file is not a JSON object" }] };

  const edits: Edit[] = [];
  const walk = (pv: Json, bv: Json | undefined, path: Path): void => {
    if (pv === null) return; // reported as a removal conflict
    if (bv === undefined) {
      edits.push({ path, value: pv });
      return;
    }
    if (isObj(pv)) {
      if (!isObj(bv)) {
        conflicts.push({ name: `${opts.file}:${fmtPath(path)}`, detail: `${fmtPath(path)} is ${Array.isArray(bv) ? "an array" : typeof bv} in the project, an object in the patch` });
        return;
      }
      for (const [k, v] of Object.entries(pv)) walk(v, bv[k], [...path, k]);
      return;
    }
    if (Array.isArray(pv)) {
      if (!Array.isArray(bv)) {
        conflicts.push({ name: `${opts.file}:${fmtPath(path)}`, detail: `${fmtPath(path)} is not an array in the project` });
        return;
      }
      if (kind === "json-merge-patch") {
        if (!deepEqual(pv, bv)) warnings.push(`config: ${opts.file} ${fmtPath(path)} kept the project's array (the block's differs)`);
        return;
      }
      for (const el of pv) {
        const id = identity(el);
        if (id !== undefined) {
          const idx = bv.findIndex((b) => identity(b) === id);
          if (idx >= 0) walk(el, bv[idx], [...path, idx]);
          else edits.push({ path, value: el, arrayAppend: true });
        } else if (!bv.some((b) => deepEqual(b, el))) edits.push({ path, value: el, arrayAppend: true });
      }
      return;
    }
    // scalar
    if (isObj(bv) || Array.isArray(bv)) {
      conflicts.push({ name: `${opts.file}:${fmtPath(path)}`, detail: `${fmtPath(path)} is a ${Array.isArray(bv) ? "array" : "object"} in the project, a scalar in the patch` });
      return;
    }
    if (bv !== pv) warnings.push(`config: ${opts.file} ${fmtPath(path)} kept the project's value ${JSON.stringify(bv)} (block default ${JSON.stringify(pv)})`);
  };
  walk(patch, baseVal, []);

  const formattingOptions = detectFormatting(base);
  let text = base;
  for (const e of edits) text = insertValue(text, e, formattingOptions);
  return { text, changed: text !== base, warnings, conflicts };
}

/** One-line JSON with spaces after `:` and `,` and inside braces: `{ "a": 1, "b": [1, 2] }`. */
function inlineJson(v: Json): string {
  if (Array.isArray(v)) return `[${v.map(inlineJson).join(", ")}]`;
  if (isObj(v)) {
    const parts = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inlineJson(x)}`);
    return parts.length ? `{ ${parts.join(", ")} }` : "{}";
  }
  return JSON.stringify(v);
}

function lineIndent(text: string, offset: number): string {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(start))![0];
}

function sameLine(text: string, a: number, b: number): boolean {
  return !text.slice(Math.min(a, b), Math.max(a, b)).includes("\n");
}

/** Skips whitespace and comments from `i`; returns the offset of the next significant character. */
function skipTrivia(text: string, i: number): number {
  for (;;) {
    while (i < text.length && /\s/.test(text[i]!)) i++;
    if (text.startsWith("//", i)) {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl + 1;
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else return i;
  }
}

/**
 * Adds a property (or appends an array element) after the container's last child, matching that child's line style
 * (inline containers stay inline). Leaves every other byte of the file alone; jsonc-parser's `modify` is used only
 * for empty containers and plain value paths.
 */
function insertValue(text: string, e: Edit, fo: jsonc.FormattingOptions): string {
  const tree = jsonc.parseTree(text, [], { allowTrailingComma: true });
  const containerPath = e.arrayAppend ? e.path : e.path.slice(0, -1);
  const node = tree ? (containerPath.length ? jsonc.findNodeAtLocation(tree, containerPath) : tree) : undefined;
  const children = node?.children ?? [];
  if (!node || children.length === 0 || (node.type !== "object" && node.type !== "array")) {
    const path = e.arrayAppend ? [...e.path, 0] : e.path;
    return jsonc.applyEdits(text, jsonc.modify(text, path, e.value, { formattingOptions: fo, isArrayInsertion: !!e.arrayAppend }));
  }
  const last = children[children.length - 1]!;
  const lastEnd = last.offset + last.length;
  const unit = fo.insertSpaces === false ? "\t" : " ".repeat(fo.tabSize ?? 2);
  const eol = fo.eol ?? "\n";
  const key = e.arrayAppend ? "" : `${JSON.stringify(String(e.path[e.path.length - 1]))}: `;
  const inline = sameLine(text, node.offset, last.offset);
  let insertion: string;
  if (inline) insertion = `, ${key}${inlineJson(e.value)}`;
  else {
    const indent = lineIndent(text, last.offset);
    const body = JSON.stringify(e.value, null, unit).split("\n").join(`${eol}${indent}`);
    insertion = `,${eol}${indent}${key}${body}`;
  }
  // a trailing comma already present: insert after it and keep one at the end
  const next = skipTrivia(text, lastEnd);
  if (text[next] === ",") return `${text.slice(0, next + 1)}${insertion.slice(1)},${text.slice(next + 1)}`;
  return text.slice(0, lastEnd) + insertion + text.slice(lastEnd);
}

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

export interface AppendResult {
  text: string;
  lines: string[];
  changed: boolean;
}

/**
 * Appends the patch's lines that the file doesn't have yet. `KEY=value` lines are matched by key; other lines
 * (comments, `.gitignore` entries) by exact text; blank lines are dropped. A line for a declared secret is written as
 * `KEY=` (names only, never values).
 */
export function appendMissingLines(base: string | null, patchText: string, opts: { secretNames?: Iterable<string> } = {}): AppendResult {
  const secrets = new Set(opts.secretNames ?? []);
  const existing = base ?? "";
  const haveKeys = new Set<string>();
  const haveLines = new Set<string>();
  for (const l of existing.split(/\r?\n/)) {
    const m = ENV_LINE.exec(l);
    if (m) haveKeys.add(m[1]!);
    haveLines.add(l.trim());
  }
  const add: string[] = [];
  let pendingComments: string[] = [];
  for (const raw of patchText.split(/\r?\n/)) {
    const l = raw.trimEnd();
    if (l.trim() === "") continue;
    if (l.trim().startsWith("#")) {
      if (!haveLines.has(l.trim())) pendingComments.push(l);
      continue;
    }
    const m = ENV_LINE.exec(l);
    let line = l;
    let present: boolean;
    if (m) {
      present = haveKeys.has(m[1]!);
      if (secrets.has(m[1]!)) line = `${m[1]}=`;
      if (!present) haveKeys.add(m[1]!);
    } else {
      present = haveLines.has(l.trim());
      if (!present) haveLines.add(l.trim());
    }
    if (!present) {
      add.push(...pendingComments, line);
    }
    pendingComments = [];
  }
  if (add.length === 0) return { text: existing, lines: [], changed: false };
  const sep = existing === "" || existing.endsWith("\n") ? "" : "\n";
  return { text: `${existing}${sep}${add.join("\n")}\n`, lines: add, changed: true };
}
