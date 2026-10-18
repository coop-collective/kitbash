// The plugin validator accepts the plugin as shipped and rejects drift.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pluginRoot, tmpDir } from "./helpers.mjs";

const run = (dir) => spawnSync(process.execPath, [path.join(dir, "scripts/validate.mjs")], { encoding: "utf8" });

async function copy() {
  const dir = await tmpDir("kit-plugin-validate-");
  // inside the package dir so `@kitbash/core` still resolves through node_modules
  fs.cpSync(pluginRoot, dir, { recursive: true, filter: (src) => !src.includes("node_modules") });
  fs.symlinkSync(path.join(pluginRoot, "node_modules"), path.join(dir, "node_modules"));
  return dir;
}

test("the plugin as shipped validates: 11 registry tools, 3 skills, 3 commands, the SessionStart hook", () => {
  const r = run(pluginRoot);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /11 registry tools, 3 skills, 3 commands/);
});

test("manifests: Claude Code and Codex agree; MCP is a stdio command in both; commands are /kit:*", () => {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(pluginRoot, p), "utf8"));
  const claude = read("plugins/kitbash/.claude-plugin/plugin.json");
  const codex = read("plugins/kitbash/.codex-plugin/plugin.json");
  const pkg = read("package.json");
  assert.equal(claude.name, "kit");
  assert.equal(codex.name, "kit");
  assert.equal(claude.version, pkg.version);
  assert.equal(codex.version, pkg.version);
  assert.deepEqual(read("plugins/kitbash/.mcp.json").mcpServers.kitbash, { type: "stdio", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/scripts/kit-mcp.mjs"] });
  assert.equal(codex.mcpServers.kitbash.command, "node");
  assert.equal(read(".claude-plugin/marketplace.json").plugins[0].source, "./plugins/kitbash");
  assert.equal(read(".agents/plugins/marketplace.json").plugins[0].source.path, "./plugins/kitbash");
});

test("the validator rejects a skill without 'Use when', a tool the contract does not have, a secret, a changed MCP config and an exec in the server", async () => {
  const dir = await copy();
  const skill = path.join(dir, "plugins/kitbash/skills/kitbash-use/SKILL.md");
  fs.writeFileSync(skill, fs.readFileSync(skill, "utf8").replace(/Use when/g, "When").replace("registry_verify", "registry_verifyy"));
  fs.writeFileSync(path.join(dir, "plugins/kitbash/commands/search.md"), `---\ndescription: x\n---\nkitbash-use ${"sk_live_"}${"a".repeat(24)}\n`);
  const mcp = path.join(dir, "plugins/kitbash/.mcp.json");
  fs.writeFileSync(mcp, fs.readFileSync(mcp, "utf8").replace("stdio", "http"));
  const srv = path.join(dir, "plugins/kitbash/scripts/server.mjs");
  fs.writeFileSync(srv, `${fs.readFileSync(srv, "utf8")}\nimport { execSync } from "node:child_process";\n`);
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /must say when to use it/);
  assert.match(r.stderr, /unknown tool registry_verifyy/);
  assert.match(r.stderr, /provider secret/);
  assert.match(r.stderr, /must be a stdio node command/);
  assert.match(r.stderr, /must not execute anything itself/);
});
