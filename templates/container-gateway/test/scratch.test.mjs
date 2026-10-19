import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { withScratch } from '../container/scratch.mjs';
import { startServer } from '../container/server.mjs';
test('private per-job directories clean up success and failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kit-scratch-test-'));
  try {
    await withScratch(root, async (dir) => { assert.equal((await stat(dir)).mode & 0o777, 0o700); await writeFile(join(dir, 'data'), 'input'); });
    await assert.rejects(withScratch(root, async () => { throw Error('task failed'); }));
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true }); }
});
test('real HTTP service hashes bounded input and cleans oversized/disconnected requests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kit-server-test-'));
  const { server } = await startServer({ port: 0, host: '127.0.0.1', root });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${origin}/hash`, { method: 'POST', body: 'hello' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { bytes: 5, sha256: createHash('sha256').update('hello').digest('hex') });
    assert.deepEqual(await readdir(root), []);
    try { const over = await fetch(`${origin}/hash`, { method: 'POST', body: new Uint8Array(1_048_577) }); assert.equal(over.status, 413); } catch (error) { assert.equal(error.name, 'TypeError'); }
    for (let n = 0; n < 50 && (await readdir(root)).length; n++) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(await readdir(root), []);
  } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); await rm(root, { recursive: true }); }
});
test('admission and deadline bound concurrent scratch writes', async () => {
  const { request } = await import('node:http');
  const root = await mkdtemp(join(tmpdir(), 'kit-limit-test-'));
  const { server } = await startServer({ port: 0, host: '127.0.0.1', root, deadlineMs: 200 });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const held = [];
  try {
    for (let n = 0; n < 2; n++) {
      const req = request(`${origin}/hash`, { method: 'POST' });
      req.on('error', () => {}); req.write('partial body'); held.push(req);
    }
    for (let n = 0; n < 20 && (await readdir(root)).length < 2; n++) await new Promise((r) => setTimeout(r, 5));
    assert.equal((await readdir(root)).length, 2);
    const refused = await fetch(`${origin}/hash`, { method: 'POST', body: 'third' });
    assert.equal(refused.status, 503);
    for (let n = 0; n < 100 && (await readdir(root)).length; n++) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(await readdir(root), []);
  } finally {
    held.forEach((req) => req.destroy()); server.closeAllConnections();
    await new Promise((r) => server.close(r)); await rm(root, { recursive: true });
  }
});
