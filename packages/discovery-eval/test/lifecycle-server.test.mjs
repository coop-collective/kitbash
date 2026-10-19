import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createCatalogServer } from "../lifecycle/server.mjs";
import { projectCheck, assertLocalConfig } from "../lifecycle/project-tools.mjs";
import { cleanEnv } from "../lifecycle/process.mjs";
import { writeStarter } from "../starter.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
async function connected(options) {
  const server = await createCatalogServer(options);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "lifecycle-test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, server };
}
const call = async (client, name, args = {}) => {
  const response = await client.callTool({ name, arguments: args });
  assert.ok(!response.isError, response.content[0].text);
  return JSON.parse(response.content[0].text);
};

test("lifecycle MCP supports selected reuse/installer and audits success, callback failure, schema failure and unknown tools", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "lifecycle-mcp-"));
  const audit = path.join(project, "audit.jsonl");
  await writeStarter(project);
  const { client, server } = await connected({ root, project, audit, phase: "integration" });
  try {
    const search = await call(client, "catalog_search", { query: "session" });
    assert.ok(search.results.length);
    await call(client, "catalog_get", { id: "block:session-cookie" });
    await call(client, "catalog_checkout", { id: "block:session-cookie", paths: ["block.json"] });
    await call(client, "catalog_discard", { id: "block:session-cookie" });
    assert.equal((await call(client, "project_init")).code, 0);
    const plan = await call(client, "block_install", { id: "block:session-cookie" });
    assert.equal(plan.code, 0);
    const applied = await call(client, "block_install", { id: "block:session-cookie", dry_run: false, plan_id: plan.result.plan_id });
    assert.equal(applied.code, 0);
    assert.equal((await client.callTool({ name: "catalog_get", arguments: { id: "block:missing" } })).isError, true);
    assert.equal((await client.callTool({ name: "catalog_search", arguments: { limit: -1 } })).isError, true);
    await assert.rejects(client.callTool({ name: "missing-tool", arguments: {} }));
    const rows = (await readFile(audit, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(rows.length, 10);
    assert.equal(rows.filter((row) => row.outcome === "error").length, 3);
    for (const row of rows) {
      assert.equal(row.phase, "integration");
      assert.ok(row.durationMs >= 0);
      assert.ok(row.responseBytes > 0);
    }
  } finally { await client.close(); await server.close(); await rm(project, { recursive: true, force: true }); }
});

test("scratch has only fixed project tools; reference has no installer", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "lifecycle-tools-"));
  try {
    for (const mode of ["scratch", "reference"]) {
      const { client, server } = await connected({ root, project, mode });
      try {
        const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
        assert.ok(!names.includes("block_install"));
        assert.ok(!names.includes("project_init"));
        if (mode === "scratch") assert.deepEqual(names, ["project_check", "project_copy_reference"]);
        else assert.ok(names.includes("catalog_search"));
      } finally { await client.close(); await server.close(); }
    }
  } finally { await rm(project, { recursive: true, force: true }); }
});

test("local config guard rejects remote bindings, external paths, hooks and malformed JSONC", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "lifecycle-config-"));
  try {
    await writeStarter(project);
    const file = path.join(project, "wrangler.jsonc");
    const original = JSON.parse(await readFile(file, "utf8"));
    await assertLocalConfig(project);
    await assert.rejects(assertLocalConfig(project, { persistTo: "../outside" }), /inside/);
    for (const patch of [
      { kv_namespaces: [{ binding: "CACHE", id: "fixture", remote: true }] },
      { env: { production: { r2_buckets: [{ binding: "FILES", bucket_name: "fixture", remote: true }] } } },
      { durable_objects: { bindings: [{ name: "ROOM", class_name: "Room", script_name: "another-worker" }] } },
      { build: { command: "arbitrary shell" } },
      { main: "../outside.ts" },
      { services: [{ binding: "SERVICE", service: "live" }] },
    ]) {
      await writeFile(file, JSON.stringify({ ...original, ...patch }));
      await assert.rejects(projectCheck(project, "build"));
    }
    await writeFile(file, "{ malformed");
    await assert.rejects(assertLocalConfig(project));
    await writeFile(file, JSON.stringify(original));
    await symlink(os.tmpdir(), path.join(project, "linked-state"));
    await assert.rejects(assertLocalConfig(project, { persistTo: "linked-state/db" }), /symlinks/);
    await assert.rejects(projectCheck(project, "deploy"), /Unknown fixed/);
  } finally { await rm(project, { recursive: true, force: true }); }
});

test("fixed test check also executes traveling standalone Node tests and returns their failure", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "lifecycle-tests-"));
  const previous = process.env.PATH;
  try {
    await writeStarter(project);
    await mkdir(path.join(project, "bin"));
    await writeFile(path.join(project, "bin", "pnpm"), `#!${process.execPath}\nprocess.exit(0);\n`, { mode: 0o755 });
    process.env.PATH = path.join(project, "bin") + path.delimiter + previous;
    await writeFile(path.join(project, "test", "traveling.test.mjs"), "import{test}from'node:test';test('traveling sentinel',()=>{throw Error('intentional failure')});");
    const result = await projectCheck(project, "test");
    assert.equal(result.passed, false);
    assert.equal(result.results.length, 2);
    assert.equal(result.results[1].code, 1);
    assert.match(result.results[1].output, /traveling sentinel/);
    assert.deepEqual(result.results[1].command.slice(1), ["--test", "test/traveling.test.mjs"]);
  } finally { process.env.PATH = previous; await rm(project, { recursive: true, force: true }); }
});

test("real stdio disconnect cancels an outstanding detached project check and audits the failed response", { timeout: 15000, skip: process.platform === "win32" }, async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "lifecycle-stdio-"));
  await writeStarter(project);
  const bin = path.join(project, "bin"), pidFile = path.join(project, "worker-pid"), audit = path.join(project, "audit.jsonl");
  await mkdir(bin);
  await writeFile(path.join(bin, "pnpm"), `#!${process.execPath}\nimport{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);\n`, { mode: 0o755 });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "packages/discovery-eval/lifecycle/server.mjs"), root, project, audit, "scratch", "maintenance"],
    cwd: project, env: { ...cleanEnv(), PATH: bin + path.delimiter + process.env.PATH }, stderr: "pipe",
  });
  const client = new Client({ name: "lifecycle-stdio-test", version: "1" });
  let pid;
  const wait = async (fn, label) => {
    for (let n = 0; n < 100; n++) {
      try { if (await fn()) return; } catch (error) { if (error.code !== "ENOENT") throw error; }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error(`Timed out: ${label}`);
  };
  const isAlive = () => { try { process.kill(pid, 0); return true; } catch (error) {
    if (error.code === "ESRCH") return false; throw error;
  } };
  try {
    await client.connect(transport);
    const pending = client.callTool({ name: "project_check", arguments: { check: "test" } }).catch((error) => error);
    await wait(async () => { pid = Number(await readFile(pidFile, "utf8")); return pid > 0; }, "project-check start");
    await client.close();
    await pending;
    await wait(() => !isAlive(), "project-check cleanup");
    await wait(async () => (await readFile(audit, "utf8")).includes('"outcome":"error"'), "failed-check audit flush");
    const row = JSON.parse((await readFile(audit, "utf8")).trim());
    assert.equal(row.tool, "project_check");
    assert.equal(row.phase, "maintenance");
  } finally {
    await client.close();
    if (pid && isAlive()) process.kill(pid, "SIGKILL");
    await rm(project, { recursive: true, force: true });
  }
});
