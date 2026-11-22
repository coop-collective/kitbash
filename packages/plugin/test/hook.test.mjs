// The SessionStart hook: the core rules as session context always; one heartbeat only when .kit/lock.json exists and
// telemetry is on. It never fails and never writes to stderr.
import assert from "node:assert/strict";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { heartbeat } from "../plugins/w3bstack/scripts/heartbeat.mjs";
import { API, FIXTURE_BLOCK, NOW, pluginRoot, templateCopy, tmpDir } from "./helpers.mjs";
import { runKit } from "../plugins/w3bstack/scripts/server.mjs";

const { createMockRegistry } = await import("../../cli/test/mock-registry.ts");
const HOOK = path.join(pluginRoot, "plugins/w3bstack/hooks/session-start.mjs");

const quiet = { PATH: process.env.PATH, KIT_API_URL: "http://127.0.0.1:9" };
const runHook = (cwd, hook = HOOK) => spawnSync(process.execPath, [hook], { cwd, encoding: "utf8", env: quiet });
const RULE = (await readFile(path.join(pluginRoot, "plugins/w3bstack/rules/deterministic-tests.md"), "utf8")).trim();

test("the hook adds the core rules as SessionStart context in every project, and does nothing else when there is no lock or telemetry is off", async () => {
  const none = await tmpDir();
  const off = await tmpDir();
  await mkdir(path.join(off, ".kit"));
  await writeFile(path.join(off, ".kit", "lock.json"), '{"blocks":{}}');
  await writeFile(path.join(off, ".kit", "project.json"), '{"telemetry":false}');
  for (const cwd of [none, off]) {
    const r = runHook(cwd);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    // One JSON object, in the shape Claude Code and Codex read from a SessionStart hook.
    const out = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(out), ["hookSpecificOutput"]);
    assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
    const context = out.hookSpecificOutput.additionalContext;
    assert.match(context, /^w3bstack core rules\. Follow them in every task in this session\.\n\n# Tests must be deterministic\n/);
    assert.ok(context.includes(RULE), "the whole rule file is in the context");
    assert.ok(context.length < 10000, "the context stays small enough for every session");
  }
});

test("the hook stays silent and exits 0 when the rules are missing or empty", async () => {
  const dir = await tmpDir();
  await mkdir(path.join(dir, "hooks"));
  const hook = path.join(dir, "hooks", "session-start.mjs");
  await copyFile(HOOK, hook);
  const missing = runHook(dir, hook);
  assert.equal(missing.status, 0);
  assert.equal(missing.stdout + missing.stderr, "");
  await mkdir(path.join(dir, "rules"));
  await writeFile(path.join(dir, "rules", "empty.md"), "\n");
  const empty = runHook(dir, hook);
  assert.equal(empty.status, 0);
  assert.equal(empty.stdout + empty.stderr, "");
});

test("the deterministic-tests plugin skill is the built copy of skills/deterministic-tests, and states the rule in its description", async () => {
  const source = path.join(pluginRoot, "../../skills/deterministic-tests");
  const shipped = path.join(pluginRoot, "plugins/w3bstack/skills/deterministic-tests");
  const files = async (dir) => (await readdir(dir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join("/")).sort();
  assert.deepEqual(await files(shipped), await files(source));
  assert.deepEqual(await files(source), ["SKILL.md", "agents/openai.yaml", "references/recipes.md"]);
  for (const f of await files(source)) assert.equal(await readFile(path.join(shipped, f), "utf8"), await readFile(path.join(source, f), "utf8"), `${f} is stale: run pnpm --filter @w3bstack/plugin build`);
  const description = /^description: (.*)$/m.exec(await readFile(path.join(shipped, "SKILL.md"), "utf8"))[1];
  for (const must of ["Tests must be deterministic", "wall clock", "sleep", "temp directory", "port 0", "order", "seed", "retry until green"]) assert.ok(description.includes(must), `the description names: ${must}`);
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
