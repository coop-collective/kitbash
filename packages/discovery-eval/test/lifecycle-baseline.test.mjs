import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { copyLifecycleBaseline, fixBaselineHomepage, originalHomepageSha256 } from '../lifecycle/baseline.mjs';
import { sha256, sourceFiles } from '../lifecycle/snapshots.mjs';

const baseline = path.resolve(import.meta.dirname, '../results/v2-2026-10-19/scratch/app');
const controls = ['profile-handle', 'profile-display-name', 'profile-bio', 'profile-save'];
const profile = (revision, name) => ({ revision, profile: { handle: 'alice_test', display_name: name, bio: 'Existing bio', avatar_id: null, is_public: false } });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

async function delayedProfileServer(html) {
  const loads = [deferred(), deferred()];
  const pending = [];
  const saved = [];
  let conflict = false;
  const server = http.createServer(async (request, response) => {
    const json = (value, status = 200) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    if (request.url === '/') { response.writeHead(200, { 'content-type': 'text/html' }); response.end(html); return; }
    if (request.url === '/api/session') return json({ user: { id: 'user_alice', email: 'alice@example.test' } });
    if (request.url === '/api/profile' && request.method === 'GET') {
      const index = pending.length;
      pending.push((value) => json(value));
      loads[index]?.resolve();
      return;
    }
    if (request.url === '/api/profile' && request.method === 'PUT') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      saved.push(body);
      if (conflict) { conflict = false; return json({ error: 'conflict' }, 409); }
      return json({ revision: body.revision + 1 });
    }
    return json({ error: 'missing' }, 404);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`, loads, saved,
    release: (index, value) => pending[index](value),
    conflictNextSave: () => { conflict = true; },
    async close() { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); },
  };
}

test('lifecycle baseline copies are identical and only correct the known homepage race', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'kit-lifecycle-baseline-'));
  try {
    const before = await sourceFiles(baseline);
    const first = await copyLifecycleBaseline(baseline, path.join(temporary, 'scratch'));
    const second = await copyLifecycleBaseline(baseline, path.join(temporary, 'reuse'));
    assert.deepEqual(first, second);
    assert.deepEqual(await sourceFiles(baseline), before, 'Measured v2 artifact must remain unchanged');
    const changed = first.files.filter((file) => before.find((old) => old.path === file.path)?.sha256 !== file.sha256);
    assert.deepEqual(changed.map((file) => file.path), ['public/index.html']);
    assert.equal(first.files.length, before.length);
    assert.equal(sha256(await readFile(path.join(baseline, 'public/index.html'))), originalHomepageSha256);
    await assert.rejects(copyLifecycleBaseline(baseline, path.join(temporary, 'scratch')), { code: 'EEXIST' });
    assert.throws(() => fixBaselineHomepage('<html>different source</html>'), /frozen v2 source/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('delayed profile responses reproduce the old race and cannot overwrite edits in the corrected baseline', { timeout: 30_000 }, async () => {
  const original = await readFile(path.join(baseline, 'public/index.html'), 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    // Reproduce the inherited failure using the exact historical artifact.
    const oldServer = await delayedProfileServer(original);
    const oldPage = await browser.newPage();
    try {
      await oldPage.goto(oldServer.base);
      await oldServer.loads[0].promise;
      assert.equal(await oldPage.getByTestId('profile-display-name').isEnabled(), true);
      await oldPage.getByTestId('profile-display-name').fill('Edit that will be lost');
      oldServer.release(0, profile(7, 'Persisted name'));
      await oldPage.waitForFunction(() => document.querySelector('[data-testid="profile-display-name"]').value === 'Persisted name');
    } finally { await oldPage.close(); await oldServer.close(); }

    const server = await delayedProfileServer(fixBaselineHomepage(original));
    const page = await browser.newPage();
    try {
      await page.goto(server.base);
      await server.loads[0].promise;
      for (const name of controls) assert.equal(await page.getByTestId(name).isDisabled(), true, `${name} must wait for initial profile load`);
      server.release(0, profile(7, 'Persisted name'));
      await page.waitForFunction(() => !document.querySelector('[data-testid="profile-save"]').disabled);
      assert.equal(await page.getByTestId('profile-display-name').inputValue(), 'Persisted name');
      await page.getByTestId('profile-display-name').fill('Edited after load');
      await page.getByTestId('profile-save').click();
      await page.getByTestId('profile-status').filter({ hasText: 'Saved (revision 8)' }).waitFor();
      assert.equal(server.saved[0].display_name, 'Edited after load');
      assert.equal(server.saved[0].revision, 7);

      // Conflict recovery also fetches a profile and must gate edits until it arrives.
      server.conflictNextSave();
      await page.getByTestId('profile-save').click();
      await server.loads[1].promise;
      for (const name of controls) assert.equal(await page.getByTestId(name).isDisabled(), true, `${name} must wait for conflict reload`);
      server.release(1, profile(9, 'Updated elsewhere'));
      await page.waitForFunction(() => !document.querySelector('[data-testid="profile-save"]').disabled);
      await page.getByTestId('profile-display-name').fill('Edit after conflict');
      await page.getByTestId('profile-save').click();
      await page.getByTestId('profile-status').filter({ hasText: 'Saved (revision 10)' }).waitFor();
      assert.equal(server.saved[2].display_name, 'Edit after conflict');
      assert.equal(server.saved[2].revision, 9);
    } finally { await page.close(); await server.close(); }
  } finally { await browser.close(); }
});
