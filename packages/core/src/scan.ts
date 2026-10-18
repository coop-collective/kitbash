/**
 * The client-side scanner (BLOCK-SPEC §9, DESIGN §5.2 client subset) and `validateBlock()`.
 *
 * Covers: secrets, path rules (declared = shipped, no `..`, no symlinks, no executable bits, case collisions,
 * size caps), hidden text (invisible Unicode, bidi controls, ANSI escapes), prompt-injection heuristics on author
 * text and Markdown, dangerous-code hints, `verify.commands` allowlist, template rendering with defaults, and
 * declared-vs-shipped consistency (tables, routes, env, exports, tests, migrations, SKILL.md).
 * The server (WP-12) adds OSV/typosquat checks and the sandbox.
 */
import { finding, type Finding } from "./errors.ts";
import type { BlockBundle } from "./fs.ts";
import { byteLength, countLines, isText, sha256Hex, tryDecodeUtf8 } from "./hash.ts";
import { findInjection } from "./injection.ts";
import { pathProblem, dirname } from "./paths.ts";
import { renderTemplate } from "./render.ts";
import {
  bundlePath,
  DEFAULT_PATHS,
  defaultParamValues,
  filesForVariant,
  renderedTables,
  validateManifest,
  type FileEntry,
  type Manifest,
} from "./schema.ts";
import { findHiddenText, findSecrets } from "./secrets.ts";
import { checkSkill } from "./summary.ts";

export const MAX_BLOCK_BYTES = 2 * 1024 * 1024;
export const MAX_FILES = 200;
export const RECOMMENDED_FILES = 60;

/** Files a block directory may contain without declaring them in `files[]`. */
export function metaFiles(m: Manifest | undefined): Set<string> {
  const s = new Set(["block.json", "CHANGELOG.md", "LICENSE", "LICENSE.md", "LICENSE.txt"]);
  if (m?.docs) s.add(m.docs);
  if (m?.skill) s.add(m.skill);
  return s;
}

const CODE_EXT = /\.(m|c)?(t|j)sx?$/;
const ENV_FILE = /(^|\/)\.(dev\.vars|env)(\.[A-Za-z0-9_-]+)?$/;

export interface ScanReport {
  findings: Finding[];
  /** True when no finding has severity `block`. */
  ok: boolean;
}

export interface ScanOptions {
  /** Skip the hash check against `files[].sha256` (set when the registry fills hashes later). */
  skipHashes?: boolean;
}

function textOf(data: string | Uint8Array): string | null {
  return isText(data) ? tryDecodeUtf8(data) : null;
}

/** Scans author-written manifest fields for prompt injection. */
function scanAuthorFields(m: Manifest, out: Finding[]): void {
  const fields: [string, string][] = [
    [m.title, "block.json#/title"],
    [m.description, "block.json#/description"],
  ];
  const a = m.agent;
  if (a?.summary) fields.push([a.summary, "block.json#/agent/summary"]);
  a?.when_to_use?.forEach((t, i) => fields.push([t, `block.json#/agent/when_to_use/${i}`]));
  a?.when_not_to_use?.forEach((t, i) => fields.push([t, `block.json#/agent/when_not_to_use/${i}`]));
  a?.adapt?.forEach((x, i) => {
    for (const k of ["title", "where", "do", "check"] as const) if (x[k]) fields.push([x[k]!, `block.json#/agent/adapt/${i}/${k}`]);
  });
  if (a?.author_notes) fields.push([a.author_notes, "block.json#/agent/author_notes"]);
  if (m.verify?.expect) fields.push([m.verify.expect, "block.json#/verify/expect"]);
  m.params?.forEach((p, i) => p.description && fields.push([p.description, `block.json#/params/${i}/description`]));
  m.env?.forEach((e, i) => e.description && fields.push([e.description, `block.json#/env/${i}/description`]));
  m.secrets?.forEach((e, i) => {
    if (e.description) fields.push([e.description, `block.json#/secrets/${i}/description`]);
    if (e.obtain) fields.push([e.obtain, `block.json#/secrets/${i}/obtain`]);
  });
  m.bindings?.forEach((b, i) => {
    if (b.note) fields.push([b.note, `block.json#/bindings/${i}/note`]);
    if (b.create) fields.push([b.create, `block.json#/bindings/${i}/create`]);
  });
  m.routes?.forEach((r, i) => r.description && fields.push([r.description, `block.json#/routes/${i}/description`]));
  for (const [t, where] of fields) {
    for (const h of findInjection(t)) out.push(finding("prompt_injection", h.severity, where, `${h.rule}: ${h.excerpt}`));
  }
}

function scanCode(path: string, text: string, m: Manifest, out: Finding[]): void {
  const lines = text.split("\n");
  const hosts = new Set((m.meta?.network_hosts ?? []).map((h) => h.toLowerCase()));
  const rules: [RegExp, string, string][] = [
    [/\beval\s*\(/, "dangerous_code", "eval()"],
    [/\bnew\s+Function\s*\(/, "dangerous_code", "new Function()"],
    [/["'`](node:)?child_process["'`]/, "dangerous_code", "child_process"],
    [/\bimport\s*\(\s*["'`]https?:/, "dangerous_code", "dynamic import of a URL"],
    [/\brequire\s*\(\s*["'`]https?:/, "dangerous_code", "require of a URL"],
    [/["'`](node:)?(vm|worker_threads)["'`]/, "dangerous_code", "vm/worker_threads"],
    [/[A-Za-z0-9+/]{200,}={0,2}/, "obfuscation", "long base64 blob"],
    [/(\\x[0-9a-f]{2}){20,}/i, "obfuscation", "hex-escaped string"],
  ];
  lines.forEach((line, i) => {
    for (const [re, rule, what] of rules) if (re.test(line)) out.push(finding(rule, "warn", path, what, i + 1));
    for (const mm of line.matchAll(/\bfetch\s*\(\s*["'`]https?:\/\/([^/"'`:]+)/g)) {
      const host = mm[1]!.toLowerCase();
      if (!hosts.has(host)) out.push(finding("network_host", "warn", path, `fetch to ${host}, not in meta.network_hosts`, i + 1));
      else out.push(finding("network_host", "info", path, `${host} declared in meta.network_hosts`, i + 1));
    }
  });
  const long = lines.filter((l) => l.length > 500).length;
  const avg = text.length / Math.max(1, lines.length);
  if (long > 0 && avg > 200) out.push(finding("minified", "warn", path, "looks minified"));
}

function migrationTables(sql: string): string[] {
  const out: string[] = [];
  for (const m of sql.matchAll(/\bCREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?([A-Za-z_][A-Za-z0-9_]*)[`"\]]?/gi)) out.push(m[1]!);
  return out;
}

/**
 * Scans a block bundle. Runs `validateManifest` first; file-level checks run only when the manifest parses.
 */
export async function scanBlock(bundle: BlockBundle, opts: ScanOptions = {}): Promise<ScanReport> {
  const v = validateManifest(bundle.manifest);
  const findings: Finding[] = [...v.findings];
  const m = v.manifest;

  // ---- path rules on what was shipped ----
  const shipped = Object.keys(bundle.files);
  const lowerSeen = new Map<string, string>();
  let total = 0;
  for (const p of shipped) {
    const prob = pathProblem(p);
    if (prob) findings.push(finding(prob === "traversal" ? "path_traversal" : prob === "absolute" ? "absolute_path" : "invalid_path", "block", p, `bundle path ${prob.replace(/_/g, " ")}`));
    const lower = p.toLowerCase();
    const other = lowerSeen.get(lower);
    if (other !== undefined) findings.push(finding("case_collision", "block", p, `collides with ${other} on case-insensitive file systems`));
    lowerSeen.set(lower, p);
    total += byteLength(bundle.files[p]!);
  }
  for (const s of bundle.symlinks ?? []) findings.push(finding("symlink", "block", s, "symlinks are not allowed"));
  for (const [p, mode] of Object.entries(bundle.modes ?? {})) {
    if (mode & 0o111) findings.push(finding("executable", "block", p, "executable bit set; blocks contain no executables"));
  }
  if (total > MAX_BLOCK_BYTES) findings.push(finding("too_large", "block", "", `${total} bytes > ${MAX_BLOCK_BYTES}`));
  if (shipped.length > MAX_FILES) findings.push(finding("too_many_files", "block", "", `${shipped.length} files > ${MAX_FILES}`));
  else if (shipped.length > RECOMMENDED_FILES) findings.push(finding("too_many_files", "warn", "", `${shipped.length} files (60 recommended)`));

  // ---- every text file: secrets and hidden text, regardless of manifest validity ----
  const declaredByPath = new Map<string, FileEntry>();
  if (m) for (const f of m.files) declaredByPath.set(bundlePath(m, f), f);
  for (const p of shipped) {
    const t = textOf(bundle.files[p]!);
    if (t === null) continue;
    const entry = declaredByPath.get(p);
    const isTest = entry?.role === "test" || /(^|\/)(test|tests|__tests__|fixtures)\//.test(p) || /\.(test|spec)\.[a-z]+$/.test(p);
    for (const hit of findSecrets(t)) {
      const sev = hit.confidence === "known" ? "block" : isTest ? "info" : "warn";
      findings.push(finding("secret", sev, p, `${hit.kind}`, hit.line));
    }
    for (const hit of findHiddenText(t)) findings.push(finding(hit.rule, "block", p, `${hit.codepoint}`, hit.line));
    if (/\.(md|markdown|mdx|txt)$/i.test(p)) {
      for (const h of findInjection(t, { markdown: true })) findings.push(finding("prompt_injection", h.severity, p, `${h.rule}: ${h.excerpt}`, h.line));
    }
  }
  if (!m) return { findings, ok: !findings.some((f) => f.severity === "block") };

  // ---- declared vs shipped ----
  const meta = metaFiles(m);
  const declared = new Set<string>();
  for (const f of m.files) {
    const bp = bundlePath(m, f);
    declared.add(bp);
    const has = Object.hasOwn(bundle.files, bp);
    if (!has && f.content === undefined) findings.push(finding("missing_file", "block", bp, "declared in files[] but not shipped"));
    if (has && f.content !== undefined) findings.push(finding("duplicate_path", "warn", bp, "both inline content and a shipped file"));
    if (has && f.sha256 && !opts.skipHashes) {
      const h = await sha256Hex(bundle.files[bp]!);
      if (h !== f.sha256) findings.push(finding("hash_mismatch", "block", bp, "content does not match files[].sha256"));
    }
  }
  for (const p of shipped) {
    if (!declared.has(p) && !meta.has(p)) findings.push(finding("undeclared_file", "block", p, "shipped but not declared in files[]"));
  }
  if (m.skill && !Object.hasOwn(bundle.files, m.skill)) findings.push(finding("missing_file", "block", m.skill, "skill file not shipped"));
  if (m.docs && !Object.hasOwn(bundle.files, m.docs)) findings.push(finding("missing_file", "warn", m.docs, "docs file not shipped"));

  scanAuthorFields(m, findings);

  // ---- per declared file: env files, code hints, rendering with defaults ----
  const defaults = defaultParamValues(m);
  const secretNames = new Set((m.secrets ?? []).map((s) => s.name));
  const renderedByVariant = new Map<string, Map<string, string>>(); // variant -> bundlePath -> rendered text
  for (const variant of m.variants) {
    const rendered = new Map<string, string>();
    renderedByVariant.set(variant.id, rendered);
    for (const f of filesForVariant(m, variant.id)) {
      const bp = bundlePath(m, f);
      const raw = Object.hasOwn(bundle.files, bp) ? bundle.files[bp]! : f.content;
      if (raw === undefined) continue;
      const t = textOf(raw);
      const target = f.target ?? "";
      if (ENV_FILE.test(target) && !target.endsWith(".example")) {
        findings.push(finding("env_file", "block", bp, `writes ${target}; only *.example env files may ship`));
      }
      if (t === null) continue;
      let out = t;
      if (f.template !== false) {
        try {
          const renderedTarget = target ? renderTemplate(target, { params: defaults, paths: { ...DEFAULT_PATHS } }) : "";
          out = renderTemplate(t, { params: defaults, paths: { ...DEFAULT_PATHS }, migrations: [], fileDir: dirname(renderedTarget) });
        } catch (e) {
          findings.push(finding("render_error", "block", bp, (e as Error).message));
        }
      }
      rendered.set(bp, out);
      if (f.role === "config-patch" && f.merge === "append-missing-lines") {
        out.split("\n").forEach((line, i) => {
          const mm = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
          if (mm && secretNames.has(mm[1]!) && mm[2]!.trim() !== "" && mm[2]!.trim() !== '""') {
            findings.push(finding("secret_value", "block", bp, `${mm[1]} is a declared secret; ship the name only`, i + 1));
          }
        });
      }
      if (CODE_EXT.test(f.path) && f.role !== "doc") scanCode(bp, t, m, findings);
    }
  }

  // ---- consistency (rule 6) ----
  for (const variant of m.variants) {
    const vf = filesForVariant(m, variant.id);
    const rendered = renderedByVariant.get(variant.id)!;
    const migFiles = vf.filter((f) => f.role === "migration");
    const listed = new Set((m.migrations ?? []).map((x) => x.file));
    for (const f of migFiles) {
      if (!/^\d+_[A-Za-z0-9_-]+\.sql$/.test(f.path.split("/").pop()!)) findings.push(finding("migration_name", "block", bundlePath(m, f), "migration files are NNNN_name.sql"));
      if (!listed.has(f.path)) findings.push(finding("undeclared_migration", "warn", bundlePath(m, f), "not listed in migrations[]"));
    }
    for (const x of m.migrations ?? []) {
      if (!vf.some((f) => f.role === "migration" && f.path === x.file)) {
        findings.push(finding("missing_migration", m.variants.length > 1 ? "warn" : "block", `block.json#/migrations`, `${x.file} has no migration file in variant ${variant.id}`));
      }
    }
    // tables
    let created: string[] = [];
    for (const f of migFiles) created = created.concat(migrationTables(rendered.get(bundlePath(m, f)) ?? ""));
    let declaredTables: string[] = [];
    try {
      declaredTables = renderedTables(m, defaults);
    } catch {
      /* reported as render_error */
    }
    for (const t of created) if (!declaredTables.includes(t)) findings.push(finding("table_not_declared", "warn", "block.json#/tables", `${t} is created by a migration but not in tables[] (variant ${variant.id})`));
    for (const t of declaredTables) if (migFiles.length && !created.includes(t)) findings.push(finding("table_not_created", "warn", "block.json#/tables", `${t} is declared but no migration creates it (variant ${variant.id})`));
    // routes: the part after the leading param token must appear in some code file
    const code = vf.filter((f) => CODE_EXT.test(f.path)).map((f) => rendered.get(bundlePath(m, f)) ?? "").join("\n");
    for (const r of m.routes ?? []) {
      const tail = r.path.replace(/^(\{\{[^}]+\}\})+/, "");
      const probe = tail.split("/").filter(Boolean).slice(-2).join("/");
      if (probe && !code.includes(probe)) findings.push(finding("route_not_found", "warn", "block.json#/routes", `${r.method} ${r.path} not found in the code (variant ${variant.id})`));
    }
    // env, secrets, bindings referenced
    for (const n of [...(m.env ?? []).map((e) => e.name), ...secretNames, ...(m.bindings ?? []).map((b) => b.name)]) {
      if (code && !new RegExp(`\\b${n}\\b`).test(code)) findings.push(finding("env_not_referenced", "warn", "block.json", `${n} is declared but not referenced in the code (variant ${variant.id})`));
    }
    // exports
    for (const e of m.exports ?? []) {
      const f = vf.find((x) => x.path === e.from);
      const t = f ? rendered.get(bundlePath(m, f)) : undefined;
      if (t === undefined) findings.push(finding("export_not_found", "warn", "block.json#/exports", `${e.from} is not a file of variant ${variant.id}`));
      else if (!new RegExp(`export\\s+(?:declare\\s+)?(?:async\\s+)?(?:const|let|var|function\\*?|class|type|interface|enum)\\s+${e.symbol}\\b|export\\s*\\{[^}]*\\b${e.symbol}\\b`).test(t)) {
        findings.push(finding("export_not_found", "warn", "block.json#/exports", `${e.symbol} is not exported from ${e.from}`));
      }
    }
    // tests
    for (const t of m.tests ?? []) {
      if (!vf.some((f) => f.path === t.file && f.role === "test")) findings.push(finding("missing_test_file", "block", "block.json#/tests", `${t.file} is not a test-role file of variant ${variant.id}`));
    }
  }
  if (!(m.tests ?? []).length) findings.push(finding("no_tests", "warn", "block.json#/tests", "blocks ship tests; they are the install acceptance check"));

  // ---- SKILL.md ----
  if (m.skill && Object.hasOwn(bundle.files, m.skill)) {
    const t = textOf(bundle.files[m.skill]!) ?? "";
    const c = checkSkill(t, m.name);
    for (const p of c.problems) findings.push(finding(p.includes("tokens") ? "budget" : "skill", p.includes("tokens") ? "block" : "warn", m.skill, p));
  }

  return { findings, ok: !findings.some((f) => f.severity === "block") };
}

export interface BlockValidation extends ScanReport {
  manifest?: Manifest;
  /** Computed size (files, lines). */
  size?: { files: number; lines: number };
}

/** `kit validate`: schema + scanner. `ok` is false on any `block` finding. */
export async function validateBlock(bundle: BlockBundle, opts: ScanOptions = {}): Promise<BlockValidation> {
  const report = await scanBlock(bundle, opts);
  const v = validateManifest(bundle.manifest);
  const out: BlockValidation = { ...report };
  if (v.manifest) {
    out.manifest = v.manifest;
    let lines = 0;
    for (const f of v.manifest.files) {
      const d = bundle.files[bundlePath(v.manifest, f)] ?? f.content;
      if (d !== undefined) lines += countLines(d);
    }
    out.size = { files: v.manifest.files.length, lines };
  }
  return out;
}

/**
 * Publish policy: a public publish is refused on any `block` or `warn` finding; a private publish only on `block`
 * (BLOCK-SPEC §9: findings block public publish and warn on private).
 */
export function publishAllowed(findings: readonly Finding[], visibility: "private" | "public"): boolean {
  if (findings.some((f) => f.severity === "block")) return false;
  if (visibility === "public" && findings.some((f) => f.severity === "warn")) return false;
  return true;
}
