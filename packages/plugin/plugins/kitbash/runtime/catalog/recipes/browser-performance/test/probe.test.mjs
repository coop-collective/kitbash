import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createProbe } from '../scripts/probe.mjs';
import { budgetFailures } from '../scripts/metrics.mjs';
function fakePage(resources = []) {
  const handlers = new Map();
  const sandbox = { window: {}, URL, performance: { getEntriesByType: () => resources },
    PerformanceObserver: class { static supportedEntryTypes = []; observe() {} } };
  return { handlers,
    addInitScript: async fn => vm.runInNewContext(`(${fn.toString()})()`, sandbox),
    evaluate: async (fn, args) => vm.runInNewContext(`(${fn.toString()})(${JSON.stringify(args) ?? ''})`, sandbox),
    on: (name, fn) => handlers.set(name, fn), off: name => handlers.delete(name),
  };
}
test('probe refuses remote and credential-bearing origins', async () => {
  for (const origin of ['https://example.com', 'http://secret@localhost', 'http://localhost/path']) {
    await assert.rejects(createProbe(fakePage(), { origin }), /loopback/);
  }
});
test('unsupported CLS is missing, not a successful zero', async () => {
  const probe = await createProbe(fakePage(), { origin: 'http://localhost' });
  const sample = await probe.snapshot();
  assert.equal(sample.cls, null);
  assert.equal(budgetFailures(sample, { cls: .1 }).length, 1);
});
test('only configured numeric summaries survive; resource credentials and error text do not', async () => {
  const page = fakePage([{ name: 'http://localhost/assets/app.js?token=PRIVATE', transferSize: 300 },
    { name: 'http://localhost/private/user-id', transferSize: 900 }]);
  const probe = await createProbe(page, { origin: 'http://localhost', assets: { app: '/assets/app.js' }, requests: { state: '/api/state' } });
  page.handlers.get('request')({ url: () => 'http://localhost/api/state?secret=PRIVATE', resourceType: () => 'fetch' });
  page.handlers.get('pageerror')(new Error('PRIVATE'));
  const sample = await probe.snapshot();
  assert.equal(sample.assets.app.transferBytes, 300);
  assert.equal(sample.requests.state, 1);
  assert.equal(sample.exceptions, 1);
  assert.doesNotMatch(JSON.stringify(sample), /PRIVATE|user-id|token|secret|http/);
  probe.dispose(); assert.equal(page.handlers.size, 0);
});
test('unsafe metric names and query-bearing path configuration are refused', async () => {
  await assert.rejects(createProbe(fakePage(), { origin: 'http://localhost', assets: { 'private user': '/app.js' } }), /safe metric/);
  await assert.rejects(createProbe(fakePage(), { origin: 'http://localhost', assets: { app: '/app.js?secret=x' } }), /safe metric/);
});
