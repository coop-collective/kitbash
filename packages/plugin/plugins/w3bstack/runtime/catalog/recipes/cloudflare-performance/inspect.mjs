import {pathToFileURL} from 'node:url';

class ConfigurationError extends Error {}
const API = 'https://api.cloudflare.com/client/v4/';
const STATUSES = new Set(['success', 'exception', 'scriptThrewException', 'exceededCpu', 'exceededMemory', 'canceled', 'clientDisconnected', 'responseStreamDisconnected', 'internalError', 'unknown']);
const CPU_FIELDS = ['cpuTimeP50', 'cpuTimeP99'];
export const QUERY = `query Performance($accountTag: string, $start: string, $end: string, $script: string) {
  __type(name: "AccountWorkersInvocationsAdaptiveQuantiles") { fields { name description } }
  viewer { accounts(filter: {accountTag: $accountTag}) {
    workersInvocationsAdaptive(limit: 100, filter: {datetime_geq: $start, datetime_lt: $end, scriptName: $script}) {
      dimensions { status }
      sum { requests errors subrequests }
      quantiles { cpuTimeP50 cpuTimeP99 }
    }
  } }
}`;

export function configuration(env, now = Date.now()) {
  if (!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID || '')) throw new ConfigurationError('Set a valid CLOUDFLARE_ACCOUNT_ID.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/.test(env.CLOUDFLARE_WORKER || '')) throw new ConfigurationError('Set a valid CLOUDFLARE_WORKER name.');
  if (!env.CLOUDFLARE_API_TOKEN || /[\r\n]/.test(env.CLOUDFLARE_API_TOKEN)) throw new ConfigurationError('Set CLOUDFLARE_API_TOKEN through the environment.');
  const minutes = Number(env.PERF_WINDOW_MINUTES || 60);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new ConfigurationError('PERF_WINDOW_MINUTES must be an integer from 1 to 1440.');
  const end = env.PERF_END ? Date.parse(env.PERF_END) : now;
  if ((env.PERF_END && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(env.PERF_END)) || !Number.isFinite(end) || end > now || now - end > 89 * 86400000) throw new ConfigurationError('PERF_END must be a past ISO timestamp within 89 days.');
  return {account: env.CLOUDFLARE_ACCOUNT_ID, worker: env.CLOUDFLARE_WORKER, token: env.CLOUDFLARE_API_TOKEN,
    start: new Date(end - minutes * 60000).toISOString(), end: new Date(end).toISOString()};
}

// Never forward provider error strings, arbitrary keys, bindings, or response headers to output.
async function request(fetcher, token, path, body) {
  try {
    const response = await fetcher(API + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {Authorization: `Bearer ${token}`, ...(body === undefined ? {} : {'content-type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return {state: response.status === 401 || response.status === 403 ? 'forbidden' : [404, 405, 501].includes(response.status) ? 'unsupported' : 'http_error', httpStatus: response.status};
    }
    const data = await response.json();
    if (data?.success === false || (Array.isArray(data?.errors) && data.errors.length)) return {state: 'api_error', httpStatus: response.status};
    return {state: 'ok', httpStatus: response.status, data};
  } catch {
    return {state: 'transport_or_parse_error'};
  }
}
const numeric = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const bool = n => typeof n === 'boolean' ? n : null;
const rate = n => numeric(n) && n <= 1 ? n : null;
const access = result => ({state: result.state, ...(result.httpStatus === undefined ? {} : {httpStatus: result.httpStatus})});

export function summarizeAnalytics(data) {
  const fields = data?.data?.__type?.fields;
  if (!Array.isArray(fields) || !CPU_FIELDS.every(name => fields.some(f => f.name === name && /microseconds/i.test(f.description || '')))) {
    return {state: 'schema_units_unverified', groups: []};
  }
  const accounts = data?.data?.viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1 || !Array.isArray(accounts[0].workersInvocationsAdaptive)) return {state: 'unexpected_response', groups: []};
  const rows = accounts[0].workersInvocationsAdaptive;
  if (rows.length >= 100) return {state: 'possibly_truncated', groups: []};
  const groups = [];
  for (const row of rows) {
    if (!['requests', 'errors', 'subrequests'].every(k => numeric(row.sum?.[k])) || !CPU_FIELDS.every(k => numeric(row.quantiles?.[k]))) return {state: 'unexpected_response', groups: []};
    groups.push({status: STATUSES.has(row.dimensions?.status) ? row.dimensions.status : 'other',
      requests: row.sum.requests, errors: row.sum.errors, subrequests: row.sum.subrequests,
      cpuMsP50: row.quantiles.cpuTimeP50 / 1000, cpuMsP99: row.quantiles.cpuTimeP99 / 1000});
  }
  return {state: rows.length ? 'ok' : 'no_data', groups,
    totals: groups.reduce((t, g) => ({requests: t.requests + g.requests, errors: t.errors + g.errors, subrequests: t.subrequests + g.subrequests}), {requests: 0, errors: 0, subrequests: 0})};
}

export async function inspect(config, fetcher = fetch) {
  const [settings, analytics, telemetry] = await Promise.all([
    request(fetcher, config.token, `accounts/${config.account}/workers/scripts/${config.worker}/settings`),
    request(fetcher, config.token, 'graphql', {query: QUERY, variables: {accountTag: config.account, start: config.start, end: config.end, script: config.worker}}),
    // Keys discovery is a read operation despite POST; values and raw events are never requested.
    request(fetcher, config.token, `accounts/${config.account}/workers/observability/telemetry/keys`, {from: Date.parse(config.start), to: Date.parse(config.end), limit: 1}),
  ]);
  const result = settings.data?.result;
  const o = result?.observability;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const settingsReport = settings.state !== 'ok' ? access(settings)
    : !object(result) ? {state: 'unexpected_response'}
    : o === undefined || o === null ? {state: 'unconfigured', enabled: null}
    : !object(o) || typeof o.enabled !== 'boolean' ? {state: 'unexpected_response'}
    : {state: 'ok', enabled: o.enabled,
      logs: {enabled: bool(o.logs?.enabled), persisted: bool(o.logs?.persist), sampling: rate(o.logs?.head_sampling_rate ?? o.head_sampling_rate)},
      traces: {enabled: bool(o.traces?.enabled), persisted: bool(o.traces?.persist), sampling: rate(o.traces?.head_sampling_rate)}};
  const metrics = analytics.state === 'ok' ? summarizeAnalytics(analytics.data) : {...access(analytics), groups: []};
  const telemetryReport = {...(telemetry.state === 'ok' && !Array.isArray(telemetry.data?.result) ? {state: 'unexpected_response'} : access(telemetry)), scope: 'account_key_discovery', tracesInspected: false};
  return {version: 1, interval: {start: config.start, end: config.end}, settings: settingsReport, analytics: metrics, telemetry: telemetryReport,
    preflightComplete: settingsReport.state === 'ok' && ['ok', 'no_data'].includes(metrics.state) && telemetryReport.state === 'ok',
    limits: ['Adaptive aggregate estimates grouped by invocation outcome; not per-route latency or D1 query time.',
      'CPU quantiles apply within each outcome group; never average percentiles across groups.',
      'Telemetry key access does not establish trace availability or inspect any stored traces.',
      'No telemetry configuration, deployments, database contents, or application data were changed.']};
}

export async function main(env = process.env, argv = process.argv.slice(2)) {
  if (argv.length) throw new ConfigurationError('This command accepts environment configuration only; no CLI arguments.');
  const report = await inspect(configuration(env));
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  return report.preflightComplete ? 0 : 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {process.exitCode = await main();} catch (error) {
    process.stderr.write((error instanceof ConfigurationError ? error.message : 'Unexpected preflight failure; no provider details retained.') + '\n'); process.exitCode = 1;
  }
}
