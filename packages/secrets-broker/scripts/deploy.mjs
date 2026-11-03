#!/usr/bin/env node
import { deploy, readLocalEnv, writeDeploymentConfig } from './deployment.mjs';
import { loadDeploymentToken } from './broker-ci.mjs';

try {
  if (process.argv.slice(2).some(arg => arg !== '--dry-run')) throw new Error('Usage: pnpm run deploy:broker [--dry-run]');
  const env = { ...await readLocalEnv(), ...process.env };
  const config = await writeDeploymentConfig(env);
  if (!process.argv.includes('--dry-run') && !env.CLOUDFLARE_API_TOKEN) {
    if (env.CI) throw new Error('The CI deployment token is missing. Check access to the organization CLOUDFLARE_API_TOKEN secret or the explicitly selected Infisical OIDC step.');
    if (env.KIT_BROKER_CI_PROVIDER === 'infisical') env.CLOUDFLARE_API_TOKEN = await loadDeploymentToken(env);
  }
  await deploy({ env, config, dryRun: process.argv.includes('--dry-run') });
  console.log(process.argv.includes('--dry-run') ? 'Broker deployment bundle verified.' : 'Broker deployed. Existing remote secrets were preserved.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
