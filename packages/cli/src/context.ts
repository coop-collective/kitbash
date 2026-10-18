/** Shared helpers for commands: the API client, the installed-block loader, plan pinning. */
import {
  KitError,
  canonicalJson,
  readLock,
  sha256Hex,
  type InstallPlan,
  type LockEntryT,
} from "@kitbash/core";
import { createApi, type ApiClient } from "./api.ts";
import { loadSettings, type Settings } from "./config.ts";
import type { Io } from "./io.ts";
import { readSources, sourceDir, type Project } from "./project.ts";
import { checkAgainstLock, fetchRegistryBlock, loadLocalBlock, type ResolvedBlock } from "./source.ts";

export async function apiFor(io: Io): Promise<{ api: ApiClient; settings: Settings }> {
  const settings = await loadSettings(io);
  return { api: createApi(settings, io.fetch), settings };
}

/** The lock entry of an installed block, or `not_found`. */
export async function installedEntry(p: Project, blockId: string): Promise<LockEntryT> {
  const lock = await readLock(p.fs);
  const e = lock.blocks[blockId];
  if (!e) {
    const ids = Object.keys(lock.blocks);
    throw new KitError("not_found", `${blockId} is not installed${ids.length ? ` (installed: ${ids.join(", ")})` : ""}`);
  }
  return e;
}

/**
 * Loads the installed version of a block again: `--from <dir>`, else the source recorded at install
 * (`.kit/sources.json`), else the registry at the locked version. Checked against the lock's manifest hash.
 */
export async function loadInstalled(io: Io, p: Project, blockId: string, entry: LockEntryT, from?: string): Promise<ResolvedBlock> {
  let b: ResolvedBlock;
  if (from) b = await loadLocalBlock(io, from, { id: blockId });
  else {
    const src = (await readSources(p.fs))[blockId];
    if (src?.kind === "local") b = await loadLocalBlock({ ...io, cwd: p.root }, sourceDir(p, src), { id: blockId });
    else if (blockId.startsWith("@local/")) throw new KitError("not_found", `don't know where ${blockId} was installed from: pass --from <block dir>`);
    else {
      const { api, settings } = await apiFor(io);
      b = await fetchRegistryBlock(api, settings.registryPublicKey, `${blockId}@${entry.version}`, { variant: entry.variant, allowYanked: true });
    }
  }
  await checkAgainstLock(b, entry.manifest_sha256);
  return b;
}

/**
 * plan_id pinning: the id is the SHA-256 of the canonical plan body (BLOCK-SPEC §11), so a plan file whose content
 * was edited after the dry run no longer matches its id and is refused.
 */
export async function planIdOf(plan: InstallPlan): Promise<string> {
  const { plan_id: _id, diff_preview_path: _d, ...body } = plan;
  return `plan_${(await sha256Hex(canonicalJson(body))).slice(0, 20).toUpperCase()}`;
}

export async function assertPlanPinned(plan: InstallPlan): Promise<void> {
  if ((await planIdOf(plan)) !== plan.plan_id) {
    throw new KitError("plan_stale", `${plan.plan_id}: the saved plan was modified after it was made; run kit install again`);
  }
}
