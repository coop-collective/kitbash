#!/usr/bin/env node
// Explicit trusted release operation. PR CI uses ci-dry-run.mjs instead.
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnvironment } from './secrets.mjs';
import { readTarget, sourceConfig } from './ci-dry-run.mjs';

export async function migrate(root, target, { env = process.env, load = value => readTarget(root, value), run } = {}) {
  if (!['staging', 'production'].includes(target)) throw new Error('Migrations require an explicit staging or production environment.');
  if (env.GITHUB_ACTIONS === 'true' && (env.GITHUB_REF !== 'refs/heads/main' || !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME))) throw new Error('Remote migrations are forbidden in PR CI and outside main releases.');
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) throw new Error('Release credentials must be loaded after checks and build.');
  const config = await load(target);
  const execute = run ?? (args => {
    const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], { cwd: root, env: { ...childEnvironment(env, true), CI: 'true' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: false, timeout: 10 * 60_000 });
    if (result.error || result.status !== 0) throw new Error('Migration/restore-bookmark command failed. Deploy must stop; captured credential-bearing diagnostics were omitted.');
    return result.stdout ?? '';
  });
  for (const db of config.d1_databases ?? []) {
    if (!db.database_name || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(db.database_id ?? '') || db.database_id === '00000000-0000-0000-0000-000000000000') throw new Error('Provision the selected environment database before migrations.');
    const base = [db.database_name, '--config', sourceConfig(root), '--env', target];
    const { bookmark } = JSON.parse(execute(['d1', 'time-travel', 'info', ...base, '--json']));
    if (!bookmark) throw new Error('A restore bookmark is required before applying migrations.');
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `D1 ${target}: \`${db.database_name}\` restore bookmark: \`${bookmark}\`\n\n`);
    execute(['d1', 'migrations', 'apply', ...base, '--remote']);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== '--env') throw new Error('Usage: node scripts/migrate.mjs --env staging|production');
  await migrate(process.cwd(), process.argv[3]);
}
