import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createCatalogServer } from "../server.mjs";
import { writeStarter } from "../starter.mjs";

test("real MCP contract browses, selects source and delegates dry-run/apply through installer", async () => {
  const root = path.resolve(import.meta.dirname, "../../.."),
    project = await mkdtemp(path.join(os.tmpdir(), "catalog-mcp-"));
  const server = await createCatalogServer({ root, project });
  const [a, b] = InMemoryTransport.createLinkedPair(),
    client = new Client({ name: "eval-test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    assert.ok(!r.isError, r.content[0].text);
    return JSON.parse(r.content[0].text);
  };
  try {
    await writeStarter(project);
    const entries = await call("catalog_search");
    assert.ok(entries.total > 10);
    assert.equal(entries.results.length, 6);
    const first = await call("catalog_search", { limit: 20 });
    const second = await call("catalog_search", {
      limit: 20,
      offset: first.nextOffset,
    });
    assert.equal(
      new Set([...first.results, ...second.results].map((x) => x.id)).size,
      entries.total,
    );
    assert.equal(second.nextOffset, null);
    const source = await call("catalog_get", { id: "block:session-cookie" });
    assert.ok(source.files.includes("block.json"));
    const copied = await call("catalog_checkout", {
      id: "block:session-cookie",
      paths: ["block.json"],
    });
    assert.equal(copied.files.length, 1);
    await call("catalog_discard", { id: "block:session-cookie" });
    assert.equal((await call("project_init")).code, 0);
    const plan = await call("block_install", { id: "block:session-cookie" });
    assert.equal(plan.code, 0, JSON.stringify(plan));
    assert.ok(plan.result.plan_id);
    const applied = await call("block_install", {
      id: "block:session-cookie",
      dry_run: false,
      plan_id: plan.result.plan_id,
    });
    assert.equal(applied.code, 0, JSON.stringify(applied));
    const container = await call('catalog_get', { id: 'block:cloudflare-container' });
    assert.deepEqual(container.variants.map(v => v.id).sort(), ['bun', 'go', 'rust']);
    assert.ok(container.files.includes('variants/rust/container/Cargo.lock'));
    const goPlan = await call('block_install', { id: 'block:cloudflare-container', variant: 'go' });
    assert.equal(goPlan.code, 0, JSON.stringify(goPlan));
    const rejected = await client.callTool({
      name: "block_install",
      arguments: { id: "recipe-reference:cloudflare-ci" },
    });
    assert.equal(rejected.isError, true);
  } finally {
    await client.close();
    await rm(project, { recursive: true, force: true });
  }
});
