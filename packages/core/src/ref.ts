/**
 * Block references: `@scope/name`, `@scope/name@1.2.3`, `@scope/name@latest`. Scoped ids start with `@`, so a
 * reference is split on the LAST `@` (never on the first).
 */
import semver from "semver";
import { KitError } from "./errors.ts";

export const BLOCK_ID_RE = /^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;
export const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export const TAG_RE = /^[a-z][a-z0-9-]*$/;

export interface BlockRef {
  /** `@scope/name` */
  id: string;
  scope: string;
  name: string;
  version?: string;
  tag?: string;
}

export function parseBlockRef(ref: string): BlockRef {
  if (typeof ref !== "string") throw new KitError("invalid_params", "block reference must be a string");
  const at = ref.lastIndexOf("@");
  const hasSuffix = at > 0;
  const id = hasSuffix ? ref.slice(0, at) : ref;
  const suffix = hasSuffix ? ref.slice(at + 1) : undefined;
  if (!BLOCK_ID_RE.test(id)) throw new KitError("invalid_params", `bad block id ${JSON.stringify(ref)}: expected @scope/name[@version|@tag]`);
  const [scope, name] = id.slice(1).split("/") as [string, string];
  const out: BlockRef = { id, scope, name };
  if (suffix !== undefined) {
    if (VERSION_RE.test(suffix)) out.version = suffix;
    else if (TAG_RE.test(suffix)) out.tag = suffix;
    else throw new KitError("invalid_params", `bad version or tag in ${JSON.stringify(ref)}`);
  }
  return out;
}

/** `@scope/name@version`, the pinned form Ideator stores. */
export function pinnedRef(id: string, version: string): string {
  if (!BLOCK_ID_RE.test(id)) throw new KitError("invalid_params", `bad block id ${JSON.stringify(id)}`);
  if (!VERSION_RE.test(version)) throw new KitError("invalid_params", `bad version ${JSON.stringify(version)}`);
  return `${id}@${version}`;
}

/** A `registryDependencies` entry: `@scope/name`, `@scope/name@<semver range>`, or a bare `name`. */
export interface DependencyRef {
  /** `@scope/name`, or undefined for a bare name */
  id?: string;
  name: string;
  /** a semver range (`^1`, `>=1.1.0`), or undefined for any version */
  range?: string;
}

export function parseDependencyRef(ref: string): DependencyRef {
  if (typeof ref !== "string" || !ref) throw new KitError("invalid_params", "dependency reference must be a non-empty string");
  const at = ref.lastIndexOf("@");
  const head = at > 0 ? ref.slice(0, at) : ref;
  const range = at > 0 ? ref.slice(at + 1) : undefined;
  if (range !== undefined && !semver.validRange(range)) throw new KitError("invalid_params", `bad version range in dependency ${JSON.stringify(ref)}`);
  if (head.startsWith("@")) {
    if (!BLOCK_ID_RE.test(head)) throw new KitError("invalid_params", `bad dependency ${JSON.stringify(ref)}: expected @scope/name[@range]`);
    return { id: head, name: head.split("/")[1]!, ...(range ? { range } : {}) };
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(head)) throw new KitError("invalid_params", `bad dependency ${JSON.stringify(ref)}`);
  return { name: head, ...(range ? { range } : {}) };
}

/** Whether `version` satisfies `range` (no range: any version). */
export function satisfiesRange(version: string, range: string | undefined): boolean {
  return !range || semver.satisfies(version, range, { includePrerelease: false });
}

/** The highest version in `versions` that satisfies `range`, or null. */
export function pickVersion(versions: readonly string[], range: string | undefined): string | null {
  return semver.maxSatisfying([...versions].filter((v) => VERSION_RE.test(v)), range ?? "*");
}
