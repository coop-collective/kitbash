import test from 'node:test';
import assert from 'node:assert/strict';
import {configuration, inspect, summarizeAnalytics, main} from '../inspect.mjs';

const config = configuration({CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_WORKER: 'fixture-worker', CLOUDFLARE_API_TOKEN: 'fixture-secret'}, Date.parse('2026-11-05T12:00:00Z'));
const json = (body, status = 200) => new Response(JSON.stringify(body), {status});
function metrics(rows = [{dimensions: {status: 'success'}, sum: {requests: 10, errors: 0, subrequests: 3}, quantiles: {cpuTimeP50: 461, cpuTimeP99: 89452}}]) {
  return {data: {__type: {fields: ['cpuTimeP50', 'cpuTimeP99'].map(name => ({name, description: 'CPU time in microseconds'}))}, viewer: {accounts: [{workersInvocationsAdaptive: rows}]}}};
}
const settings = {success: true, result: {observability: {enabled: true, logs: {enabled: true, persist: true, head_sampling_rate: 1}, traces: {enabled: true, persist: true, head_sampling_rate: 0.05}}, bindings: [{value: 'private-binding-secret'}]}};
function mock(override = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({url, options});
    if (url.endsWith('/settings')) return override.settings?.() ?? json(settings);
    if (url.endsWith('/graphql')) return override.analytics?.() ?? json(metrics());
    if (url.endsWith('/keys')) return override.telemetry?.() ?? json({success: true, result: [{key: 'private-telemetry-key'}]});
    throw new Error('unexpected request');
  };
  return {fetcher, calls};
}

test('explicit interval and strict configuration prevent accidental targets and unsafe paths', () => {
  assert.equal(config.start, '2026-11-05T11:00:00.000Z');
  assert.equal(config.end, '2026-11-05T12:00:00.000Z');
  const env = {CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_WORKER: 'fixture-worker', CLOUDFLARE_API_TOKEN: 'fixture-secret'};
  for (const change of [{CLOUDFLARE_WORKER: '../secrets'}, {CLOUDFLARE_ACCOUNT_ID: 'bad'}, {CLOUDFLARE_API_TOKEN: ''}, {PERF_WINDOW_MINUTES: '0'}, {PERF_WINDOW_MINUTES: '1441'}, {PERF_END: 'invalid'}, {PERF_END: '2099-01-01'}]) assert.throws(() => configuration({...env, ...change}));
});
test('converts verified microseconds, preserves status groups and never averages quantiles', async () => {
  const data = metrics([{dimensions: {status: 'success'}, sum: {requests: 10, errors: 0, subrequests: 3}, quantiles: {cpuTimeP50: 461, cpuTimeP99: 89452}}, {dimensions: {status: 'scriptThrewException'}, sum: {requests: 2, errors: 2, subrequests: 0}, quantiles: {cpuTimeP50: 1000, cpuTimeP99: 2000}}]);
  const result = summarizeAnalytics(data);
  assert.equal(result.groups[0].cpuMsP50, 0.461);
  assert.equal(result.groups[0].cpuMsP99, 89.452);
  assert.deepEqual(result.totals, {requests: 12, errors: 2, subrequests: 3});
  assert.equal(result.groups[1].status, 'scriptThrewException');
  assert.equal(result.totals.cpuMsP99, undefined);
});
test('does not invent zero metrics for missing data, malformed schemas or truncation', () => {
  assert.equal(summarizeAnalytics(metrics([])).state, 'no_data');
  const badUnits = metrics(); badUnits.data.__type.fields[0].description = 'milliseconds';
  assert.equal(summarizeAnalytics(badUnits).state, 'schema_units_unverified');
  assert.equal(summarizeAnalytics({}).state, 'schema_units_unverified');
  const missingAccount = metrics(); missingAccount.data.viewer.accounts = [];
  assert.equal(summarizeAnalytics(missingAccount).state, 'unexpected_response');
  const badNumber = metrics(); badNumber.data.viewer.accounts[0].workersInvocationsAdaptive[0].sum.errors = null;
  assert.equal(summarizeAnalytics(badNumber).state, 'unexpected_response');
  assert.equal(summarizeAnalytics(metrics(Array(100).fill({}))).state, 'possibly_truncated');
});
test('preflight uses only fixed read endpoints and emits only allowlisted fields', async () => {
  const {fetcher, calls} = mock(); const report = await inspect(config, fetcher);
  assert.equal(report.preflightComplete, true);
  assert.equal(report.settings.traces.sampling, 0.05);
  assert.equal(report.telemetry.tracesInspected, false);
  assert.equal(calls.length, 3);
  for (const {url, options} of calls) {
    assert.ok(url.startsWith('https://api.cloudflare.com/client/v4/'));
    assert.equal(options.headers.Authorization, 'Bearer fixture-secret');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
  }
  const query = JSON.parse(calls.find(c => c.url.endsWith('/graphql')).options.body);
  assert.equal(query.variables.script, config.worker);
  assert.equal(query.variables.start, config.start);
  assert.match(query.query, /datetime_lt/);
  const output = JSON.stringify(report);
  for (const secret of ['fixture-secret', 'private-binding-secret', 'private-telemetry-key', config.account]) assert.ok(!output.includes(secret));
});
test('403 trace preflight remains unavailable while aggregate analytics remains usable', async () => {
  const {fetcher} = mock({telemetry: () => json({errors: [{message: 'sensitive-provider-message'}]}, 403)});
  const report = await inspect(config, fetcher);
  assert.equal(report.preflightComplete, false);
  assert.deepEqual(report.telemetry, {state: 'forbidden', httpStatus: 403, scope: 'account_key_discovery', tracesInspected: false});
  assert.equal(report.analytics.state, 'ok');
  assert.ok(!JSON.stringify(report).includes('sensitive-provider-message'));
});
test('unsupported endpoint, GraphQL HTTP200 errors and transport errors stay distinct', async () => {
  const {fetcher} = mock({telemetry: () => json({}, 404), analytics: () => json({errors: [{message: 'private token or query'}]}), settings: () => {throw new Error('secret in URL');}});
  const report = await inspect(config, fetcher);
  assert.equal(report.settings.state, 'transport_or_parse_error');
  assert.equal(report.analytics.state, 'api_error');
  assert.equal(report.telemetry.state, 'unsupported');
  assert.equal(report.preflightComplete, false);
  assert.ok(!JSON.stringify(report).includes('secret in URL'));
});
test('unknown status and arbitrary response fields cannot leak through summaries', () => {
  const data = metrics();
  data.data.viewer.accounts[0].workersInvocationsAdaptive[0].dimensions.status = 'token=user-secret';
  const report = summarizeAnalytics(data);
  assert.equal(report.groups[0].status, 'other');
  assert.ok(!JSON.stringify(report).includes('user-secret'));
});
test('CLI rejects every argument without echoing it or sending any network request', async () => {
  await assert.rejects(main({}, ['--token=private-token']), /environment configuration only/);
});
test('telemetry discovery is constrained to the selected interval and one key', async () => {
  const {fetcher, calls} = mock(); await inspect(config, fetcher);
  assert.deepEqual(JSON.parse(calls.find(c => c.url.endsWith('/keys')).options.body), {from: Date.parse(config.start), to: Date.parse(config.end), limit: 1});
});
test('settings malformed response differs from valid absent observability configuration', async () => {
  for (const body of [{}, {success: true}, {result: []}, {result: {observability: 'bad'}}, {result: {observability: {}}}]) {
    const {fetcher} = mock({settings: () => json(body)}); const report = await inspect(config, fetcher);
    assert.equal(report.settings.state, 'unexpected_response'); assert.equal(report.preflightComplete, false);
  }
  const {fetcher} = mock({settings: () => json({success: true, result: {}})});
  const report = await inspect(config, fetcher);
  assert.equal(report.settings.state, 'unconfigured'); assert.equal(report.preflightComplete, false);
});
test('malformed telemetry envelope cannot pass the preflight', async () => {
  const {fetcher} = mock({telemetry: () => json({success: true})}); const report = await inspect(config, fetcher);
  assert.equal(report.telemetry.state, 'unexpected_response'); assert.equal(report.preflightComplete, false);
});
