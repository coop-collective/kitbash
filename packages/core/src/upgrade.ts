/**
 * `registry_upgrade` (DESIGN §3.4): Copier/Cruft-style 3-way re-apply.
 * base = installed version rendered with the lock's params; theirs = target version rendered with the same params;
 * ours = the project's current file. New migrations are renumbered after the project's current highest.
 */
import { mergeJsonc, appendMissingLines, WRANGLER_FORBIDDEN_KEYS } from "./config-merge.ts";
import { assertContainerPackage } from "./container-package.ts";
import type { AdaptRefT, LockEntryT } from "./contract.ts";
import { KitError } from "./errors.ts";
import type { BlockBundle, FileTree, KitFs } from "./fs.ts";
import { base64Decode, base64Encode, manifestSha256, sha256Hex, toBytes, tryDecodeUtf8, type FileData } from "./hash.ts";
import { readLock, upsertLockEntry, writeLock, LOCK_PATH } from "./lock.ts";
import { threeWayMerge } from "./lock.ts";
import { basename, forbiddenTarget, normalizeRelative } from "./paths.ts";
import { prepareBlock as prepare, renderBlockFiles, renderInstalled, renumberMigrations, renamedTarget, type PlannedFile } from "./plan.ts";
import type { ProjectProfile } from "./profile.ts";
import { changelogUpgradeSection } from "./summary.ts";

export interface UpgradeInput {
  oldBundle: BlockBundle;
  newBundle: BlockBundle;
  entry: LockEntryT;
  blockId: string;
  profile: ProjectProfile;
  /** Current project files: every tracked target, the targets of the new version, config targets, migrations. */
  current: FileTree;
  now?: string;
  registrySignature?: string;
}

export interface UpgradePlan {
  block_id: string;
  from: string;
  to: string;
  clean: string[];
  conflicted: { path: string; ours: string; theirs: string; base: string }[];
  added: string[];
  removed: string[];
  migrations: Record<string, string>;
  changelog_upgrade_section: string;
  new_adapt: AdaptRefT[];
  warnings: string[];
  /** Files to write on apply: merged content (with conflict markers for conflicted files). */
  files: PlannedFile[];
  next_entry: LockEntryT;
}

const text = (d: FileData | undefined): string | null => (d === undefined ? null : tryDecodeUtf8(d));

export async function planUpgrade(input: UpgradeInput): Promise<UpgradePlan> {
  const { entry, profile, current, blockId } = input;
  const base = renderInstalled(input.oldBundle, entry, profile, blockId);
  const newPrep = prepare(
    {
      bundle: input.newBundle,
      profile,
      project: current,
      params: Object.fromEntries(
        Object.entries(entry.params).filter(([k]) => ((input.newBundle.manifest as { params?: { name: string }[] }).params ?? []).some((p) => p.name === k)),
      ),
      variant: entry.variant,
      blockId,
    },
    { strictParams: true },
  );
  const m = newPrep.m;
  if (m.version === entry.version) throw new KitError("invalid_params", `${blockId} is already at ${m.version}`);

  // migrations: keep the lock's mapping; renumber new ones after the project's highest
  const known = entry.migrations ?? {};
  const migDir = profile.paths.migrations ?? "migrations";
  const existing = Object.keys(current)
    .filter((k) => k.startsWith(`${migDir}/`) && /^\d+_.+\.sql$/.test(k.slice(migDir.length + 1)) && !k.slice(migDir.length + 1).includes("/"))
    .map((k) => k.slice(migDir.length + 1))
    .sort();
  const newMigs = newPrep.files
    .filter((f) => f.entry.role === "migration" && !Object.hasOwn(known, basename(f.entry.path)))
    .map((f) => basename(f.entry.path))
    .sort();
  const fresh = renumberMigrations(newMigs, [...existing, ...Object.values(known)], profile, input.now);
  const migrationMap = { ...known, ...fresh };
  const theirs = renderBlockFiles(newPrep, profile, migrationMap);

  const lockByBlockPath = new Map(entry.files.map((f) => [f.block_path, f]));
  const out: UpgradePlan = {
    block_id: blockId,
    from: entry.version,
    to: m.version,
    clean: [],
    conflicted: [],
    added: [],
    removed: [],
    migrations: fresh,
    changelog_upgrade_section: changelogUpgradeSection(text(input.newBundle.files["CHANGELOG.md"]) ?? undefined),
    new_adapt: (m.agent?.adapt ?? []).filter((a) => !Object.hasOwn(entry.adapt, a.id)).map((a) => ({ id: a.id, required: a.required, status: "pending" as const })),
    warnings: [],
    files: [],
    next_entry: entry,
  };
  const nextFiles: LockEntryT["files"] = [];
  const shaOrNull = async (d: FileData | undefined) => (d === undefined ? null : sha256Hex(d));
  const seenBlockPaths = new Set<string>();

  for (const r of theirs) {
    if (r.entry.role === "config-patch") continue;
    seenBlockPaths.add(r.entry.path);
    const prev = lockByBlockPath.get(r.entry.path);
    const target = prev ? prev.target : entry.on_conflict?.[r.target] === "rename" ? renamedTarget(r.target, m.name) : r.target;
    const n = normalizeRelative(target);
    if (n === null || forbiddenTarget(n, m.name)) throw new KitError("forbidden", `upgrade target ${target} is not writable`);
    const theirsText = text(r.content);
    const oursData = current[target];
    const baseData = prev ? base[prev.target] : undefined;
    const add = async (content: FileData, action: PlannedFile["action"]) => {
      out.files.push({ path: target, action, role: r.entry.role, block_path: r.entry.path, before_sha256: await shaOrNull(oursData), after_sha256: await sha256Hex(content), content_b64: base64Encode(toBytes(content)), tracked: true });
    };
    nextFiles.push({ target, rendered_sha256: await sha256Hex(r.content), block_path: r.entry.path, role: r.entry.role });
    if (!prev || baseData === undefined) {
      if (oursData === undefined) {
        out.added.push(target);
        await add(r.content, "create");
      } else if ((await sha256Hex(oursData)) !== (await sha256Hex(r.content))) {
        out.conflicted.push({ path: target, ours: text(oursData) ?? "", theirs: theirsText ?? "", base: "" });
        await add(`<<<<<<< ours (project)\n${ensureNl(text(oursData) ?? "")}=======\n${ensureNl(theirsText ?? "")}>>>>>>> theirs (${m.version})\n`, "overwrite");
      }
      continue;
    }
    const baseText = text(baseData);
    if (oursData === undefined) {
      if (baseText !== theirsText) {
        out.conflicted.push({ path: target, ours: "", theirs: theirsText ?? "", base: baseText ?? "" });
        out.warnings.push(`${target} was deleted in the project and changed upstream; not restored`);
      }
      continue;
    }
    const oursText = text(oursData);
    if (baseText === null || oursText === null || theirsText === null) {
      // binary: take theirs only when ours is untouched
      if ((await sha256Hex(oursData)) === (await sha256Hex(baseData))) {
        out.clean.push(target);
        await add(r.content, "overwrite");
      } else out.conflicted.push({ path: target, ours: "(binary)", theirs: "(binary)", base: "(binary)" });
      continue;
    }
    const merged = threeWayMerge(baseText, oursText, theirsText, { ours: "ours (project)", base: `base (${entry.version})`, theirs: `theirs (${m.version})` });
    if (merged.clean) {
      out.clean.push(target);
      if (merged.content !== oursText) await add(merged.content, "patch");
    } else {
      out.conflicted.push({ path: target, ours: oursText, theirs: theirsText, base: baseText });
      await add(merged.content, "patch");
    }
  }
  for (const f of entry.files) if (!seenBlockPaths.has(f.block_path)) out.removed.push(f.target);

  // config patches of the new version: re-merged (adds only)
  const secretNames = (m.secrets ?? []).map((s) => s.name);
  const pending = new Map<string, string>();
  for (const r of theirs) {
    if (r.entry.role !== "config-patch") continue;
    const before = pending.get(r.target) ?? text(current[r.target]);
    const patch = text(r.content) ?? "";
    let after: string;
    let changed: boolean;
    if (r.entry.merge === "append-missing-lines") {
      const a = appendMissingLines(before, patch, { secretNames });
      after = a.text;
      changed = a.changed;
    } else {
      const res = mergeJsonc(before, patch, r.entry.merge as "jsonc-deep" | "json-merge-patch", { file: r.target, ...(/(^|\/)wrangler\.jsonc?$/.test(r.target) ? { forbiddenTopLevel: WRANGLER_FORBIDDEN_KEYS } : {}) });
      after = res.text;
      changed = res.changed && res.conflicts.length === 0;
      out.warnings.push(...res.warnings, ...res.conflicts.map((c) => `config: ${c.detail}`));
    }
    if (changed) pending.set(r.target, after);
  }
  for (const [target, after] of pending) {
    out.files.push({ path: target, action: current[target] === undefined ? "create" : "patch", role: "config-patch", block_path: "", before_sha256: await shaOrNull(current[target]), after_sha256: await sha256Hex(after), content_b64: base64Encode(toBytes(after)), tracked: false });
    out.clean.push(target);
  }
  out.clean.sort();
  out.files.sort((a, b) => a.path.localeCompare(b.path));

  out.next_entry = {
    ...entry,
    version: m.version,
    manifest_sha256: await manifestSha256(input.newBundle.manifest),
    registry_signature: input.registrySignature ?? "",
    params: newPrep.params,
    files: nextFiles.sort((a, b) => a.target.localeCompare(b.target)),
    migrations: migrationMap,
    adapt: { ...Object.fromEntries((m.agent?.adapt ?? []).map((a) => [a.id, entry.adapt[a.id] ?? ("pending" as const)])) },
  };
  return out;
}

function ensureNl(s: string): string {
  return s === "" || s.endsWith("\n") ? s : `${s}\n`;
}

/** Writes an upgrade plan (merged files, conflict markers included) and moves the lock entry. */
export async function applyUpgrade(fs: KitFs, plan: UpgradePlan, opts: { now?: string } = {}): Promise<{ changed_files: string[] }> {
  const writes: { path: string; bytes: Uint8Array }[] = [];
  for (const f of plan.files) {
    const n = normalizeRelative(f.path);
    if (n === null || n !== f.path || forbiddenTarget(n, plan.block_id.split("/")[1]!)) throw new KitError("forbidden", `upgrade writes ${f.path}`);
    const bytes = base64Decode(f.content_b64);
    if ((await sha256Hex(bytes)) !== f.after_sha256) throw new KitError("plan_stale", `content for ${n} does not match its hash`);
    assertContainerPackage(n, bytes);
    const cur = await fs.readFile(n);
    if ((cur === null ? null : await sha256Hex(cur)) !== f.before_sha256) throw new KitError("plan_stale", `${n} changed since the upgrade was planned`);
    writes.push({ path: n, bytes });
  }
  for (const w of writes) await fs.writeFile(w.path, w.bytes);
  const entry = { ...plan.next_entry, installed_at: (opts.now ?? new Date().toISOString()).replace(/\.\d+Z$/, "Z") };
  await writeLock(fs, upsertLockEntry(await readLock(fs), plan.block_id, entry));
  return { changed_files: [...writes.map((w) => w.path), LOCK_PATH] };
}
