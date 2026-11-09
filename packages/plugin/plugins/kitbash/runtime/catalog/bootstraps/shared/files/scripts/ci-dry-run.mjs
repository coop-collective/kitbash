#!/usr/bin/env node
// Credential-free Worker packaging and disposable local D1 migration rehearsals.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnvironment } from './secrets.mjs';

export function runCommand(root, args, { env = process.env, spawn = spawnSync } = {}) {
  const result = spawn('pnpm', args, { cwd: root, env: { ...childEnvironment(env), CI: 'true', WRANGLER_SEND_METRICS: 'false' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: false, timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`CI dry run failed: pnpm ${args.join(' ')}. Child diagnostics were captured; no deployment credentials were provided.`);
  return result.stdout ?? '';
}
export function sourceConfig(root) {
  const name = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'].find(value => existsSync(path.join(root, value)));
  if (!name) throw new Error('A source Wrangler configuration is required.');
  return name;
}
export async function readTarget(root, target) {
  const require = createRequire(path.join(root, 'package.json'));
  const { unstable_readConfig } = require('wrangler');
  return unstable_readConfig({ config: path.join(root, sourceConfig(root)), env: target }, { hideWarnings: true });
}
export function migrationFiles(root, db) {
  if (db.migrations_pattern) throw new Error('Custom migration layouts need a project-specific rehearsal; do not silently skip them.');
  const directory = path.resolve(root, db.migrations_dir ?? 'migrations');
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => name.endsWith('.sql')).sort().map(name => ({ name, file: path.join(directory, name) }));
}
export function rehearseDatabase(root, db, target, scratch, run) {
  const files = migrationFiles(root, db);
  if (!files.length) return;
  const directory = path.join(scratch, 'sql'); mkdirSync(directory, { recursive: true });
  const config = path.join(scratch, 'wrangler.json');
  writeFileSync(config, JSON.stringify({ name: 'kit-ci-local', compatibility_date: '2026-08-22', d1_databases: [{ binding: 'DB', database_name: 'kit-ci-local', database_id: '00000000-0000-0000-0000-000000000001', migrations_dir: directory }] }));
  const args = (state) => ['kit-ci-local', '--config', config, '--local', '--persist-to', path.join(scratch, state)];
  const apply = state => run(['exec', 'wrangler', 'd1', 'migrations', 'apply', ...args(state)]);
  const history = state => {
    const result = JSON.parse(run(['exec', 'wrangler', 'd1', 'execute', ...args(state), '--json', '--command', 'SELECT name FROM d1_migrations ORDER BY name']));
    return result.at(-1).results.map(row => row.name);
  };
  // First rehearse an incremental upgrade from all but the newest migration.
  for (const entry of files.slice(0, -1)) copyFileSync(entry.file, path.join(directory, entry.name));
  if (files.length > 1) apply('upgrade');
  copyFileSync(files.at(-1).file, path.join(directory, files.at(-1).name));
  for (const state of ['upgrade', 'fresh']) {
    apply(state);
    const expected = files.map(entry => entry.name);
    if (JSON.stringify(history(state)) !== JSON.stringify(expected)) throw new Error(`${target}: migration history does not match source SQL`);
    apply(state);
    if (JSON.stringify(history(state)) !== JSON.stringify(expected)) throw new Error(`${target}: migrations replayed unexpectedly`);
  }
}
export async function dryRun(root, { run = args => runCommand(root, args), load = target => readTarget(root, target), log = console.log } = {}) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const targets = ['staging', 'production'].filter(target => pkg.scripts?.[`build:${target}`]);
  if (!targets.length) throw new Error('Provide explicit build:staging/build:production scripts before enabling CI dry runs.');
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'kit-ci-dry-run-'));
  try {
    for (const target of targets) {
      const config = await load(target);
      for (const [index, db] of (config.d1_databases ?? []).entries()) rehearseDatabase(root, db, target, path.join(scratch, `${target}-${index}`), run);
      run(['run', `build:${target}`]);
      const flattened = Boolean(pkg.dependencies?.vinext || pkg.devDependencies?.vinext);
      if (flattened && !existsSync(path.join(root, 'dist/server/wrangler.json'))) throw new Error('vinext must emit its selected-environment Worker configuration before packaging.');
      run(['exec', 'wrangler', 'deploy', '--dry-run', '--config', flattened ? 'dist/server/wrangler.json' : sourceConfig(root), ...(flattened ? [] : ['--env', target]), '--outdir', path.join(scratch, 'bundle', target)]);
      log(`${target}: local migration rehearsal and Worker packaging dry run passed`);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('CI dry runs accept no remote/execute flags.');
  await dryRun(process.cwd());
}
