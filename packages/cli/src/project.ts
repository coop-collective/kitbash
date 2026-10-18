/**
 * The project side: the core `KitFs` adapter rooted at the project (core's `nodeFs`, which refuses paths outside the
 * root and symlinks), the profile, and `.kit/sources.json`, the CLI's record of where each installed block came from
 * (a local directory or the registry) so that verify/diff/upgrade/propose can re-read the installed version.
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import { KitError, loadOrDetectProfile, readText, writeProfile, writeText, type KitFs, type ProjectProfile } from "@kitbash/core";
import { nodeFs } from "@kitbash/core/node";
import type { Io } from "./io.ts";

export interface Project {
  root: string;
  fs: KitFs & { root: string };
}

export async function openProject(io: Io, rootFlag?: string): Promise<Project> {
  const root = path.resolve(io.cwd, rootFlag ?? ".");
  let st;
  try {
    st = await stat(root);
  } catch {
    throw new KitError("not_found", `project root ${root} does not exist`);
  }
  if (!st.isDirectory()) throw new KitError("invalid_params", `project root ${root} is not a directory`);
  return { root, fs: nodeFs(root) };
}

/** Reads `.kit/project.json`, or detects the stack and (with `write`) saves it so plan ids stay stable. */
export async function ensureProfile(p: Project, opts: { write: boolean }): Promise<{ profile: ProjectProfile; created: boolean; notes: string[] }> {
  const r = await loadOrDetectProfile(p.fs);
  if (r.detected && opts.write) await writeProfile(p.fs, r.profile);
  return { profile: r.profile, created: r.detected, notes: r.notes };
}

export const SOURCES_PATH = ".kit/sources.json";

export type BlockSource = { kind: "local"; path: string } | { kind: "registry"; api?: string };

export async function readSources(fs: KitFs): Promise<Record<string, BlockSource>> {
  const t = await readText(fs, SOURCES_PATH);
  if (!t) return {};
  try {
    const v = JSON.parse(t) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, BlockSource>) : {};
  } catch {
    return {};
  }
}

export async function recordSource(p: Project, blockId: string, src: BlockSource): Promise<void> {
  const all = await readSources(p.fs);
  const stored: BlockSource = src.kind === "local" ? { kind: "local", path: relOrAbs(p.root, src.path) } : src;
  all[blockId] = stored;
  const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b)));
  await writeText(p.fs, SOURCES_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
}

function relOrAbs(root: string, dir: string): string {
  const rel = path.relative(root, dir);
  return rel && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : dir;
}

/** Resolves a stored local source path against the project root. */
export function sourceDir(p: Project, src: { path: string }): string {
  return path.resolve(p.root, src.path);
}
