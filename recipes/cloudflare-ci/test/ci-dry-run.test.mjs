import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dryRun, runCommand } from '../scripts/ci-dry-run.mjs';
import { migrate } from '../scripts/migrate.mjs';

function project(vinext = false) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kit-ci-fixture-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'build:staging': 'fixture', 'build:production': 'fixture' }, dependencies: vinext ? { vinext: 'fixture' } : {} }));
  writeFileSync(path.join(root, 'wrangler.jsonc'), '{}');
  mkdirSync(path.join(root, 'migrations'));
  for (const name of ['20260101000000_first.sql', '20260102000000_next.sql']) writeFileSync(path.join(root, 'migrations', name), '-- fixture');
  if (vinext) { mkdirSync(path.join(root, 'dist/server'), { recursive: true }); writeFileSync(path.join(root, 'dist/server/wrangler.json'), '{}'); }
  return root;
}
test('PR checks use only disposable local D1 and dry-run deployments, with explicit raw/flattened targets', async () => {
  for (const vinext of [false, true]) {
    const root = project(vinext), calls = [];
    try {
      await dryRun(root, { log() {}, load: async () => ({ d1_databases: [{ migrations_dir: 'migrations' }] }), run: args => {
        calls.push(args);
        if (args.includes('--json')) {
          const config = JSON.parse(readFileSync(args[args.indexOf('--config') + 1], 'utf8'));
          assert.equal(config.d1_databases[0].database_id, '00000000-0000-0000-0000-000000000001');
          return JSON.stringify([{ results: readdirSync(config.d1_databases[0].migrations_dir).sort().map(name => ({ name })) }]);
        }
        return '';
      } });
      assert.deepEqual(calls.filter(args => args[0] === 'run'), [['run', 'build:staging'], ['run', 'build:production']]);
      for (const args of calls.filter(args => args.includes('d1'))) { assert.ok(args.includes('--local')); assert.equal(args.includes('--remote'), false); }
      const bundles = calls.filter(args => args.includes('deploy'));
      assert.equal(bundles.length, 2);
      for (const args of bundles) { assert.ok(args.includes('--dry-run')); assert.equal(args.includes('--env'), !vinext); assert.ok(args.includes(vinext ? 'dist/server/wrangler.json' : 'wrangler.jsonc')); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});
test('migration rehearsal failure prevents building or packaging the release', async () => {
  const root = project(), calls = [];
  try {
    await assert.rejects(dryRun(root, { load: async () => ({ d1_databases: [{}] }), log() {}, run: args => { calls.push(args); throw new Error('fixture SQL failure'); } }), /SQL failure/);
    assert.equal(calls.length, 1); assert.ok(calls[0].includes('migrations'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('dry-run child processes receive no deployment, broker or forge credentials', () => {
  runCommand('/fixture', ['run', 'build:production'], { env: { PATH: '/fixture/bin', CLOUDFLARE_API_TOKEN: 'must-not-pass', INFISICAL_CLIENT_SECRET: 'must-not-pass', GITHUB_TOKEN: 'must-not-pass', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'must-not-pass' }, spawn: (file, args, options) => {
    assert.equal(file, 'pnpm'); assert.equal(options.shell, false); assert.equal(options.env.PATH, '/fixture/bin');
    for (const key of ['CLOUDFLARE_API_TOKEN', 'INFISICAL_CLIENT_SECRET', 'GITHUB_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN']) assert.equal(options.env[key], undefined);
    return { status: 0, stdout: '' };
  } });
});
test('trusted migrations record the selected environment bookmark before writes and forbid PR execution', async () => {
  const root = project(), calls = [], env = { CLOUDFLARE_API_TOKEN: 'fixture', CLOUDFLARE_ACCOUNT_ID: 'fixture', GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'push' };
  const load = async () => ({ d1_databases: [{ database_name: 'fixture-db', database_id: '11111111-1111-1111-1111-111111111111' }] });
  try {
    await migrate(root, 'production', { env, load, run: args => { calls.push(args); return JSON.stringify({ bookmark: 'fixture-bookmark' }); } });
    assert.deepEqual(calls.map(args => args.slice(0, 3)), [['d1', 'time-travel', 'info'], ['d1', 'migrations', 'apply']]);
    for (const args of calls) { assert.ok(args.includes('fixture-db')); assert.equal(args[args.indexOf('--env') + 1], 'production'); }
    await assert.rejects(migrate(root, 'production', { env: { ...env, GITHUB_EVENT_NAME: 'pull_request' }, load: () => assert.fail(), run: () => assert.fail() }), /forbidden/);
    await assert.rejects(migrate(root, 'production', { env, load, run: () => '{}' }), /bookmark/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('the bundled recipe carries the same reusable dry-run implementation', { skip: !existsSync(new URL('../../../bootstraps/shared/files/scripts/ci-dry-run.mjs', import.meta.url)) }, () => {
  assert.equal(readFileSync(new URL('../scripts/ci-dry-run.mjs', import.meta.url), 'utf8'), readFileSync(new URL('../../../bootstraps/shared/files/scripts/ci-dry-run.mjs', import.meta.url), 'utf8'));
});
