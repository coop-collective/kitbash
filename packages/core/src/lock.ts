/**
 * `.kit/lock.json` (BLOCK-SPEC §6.6): read/write/update, `diffAgainstLock()`, and `threeWayMerge()` for
 * `registry_upgrade` (Copier/Cruft-style re-apply with diff3 conflict markers).
 */
import { diff3Merge } from "node-diff3";
import { z } from "zod";
import { LockEntry, type LockEntryT } from "./contract.ts";
import { unifiedDiff } from "./diff.ts";
import { KitError } from "./errors.ts";
import { readText, writeText, type FileTree, type KitFs } from "./fs.ts";
import { sha256Hex, stableStringify, tryDecodeUtf8 } from "./hash.ts";
import { BLOCK_ID_RE } from "./ref.ts";

export const LOCK_PATH = ".kit/lock.json";

export const LockSchema = z.strictObject({
  version: z.literal(1),
  blocks: z.record(z.string().regex(BLOCK_ID_RE), LockEntry),
});
export type Lock = z.infer<typeof LockSchema>;

export function emptyLock(): Lock {
  return { version: 1, blocks: {} };
}

export function parseLock(text: string): Lock {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new KitError("invalid_params", `${LOCK_PATH} is not valid JSON`);
  }
  const r = LockSchema.safeParse(json);
  if (!r.success) throw new KitError("invalid_params", `${LOCK_PATH}: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

export async function readLock(fs: KitFs): Promise<Lock> {
  const t = await readText(fs, LOCK_PATH);
  return t === null ? emptyLock() : parseLock(t);
}

/** Serialized with sorted keys and a trailing newline, so the file diffs cleanly in git. */
export function serializeLock(lock: Lock): string {
  return stableStringify(LockSchema.parse(lock));
}

export async function writeLock(fs: KitFs, lock: Lock): Promise<void> {
  await writeText(fs, LOCK_PATH, serializeLock(lock));
}

export function upsertLockEntry(lock: Lock, blockId: string, entry: LockEntryT): Lock {
  if (!BLOCK_ID_RE.test(blockId)) throw new KitError("invalid_params", `bad block id ${blockId}`);
  return { ...lock, blocks: { ...lock.blocks, [blockId]: LockEntry.parse(entry) } };
}

export function removeLockEntry(lock: Lock, blockId: string): Lock {
  const blocks = { ...lock.blocks };
  delete blocks[blockId];
  return { ...lock, blocks };
}

export function setAdaptStatus(lock: Lock, blockId: string, id: string, status: "pending" | "done" | "skipped"): Lock {
  const e = lock.blocks[blockId];
  if (!e) throw new KitError("not_found", `${blockId} is not installed`);
  if (!Object.hasOwn(e.adapt, id)) throw new KitError("invalid_params", `${blockId} has no adapt item ${id}`);
  return upsertLockEntry(lock, blockId, { ...e, adapt: { ...e.adapt, [id]: status } });
}

export function recordVerify(lock: Lock, blockId: string, passed: boolean, at: string): Lock {
  const e = lock.blocks[blockId];
  if (!e) throw new KitError("not_found", `${blockId} is not installed`);
  return upsertLockEntry(lock, blockId, { ...e, verify: { last_run: at, passed } });
}

/** Required adapt items still pending (what `registry_verify` warns about). */
export function pendingRequiredAdapt(entry: LockEntryT, required: Iterable<string>): string[] {
  const req = new Set(required);
  return Object.entries(entry.adapt)
    .filter(([id, s]) => s === "pending" && req.has(id))
    .map(([id]) => id)
    .sort();
}

export interface LockFileDiff {
  path: string;
  status: "modified" | "deleted" | "unchanged";
  diff?: string;
}

/**
 * Compares the project's current files against what the lock says was installed. With `rendered` (the install-time
 * render of each target, e.g. from `renderInstalled`) the result also carries a unified diff per modified file.
 */
export async function diffAgainstLock(entry: LockEntryT, current: FileTree, rendered?: FileTree): Promise<LockFileDiff[]> {
  const out: LockFileDiff[] = [];
  for (const f of entry.files) {
    const cur = Object.hasOwn(current, f.target) ? current[f.target]! : null;
    if (cur === null) {
      out.push({ path: f.target, status: "deleted" });
      continue;
    }
    if ((await sha256Hex(cur)) === f.rendered_sha256) {
      out.push({ path: f.target, status: "unchanged" });
      continue;
    }
    const d: LockFileDiff = { path: f.target, status: "modified" };
    const base = rendered && Object.hasOwn(rendered, f.target) ? tryDecodeUtf8(rendered[f.target]!) : null;
    const now = tryDecodeUtf8(cur);
    if (base !== null && now !== null) d.diff = unifiedDiff(f.target, base, now);
    out.push(d);
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// ---------- three-way merge ----------

export interface MergeLabels {
  ours?: string;
  base?: string;
  theirs?: string;
}

export interface ThreeWayResult {
  content: string;
  clean: boolean;
  conflicts: number;
}

function splitLines(s: string): string[] {
  return s.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function ensureNl(lines: string[]): string[] {
  if (lines.length && !lines[lines.length - 1]!.endsWith("\n")) return [...lines.slice(0, -1), `${lines[lines.length - 1]}\n`];
  return lines;
}

/**
 * diff3 merge of one file, Copier-style: `base` is the old version rendered with the lock's params, `theirs` the new
 * version rendered with the same params, `ours` the project's current file. Unchanged sides resolve trivially;
 * overlapping edits produce `<<<<<<< ours` / `||||||| base` / `=======` / `>>>>>>> theirs` markers.
 */
export function threeWayMerge(base: string, ours: string, theirs: string, labels: MergeLabels = {}): ThreeWayResult {
  if (ours === theirs) return { content: ours, clean: true, conflicts: 0 };
  if (ours === base) return { content: theirs, clean: true, conflicts: 0 };
  if (theirs === base) return { content: ours, clean: true, conflicts: 0 };
  const regions = diff3Merge(splitLines(ours), splitLines(base), splitLines(theirs), { excludeFalseConflicts: true });
  const out: string[] = [];
  let conflicts = 0;
  for (const r of regions) {
    if ("ok" in r && r.ok) out.push(...r.ok);
    else if ("conflict" in r && r.conflict) {
      conflicts++;
      const c = r.conflict;
      const fix = (lines: string[]) => ensureNl(lines);
      if (out.length && !out[out.length - 1]!.endsWith("\n")) out[out.length - 1] += "\n";
      out.push(`<<<<<<< ${labels.ours ?? "ours"}\n`, ...fix(c.a));
      out.push(`||||||| ${labels.base ?? "base"}\n`, ...fix(c.o));
      out.push("=======\n", ...fix(c.b));
      out.push(`>>>>>>> ${labels.theirs ?? "theirs"}\n`);
    }
  }
  return { content: out.join(""), clean: conflicts === 0, conflicts };
}
