/**
 * The install planner (BLOCK-SPEC §6). `planInstall()` is pure: it takes the bundle, the project profile, the lock
 * and an in-memory snapshot of the project files it needs (`readProjectForPlan()` collects them through the fs
 * adapter) and returns an `InstallPlan`. `applyPlan(fs, plan)` is the only writer.
 *
 * Determinism: same bundle + params + profile + project snapshot (+ `now` for timestamp migrations) gives a
 * byte-identical plan, including `plan_id` (a hash of the plan).
 */
import semver from "semver";
import * as jsonc from "jsonc-parser";
import { mergeJsonc, appendMissingLines, detectFormatting, WRANGLER_FORBIDDEN_KEYS } from "./config-merge.ts";
import {
  UNTRUSTED_NOTICE,
  type AppliedPlanT,
  type ConflictT,
  type LockEntryT,
  type PlanT,
  type UntrustedAuthorTextT,
  type WriteT,
} from "./contract.ts";
import { hunkCount, unifiedDiff } from "./diff.ts";
import { KitError } from "./errors.ts";
import type { BlockBundle, FileTree, KitFs } from "./fs.ts";
import { base64Decode, base64Encode, canonicalJson, isText, manifestSha256, sha256Hex, toBytes, tryDecodeUtf8, type FileData } from "./hash.ts";
import { readLock, upsertLockEntry, writeLock, LOCK_PATH, type Lock } from "./lock.ts";
import { basename, dirname, forbiddenTarget, normalizeRelative } from "./paths.ts";
import { parseJsonc, ProjectProfileSchema, type ProjectProfile } from "./profile.ts";
import { pinnedRef, BLOCK_ID_RE } from "./ref.ts";
import { evaluateCondition, referencedParams, renderTemplate, resolveParams, type ParamValues } from "./render.ts";
import { bundlePath, defaultVariant, filesForVariant, validateManifest, type FileEntry, type Manifest, type Variant } from "./schema.ts";
import { checkVerifyCommand } from "./verify.ts";

export type OnConflict = "stop" | "skip" | "overwrite" | "rename";

export interface PlanInput {
  bundle: BlockBundle;
  /** `@scope/name`; defaults to `@local/<manifest.name>`. */
  blockId?: string;
  profile: ProjectProfile;
  /** Project files the planner may read (see `readProjectForPlan`). A path absent here is treated as absent. */
  project: FileTree;
  lock?: Lock | null;
  params?: Record<string, unknown>;
  variant?: string;
  onConflict?: OnConflict;
  applyConfig?: boolean;
  /** ISO time; required when the project uses timestamp migrations. */
  now?: string;
  /** The registry co-signature to record in the lock (empty for local installs). */
  registrySignature?: string;
}

/** One file the plan writes, with its full new content (base64) and the hash of what it replaces. */
export interface PlannedFile {
  path: string;
  action: "create" | "patch" | "append" | "overwrite" | "rename";
  role: string;
  /** The block-relative path (`files[].path`) or `package.json` for the dependency patch. */
  block_path: string;
  /** null when the file must not exist at apply time. */
  before_sha256: string | null;
  after_sha256: string;
  content_b64: string;
  /** Whether the lock tracks this file for diff/upgrade/propose (block files yes; merged config no). */
  tracked: boolean;
  /** An identical file already exists: tracked in the lock, not written. */
  skip?: boolean;
}

export interface InstallPlan extends PlanT {
  kit: {
    format: 1;
    block_id: string;
    block_name: string;
    version: string;
    manifest_sha256: string;
    registry_signature: string;
    project_id: string;
    files: PlannedFile[];
    on_conflict: Record<string, "skip" | "overwrite" | "rename">;
    interface: { tables: string[]; routes: string[]; bindings: string[] };
    adapt_required: string[];
    diff: string;
  };
}

/** The contract shape (what the agent sees): the plan without file contents. */
export function toContractPlan(plan: InstallPlan): PlanT {
  const { kit: _kit, ...rest } = plan;
  return rest;
}

// ---------- helpers ----------

const WRANGLER_TYPE_KEYS: Record<string, { key: string[]; nameField: string }> = {
  d1: { key: ["d1_databases"], nameField: "binding" },
  kv: { key: ["kv_namespaces"], nameField: "binding" },
  r2: { key: ["r2_buckets"], nameField: "binding" },
  send_email: { key: ["send_email"], nameField: "name" },
  queue: { key: ["queues", "producers"], nameField: "binding" },
  durable_object: { key: ["durable_objects", "bindings"], nameField: "name" },
  service: { key: ["services"], nameField: "binding" },
  ai: { key: ["ai"], nameField: "binding" },
  vectorize: { key: ["vectorize"], nameField: "binding" },
  analytics_engine: { key: ["analytics_engine_datasets"], nameField: "binding" },
  hyperdrive: { key: ["hyperdrive"], nameField: "binding" },
  rate_limit: { key: ["ratelimits"], nameField: "name" },
  browser: { key: ["browser"], nameField: "binding" },
  workflow: { key: ["workflows"], nameField: "binding" },
  images: { key: ["images"], nameField: "binding" },
  assets: { key: ["assets"], nameField: "binding" },
  version_metadata: { key: ["version_metadata"], nameField: "binding" },
  secrets_store: { key: ["secrets_store_secrets"], nameField: "binding" },
};

/** Binding names declared in a parsed wrangler config, by type (plus `vars` as type `var`). */
export function wranglerBindings(cfg: unknown): { type: string; name: string }[] {
  const out: { type: string; name: string }[] = [];
  if (!cfg || typeof cfg !== "object") return out;
  const c = cfg as Record<string, unknown>;
  for (const [type, { key, nameField }] of Object.entries(WRANGLER_TYPE_KEYS)) {
    let v: unknown = c;
    for (const k of key) v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
    const list = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
    for (const item of list) {
      const n = item && typeof item === "object" ? (item as Record<string, unknown>)[nameField] : undefined;
      if (typeof n === "string") out.push({ type, name: n });
    }
  }
  if (c.vars && typeof c.vars === "object") for (const k of Object.keys(c.vars)) out.push({ type: "var", name: k });
  return out;
}

function parseDepSpec(spec: string): { name: string; range: string } {
  const at = spec.lastIndexOf("@");
  if (at > 0) return { name: spec.slice(0, at), range: spec.slice(at + 1) || "*" };
  return { name: spec, range: "*" };
}

function rangesCompatible(projectRange: string, blockRange: string): boolean | null {
  try {
    if (!semver.validRange(projectRange) || !semver.validRange(blockRange)) return null;
    const min = semver.minVersion(projectRange);
    if (!min) return null;
    return semver.satisfies(min, blockRange) || semver.intersects(projectRange, blockRange);
  } catch {
    return null;
  }
}

function migrationTablesIn(sql: string): string[] {
  const out: string[] = [];
  for (const m of sql.matchAll(/\bCREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?([A-Za-z_][A-Za-z0-9_]*)[`"\]]?/gi)) out.push(m[1]!.toLowerCase());
  return out;
}

function tsFormat(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function tsParse(s: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
}

function exportsSymbol(text: string, symbol: string): boolean {
  const s = symbol.replace(/\$/g, "\\$");
  return new RegExp(`export\\s+(?:declare\\s+)?(?:default\\s+)?(?:async\\s+)?(?:const|let|var|function\\*?|class|type|interface|enum)\\s+${s}\\b|export\\s*\\{[^}]*\\b${s}\\b`).test(text);
}

function renamedTarget(target: string, blockName: string): string {
  const dir = dirname(target);
  const base = basename(target);
  const dot = base.indexOf(".", 1);
  const name = dot > 0 ? `${base.slice(0, dot)}.${blockName}${base.slice(dot)}` : `${base}.${blockName}`;
  return dir ? `${dir}/${name}` : name;
}

/** Resolves a target path safely, or throws `forbidden`. */
function safeTarget(raw: string, blockName: string): string {
  const n = normalizeRelative(raw);
  if (n === null) throw new KitError("forbidden", `target ${JSON.stringify(raw)} is outside the project root`, { rule: "path_traversal" });
  const why = forbiddenTarget(n, blockName);
  if (why) throw new KitError("forbidden", `target ${JSON.stringify(n)} is not writable by a block: ${why}`, { rule: "forbidden_target" });
  return n;
}

// ---------- variant / params ----------

export interface VariantChoice {
  variant: Variant;
  warnings: string[];
  conflict?: ConflictT;
}

/** BLOCK-SPEC §6.2: exact on framework and db; ui may be `none`; an explicit choice wins. */
export function resolveVariant(m: Manifest, profile: ProjectProfile, explicit?: string): VariantChoice {
  const warnings: string[] = [];
  if (explicit) {
    const v = m.variants.find((x) => x.id === explicit);
    if (!v) throw new KitError("invalid_params", `variant ${explicit} does not exist (have ${m.variants.map((x) => x.id).join(", ")})`);
    return { variant: v, warnings };
  }
  const p = profile.stack;
  let best: { v: Variant; score: number } | undefined;
  for (const v of m.variants) {
    const s = { ...m.stack, ...(v.stack ?? {}) };
    if (p.framework && s.framework && p.framework !== s.framework) continue;
    if (p.db && s.db && p.db !== s.db) continue;
    let score = 0;
    if (p.framework && s.framework === p.framework) score += 2;
    if (p.db && s.db === p.db) score += 2;
    if (s.ui === p.ui || !s.ui || s.ui === "none") score += 1;
    if (v === defaultVariant(m)) score += 0.5;
    if (!best || score > best.score) best = { v, score };
  }
  if (!best) {
    const d = defaultVariant(m);
    return {
      variant: d,
      warnings,
      conflict: {
        kind: "variant",
        name: `${p.framework ?? "?"}/${p.db ?? "?"}`,
        detail: `no variant for framework ${p.framework ?? "?"} and db ${p.db ?? "?"} (have ${m.variants.map((x) => x.id).join(", ")}); pass variant explicitly to override`,
      },
    };
  }
  const s = { ...m.stack, ...(best.v.stack ?? {}) };
  if (s.ui && s.ui !== "none" && p.ui && s.ui !== p.ui) warnings.push(`variant ${best.v.id} targets ui ${s.ui}; the project uses ${p.ui}`);
  if (!p.framework) warnings.push(`project framework unknown; chose variant ${best.v.id}`);
  return { variant: best.v, warnings };
}

/** `appSlug` from package.json#name, `appDomain` from wrangler routes (BLOCK-SPEC §4). */
export function inferParams(m: Manifest, project: FileTree, profile: ProjectProfile): Record<string, string> {
  const out: Record<string, string> = {};
  const names = new Set((m.params ?? []).map((p) => p.name));
  const pkg = tryJson(project["package.json"]);
  if (names.has("appSlug") && pkg && typeof (pkg as { name?: unknown }).name === "string") {
    out.appSlug = ((pkg as { name: string }).name.replace(/^@[^/]+\//, "")).toLowerCase();
  }
  if (names.has("appDomain")) {
    const wf = profile.config?.wrangler;
    const cfg = wf ? tryJsonc(project[wf]) : undefined;
    const c = cfg as { routes?: unknown; route?: unknown } | undefined;
    const routes = Array.isArray(c?.routes) ? c!.routes : c?.route ? [c.route] : [];
    for (const r of routes) {
      const zone = r && typeof r === "object" ? (r as { zone_name?: unknown }).zone_name : undefined;
      const pattern = typeof r === "string" ? r : r && typeof r === "object" ? (r as { pattern?: unknown }).pattern : undefined;
      let host = typeof zone === "string" ? zone : typeof pattern === "string" ? pattern.split("/")[0]! : "";
      host = host.replace(/^\*\.?/, "").replace(/:\d+$/, "");
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) {
        out.appDomain = host.toLowerCase();
        break;
      }
    }
  }
  return out;
}

function tryJson(d: FileData | undefined): unknown {
  if (d === undefined) return undefined;
  try {
    return JSON.parse(tryDecodeUtf8(d) ?? "");
  } catch {
    return undefined;
  }
}

function tryJsonc(d: FileData | undefined): unknown {
  if (d === undefined) return undefined;
  try {
    return parseJsonc(tryDecodeUtf8(d) ?? "");
  } catch {
    return undefined;
  }
}

// ---------- prepare (shared by planInstall, readProjectForPlan and renderInstalled) ----------

interface Prepared {
  m: Manifest;
  blockId: string;
  variant: Variant;
  variantWarnings: string[];
  variantConflict?: ConflictT;
  params: ParamValues;
  inferred: string[];
  paths: Record<string, string>;
  files: { entry: FileEntry; target: string; raw: FileData }[];
}

function prepare(input: Omit<PlanInput, "project"> & { project: FileTree }, opts: { strictParams?: boolean } = {}): Prepared {
  const prof = ProjectProfileSchema.safeParse(input.profile);
  if (!prof.success) {
    throw new KitError("forbidden", `project profile is invalid: ${prof.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, { rule: "profile_invalid" });
  }
  const v = validateManifest(input.bundle.manifest);
  if (!v.ok || !v.manifest) {
    const blocking = v.findings.filter((f) => f.severity === "block");
    throw new KitError("invalid_params", `block manifest is invalid: ${blocking.slice(0, 5).map((f) => `${f.rule} at ${f.path}: ${f.detail}`).join("; ")}`, { rule: "manifest_invalid", details: blocking });
  }
  const m = v.manifest;
  const blockId = input.blockId ?? `@local/${m.name}`;
  if (!BLOCK_ID_RE.test(blockId)) throw new KitError("invalid_params", `bad block id ${blockId}`);
  if (blockId.split("/")[1] !== m.name) throw new KitError("invalid_params", `block id ${blockId} does not match manifest name ${m.name}`);
  const choice = resolveVariant(m, input.profile, input.variant);
  const inferredRaw = inferParams(m, input.project, input.profile);
  // only keep inferred values that validate; drop the others with a warning
  const inferredOk: Record<string, string> = {};
  const variantWarnings = [...choice.warnings];
  for (const [k, val] of Object.entries(inferredRaw)) {
    if (input.params && Object.hasOwn(input.params, k)) continue;
    const def = m.params!.find((p) => p.name === k)!;
    const r = resolveParams([def], { [k]: val });
    if (r.errors.length) variantWarnings.push(`could not infer ${k} from the project (${JSON.stringify(val)} is invalid); using the default`);
    else inferredOk[k] = val;
  }
  const rp = resolveParams(m.params ?? [], input.params ?? {}, inferredOk);
  if (rp.errors.length && opts.strictParams !== false) throw new KitError("invalid_params", `params: ${rp.errors.join("; ")}`, { rule: "param_invalid", details: rp.errors });
  const paths = { ...input.profile.paths };
  const files: Prepared["files"] = [];
  for (const entry of filesForVariant(m, choice.variant.id)) {
    if (entry.when && !evaluateCondition(entry.when.replace(/'/g, '"'), rp.values)) continue;
    const rawTarget = entry.target ?? `.kit/blocks/${m.name}/${entry.path}`;
    const target = safeTarget(renderTemplate(rawTarget, { params: rp.values, paths }), m.name);
    const bp = bundlePath(m, entry);
    const raw = Object.hasOwn(input.bundle.files, bp) ? input.bundle.files[bp]! : entry.content;
    if (raw === undefined) throw new KitError("invalid_params", `block file ${bp} is missing from the bundle`, { rule: "missing_file" });
    files.push({ entry, target, raw });
  }
  const seen = new Set<string>();
  for (const f of files) {
    if (f.entry.role === "config-patch") continue;
    if (seen.has(f.target)) throw new KitError("invalid_params", `two block files target ${f.target}`, { rule: "duplicate_target" });
    seen.add(f.target);
  }
  return {
    m,
    blockId,
    variant: choice.variant,
    variantWarnings,
    ...(choice.conflict ? { variantConflict: choice.conflict } : {}),
    params: rp.values,
    inferred: Object.keys(inferredOk).filter((k) => !(input.params && Object.hasOwn(input.params, k))).sort(),
    paths,
    files,
  };
}

/** Existing migration file names (directly in the migrations dir), from the snapshot. */
function existingMigrations(project: FileTree, dir: string): string[] {
  const prefix = dir ? `${dir}/` : "";
  return Object.keys(project)
    .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/") && /^\d+_.+\.sql$/.test(k.slice(prefix.length)))
    .map((k) => k.slice(prefix.length))
    .sort();
}

/** Computes renumbered migration names: block basename → project basename. */
export function renumberMigrations(
  blockMigrations: string[],
  existing: string[],
  profile: ProjectProfile,
  now?: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  const suffix = (n: string) => n.replace(/^\d+/, "");
  if (profile.migrations.pattern === "TIMESTAMP_name.sql") {
    if (!now) throw new KitError("invalid_params", "timestamp migrations need `now`");
    let t = Math.floor(Date.parse(now) / 1000) * 1000;
    if (Number.isNaN(t)) throw new KitError("invalid_params", "bad `now`");
    const highest = Math.max(0, ...existing.map((n) => tsParse(/^(\d+)_/.exec(n)![1]!) ?? 0));
    if (t <= highest) t = highest + 1000;
    blockMigrations.forEach((b, i) => {
      out[b] = `${tsFormat(new Date(t + i * 1000))}${suffix(b)}`;
    });
    return out;
  }
  const nums = existing.map((n) => /^(\d+)_/.exec(n)![1]!);
  const highest = nums.length ? Math.max(...nums.map(Number)) : 0;
  const width = profile.migrations.width ?? Math.max(4, ...nums.map((n) => n.length));
  blockMigrations.forEach((b, i) => {
    out[b] = `${String(highest + i + 1).padStart(width, "0")}${suffix(b)}`;
  });
  return out;
}

function orderedMigrationFiles(m: Manifest, files: Prepared["files"]): Prepared["files"] {
  const order = new Map((m.migrations ?? []).map((x, i) => [x.file, i]));
  return files
    .filter((f) => f.entry.role === "migration")
    .sort((a, b) => (order.get(a.entry.path) ?? 1e6) - (order.get(b.entry.path) ?? 1e6) || a.entry.path.localeCompare(b.entry.path));
}

/** Renders the block's files for a project (targets after renumbering → content). Used by plan, diff and upgrade. */
export function renderBlockFiles(
  prep: Prepared,
  profile: ProjectProfile,
  migrationMap: Record<string, string>,
): { entry: FileEntry; target: string; content: FileData; text: boolean }[] {
  const renamed = Object.values(migrationMap);
  const out: { entry: FileEntry; target: string; content: FileData; text: boolean }[] = [];
  for (const f of prep.files) {
    let target = f.target;
    if (f.entry.role === "migration") {
      const b = basename(f.entry.path);
      const n = migrationMap[b];
      if (n) target = `${dirname(f.target) ? `${dirname(f.target)}/` : ""}${n}`;
    }
    const isTxt = isText(f.raw);
    let content: FileData = f.raw;
    if (isTxt && f.entry.template !== false) {
      content = renderTemplate(tryDecodeUtf8(f.raw)!, { params: prep.params, paths: prep.paths, migrations: renamed, fileDir: dirname(target) });
    }
    out.push({ entry: f.entry, target, content, text: isTxt });
  }
  void profile;
  return out;
}

// ---------- the planner ----------

/**
 * Plans an install. Throws `KitError` for invalid manifests, invalid params, or targets outside the project; returns
 * a plan with `conflicts` for everything the agent can resolve (tables, routes, bindings, files, exports, config).
 */
export async function planInstall(input: PlanInput): Promise<InstallPlan> {
  const prep = prepare(input);
  const { m, blockId, params } = prep;
  const project = input.project;
  const profile = input.profile;
  const onConflict: OnConflict = input.onConflict ?? "stop";
  const applyConfig = input.applyConfig !== false;
  const lock = input.lock ?? { version: 1 as const, blocks: {} };
  const warnings: string[] = [...prep.variantWarnings];
  const conflicts: ConflictT[] = [];
  if (prep.variantConflict) conflicts.push(prep.variantConflict);
  if (lock.blocks[blockId]) {
    conflicts.push({ kind: "already_installed", name: blockId, detail: `${blockId}@${lock.blocks[blockId]!.version} is already installed; use registry_upgrade` });
  }

  // compat
  const pkg = (tryJson(project["package.json"]) ?? {}) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; engines?: Record<string, string> };
  const projectDeps: Record<string, string> = { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
  const compat = { ...(m.compat ?? {}), ...(prep.variant.compat ?? {}) };
  for (const name of Object.keys(compat).sort()) {
    const want = compat[name]!;
    const have = name === "node" ? pkg.engines?.node : projectDeps[name];
    if (!have) {
      if (name !== "node" && name !== "typescript") warnings.push(`compat: ${name} not in package.json, block wants ${want}`);
      continue;
    }
    if (rangesCompatible(have, want) === false) warnings.push(`compat: ${name} ${have} in package.json, block wants ${want}`);
  }

  // migrations
  const migFiles = orderedMigrationFiles(m, prep.files);
  const existing = existingMigrations(project, profile.paths.migrations ?? "migrations");
  const migrationMap = renumberMigrations(migFiles.map((f) => basename(f.entry.path)), existing, profile, input.now);
  const rendered = renderBlockFiles(prep, profile, migrationMap);

  // interface
  const tableTemplates = m.tables ?? [];
  const tables = tableTemplates.map((t) => renderTemplate(t, { params, paths: prep.paths }));
  const routes = (m.routes ?? []).map((r) => `${r.method} ${renderTemplate(r.path, { params, paths: prep.paths })}`);
  const bindings = (m.bindings ?? []).map((b) => `${b.type}:${b.name}`);

  // table conflicts: other installed blocks, then CREATE TABLE in existing migrations
  const migDir = profile.paths.migrations ?? "migrations";
  const projectTables = new Map<string, string>();
  for (const name of existing) {
    const d = project[`${migDir}/${name}`];
    const sql = d === undefined ? null : tryDecodeUtf8(d);
    if (sql) for (const t of migrationTablesIn(sql)) if (!projectTables.has(t)) projectTables.set(t, `${migDir}/${name}`);
  }
  tables.forEach((t, i) => {
    const param = referencedParams(tableTemplates[i]!)[0];
    for (const [otherId, e] of Object.entries(lock.blocks)) {
      if (otherId === blockId) continue;
      if (e.interface?.tables.includes(t)) {
        conflicts.push({ kind: "table", name: t, detail: `${otherId} already creates ${t}`, ...(param ? { resolve_with_param: param } : {}) });
        return;
      }
    }
    const where = projectTables.get(t.toLowerCase());
    if (where) conflicts.push({ kind: "table", name: t, detail: `${where} already creates ${t}`, ...(param ? { resolve_with_param: param } : {}) });
  });
  routes.forEach((r, i) => {
    const param = referencedParams(m.routes![i]!.path)[0];
    for (const [otherId, e] of Object.entries(lock.blocks)) {
      if (otherId === blockId) continue;
      if (e.interface?.routes.includes(r)) conflicts.push({ kind: "route", name: r, detail: `${otherId} already serves ${r}`, ...(param ? { resolve_with_param: param } : {}) });
    }
  });
  // binding conflicts: same name, different type
  const wranglerFile = profile.config?.wrangler;
  const wranglerCfg = wranglerFile ? tryJsonc(project[wranglerFile]) : undefined;
  const existingBindings = wranglerBindings(wranglerCfg);
  for (const b of m.bindings ?? []) {
    const clash = existingBindings.find((x) => x.name === b.name && x.type !== b.type);
    if (clash) conflicts.push({ kind: "binding", name: b.name, detail: `${wranglerFile} already has ${b.name} as ${clash.type}; the block needs ${b.type}` });
    for (const [otherId, e] of Object.entries(lock.blocks)) {
      if (otherId === blockId) continue;
      const other = e.interface?.bindings.find((x) => x.endsWith(`:${b.name}`) && x !== `${b.type}:${b.name}`);
      if (other) conflicts.push({ kind: "binding", name: b.name, detail: `${otherId} uses ${b.name} as ${other.split(":")[0]}; the block needs ${b.type}` });
    }
  }

  // writes
  const files: PlannedFile[] = [];
  const writes: WriteT[] = [];
  const onConflictRecord: Record<string, "skip" | "overwrite" | "rename"> = {};
  const diffs: { group: number; path: string; text: string }[] = [];
  const pending = new Map<string, string | null>(); // config targets → current merged text
  const secretNames = (m.secrets ?? []).map((s) => s.name);
  const shaOf = async (d: FileData | undefined | null) => (d === undefined || d === null ? null : sha256Hex(d));

  for (const r of rendered) {
    const { entry } = r;
    const target = r.target;
    const fromPath = entry.role === "migration" ? entry.path : undefined;
    if (entry.role === "config-patch") {
      if (!applyConfig) {
        writes.push({ path: target, action: "skip", role: entry.role, merge: entry.merge!, reason: "apply_config=false" });
        warnings.push(`config patch skipped (apply_config=false): ${target}`);
        continue;
      }
      if (!r.text) throw new KitError("invalid_params", `config patch ${entry.path} is not text`);
      const projectData = project[target];
      const before = pending.has(target) ? pending.get(target)! : projectData === undefined ? null : tryDecodeUtf8(projectData);
      const patchText = r.content as string;
      let after: string;
      let changed: boolean;
      let lines: string[] | undefined;
      if (entry.merge === "append-missing-lines") {
        const a = appendMissingLines(before, patchText, { secretNames });
        after = a.text;
        changed = a.changed;
        lines = a.lines;
      } else {
        const isWrangler = target === wranglerFile || /(^|\/)wrangler\.jsonc?$/.test(target);
        const res = mergeJsonc(before, patchText, entry.merge as "jsonc-deep" | "json-merge-patch", {
          file: target,
          ...(isWrangler ? { forbiddenTopLevel: WRANGLER_FORBIDDEN_KEYS } : {}),
        });
        after = res.text;
        changed = res.changed;
        warnings.push(...res.warnings);
        for (const c of res.conflicts) conflicts.push({ kind: "config", name: c.name, detail: c.detail });
      }
      if (!changed) {
        writes.push({ path: target, action: "skip", role: entry.role, merge: entry.merge!, reason: "already present" });
        continue;
      }
      pending.set(target, after);
      continue; // the merged result is emitted once per target below
    }
    // regular files
    const projectData = project[target];
    const isSame = projectData !== undefined && (await shaOf(projectData)) === (await sha256Hex(r.content));
    if (projectData === undefined || isSame) {
      if (isSame) {
        writes.push({ path: target, action: "skip", role: entry.role, reason: "identical file exists" });
        files.push({ path: target, action: "create", role: entry.role, block_path: entry.path, before_sha256: await shaOf(projectData), after_sha256: await sha256Hex(r.content), content_b64: "", tracked: true, skip: true });
        continue;
      }
      const after = await sha256Hex(r.content);
      files.push({ path: target, action: "create", role: entry.role, block_path: entry.path, before_sha256: null, after_sha256: after, content_b64: base64Encode(toBytes(r.content)), tracked: true });
      writes.push({ path: target, action: "create", role: entry.role, bytes: toBytes(r.content).byteLength, ...(fromPath ? { from: fromPath } : {}) });
      diffs.push({ group: 2, path: target, text: unifiedDiff(target, null, r.text ? (r.content as string) : "\u0000") });
      continue;
    }
    // the target exists with different content
    const exportClash = (m.exports ?? []).filter((e) => e.from === entry.path && exportsSymbol(tryDecodeUtf8(projectData) ?? "", e.symbol));
    if (onConflict === "stop") {
      conflicts.push({ kind: "file", name: target, detail: `${target} exists and differs; rerun with on_conflict skip, overwrite or rename` });
      for (const e of exportClash) conflicts.push({ kind: "export", name: e.symbol, detail: `${target} already exports ${e.symbol}` });
      diffs.push({ group: 0, path: target, text: unifiedDiff(target, tryDecodeUtf8(projectData), r.text ? (r.content as string) : "\u0000", { note: `conflict: ${target} exists (on_conflict=stop); the diff shows what overwrite would do` }) });
      continue;
    }
    onConflictRecord[target] = onConflict;
    if (onConflict === "skip") {
      writes.push({ path: target, action: "skip", role: entry.role, reason: "exists (on_conflict=skip)" });
      continue;
    }
    if (onConflict === "overwrite") {
      files.push({ path: target, action: "overwrite", role: entry.role, block_path: entry.path, before_sha256: await shaOf(projectData), after_sha256: await sha256Hex(r.content), content_b64: base64Encode(toBytes(r.content)), tracked: true });
      writes.push({ path: target, action: "overwrite", role: entry.role, bytes: toBytes(r.content).byteLength, ...(fromPath ? { from: fromPath } : {}) });
      diffs.push({ group: 0, path: target, text: unifiedDiff(target, tryDecodeUtf8(projectData), r.text ? (r.content as string) : "\u0000", { note: `overwrite: ${target}` }) });
      continue;
    }
    // rename
    const alt = safeTarget(renamedTarget(target, m.name), m.name);
    if (project[alt] !== undefined) {
      conflicts.push({ kind: "file", name: target, detail: `${target} exists and so does ${alt}` });
      continue;
    }
    files.push({ path: alt, action: "rename", role: entry.role, block_path: entry.path, before_sha256: null, after_sha256: await sha256Hex(r.content), content_b64: base64Encode(toBytes(r.content)), tracked: true });
    writes.push({ path: alt, action: "rename", role: entry.role, bytes: toBytes(r.content).byteLength, from: entry.path, reason: `${target} exists` });
    diffs.push({ group: 2, path: alt, text: unifiedDiff(alt, null, r.text ? (r.content as string) : "\u0000", { note: `rename: ${target} exists` }) });
  }

  // emit merged config targets
  for (const [target, after] of [...pending.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const projectData = project[target];
    const before = projectData === undefined ? null : tryDecodeUtf8(projectData);
    const entries = rendered.filter((r) => r.target === target && r.entry.role === "config-patch");
    const merge = entries[0]!.entry.merge!;
    const action: PlannedFile["action"] = before === null ? "create" : merge === "append-missing-lines" ? "append" : "patch";
    files.push({ path: target, action, role: "config-patch", block_path: entries.map((e) => e.entry.path).join(","), before_sha256: await shaOf(projectData), after_sha256: await sha256Hex(after!), content_b64: base64Encode(toBytes(after!)), tracked: false });
    const w: WriteT = { path: target, action, role: "config-patch", merge };
    if (action === "patch") w.hunks = hunkCount(before ?? "", after!);
    if (action === "append") w.lines = after!.slice((before ?? "").length).split("\n").filter((l) => l.trim() !== "");
    if (action === "create") w.bytes = toBytes(after!).byteLength;
    writes.push(w);
    diffs.push({ group: 1, path: target, text: unifiedDiff(target, before, after!) });
  }

  // dependencies
  const depsToAdd: Record<string, string> = {};
  const devDepsToAdd: Record<string, string> = {};
  const collect = (specs: string[] | undefined, into: Record<string, string>) => {
    for (const spec of specs ?? []) {
      const { name, range } = parseDepSpec(spec);
      const have = projectDeps[name];
      if (have === undefined) into[name] = range;
      else if (rangesCompatible(have, range) === false) warnings.push(`dependency: ${name} ${have} in package.json, block wants ${range}`);
    }
  };
  collect(m.dependencies, depsToAdd);
  collect(m.devDependencies, devDepsToAdd);
  const pkgText = project["package.json"] === undefined ? null : tryDecodeUtf8(project["package.json"]);
  if ((Object.keys(depsToAdd).length || Object.keys(devDepsToAdd).length) && applyConfig) {
    if (pkgText === null) warnings.push("no package.json: add the dependencies yourself");
    else {
      let text = pkgText;
      const fo = detectFormatting(pkgText);
      for (const [section, add] of [["dependencies", depsToAdd], ["devDependencies", devDepsToAdd]] as const) {
        for (const name of Object.keys(add).sort()) text = jsonc.applyEdits(text, jsonc.modify(text, [section, name], add[name], { formattingOptions: fo }));
      }
      files.push({ path: "package.json", action: "patch", role: "dependencies", block_path: "package.json", before_sha256: await sha256Hex(pkgText), after_sha256: await sha256Hex(text), content_b64: base64Encode(toBytes(text)), tracked: false });
      writes.push({ path: "package.json", action: "patch", role: "dependencies", merge: "json-merge-patch", hunks: hunkCount(pkgText, text) });
      diffs.push({ group: 1, path: "package.json", text: unifiedDiff("package.json", pkgText, text) });
      warnings.push(`dependencies added to package.json; run \`${profile.package_manager ?? "npm"} install\``);
    }
  }

  // adapt (author text, rendered) and verify
  const renamedList = Object.values(migrationMap);
  const adaptItems = (m.agent?.adapt ?? []).map((a) => {
    const r = (s: string | undefined) => {
      if (s === undefined) return undefined;
      try {
        return renderTemplate(s, { params, paths: prep.paths, migrations: renamedList, fileDir: "" });
      } catch {
        return s;
      }
    };
    const item = { id: a.id, required: a.required, title: r(a.title)! } as UntrustedAuthorTextT["adapt"] extends (infer T)[] | undefined ? T : never;
    for (const k of ["where", "do", "check"] as const) {
      const v = r(a[k]);
      if (v !== undefined) (item as Record<string, unknown>)[k] = v;
    }
    return item;
  });
  const untrusted: UntrustedAuthorTextT = { notice: UNTRUSTED_NOTICE };
  if (m.agent?.summary) untrusted.summary = m.agent.summary;
  if (m.agent?.when_to_use?.length) untrusted.when_to_use = m.agent.when_to_use;
  if (m.agent?.when_not_to_use?.length) untrusted.when_not_to_use = m.agent.when_not_to_use;
  if (adaptItems.length) untrusted.adapt = adaptItems;
  if (m.agent?.author_notes) untrusted.author_notes = m.agent.author_notes;

  const verifyCommands: string[] = [];
  const skipped: { command: string; reason: string }[] = [];
  for (const c of m.verify?.commands ?? []) {
    const rc = renderTemplate(c, { params, paths: prep.paths });
    const chk = checkVerifyCommand(rc);
    if (chk.allowed) verifyCommands.push(rc);
    else skipped.push({ command: rc, reason: chk.reason ?? "not allowed" });
  }

  // order: conflicts and config first (DESIGN §5.6), then the rest, by path
  const groupOf = (w: WriteT) => (w.role === "config-patch" || w.role === "dependencies" ? 0 : w.action === "skip" ? 2 : 1);
  writes.sort((a, b) => groupOf(a) - groupOf(b) || a.path.localeCompare(b.path));
  files.sort((a, b) => a.path.localeCompare(b.path));
  diffs.sort((a, b) => a.group - b.group || a.path.localeCompare(b.path));
  const diff = diffs.map((d) => d.text).join("");

  const manifestSha = await manifestSha256(input.bundle.manifest);
  const body: Omit<InstallPlan, "plan_id" | "diff_preview_path"> = {
    block: pinnedRef(blockId, m.version),
    variant: prep.variant.id,
    params,
    inferred: prep.inferred,
    writes,
    conflicts,
    warnings,
    dependencies_to_add: depsToAdd,
    ...(Object.keys(devDepsToAdd).length ? { dev_dependencies_to_add: devDepsToAdd } : {}),
    migrations: migrationMap,
    adapt: (m.agent?.adapt ?? []).map((a) => ({ id: a.id, required: a.required, status: "pending" as const })),
    verify: { commands: verifyCommands, ...(m.verify?.expect ? { expect: m.verify.expect } : {}), ...(skipped.length ? { skipped } : {}) },
    untrusted_author_text: untrusted,
    kit: {
      format: 1,
      block_id: blockId,
      block_name: m.name,
      version: m.version,
      manifest_sha256: manifestSha,
      registry_signature: input.registrySignature ?? "",
      project_id: profile.project_id,
      files,
      on_conflict: onConflictRecord,
      interface: { tables, routes, bindings },
      adapt_required: (m.agent?.adapt ?? []).filter((a) => a.required).map((a) => a.id),
      diff,
    },
  };
  const id = `plan_${(await sha256Hex(canonicalJson(body))).slice(0, 20).toUpperCase()}`;
  return { plan_id: id, ...body, diff_preview_path: `.kit/plans/${id}.diff` } as InstallPlan;
}

// ---------- reading the project for a plan ----------

/**
 * Reads, through the adapter, exactly the project files `planInstall` needs: `package.json`, the wrangler config,
 * the env example, the migrations directory (`*.sql`), and every target the block would write (plus the renamed
 * alternatives).
 */
export async function readProjectForPlan(
  fs: KitFs,
  args: { bundle: BlockBundle; profile: ProjectProfile; params?: Record<string, unknown>; variant?: string; blockId?: string },
): Promise<FileTree> {
  const tree: FileTree = {};
  const read = async (p: string | undefined) => {
    if (!p || Object.hasOwn(tree, p)) return;
    const n = normalizeRelative(p);
    if (n === null) return;
    const b = await fs.readFile(n);
    if (b !== null) tree[n] = b;
  };
  await read("package.json");
  for (const f of ["wrangler.jsonc", "wrangler.json", "wrangler.toml"]) await read(f);
  await read(args.profile.config?.wrangler);
  await read(args.profile.config?.env_example);
  const migDir = args.profile.paths.migrations ?? "migrations";
  for (const name of (await fs.list(migDir)) ?? []) if (name.endsWith(".sql")) await read(`${migDir}/${name}`);
  let prep: Prepared;
  try {
    prep = prepare({ ...args, project: tree }, { strictParams: true });
  } catch {
    return tree; // planInstall will report the error
  }
  for (const f of prep.files) {
    await read(f.target);
    if (f.entry.role !== "config-patch") await read(renamedTarget(f.target, prep.m.name));
  }
  return tree;
}

// ---------- apply ----------

export interface ApplyOptions {
  /** ISO timestamp recorded as `installed_at`. */
  now?: string;
}

/** Saves `.kit/plans/<id>.json` and `.diff` (the CLI's `kit install` dry run). */
export async function savePlan(fs: KitFs, plan: InstallPlan): Promise<{ json: string; diff: string }> {
  assertPlanId(plan.plan_id);
  const json = `.kit/plans/${plan.plan_id}.json`;
  const diff = `.kit/plans/${plan.plan_id}.diff`;
  await fs.writeFile(json, toBytes(`${JSON.stringify(plan, null, 2)}\n`));
  await fs.writeFile(diff, toBytes(plan.kit.diff));
  return { json, diff };
}

function assertPlanId(id: string): void {
  if (!/^plan_[0-9A-Z]{6,64}$/.test(id)) throw new KitError("invalid_params", `bad plan id ${JSON.stringify(id)}`);
}

export async function loadPlan(fs: KitFs, planId: string): Promise<InstallPlan> {
  assertPlanId(planId);
  const b = await fs.readFile(`.kit/plans/${planId}.json`);
  if (b === null) throw new KitError("not_found", `no saved plan ${planId}`);
  const plan = JSON.parse(tryDecodeUtf8(b) ?? "null") as InstallPlan;
  if (!plan || plan.plan_id !== planId || plan.kit?.format !== 1) throw new KitError("plan_stale", `plan file ${planId} is not a kit plan`);
  return plan;
}

/**
 * Applies a plan: refuses when it has conflicts, re-checks every path (never trusts the plan file), checks that each
 * file still has the content the plan was made against (else `plan_stale`), checks every new content against its
 * planned hash, then writes the files and the lock. Returns the contract's `AppliedPlan`.
 */
export async function applyPlan(fs: KitFs, plan: InstallPlan, opts: ApplyOptions = {}): Promise<AppliedPlanT> {
  if (!plan || plan.kit?.format !== 1) throw new KitError("invalid_params", "not a kit plan");
  assertPlanId(plan.plan_id);
  if (plan.conflicts.length) {
    throw new KitError("conflicts", `${plan.conflicts.length} conflict${plan.conflicts.length > 1 ? "s" : ""}; nothing written.`, { details: plan.conflicts });
  }
  const blockName = plan.kit.block_name;
  if (!BLOCK_ID_RE.test(plan.kit.block_id) || plan.kit.block_id.split("/")[1] !== blockName) throw new KitError("invalid_params", "plan block id is malformed");
  const toWrite: { path: string; bytes: Uint8Array }[] = [];
  for (const f of plan.kit.files) {
    if (f.skip) continue;
    const n = normalizeRelative(f.path);
    if (n === null || n !== f.path) throw new KitError("forbidden", `plan writes outside the project root: ${JSON.stringify(f.path)}`, { rule: "path_traversal" });
    const isDeps = f.role === "dependencies" && f.path === "package.json";
    const why = isDeps ? null : forbiddenTarget(n, blockName);
    if (why) throw new KitError("forbidden", `plan writes ${n}: ${why}`, { rule: "forbidden_target" });
    if (!["create", "patch", "append", "overwrite", "rename"].includes(f.action)) throw new KitError("invalid_params", `bad action ${f.action}`);
    const bytes = base64Decode(f.content_b64);
    if ((await sha256Hex(bytes)) !== f.after_sha256) throw new KitError("plan_stale", `plan content for ${n} does not match its hash`);
    const cur = await fs.readFile(n);
    const curSha = cur === null ? null : await sha256Hex(cur);
    if (curSha !== f.before_sha256) throw new KitError("plan_stale", `${n} changed since the plan was made; plan again`);
    if (isDeps) {
      const before = tryJson(cur ?? undefined) as Record<string, unknown> | undefined;
      const after = tryJson(bytes) as Record<string, unknown> | undefined;
      if (!before || !after) throw new KitError("plan_stale", "package.json is not valid JSON");
      for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (k === "dependencies" || k === "devDependencies") continue;
        if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) throw new KitError("forbidden", `the dependency patch changes package.json#${k}`);
      }
    }
    toWrite.push({ path: n, bytes });
  }
  for (const w of toWrite) await fs.writeFile(w.path, w.bytes);

  const lockFiles = plan.kit.files
    .filter((f) => f.tracked)
    .map((f) => ({ target: f.path, rendered_sha256: f.after_sha256, block_path: f.block_path, role: f.role }));
  const entry: LockEntryT = {
    version: plan.kit.version,
    variant: plan.variant,
    manifest_sha256: plan.kit.manifest_sha256,
    registry_signature: plan.kit.registry_signature,
    installed_at: (opts.now ?? new Date().toISOString()).replace(/\.\d+Z$/, "Z"),
    params: plan.params,
    files: lockFiles,
    ...(plan.migrations && Object.keys(plan.migrations).length ? { migrations: plan.migrations } : {}),
    adapt: Object.fromEntries(plan.adapt.map((a) => [a.id, "pending" as const])),
    plan_id: plan.plan_id,
    ...(Object.keys(plan.kit.on_conflict).length ? { on_conflict: plan.kit.on_conflict } : {}),
    interface: plan.kit.interface,
  };
  const lock = upsertLockEntry(await readLock(fs), plan.kit.block_id, entry);
  await writeLock(fs, lock);
  const { kit: _k, ...contract } = plan;
  return { ...contract, applied: true, lock_entry: entry, changed_files: [...toWrite.map((w) => w.path), LOCK_PATH] };
}

/**
 * Renders an installed block as it was installed (targets → content), from the lock's params and migration map:
 * the `base` of `kit diff` and of a 3-way upgrade.
 */
export function renderInstalled(bundle: BlockBundle, entry: LockEntryT, profile: ProjectProfile, blockId: string): FileTree {
  const prep = prepare({ bundle, profile, project: {}, params: entry.params, variant: entry.variant, blockId });
  const out: FileTree = {};
  for (const r of renderBlockFiles(prep, profile, entry.migrations ?? {})) {
    if (r.entry.role === "config-patch") continue;
    const renamed = entry.on_conflict?.[r.target] === "rename" ? renamedTarget(r.target, prep.m.name) : r.target;
    out[renamed] = r.content;
  }
  return out;
}

export { prepare as prepareBlock, renamedTarget };
