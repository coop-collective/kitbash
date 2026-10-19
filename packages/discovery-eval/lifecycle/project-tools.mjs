import { z } from "zod";
import { readFile, realpath, lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { parseJsonc } from "@kitbash/core";
import { command } from "./process.mjs";
import { copyProjectReference } from "../catalog.mjs";

async function containedPath(project, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) ||
      relative.includes("\\") || relative.includes("\0") ||
      relative.split("/").some((part) => !part || part === ".." || part === ".")) {
    throw new Error("Local configuration paths must stay inside the project");
  }
  const base = await realpath(project);
  let current = base;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Local configuration paths must not use symlinks");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return current;
}

/** Cooperative local benchmark guard, not a sandbox for executable app/tests. */
export async function assertLocalConfig(project, { persistTo = ".wrangler/state" } = {}) {
  const configPath = await containedPath(project, "wrangler.jsonc");
  const stat = await lstat(configPath);
  if (!stat.isFile() || stat.size > 262144) throw new Error("Wrangler config must be a bounded regular file");
  const config = parseJsonc(await readFile(configPath, "utf8"));
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid Wrangler configuration");
  const inspect = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "remote" && item !== false) throw new Error("Remote bindings are forbidden in this local benchmark");
      if (key === "script_name" && item) throw new Error("External Durable Object scripts are forbidden");
      if (["services", "containers", "unsafe", "send_email", "browser", "ai"].includes(key) && item) {
        throw new Error(`Unsupported local binding/configuration: ${key}`);
      }
      if (key === "build" && item?.command) throw new Error("Custom Wrangler build commands are forbidden");
      inspect(item);
    }
  };
  inspect(config);
  if (config.main) await containedPath(project, config.main);
  if (config.assets?.directory) await containedPath(project, config.assets.directory.replace(/^\.\//, ""));
  for (const db of config.d1_databases ?? []) {
    if (db.migrations_dir) await containedPath(project, db.migrations_dir.replace(/^\.\//, ""));
  }
  const statePath = await containedPath(project, persistTo);
  return { config, configPath, statePath };
}

export const checks = {
  install: [["pnpm", ["install", "--ignore-scripts"]]],
  typecheck: [
    ["pnpm", ["exec", "wrangler", "types", "--config", "wrangler.jsonc", "--strict-vars=false"]],
    ["pnpm", ["exec", "tsc", "--noEmit"]],
  ],
  test: [["pnpm", ["exec", "vitest", "run"]]],
  build: [["pnpm", ["exec", "wrangler", "deploy", "--config", "wrangler.jsonc", "--dry-run", "--outdir", "dist"]]],
  migrate: [["pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--config", "wrangler.jsonc", "--local"]]],
};

async function nodeTests(project) {
  const found = [];
  const visit = async (relative, depth = 0) => {
    if (depth > 8) throw new Error("Test directory nesting exceeds limit");
    const directory = await containedPath(project, relative);
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (entry.isSymbolicLink()) throw new Error("Test discovery does not follow symlinks");
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await visit(file, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".test.mjs")) found.push(file);
      if (found.length > 200) throw new Error("Too many standalone test files");
    }
  };
  for (const folder of ["test", "tests"]) await visit(folder);
  return found.sort();
}

export async function projectCheck(project, name, options = {}) {
  if (!Object.hasOwn(checks, name)) throw new Error("Unknown fixed project check");
  const { statePath } = await assertLocalConfig(project, options);
  const results = [];
  const commands = [...checks[name]];
  if (name === "test") {
    const standalone = await nodeTests(project);
    if (standalone.length) commands.push([process.execPath, ["--test", ...standalone]]);
  }
  for (const [file, fixedArgs] of commands) {
    const args = name === "migrate" ? [...fixedArgs, "--persist-to", statePath] : fixedArgs;
    const result = await command(file, args, { cwd: project });
    results.push({
      command: [file, ...args], code: result.code, signal: result.signal,
      timedOut: result.timedOut, wallMs: result.wallMs,
      output: (result.stdout + "\n" + result.stderr).slice(-12000),
      ...(result.error ? { error: result.error } : {}),
    });
    if (result.code !== 0 || result.timedOut) break;
  }
  return { check: name, passed: results.every((r) => r.code === 0 && !r.timedOut), results };
}

export function registerProjectTools(register, project) {
  register("project_check",
    "Run a fixed local install, typecheck, test, dry-run build, or local D1 migration command. No arbitrary shell, deploy, or process cleanup is available.",
    { check: z.enum(["install", "typecheck", "test", "build", "migrate"]) },
    ({ check }) => projectCheck(project, check));
  register("project_copy_reference",
    "Copy one inspected .catalog-cache source file into a new project file before adapting it with Edit. Relative paths only; does not overwrite existing files.",
    { source: z.string(), target: z.string() },
    (args) => copyProjectReference(project, args));
}
