/**
 * Commands on an installed block (read from `.kit/lock.json`): verify, diff, upgrade, propose, adapt, status.
 */
import {
  DEFAULT_PATHS,
  KitError,
  applyUpgrade,
  diffAgainstLock,
  loadPlan,
  parseBlockRef,
  pendingRequiredAdapt,
  planUpgrade,
  readLock,
  readProfile,
  readProjectForPlan,
  recordVerify,
  redactSecrets,
  renderInstalled,
  renderTemplate,
  setAdaptStatus,
  tryDecodeUtf8,
  unifiedDiff,
  unrender,
  validateManifest,
  writeLock,
  writeText,
  type FileTree,
  type LockEntryT,
  type ProjectProfile,
} from "@kitbash/core";
import { bool, int, list, need, oneOf, str, type Parsed } from "../args.ts";
import { apiFor, installedEntry, loadInstalled } from "../context.ts";
import { json, line, sanitize, sanitizeLine, untrusted, type Io } from "../io.ts";
import { openProject, recordSource, type Project } from "../project.ts";
import { fetchRegistryBlock, loadLocalBlock } from "../source.ts";
import { runVerifyCommands } from "../verify.ts";

async function profileOf(p: Project): Promise<ProjectProfile> {
  const pr = await readProfile(p.fs);
  if (!pr) throw new KitError("not_found", "no .kit/project.json: run kit init (or install a block first)");
  return pr;
}

function blockIdArg(a: Parsed): string {
  const ref = parseBlockRef(need(a, 0, "block id (@scope/name)"));
  return ref.id;
}

async function readTargets(p: Project, entry: LockEntryT): Promise<FileTree> {
  const out: FileTree = {};
  for (const f of entry.files) {
    const b = await p.fs.readFile(f.target);
    if (b !== null) out[f.target] = b;
  }
  return out;
}

// ---------- verify ----------

export const verifyOptions = { command: { type: "string", multiple: true }, timeout: { type: "string" }, from: { type: "string" } } as const;

/** The declared verify commands (rendered) and the required adapt ids of an installed block. */
async function declaredVerify(io: Io, p: Project, blockId: string, entry: LockEntryT, profile: ProjectProfile, from?: string): Promise<{ commands: string[]; required: string[] }> {
  if (entry.plan_id && !from) {
    try {
      const plan = await loadPlan(p.fs, entry.plan_id);
      if (plan.kit.manifest_sha256 === entry.manifest_sha256 && plan.kit.block_id === blockId) return { commands: plan.verify.commands, required: plan.kit.adapt_required };
    } catch {
      /* fall back to the block source */
    }
  }
  const b = await loadInstalled(io, p, blockId, entry, from);
  const v = validateManifest(b.bundle.manifest);
  if (!v.manifest) throw new KitError("invalid_params", `${blockId}: the installed manifest does not validate`);
  const paths = { ...DEFAULT_PATHS, ...profile.paths };
  const commands = (v.manifest.verify?.commands ?? []).map((c) => renderTemplate(c, { params: entry.params, paths }));
  return { commands, required: (v.manifest.agent?.adapt ?? []).filter((x) => x.required).map((x) => x.id) };
}

export async function verify(io: Io, a: Parsed): Promise<number> {
  const blockId = blockIdArg(a);
  const p = await openProject(io, str(a, "root"));
  const profile = await profileOf(p);
  const entry = await installedEntry(p, blockId);
  const timeoutMs = (int(str(a, "timeout"), "--timeout", 1, 3600) ?? 600) * 1000;
  const declared = await declaredVerify(io, p, blockId, entry, profile, str(a, "from"));
  const asked = list(a, "command", false);
  const commands = asked.length ? asked : declared.commands;
  if (!commands.length) throw new KitError("invalid_params", `${blockId} declares no verify commands`);
  const quiet = bool(a, "json");
  if (!quiet) {
    line(io, `kit verify ${blockId}: ${commands.length} allowlisted command(s), cwd ${p.root}, no shell:`);
    for (const c of commands) line(io, `  $ ${sanitizeLine(c)}`);
  }
  const r = await runVerifyCommands(commands, {
    root: p.root,
    env: io.env,
    runner: io.runner,
    timeoutMs,
    ...(quiet ? {} : { onStart: (c: string) => line(io, `running: ${sanitizeLine(c)}`) }),
  });
  const lock = recordVerify(await readLock(p.fs), blockId, r.passed, io.now().replace(/\.\d+Z$/, "Z"));
  await writeLock(p.fs, lock);
  const pending = pendingRequiredAdapt(lock.blocks[blockId]!, declared.required);
  const out = { ...r, ...(pending.length ? { pending_required_adapt: pending } : {}) };
  if (quiet) json(io, out);
  else {
    for (const x of r.results) {
      if (x.skipped) line(io, `SKIPPED ${sanitizeLine(x.command)}: ${sanitizeLine(x.skipped)}`);
      else {
        line(io, `${x.exit === 0 ? "PASS" : "FAIL"} (exit ${x.exit}) ${sanitizeLine(x.command)}`);
        if (x.exit !== 0 && x.tail) line(io, x.tail.split("\n").map((l) => `    ${sanitize(l)}`).join("\n"));
      }
    }
    line(io, `${r.passed ? "passed" : "failed"} in ${r.duration_ms} ms; recorded in .kit/lock.json`);
    if (pending.length) line(io, `warning: required adapt items still pending: ${pending.join(", ")} (mark with kit adapt ${blockId} <id>)`);
  }
  return r.passed ? 0 : 1;
}

// ---------- diff ----------

export const diffOptions = { from: { type: "string" } } as const;

function slug(blockId: string): string {
  return blockId.slice(1).replace("/", "__");
}

export async function diff(io: Io, a: Parsed): Promise<number> {
  const blockId = blockIdArg(a);
  const p = await openProject(io, str(a, "root"));
  const profile = await profileOf(p);
  const entry = await installedEntry(p, blockId);
  const b = await loadInstalled(io, p, blockId, entry, str(a, "from"));
  const rendered = renderInstalled(b.bundle, entry, profile, blockId);
  const changes = await diffAgainstLock(entry, await readTargets(p, entry), rendered);
  const text = changes.map((c) => c.diff ?? "").join("");
  const diffPath = `.kit/plans/local-${slug(blockId)}.diff`;
  await writeText(p.fs, diffPath, text);
  const changed = changes.map(({ path, status }) => ({ path, status }));
  if (bool(a, "json")) json(io, { changed, diff_path: diffPath });
  else {
    const touched = changes.filter((c) => c.status !== "unchanged");
    line(io, `${blockId}@${entry.version}: ${touched.length} of ${changes.length} tracked file(s) changed since install`);
    for (const c of touched) line(io, `  ${c.status.padEnd(9)} ${sanitizeLine(c.path)}`);
    if (text) line(io, sanitize(text).trimEnd());
    line(io, `diff: ${diffPath}`);
  }
  return 0;
}

// ---------- upgrade ----------

export const upgradeOptions = { to: { type: "string" }, "to-dir": { type: "string" }, from: { type: "string" }, apply: { type: "boolean" } } as const;

export async function upgrade(io: Io, a: Parsed): Promise<number> {
  const blockId = blockIdArg(a);
  const p = await openProject(io, str(a, "root"));
  const profile = await profileOf(p);
  const entry = await installedEntry(p, blockId);
  const old = await loadInstalled(io, p, blockId, entry, str(a, "from"));
  const toDir = str(a, "to-dir");
  let next;
  if (toDir) next = await loadLocalBlock(io, toDir, { id: blockId });
  else if (blockId.startsWith("@local/")) throw new KitError("invalid_params", `${blockId} is a local block: pass --to-dir <new version's dir>`);
  else {
    const { api, settings } = await apiFor(io);
    next = await fetchRegistryBlock(api, settings.registryPublicKey, blockId, { ...(str(a, "to") ? { version: str(a, "to")! } : {}), variant: entry.variant });
  }
  const current = await readProjectForPlan(p.fs, { bundle: next.bundle, profile, params: entry.params, variant: entry.variant, blockId });
  Object.assign(current, await readTargets(p, entry));
  const up = await planUpgrade({
    oldBundle: old.bundle,
    newBundle: next.bundle,
    entry,
    blockId,
    profile,
    current,
    ...(profile.migrations.pattern === "TIMESTAMP_name.sql" ? { now: io.now() } : {}),
    registrySignature: next.registrySignature,
  });
  const summary = {
    from: up.from,
    to: up.to,
    clean: up.clean,
    conflicted: up.conflicted,
    added: up.added,
    removed: up.removed,
    migrations: up.migrations,
    changelog_upgrade_section: up.changelog_upgrade_section,
    new_adapt: up.new_adapt,
  };
  let changed: string[] = [];
  if (bool(a, "apply")) {
    changed = (await applyUpgrade(p.fs, up, { now: io.now() })).changed_files;
    await recordSource(p, blockId, next.origin.kind === "local" ? { kind: "local", path: next.origin.dir } : { kind: "registry" });
  }
  if (bool(a, "json")) json(io, bool(a, "apply") ? { ...summary, applied: true, changed_files: changed } : summary);
  else {
    line(io, `${blockId}: ${up.from} → ${up.to}${bool(a, "apply") ? " (applied)" : " (dry run; nothing written)"}`);
    line(io, `clean (${up.clean.length}): ${up.clean.map((x) => sanitizeLine(x)).join(", ") || "-"}`);
    line(io, `conflicted (${up.conflicted.length}): ${up.conflicted.map((x) => sanitizeLine(x.path)).join(", ") || "-"}`);
    if (up.added.length) line(io, `added: ${up.added.map((x) => sanitizeLine(x)).join(", ")}`);
    if (up.removed.length) line(io, `no longer in the block (left in place): ${up.removed.map((x) => sanitizeLine(x)).join(", ")}`);
    if (Object.keys(up.migrations).length) line(io, `new migrations: ${Object.entries(up.migrations).map(([x, y]) => `${x} → ${y}`).join(", ")}`);
    for (const w of up.warnings) line(io, `warning: ${sanitizeLine(w)}`);
    if (up.new_adapt.length) line(io, `new adapt items: ${up.new_adapt.map((x) => `${x.id}${x.required ? " (required)" : ""}`).join(", ")}`);
    if (up.changelog_upgrade_section) line(io, untrusted([`upgrade notes (CHANGELOG):`, up.changelog_upgrade_section]));
    if (bool(a, "apply")) {
      if (up.conflicted.length) line(io, `resolve the <<<<<<< markers in ${up.conflicted.map((x) => x.path).join(", ")}, then kit verify ${blockId}`);
      else line(io, `then: kit verify ${blockId}`);
    } else line(io, `apply with: kit upgrade ${blockId}${str(a, "to") ? ` --to ${str(a, "to")}` : ""}${toDir ? ` --to-dir ${toDir}` : ""} --apply`);
  }
  return 0;
}

// ---------- propose ----------

export const proposeOptions = { title: { type: "string" }, why: { type: "string" }, from: { type: "string" }, "dry-run": { type: "boolean" } } as const;

export async function propose(io: Io, a: Parsed): Promise<number> {
  const blockId = blockIdArg(a);
  const title = str(a, "title");
  const why = str(a, "why");
  if (!title || !why) throw new KitError("invalid_params", "kit propose needs --title and --why");
  const p = await openProject(io, str(a, "root"));
  const profile = await profileOf(p);
  const entry = await installedEntry(p, blockId);
  const b = await loadInstalled(io, p, blockId, entry, str(a, "from"));
  const rendered = renderInstalled(b.bundle, entry, profile, blockId);
  const current = await readTargets(p, entry);
  const changes = await diffAgainstLock(entry, current, rendered);
  const byTarget = new Map(entry.files.map((f) => [f.target, f.block_path]));
  let patch = "";
  for (const c of changes) {
    if (c.status !== "modified") continue;
    const base = tryDecodeUtf8(rendered[c.path] ?? "");
    const ours = tryDecodeUtf8(current[c.path] ?? "");
    if (base === null || ours === null) continue;
    // un-render: the project's param values become {{kit.<param>}} again, on both sides, so the hunks are about the block
    patch += unifiedDiff(byTarget.get(c.path) ?? c.path, unrender(base, entry.params).text, unrender(ours, entry.params).text);
  }
  const red = redactSecrets(patch);
  patch = red.text;
  const redactions = red.redactions.map((r) => `${r.kind} x${r.count}`);
  const hunks = (patch.match(/^@@ /gm) ?? []).length;
  const patchPath = `.kit/plans/proposal-${slug(blockId)}.patch`;
  if (!hunks) {
    if (bool(a, "json")) json(io, { proposal_id: null, hunks: 0, redactions: [] });
    else line(io, `${blockId}: no local changes to the block's files; nothing to propose`);
    return 0;
  }
  await writeText(p.fs, patchPath, patch);
  let proposalId: string | null = null;
  const local = blockId.startsWith("@local/");
  if (!bool(a, "dry-run") && !local) {
    const { api } = await apiFor(io);
    const r = await api.propose({ block: `${blockId}@${entry.version}`, variant: entry.variant, title, rationale: why, patch, stack: profile.stack, redactions });
    proposalId = r.proposal_id;
  }
  if (bool(a, "json")) json(io, { proposal_id: proposalId, hunks, redactions, patch_path: patchPath });
  else {
    line(io, `${hunks} hunk(s) against ${blockId}@${entry.version}, params un-rendered; patch: ${patchPath}`);
    if (redactions.length) line(io, `redacted: ${redactions.join(", ")}`);
    line(io, proposalId ? `proposal ${sanitizeLine(proposalId)} submitted` : local ? "local block: not submitted (no registry); the patch is on disk" : "dry run: not submitted");
  }
  return 0;
}

// ---------- adapt ----------

export const adaptOptions = { status: { type: "string" } } as const;

export async function adapt(io: Io, a: Parsed): Promise<number> {
  const blockId = blockIdArg(a);
  const id = need(a, 1, "adapt item id");
  const status = oneOf(str(a, "status"), ["done", "pending", "skipped"] as const, "--status") ?? "done";
  const p = await openProject(io, str(a, "root"));
  const lock = setAdaptStatus(await readLock(p.fs), blockId, id, status);
  await writeLock(p.fs, lock);
  if (bool(a, "json")) json(io, { block: blockId, adapt: lock.blocks[blockId]!.adapt });
  else line(io, `${blockId}: ${id} → ${status}`);
  return 0;
}

// ---------- status ----------

export async function status(io: Io, a: Parsed): Promise<number> {
  const p = await openProject(io, str(a, "root"));
  const profile = await readProfile(p.fs);
  const lock = await readLock(p.fs);
  const blocks = [];
  for (const [id, e] of Object.entries(lock.blocks).sort(([x], [y]) => x.localeCompare(y))) {
    const changes = await diffAgainstLock(e, await readTargets(p, e));
    blocks.push({
      id,
      version: e.version,
      variant: e.variant,
      installed_at: e.installed_at,
      verify: e.verify ?? null,
      adapt_pending: Object.entries(e.adapt).filter(([, s]) => s === "pending").map(([k]) => k),
      modified: changes.filter((c) => c.status !== "unchanged").map((c) => ({ path: c.path, status: c.status })),
    });
  }
  if (bool(a, "json")) json(io, { project: profile ? { project_id: profile.project_id, stack: profile.stack, telemetry: profile.telemetry ?? false } : null, blocks });
  else {
    line(io, profile ? `project ${profile.project_id} · ${Object.values(profile.stack).filter(Boolean).join("/")} · telemetry ${profile.telemetry ? "on" : "off"}` : "no .kit/project.json (run kit init)");
    if (!blocks.length) line(io, "no blocks installed");
    for (const b of blocks) {
      const v = b.verify?.passed === true ? "verified" : b.verify?.passed === false ? "verify FAILED" : "not verified";
      line(io, `${b.id}@${b.version} (${sanitizeLine(b.variant)}) · ${v} · adapt pending: ${b.adapt_pending.join(", ") || "none"} · ${b.modified.length} file(s) changed`);
    }
  }
  return 0;
}
