#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig, TARGETS, NAME } from '../src/config.mjs';
import { ensureGitHubAuth, loginGitHub } from './github-auth.mjs';
import { openState } from '../src/state.mjs';
import { ciSettingNames, configureBrokerCI, promptCIScope } from './broker-ci.mjs';
import { configureGitHubCI, localCloudflareToken } from './github-ci.mjs';
import { credentialNames, deploy, deploymentSettings, privateDirectory, privateWrite, readLocalEnv, repoDir, run, settingNames, writeDeploymentConfig } from './deployment.mjs';

const configNames = [...settingNames, ...ciSettingNames, 'KIT_BROKER_SECRET_BINDINGS', 'KIT_BROKER_CI_PROVIDER', 'KIT_BROKER_GITHUB_ORGANIZATION', 'KIT_BROKER_GITHUB_REPOSITORY', 'KIT_BROKER_GITHUB_ENVIRONMENT', 'KIT_BROKER_POLICY_FILE'];
const hash = value => createHash('sha256').update(value).digest('hex');
export const mcpConfig = (hostname, token) => ({ mcpServers: { kitbash_secrets: {
  type: 'http', url: `https://${hostname}/mcp`, headers: { Authorization: `Bearer ${token}` },
} } });

export function terminalPrompt() {
  let hidden = false;
  const output = new Writable({ write(chunk, _encoding, callback) { if (!hidden) process.stderr.write(chunk); callback(); } });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return {
    async ask(label, value = '', secret = false) {
      const prompt = `${label}${value ? secret ? ' (stored; Enter to keep)' : ` [${value}]` : ''}: `;
      // Readline redraws its current prompt. Writing a normal label separately
      // and then asking with an empty prompt erases the label in a real terminal.
      if (secret) process.stderr.write(prompt);
      hidden = secret;
      try { return (await rl.question(secret ? '' : prompt)).trim() || value; }
      finally { hidden = false; if (secret) process.stderr.write('\n'); }
    },
    close() { rl.close(); },
  };
}

async function api(url, token, { request, method = 'GET', body } = {}) {
  let response;
  try {
    response = await request(url, {
      method, headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'kitbash-setup' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json();
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid response.');
    return { status: response.status, ok: response.ok, result };
  } catch { throw new Error('Provider request failed. Credentials and provider responses were omitted.'); }
}

export async function remoteKeyExists(settings, token, request = fetch) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${settings.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${settings.KIT_BROKER_WORKER_NAME}`;
  const response = await api(`${base}/secrets`, token, { request });
  // Cloudflare identifies a missing Worker as 10007. A generic 404 may mean the account is inaccessible.
  if (response.status === 404 && response.result.errors?.some(error => error.code === 10007)) return false;
  if (!response.ok || response.result.success !== true || !Array.isArray(response.result.result) || response.result.result.some(row => typeof row?.name !== 'string')) throw new Error('Cannot inspect remote Worker secrets. Check the account and Cloudflare token permissions; no key was generated.');
  return response.result.result.some(row => row.name === 'KIT_BROKER_TOKEN_SHA256');
}

async function loadPolicy(file, ask, principal, note) {
  let config;
  try { config = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Cannot read the broker policy JSON.');
    note('No policy file exists. Creating a scoped policy for one Infisical project. You can add GitHub App/OIDC provisioning using the supplied policy examples.');
    const alias = await ask('Application project alias', 'my-app');
    const projectId = await ask('Existing Infisical project ID');
    const projectSlug = await ask('Infisical project slug', alias);
    const domain = await ask('Infisical origin', 'https://app.infisical.com');
    const target = await ask('Application target (local, staging, production)', 'staging');
    const environment = await ask('Infisical environment slug', target === 'local' ? 'dev' : target);
    const secretPath = await ask('Infisical folder', '/app');
    const names = (await ask('Application secret names to generate (comma-separated)', 'JWT_SESSION_SECRET')).split(',').map(name => name.trim());
    if (!TARGETS.includes(target) || names.some(name => !NAME.test(name)) || new Set(names).size !== names.length) throw new Error('Invalid application target or secret names.');
    config = { version: 1, projects: { [alias]: { projectId, projectSlug, domain,
      secrets: Object.fromEntries(names.map(name => [name, { generate: true, required: true, bytes: 32, rotation: 'migration-required' }])),
      targets: { [target]: { environment, secretPath } },
    } }, principals: [{ id: principal, tokenSha256: '0'.repeat(64), grants: [{ project: alias, targets: [target], operations: ['setup', 'status', 'presence', 'generate'] }] }] };
    try { validateConfig(config); } catch { throw new Error('Invalid policy settings. Check the project ID, aliases, vault origin, folder, and secret names.'); }
    await privateWrite(file, JSON.stringify(config, null, 2) + '\n');
  }
  try { validateConfig(config); } catch { throw new Error('The broker policy is invalid. Review the policy examples.'); }
  if (!config.principals.some(row => row.id === principal)) throw new Error('KIT_BROKER_PRINCIPAL does not exist in the policy.');
  for (const project of Object.values(config.projects)) if (/^(11111111-1111-4111-8111-111111111111|00000000-0000-0000-0000-000000000000)$/.test(project.projectId)) throw new Error('Replace the example Infisical project ID with your existing project ID.');
  return config;
}

export async function setup({ root = repoDir, supplied = process.env, ask, login, openBrowser, skipCI = false, runner = run, request = fetch, note = message => process.stderr.write(message + '\n'), print = value => process.stdout.write(value + '\n') } = {}) {
  if (supplied.CI) throw new Error('Run setup in your own terminal: it prints a private MCP bearer token. CI should run deploy:broker.');
  // Use the operator's CLI identity; the policy's private .env GitHub token is for broker provisioning only.
  const ghToken = skipCI ? undefined : await ensureGitHubAuth({ env: supplied, runner, login, note });
  const ghEnv = { ...process.env, ...supplied, GH_TOKEN: ghToken };
  const saved = await readLocalEnv(root);
  const env = { ...saved, ...supplied };
  env.KIT_BROKER_CI_PROVIDER ??= 'github';
  if (!['github', 'infisical'].includes(env.KIT_BROKER_CI_PROVIDER)) throw new Error('KIT_BROKER_CI_PROVIDER must be github or infisical.');
  ask ??= async (label, value) => { if (!value) throw new Error(`Missing ${label}. Run setup interactively or supply it in .env.`); return value; };
  env.KIT_BROKER_HOSTNAME = await ask('Broker hostname (a domain in your Cloudflare account)', env.KIT_BROKER_HOSTNAME);
  env.CLOUDFLARE_ACCOUNT_ID = await ask('Cloudflare account ID', env.CLOUDFLARE_ACCOUNT_ID);
  env.KIT_BROKER_WORKER_NAME = await ask('Worker name', env.KIT_BROKER_WORKER_NAME ?? 'kitbash-secrets-broker');
  env.KIT_BROKER_POLICY_FILE = await ask('Broker policy file', env.KIT_BROKER_POLICY_FILE ?? 'broker.policy.json');
  const policyFile = path.resolve(root, env.KIT_BROKER_POLICY_FILE);
  let defaultPrincipal = 'grok-bot';
  try { defaultPrincipal = JSON.parse(await readFile(policyFile, 'utf8')).principals?.[0]?.id ?? defaultPrincipal; } catch {}
  env.KIT_BROKER_PRINCIPAL = await ask('Policy principal for this connector', env.KIT_BROKER_PRINCIPAL ?? defaultPrincipal);
  const settings = deploymentSettings(env);
  const policy = await loadPolicy(policyFile, ask, settings.KIT_BROKER_PRINCIPAL, note);
  if (!skipCI) {
    let defaultRepo = env.KIT_BROKER_GITHUB_REPOSITORY;
    if (!defaultRepo) {
      try { defaultRepo = (await runner('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { cwd: root, env: ghEnv })).trim(); } catch {}
    }
    env.KIT_BROKER_GITHUB_REPOSITORY = await ask('GitHub template copy (owner/repository)', defaultRepo);
    env.KIT_BROKER_GITHUB_ENVIRONMENT = await ask('GitHub deployment environment', env.KIT_BROKER_GITHUB_ENVIRONMENT ?? 'production');
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.KIT_BROKER_GITHUB_REPOSITORY ?? '') ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(env.KIT_BROKER_GITHUB_ENVIRONMENT)) throw new Error('Invalid GitHub repository or environment name.');
    if (env.KIT_BROKER_CI_PROVIDER === 'infisical') await promptCIScope(env, policy, ask);
  }
  if (Object.values(policy.projects).some(project => project.backend !== 'cloudflare-secrets-store')) {
    if (env.INFISICAL_TOKEN) {
      env.INFISICAL_TOKEN = await ask('Infisical broker token (hidden)', env.INFISICAL_TOKEN, true);
    } else {
      env.INFISICAL_CLIENT_ID = await ask('Infisical Universal Auth client ID', env.INFISICAL_CLIENT_ID);
      env.INFISICAL_CLIENT_SECRET = await ask('Infisical Universal Auth client secret (hidden)', env.INFISICAL_CLIENT_SECRET, true);
      if (!env.INFISICAL_CLIENT_ID || !env.INFISICAL_CLIENT_SECRET) throw new Error('Infisical broker credentials are required.');
    }
  }
  if (Object.values(policy.projects).some(project => project.backend === 'cloudflare-secrets-store') || policy.principals.some(principal => principal.registration)) {
    env.KIT_BROKER_SECRETS_API_TOKEN = await ask('Cloudflare Secrets Store broker token (hidden)', env.KIT_BROKER_SECRETS_API_TOKEN, true);
    if (!env.KIT_BROKER_SECRETS_API_TOKEN) throw new Error('A Cloudflare Secrets Store runtime token is required for this policy.');
  }
  if (Object.values(policy.projects).some(project => Object.values(project.targets).some(scope => scope.github))) {
    env.GITHUB_TOKEN = await ask('Broker GitHub provisioning token (hidden)', env.GITHUB_TOKEN, true);
    if (!env.GITHUB_TOKEN) throw new Error('The policy enables GitHub provisioning and requires a broker GitHub token.');
  }
  const directory = await privateDirectory(root);
  let store;
  try { store = openState(path.join(directory, 'setup-state.json')); }
  catch { throw new Error('Cannot open private setup state. Another setup may be running; inspect .kitbash/setup-state.json and its lock before retrying.'); }
  try {
    const checkpoint = (key, binding) => {
      const state = store.data.entries[key] ??= {};
      if (binding) {
        const fingerprint = hash(JSON.stringify(binding));
        if (state.binding && state.binding !== fingerprint) throw new Error('The setup destination changed. Reconcile .kitbash/setup-state.json before moving its managed resources.');
        state.binding = fingerprint;
      }
      return { state, save: store.save };
    };
    // Preserve unrelated .env entries. Neither Cloudflare token belongs on disk.
    const persisted = { ...saved, ...Object.fromEntries([...configNames, ...credentialNames].filter(name => env[name]).map(name => [name, env[name]])) };
    // Preserve a legacy local deployment token until its replacement is safely
    // in the vault. New tokens are never added to this object.
    delete persisted.CLOUDFLARE_TOKEN_PROVISIONING_TOKEN;
    if (Object.entries(persisted).some(([name, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || /['\r\n\0]/.test(value))) throw new Error('Environment values must be single-line values without single quotes.');
    await privateWrite(path.join(root, '.env'), Object.entries(persisted).map(([name, value]) => `${name}='${value}'`).join('\n') + '\n');
    const config = await writeDeploymentConfig({ ...settings, KIT_BROKER_SECRET_BINDINGS: env.KIT_BROKER_SECRET_BINDINGS }, { root });
    note(`Target: ${settings.KIT_BROKER_WORKER_NAME} in account ${settings.CLOUDFLARE_ACCOUNT_ID}, https://${settings.KIT_BROKER_HOSTNAME}.`);

    // Preflight and configure CI before rotating. Never reset an existing environment's protections.
    const repository = env.KIT_BROKER_GITHUB_REPOSITORY;
    const environment = env.KIT_BROKER_GITHUB_ENVIRONMENT;
    const environmentUrl = `https://api.github.com/repos/${repository}/environments/${environment}`;
    if (!skipCI) {
      const existingEnvironment = await api(environmentUrl, ghToken, { request });
      if (existingEnvironment.status === 404) {
        const created = await api(environmentUrl, ghToken, { request, method: 'PUT', body: {} });
        if (!created.ok) throw new Error('Cannot create the GitHub deployment environment.');
      } else if (!existingEnvironment.ok) throw new Error('Cannot inspect the GitHub deployment environment.');
    }
    let preflightToken;
    if (skipCI) {
      preflightToken = await localCloudflareToken({ env, runner });
      note('Deploying with local Cloudflare authentication. GitHub CI settings and organization credentials are unchanged.');
    } else if (env.KIT_BROKER_CI_PROVIDER === 'infisical') {
      const credentials = await configureBrokerCI({ env, settings, ghToken, ask, note, request, checkpoint, openBrowser });
      preflightToken = env.CLOUDFLARE_API_TOKEN = credentials.CLOUDFLARE_API_TOKEN;
    } else {
      const credentials = await configureGitHubCI({ env, settings, ghToken, ask, note, request, checkpoint, openBrowser, runner });
      preflightToken = credentials.token;
      if (!credentials.useLocalLogin) env.CLOUDFLARE_API_TOKEN = credentials.token;
    }
    const exists = await remoteKeyExists(settings, preflightToken, request);
    note(exists ? 'An existing remote broker key will be replaced. Previous MCP connections will stop working; paste the new JSON after setup.' : 'No remote broker key exists. Setup will generate and deploy a new key.');
    if (Object.hasOwn(persisted, 'CLOUDFLARE_API_TOKEN')) {
      delete persisted.CLOUDFLARE_API_TOKEN;
      await privateWrite(path.join(root, '.env'), Object.entries(persisted).map(([name, value]) => `${name}='${value}'`).join('\n') + '\n');
    }
    if (!skipCI) {
      for (const [name, value] of Object.entries(settings)) {
        if (name === 'CLOUDFLARE_ACCOUNT_ID' && env.KIT_BROKER_CI_PROVIDER === 'github') continue;
        await runner('gh', ['variable', 'set', name, '--repo', repository, '--env', environment, '--body', value], { env: ghEnv });
      }
      await runner('gh', ['variable', 'set', 'KIT_BROKER_CI_PROVIDER', '--repo', repository, '--body', env.KIT_BROKER_CI_PROVIDER], { env: ghEnv });
      await runner('gh', ['variable', 'set', 'KIT_BROKER_DEPLOY_ENVIRONMENT', '--repo', repository, '--body', environment], { env: ghEnv });
    }

    const token = randomBytes(32).toString('base64url');
    // The selected principal is authenticated solely by the separately deployed digest, never a stale file hash.
    policy.principals.find(row => row.id === settings.KIT_BROKER_PRINCIPAL).tokenSha256 = hash(token);
    const secrets = { KIT_BROKER_TOKEN_SHA256: hash(token), KIT_BROKER_POLICY: JSON.stringify(policy),
      // Clear a previous auth mode too: additive Wrangler secret updates otherwise retain it.
      INFISICAL_TOKEN: env.INFISICAL_TOKEN || '',
      INFISICAL_CLIENT_ID: env.INFISICAL_TOKEN ? '' : env.INFISICAL_CLIENT_ID || '',
      INFISICAL_CLIENT_SECRET: env.INFISICAL_TOKEN ? '' : env.INFISICAL_CLIENT_SECRET || '',
      KIT_BROKER_SECRETS_API_TOKEN: env.KIT_BROKER_SECRETS_API_TOKEN || '',
      GITHUB_TOKEN: env.GITHUB_TOKEN || '',
      // Application sync credentials are explicit and separate from this broker's deployment token.
      CLOUDFLARE_API_TOKEN: env.KIT_BROKER_APP_CLOUDFLARE_API_TOKEN || '',
      CLOUDFLARE_ACCOUNT_ID: env.KIT_BROKER_APP_CLOUDFLARE_ACCOUNT_ID || '',
    };
    const mcp = JSON.stringify(mcpConfig(settings.KIT_BROKER_HOSTNAME, token), null, 2);
    // A unique recovery file preserves both old and new connections if deployment fails ambiguously.
    const id = randomBytes(8).toString('hex');
    const recovery = path.join(directory, `mcp-${id}.json`);
    await privateWrite(recovery, mcp + '\n');
    const secretsFile = path.join(directory, `deploy-secrets-${id}.json`);
    note(`Private MCP recovery file: ${recovery}`);
    try {
      await privateWrite(secretsFile, JSON.stringify(secrets));
      note('Deploying the Worker, custom hostname, policy, and broker credential…');
      await deploy({ env, config, secretsFile, runner });
    } finally { await rm(secretsFile, { force: true }); }
    await privateWrite(path.join(directory, 'mcp.json'), mcp + '\n');
    // Always give the operator the deployed credential, even if the final CI enable step fails.
    print(mcp);
    if (!skipCI) await runner('gh', ['variable', 'set', 'KIT_BROKER_CONFIGURED', '--repo', repository, '--body', 'true'], {
      env: ghEnv, failure: 'The broker is deployed and its MCP JSON was printed, but enabling CI failed. Set the repository variable KIT_BROKER_CONFIGURED=true after fixing GitHub permissions.',
    });
    note(`Setup complete. Copy the JSON into your bot's MCP settings. ${skipCI ? 'CI configuration was skipped.' : `GitHub environment ${environment} is configured; ordinary CI deployments preserve this key.`}`);
    return { config, recovery };
  } finally { store.close(); }
}

async function openSetupUrl(url) {
  const env = Object.fromEntries(['PATH', 'HOME', 'DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS'].filter(name => process.env[name]).map(name => [name, process.env[name]]));
  try {
    if (process.platform === 'darwin') await run('open', [url], { env });
    else if (process.platform === 'linux') await run('xdg-open', [url], { env });
    else if (process.platform === 'win32') await run('rundll32', ['url.dll,FileProtocolHandler', url], { env });
  } catch { /* The printed URL is also usable from a headless terminal. */ }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let prompt;
  try {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
      console.log('Usage: pnpm run setup [--yes] [--skip-ci]\nPrompts for hostname, account, policy and private broker credentials.\nCI uses the organization CLOUDFLARE_API_TOKEN secret and CLOUDFLARE_ACCOUNT_ID variable for private repositories.\nExisting organization credentials are reused. Application secrets and the MCP key are never stored in GitHub.\n--skip-ci uses local Wrangler authentication without configuring GitHub or creating deployment tokens.\n--yes reuses saved values. Run in your own terminal; setup prints private MCP JSON.');
    } else {
      if (args.some(arg => !['--yes', '--skip-ci'].includes(arg))) throw new Error('Unknown setup argument. Use --help.');
      if (!args.includes('--yes')) {
        if (!process.stdin.isTTY) throw new Error('Interactive setup requires a terminal. Use --yes with an existing .env for unattended setup.');
      }
      await setup({ skipCI: args.includes('--skip-ci'), ...(!args.includes('--yes') ? {
        login: loginGitHub,
        openBrowser: openSetupUrl,
        ask: (...values) => { prompt ??= terminalPrompt(); return prompt.ask(...values); },
      } : {}) });
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { prompt?.close(); }
}
