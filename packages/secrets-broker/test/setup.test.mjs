import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, readdir, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setup, remoteKeyExists } from '../scripts/setup.mjs';
import { deploy, deploymentSettings, readLocalEnv, writeDeploymentConfig } from '../scripts/deployment.mjs';
import { BOOTSTRAP_TOKEN, DEPLOY_TOKEN, setupProviders } from './helpers/setup-providers.mjs';
import { parseEnrollment } from '../scripts/enroll-controller.mjs';

test('controller enrollment rejects shell input, unexpected options and invalid destinations', () => {
  const args = ['--ssh', 'controller-host', '--directory', '/opt/kitbash', '--project', 'enginebox', '--target', 'production',
    '--integration', 'enginebox-runners', '--owner', 'test-org', '--kind', 'runners', '--prefix', 'ENGINEBOX_GITHUB_RUNNERS'];
  assert.equal(parseEnrollment(args).integration, 'enginebox-runners');
  for (const value of ['-oProxyCommand=evil', 'host;id', 'host$(id)', 'host\ncommand']) assert.throws(() => parseEnrollment(args.with(1, value)));
  for (const value of ['relative', '/opt/../etc', '/opt/path with spaces']) assert.throws(() => parseEnrollment(args.with(3, value)));
  assert.throws(() => parseEnrollment(['xxssh', ...args.slice(1)]));
  assert.throws(() => parseEnrollment([...args, '--url', 'https://elsewhere.test']));
  assert.throws(() => parseEnrollment([...args, '--ssh', 'another-host']));
});

test('deployment and repeat setup retain only explicitly configured delivery bindings', async t => {
  const f = await fixture(t);
  const bindings = [{ binding: 'KIT_DELIVERY_0123456789ABCDEF', store_id: 'a'.repeat(32), secret_name: 'MCP_FIXTURE_WEBHOOK_SECRET' }];
  f.supplied.KIT_BROKER_SECRET_BINDINGS = JSON.stringify(bindings);
  const result = await setup(f.opts);
  assert.deepEqual(JSON.parse(await readFile(result.config, 'utf8')).secrets_store_secrets, bindings);
  assert.equal((await readLocalEnv(f.root)).KIT_BROKER_SECRET_BINDINGS, JSON.stringify(bindings));
  const file = await writeDeploymentConfig(await readLocalEnv(f.root), { root: f.root });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).secrets_store_secrets, bindings);
  for (const bad of [[...bindings, ...bindings], [{ ...bindings[0], value: 'secret' }], [{ ...bindings[0], binding: 'ARBITRARY' }], [{ ...bindings[0], store_id: 'invalid' }]]) {
    await assert.rejects(writeDeploymentConfig({ ...f.supplied, KIT_BROKER_SECRET_BINDINGS: JSON.stringify(bad) }, { root: f.root }), /binding configuration/);
  }
});

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'kitbash-setup-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const supplied = {
    KIT_BROKER_HOSTNAME: 'secrets.example.test', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    KIT_BROKER_WORKER_NAME: 'example-broker', KIT_BROKER_PRINCIPAL: 'grok-bot',
    KIT_BROKER_GITHUB_REPOSITORY: 'test-org/template-copy', KIT_BROKER_GITHUB_ENVIRONMENT: 'production',
    KIT_BROKER_POLICY_FILE: 'broker.policy.json',
    KIT_BROKER_CI_PROVIDER: 'infisical',
    CLOUDFLARE_TOKEN_PROVISIONING_TOKEN: BOOTSTRAP_TOKEN, INFISICAL_TOKEN: 'fixture.vault.token', GH_TOKEN: 'fixture-github-private-token',
  };
  const policy = { version: 1, projects: { app: {
    projectId: '12345678-1234-4123-8123-123456789abc', projectSlug: 'app', domain: 'https://vault.example.test',
    secrets: { SESSION_SECRET: { generate: true, rotation: 'manual' } }, targets: { staging: { environment: 'staging', secretPath: '/app' } },
  } }, principals: [{ id: 'grok-bot', tokenSha256: '0'.repeat(64), grants: [{ project: 'app', targets: ['staging'], operations: ['status', 'presence', 'generate'] }] }] };
  await writeFile(path.join(root, 'broker.policy.json'), JSON.stringify(policy));
  const events = [], output = [], deployments = [];
  const { request, modes: mode, calls, records } = setupProviders();
  const runner = async (command, args, options = {}) => {
    events.push({ command, args, input: options.input });
    if (command === 'pnpm') {
      const file = args[args.indexOf('--secrets-file') + 1];
      deployments.push({ secrets: JSON.parse(await readFile(file, 'utf8')), file,
        config: JSON.parse(await readFile(args[args.indexOf('--config') + 1], 'utf8')), env: options.env });
      if (mode.failDeploy) throw new Error(options.failure);
      mode.remote = true;
    }
    return '';
  };
  const opts = { root, supplied, request, runner, note: message => events.push({ note: message }), print: value => output.push(value) };
  return { ...opts, opts, mode, policy, events, output, deployments, calls, records };
}

test('template setup deploys only a strong key digest and prints standard MCP JSON; reruns warn and rotate', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, '.env'), 'UNRELATED_SETTING=keep-me\n');
  const first = await setup(f.opts);
  const mcp = JSON.parse(f.output[0]).mcpServers.kitbash_secrets;
  const token = mcp.headers.Authorization.slice(7);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(mcp.url, 'https://secrets.example.test/mcp');
  assert.equal(mcp.type, 'http');
  const deployed = f.deployments[0];
  assert.equal(deployed.secrets.KIT_BROKER_TOKEN_SHA256, createHash('sha256').update(token).digest('hex'));
  assert.equal(JSON.parse(deployed.secrets.KIT_BROKER_POLICY).principals[0].tokenSha256, deployed.secrets.KIT_BROKER_TOKEN_SHA256);
  assert.equal(JSON.stringify(deployed).includes(token), false);
  assert.deepEqual(deployed.config.routes, [{ pattern: 'secrets.example.test', custom_domain: true }]);
  assert.equal(deployed.config.vars.KIT_BROKER_PUBLIC_ORIGIN, 'https://secrets.example.test');
  assert.equal(deployed.config.account_id, f.supplied.CLOUDFLARE_ACCOUNT_ID);
  assert.equal(deployed.env.INFISICAL_TOKEN, undefined);
  assert.equal(deployed.secrets.CLOUDFLARE_API_TOKEN, '');
  assert.equal(f.calls.some(call => call.options.method === 'PUT'), false, 'existing environment protections must be preserved');
  assert.equal(f.events.some(event => event.args?.[0] === 'secret'), false, 'no GitHub deployment secret is written');
  assert.equal(JSON.stringify(f.events).includes(DEPLOY_TOKEN), false);
  assert.equal(JSON.stringify(f.events).includes(BOOTSTRAP_TOKEN), false);
  assert.equal(deployed.env.CLOUDFLARE_API_TOKEN, DEPLOY_TOKEN);
  assert.ok(f.events.find(event => event.args?.[2] === 'KIT_BROKER_HOSTNAME' && event.args.at(-1) === f.supplied.KIT_BROKER_HOSTNAME));
  const local = await readLocalEnv(f.root);
  assert.equal(local.UNRELATED_SETTING, 'keep-me');
  assert.equal(local.KIT_BROKER_HOSTNAME, f.supplied.KIT_BROKER_HOSTNAME);
  assert.equal(local.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(local.CLOUDFLARE_TOKEN_PROVISIONING_TOKEN, undefined);
  assert.equal(JSON.stringify(local).includes(token), false);
  for (const file of [first.recovery, first.config, path.join(f.root, '.env'), path.join(f.root, '.kitbash/mcp.json')]) assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(path.join(f.root, '.kitbash'))).mode & 0o777, 0o700);
  assert.equal((await readdir(path.join(f.root, '.kitbash'))).some(name => name.startsWith('deploy-secrets-')), false);
  delete f.supplied.CLOUDFLARE_TOKEN_PROVISIONING_TOKEN;
  await setup(f.opts);
  const secondToken = JSON.parse(f.output[1]).mcpServers.kitbash_secrets.headers.Authorization.slice(7);
  assert.notEqual(secondToken, token);
  const warning = f.events.findIndex(event => event.note?.includes('existing remote broker key will be replaced'));
  const secondDeploy = f.events.findLastIndex(event => event.command === 'pnpm');
  assert.ok(warning > 0 && warning < secondDeploy);
  assert.equal(JSON.stringify(f.events).includes(token), false);
  assert.equal(f.records.tokens.length, 1, 'rerun reuses the Cloudflare token');
  assert.equal(Object.keys(f.records.identities).length, 2, 'rerun reuses both OIDC identities');
  const checkpoint = await readFile(path.join(f.root, '.kitbash/setup-state.json'), 'utf8');
  assert.equal(checkpoint.includes(DEPLOY_TOKEN), false);
  assert.equal(checkpoint.includes(BOOTSTRAP_TOKEN), false);
});

test('remote access errors and unclassified 404s stop before generating or rotating a credential', async t => {
  for (const mode of ['denied', 'unknown404']) {
    const f = await fixture(t);
    f.mode[mode] = true;
    await assert.rejects(setup(f.opts), /Cannot inspect remote Worker secrets/);
    assert.equal(f.deployments.length, 0);
    assert.equal(f.output.length, 0);
    assert.equal((await readdir(path.join(f.root, '.kitbash'))).some(name => name.startsWith('mcp')), false);
  }
});

test('ambiguous deployment failure keeps private recovery JSON and deletes the provider credential bundle', async t => {
  const f = await fixture(t);
  f.mode.failDeploy = true;
  await assert.rejects(setup(f.opts), /key may already have changed/);
  assert.equal(f.output.length, 0);
  const files = await readdir(path.join(f.root, '.kitbash'));
  assert.equal(files.filter(name => /^mcp-.*\.json$/.test(name)).length, 1);
  assert.equal(files.some(name => name.startsWith('deploy-secrets-')), false);
  assert.equal(files.includes('mcp.json'), false);
  assert.equal(f.events.some(event => event.args?.[2] === 'KIT_BROKER_CONFIGURED'), false);
});

test('CI regenerates the same hostname configuration and never issues or uploads broker keys', async t => {
  const f = await fixture(t);
  const config = await writeDeploymentConfig(f.supplied, { root: f.root });
  let seen;
  await deploy({ env: f.supplied, config, runner: async (command, args) => { seen = { command, args }; } });
  assert.equal(seen.command, 'pnpm');
  assert.equal(seen.args.includes('--secrets-file'), false);
  assert.deepEqual(JSON.parse(await readFile(config, 'utf8')).routes, [{ pattern: f.supplied.KIT_BROKER_HOSTNAME, custom_domain: true }]);
  assert.equal(JSON.parse(await readFile(config, 'utf8')).keep_vars, true, 'normal Wrangler deploy must retain remote secret bindings');
  await assert.rejects(setup({ ...f.opts, supplied: { ...f.supplied, CI: 'true' } }), /own terminal/);
});

test('missing GitHub environment is created and unattended policy creation requires a real project ID', async t => {
  const f = await fixture(t);
  f.mode.githubEnvironment = false;
  await setup(f.opts);
  assert.equal(f.calls.filter(call => call.options.method === 'PUT').length, 1);
  await rm(path.join(f.root, 'broker.policy.json'));
  await assert.rejects(setup(f.opts), /Existing Infisical project ID/);
});

test('invalid hostnames and symlinked private output paths are rejected', async t => {
  const f = await fixture(t);
  for (const hostname of ['https://example.test', 'example.test/path', '*.example.test', 'example.test:443', '127.0.0.1', 'example.test\nTOKEN=x']) {
    assert.throws(() => deploymentSettings({ ...f.supplied, KIT_BROKER_HOSTNAME: hostname }), /hostname/);
  }
  await symlink(tmpdir(), path.join(f.root, '.kitbash'));
  await assert.rejects(writeDeploymentConfig(f.supplied, { root: f.root }), /real directory/);
  await assert.rejects(remoteKeyExists(f.supplied, 'fixture', async () => Response.json({ success: true, result: [{}] })), /Cannot inspect/);
});

test('first interactive setup creates the selected Infisical policy and hides credential prompts', async t => {
  const f = await fixture(t);
  await rm(path.join(f.root, 'broker.policy.json'));
  const prompts = [];
  const opened = [];
  delete f.supplied.CLOUDFLARE_TOKEN_PROVISIONING_TOKEN;
  await setup({ ...f.opts, openBrowser: async url => opened.push(url), ask: async (label, value, secret) => {
    prompts.push({ label, secret });
    if (label === 'Existing Infisical project ID') return f.policy.projects.app.projectId;
    if (label === 'Application project alias') return 'template-app';
    if (label === 'Infisical origin') return f.policy.projects.app.domain;
    if (label.startsWith('Cloudflare setup token')) return BOOTSTRAP_TOKEN;
    return value;
  } });
  const local = JSON.parse(await readFile(path.join(f.root, 'broker.policy.json'), 'utf8'));
  assert.equal(local.projects['template-app'].projectId, f.policy.projects.app.projectId);
  assert.deepEqual(local.projects['template-app'].targets.staging, { environment: 'staging', secretPath: '/app' });
  assert.deepEqual(local.principals[0].grants[0].operations, ['setup', 'status', 'presence', 'generate']);
  assert.equal(prompts.filter(prompt => prompt.secret).length, 2);
  assert.equal(new URL(opened[0]).origin, 'https://dash.cloudflare.com');
  assert.deepEqual(JSON.parse(new URL(opened[0]).searchParams.get('permissionGroupKeys')), [
    { key: 'account_api_tokens', type: 'edit' }, { key: 'zone', type: 'read' },
  ]);
  assert.equal(f.deployments.length, 1);
  assert.equal((await stat(path.join(f.root, 'broker.policy.json'))).mode & 0o777, 0o600);
});

test('broker CI identities bind exact event, repository IDs, branch, workflow, environment and folder', async t => {
  const f = await fixture(t);
  await setup(f.opts);
  assert.equal(Object.keys(f.records.oidc).length, 2);
  assert.deepEqual(Object.values(f.records.oidc).map(auth => auth.boundClaims.event_name).sort(), ['push', 'workflow_dispatch']);
  for (const auth of Object.values(f.records.oidc)) {
    assert.deepEqual(auth.boundClaims, {
      repository: 'test-org/template-copy', repository_id: '123', repository_owner_id: '456',
      ref: 'refs/heads/main', workflow_ref: 'test-org/template-copy/.github/workflows/deploy-broker.yml@refs/heads/main',
      environment: 'production', event_name: auth.boundClaims.event_name,
    });
    assert.equal(auth.accessTokenTTL, 900);
    assert.equal(auth.boundAudiences, 'kitbash:broker:test-org/template-copy:production');
  }
  for (const role of Object.values(f.records.roles)) assert.deepEqual(role.permissions, [{
    subject: 'secrets', action: ['describeSecret', 'readValue'],
    conditions: { environment: { $eq: 'production' }, secretPath: { $eq: '/ci/example-broker' } },
  }]);
  assert.notEqual(f.records.variables.INFISICAL_PUSH_IDENTITY_ID.value, f.records.variables.INFISICAL_DISPATCH_IDENTITY_ID.value);
  assert.equal(f.records.variables.INFISICAL_SECRET_PATH.value, '/ci/example-broker');
  Object.values(f.records.oidc)[0].boundClaims.event_name = 'pull_request';
  await assert.rejects(setup(f.opts), /provision_oidc_mismatch/);
  assert.equal(f.deployments.length, 1, 'OIDC drift must block a new deployment');
});

test('noninteractive setup requires a bootstrap credential only for the first token and keeps it out of all local files', async t => {
  const f = await fixture(t);
  delete f.supplied.CLOUDFLARE_TOKEN_PROVISIONING_TOKEN;
  await assert.rejects(setup(f.opts), /Cloudflare setup token/);
  assert.equal(f.records.tokens.length, 0);
  assert.equal(f.deployments.length, 0);
  f.supplied.CLOUDFLARE_TOKEN_PROVISIONING_TOKEN = BOOTSTRAP_TOKEN;
  await setup(f.opts);
  assert.equal(Object.keys(f.records.identities).length, 2);
  for (const file of ['.env', '.kitbash/setup-state.json']) {
    const text = await readFile(path.join(f.root, file), 'utf8');
    assert.equal(text.includes(BOOTSTRAP_TOKEN), false);
    assert.equal(text.includes(DEPLOY_TOKEN), false);
  }
});

test('operator Infisical provisioning credentials are kept separate from deployed broker credentials', async t => {
  const f = await fixture(t);
  f.supplied.KIT_SETUP_INFISICAL_TOKEN = 'setup.identity.fixture';
  await setup(f.opts);
  assert.equal(f.calls.filter(call => call.url.startsWith('https://vault.example.test')).every(call => call.options.headers.authorization === 'Bearer setup.identity.fixture'), true);
  assert.equal(JSON.stringify(f.deployments).includes('setup.identity.fixture'), false);
  assert.equal(f.deployments[0].secrets.INFISICAL_TOKEN, 'fixture.vault.token');
});

test('local-only setup deploys through Wrangler without GitHub authentication, CI identities, or token creation', async t => {
  const f = await fixture(t);
  delete f.supplied.GH_TOKEN;
  delete f.supplied.CLOUDFLARE_TOKEN_PROVISIONING_TOKEN;
  await setup({ ...f.opts, skipCI: true, runner: async (command, args, options) => {
    if (command === 'pnpm' && args.includes('auth')) return JSON.stringify({ token: 'local_wrangler_fixture_token' });
    assert.notEqual(command, 'gh');
    return f.opts.runner(command, args, options);
  } });
  assert.equal(f.deployments.length, 1);
  assert.equal(f.deployments[0].env.CLOUDFLARE_API_TOKEN, undefined, 'deploy uses the saved local Wrangler login');
  assert.equal(f.calls.some(call => call.url.startsWith('https://api.github.com')), false);
  assert.equal(f.calls.some(call => call.url.startsWith('https://vault.example.test')), false);
  assert.equal(f.records.tokens.length, 0);
  assert.equal(Object.keys(f.records.identities).length, 0);
  assert.equal(f.output.length, 1);
});

test('default setup uses organization deployment credentials without provisioning any Infisical CI identities', async t => {
  const f = await fixture(t);
  delete f.supplied.KIT_BROKER_CI_PROVIDER;
  let secret, account;
  const secretWrites = [];
  await setup({ ...f.opts,
    request: (url, options) => {
      const p = new URL(url).pathname;
      if (p === '/repos/test-org/template-copy') return Response.json({ full_name: 'test-org/template-copy', private: true, owner: { type: 'Organization' } });
      if (p === '/orgs/test-org') return Response.json({ login: 'test-org', plan: { name: 'team' } });
      if (p.startsWith('/orgs/test-org/actions/')) {
        const row = p.includes('/secrets/') ? secret : account;
        return row ? Response.json(row) : Response.json({}, { status: 404 });
      }
      return f.opts.request(url, options);
    },
    runner: (command, args, options) => {
      if (command === 'gh' && args[0] === 'secret') {
        assert.equal(options.input, DEPLOY_TOKEN);
        secretWrites.push(args);
        secret = { name: 'CLOUDFLARE_API_TOKEN', visibility: 'private' };
        return '';
      }
      if (command === 'gh' && args[0] === 'variable' && args.includes('--org')) {
        account = { name: 'CLOUDFLARE_ACCOUNT_ID', value: args.at(-1), visibility: 'private' };
        return '';
      }
      return f.opts.runner(command, args, options);
    },
  });
  assert.equal(secretWrites.length, 1);
  assert.equal(f.deployments.length, 1);
  assert.equal(Object.keys(f.records.identities).length, 0);
  assert.equal(f.calls.some(call => call.url.startsWith('https://vault.example.test')), false);
  assert.equal(f.events.some(event => event.args?.[2] === 'CLOUDFLARE_ACCOUNT_ID' && event.args.includes('--env')), false);
  assert.equal((await readLocalEnv(f.root)).KIT_BROKER_CI_PROVIDER, 'github');
});

test('Cloudflare storage setup deploys its runtime credential without requiring any Infisical identity', async t => {
  const f = await fixture(t);
  f.policy.projects.app = {
    backend: 'cloudflare-secrets-store', accountId: f.supplied.CLOUDFLARE_ACCOUNT_ID, storeId: 'b'.repeat(32),
    secrets: f.policy.projects.app.secrets, targets: { staging: { secretPrefix: 'APP_STAGING_' } },
  };
  await writeFile(path.join(f.root, 'broker.policy.json'), JSON.stringify(f.policy));
  delete f.supplied.INFISICAL_TOKEN;
  f.supplied.KIT_BROKER_CI_PROVIDER = 'github';
  f.supplied.CLOUDFLARE_API_TOKEN = DEPLOY_TOKEN;
  f.supplied.KIT_BROKER_SECRETS_API_TOKEN = 'cfat_fixture_runtime_store_token';
  await setup({ ...f.opts, skipCI: true });
  assert.equal(f.deployments.length, 1);
  assert.equal(f.deployments[0].secrets.KIT_BROKER_SECRETS_API_TOKEN, f.supplied.KIT_BROKER_SECRETS_API_TOKEN);
  assert.equal(f.deployments[0].secrets.INFISICAL_CLIENT_SECRET, '');
  assert.equal(f.deployments[0].secrets.INFISICAL_TOKEN, '');
  assert.equal(f.deployments[0].env.KIT_BROKER_SECRETS_API_TOKEN, undefined);
  assert.equal(f.output[0].includes(f.supplied.KIT_BROKER_SECRETS_API_TOKEN), false);
});

test('registration-only setup deploys its store credential with no static projects or Infisical identity', async t => {
  const f = await fixture(t);
  f.policy.projects = {};
  f.policy.principals[0].grants = [];
  f.policy.principals[0].registration = { accountId: f.supplied.CLOUDFLARE_ACCOUNT_ID, storeId: 'b'.repeat(32), secretPrefix: 'MCP_GROK_', targets: ['staging', 'production'] };
  await writeFile(path.join(f.root, 'broker.policy.json'), JSON.stringify(f.policy));
  delete f.supplied.INFISICAL_TOKEN;
  f.supplied.KIT_BROKER_CI_PROVIDER = 'github';
  f.supplied.CLOUDFLARE_API_TOKEN = DEPLOY_TOKEN;
  f.supplied.KIT_BROKER_SECRETS_API_TOKEN = 'cfat_fixture_runtime_store_token';
  await setup({ ...f.opts, skipCI: true });
  assert.equal(f.deployments[0].secrets.KIT_BROKER_SECRETS_API_TOKEN, f.supplied.KIT_BROKER_SECRETS_API_TOKEN);
  assert.equal(f.deployments[0].secrets.INFISICAL_TOKEN, '');
  assert.equal(f.output[0].includes(f.supplied.KIT_BROKER_SECRETS_API_TOKEN), false);
});
