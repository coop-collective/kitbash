// The SessionStart hook: silent and harmless unless .kit/lock.json exists and telemetry is on, then one heartbeat.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { heartbeat } from "../plugins/kitbash/scripts/heartbeat.mjs";
import { API, FIXTURE_BLOCK, NOW, pluginRoot, templateCopy, tmpDir } from "./helpers.mjs";
import { runKit } from "../plugins/kitbash/scripts/server.mjs";

const { createMockRegistry } = await import("../../cli/test/mock-registry.ts");
const HOOK = path.join(pluginRoot, "plugins/kitbash/hooks/session-start.mjs");

test("the hook exits 0 with no output and no network when there is no lock, or telemetry is off", async () => {
  const none = await tmpDir();
  const r1 = spawnSync(process.execPath, [HOOK], { cwd: none, encoding: "utf8", env: { PATH: process.env.PATH, KIT_API_URL: "http://127.0.0.1:9" } });
  assert.equal(r1.status, 0);
  assert.equal(r1.stdout + r1.stderr, "");
  const off = await tmpDir();
  await mkdir(path.join(off, ".kit"));
  await writeFile(path.join(off, ".kit", "lock.json"), '{"blocks":{}}');
  await writeFile(path.join(off, ".kit", "project.json"), '{"telemetry":false}');
  const r2 = spawnSync(process.execPath, [HOOK], { cwd: off, encoding: "utf8", env: { PATH: process.env.PATH, KIT_API_URL: "http://127.0.0.1:9" } });
  assert.equal(r2.status, 0);
  assert.equal(r2.stdout + r2.stderr, "");
});

test("with telemetry on, the heartbeat sends the lock's block list only (through the CLI's own heartbeat)", async () => {
  const reg = await createMockRegistry();
  const cwd = await templateCopy();
  const home = await tmpDir("kit-plugin-home-");
  const env = { PATH: process.env.PATH, KIT_HOME: home, KIT_KEYCHAIN: "0", KIT_TOKEN: reg.token, KIT_API_URL: API, KIT_REGISTRY_PUBLIC_KEY: reg.key.publicKey, KIT_SCOPE: "coop" };
  const ctx = { cwd, env, home, fetch: reg.fetch, now: () => NOW };
  assert.ok(!(await runKit(["publish", "--json", "--visibility=private", "--scope=coop", "--", FIXTURE_BLOCK], ctx)).error);
  assert.ok(!(await runKit(["init", "--json", "--telemetry"], ctx)).error);
  assert.ok(!(await runKit(["install", "--json", "--apply", "--", "@coop/email-code-auth-fixture"], ctx)).error);
  assert.equal(await heartbeat(ctx), 0);
  assert.equal(reg.heartbeats.length, 1);
  assert.deepEqual(reg.heartbeats[0].body.blocks.map((b) => b.block), ["@coop/email-code-auth-fixture"]);
});
