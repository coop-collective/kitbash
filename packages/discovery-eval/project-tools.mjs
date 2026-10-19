import { z } from "zod";
import { command } from "./process.mjs";
import { copyProjectReference } from "./catalog.mjs";
export const checks = {
  install: [["pnpm", ["install", "--ignore-scripts"]]],
  typecheck: [
    ["pnpm", ["exec", "wrangler", "types", "--strict-vars=false"]],
    ["pnpm", ["exec", "tsc", "--noEmit"]],
  ],
  test: [["pnpm", ["exec", "vitest", "run"]]],
  build: [
    ["pnpm", ["exec", "wrangler", "deploy", "--dry-run", "--outdir", "dist"]],
  ],
  migrate: [
    [
      "pnpm",
      ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local"],
    ],
  ],
};
export async function projectCheck(project, name) {
  const results = [];
  for (const [file, args] of checks[name]) {
    const result = await command(file, args, { cwd: project });
    results.push({
      command: [file, ...args],
      code: result.code,
      signal: result.signal,
      timedOut: result.timedOut,
      wallMs: result.wallMs,
      output: (result.stdout + "\n" + result.stderr).slice(-12000),
    });
    if (result.code !== 0) break;
  }
  return { check: name, passed: results.every((r) => r.code === 0), results };
}
export function registerProjectTools(register, project) {
  register(
    "project_check",
    "Run a fixed local install, typecheck, test, dry-run build, or local D1 migration command. No arbitrary shell, deploy, or process cleanup is available.",
    { check: z.enum(["install", "typecheck", "test", "build", "migrate"]) },
    ({ check }) => projectCheck(project, check),
  );
  register(
    "project_copy_reference",
    "Copy one inspected .catalog-cache source file into a new project file before adapting it with Edit. Relative paths only; does not overwrite existing files.",
    { source: z.string(), target: z.string() },
    (args) => copyProjectReference(project, args),
  );
}
