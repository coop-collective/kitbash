/** Offline commands: init, harvest, validate. */
import path from "node:path";
import {
  KitError,
  detectStack,
  harvestDraft,
  newProjectId,
  parseJsonc,
  publishAllowed,
  readProfile,
  readText,
  validateBlock,
  writeProfile,
  type Finding,
} from "@kitbash/core";
import { readBlockDir, readTree, writeTree } from "@kitbash/core/node";
import { bool, list, need, stack, str, type Parsed } from "../args.ts";
import { json, line, sanitizeLine, type Io } from "../io.ts";
import { openProject } from "../project.ts";

// ---------- init ----------

export const initOptions = { telemetry: { type: "boolean" }, force: { type: "boolean" } } as const;

export async function init(io: Io, a: Parsed): Promise<number> {
  const p = await openProject(io, str(a, "root"));
  const existing = await readProfile(p.fs);
  if (existing && !bool(a, "force")) {
    if (bool(a, "telemetry") && !existing.telemetry) await writeProfile(p.fs, { ...existing, telemetry: true });
    const profile = (await readProfile(p.fs))!;
    if (bool(a, "json")) json(io, { profile, created: false, notes: [] });
    else line(io, `.kit/project.json already exists (project ${profile.project_id}); use --force to re-detect the stack`);
    return 0;
  }
  const { notes, ...detected } = await detectStack(p.fs);
  const profile = {
    project_id: existing?.project_id ?? newProjectId(),
    ...detected,
    ...(bool(a, "telemetry") ? { telemetry: true } : existing?.telemetry !== undefined ? { telemetry: existing.telemetry } : {}),
  };
  await writeProfile(p.fs, profile);
  if (bool(a, "json")) json(io, { profile, created: true, notes });
  else {
    line(io, `wrote .kit/project.json (project ${profile.project_id})`);
    line(io, `stack: ${Object.entries(profile.stack).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    line(io, `paths: ${Object.entries(profile.paths).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    line(io, `migrations: ${profile.migrations.pattern}${profile.migrations.width ? ` (width ${profile.migrations.width})` : ""}`);
    line(io, `telemetry: ${profile.telemetry ? "on (daily heartbeat with the lock's block list only)" : "off (kit init --telemetry to opt in)"}`);
    for (const n of notes) line(io, `note: ${sanitizeLine(n)}`);
  }
  return 0;
}

// ---------- harvest ----------

export const harvestOptions = {
  name: { type: "string" },
  paths: { type: "string", multiple: true },
  desc: { type: "string" },
  description: { type: "string" },
  stack: { type: "string", multiple: true },
  hint: { type: "string", multiple: true },
  force: { type: "boolean" },
} as const;

export async function harvest(io: Io, a: Parsed): Promise<number> {
  const name = str(a, "name");
  const description = str(a, "desc") ?? str(a, "description");
  const paths = [...list(a, "paths"), ...a.positionals];
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name) || name.length > 64) throw new KitError("invalid_params", "--name must be a slug (a-z, 0-9, -)");
  if (!description) throw new KitError("invalid_params", "--desc is required");
  if (!paths.length) throw new KitError("invalid_params", "--paths is required (files or directories, project-relative)");
  const p = await openProject(io, str(a, "root"));
  const draftDir = `.kit/drafts/${name}`;
  if ((await p.fs.list(draftDir)) && !bool(a, "force")) throw new KitError("invalid_params", `${draftDir} exists; pass --force to overwrite`);
  const files = await readTree(p.fs, paths);
  if (!Object.keys(files).length) throw new KitError("not_found", `nothing found under ${paths.join(", ")}`);
  const profile = (await readProfile(p.fs)) ?? undefined;
  const pkgText = await readText(p.fs, "package.json");
  let packageJson: { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | undefined;
  try {
    packageJson = pkgText ? (JSON.parse(pkgText) as typeof packageJson) : undefined;
  } catch {
    packageJson = undefined;
  }
  let wrangler: unknown;
  for (const f of [profile?.config?.wrangler, "wrangler.jsonc", "wrangler.json"]) {
    if (!f) continue;
    const t = await readText(p.fs, f);
    if (t === null) continue;
    try {
      wrangler = parseJsonc(t);
    } catch {
      wrangler = undefined;
    }
    break;
  }
  const hints: Record<string, string> = {};
  for (const h of list(a, "hint", false)) {
    const i = h.indexOf("=");
    if (i <= 0) throw new KitError("invalid_params", `--hint expects literal=paramName, got ${JSON.stringify(h)}`);
    hints[h.slice(0, i)] = h.slice(i + 1);
  }
  const st = stack(a);
  const res = harvestDraft({
    name,
    description,
    files,
    ...(profile ? { profile } : {}),
    ...(st ? { stack: st } : {}),
    ...(Object.keys(hints).length ? { paramsHints: hints } : {}),
    ...(packageJson ? { packageJson } : {}),
    ...(wrangler !== undefined ? { wrangler } : {}),
    now: io.now().replace(/\.\d+Z$/, "Z"),
  });
  await writeTree(p.fs, draftDir, { ...res.files, "block.json": `${JSON.stringify(res.manifest, null, 2)}\n` });
  if (bool(a, "json")) json(io, { draft_dir: draftDir, manifest: res.manifest, redactions: res.redactions, todo: res.todo });
  else {
    line(io, `draft written to ${draftDir}/ (${Object.keys(res.files).length + 1} files)`);
    for (const r of res.redactions) line(io, `redacted: ${sanitizeLine(r.path)} (${sanitizeLine(r.kind)}${r.count > 1 ? ` x${r.count}` : ""})`);
    line(io, "todo:");
    for (const t of res.todo) line(io, `  - ${sanitizeLine(t)}`);
    line(io, `then: kit validate ${draftDir}`);
  }
  return 0;
}

// ---------- validate ----------

export const validateOptions = { public: { type: "boolean" } } as const;

export function printFindings(io: Io, findings: readonly Finding[]): void {
  for (const f of findings) {
    if (f.severity === "info") continue;
    line(io, `  ${f.severity.padEnd(5)} ${sanitizeLine(f.rule)} ${sanitizeLine(f.path)}${f.line ? `:${f.line}` : ""}: ${sanitizeLine(f.detail)}`);
  }
}

export async function validate(io: Io, a: Parsed): Promise<number> {
  const dir = path.resolve(io.cwd, need(a, 0, "block directory"));
  const bundle = await readBlockDir(dir);
  const v = await validateBlock(bundle);
  const ok = bool(a, "public") ? publishAllowed(v.findings, "public") : v.ok;
  if (bool(a, "json")) json(io, { ok, findings: v.findings, ...(v.size ? { size: v.size } : {}) });
  else {
    const counts = { block: 0, warn: 0, info: 0 };
    for (const f of v.findings) counts[f.severity]++;
    line(io, `${ok ? "valid" : "INVALID"}: ${sanitizeLine(path.relative(io.cwd, dir) || ".")} (${counts.block} blocking, ${counts.warn} warnings${v.size ? `; ${v.size.files} files, ${v.size.lines} lines` : ""})`);
    printFindings(io, v.findings);
  }
  return ok ? 0 : 1;
}
