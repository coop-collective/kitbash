/**
 * The `block.json` manifest schema (BLOCK-SPEC §3–§8) and `validateManifest()`.
 *
 * The zod schema is the normative form; `scripts/gen-schema.mjs` emits `schema/block.v1.json` from it.
 * Top-level and nested objects are strict (unknown keys are errors, so typos never pass silently), except
 * `meta`, `cssVars`, `css`, `tailwind` (free-form in shadcn) and `provenance.scan|sandbox` (registry-written).
 */
import { z } from "zod";
import { finding, type Finding } from "./errors.ts";
import { pathProblem } from "./paths.ts";
import { validateParamValue, renderTemplate, type ParamValues } from "./render.ts";
import { findSecrets, findHiddenText } from "./secrets.ts";
import { checkVerifyCommand } from "./verify.ts";

export const SCHEMA_URL = "https://kitbash.dev/schema/block.v1.json";

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "lowercase letters, digits and -");
const semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, "semver");
const envName = z.string().regex(/^[A-Z_][A-Z0-9_]{0,63}$/, "UPPER_SNAKE env name");
const bindingName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, "binding name");
const paramToken = z.string().regex(/^\{\{kit\.[A-Za-z_][A-Za-z0-9_]{0,63}\}\}$/, "single kit param token");
const exportSymbol = z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/, "export symbol");
const relPath = z.string().min(1).max(512);
const text = (max: number) => z.string().max(max);

export const PARAM_TYPES = ["string", "identifier", "path", "integer", "boolean", "enum"] as const;
export const FILE_ROLES = ["migration", "route", "service", "ui", "lib", "test", "doc", "config-patch", "fixture"] as const;
export const MERGE_KINDS = ["jsonc-deep", "append-missing-lines", "json-merge-patch"] as const;
export const BINDING_TYPES = [
  "d1", "kv", "r2", "send_email", "queue", "durable_object", "service", "ai", "vectorize", "analytics_engine",
  "hyperdrive", "rate_limit", "browser", "workflow", "images", "assets", "version_metadata", "secrets_store",
] as const;
export const ROUTE_AUTH = ["public", "bearer", "session", "admin"] as const;
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "ALL"] as const;

export const StackSchema = z.strictObject({
  runtime: slug.optional(),
  framework: slug.optional(),
  db: slug.optional(),
  ui: slug.optional(),
  lang: slug.optional(),
  test: slug.optional(),
});
export type Stack = z.infer<typeof StackSchema>;

const compat = z.record(z.string().regex(/^[@a-z0-9][a-z0-9@/._-]*$/), z.string().max(64));

export const VariantSchema = z.strictObject({
  id: slug,
  default: z.boolean().optional(),
  root: relPath,
  stack: StackSchema.optional(),
  compat: compat.optional(),
});
export type Variant = z.infer<typeof VariantSchema>;

export const ParamSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, "param name"),
  type: z.enum(PARAM_TYPES),
  default: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
  required: z.boolean().optional(),
  pattern: z.string().max(200).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  values: z.array(z.string().max(100)).max(50).optional(),
  description: text(500).optional(),
});
export type ParamDef = z.infer<typeof ParamSchema>;

export const FileEntrySchema = z.strictObject({
  path: relPath,
  type: z.string().regex(/^registry:[a-z-]+$/),
  target: z.string().max(512).optional(),
  role: z.enum(FILE_ROLES),
  variant: slug.optional(),
  merge: z.enum(MERGE_KINDS).optional(),
  template: z.boolean().optional(),
  when: z.string().max(200).optional(),
  content: z.string().max(64 * 1024).optional(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  bytes: z.number().int().min(0).optional(),
});
export type FileEntry = z.infer<typeof FileEntrySchema>;

export const EnvSchema = z.strictObject({
  name: envName,
  secret: z.boolean().optional(),
  default: z.string().max(500).optional(),
  description: text(500).optional(),
});
export const SecretDeclSchema = z.strictObject({
  name: envName,
  description: text(500).optional(),
  obtain: text(300).optional(),
  required: z.boolean().optional(),
});
export const BindingSchema = z.strictObject({
  type: z.enum(BINDING_TYPES),
  name: z.union([bindingName, paramToken]),
  required: z.boolean().optional(),
  create: text(300).optional(),
  note: text(500).optional(),
});
export type BindingDecl = z.infer<typeof BindingSchema>;
export const MigrationSchema = z.strictObject({
  file: relPath,
  name: z.string().regex(/^[a-z0-9_-]{1,64}$/),
  creates: z.array(z.string().max(128)).optional(),
  idempotent: z.boolean().optional(),
});
export const RouteSchema = z.strictObject({
  method: z.enum(HTTP_METHODS),
  path: z.string().max(256),
  auth: z.enum(ROUTE_AUTH),
  description: text(300).optional(),
});
export type RouteDecl = z.infer<typeof RouteSchema>;
export const ExportSchema = z.strictObject({
  symbol: z.union([exportSymbol, paramToken]),
  from: relPath,
  kind: z.string().max(64).optional(),
});
export const UiSchema = z.strictObject({
  name: z.string().max(128),
  path: relPath.optional(),
  kind: z.string().max(64).optional(),
  description: text(300).optional(),
});
export const TestSchema = z.strictObject({
  file: relPath,
  runner: z.string().max(64),
  covers: z.array(z.string().max(64)).max(50).optional(),
});
export const VerifySchema = z.strictObject({
  commands: z.array(z.string().max(300)).max(10),
  expect: text(200).optional(),
});
export const AdaptItemSchema = z.strictObject({
  id: slug,
  required: z.boolean(),
  title: text(200),
  where: text(500).optional(),
  do: text(1500).optional(),
  check: text(500).optional(),
});
export type AdaptItem = z.infer<typeof AdaptItemSchema>;
export const AgentSchema = z.strictObject({
  summary: text(1000).optional(),
  when_to_use: z.array(text(300)).max(10).optional(),
  when_not_to_use: z.array(text(300)).max(10).optional(),
  adapt: z.array(AdaptItemSchema).max(20).optional(),
  author_notes: text(1500).optional(),
});
export const ProvenanceSchema = z.strictObject({
  source: z
    .strictObject({ repo: z.string().max(300), commit: z.string().max(64).optional(), paths: z.array(z.string().max(512)).max(200).optional() })
    .optional(),
  origin: z.enum(["original", "harvested-own", "packaged-oss"]).optional(),
  harvested_by: z.enum(["agent", "person"]).optional(),
  harvested_at: z.string().max(40).optional(),
  publisher: z
    .strictObject({ org: z.string().max(64), member: z.string().max(64).optional(), key_id: z.string().max(64).optional() })
    .optional(),
  contributors: z
    .array(z.strictObject({ member: z.string().max(64), share: z.number().min(0).max(1).optional(), proposals: z.array(z.string().max(64)).optional() }))
    .max(100)
    .optional(),
  signature: z.string().max(200).optional(),
  registry_signature: z.string().max(200).optional(),
  scan: z.record(z.string(), z.unknown()).optional(),
  sandbox: z.record(z.string(), z.unknown()).optional(),
});
export const LineageSchema = z.strictObject({
  forked_from: z.strictObject({ block: z.string().max(200), version: semver }).optional(),
  similarity: z.number().min(0).max(1).optional(),
  relation: z.enum(["fork", "mirror", "inspired"]).optional(),
});
export const SizeSchema = z.strictObject({
  files: z.number().int().min(0),
  lines: z.number().int().min(0),
  summary_tokens: z.number().int().min(0).optional(),
});
export const MetaSchema = z.looseObject({
  maturity: z.enum(["experimental", "beta", "production"]).optional(),
  origin: z.string().max(64).optional(),
  network_hosts: z.array(z.string().max(253)).max(50).optional(),
  est_hours_saved: z.number().min(0).max(1000).optional(),
});

export const ManifestSchema = z.strictObject({
  $schema: z.string().max(200).optional(),
  name: slug,
  type: z.literal("registry:block"),
  title: text(120),
  description: text(1000),
  author: text(200).optional(),
  version: semver,
  license: z.string().regex(/^[A-Za-z0-9.+-]{1,64}$/),
  categories: z.array(slug).max(10).optional(),
  meta: MetaSchema.optional(),
  stack: StackSchema,
  compat: compat.optional(),
  variants: z.array(VariantSchema).min(1).max(10),
  params: z.array(ParamSchema).max(40).optional(),
  files: z.array(FileEntrySchema).max(200),
  dependencies: z.array(z.string().max(214)).max(50).optional(),
  devDependencies: z.array(z.string().max(214)).max(50).optional(),
  registryDependencies: z.array(z.string().max(214)).max(30).optional(),
  envVars: z.record(envName, z.string().max(500)).optional(),
  env: z.array(EnvSchema).max(50).optional(),
  secrets: z.array(SecretDeclSchema).max(50).optional(),
  bindings: z.array(BindingSchema).max(30).optional(),
  migrations: z.array(MigrationSchema).max(50).optional(),
  tables: z.array(z.string().max(128)).max(50).optional(),
  routes: z.array(RouteSchema).max(100).optional(),
  exports: z.array(ExportSchema).max(100).optional(),
  ui: z.array(UiSchema).max(50).optional(),
  tests: z.array(TestSchema).max(50).optional(),
  verify: VerifySchema.optional(),
  docs: relPath.optional(),
  skill: relPath.optional(),
  agent: AgentSchema.optional(),
  provenance: ProvenanceSchema.optional(),
  lineage: LineageSchema.optional(),
  size: SizeSchema.optional(),
  // shadcn free-form keys, accepted for compatibility
  cssVars: z.record(z.string(), z.unknown()).optional(),
  css: z.record(z.string(), z.unknown()).optional(),
  tailwind: z.record(z.string(), z.unknown()).optional(),
});
export type Manifest = z.infer<typeof ManifestSchema>;

// ---------- helpers on a parsed manifest ----------

export function defaultVariant(m: Manifest): Variant {
  return m.variants.find((v) => v.default) ?? m.variants[0]!;
}

/** Files that belong to a variant: entries with that `variant` plus entries with none (shared). */
export function filesForVariant(m: Manifest, variantId: string): FileEntry[] {
  return m.files.filter((f) => f.variant === undefined || f.variant === variantId);
}

/**
 * Where a file entry lives inside the bundle (block directory): `<variant.root>/<path>` for a variant file, else
 * `path` (BLOCK-SPEC correction: `files[].path` is relative to the variant root when `variant` is set).
 */
export function bundlePath(m: Manifest, f: FileEntry): string {
  if (!f.variant) return f.path;
  const v = m.variants.find((x) => x.id === f.variant);
  return v ? `${v.root.replace(/\/+$/, "")}/${f.path}` : f.path;
}

export function defaultParamValues(m: Manifest): ParamValues {
  const out: ParamValues = {};
  for (const p of m.params ?? []) if (p.default !== undefined) out[p.name] = p.default;
  return out;
}

/** Placeholder path tokens used when rendering with defaults outside a project (validation, the sandbox). */
export const DEFAULT_PATHS: Readonly<Record<string, string>> = {
  app: "src",
  routes: "src/routes",
  lib: "src/lib",
  ui: "src/components",
  migrations: "migrations",
  tests: "test",
};

/** Rendered `tables[]` with the given params (e.g. `{{kit.tablePrefix}}members` → `members`). */
export function renderedTables(m: Manifest, params: ParamValues): string[] {
  return (m.tables ?? []).map((t) => renderTemplate(t, { params, paths: { ...DEFAULT_PATHS } }));
}

// ---------- validation ----------

export interface ManifestValidation {
  ok: boolean;
  manifest?: Manifest;
  findings: Finding[];
}

const PATH_RULE: Record<string, string> = {
  traversal: "path_traversal",
  absolute: "absolute_path",
  drive_letter: "absolute_path",
};

function pathFinding(p: string, where: string): Finding | null {
  const prob = pathProblem(p);
  if (!prob) return null;
  return finding(PATH_RULE[prob] ?? "invalid_path", "block", where, `${JSON.stringify(p)}: ${prob.replace(/_/g, " ")}`);
}

/** Every string in the manifest with its JSON pointer (for secret, hidden-text and TODO checks). */
export function manifestStrings(value: unknown, pointer = ""): { pointer: string; value: string }[] {
  const out: { pointer: string; value: string }[] = [];
  const walk = (v: unknown, p: string) => {
    if (typeof v === "string") out.push({ pointer: p, value: v });
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}/${i}`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${p}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`);
  };
  walk(value, pointer);
  return out;
}

const SIGNATURE_FIELDS = new Set(["/provenance/signature", "/provenance/registry_signature"]);

/**
 * Validates a manifest object: zod shape first, then the rules zod can't express (path safety, variants, params,
 * verify allowlist, secrets and hidden characters in any string, TODO markers left by the harvester).
 * Rules (`Finding.rule`): `schema`, `unknown_key`, `path_traversal`, `absolute_path`, `invalid_path`,
 * `duplicate_path`, `variant`, `param`, `verify_not_allowlisted`, `secret`, `invisible_unicode`, `bidi_control`,
 * `ansi_escape`, `control_char`, `todo`, `render_error`, `secret_default`.
 */
export function validateManifest(json: unknown): ManifestValidation {
  const findings: Finding[] = [];
  const parsed = ManifestSchema.safeParse(json);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const ptr = `block.json#/${issue.path.map(String).join("/")}`;
      if (issue.code === "unrecognized_keys") {
        for (const k of issue.keys) findings.push(finding("unknown_key", "block", `${ptr}`, `unknown key ${JSON.stringify(k)}`));
      } else findings.push(finding("schema", "block", ptr, issue.message));
    }
  }
  // String-level checks run even when the shape is wrong: a secret is a secret.
  for (const s of manifestStrings(json)) {
    const where = `block.json#${s.pointer}`;
    if (SIGNATURE_FIELDS.has(s.pointer)) continue;
    for (const hit of findSecrets(s.value, { entropy: s.pointer.startsWith("/envVars") || s.pointer.includes("/default") })) {
      findings.push(finding("secret", hit.confidence === "known" ? "block" : "warn", where, `${hit.kind} in a manifest field`));
    }
    for (const hit of findHiddenText(s.value)) {
      findings.push(finding(hit.rule, "block", where, `${hit.codepoint} in a manifest field`));
    }
    if (/\bTODO\b/.test(s.value)) findings.push(finding("todo", "block", where, "TODO left in the manifest"));
  }
  if (!parsed.success) return { ok: false, findings };
  const m = parsed.data;

  // paths
  const pathFields: [string, string][] = [];
  m.files.forEach((f, i) => pathFields.push([f.path, `block.json#/files/${i}/path`]));
  m.variants.forEach((v, i) => pathFields.push([v.root, `block.json#/variants/${i}/root`]));
  (m.migrations ?? []).forEach((x, i) => pathFields.push([x.file, `block.json#/migrations/${i}/file`]));
  (m.tests ?? []).forEach((x, i) => pathFields.push([x.file, `block.json#/tests/${i}/file`]));
  (m.exports ?? []).forEach((x, i) => pathFields.push([x.from, `block.json#/exports/${i}/from`]));
  if (m.docs) pathFields.push([m.docs, "block.json#/docs"]);
  if (m.skill) pathFields.push([m.skill, "block.json#/skill"]);
  for (const [p, where] of pathFields) {
    const f = pathFinding(p, where);
    if (f) findings.push(f);
  }
  m.files.forEach((f, i) => {
    if (f.target !== undefined && (/(^|\/)\.\.(\/|$)/.test(f.target) || f.target.startsWith("/") || f.target.includes("\\"))) {
      findings.push(finding(f.target.startsWith("/") ? "absolute_path" : "path_traversal", "block", `block.json#/files/${i}/target`, `${JSON.stringify(f.target)} escapes the project`));
    }
    if (f.merge && f.role !== "config-patch") findings.push(finding("schema", "block", `block.json#/files/${i}/merge`, "merge applies only to role config-patch"));
    if (f.role === "config-patch" && !f.merge) findings.push(finding("schema", "block", `block.json#/files/${i}`, "a config-patch needs a merge kind"));
    if (f.role !== "doc" && f.target === undefined) findings.push(finding("schema", "block", `block.json#/files/${i}`, "target is required (except for role doc)"));
  });

  // variants
  const variantIds = new Set<string>();
  for (const v of m.variants) {
    if (variantIds.has(v.id)) findings.push(finding("variant", "block", "block.json#/variants", `duplicate variant ${v.id}`));
    variantIds.add(v.id);
  }
  if (m.variants.filter((v) => v.default).length > 1) findings.push(finding("variant", "block", "block.json#/variants", "more than one default variant"));
  const seen = new Set<string>();
  m.files.forEach((f, i) => {
    if (f.variant && !variantIds.has(f.variant)) findings.push(finding("variant", "block", `block.json#/files/${i}/variant`, `unknown variant ${f.variant}`));
    const key = `${f.variant ?? ""}\u0000${f.path}`;
    if (seen.has(key)) findings.push(finding("duplicate_path", "block", `block.json#/files/${i}/path`, `duplicate file ${f.path}`));
    seen.add(key);
  });

  // params
  const names = new Set<string>();
  (m.params ?? []).forEach((p, i) => {
    const where = `block.json#/params/${i}`;
    if (names.has(p.name)) findings.push(finding("param", "block", where, `duplicate param ${p.name}`));
    names.add(p.name);
    if (p.type === "enum" && !(p.values && p.values.length)) findings.push(finding("param", "block", where, "enum needs values"));
    if (p.pattern) {
      try {
        new RegExp(p.pattern);
      } catch {
        findings.push(finding("param", "block", where, "pattern does not compile"));
      }
    }
    if (p.default !== undefined) {
      const r = validateParamValue(p, p.default);
      if (!r.ok) findings.push(finding("param", "block", where, `default is invalid: ${r.reason}`));
    } else if (!p.required) findings.push(finding("param", "block", where, "a param without a default must be marked required"));
  });

  // secrets must never carry values, and must not be duplicated as env defaults
  const secretNames = new Set((m.secrets ?? []).map((s) => s.name));
  for (const [k, v] of Object.entries(m.envVars ?? {})) {
    if (secretNames.has(k) && v !== "") findings.push(finding("secret_default", "block", `block.json#/envVars/${k}`, `${k} is declared a secret; it can't have a value`));
  }
  (m.env ?? []).forEach((e, i) => {
    if ((e.secret || secretNames.has(e.name)) && e.default) {
      findings.push(finding("secret_default", "block", `block.json#/env/${i}/default`, `${e.name} is a secret; it can't have a default`));
    }
  });

  // verify commands: rendered with defaults, then allowlisted
  const defaults = defaultParamValues(m);
  try { renderInterface(m, defaults); } catch (e) {
    findings.push(finding("render_error", "block", "block.json", (e as Error).message));
  }
  (m.verify?.commands ?? []).forEach((cmd, i) => {
    const where = `block.json#/verify/commands/${i}`;
    let rendered: string;
    try {
      rendered = renderTemplate(cmd, { params: defaults, paths: { ...DEFAULT_PATHS } });
    } catch (e) {
      findings.push(finding("render_error", "block", where, (e as Error).message));
      return;
    }
    const c = checkVerifyCommand(rendered);
    if (!c.allowed) findings.push(finding("verify_not_allowlisted", "block", where, `${JSON.stringify(rendered)}: ${c.reason}`));
  });

  // every templated manifest string must render with the defaults
  const templated: [string, string][] = [];
  m.files.forEach((f, i) => f.target && templated.push([f.target, `block.json#/files/${i}/target`]));
  (m.tables ?? []).forEach((t, i) => templated.push([t, `block.json#/tables/${i}`]));
  (m.routes ?? []).forEach((r, i) => templated.push([r.path, `block.json#/routes/${i}/path`]));
  (m.migrations ?? []).forEach((x, i) => (x.creates ?? []).forEach((c, j) => templated.push([c, `block.json#/migrations/${i}/creates/${j}`])));
  (m.agent?.adapt ?? []).forEach((a, i) => {
    for (const k of ["title", "where", "do", "check"] as const) if (a[k]) templated.push([a[k]!, `block.json#/agent/adapt/${i}/${k}`]);
  });
  for (const [t, where] of templated) {
    try {
      renderTemplate(t, { params: defaults, paths: { ...DEFAULT_PATHS }, migrations: [], fileDir: "" });
    } catch (e) {
      findings.push(finding("render_error", "block", where, (e as Error).message));
    }
  }

  return { ok: !findings.some((f) => f.severity === "block"), manifest: m, findings };
}

/** Resolve declared identifiers before conflict detection and lock recording. */
export function renderInterface(m: Manifest, params: ParamValues): Manifest {
  const identifier = (source: string, schema: typeof bindingName, kind: string): string => {
    const value = renderTemplate(source, { params, paths: { ...DEFAULT_PATHS } });
    if (!schema.safeParse(value).success) throw new Error(`rendered ${kind} ${JSON.stringify(value)} is not a valid identifier`);
    return value;
  };
  return {
    ...m,
    ...(m.bindings ? { bindings: m.bindings.map(b => ({ ...b, name: identifier(b.name, bindingName, "binding") })) } : {}),
    ...(m.exports ? { exports: m.exports.map(e => ({ ...e, symbol: identifier(e.symbol, exportSymbol, "export") })) } : {}),
  };
}
