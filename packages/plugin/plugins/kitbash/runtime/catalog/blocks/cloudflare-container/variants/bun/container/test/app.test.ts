import { test, expect } from 'bun:test';
import { mkdtemp, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/app';
import { scratchRoot, withScratch } from '../src/scratch';
test('scratch uses private jobs, rejects symlinks and cleans up errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hash-test-'));
  try {
    await symlink(root, join(root, 'link'));
    await expect(scratchRoot([join(root, 'link')])).rejects.toThrow();
    await expect(withScratch(root, async (dir) => {
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
      await writeFile(join(dir, 'input'), 'private'); throw Error('failed');
    })).rejects.toThrow('failed');
    expect(await readdir(root)).toEqual(['link']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('actual HTTP hash and oversize stream leave no scratch files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hash-http-'));
  const { server } = await startServer({ port: 0, host: '127.0.0.1', root });
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw Error();
    const url = `http://127.0.0.1:${address.port}`;
    expect(await (await fetch(url + '/hash', { method: 'POST', body: 'hello' })).json()).toEqual({ bytes: 5, sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824' });
    try { expect((await fetch(url + '/hash', { method: 'POST', body: new Uint8Array(1_048_577) })).ok).toBe(false); } catch { /* Stream rejection may reset the socket. */ }
    for (let i = 0; i < 50 && (await readdir(root)).length; i++) await Bun.sleep(10);
    expect(await readdir(root)).toEqual([]);
  } finally { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); await rm(root, { recursive: true, force: true }); }
});
