/** Argument parsing on `node:util` parseArgs (strict: unknown flags are usage errors). */
import { parseArgs, type ParseArgsConfig } from "node:util";
import { KitError } from "@kitbash/core";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export type Options = NonNullable<ParseArgsConfig["options"]>;

export const COMMON: Options = {
  json: { type: "boolean" },
  root: { type: "string" },
  help: { type: "boolean", short: "h" },
};

export interface Parsed {
  values: Record<string, string | boolean | string[] | undefined>;
  positionals: string[];
}

export function parse(argv: string[], options: Options): Parsed {
  try {
    const r = parseArgs({ args: argv, options: { ...COMMON, ...options }, allowPositionals: true, strict: true });
    return { values: r.values as Parsed["values"], positionals: r.positionals };
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
}

export function str(p: Parsed, k: string): string | undefined {
  const v = p.values[k];
  return typeof v === "string" ? v : undefined;
}

export function bool(p: Parsed, k: string): boolean {
  return p.values[k] === true;
}

/** A repeatable flag; each value may also be comma-separated. */
export function list(p: Parsed, k: string, split = true): string[] {
  const v = p.values[k];
  const arr = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  return split ? arr.flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean) : arr;
}

/** `--param k=v` (repeatable). Values stay strings; core coerces integers and booleans per the param's type. */
export function params(p: Parsed): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of list(p, "param", false)) {
    const i = kv.indexOf("=");
    if (i <= 0) throw new UsageError(`--param expects name=value, got ${JSON.stringify(kv)}`);
    const k = kv.slice(0, i);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new UsageError(`bad param name ${JSON.stringify(k)}`);
    out[k] = kv.slice(i + 1);
  }
  return out;
}

/** `--stack framework=hono,db=d1`. */
export function stack(p: Parsed): Record<string, string> | undefined {
  const items = list(p, "stack");
  if (!items.length) return undefined;
  const out: Record<string, string> = {};
  for (const kv of items) {
    const [k, v] = kv.split("=");
    if (!k || !v || !["runtime", "framework", "db", "ui", "lang", "test"].includes(k)) throw new UsageError(`--stack expects runtime|framework|db|ui|lang|test=value, got ${JSON.stringify(kv)}`);
    out[k] = v;
  }
  return out;
}

export function need(p: Parsed, idx: number, what: string): string {
  const v = p.positionals[idx];
  if (!v) throw new UsageError(`missing ${what}`);
  return v;
}

export function oneOf<T extends string>(v: string | undefined, allowed: readonly T[], flag: string): T | undefined {
  if (v === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(v)) throw new UsageError(`${flag} must be one of ${allowed.join(", ")}`);
  return v as T;
}

export function int(v: string | undefined, flag: string, min: number, max: number): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new KitError("invalid_params", `${flag} must be an integer from ${min} to ${max}`);
  return n;
}
