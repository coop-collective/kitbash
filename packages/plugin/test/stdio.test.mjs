// The launcher the plugin manifests point at, over a real stdio pipe: scripts/kit-mcp.mjs as a child process.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { REGISTRY_TOOLS } from "@kitbash/core";
import { FIXTURE_BLOCK, pluginRoot, tmpDir } from "./helpers.mjs";

test("scripts/kit-mcp.mjs speaks MCP over stdio in the project directory: lists 11 tools and answers a local get offline", async () => {
  const cwd = await tmpDir("kit-plugin-stdio-");
  const home = await tmpDir("kit-plugin-stdio-home-");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(pluginRoot, "plugins/kitbash/scripts/kit-mcp.mjs")],
    cwd,
    env: { PATH: process.env.PATH, KIT_HOME: home, KIT_API_URL: "http://127.0.0.1:9", KIT_KEYCHAIN: "0" },
    stderr: "pipe",
  });
  const client = new Client({ name: "kit-stdio-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), REGISTRY_TOOLS.map((t) => t.name).sort());
    const r = await client.callTool({ name: "registry_get", arguments: { block: FIXTURE_BLOCK } });
    assert.ok(!r.isError, r.content?.[0]?.text);
    assert.equal(JSON.parse(r.content[0].text).id, "@local/email-code-auth-fixture");
  } finally {
    await client.close();
  }
});
