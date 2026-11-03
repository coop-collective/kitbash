import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureGitHubCI } from '../scripts/github-ci.mjs';
import { ACCOUNT, BOOTSTRAP_TOKEN, DEPLOY_TOKEN, setupProviders } from './helpers/setup-providers.mjs';

function fixture() {
  const cf = setupProviders();
  const records = { secret: undefined, account: undefined, events: [], notes: [], state: {} };
  const env = { KIT_BROKER_GITHUB_REPOSITORY: 'test-org/template-copy', CLOUDFLARE_TOKEN_PROVISIONING_TOKEN: BOOTSTRAP_TOKEN };
  const settings = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, KIT_BROKER_HOSTNAME: 'secrets.example.test', KIT_BROKER_WORKER_NAME: 'example-broker' };
  const request = async (url, options) => {
    const u = new URL(url);
    if (u.origin === 'https://api.cloudflare.com') return cf.request(url, options);
    if (u.pathname === '/repos/test-org/template-copy') return Response.json({ full_name: 'test-org/template-copy', private: true, owner: { type: 'Organization' } });
    if (u.pathname === '/orgs/test-org') return Response.json({ login: 'test-org', plan: { name: 'team' } });
    const row = u.pathname.includes('/secrets/') ? records.secret : records.account;
    return row ? Response.json(row) : Response.json({}, { status: 404 });
  };
  const runner = async (command, args, options) => {
    records.events.push({ command, args });
    if (command === 'pnpm') return JSON.stringify({ token: 'local_wrangler_oauth.' + 'a'.repeat(300) });
    if (args[0] === 'secret') {
      assert.equal(options.input, DEPLOY_TOKEN);
      assert.equal(args.includes(DEPLOY_TOKEN), false);
      records.secret = { name: 'CLOUDFLARE_API_TOKEN', visibility: 'private' };
      if (records.loseWriteResponse) throw new Error('GitHub response lost');
    } else records.account = { name: 'CLOUDFLARE_ACCOUNT_ID', visibility: 'private', value: args.at(-1) };
    return '';
  };
  const opts = { env, settings, request, runner, ghToken: 'fixture-github-token',
    ask: () => { throw new Error('Unexpected prompt'); }, note: line => records.notes.push(line),
    checkpoint: () => ({ state: records.state, save: async () => {} }),
  };
  return { opts, cf, records };
}

test('organization CI creates only a deployment secret and account variable; repeat setup reuses them via local Wrangler login', async () => {
  const { opts, records, cf } = fixture();
  const first = await configureGitHubCI(opts);
  assert.equal(first.token, DEPLOY_TOKEN);
  assert.equal(first.useLocalLogin, false);
  assert.deepEqual(records.events.map(e => e.args.slice(0, 3)), [['secret', 'set', 'CLOUDFLARE_API_TOKEN'], ['variable', 'set', 'CLOUDFLARE_ACCOUNT_ID']]);
  for (const event of records.events) assert.ok(event.args.includes('--org') && event.args.includes('private'));
  assert.equal(records.state.configured, true);
  assert.equal(JSON.stringify(records).includes(DEPLOY_TOKEN), false);
  assert.equal(JSON.stringify(records).includes(BOOTSTRAP_TOKEN), false);
  assert.equal(cf.calls.some(c => c.url.includes('infisical')), false);
  delete opts.env.CLOUDFLARE_TOKEN_PROVISIONING_TOKEN;
  const second = await configureGitHubCI(opts);
  assert.equal(second.useLocalLogin, true);
  assert.equal(cf.records.tokens.length, 1);
  assert.equal(records.events.filter(e => e.args[0] === 'secret').length, 1);
});

test('existing organization credentials are never silently overwritten or broadened', async () => {
  for (const change of ['public', 'account', 'missing-account']) {
    const f = fixture();
    f.records.secret = { name: 'CLOUDFLARE_API_TOKEN', visibility: change === 'public' ? 'all' : 'private' };
    f.records.account = change === 'missing-account' ? undefined : { value: change === 'account' ? 'f'.repeat(32) : ACCOUNT, visibility: 'private' };
    await assert.rejects(configureGitHubCI(f.opts), /existing|exists/);
    assert.equal(f.records.events.length, 0);
    assert.equal(f.cf.records.tokens.length, 0);
  }
});

test('a lost organization secret write stops retries without minting another token', async () => {
  const f = fixture();
  f.records.loseWriteResponse = true;
  await assert.rejects(configureGitHubCI(f.opts), /response lost/);
  assert.equal(f.records.state.pending, 'github-secret');
  assert.ok(f.records.state.tokenId);
  await assert.rejects(configureGitHubCI(f.opts), /reconciliation/);
  assert.equal(f.cf.records.tokens.length, 1);
});

test('an existing supplied deployment token goes straight to the private organization secret without creating tokens', async () => {
  const f = fixture();
  f.opts.env.CLOUDFLARE_API_TOKEN = DEPLOY_TOKEN;
  delete f.opts.env.CLOUDFLARE_TOKEN_PROVISIONING_TOKEN;
  await configureGitHubCI(f.opts);
  assert.equal(f.cf.records.tokens.length, 0);
  assert.equal(f.records.secret.visibility, 'private');
});

test('a setup-only token cannot be stored as a deployment credential when it lacks Worker access', async () => {
  const f = fixture();
  f.opts.env.CLOUDFLARE_API_TOKEN = BOOTSTRAP_TOKEN;
  const request = f.opts.request;
  f.opts.request = (url, options) => new URL(url).pathname.endsWith('/workers/scripts')
    ? Response.json({ success: false, errors: [{ code: 9109, message: BOOTSTRAP_TOKEN }] }, { status: 403 })
    : request(url, options);
  await assert.rejects(configureGitHubCI(f.opts), error => error.message.includes('Worker access verification (HTTP 403)') && !error.message.includes(BOOTSTRAP_TOKEN));
  assert.equal(f.records.secret, undefined);
  assert.equal(f.cf.records.tokens.length, 0);
});
