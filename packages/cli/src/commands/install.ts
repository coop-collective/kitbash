/**
 * `kit install <block|dir>` (dry run by default: the plan and its diff go to `.kit/plans/`, no project file is
 * written), `kit install … --apply [--plan-id <id>]` (re-plans; with `--plan-id`, refuses unless the new plan is the
 * reviewed one), and `kit apply <plan_id>` (applies the saved plan after checking its id still matches its content).
 */
import {
  KitError,
  applyPlan,
  errorEnvelope,
  loadPlan,
  planInstall,
  readLock,
  readProjectForPlan,
  readText,
  savePlan,
  toContractPlan,
  writeText,
  type AppliedPlanT,
  type InstallPlan,
  type OnConflict,
} from "@kitbash/core";
import { bool, need, oneOf, params as parseParams, str, type Parsed } from "../args.ts";
import { apiFor, assertPlanPinned } from "../context.ts";
import { json, line, sanitize, sanitizeLine, untrustedEnvelope, type Io } from "../io.ts";
import { ensureProfile, openProject, recordSource, type BlockSource, type Project } from "../project.ts";
import { fetchRegistryBlock, isLocalSpec, loadLocalBlock, type ResolvedBlock } from "../source.ts";

export const installOptions = {
  version: { type: "string" },
  variant: { type: "string" },
  param: { type: "string", multiple: true },
  apply: { type: "boolean" },
  "plan-id": { type: "string" },
  "on-conflict": { type: "string" },
  "no-config": { type: "boolean" },
  id: { type: "string" },
} as const;

export async function resolveBlock(io: Io, spec: string, a: { version?: string; variant?: string; id?: string }): Promise<ResolvedBlock> {
  if (isLocalSpec(spec)) {
    if (a.version) throw new KitError("invalid_params", "--version applies to registry blocks only");
    return loadLocalBlock(io, spec, a.id ? { id: a.id } : {});
  }
  if (a.id) throw new KitError("invalid_params", "--id applies to local block directories only");
  const { api, settings } = await apiFor(io);
  return fetchRegistryBlock(api, settings.registryPublicKey, spec, { ...(a.version ? { version: a.version } : {}), ...(a.variant ? { variant: a.variant } : {}) });
}

function sourceOf(b: ResolvedBlock): BlockSource {
  return b.origin.kind === "local" ? { kind: "local", path: b.origin.dir } : { kind: "registry" };
}

const sidecar = (planId: string) => `.kit/plans/${planId}.source.json`;

export async function install(io: Io, a: Parsed): Promise<number> {
  const spec = need(a, 0, "block reference or block directory");
  const onConflict = (oneOf(str(a, "on-conflict"), ["stop", "skip", "overwrite", "rename"] as const, "--on-conflict") ?? "stop") as OnConflict;
  const p = await openProject(io, str(a, "root"));
  const { profile, created, notes } = await ensureProfile(p, { write: true });
  const variant = str(a, "variant");
  const block = await resolveBlock(io, spec, { version: str(a, "version"), variant, id: str(a, "id") });
  const params = parseParams(a);
  const lock = await readLock(p.fs);
  const project = await readProjectForPlan(p.fs, { bundle: block.bundle, profile, params, ...(variant ? { variant } : {}), blockId: block.blockId });
  const plan = await planInstall({
    bundle: block.bundle,
    blockId: block.blockId,
    profile,
    project,
    lock,
    params,
    ...(variant ? { variant } : {}),
    onConflict,
    applyConfig: !bool(a, "no-config"),
    ...(profile.migrations.pattern === "TIMESTAMP_name.sql" ? { now: io.now() } : {}),
    registrySignature: block.registrySignature,
  });
  await savePlan(p.fs, plan);
  await writeText(p.fs, sidecar(plan.plan_id), `${JSON.stringify(sourceOf(block))}\n`);

  if (!bool(a, "apply")) {
    if (bool(a, "json")) json(io, toContractPlan(plan));
    else {
      if (created) line(io, `created .kit/project.json (stack detected${notes.length ? `; ${notes.map((n) => sanitizeLine(n)).join("; ")}` : ""})`);
      for (const f of block.findings) line(io, `scan ${f.severity}: ${sanitizeLine(f.rule)} ${sanitizeLine(f.path)}: ${sanitizeLine(f.detail)}`);
      printPlan(io, plan);
      line(io);
      line(io, plan.conflicts.length ? "Not applicable until the conflicts are resolved." : `Dry run: nothing was written outside .kit/. Review the diff, then: kit apply ${plan.plan_id}`);
    }
    return plan.conflicts.length ? 1 : 0;
  }

  const pinned = str(a, "plan-id");
  if (pinned && pinned !== plan.plan_id) {
    throw new KitError("plan_stale", `the block or the project changed since ${pinned} was reviewed; the new plan is ${plan.plan_id} (see ${plan.diff_preview_path}); nothing written`);
  }
  return doApply(io, p, plan, sourceOf(block), a);
}

export async function apply(io: Io, a: Parsed): Promise<number> {
  const planId = need(a, 0, "plan id");
  const p = await openProject(io, str(a, "root"));
  const plan = await loadPlan(p.fs, planId);
  await assertPlanPinned(plan);
  let src: BlockSource | undefined;
  const s = await readText(p.fs, sidecar(planId));
  if (s) {
    try {
      src = JSON.parse(s) as BlockSource;
    } catch {
      src = undefined;
    }
  }
  return doApply(io, p, plan, src, a);
}

async function doApply(io: Io, p: Project, plan: InstallPlan, src: BlockSource | undefined, a: Parsed): Promise<number> {
  if (plan.conflicts.length) {
    if (bool(a, "json")) json(io, errorEnvelope("conflicts", `${plan.conflicts.length} conflict(s); nothing written.`, { conflicts: plan.conflicts }));
    else {
      printConflicts(io, plan);
      line(io, "nothing written.");
    }
    return 1;
  }
  const applied = await applyPlan(p.fs, plan, { now: io.now() });
  if (src && (src.kind === "registry" || src.kind === "local")) await recordSource(p, plan.kit.block_id, src);
  if (bool(a, "json")) json(io, applied);
  else printApplied(io, applied);
  return 0;
}

function printConflicts(io: Io, plan: { conflicts: InstallPlan["conflicts"] }): void {
  line(io, `conflicts (${plan.conflicts.length}):`);
  for (const c of plan.conflicts) {
    line(io, `  ${c.kind} ${sanitizeLine(c.name)}: ${sanitizeLine(c.detail)}${c.resolve_with_param ? `  → rerun with --param ${c.resolve_with_param}=<value>` : ""}`);
  }
}

export function printPlan(io: Io, plan: InstallPlan): void {
  line(io, `Plan ${plan.plan_id} for ${plan.block} (variant ${sanitizeLine(plan.variant)})`);
  const inferred = new Set(plan.inferred ?? []);
  const ps = Object.entries(plan.params);
  if (ps.length) line(io, `params: ${ps.map(([k, v]) => `${k}=${sanitizeLine(JSON.stringify(v))}${inferred.has(k) ? " (inferred)" : ""}`).join(", ")}`);
  line(io, `writes (${plan.writes.length}; config and dependencies first):`);
  for (const w of plan.writes) {
    const extra = [
      w.role ? `role ${w.role}` : "",
      w.from ? `from ${w.from}` : "",
      w.merge ? w.merge : "",
      w.hunks !== undefined ? `${w.hunks} hunk${w.hunks === 1 ? "" : "s"}` : "",
      w.bytes !== undefined ? `${w.bytes} bytes` : "",
      w.lines?.length ? `+${w.lines.length} line${w.lines.length === 1 ? "" : "s"}: ${w.lines.map((l) => l.replace(/=.*/, "=")).join(" ")}` : "",
      w.reason ? w.reason : "",
    ].filter(Boolean);
    line(io, `  ${w.action.padEnd(9)} ${sanitizeLine(w.path)}${extra.length ? `  (${sanitizeLine(extra.join(", "))})` : ""}`);
  }
  if (plan.migrations && Object.keys(plan.migrations).length) {
    line(io, `migrations: ${Object.entries(plan.migrations).map(([a, b]) => `${a} → ${b}`).join(", ")}`);
  }
  if (plan.conflicts.length) printConflicts(io, plan);
  else line(io, "conflicts: none");
  for (const w of plan.warnings) line(io, `warning: ${sanitizeLine(w)}`);
  const deps = { ...plan.dependencies_to_add, ...(plan.dev_dependencies_to_add ?? {}) };
  if (Object.keys(deps).length) line(io, `dependencies to add: ${Object.entries(deps).map(([k, v]) => `${k}@${v}`).join(", ")}`);
  line(io, `verify (allowlisted; run with kit verify): ${plan.verify.commands.length ? plan.verify.commands.map((c) => sanitizeLine(c)).join(" ; ") : "(none)"}`);
  for (const s of plan.verify.skipped ?? []) line(io, `verify skipped (never run): ${sanitizeLine(s.command)} (${sanitizeLine(s.reason)})`);
  if (plan.adapt.length) line(io, `adapt: ${plan.adapt.map((x) => `${x.id}${x.required ? " (required)" : ""}`).join(", ")}`);
  const u = untrustedEnvelope(plan.untrusted_author_text as unknown as Record<string, unknown>);
  if (u) line(io, u);
  const diffLines = plan.kit.diff ? plan.kit.diff.split("\n").length : 0;
  line(io, `diff: ${plan.diff_preview_path} (${diffLines} lines)`);
}

function printApplied(io: Io, r: AppliedPlanT): void {
  line(io, `Applied ${r.plan_id}: ${r.block} (variant ${sanitizeLine(r.variant)})`);
  line(io, `changed files (${r.changed_files.length}):`);
  for (const f of r.changed_files) line(io, `  ${sanitizeLine(f)}`);
  const deps = { ...r.dependencies_to_add, ...(r.dev_dependencies_to_add ?? {}) };
  if (Object.keys(deps).length) line(io, `package.json now lists ${Object.keys(deps).join(", ")}: run your package manager's install.`);
  if (r.adapt.length) {
    line(io, "adapt checklist (mark each with kit adapt <block> <id>):");
    for (const x of r.adapt) line(io, `  [ ] ${x.id}${x.required ? " (required)" : ""}`);
  }
  const u = untrustedEnvelope({ notice: "", adapt: r.untrusted_author_text.adapt, author_notes: r.untrusted_author_text.author_notes });
  if (u) line(io, u);
  line(io, `then: kit verify ${sanitize(r.block.slice(0, r.block.lastIndexOf("@")))}`);
}
