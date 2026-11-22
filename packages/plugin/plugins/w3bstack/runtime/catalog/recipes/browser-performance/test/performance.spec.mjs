import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createProbe } from '../scripts/probe.mjs';
import { budgetFailures } from '../scripts/metrics.mjs';

async function setup(page, baseURL) {
  return createProbe(page, { origin: baseURL, assets: { app: '/assets/app.js' }, requests: { state: '/api/state', stalled: '/api/stall' } });
}
async function visit(page, probe, url, status = 'ready') {
  probe.reset();
  await page.goto(url);
  await expect(page.locator('body')).toHaveAttribute('data-status', status);
  await probe.markReady();
  // A stable observation window includes async requests after initial readiness.
  await page.waitForTimeout(200);
  return probe.snapshot();
}
async function evidence(testInfo, samples) {
  await testInfo.attach('performance-summary', { body: JSON.stringify({
    fixture: true, fixtureRevision: createHash('sha256').update(readFileSync(new URL('../src/worker.mjs', import.meta.url))).digest('hex'),
    observedAt: new Date().toISOString(), viewport: testInfo.project.use.viewport, network: 'local native; no CPU throttling', samples,
    note: 'Lab samples only. No INP or field percentile claim. No URLs, headers, response bodies or auth state retained.',
  }, null, 2), contentType: 'application/json' });
}
test('cold then warm browser cache meets exact asset and request budgets', async ({ page, baseURL }, testInfo) => {
  const probe = await setup(page, baseURL);
  const cold = await visit(page, probe, '/');
  const warm = await visit(page, probe, '/');
  expect(cold.assets.app.transferBytes).toBeGreaterThan(0);
  expect(budgetFailures(warm, { assets: { app: 0 }, requests: { state: 1, stalled: 0 }, exceptions: 0, unknownRequests: 0, readyMs: 5000 })).toEqual([]);
  await evidence(testInfo, { cold, warm }); probe.dispose();
});
test('known-bad no-store fixture is rejected by the same warm budget', async ({ page, baseURL }) => {
  const probe = await setup(page, baseURL);
  await visit(page, probe, '/?mode=uncached');
  const warm = await visit(page, probe, '/?mode=uncached');
  expect(budgetFailures(warm, { assets: { app: 0 } })).toHaveLength(1); probe.dispose();
});
test('known-bad redundant query fixture is rejected by request budget', async ({ page, baseURL }) => {
  const probe = await setup(page, baseURL);
  const sample = await visit(page, probe, '/?mode=burst');
  expect(sample.requests.state).toBe(3);
  expect(budgetFailures(sample, { requests: { state: 1 } })).toHaveLength(1); probe.dispose();
});
test('startup deadline releases loading when response headers arrive but body stalls', async ({ page, baseURL }) => {
  const probe = await setup(page, baseURL);
  const sample = await visit(page, probe, '/?mode=stall', 'error');
  await expect(page.locator('body')).toHaveAttribute('data-reason', 'deadline');
  expect(budgetFailures(sample, { readyMs: 5000, requests: { stalled: 1 }, exceptions: 0 })).toEqual([]);
  // Retry in the SAME document: a rejected promise retained in flights would fail this.
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-status', 'ready');
  const recovered = await probe.snapshot();
  expect(recovered.requests.state).toBe(1);
  expect(recovered.requests.stalled).toBe(1); probe.dispose();
});
