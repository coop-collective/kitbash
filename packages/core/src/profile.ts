/**
 * The project profile `.kit/project.json` (BLOCK-SPEC §6.1) and stack detection.
 */
import * as jsonc from "jsonc-parser";
import { z } from "zod";
import { KitError } from "./errors.ts";
import { readText, writeText, type KitFs } from "./fs.ts";
import { stableStringify } from "./hash.ts";
import { normalizeRelative } from "./paths.ts";

export const PROFILE_PATH = ".kit/project.json";

const relDir = z
  .string()
  .max(256)
  .regex(/^[A-Za-z0-9._@/-]+$/, "letters, digits and . _ @ / - only")
  .refine((p) => normalizeRelative(p) === p, "a normalized relative path");

export const ProjectProfileSchema = z.strictObject({
  project_id: z.string().regex(/^prj_[A-Za-z0-9_]{4,64}$/),
  stack: z.strictObject({
    runtime: z.string().optional(),
    framework: z.string().optional(),
    db: z.string().optional(),
    ui: z.string().optional(),
    lang: z.string().optional(),
    test: z.string().optional(),
  }),
  paths: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), relDir),
  migrations: z.strictObject({
    pattern: z.enum(["NNNN_name.sql", "TIMESTAMP_name.sql"]),
    width: z.number().int().min(1).max(8).optional(),
  }),
  config: z.strictObject({ wrangler: relDir.optional(), env_example: relDir.optional() }).optional(),
  package_manager: z.enum(["pnpm", "npm", "yarn", "bun"]).optional(),
  telemetry: z.boolean().optional(),
});
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;

export async function readProfile(fs: KitFs): Promise<ProjectProfile | null> {
  const t = await readText(fs, PROFILE_PATH);
  if (t === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(t);
  } catch {
    throw new KitError("invalid_params", `${PROFILE_PATH} is not valid JSON`);
  }
  const p = ProjectProfileSchema.safeParse(json);
  if (!p.success) throw new KitError("invalid_params", `${PROFILE_PATH}: ${p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return p.data;
}

export async function writeProfile(fs: KitFs, profile: ProjectProfile): Promise<void> {
  const p = ProjectProfileSchema.parse(profile);
  await writeText(fs, PROFILE_PATH, stableStringify(p));
}

export function parseJsonc(text: string): unknown {
  const errors: jsonc.ParseError[] = [];
  const v = jsonc.parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) throw new KitError("invalid_params", `JSONC parse error at offset ${errors[0]!.offset}`);
  return v;
}

const WRANGLER_FILES = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];

export interface DetectedProfile extends Omit<ProjectProfile, "project_id"> {
  /** Notes about what was guessed. */
  notes: string[];
}

async function exists(fs: KitFs, p: string): Promise<boolean> {
  return (await fs.readFile(p)) !== null;
}

async function isDir(fs: KitFs, p: string): Promise<boolean> {
  return (await fs.list(p)) !== null;
}

/**
 * Detects the stack from `package.json`, `wrangler.*`, `next.config.*`, `vitest.config.*` and the migrations
 * directory. Never throws on a malformed file; it notes it instead.
 */
export async function detectStack(fs: KitFs): Promise<DetectedProfile> {
  const notes: string[] = [];
  const stack: ProjectProfile["stack"] = { lang: "js" };
  let deps: Record<string, string> = {};
  const pkgText = await readText(fs, "package.json");
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      deps = { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
    } catch {
      notes.push("package.json is not valid JSON");
    }
  } else notes.push("no package.json");

  if (deps.typescript || (await exists(fs, "tsconfig.json"))) stack.lang = "ts";

  let wranglerFile: string | undefined;
  let wrangler: Record<string, unknown> | undefined;
  for (const f of WRANGLER_FILES) {
    const t = await readText(fs, f);
    if (t === null) continue;
    wranglerFile = f;
    if (f.endsWith(".toml")) {
      notes.push("wrangler.toml is read for detection only; config patches need wrangler.jsonc or wrangler.json");
      if (/^\s*\[\[d1_databases\]\]/m.test(t)) wrangler = { d1_databases: [{}] };
    } else {
      try {
        wrangler = parseJsonc(t) as Record<string, unknown>;
      } catch {
        notes.push(`${f} could not be parsed`);
      }
    }
    break;
  }
  if (wranglerFile || deps.wrangler) stack.runtime = "cloudflare-workers";
  else if (deps.next) stack.runtime = "node";

  const hasNextConfig = (await Promise.all(["next.config.js", "next.config.mjs", "next.config.ts"].map((f) => exists(fs, f)))).some(Boolean);
  if (deps.next || hasNextConfig) stack.framework = "nextjs";
  else if (deps.hono) stack.framework = "hono";
  else if (deps.express) stack.framework = "express";
  else if (wranglerFile) stack.framework = "worker";

  if (wrangler && Array.isArray(wrangler.d1_databases) && wrangler.d1_databases.length) stack.db = "d1";
  else if (deps["drizzle-orm"] || deps.kysely) stack.db = "sql";

  if (deps.react || deps.next) stack.ui = "react";
  else if (deps.vue) stack.ui = "vue";
  else if (deps.svelte) stack.ui = "svelte";
  else stack.ui = "none";

  const hasVitestConfig = (await Promise.all(["vitest.config.ts", "vitest.config.mts", "vitest.config.js", "vitest.config.mjs"].map((f) => exists(fs, f)))).some(Boolean);
  if (deps["@cloudflare/vitest-pool-workers"]) stack.test = "vitest-workerd";
  else if (deps.vitest || hasVitestConfig) stack.test = "vitest";
  else if (deps.jest) stack.test = "jest";
  else stack.test = "node-test";

  // paths
  const srcDir = (await isDir(fs, "src")) ? "src" : stack.framework === "nextjs" && (await isDir(fs, "app")) ? "app" : "src";
  const paths: Record<string, string> = {
    app: srcDir,
    routes: stack.framework === "nextjs" ? `${srcDir === "app" ? "app" : "src/app"}/api` : `${srcDir}/routes`,
    lib: `${srcDir === "app" ? "lib" : `${srcDir}/lib`}`,
    ui: `${srcDir === "app" ? "components" : `${srcDir}/components`}`,
    migrations: "migrations",
    tests: (await isDir(fs, "tests")) && !(await isDir(fs, "test")) ? "tests" : "test",
  };
  const d1 = (wrangler?.d1_databases as { migrations_dir?: string }[] | undefined)?.[0];
  const migDirFromWrangler = d1?.migrations_dir ? normalizeRelative(d1.migrations_dir) : null;
  if (migDirFromWrangler) paths.migrations = migDirFromWrangler;
  else {
    for (const cand of ["migrations", "db/migrations", "drizzle", "src/migrations"]) {
      if (await isDir(fs, cand)) {
        paths.migrations = cand;
        break;
      }
    }
  }

  // migration naming
  const migs = ((await fs.list(paths.migrations!)) ?? []).filter((n) => n.endsWith(".sql"));
  // ---- 2026-11-03: new migrations are always UTC timestamps (YYYYMMDDHHMMSS_name.sql), so parallel branches never pick
  // the same number; existing NNNN_ files stay as they are and sort before every timestamp. NNNN is an explicit opt-out.
  const pattern: ProjectProfile["migrations"]["pattern"] = "TIMESTAMP_name.sql";
  const width = 14;
  void migs;

  // package manager
  let pm: ProjectProfile["package_manager"] = "npm";
  if (await exists(fs, "pnpm-lock.yaml")) pm = "pnpm";
  else if (await exists(fs, "yarn.lock")) pm = "yarn";
  else if ((await exists(fs, "bun.lockb")) || (await exists(fs, "bun.lock"))) pm = "bun";

  const config: NonNullable<ProjectProfile["config"]> = {};
  if (wranglerFile && !wranglerFile.endsWith(".toml")) config.wrangler = wranglerFile;
  else if (!wranglerFile && stack.runtime === "cloudflare-workers") config.wrangler = "wrangler.jsonc";
  config.env_example = stack.runtime === "cloudflare-workers" ? ".dev.vars.example" : ".env.example";

  return { stack, paths, migrations: pattern === "TIMESTAMP_name.sql" ? { pattern } : { pattern, width }, config, package_manager: pm, notes };
}

/** A new random project id (`prj_` + 20 base32 chars). */
export function newProjectId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const b = crypto.getRandomValues(new Uint8Array(20));
  return `prj_${[...b].map((x) => alphabet[x & 31]).join("")}`;
}

/** Reads the profile, or detects one (not written). */
export async function loadOrDetectProfile(fs: KitFs): Promise<{ profile: ProjectProfile; detected: boolean; notes: string[] }> {
  const existing = await readProfile(fs);
  if (existing) return { profile: existing, detected: false, notes: [] };
  const { notes, ...d } = await detectStack(fs);
  return { profile: { project_id: newProjectId(), ...d }, detected: true, notes };
}
