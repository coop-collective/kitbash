/**
 * The proof for the e2e harness: install core's fixture block from its local directory (no server) into a temp copy of
 * templates/hono-d1, then run the block's own verify commands for real through the allowlist (execFile, no shell).
 *
 * Dependencies come from the local pnpm store with `pnpm install --offline` (no network). When the store lacks them
 * (a fresh machine that never installed the template), the test is skipped with the reason.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { execRunner } from "../src/verify.ts";
import { FIXTURE_BLOCK, FIXTURE_LOCAL_ID, kit, readJson, templateCopy } from "./helpers.ts";

const run = promisify(execFile);

async function preparedTemplate(): Promise<{ dir: string } | { skip: string }> {
  const dir = await templateCopy();
  try {
    // This temp copy has its own allowBuilds config and may not have a lockfile yet.
    await run("pnpm", ["install", "--offline", "--no-frozen-lockfile", "--config.confirmModulesPurge=false"], { cwd: dir, timeout: 120_000 });
  } catch (e) {
    const error = e as Error & { stdout?: string; stderr?: string };
    if (/ERR_PNPM_NO_OFFLINE_(?:META|TARBALL)\b/.test(`${error.message}\n${error.stdout}\n${error.stderr}`)) {
      return { skip: "templates/hono-d1 dependencies are not in the local pnpm store (run pnpm install in a standalone template copy once)" };
    }
    throw e;
  }
  await run("pnpm", ["install", "--offline", "--frozen-lockfile", "--config.confirmModulesPurge=false"], { cwd: dir, timeout: 120_000 });
  // The template's own typecheck generates worker-configuration.d.ts first; do the same here.
  await run(path.join(dir, "node_modules", ".bin", "wrangler"), ["types", "--strict-vars=false"], { cwd: dir, timeout: 120_000, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  return { dir };
}

describe("fixture block into templates/hono-d1, verified for real", () => {
  it("kit install <dir> --apply, then kit verify runs vitest-in-workerd and tsc and records passed", async (ctx) => {
    const t = await preparedTemplate();
    if ("skip" in t) {
      ctx.skip(t.skip);
      return;
    }
    const d = t.dir;
    const inst = await kit(["install", FIXTURE_BLOCK, "--apply"], { cwd: d });
    expect(inst.code, inst.err).toBe(0);
    const v = await kit(["verify", FIXTURE_LOCAL_ID, "--timeout", "300"], { cwd: d, runner: execRunner, env: { ...process.env, KIT_KEYCHAIN: "0" } });
    expect(v.code, `${v.out}\n${v.err}`).toBe(0);
    expect(v.out).toMatch(/PASS \(exit 0\) npx vitest run test\/auth\.test\.ts/);
    expect(v.out).toMatch(/PASS \(exit 0\) npx tsc --noEmit/);
    const lock = await readJson(path.join(d, ".kit", "lock.json"));
    expect(lock.blocks[FIXTURE_LOCAL_ID].verify.passed).toBe(true);
  }, 300_000);
});
