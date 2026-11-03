import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile, rename, lstat, chmod, rm } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';

export const packageDir = fileURLToPath(new URL('../', import.meta.url));
export const repoDir = path.resolve(packageDir, '../..');
export const settingNames = ['KIT_BROKER_HOSTNAME', 'KIT_BROKER_WORKER_NAME', 'CLOUDFLARE_ACCOUNT_ID', 'KIT_BROKER_PRINCIPAL'];
export const credentialNames = ['KIT_BROKER_SECRETS_API_TOKEN', 'INFISICAL_TOKEN', 'INFISICAL_CLIENT_ID', 'INFISICAL_CLIENT_SECRET', 'GITHUB_TOKEN', 'KIT_BROKER_APP_CLOUDFLARE_API_TOKEN', 'KIT_BROKER_APP_CLOUDFLARE_ACCOUNT_ID', 'KIT_SETUP_INFISICAL_TOKEN', 'KIT_SETUP_INFISICAL_CLIENT_ID', 'KIT_SETUP_INFISICAL_CLIENT_SECRET'];

export async function readLocalEnv(root = repoDir) {
  try { return parseEnv(await readFile(path.join(root, '.env'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('Cannot read the local .env file.'); }
}

export function deploymentSettings(env) {
  const settings = Object.fromEntries(settingNames.map(name => [name, env[name]]));
  const hostname = settings.KIT_BROKER_HOSTNAME;
  if (!hostname || hostname.length > 253 || !hostname.includes('.') || hostname !== hostname.toLowerCase() ||
      !hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) throw new Error('KIT_BROKER_HOSTNAME must be a lowercase DNS hostname, without a scheme or path.');
  if (!/^[a-f0-9]{32}$/i.test(settings.CLOUDFLARE_ACCOUNT_ID ?? '')) throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character account ID.');
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(settings.KIT_BROKER_WORKER_NAME ?? '')) throw new Error('KIT_BROKER_WORKER_NAME must be a lowercase Worker name.');
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(settings.KIT_BROKER_PRINCIPAL ?? '')) throw new Error('KIT_BROKER_PRINCIPAL must match a policy principal.');
  return settings;
}

export async function privateWrite(file, value) {
  try { if (!(await lstat(file)).isFile()) throw new Error('Not a regular file.'); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Refusing to replace a non-regular configuration file.'); }
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, value, { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

export async function privateDirectory(root) {
  const dir = path.join(root, '.kitbash');
  await mkdir(dir, { mode: 0o700, recursive: true });
  if (!(await lstat(dir)).isDirectory()) throw new Error('The .kitbash path must be a real directory.');
  await chmod(dir, 0o700);
  return dir;
}

export async function writeDeploymentConfig(env, { root = repoDir, baseFile = path.join(packageDir, 'wrangler.jsonc') } = {}) {
  const settings = deploymentSettings(env);
  const errors = [];
  const config = parse(await readFile(baseFile, 'utf8'), errors);
  if (errors.length || !config?.main) throw new Error('Invalid base Wrangler configuration.');
  delete config.$schema;
  config.main = path.resolve(path.dirname(baseFile), config.main);
  config.name = settings.KIT_BROKER_WORKER_NAME;
  config.account_id = settings.CLOUDFLARE_ACCOUNT_ID;
  config.routes = [{ pattern: settings.KIT_BROKER_HOSTNAME, custom_domain: true }];
  config.vars = { ...config.vars, KIT_BROKER_PUBLIC_ORIGIN: `https://${settings.KIT_BROKER_HOSTNAME}`, KIT_BROKER_PRINCIPAL: settings.KIT_BROKER_PRINCIPAL };
  if (env.KIT_BROKER_SECRET_BINDINGS) {
    let bindings;
    try { bindings = JSON.parse(env.KIT_BROKER_SECRET_BINDINGS); } catch { throw new Error('Invalid broker secret binding configuration.'); }
    if (!Array.isArray(bindings) || bindings.some(row => !row || Object.keys(row).sort().join(',') !== 'binding,secret_name,store_id' ||
        !/^KIT_DELIVERY_[A-F0-9]{16}$/.test(row.binding ?? '') || !/^[a-f0-9]{32}$/.test(row.store_id ?? '') ||
        !/^[A-Z][A-Z0-9_]{0,254}$/.test(row.secret_name ?? '')) || new Set(bindings.map(row => row.binding)).size !== bindings.length) throw new Error('Invalid broker secret binding configuration.');
    config.secrets_store_secrets = bindings;
  }
  const dir = await privateDirectory(root);
  const file = path.join(dir, 'wrangler.deploy.json');
  await privateWrite(file, JSON.stringify(config, null, 2) + '\n');
  return file;
}

// Capture and suppress tool output: provider/CLI diagnostics may contain credentials.
export function run(command, args, { input, env = process.env, cwd = repoDir, failure = `${command} failed. Check its authentication and permissions.` } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let stdout = '';
    child.stdout.on('data', chunk => { if (stdout.length < 2_000_000) stdout += chunk; });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.once('error', () => reject(new Error(failure)));
    child.once('close', code => code === 0 ? resolve(stdout) : reject(new Error(failure)));
    child.stdin.end(input);
  });
}

export function wranglerEnv(env) {
  // Do not pass vault credentials to the deployment CLI. Explicit settings take precedence over its dotenv loader.
  return Object.fromEntries(Object.entries({
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, SystemRoot: process.env.SystemRoot,
    CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG: 'error', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
  }).filter(([, value]) => value !== undefined));
}

export async function deploy({ env, config, secretsFile, dryRun = false, runner = run }) {
  await runner('pnpm', ['exec', 'wrangler', 'deploy', '--config', config,
    ...(secretsFile ? ['--secrets-file', secretsFile] : []), ...(dryRun ? ['--dry-run'] : [])], {
    cwd: packageDir, env: wranglerEnv(env),
    failure: 'Worker deployment failed. The generated MCP file is retained; check Cloudflare before rerunning setup because the key may already have changed.',
  });
}
