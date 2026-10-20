import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { childEnvironment, deployWorker, main, makeClient, rotationPlan, selectSecrets, selectTarget, withSecretsFile, writeLocal } from '../shared/files/scripts/secrets.mjs';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const ROTATION = '22222222-2222-4222-8222-222222222222';
const value = 'fixture-secret-never-real-$()\\n';
const token = 'fixture.access.token';
const config = () => ({
  version: 1, projectId: PROJECT, domain: 'https://vault.example.test',
  targets: {
    local: { environment: 'dev', path: '/app', localFile: '.dev.vars' },
    staging: { environment: 'staging', path: '/app', wranglerEnvironment: 'staging' },
    production: { environment: 'production', path: '/app', wranglerEnvironment: 'production' },
  },
  secrets: { JWT_SESSION_SECRET: { generate: true, rotation: 'migration-required' } },
  rotations: { deploy: { target: 'production', provider: 'cloudflare-api-token', name: 'worker-deploy', path: '/ci' } },
});
function fixture(t, settings = config()) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kitbash-secret-test-'));
  mkdirSync(path.join(root, '.kitbash'));
  writeFileSync(path.join(root, '.kitbash/secrets.json'), JSON.stringify(settings));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const row = (scope, key, secretValue) => ({ workspace: scope.projectId, environment: scope.environment, secretPath: scope.path, type: 'shared', secretKey: key, secretValue });

test('requires exact environment, secure domain, and application-only allowlist', () => {
  const settings = config();
  assert.throws(() => selectTarget(settings), /explicitly/);
  assert.throws(() => selectTarget(settings, 'prod'), /explicitly/);
  assert.throws(() => selectTarget({ ...settings, domain: 'https://attacker:password@vault.example.test' }, 'local'), /HTTPS origin/);
  settings.secrets.CLOUDFLARE_API_TOKEN = { rotation: 'manual' };
  assert.throws(() => selectTarget(settings, 'staging'), /infrastructure/);
});

test('projects only registered runtime keys and rejects incomplete deployments', () => {
  assert.deepEqual({ ...selectSecrets(config(), { JWT_SESSION_SECRET: value, CLOUDFLARE_API_TOKEN: 'infra', INFISICAL_TOKEN: token }) }, { JWT_SESSION_SECRET: value });
  assert.throws(() => selectSecrets(config(), {}), /JWT_SESSION_SECRET/);
});

test('optional secrets may be absent without weakening required secrets', () => {
  const settings = config();
  settings.secrets.OPTIONAL_WEBHOOK_SECRET = { required: false, rotation: 'manual' };
  assert.deepEqual({ ...selectSecrets(settings, { JWT_SESSION_SECRET: value }) }, { JWT_SESSION_SECRET: value });
  assert.throws(() => selectSecrets(settings, { OPTIONAL_WEBHOOK_SECRET: value }), /JWT_SESSION_SECRET/);
});

test('application child loses vault and CI credentials; deploy retains only Cloudflare credentials', () => {
  const env = { PATH: '/bin', INFISICAL_TOKEN: token, INFISICAL_CLIENT_SECRET: value, GITHUB_TOKEN: value, ACTIONS_ID_TOKEN_REQUEST_TOKEN: token, GITSTALK_JOB_TOKEN: token, CLOUDFLARE_API_TOKEN: value };
  assert.deepEqual(childEnvironment(env), { PATH: '/bin' });
  assert.deepEqual(childEnvironment(env, true), { PATH: '/bin', CLOUDFLARE_API_TOKEN: value });
});

test('API reads never expand imports, personal overrides, or other environments', async () => {
  const scope = selectTarget(config(), 'staging');
  const client = makeClient(scope, { env: { INFISICAL_TOKEN: token }, request: async (url, options) => {
    assert.equal(url.origin, 'https://vault.example.test');
    assert.equal(url.searchParams.get('projectId'), PROJECT);
    assert.equal(url.searchParams.get('environment'), 'staging');
    for (const flag of ['recursive', 'includeImports', 'includePersonalOverrides', 'expandSecretReferences']) assert.equal(url.searchParams.get(flag), 'false');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, `Bearer ${token}`);
    return json({ secrets: [row(scope, 'JWT_SESSION_SECRET', value)] });
  } });
  assert.equal((await client.read()).JWT_SESSION_SECRET, value);
  const wrong = makeClient(scope, { env: { INFISICAL_TOKEN: token }, request: async () => json({ secrets: [row({ ...scope, environment: 'production' }, 'JWT_SESSION_SECRET', value)] }) });
  await assert.rejects(wrong.read(), /out-of-scope/);
});

test('provider failure and malformed secret JSON never appear in diagnostics', async () => {
  const scope = selectTarget(config(), 'local');
  for (const request of [async () => new Response(value, { status: 403 }), async () => new Response(`{"secret":"${value}`), async () => { throw new Error(value); }]) {
    const client = makeClient(scope, { env: { INFISICAL_TOKEN: token }, request });
    await assert.rejects(client.read(), error => !error.message.includes(value) && !error.message.includes(token));
  }
});

test('logged-in token is captured, never passed in command arguments', async () => {
  const scope = selectTarget(config(), 'local');
  const client = makeClient(scope, {
    env: {}, spawn: (command, args, options) => {
      assert.equal(command, 'infisical');
      assert.deepEqual(args.slice(0, 4), ['user', 'get', 'token', '--plain']);
      assert.equal(options.stdio[1], 'pipe');
      assert.equal(args.includes(token), false);
      return { status: 0, stdout: `${token}\n` };
    }, request: async () => json({ secrets: [] }),
  });
  await client.read();
});

test('Universal Auth credentials stay in request body and issue a short-lived access token', async () => {
  const calls = [];
  const client = makeClient(selectTarget(config(), 'local'), {
    env: { INFISICAL_CLIENT_ID: 'client-id', INFISICAL_CLIENT_SECRET: value },
    request: async (url, options) => {
      calls.push(url.pathname);
      assert.equal(url.toString().includes(value), false);
      if (url.pathname.endsWith('/login')) {
        assert.equal(JSON.parse(options.body).clientSecret, value);
        return json({ accessToken: token, expiresIn: 600 });
      }
      assert.equal(options.headers.authorization, `Bearer ${token}`);
      return json({ secrets: [] });
    },
  });
  await client.read(); await client.read();
  assert.equal(calls.filter(p => p.endsWith('/login')).length, 1);
});

test('create-only writes use scoped API body, verify readback, and refuse overwrite', async () => {
  const scope = selectTarget(config(), 'local');
  let rows = [];
  let writes = 0;
  const client = makeClient(scope, { env: { INFISICAL_TOKEN: token }, request: async (url, options) => {
    if (options.method === 'POST') {
      writes++;
      assert.equal(url.pathname, '/api/v4/secrets/batch');
      const body = JSON.parse(options.body);
      assert.equal(body.environment, 'dev'); assert.equal(body.secretPath, '/app'); assert.equal(body.projectId, PROJECT);
      rows = body.secrets.map(s => row(scope, s.secretKey, s.secretValue));
    }
    return json({ secrets: rows });
  } });
  await client.create({ JWT_SESSION_SECRET: value });
  assert.equal(writes, 1);
  await assert.rejects(client.create({ JWT_SESSION_SECRET: 'replacement' }), /refuses to replace/);
  assert.equal(writes, 1);
});

test('create detects pending approval and never claims completed import', async () => {
  const client = makeClient(selectTarget(config(), 'local'), { env: { INFISICAL_TOKEN: token }, request: async (_url, options) => options.method === 'POST' ? json({ approval: { id: 'pending' } }) : json({ secrets: [] }) });
  await assert.rejects(client.create({ JWT_SESSION_SECRET: value }), /pending approval/);
});

test('local writes are private, preserve literal values, and refuse unrelated files', t => {
  const root = fixture(t);
  const scope = selectTarget(config(), 'local');
  writeLocal(root, scope, { JWT_SESSION_SECRET: value });
  const file = path.join(root, '.dev.vars');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(parseEnv(readFileSync(file, 'utf8')).JWT_SESSION_SECRET, value);
  writeLocal(root, scope, { JWT_SESSION_SECRET: 'refreshed' });
  assert.equal(parseEnv(readFileSync(file, 'utf8')).JWT_SESSION_SECRET, 'refreshed');
  writeFileSync(file, 'HAND_WRITTEN=yes\n');
  assert.throws(() => writeLocal(root, scope, { JWT_SESSION_SECRET: value }), /not owned/);
  assert.throws(() => writeLocal(root, { ...scope, target: 'production' }, {}), /only accepts/);
});

test('local writes refuse symlinks and ambiguous dotenv quoting', t => {
  const root = fixture(t);
  const scope = selectTarget(config(), 'local');
  const outside = path.join(root, 'outside');
  writeFileSync(outside, 'untouched'); symlinkSync(outside, path.join(root, '.dev.vars'));
  assert.throws(() => writeLocal(root, scope, { JWT_SESSION_SECRET: value }), /not owned/);
  assert.equal(readFileSync(outside, 'utf8'), 'untouched');
  rmSync(path.join(root, '.dev.vars'));
  assert.throws(() => writeLocal(root, scope, { JWT_SESSION_SECRET: "cannot'quote" }), /preserve/);
});

test('temporary secrets file has restrictive modes and is removed on success or failure', () => {
  let file;
  for (const failure of [false, true]) {
    try {
      withSecretsFile({ JWT_SESSION_SECRET: value }, candidate => {
        file = candidate;
        assert.equal(statSync(file).mode & 0o777, 0o600);
        assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
        assert.equal(JSON.parse(readFileSync(file, 'utf8')).JWT_SESSION_SECRET, value);
        if (failure) throw new Error('fixture-failure');
      });
    } catch (error) { assert.equal(error.message, 'fixture-failure'); }
    assert.equal(existsSync(file), false);
  }
});

test('deploy uploads only runtime values with code and never exposes subprocess failure', t => {
  const root = fixture(t);
  const scope = selectTarget(config(), 'staging');
  const env = { CLOUDFLARE_API_TOKEN: 'infra', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) };
  let file;
  deployWorker(root, scope, { JWT_SESSION_SECRET: value }, { env, spawn: (_command, args, options) => {
    assert.equal(args.includes(value), false);
    assert.deepEqual(args.slice(0, 7), ['exec', 'wrangler', 'deploy', '--config', 'wrangler.jsonc', '--env', 'staging']);
    file = args.at(-1);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { JWT_SESSION_SECRET: value });
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
    return { status: 0 };
  } });
  assert.equal(existsSync(file), false);
  assert.throws(() => deployWorker(root, scope, {}, { env, spawn: () => ({ status: 1, stderr: value, stdout: token }) }), error => !error.message.includes(value) && !error.message.includes(token));
});

test('vinext flattened config must match the requested Worker and never receives --env', t => {
  const root = fixture(t);
  const scope = { ...selectTarget(config(), 'production'), flattenedConfig: true, wranglerConfig: 'build.json', workerName: 'fixture-production' };
  const env = { CLOUDFLARE_API_TOKEN: 'infra', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) };
  writeFileSync(path.join(root, 'build.json'), JSON.stringify({ name: 'fixture-staging' }));
  assert.throws(() => deployWorker(root, scope, {}, { env, spawn: () => assert.fail() }), /does not match/);
  writeFileSync(path.join(root, 'build.json'), JSON.stringify({ name: 'fixture-production' }));
  deployWorker(root, scope, {}, { env, spawn: (_command, args) => { assert.equal(args.includes('--env'), false); return { status: 0 }; } });
});

test('rotation excludes static signing keys and cross-environment provider aliases', () => {
  assert.throws(() => rotationPlan(config(), 'production', 'JWT_SESSION_SECRET'), /migration/);
  assert.throws(() => rotationPlan(config(), 'staging', 'deploy'), /this environment/);
  assert.equal(rotationPlan(config(), 'production', 'deploy').rotation.provider, 'cloudflare-api-token');
});

test('provider rotation is scoped, verifies remote metadata, and only requests configured provider rotation', async () => {
  const settings = config();
  const { scope, rotation } = rotationPlan(settings, 'production', 'deploy');
  const calls = [];
  let remoteEnv = 'staging';
  const client = makeClient(scope, { env: { INFISICAL_TOKEN: token }, request: async (url, options) => {
    calls.push([url.pathname, options.method]);
    if (options.method === 'GET') {
      assert.equal(url.searchParams.get('environment'), 'production');
      assert.equal(url.searchParams.get('secretPath'), '/ci');
      return json({ secretRotation: { id: ROTATION, projectId: PROJECT, environment: { slug: remoteEnv }, folder: { path: '/ci' } } });
    }
    assert.equal(url.pathname, `/api/v2/secret-rotations/cloudflare-api-token/${ROTATION}/rotate-secrets`);
    return json({ secretRotation: { rotationStatus: 'pending' } });
  } });
  await assert.rejects(client.rotate(rotation), /does not match/);
  assert.equal(calls.length, 1);
  remoteEnv = 'production';
  await client.rotate(rotation);
  assert.equal(calls.at(-1)[1], 'POST');
});

test('CLI rejects unexpected imported names before provider writes and generates without printing values', async t => {
  const root = fixture(t);
  const logs = [];
  const writes = [];
  const client = { create: async values => writes.push(values) };
  await assert.rejects(main(['import', '--env', 'local'], { root, client, input: () => JSON.stringify({ UNREGISTERED: value }), log: s => logs.push(s) }), /unregistered/);
  assert.equal(writes.length, 0);
  await main(['generate', 'JWT_SESSION_SECRET', '--env', 'local'], { root, client, log: s => logs.push(s) });
  assert.equal(Buffer.from(writes[0].JWT_SESSION_SECRET, 'base64url').length, 32);
  assert.equal(logs.join('').includes(writes[0].JWT_SESSION_SECRET), false);
});

test('rotation plan makes no provider calls until --execute', async t => {
  const root = fixture(t);
  const calls = [];
  const logs = [];
  const client = { rotate: async rotation => calls.push(rotation) };
  await main(['rotate', 'deploy', '--env', 'production'], { root, client, log: value => logs.push(value) });
  assert.equal(calls.length, 0);
  assert.equal(JSON.parse(logs[0]).execute, false);
  await main(['rotate', 'deploy', '--env', 'production', '--execute'], { root, client, log: () => {} });
  assert.equal(calls.length, 1);
});

test('run injects only application secrets and strips authentication from child process', async t => {
  const root = fixture(t);
  let called = false;
  await main(['run', '--env', 'local', '--', 'cargo', 'run'], {
    root, env: { PATH: '/bin', INFISICAL_TOKEN: token, CLOUDFLARE_API_TOKEN: value }, log: () => {},
    client: { read: async () => ({ JWT_SESSION_SECRET: value }) },
    spawn: (command, args, options) => {
      called = true;
      assert.equal(command, 'cargo'); assert.deepEqual(args, ['run']);
      assert.deepEqual(options.env, { PATH: '/bin', JWT_SESSION_SECRET: value });
      return { status: 0 };
    },
  });
  assert.equal(called, true);
});

test('recipe ships the exact tested shared secrets helper', () => {
  assert.equal(readFileSync(new URL('../../recipes/cloudflare-ci/scripts/secrets.mjs', import.meta.url), 'utf8'), readFileSync(new URL('../shared/files/scripts/secrets.mjs', import.meta.url), 'utf8'));
});

test('pnpm run deploy dispatches the generated package script rather than pnpm workspace deploy', t => {
  const root = fixture(t);
  mkdirSync(path.join(root, 'scripts'));
  writeFileSync(path.join(root, 'package.json'), readFileSync(new URL('../worker/files/package.json', import.meta.url)));
  writeFileSync(path.join(root, 'scripts/secrets.mjs'), readFileSync(new URL('../shared/files/scripts/secrets.mjs', import.meta.url)));
  const result = spawnSync('pnpm', ['run', 'deploy', '--help'], {
    cwd: root, encoding: 'utf8', shell: false, timeout: 30_000,
    env: childEnvironment(process.env),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: secrets\.mjs/);
  assert.doesNotMatch(result.stderr, /Unknown options/);
});
