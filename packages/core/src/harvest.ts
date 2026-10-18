/**
 * Harvest heuristics for `registry_harvest` (DESIGN §3.2): turn shipped project files into a draft block.
 * Finds migrations and their `CREATE TABLE` names, Hono/Next route declarations, `env.X` references, bindings,
 * exports and tests; proposes params from repeated app-specific literals; redacts known secret formats.
 * Leaves exactly two `TODO` markers in the manifest (agent summary and the first adapt item), so the draft fails
 * `validateBlock` until a person or agent writes them.
 */
import type { FileTree } from "./fs.ts";
import { isText, tryDecodeUtf8 } from "./hash.ts";
import { basename, normalizeRelative } from "./paths.ts";
import { wranglerBindings } from "./plan.ts";
import type { ProjectProfile } from "./profile.ts";
import { unrender, type ParamValues } from "./render.ts";
import { SCHEMA_URL } from "./schema.ts";
import { findSecrets, redactSecrets } from "./secrets.ts";

export interface HarvestInput {
  name: string;
  description: string;
  /** Project-relative path → content, for the selected paths (directories already expanded). */
  files: FileTree;
  profile?: ProjectProfile;
  stack?: { runtime?: string; framework?: string; db?: string; ui?: string; lang?: string; test?: string };
  /** literal → param name (e.g. `{ mailcheap: "appSlug" }`). */
  paramsHints?: Record<string, string>;
  /** The project's package.json (for the app name and dependency versions). */
  packageJson?: { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  /** The project's parsed wrangler config (for binding types). */
  wrangler?: unknown;
  source?: { repo: string; commit?: string };
  now?: string;
}

export interface HarvestResult {
  /** The draft manifest (block.json). */
  manifest: Record<string, unknown>;
  /** Block-relative files, including SKILL.md, CHANGELOG.md and docs/README.md. */
  files: FileTree;
  redactions: { path: string; kind: string; count: number }[];
  todo: string[];
}

const DEFAULT_PATHS = { app: "src", routes: "src/routes", lib: "src/lib", ui: "src/components", migrations: "migrations", tests: "test" };
const COMMON_DOMAINS = /(^|\.)(example\.(com|org|net)|cloudflare\.com|workers\.dev|github\.com|npmjs\.(com|org)|googleapis\.com|w3\.org|schema\.org|json-schema\.org|localhost|kitbash\.dev|anthropic\.com|openai\.com|stripe\.com)$/;

function roleOf(p: string, paths: Record<string, string>, text: string | null): { role: string; type: string } {
  const under = (k: string) => paths[k] && (p === paths[k] || p.startsWith(`${paths[k]}/`));
  if (/\.sql$/.test(p) && (under("migrations") || /(^|\/)migrations\//.test(p))) return { role: "migration", type: "registry:file" };
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || under("tests")) return { role: "test", type: "registry:file" };
  if (under("ui") || /\.(tsx|jsx|vue|svelte)$/.test(p)) return { role: "ui", type: "registry:ui" };
  if (under("routes") || (text && /\.(get|post|put|patch|delete)\(\s*["'`]\//.test(text)) || /(^|\/)route\.[jt]s$/.test(p)) return { role: "route", type: "registry:lib" };
  if (/\.(md|mdx)$/.test(p)) return { role: "doc", type: "registry:file" };
  return { role: "lib", type: "registry:lib" };
}

function targetFor(p: string, paths: Record<string, string>): string {
  let best: [string, string] | undefined;
  for (const [k, dir] of Object.entries(paths)) {
    if (!dir) continue;
    if ((p.startsWith(`${dir}/`)) && (!best || dir.length > best[1].length)) best = [k, dir];
  }
  return best ? `{{paths.${best[0]}}}${p.slice(best[1].length)}` : p;
}

function tableNames(sql: string): string[] {
  return [...sql.matchAll(/\bCREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?([A-Za-z_][A-Za-z0-9_]*)/gi)].map((m) => m[1]!);
}

function nextRoutePath(p: string): string {
  const parts = p.split("/");
  const appIdx = parts.lastIndexOf("app");
  const segs = parts.slice(appIdx + 1, -1).filter((s) => !/^\(.*\)$/.test(s)).map((s) => s.replace(/^\[\.\.\.(.+)\]$/, "*").replace(/^\[(.+)\]$/, ":$1"));
  return `/${segs.join("/")}`;
}

export function harvestDraft(input: HarvestInput): HarvestResult {
  const paths: Record<string, string> = { ...DEFAULT_PATHS, ...(input.profile?.paths ?? {}) };
  const stack = { ...(input.profile?.stack ?? {}), ...(input.stack ?? {}) };
  const variantId = stack.framework && stack.db ? `${stack.framework}-${stack.db}` : stack.framework ?? "default";
  const root = `variants/${variantId}`;
  const redactions: HarvestResult["redactions"] = [];
  const todo: string[] = [];

  // 1. collect text, drop secret files, redact known secrets
  const sources: { path: string; text: string | null; data: string | Uint8Array }[] = [];
  for (const raw of Object.keys(input.files).sort()) {
    const p = normalizeRelative(raw);
    if (p === null || p !== raw) {
      todo.push(`Skipped unsafe path ${JSON.stringify(raw)}`);
      continue;
    }
    if (/(^|\/)node_modules\//.test(p) || /(^|\/)\.git\//.test(p)) continue;
    if (/(^|\/)\.(dev\.vars|env)(\.[A-Za-z0-9_-]+)?$/.test(p) && !p.endsWith(".example")) {
      redactions.push({ path: p, kind: "env-file", count: 1 });
      continue;
    }
    const data = input.files[raw]!;
    if (!isText(data)) {
      sources.push({ path: p, text: null, data });
      continue;
    }
    let text = tryDecodeUtf8(data)!;
    const r = redactSecrets(text, { entropy: false });
    for (const x of r.redactions) redactions.push({ path: p, kind: x.kind, count: x.count });
    text = r.text;
    for (const h of findSecrets(text).filter((x) => x.confidence === "entropy")) todo.push(`Check ${p}:${h.line}: a high-entropy string (a secret? redact it)`);
    sources.push({ path: p, text, data: text });
  }

  // 2. params from literals
  const params: { name: string; type: string; default: string; pattern?: string; description: string }[] = [];
  const values: ParamValues = {};
  const allText = sources.map((s) => s.text ?? "").join("\n");
  const count = (lit: string) => (lit ? allText.split(lit).length - 1 : 0);
  for (const [literal, name] of Object.entries(input.paramsHints ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || literal.length < 3) continue;
    const ident = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(literal);
    params.push({ name, type: ident ? "identifier" : "string", default: literal, description: `Harvested from the literal ${JSON.stringify(literal)}.` });
    values[name] = literal;
  }
  const appName = input.packageJson?.name?.replace(/^@[^/]+\//, "");
  if (appName && !Object.hasOwn(values, "appSlug") && !Object.values(values).includes(appName) && /^[a-z][a-z0-9-]*$/.test(appName) && count(appName) >= 2) {
    params.push({ name: "appSlug", type: "identifier", default: appName, description: "Short app name used for resources." });
    values.appSlug = appName;
  }
  if (!Object.hasOwn(values, "tokenPrefix")) {
    const prefixes = new Map<string, number>();
    for (const m of allText.matchAll(/["'`]([a-z]{2,6}_)["'`]/g)) prefixes.set(m[1]!, (prefixes.get(m[1]!) ?? 0) + 1);
    const top = [...prefixes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (top && top[0].length >= 3) {
      params.push({ name: "tokenPrefix", type: "identifier", default: top[0], pattern: "^[a-z]{2,6}_$", description: "Token prefix (makes tokens greppable)." });
      values.tokenPrefix = top[0];
      todo.push(`Review tokenPrefix: only quoted ${JSON.stringify(top[0])} literals were templated`);
    }
  }
  if (!Object.hasOwn(values, "appDomain")) {
    const domains = new Map<string, number>();
    for (const m of allText.matchAll(/\b((?:[a-z0-9-]+\.)+(?:com|io|dev|app|net|org|ai|co|xyz|so))\b/g)) {
      const d = m[1]!.toLowerCase();
      if (!COMMON_DOMAINS.test(d)) domains.set(d, (domains.get(d) ?? 0) + 1);
    }
    const top = [...domains].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (top) {
      params.push({ name: "appDomain", type: "string", default: top[0], description: "The app's domain (mail sender, links)." });
      values.appDomain = top[0];
    }
  }

  // 3. files → block files (templated), interface
  const files: FileTree = {};
  const fileEntries: Record<string, unknown>[] = [];
  const migrations: Record<string, unknown>[] = [];
  const tables: string[] = [];
  const routes: Record<string, unknown>[] = [];
  const exportsList: Record<string, unknown>[] = [];
  const tests: Record<string, unknown>[] = [];
  const envRefs = new Set<string>();
  const imports = new Set<string>();
  let migN = 0;
  const tokenPrefixLiteral = typeof values.tokenPrefix === "string" ? values.tokenPrefix : undefined;
  const unrenderValues: ParamValues = Object.fromEntries(Object.entries(values).filter(([k]) => k !== "tokenPrefix"));
  for (const s of sources) {
    const { role, type } = roleOf(s.path, paths, s.text);
    let blockPath = s.path;
    let target = targetFor(s.path, paths);
    if (role === "migration") {
      migN++;
      const name = basename(s.path).replace(/^\d+_/, "").replace(/\.sql$/, "");
      const file = `migrations/${String(migN).padStart(4, "0")}_${name}.sql`;
      blockPath = file;
      target = `{{paths.migrations}}/${String(migN).padStart(4, "0")}_${name}.sql`;
      const created = s.text ? tableNames(s.text) : [];
      const templated = created.map((t) => unrender(t, unrenderValues).text);
      tables.push(...templated);
      migrations.push({ file, name: name.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 64) || "migration", creates: templated });
    }
    const entry: Record<string, unknown> = { path: blockPath, type, target, role, variant: variantId };
    let out: string | Uint8Array = s.data;
    if (s.text !== null) {
      let t = s.text;
      if (/\{\{\s*(#|\/)?\s*(kit|paths|migrations)\./.test(t)) {
        entry.template = false;
        todo.push(`${s.path} contains {{kit. text: copied verbatim (template: false); template it by hand if needed`);
      } else {
        if (tokenPrefixLiteral) t = t.replace(new RegExp(`(["'\`])${tokenPrefixLiteral}(["'\`])`, "g"), "$1{{kit.tokenPrefix}}$2");
        t = unrender(t, unrenderValues).text;
      }
      out = t;
      // interface discovery on the original (redacted) text
      for (const m of s.text.matchAll(/\b(?:c\.)?env\.([A-Z][A-Z0-9_]+)\b|\bprocess\.env\.([A-Z][A-Z0-9_]+)\b/g)) envRefs.add(m[1] ?? m[2]!);
      if (role !== "test") {
        for (const m of s.text.matchAll(/\.(get|post|put|patch|delete|all)\(\s*["'`](\/[^"'`]*)["'`]/g)) {
          routes.push({ method: m[1]!.toUpperCase(), path: unrender(m[2]!, unrenderValues).text, auth: "public" });
        }
        if (/(^|\/)route\.[jt]s$/.test(s.path)) {
          for (const m of s.text.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) routes.push({ method: m[1]!, path: nextRoutePath(s.path), auth: "public" });
        }
        if (role === "lib" || role === "route") {
          for (const m of s.text.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
            if (exportsList.length < 20) exportsList.push({ symbol: m[1]!, from: blockPath, kind: /export\s+class/.test(m[0]) ? "class" : "function" });
          }
        }
      }
      for (const m of s.text.matchAll(/\bfrom\s+["']([^"'./][^"']*)["']|\bimport\s*\(\s*["']([^"'./][^"']*)["']\s*\)/g)) {
        const spec = m[1] ?? m[2]!;
        if (/^(node|cloudflare|bun):/.test(spec)) continue;
        imports.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!);
      }
    }
    if (role === "test") {
      const rel = s.path.startsWith(`${paths.tests}/`) ? s.path.slice(paths.tests!.length + 1) : basename(s.path);
      tests.push({ file: blockPath, runner: stack.test ?? "vitest", covers: [] , _rel: rel });
    }
    files[`${root}/${blockPath}`] = out;
    fileEntries.push(entry);
  }
  if (routes.length) todo.push("Review routes[].auth: every route was recorded as public");
  if (!tests.length) todo.push("Add tests: a block's tests are its install acceptance check");

  // 4. env, secrets, bindings
  const bindingTypes = new Map(wranglerBindings(input.wrangler).filter((b) => b.type !== "var").map((b) => [b.name, b.type]));
  const env: Record<string, unknown>[] = [];
  const secrets: Record<string, unknown>[] = [];
  const bindings: Record<string, unknown>[] = [];
  for (const name of [...envRefs].sort()) {
    const btype = bindingTypes.get(name) ?? (new RegExp(`\\b${name}\\.prepare\\(`).test(allText) ? "d1" : undefined);
    if (btype) bindings.push({ type: btype, name, required: true });
    else if (/SECRET|TOKEN|KEY|PEPPER|PASSWORD|PRIVATE|SALT/.test(name)) secrets.push({ name, required: true, description: `Harvested from env.${name}.` });
    else env.push({ name, secret: false, description: `Harvested from env.${name}.` });
  }

  // 5. dependencies
  const deps: string[] = [];
  const pj = input.packageJson ?? {};
  for (const name of [...imports].sort()) {
    const v = pj.dependencies?.[name] ?? pj.devDependencies?.[name];
    if (v && !v.startsWith("workspace:")) deps.push(`${name}@${v}`);
    else if (!v) todo.push(`Import ${name} is not in package.json: add it to dependencies[] with a version`);
  }

  // 6. verify, docs, manifest
  const verifyCommands = tests.map((t) => `npx vitest run {{paths.tests}}/${(t as { _rel: string })._rel}`);
  for (const t of tests) delete (t as { _rel?: string })._rel;
  if ((stack.lang ?? "ts") === "ts") verifyCommands.push("npx tsc --noEmit");
  const title = input.description.split(/(?<=[.!?])\s/)[0]!.slice(0, 120);
  const skill = `---\nname: ${input.name}\ndescription: ${title.replace(/\n/g, " ")}\nlicense: Proprietary\nmetadata:\n  kitbash: "@scope/${input.name}@0.1.0"\n---\n\n# ${input.name}\n\n## What it adds\n\n${input.description}\n\n## Interface\n\nSee block.json: tables, routes, env, secrets and bindings.\n\n## Install\n\nregistry_install (dry run first), then apply.\n\n## Adapt\n\nFollow the adapt checklist the install returns.\n\n## Verify\n\nregistry_verify runs the block's tests.\n\n## Known limits\n\nHarvested draft; see CHANGELOG.md.\n`;
  files["SKILL.md"] = skill;
  files["CHANGELOG.md"] = `## 0.1.0\n\nHarvested${input.source ? ` from ${input.source.repo}${input.source.commit ? `@${input.source.commit}` : ""}` : ""}.\n`;
  files["docs/README.md"] = `# ${input.name}\n\n${input.description}\n`;
  fileEntries.push({ path: "SKILL.md", type: "registry:file", target: `.kit/blocks/${input.name}/SKILL.md`, role: "doc" });

  const manifest: Record<string, unknown> = {
    $schema: SCHEMA_URL,
    name: input.name,
    type: "registry:block",
    title,
    description: input.description,
    version: "0.1.0",
    license: "Proprietary",
    meta: { maturity: "experimental", origin: "harvested" },
    stack,
    variants: [{ id: variantId, default: true, root, stack: { ...(stack.framework ? { framework: stack.framework } : {}), ...(stack.db ? { db: stack.db } : {}) } }],
    params,
    files: fileEntries,
    ...(deps.length ? { dependencies: deps } : {}),
    ...(env.length ? { env } : {}),
    ...(secrets.length ? { secrets } : {}),
    ...(bindings.length ? { bindings } : {}),
    ...(migrations.length ? { migrations } : {}),
    ...(tables.length ? { tables } : {}),
    ...(routes.length ? { routes } : {}),
    ...(exportsList.length ? { exports: exportsList } : {}),
    ...(tests.length ? { tests } : {}),
    verify: { commands: verifyCommands, expect: "all pass" },
    docs: "docs/README.md",
    skill: "SKILL.md",
    agent: {
      summary: "TODO: two or three sentences: what the block adds, what it needs (bindings, secrets).",
      adapt: [{ id: "wire-up", required: true, title: "TODO: how to wire the block into the app (where, do, check)" }],
    },
    provenance: {
      ...(input.source ? { source: { repo: input.source.repo, ...(input.source.commit ? { commit: input.source.commit } : {}), paths: sources.map((s) => s.path) } } : {}),
      origin: "harvested-own",
      harvested_by: "agent",
      ...(input.now ? { harvested_at: input.now } : {}),
    },
  };
  todo.unshift("Write agent.summary (replace the TODO)", "Write agent.adapt[] (replace the TODO item; add where/do/check)");
  return { manifest, files, redactions, todo };
}
