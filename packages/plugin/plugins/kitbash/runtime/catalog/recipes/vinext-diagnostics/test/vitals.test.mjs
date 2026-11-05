import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeVital, createVitalsSubscription } from '../src/vitals.ts';

test('allowlisted payload drops URLs, attribution and raw browser entries', () => {
  assert.deepEqual(safeVital({ name: 'LCP', value: 123, url: '/secret?key=x', entries: [{ node: 'private' }], attribution: 'private' }), {
    name: 'LCP', value: 123, unit: 'ms', scope: 'document'
  });
  assert.equal(safeVital({ name: 'CLS', value: 0.1 }).unit, 'score');
  for (const value of [NaN, Infinity, -1]) assert.equal(safeVital({ name: 'INP', value }), null);
  assert.equal(safeVital({ name: 'secret', value: 1 }), null);
});

test('Strict Mode setup-cleanup-setup registers once and removes stale listeners', () => {
  let registrations = 0, receive;
  const subscribe = createVitalsSubscription(callback => { registrations++; receive = callback; });
  const old = [], current = [];
  const cleanup = subscribe(metric => old.push(metric));
  cleanup();
  const cleanupCurrent = subscribe(metric => current.push(metric));
  receive({ name: 'CLS', value: 0.2 });
  receive({ name: 'CLS', value: 0.3 });
  assert.equal(registrations, 1);
  assert.equal(old.length, 0);
  assert.deepEqual(current.map(x => x.value), [0.2, 0.3]); // latest cumulative value, never add these together
  cleanupCurrent();
  receive({ name: 'LCP', value: 200 });
  assert.equal(current.length, 2);
});

test('independent subscribers receive independent safe records', () => {
  let receive;
  const subscribe = createVitalsSubscription(callback => { receive = callback; });
  subscribe(metric => { metric.value = 999; });
  const observed = [];
  subscribe(metric => observed.push(metric));
  receive({ name: 'INP', value: 40 });
  assert.equal(observed[0].value, 40);
});

test('two consumers sharing one callback can unsubscribe independently', () => {
  let receive;
  const subscribe = createVitalsSubscription(callback => { receive = callback; });
  const observed = [], callback = metric => observed.push(metric);
  const cleanup = subscribe(callback);
  subscribe(callback);
  cleanup();
  receive({ name: 'LCP', value: 100 });
  assert.equal(observed.length, 1);
});

test('failed registration does not retain the failed subscriber', () => {
  let attempts = 0, receive;
  const subscribe = createVitalsSubscription(callback => { if (++attempts === 1) throw Error('unavailable'); receive = callback; });
  const stale = [], current = [];
  assert.throws(() => subscribe(metric => stale.push(metric)), /unavailable/);
  subscribe(metric => current.push(metric));
  receive({ name: 'LCP', value: 100 });
  assert.equal(stale.length, 0);
  assert.equal(current.length, 1);
});
