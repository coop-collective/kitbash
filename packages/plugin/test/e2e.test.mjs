// The real thing: core's fixture block installed through the MCP tools into a temp copy of templates/hono-d1, then
// registry_verify runs the block's own tests (vitest in workerd, tsc) through the allowlist. Dependencies come from the
// local pnpm store (`pnpm install --offline`, no network); when the store lacks them the test is skipped with the reason.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { execRunner } from "@kitbash/cli";
import { FIXTURE_BLOCK, call, connect, execFileP, readJson, templateCopy } from "./helpers.mjs";

async function preparedTemplate() {
  const dir = await templateCopy();
  try {
    // This temp copy has its own allowBuilds config and may not have a lockfile yet.
    await execFileP("pnpm", ["install", "--offline", "--no-frozen-lockfile", "--config.confirmModulesPurge=false"], { cwd: dir, timeout: 120_000 });
  } catch (e) {
    if (/ERR_PNPM_NO_OFFLINE_(?:META|TARBALL)\b/.test(`${e.message}\n${e.stdout}\n${e.stderr}`)) {
      return { skip: "templates/hono-d1 dependencies are not in the local pnpm store (run pnpm install in a standalone template copy once)" };
    }
    throw e;
  }
  await execFileP("pnpm", ["install", "--offline", "--frozen-lockfile", "--config.confirmModulesPurge=false"], { cwd: dir, timeout: 120_000 });
  await execFileP(path.join(dir, "node_modules", ".bin", "wrangler"), ["types", "--strict-vars=false"], { cwd: dir, timeout: 120_000, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  return { dir };
}

test("registry_install (dry run, then apply by plan_id) and registry_verify against the fixture in a hono-d1 copy", { timeout: 300_000 }, async (t) => {
  const prep = await preparedTemplate();
  if ("skip" in prep) return t.skip(prep.skip);
  const cwd = prep.dir;
  const client = await connect({ cwd, runner: execRunner, env: { ...process.env, KIT_KEYCHAIN: "0" } });
  const dry = await call(client, "registry_install", { block: FIXTURE_BLOCK, project_root: cwd });
  assert.equal(dry.isError, false, JSON.stringify(dry.data));
  const applied = await call(client, "registry_install", { block: FIXTURE_BLOCK, project_root: cwd, dry_run: false, plan_id: dry.data.plan_id });
  assert.equal(applied.isError, false, JSON.stringify(applied.data));
  const v = await call(client, "registry_verify", { block: "@local/email-code-auth-fixture", project_root: cwd });
  assert.equal(v.isError, false, JSON.stringify(v.data));
  assert.equal(v.data.passed, true, JSON.stringify(v.data));
  assert.ok(v.data.results.some((r) => /vitest run test\/auth\.test\.ts/.test(r.command) && r.exit === 0));
  assert.ok(v.data.results.some((r) => /tsc --noEmit/.test(r.command) && r.exit === 0));
  const lock = await readJson(path.join(cwd, ".kit", "lock.json"));
  assert.equal(lock.blocks["@local/email-code-auth-fixture"].verify.passed, true);
});
