import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateConfig, authorize } from '../src/config.mjs';
import { registerSecrets, registeredConfig, validateRegistration } from '../src/registration.mjs';

const token = 'fixture-registration-token-01234567890123456789';
const secondToken = 'fixture-second-registration-token-01234567890123456789';
const digest = value => createHash('sha256').update(value).digest('hex');
const policy = () => ({ version: 1, projects: {}, principals: [{ id: 'grok-bot', tokenSha256: digest(token), grants: [],
  registration: { accountId: 'a'.repeat(32), storeId: 'b'.repeat(32), secretPrefix: 'MCP_GROK_', targets: ['staging', 'production'] } }] });
const input = { project: 'enginebox', target: 'staging', secrets: [{ name: 'WEBHOOK_SECRET', generate: true }] };

test('Cloudflare template starts with registration authority and no hardcoded application projects', () => {
  const template = validateConfig(JSON.parse(readFileSync(new URL('../policy.cloudflare.example.json', import.meta.url), 'utf8')));
  assert.deepEqual(template.projects, {});
  assert.deepEqual(template.principals[0].grants, []);
  assert.deepEqual(template.principals[0].registration.targets, ['staging', 'production']);
});

test('registration is additive and idempotent, never edits an existing rule or accepts a value', () => {
  const config = validateConfig(policy());
  const empty = registerSecrets(config, token, { ...input, secrets: [] });
  assert.equal(empty.output.status, 'registered');
  assert.deepEqual(empty.output.bindings, []);
  assert.equal(registerSecrets(config, token, { ...input, secrets: [] }, empty.record).output.status, 'already-registered');
  const first = registerSecrets(config, token, input);
  assert.equal(first.output.status, 'registered');
  assert.equal(registerSecrets(config, token, input, first.record).output.status, 'already-registered');
  const second = registerSecrets(config, token, { ...input, secrets: [{ name: 'APP_CLIENT_SECRET', generate: false }] }, first.record);
  assert.deepEqual(Object.keys(second.record.secrets), ['WEBHOOK_SECRET', 'APP_CLIENT_SECRET']);
  assert.deepEqual(Object.keys(first.record.secrets), ['WEBHOOK_SECRET']);
  assert.throws(() => registerSecrets(config, token, { ...input, secrets: [{ ...input.secrets[0], generate: false }] }, first.record), /conflict/);
  for (const bad of [
    { ...input, token: 'do-not-accept' }, { ...input, secretPrefix: 'OTHER_' },
    { ...input, secrets: [{ ...input.secrets[0], value: 'do-not-accept' }] },
    { ...input, secrets: [{ name: 'GITHUB_TOKEN', generate: true }] },
    { ...input, secrets: [{ name: 'CLIENT_SECRET', generate: false, bytes: 32 }] },
    { ...input, secrets: [input.secrets[0], input.secrets[0]] },
  ]) assert.throws(() => validateRegistration(bad), /invalid_request/);
});

test('operator authority bounds the destination and operations, and revocation takes effect', () => {
  const config = validateConfig(policy());
  const { record } = registerSecrets(config, token, input);
  const effective = registeredConfig(config, token, input, record);
  assert.equal(authorize(effective, token, { ...input, operation: 'generate' }), 'grok-bot');
  assert.throws(() => authorize(effective, token, { ...input, operation: 'provision-github' }), /forbidden/);
  assert.throws(() => registerSecrets(config, token, { ...input, target: 'local' }), /forbidden/);
  config.principals[0].registration.storeId = 'c'.repeat(32);
  assert.throws(() => registeredConfig(config, token, input, record), /conflict/);
  delete config.principals[0].registration;
  assert.throws(() => registeredConfig(config, token, input, record), /forbidden/);
});

test('namespaces isolate projects, targets and principals, surviving token rotation by principal ID', () => {
  const config = policy();
  config.principals.push({ id: 'second-bot', tokenSha256: digest(secondToken), grants: [],
    registration: { ...config.principals[0].registration, secretPrefix: 'MCP_SECOND_' } });
  validateConfig(config);
  const { record } = registerSecrets(config, token, input);
  const others = [
    registerSecrets(config, token, { ...input, project: 'enginebox-other' }).record,
    registerSecrets(config, token, { ...input, target: 'production' }).record,
    registerSecrets(config, secondToken, input).record,
  ];
  assert.equal(new Set([record, ...others].map(row => row.secretPrefix)).size, 4);
  assert.throws(() => registeredConfig(config, secondToken, input, record), /conflict/);
  const rotatedToken = 'fixture-rotated-registration-token-01234567890123456789';
  config.principals[0].tokenSha256 = digest(rotatedToken);
  assert.doesNotThrow(() => registeredConfig(config, rotatedToken, input, record));
  assert.throws(() => registeredConfig(config, token, input, record), /forbidden/);
});

test('operator policy rejects overlapping destinations and duplicate principal IDs', () => {
  const config = policy();
  const { record } = registerSecrets(config, token, input);
  config.projects = registeredConfig(config, token, input, record).projects;
  assert.throws(() => validateConfig(config), /invalid_request/);
  assert.throws(() => registerSecrets(config, token, input), /forbidden/);
  delete config.projects.enginebox;
  config.principals.push({ ...config.principals[0], tokenSha256: digest(secondToken) });
  assert.throws(() => validateConfig(config), /invalid_request/);
  config.principals[1].id = 'second-bot';
  assert.throws(() => validateConfig(config), /invalid_request/);
});
