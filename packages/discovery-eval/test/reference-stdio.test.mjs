import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

test("reference-only real stdio server has no installer and can checkout/discard", async () => {
  const root = path.resolve(import.meta.dirname, "../../.."),
    project = await mkdtemp(path.join(os.tmpdir(), "reference-preflight-"));
  const client = new Client({ name: "reference-preflight", version: "1" }),
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        path.join(root, "packages/discovery-eval/server.mjs"),
        root,
        project,
        "",
        "reference",
      ],
      cwd: project,
      stderr: "pipe",
    });
  try {
    await client.connect(transport);
    assert.deepEqual(
      (await client.listTools()).tools.map((t) => t.name).sort(),
      [
        "catalog_checkout",
        "catalog_discard",
        "catalog_get",
        "catalog_search",
        "project_check",
        "project_copy_reference",
      ],
    );
    for (const [name, args] of [
      ["catalog_search", { query: "revocable session" }],
      ["catalog_get", { id: "block:session-cookie" }],
      [
        "catalog_checkout",
        {
          id: "block:session-cookie",
          paths: ["variants/hono-d1/src/lib/session-cookie/session.ts"],
        },
      ],
      ["catalog_discard", { id: "block:session-cookie" }],
    ]) {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, result.content[0].text);
    }
  } finally {
    await client.close();
    await rm(project, { recursive: true, force: true });
  }
});
