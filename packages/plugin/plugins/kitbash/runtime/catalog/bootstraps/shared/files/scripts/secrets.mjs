#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const NAME = /^[A-Z][A-Z0-9_]*$/;
const PROVIDERS = ['cloudflare-api-token', 'cloudflare-r2-access-key'];
const RESERVED = /^(?:INFISICAL_|CLOUDFLARE_|GITHUB_|ACTIONS_|NODE_OPTIONS$|PATH$|HOME$)/;
export class SecretError extends Error {}
const fail = (message) => { throw new SecretError(message); };
const parse = (value) => {
  try { return JSON.parse(value); } catch { fail('Invalid JSON; input and secret values were omitted.'); }
};
const validPath = (value) => typeof value === 'string' && /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(value);

export function childEnvironment(env, deployment = false) {
  return Object.fromEntries(Object.entries(env).filter(([name]) =>
    !/^(?:INFISICAL_|GITHUB_|ACTIONS_|GITSTALK_.*TOKEN$|BEANSTALK_.*TOKEN$)/.test(name) &&
    (deployment || !name.startsWith('CLOUDFLARE_'))));
}

export function selectTarget(config, target) {
  if (config?.version !== 1 || !UUID.test(config.projectId ?? '')) fail('Set a valid Infisical projectId in .kitbash/secrets.json.');
  let domain;
  try { domain = new URL(config.domain); } catch { fail('Infisical domain must be an HTTPS origin.'); }
  if (domain.protocol !== 'https:' || domain.username || domain.password || domain.search || domain.hash || domain.pathname !== '/') fail('Infisical domain must be an HTTPS origin.');
  if (!['local', 'staging', 'production'].includes(target)) fail('Choose --env local, staging, or production explicitly.');
  const scope = config.targets?.[target];
  if (!scope || !/^[a-z][a-z0-9_-]*$/.test(scope.environment ?? '') || !validPath(scope.path)) fail('Target needs an explicit Infisical environment and path.');
  if (!config.secrets || Array.isArray(config.secrets) || typeof config.secrets !== 'object') fail('Declare application secret names in .kitbash/secrets.json.');
  for (const [name, policy] of Object.entries(config.secrets)) {
    if (!NAME.test(name) || RESERVED.test(name) || !policy || typeof policy !== 'object' || !['manual', 'migration-required', 'provider'].includes(policy.rotation)) fail('Invalid application secret policy; infrastructure credentials belong in /ci.');
  }
  return { ...scope, projectId: config.projectId, domain: domain.origin, target };
}

export function selectSecrets(config, source, requireAll = true) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('Expected a JSON object containing secret names and string values.');
  const values = Object.create(null);
  for (const name of Object.keys(config.secrets)) {
    const value = source[name];
    if (value === undefined && (!requireAll || config.secrets[name].required === false)) continue;
    if (typeof value !== 'string' || !value.length || value.includes('\0')) fail(`Missing or invalid application secret: ${name}.`);
    values[name] = value;
  }
  return values;
}

export function makeClient(scope, { env = process.env, spawn = spawnSync, request = fetch } = {}) {
  let token = env.INFISICAL_TOKEN;
  async function api(endpoint, { method = 'GET', query, body } = {}) {
    if (!token && (env.INFISICAL_CLIENT_ID || env.INFISICAL_CLIENT_SECRET)) {
      if (!env.INFISICAL_CLIENT_ID || !env.INFISICAL_CLIENT_SECRET) fail('Universal Auth requires both INFISICAL_CLIENT_ID and INFISICAL_CLIENT_SECRET.');
      let login;
      try {
        const response = await request(new URL('/api/v1/auth/universal-auth/login', scope.domain), {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clientId: env.INFISICAL_CLIENT_ID, clientSecret: env.INFISICAL_CLIENT_SECRET }),
          redirect: 'error', signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok || response.redirected) fail('Infisical Universal Auth failed.');
        login = await response.json();
      } catch { fail('Infisical Universal Auth failed; credential and response values were omitted.'); }
      token = login?.accessToken;
      if (!token) fail('Infisical Universal Auth did not issue an access token.');
    }
    if (!token) {
      let result;
      try {
        result = spawn('infisical', ['user', 'get', 'token', '--plain', '--domain', scope.domain, '--silent', '--telemetry=false'], {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: false, timeout: 30_000, maxBuffer: 1024 * 1024,
          env: { ...env, INFISICAL_DISABLE_UPDATE_CHECK: 'true' },
        });
      } catch { fail('Unable to read Infisical login. Install the CLI and run infisical login.'); }
      if (result.error || result.status !== 0) fail('Unable to read Infisical login. Run infisical login for the configured domain.');
      token = result.stdout.trim();
    }
    if (typeof token !== 'string' || token.startsWith('st.') || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) fail('Use an Infisical user or machine identity access token; legacy service tokens are unsupported.');
    const url = new URL(endpoint, scope.domain);
    if (query) url.search = new URLSearchParams(query).toString();
    let response;
    try {
      response = await request(url, {
        method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30_000),
      });
    } catch { fail('Infisical request was not confirmed. Inspect provider state before retrying a write; no automatic retry was attempted.'); }
    if (!response.ok || response.redirected) {
      await response.body?.cancel().catch(() => {});
      fail(`Infisical request failed (HTTP ${response.status}); response values were omitted. Check permissions and provider state before retrying.`);
    }
    let result;
    try { result = await response.json(); } catch { fail('Infisical returned invalid JSON; response values were omitted.'); }
    if (result?.approval) fail('Infisical returned a pending approval. No completed write was confirmed; inspect the project before retrying.');
    return result;
  }
  async function read() {
    const result = await api('/api/v4/secrets', { query: {
      projectId: scope.projectId, environment: scope.environment, secretPath: scope.path,
      recursive: 'false', includeImports: 'false', includePersonalOverrides: 'false', expandSecretReferences: 'false', viewSecretValue: 'true',
    } });
    if (!Array.isArray(result?.secrets)) fail('Infisical returned an invalid secret list.');
    const values = Object.create(null);
    for (const row of result.secrets) {
      if (!NAME.test(row.secretKey ?? '') || typeof row.secretValue !== 'string' || row.secretValueHidden ||
          row.workspace !== scope.projectId || row.environment !== scope.environment || row.type !== 'shared' ||
          (row.secretPath !== undefined && row.secretPath !== scope.path) || Object.hasOwn(values, row.secretKey)) fail('Infisical returned duplicate, hidden, or out-of-scope secrets.');
      values[row.secretKey] = row.secretValue;
    }
    return values;
  }
  async function create(values) {
    const entries = Object.entries(values);
    if (!entries.length) fail('Provide at least one registered secret.');
    for (const [, value] of entries) {
      const normalized = value.endsWith('\n') ? `${value.trim()}\n` : value.trim();
      if (normalized !== value) fail('Infisical would normalize surrounding whitespace. Resolve the input before importing.');
    }
    const existing = await read();
    if (entries.some(([name]) => Object.hasOwn(existing, name))) fail('Create-only import refuses to replace existing secrets. Use the provider rotation or an application migration.');
    await api('/api/v4/secrets/batch', { method: 'POST', body: {
      projectId: scope.projectId, environment: scope.environment, secretPath: scope.path,
      secrets: entries.map(([secretKey, secretValue]) => ({ secretKey, secretValue, skipMultilineEncoding: false })),
    } });
    const actual = await read();
    if (entries.some(([name, value]) => actual[name] !== value)) fail('Create readback did not match. Some writes may have succeeded; inspect Infisical before retrying.');
  }
  async function rotate(rotation) {
    const result = await api(`/api/v2/secret-rotations/${rotation.provider}/rotation-name/${encodeURIComponent(rotation.name)}`, { query: {
      projectId: scope.projectId, environment: scope.environment, secretPath: rotation.path,
    } });
    const record = result?.secretRotation;
    if (!UUID.test(record?.id ?? '') || record.projectId !== scope.projectId || record.environment?.slug !== scope.environment || record.folder?.path !== rotation.path) fail('Rotation does not match the selected project, environment, and folder; no rotation requested.');
    await api(`/api/v2/secret-rotations/${rotation.provider}/${record.id}/rotate-secrets`, { method: 'POST' });
  }
  return { read, create, rotate };
}

export function rotationPlan(config, target, name) {
  const scope = selectTarget(config, target);
  const rotation = config.rotations?.[name];
  if (!rotation || !PROVIDERS.includes(rotation.provider) || rotation.target !== target ||
      typeof rotation.name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(rotation.name) || !validPath(rotation.path)) {
    fail('Choose a registered provider rotation for this environment. Static signing keys and peppers require an application-specific migration.');
  }
  return { scope, rotation };
}

export function withSecretsFile(values, use) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'kitbash-secrets-'));
  chmodSync(directory, 0o700);
  const file = path.join(directory, 'secrets.json');
  try {
    writeFileSync(file, JSON.stringify(values), { mode: 0o600, flag: 'wx' });
    return use(file);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

export function writeLocal(root, scope, values) {
  if (scope.target !== 'local' || !['.dev.vars', '.env.local'].includes(scope.localFile)) fail('Local materialization only accepts --env local and .dev.vars or .env.local.');
  const destination = path.join(root, scope.localFile);
  const marker = `# Kitbash Infisical project=${scope.projectId} env=${scope.environment} path=${scope.path}`;
  if (existsSync(destination)) {
    if (!lstatSync(destination).isFile() || !readFileSync(destination, 'utf8').startsWith(`${marker}\n`)) fail('Local file already exists and is not owned by this Infisical source. Reconcile it before refreshing.');
  }
  // Wrangler/Node dotenv support quoted multiline strings. Reject ambiguous quoting instead of changing values.
  const lines = Object.entries(values).map(([name, value]) => {
    if (value.includes("'") || value.includes('\r')) fail('Local dotenv cannot preserve this value exactly; use secrets run for process environment injection.');
    return `${name}='${value}'`;
  });
  const directory = mkdtempSync(path.join(root, '.kitbash-secrets-'));
  chmodSync(directory, 0o700);
  try {
    const temporary = path.join(directory, 'local');
    writeFileSync(temporary, `${marker}\n${lines.join('\n')}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, destination);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

export function deployWorker(root, scope, values, { spawn = spawnSync, env = process.env } = {}) {
  if (scope.target === 'local' || scope.wranglerEnvironment !== scope.target) fail('Worker deployment requires an explicit configured staging or production target.');
  if (!env.CLOUDFLARE_API_TOKEN || !/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID ?? '')) fail('Deployment needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the target /ci folder.');
  const config = scope.wranglerConfig ?? 'wrangler.jsonc';
  if (path.isAbsolute(config) || config.split(/[\\/]/).includes('..')) fail('Wrangler config must be inside the project.');
  const args = ['exec', 'wrangler', 'deploy', '--config', config];
  if (scope.flattenedConfig) {
    const built = parse(readFileSync(path.join(root, config), 'utf8'));
    if (!scope.workerName || built.name !== scope.workerName) fail('Built Worker name does not match target. Rebuild with the correct CLOUDFLARE_ENV before deploying.');
  } else args.push('--env', scope.target);
  withSecretsFile(values, (file) => {
    let result;
    try {
      result = spawn('pnpm', [...args, '--secrets-file', file], {
        cwd: root, env: childEnvironment(env, true), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: false, timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024,
      });
    } catch { fail('Worker deployment was not confirmed. Inspect deployment state before retrying.'); }
    if (result.error || result.status !== 0) fail('Worker deployment failed; captured output omitted to prevent secret exposure. Inspect Cloudflare deployment status.');
  });
}

export async function main(argv, { root = process.cwd(), env = process.env, log = console.log, input = () => readFileSync(0, 'utf8'), client, credentialsClient, spawn = spawnSync } = {}) {
  const [command, ...args] = argv;
  if (!command || command === 'help' || command === '--help' || args.includes('--help')) {
    log('Usage: secrets.mjs <local|doctor|create NAME|import|generate NAME|deploy|rotate ALIAS|run -- COMMAND...> --env local|staging|production [--from-env] [--execute]. create/import read stdin; no secret values are printed. rotate is a plan until --execute.');
    return;
  }
  const options = {};
  const names = [];
  let child = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') { child = args.slice(i + 1); break; }
    if (args[i] === '--env') options.target = args[++i];
    else if (args[i] === '--from-env') options.fromEnv = true;
    else if (args[i] === '--execute') options.execute = true;
    else if (args[i].startsWith('-')) fail('Unknown secrets option.');
    else names.push(args[i]);
  }
  const config = parse(readFileSync(path.join(root, '.kitbash/secrets.json'), 'utf8'));
  const scope = selectTarget(config, options.target);
  if (names.length > 1 || (child.length && command !== 'run') || (options.fromEnv && command !== 'deploy') || (options.execute && command !== 'rotate')) fail('Options do not apply to this command.');
  const provider = client ?? makeClient(scope, { env, spawn });
  if (['create', 'import', 'generate'].includes(command)) {
    let values;
    if (command === 'import') {
      if (names.length) fail('Import takes a JSON object on stdin, not arguments.');
      values = parse(input());
    } else {
      const name = names[0];
      if (!name || !Object.hasOwn(config.secrets, name)) fail('Register the secret name in .kitbash/secrets.json first.');
      if (command === 'generate' && (config.secrets[name].generate !== true || config.secrets[name].rotation === 'provider')) fail('Generation is only allowed for registered application keys, never provider credentials.');
      values = { [name]: command === 'generate' ? randomBytes(32).toString('base64url') : input() };
    }
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some(name => !Object.hasOwn(config.secrets, name))) fail('Import contains unregistered names; no changes attempted.');
    await provider.create(selectSecrets(config, values, false));
    log(`Created ${Object.keys(values).length} secret(s) in ${scope.environment}${scope.path}. Run local --env local to refresh local files.`);
    return;
  }
  if (command === 'rotate') {
    const { rotation } = rotationPlan(config, options.target, names[0]);
    if (!options.execute) { log(JSON.stringify({ target: options.target, provider: rotation.provider, rotation: rotation.name, path: rotation.path, execute: false })); return; }
    await provider.rotate(rotation);
    log('Provider rotation requested. Wait for Infisical success, refresh all consumers, and verify before the overlap expires.');
    return;
  }
  if (!['local', 'doctor', 'deploy', 'run'].includes(command) || names.length) fail('Unknown command or unexpected arguments. Run secrets.mjs help.');
  if (command === 'local' && options.target !== 'local') fail('Local materialization requires --env local; remote secrets are never written to a local env file.');
  if (command === 'run' && !child.length) fail('Run requires -- followed by the process and its arguments.');
  const values = selectSecrets(config, options.fromEnv ? env : await provider.read());
  if (command === 'local') writeLocal(root, scope, values);
  if (command === 'deploy') {
    let deploymentEnv = env;
    if (!options.fromEnv) {
      const credentials = await (credentialsClient ?? makeClient({ ...scope, path: '/ci' }, { env, spawn })).read();
      deploymentEnv = { ...env, CLOUDFLARE_API_TOKEN: credentials.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: credentials.CLOUDFLARE_ACCOUNT_ID };
    }
    deployWorker(root, scope, values, { env: deploymentEnv, spawn });
  }
  if (command === 'run') {
    const result = spawn(child[0], child.slice(1), { cwd: root, env: { ...childEnvironment(env), ...values }, stdio: 'inherit', shell: false });
    if (result.error || result.status !== 0) fail('Child process failed.');
  }
  log(`${command} completed for ${scope.environment}${scope.path}; ${Object.keys(values).length} registered secret(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof SecretError ? error.message : 'Secrets operation failed; diagnostic values were omitted. Check configuration and access.');
    process.exitCode = 1;
  });
}
