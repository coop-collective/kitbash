// Exercise the committed payload exactly as a plugin manager copies it: no build or dependencies.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
test('GitHub marketplaces resolve to a standalone, working MCP plugin', { timeout: 30000 }, async () => {
  const read = async (p) => JSON.parse(await readFile(path.join(repo, p), 'utf8'));
  const claude = await read('.claude-plugin/marketplace.json');
  const codex = await read('.agents/plugins/marketplace.json');
  const source = claude.plugins[0].source;
  assert.equal(source, codex.plugins[0].source.path);
  assert.equal(claude.plugins[0].version, (await read('packages/plugin/package.json')).version);
  const dir = await mkdtemp(path.join(tmpdir(), 'kit-distribution-'));
  const installed = path.join(dir, 'plugin');
  const client = new Client({ name: 'distribution-test', version: '0.1.0' });
  try {
    await cp(path.join(repo, source), installed, { recursive: true });
    const skill = await readFile(path.join(installed, 'skills/kitbash-performance/SKILL.md'), 'utf8');
    assert.match(skill, /runtime\/catalog\/recipes/);
    for (const recipe of ['browser-performance', 'vinext-diagnostics', 'cloudflare-performance']) {
      const recipeDir = path.join(installed, 'runtime/catalog/recipes', recipe);
      assert.ok((await readFile(path.join(recipeDir, 'README.md'), 'utf8')).length > 100);
      assert.ok(JSON.parse(await readFile(path.join(recipeDir, 'package.json'), 'utf8')).scripts.test);
    }
    for (const relative of [
      'bootstraps/shared/files/scripts/ci-dry-run.mjs',
      'bootstraps/shared/files/scripts/migrate.mjs',
      'bootstraps/shared/workflows/github-preview-production.yml',
      'bootstraps/worker/files/AGENTS.md',
      'bootstraps/vinext/files/AGENTS.md',
    ]) {
      assert.equal(await readFile(path.join(installed, 'runtime/catalog', relative), 'utf8'), await readFile(path.join(repo, relative), 'utf8'), `installed plugin includes current CI rules and templates: ${relative}`);
    }
    // The dependency-free observability tests must run from an installed plugin copy.
    const check = spawnSync(process.execPath, ['--test'], {
      cwd: path.join(installed, 'runtime/catalog/recipes/cloudflare-performance'), encoding: 'utf8', timeout: 15000,
      env: { PATH: process.env.PATH },
    });
    assert.equal(check.status, 0, check.stderr + check.stdout);
    await client.connect(new StdioClientTransport({
      command: process.execPath, args: [path.join(installed, 'scripts/kit-mcp.mjs')], cwd: dir,
      env: { PATH: process.env.PATH, KIT_HOME: dir, KIT_KEYCHAIN: '0', KIT_API_URL: 'http://127.0.0.1:9' }, stderr: 'pipe',
    }));
    assert.equal((await client.listTools()).tools.length, 13);
    const presets = await client.callTool({ name: 'kitbash_bootstrap', arguments: { list: true } });
    assert.ok(!presets.isError, JSON.stringify(presets));
    assert.match(JSON.stringify(presets), /rust-server/);
    const block = await client.callTool({ name: 'registry_get', arguments: { block: path.join(installed, 'runtime/catalog/blocks/crypto-utils') } });
    assert.ok(!block.isError, JSON.stringify(block));
    assert.match(JSON.stringify(block), /crypto-utils/);
  } finally {
    await client.close();
    await rm(dir, { recursive: true, force: true });
  }
});
