import test from 'node:test';
import assert from 'node:assert/strict';
import { clsSessionMax, budgetFailures } from '../scripts/metrics.mjs';
const shift = (startTime, value, hadRecentInput = false) => ({ startTime, value, hadRecentInput });
test('CLS is maximum session, not lifetime sum; ignores user input', () => {
  assert.equal(clsSessionMax([shift(10, .1), shift(500, .2), shift(600, 1, true), shift(1500, .4)]), .4);
});
test('five-second session boundary starts a new window', () => {
  assert.ok(Math.abs(clsSessionMax(Array.from({ length: 8 }, (_, i) => shift(i * 800, .1))) - .7) < .0001);
});
test('missing measurements and assets fail rather than counting as zero', () => {
  const failures = budgetFailures({ readyMs: null, assets: {}, requests: {} }, { readyMs: 1000, assets: { bundle: 0 }, requests: { state: 1 } });
  assert.equal(failures.length, 3);
});
test('warm bytes and query bursts fail independently; valid zero-byte hit passes', () => {
  const sample = { readyMs: 30, assets: { bundle: { count: 1, transferBytes: 0 } }, requests: { state: 1 } };
  const budgets = { readyMs: 100, assets: { bundle: 0 }, requests: { state: 1 } };
  assert.deepEqual(budgetFailures(sample, budgets), []);
  assert.equal(budgetFailures({ ...sample, assets: { bundle: { count: 1, transferBytes: 400 } }, requests: { state: 3 } }, budgets).length, 2);
});
test('invalid negative and NaN budgets are rejected', () => {
  assert.throws(() => budgetFailures({}, { readyMs: NaN }), /Invalid budget/);
  assert.throws(() => budgetFailures({}, { cls: -1 }), /Invalid budget/);
});
