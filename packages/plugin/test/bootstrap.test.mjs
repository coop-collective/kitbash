import assert from "node:assert/strict";
import path from "node:path";
import { cp, mkdir } from "node:fs/promises";
import { test } from "node:test";
import { BOOTSTRAP_TOOL, catalogEnv } from "../plugins/kitbash/scripts/bootstrap-tool.mjs";
import { toArgv } from "../plugins/kitbash/scripts/server.mjs";
import { call, connect, execFileP, exists, noNetwork, pluginRoot, readJson, tmpDir } from "./helpers.mjs";

test("bootstrap forwarding keeps paths and values as arguments and external actions explicit", () => {
  const args = BOOTSTRAP_TOOL.input.parse({
    directory: "./--create-repo", preset: "worker", blocks: ["crypto-utils", "public-edge-cache"],
    params: { "crypto-utils.prefix": "$(touch should-not-exist)" },
  });
  const argv = toArgv("kitbash_bootstrap", args, "/tmp/new projects");
  assert.ok(argv.includes("--json"));
  assert.ok(argv.includes("--yes"));
  assert.ok(argv.includes("--blocks=crypto-utils,public-edge-cache"));
  assert.ok(argv.includes("--param=crypto-utils.prefix=$(touch should-not-exist)"));
  assert.ok(!argv.includes("--create-repo"));
  assert.ok(!argv.includes("--install"));
  assert.deepEqual(argv.slice(-2), ["--", "/tmp/new projects/--create-repo"]);
  const remote = BOOTSTRAP_TOOL.input.parse({
    directory: "app", preset: "vinext", git_host: "gitstalk", repo: "team/app", create_repo: true,
    gitstalk_url: "https://git.example.com", visibility: "public", hostname: "app.example.com",
    infisical_project: "project-id", infisical_domain: "https://secrets.example.com", install: true,
  });
  const remoteArgv = toArgv("kitbash_bootstrap", remote, "/tmp");
  for (const expected of ["--create-repo", "--install", "--git-host=gitstalk", "--repo=team/app",
    "--gitstalk-url=https://git.example.com", "--visibility=public", "--hostname=app.example.com",
    "--infisical-project=project-id", "--infisical-domain=https://secrets.example.com"]) assert.ok(remoteArgv.includes(expected), expected);
});

test("bootstrap schema rejects incomplete creation, accidental remote creation and unknown flags", () => {
  for (const args of [
    {}, { preset: "worker" }, { directory: "app", preset: "unknown" },
    { directory: "app", preset: "worker", create_repo: true },
    { directory: "app", preset: "worker", git_host: "github", repo: "a/b", create_repo: true, no_git: true },
    { list: true, install: true }, { list: true, create_repo: true, git_host: "github", repo: "a/b" },
    { directory: "app", preset: "worker", force: true }, { directory: "app", preset: "worker", port: 0 },
  ]) assert.equal(BOOTSTRAP_TOOL.input.safeParse(args).success, false, JSON.stringify(args));
  assert.equal(BOOTSTRAP_TOOL.input.safeParse({ list: true, preset: "rust-server" }).success, true);
  assert.equal(catalogEnv({ KIT_CATALOG_ROOT: "/explicit/catalog" }).KIT_CATALOG_ROOT, "/explicit/catalog");
});

test("MCP bootstrap lists the bundled catalog and creates a project offline without invoking a process", async () => {
  const cwd = await tmpDir("kit-plugin-bootstrap-");
  const client = await connect({ cwd, fetch: noNetwork });
  const listed = await call(client, "kitbash_bootstrap", { list: true });
  assert.equal(listed.isError, false, JSON.stringify(listed.data));
  assert.equal(listed.data.presets.length, 3);
  const created = await call(client, "kitbash_bootstrap", {
    directory: "new-worker", preset: "worker", blocks: ["crypto-utils"], no_git: true,
  });
  assert.equal(created.isError, false, JSON.stringify(created.data));
  assert.equal(created.data.preset, "worker");
  assert.ok(await exists(path.join(cwd, "new-worker", "package.json")));
  assert.ok(await exists(path.join(cwd, "new-worker", ".kit", "bootstrap.json")));
  const pkg = await readJson(path.join(cwd, "new-worker", "package.json"));
  assert.ok(pkg.scripts.check);
  assert.equal(await exists(path.join(cwd, "new-worker", ".git")), false);
  assert.equal(await exists(path.join(cwd, "new-worker", "node_modules")), false);
});

test("the packaged plugin bootstraps from its own catalog outside the checkout without node_modules", { timeout: 60_000 }, async () => {
  await execFileP(process.execPath, [path.join(pluginRoot, "scripts/build.mjs")]);
  const isolated = await tmpDir("kit-plugin-installed-");
  const installed = path.join(isolated, "plugin");
  await mkdir(path.join(installed, "scripts"), { recursive: true });
  for (const name of ["bootstrap.mjs", "load-kit.mjs"]) {
    await cp(path.join(pluginRoot, "plugins/kitbash/scripts", name), path.join(installed, "scripts", name));
  }
  await cp(path.join(pluginRoot, "plugins/kitbash/runtime"), path.join(installed, "runtime"), { recursive: true });
  const launcher = path.join(installed, "scripts/bootstrap.mjs");
  const env = { ...process.env, KIT_CATALOG_ROOT: "", KIT_API_URL: "http://127.0.0.1:9" };
  const listed = await execFileP(process.execPath, [launcher, "--list", "--json"], { cwd: isolated, env });
  assert.equal(JSON.parse(listed.stdout).presets.length, 3);
  const created = await execFileP(process.execPath, [launcher, "app", "--preset", "worker", "--blocks", "crypto-utils", "--no-git", "--yes", "--json"], { cwd: isolated, env });
  assert.equal(JSON.parse(created.stdout).preset, "worker");
  assert.ok(await exists(path.join(isolated, "app", ".kit", "bootstrap.json")));
  assert.equal(await exists(path.join(installed, "node_modules")), false);
  assert.equal(await exists(path.join(isolated, "app", "node_modules")), false);
});
