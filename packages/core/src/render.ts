/**
 * The renderer (BLOCK-SPEC §4): `{{kit.<param>}}` substitution with modifiers, `{{paths.<name>}}` path tokens,
 * `{{migrations.renumbered}}`, and `{{#kit.if expr}} … {{kit.else}} … {{/kit.if}}` conditionals.
 *
 * Only tokens that start with `kit.`, `#kit.if`, `/kit.if`, `paths.` or `migrations.` are ours; any other `{{…}}`
 * (JSX `style={{…}}`, Handlebars, Vue) is left untouched. Rendering is strict: an unknown param, an unknown path
 * token, a bad modifier or an unbalanced conditional throws `RenderError`.
 *
 * Param values are validated by type before they are substituted (`validateParamValue`), which is what keeps a
 * value from injecting syntax into the block's code.
 */
import { RenderError } from "./errors.ts";
import { relativePath } from "./paths.ts";
import type { ParamDef } from "./schema.ts";

export type ParamValue = string | number | boolean;
export type ParamValues = Record<string, ParamValue>;

export interface RenderContext {
  params: ParamValues;
  /** Project path tokens (`.kit/project.json#paths`). */
  paths?: Record<string, string>;
  /** Final migration file names, for `{{migrations.renumbered}}`. */
  migrations?: string[];
  /** Directory of the file being rendered (project-relative), for the `|rel` modifier on path tokens. */
  fileDir?: string;
}

const TOKEN =
  /\{\{\s*(#kit\.if\s+[^{}]*?|\/kit\.if|kit\.else|(?:kit|paths|migrations)\.[A-Za-z0-9_]+(?:\s*\|\s*[A-Za-z]+)*)\s*\}\}/g;
const LOOSE_OURS = /\{\{\s*(?:#|\/)?\s*(?:kit|paths|migrations)\./;

// ---------- modifiers ----------

export function splitWords(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

const cap = (w: string) => (w ? w[0]!.toUpperCase() + w.slice(1) : w);

export const MODIFIERS = {
  pascal: (s: string) => splitWords(s).map(cap).join(""),
  camel: (s: string) => {
    const w = splitWords(s);
    return w.length ? w[0]! + w.slice(1).map(cap).join("") : "";
  },
  snake: (s: string) => splitWords(s).join("_"),
  kebab: (s: string) => splitWords(s).join("-"),
  /** SCREAMING_SNAKE: `my-app` → `MY_APP` (useful for env and constant names). */
  upper: (s: string) => splitWords(s).join("_").toUpperCase(),
  lower: (s: string) => s.toLowerCase(),
} as const;
export type Modifier = keyof typeof MODIFIERS | "rel";

// ---------- param validation ----------

const STRING_FORBIDDEN = /["'`\\<>]|\$\{|\{\{|\}\}/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/;
const IDENT_BASE = /^[A-Za-z0-9_-]*$/;
const IDENT_DEFAULT = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const PATH_PARAM = /^(\/[A-Za-z0-9._~:@-]+)*\/?$/;

export type ParamCheck = { ok: true; value: ParamValue } | { ok: false; reason: string };

function compilePattern(p: string): RegExp | null {
  try {
    return new RegExp(`^(?:${p})$`);
  } catch {
    return null;
  }
}

/** Validates (and coerces CLI strings for integer/boolean) one param value against its definition. */
export function validateParamValue(def: ParamDef, value: unknown): ParamCheck {
  const bad = (reason: string): ParamCheck => ({ ok: false, reason: `${def.name}: ${reason}` });
  switch (def.type) {
    case "string": {
      if (typeof value !== "string") return bad("must be a string");
      if (value.length > (def.max ?? 200)) return bad("too long");
      if (CONTROL.test(value)) return bad("control or invisible characters are not allowed");
      if (STRING_FORBIDDEN.test(value)) return bad("quotes, backslashes, backticks, < >, ${ and {{ }} are not allowed");
      if (def.pattern) {
        const re = compilePattern(def.pattern);
        if (!re) return bad("invalid pattern in the manifest");
        if (!re.test(value)) return bad(`must match ${def.pattern}`);
      }
      return { ok: true, value };
    }
    case "identifier": {
      if (typeof value !== "string") return bad("must be a string");
      if (value.length > 64) return bad("too long");
      if (!IDENT_BASE.test(value)) return bad("may contain only letters, digits, _ and -");
      const re = def.pattern ? compilePattern(def.pattern) : IDENT_DEFAULT;
      if (!re) return bad("invalid pattern in the manifest");
      if (!re.test(value)) return bad(`must match ${def.pattern ?? IDENT_DEFAULT.source}`);
      return { ok: true, value };
    }
    case "path": {
      if (typeof value !== "string") return bad("must be a string");
      if (value.length > 200) return bad("too long");
      if (!PATH_PARAM.test(value)) return bad("must be like /segment/segment (letters, digits, . _ ~ : @ -)");
      if (value.split("/").some((s) => s === "." || s === "..")) return bad("dot segments are not allowed");
      if (def.pattern) {
        const re = compilePattern(def.pattern);
        if (!re || !re.test(value)) return bad(`must match ${def.pattern}`);
      }
      return { ok: true, value };
    }
    case "integer": {
      let n: number;
      if (typeof value === "number") n = value;
      else if (typeof value === "string" && /^-?\d{1,15}$/.test(value)) n = Number(value);
      else return bad("must be an integer");
      if (!Number.isSafeInteger(n)) return bad("must be an integer");
      if (def.min !== undefined && n < def.min) return bad(`must be >= ${def.min}`);
      if (def.max !== undefined && n > def.max) return bad(`must be <= ${def.max}`);
      return { ok: true, value: n };
    }
    case "boolean": {
      if (typeof value === "boolean") return { ok: true, value };
      if (value === "true") return { ok: true, value: true };
      if (value === "false") return { ok: true, value: false };
      return bad("must be true or false");
    }
    case "enum": {
      if (typeof value !== "string" || !(def.values ?? []).includes(value)) {
        return bad(`must be one of ${(def.values ?? []).join(", ")}`);
      }
      return { ok: true, value };
    }
    default:
      return bad(`unknown type ${(def as { type: string }).type}`);
  }
}

export interface ResolvedParams {
  values: ParamValues;
  errors: string[];
}

/**
 * Merges supplied values over defaults (and `inferred` values over defaults, but under supplied ones), validates
 * each, and rejects unknown names. Required params without a default or value are an error.
 */
export function resolveParams(
  defs: readonly ParamDef[],
  supplied: Record<string, unknown> = {},
  inferred: Record<string, unknown> = {},
): ResolvedParams {
  const values: ParamValues = {};
  const errors: string[] = [];
  const known = new Set(defs.map((d) => d.name));
  for (const k of Object.keys(supplied)) if (!known.has(k)) errors.push(`${k}: unknown param`);
  for (const def of defs) {
    let v: unknown;
    if (Object.hasOwn(supplied, def.name) && supplied[def.name] !== undefined) v = supplied[def.name];
    else if (Object.hasOwn(inferred, def.name) && inferred[def.name] !== undefined) v = inferred[def.name];
    else v = def.default;
    if (v === undefined) {
      errors.push(`${def.name}: required (no default)`);
      continue;
    }
    const r = validateParamValue(def, v);
    if (r.ok) values[def.name] = r.value;
    else errors.push(r.reason);
  }
  return { values, errors };
}

// ---------- conditionals ----------

type Node = { kind: "text"; text: string } | { kind: "tok"; body: string } | { kind: "if"; expr: string; then: Node[]; else: Node[] };

function parse(src: string): Node[] {
  const root: Node[] = [];
  const stack: { node: Extract<Node, { kind: "if" }>; inElse: boolean }[] = [];
  const push = (n: Node) => {
    const top = stack[stack.length - 1];
    if (!top) root.push(n);
    else (top.inElse ? top.node.else : top.node.then).push(n);
  };
  let last = 0;
  for (const m of src.matchAll(TOKEN)) {
    const idx = m.index!;
    const body = m[1]!.trim();
    const end = idx + m[0].length;
    // A block tag alone on its line removes the whole line (Mustache "standalone" rule).
    let cut = idx;
    let next = end;
    if (body.startsWith("#kit.if") || body === "kit.else" || body === "/kit.if") {
      const lineStart = src.lastIndexOf("\n", idx - 1) + 1;
      const after = /^[ \t]*(\r?\n|$)/.exec(src.slice(end));
      if (lineStart >= last && /^[ \t]*$/.test(src.slice(lineStart, idx)) && after) {
        cut = lineStart;
        next = end + after[0].length;
      }
    }
    if (cut > last) push({ kind: "text", text: src.slice(last, cut) });
    last = next;
    if (body.startsWith("#kit.if")) {
      const node: Extract<Node, { kind: "if" }> = { kind: "if", expr: body.slice(7).trim(), then: [], else: [] };
      push(node);
      stack.push({ node, inElse: false });
    } else if (body === "kit.else") {
      const top = stack[stack.length - 1];
      if (!top || top.inElse) throw new RenderError("{{kit.else}} outside a {{#kit.if}}");
      top.inElse = true;
    } else if (body === "/kit.if") {
      if (!stack.pop()) throw new RenderError("{{/kit.if}} without {{#kit.if}}");
    } else {
      push({ kind: "tok", body });
    }
  }
  if (last < src.length) push({ kind: "text", text: src.slice(last) });
  if (stack.length) throw new RenderError("unterminated {{#kit.if}}");
  return root;
}

const LITERAL = /^(?:"([^"]*)"|'([^']*)'|(-?\d+)|(true|false))$/;

function parseLiteral(s: string): ParamValue {
  const m = LITERAL.exec(s.trim());
  if (!m) throw new RenderError(`bad literal in condition: ${s}`);
  if (m[1] !== undefined) return m[1];
  if (m[2] !== undefined) return m[2];
  if (m[3] !== undefined) return Number(m[3]);
  return m[4] === "true";
}

/** Evaluates `name`, `!name`, `name == literal`, `name != literal` (also with a leading `kit.`). */
export function evaluateCondition(expr: string, params: ParamValues): boolean {
  const e = expr.trim();
  const m = /^(!?)\s*(?:kit\.)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:(==|!=)\s*(.+))?$/.exec(e);
  if (!m) throw new RenderError(`unsupported condition: ${expr}`);
  const [, neg, name, op, lit] = m;
  if (!Object.hasOwn(params, name!)) throw new RenderError(`unknown param in condition: ${name}`, "unknown_param");
  const v = params[name!]!;
  if (op) {
    if (neg) throw new RenderError(`unsupported condition: ${expr}`);
    const l = parseLiteral(lit!);
    // eslint-disable-next-line eqeqeq
    const eq = String(v) === String(l);
    return op === "==" ? eq : !eq;
  }
  const truthy = v !== false && v !== "" && v !== 0 && v !== "false";
  return neg ? !truthy : truthy;
}

// ---------- substitution ----------

function resolveToken(body: string, ctx: RenderContext): string {
  const parts = body.split("|").map((s) => s.trim());
  const ref = parts[0]!;
  const mods = parts.slice(1);
  const dot = ref.indexOf(".");
  const ns = ref.slice(0, dot);
  const name = ref.slice(dot + 1);
  let value: string;
  if (ns === "kit") {
    if (!Object.hasOwn(ctx.params, name)) throw new RenderError(`unknown param {{kit.${name}}}`, "unknown_param");
    value = String(ctx.params[name]);
  } else if (ns === "paths") {
    if (!ctx.paths || !Object.hasOwn(ctx.paths, name)) throw new RenderError(`unknown path token {{paths.${name}}}`, "unknown_path_token");
    value = ctx.paths[name]!;
  } else {
    if (name !== "renumbered") throw new RenderError(`unknown token {{migrations.${name}}}`);
    value = (ctx.migrations ?? []).join(", ");
  }
  for (const mod of mods) {
    if (mod === "rel") {
      if (ns !== "paths") throw new RenderError("|rel applies only to {{paths.*}} tokens");
      if (ctx.fileDir === undefined) throw new RenderError("|rel needs the file's target directory");
      value = relativePath(ctx.fileDir, value);
      continue;
    }
    const fn = (MODIFIERS as Record<string, (s: string) => string>)[mod];
    if (!fn) throw new RenderError(`unknown modifier |${mod}`, "unknown_modifier");
    value = fn(value);
  }
  return value;
}

function emit(nodes: Node[], ctx: RenderContext, out: string[]): void {
  for (const n of nodes) {
    if (n.kind === "text") out.push(n.text);
    else if (n.kind === "tok") out.push(resolveToken(n.body, ctx));
    else emit(evaluateCondition(n.expr, ctx.params) ? n.then : n.else, ctx, out);
  }
}

/** Renders a template string. Throws `RenderError` on any unknown or malformed kit token. */
export function renderTemplate(src: string, ctx: RenderContext): string {
  const out: string[] = [];
  emit(parse(src), ctx, out);
  const result = out.join("");
  // A `{{kit.` that survived is malformed (e.g. unclosed, or with a bad character). Check the source text only,
  // so a param value can never be re-interpreted as a token.
  const leftover = src.replace(TOKEN, "");
  if (LOOSE_OURS.test(leftover)) throw new RenderError("malformed kit token", "malformed_token");
  return result;
}

/** Lists the param names a template references (tokens and conditions). Throws on malformed conditionals. */
export function referencedParams(src: string): string[] {
  const names = new Set<string>();
  for (const m of src.matchAll(TOKEN)) {
    const body = m[1]!.trim();
    if (body.startsWith("kit.") && body !== "kit.else") names.add(body.slice(4).split("|")[0]!.trim());
    else if (body.startsWith("#kit.if")) {
      const c = /^!?\s*(?:kit\.)?([A-Za-z_][A-Za-z0-9_]*)/.exec(body.slice(7).trim());
      if (c) names.add(c[1]!);
    }
  }
  return [...names];
}

/**
 * Un-renders text for `registry_propose`: replaces the project's param values with `{{kit.<name>}}` tokens, longest
 * value first. Values shorter than 3 characters, numbers and booleans are skipped (too likely to match by accident).
 */
export function unrender(text: string, params: ParamValues): { text: string; replaced: number } {
  const entries = Object.entries(params)
    .filter(([, v]) => typeof v === "string" && v.length >= 3)
    .sort((a, b) => String(b[1]).length - String(a[1]).length || a[0].localeCompare(b[0]));
  if (entries.length === 0) return { text, replaced: 0 };
  // One pass with an alternation, so an inserted token is never matched again by a later value.
  const byValue = new Map<string, string>();
  for (const [name, v] of entries) if (!byValue.has(String(v))) byValue.set(String(v), name);
  const re = new RegExp([...byValue.keys()].map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  let replaced = 0;
  const out = text.replace(re, (m) => {
    replaced++;
    return `{{kit.${byValue.get(m)!}}}`;
  });
  return { text: out, replaced };
}
