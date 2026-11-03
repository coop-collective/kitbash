import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('../shared/files/scripts/test-node.mjs', import.meta.url));
test('generated check discovers nested Node suites and propagates a failed assertion', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kitbash-node-tests-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'test/nested'), { recursive: true });
  writeFileSync(path.join(root, 'test/worker.test.ts'), 'throw new Error("belongs to workerd");');
  writeFileSync(path.join(root, 'test/docker-smoke.mjs'), 'throw new Error("explicit Docker smoke only");');
  const file = path.join(root, 'test/nested/client.test.mjs');
  writeFileSync(file, 'import { test } from "node:test"; test("block suite", () => {});');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  let result = spawnSync(process.execPath, [helper], { cwd: root, encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /block suite/);
  writeFileSync(file, 'import { test } from "node:test"; test("block suite", () => { throw new Error("regression"); });');
  result = spawnSync(process.execPath, [helper], { cwd: root, encoding: 'utf8', env });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /regression/);
});
