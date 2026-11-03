import { createHash } from 'node:crypto';
import { makeProviders } from '../src/api.mjs';
import { ensureScope } from '../src/scope.mjs';
import { provisionBrokerGitHub, githubPolicy } from '../src/provision.mjs';
import { bootstrapTokenUrl, ensureDeploymentToken, readDeploymentCredentials } from './cloudflare-token.mjs';

export const ciSettingNames = ['KIT_BROKER_CI_PROJECT_ID', 'KIT_BROKER_CI_PROJECT_SLUG', 'KIT_BROKER_CI_DOMAIN', 'KIT_BROKER_CI_ENVIRONMENT', 'KIT_BROKER_CI_SECRET_PATH'];

export function ciScopeFromEnv(env) {
  const scope = {
    projectId: env.KIT_BROKER_CI_PROJECT_ID, projectSlug: env.KIT_BROKER_CI_PROJECT_SLUG,
    domain: env.KIT_BROKER_CI_DOMAIN, environment: env.KIT_BROKER_CI_ENVIRONMENT, secretPath: env.KIT_BROKER_CI_SECRET_PATH,
  };
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(scope.projectId ?? '') ||
      ![scope.projectSlug, scope.environment].every(value => /^[a-z0-9][a-z0-9-]{0,63}$/.test(value ?? '')) ||
      !/^\/ci\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(scope.secretPath ?? '')) throw new Error('Configure a valid Infisical project, environment, and dedicated /ci/<folder> for broker deployments.');
  let url;
  try { url = new URL(scope.domain); } catch { throw new Error('The broker CI Infisical domain must be an HTTPS origin.'); }
  if (url.protocol !== 'https:' || url.origin !== scope.domain || url.username || url.password) throw new Error('The broker CI Infisical domain must be an HTTPS origin.');
  return scope;
}

export async function promptCIScope(env, policy, ask) {
  const project = Object.values(policy.projects)[0];
  env.KIT_BROKER_CI_PROJECT_ID = await ask('Infisical project ID for broker deployment credentials', env.KIT_BROKER_CI_PROJECT_ID ?? project.projectId);
  env.KIT_BROKER_CI_PROJECT_SLUG = await ask('Infisical project slug for broker CI', env.KIT_BROKER_CI_PROJECT_SLUG ?? project.projectSlug);
  env.KIT_BROKER_CI_DOMAIN = await ask('Infisical origin for broker CI', env.KIT_BROKER_CI_DOMAIN ?? project.domain);
  env.KIT_BROKER_CI_ENVIRONMENT = await ask('Infisical environment for broker CI', env.KIT_BROKER_CI_ENVIRONMENT ?? env.KIT_BROKER_GITHUB_ENVIRONMENT.toLowerCase());
  env.KIT_BROKER_CI_SECRET_PATH = await ask('Dedicated Infisical folder for broker CI', env.KIT_BROKER_CI_SECRET_PATH ?? `/ci/${env.KIT_BROKER_WORKER_NAME}`);
  return ciScopeFromEnv(env);
}

// Optional provisioning identity stays on the operator's computer. It is never
// deployed to the Worker or needed by Actions. Otherwise use the broker identity.
export function ciProviderEnv(env) {
  return env.KIT_SETUP_INFISICAL_TOKEN ? { INFISICAL_TOKEN: env.KIT_SETUP_INFISICAL_TOKEN }
    : env.KIT_SETUP_INFISICAL_CLIENT_ID || env.KIT_SETUP_INFISICAL_CLIENT_SECRET
      ? { INFISICAL_CLIENT_ID: env.KIT_SETUP_INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET: env.KIT_SETUP_INFISICAL_CLIENT_SECRET }
      : { INFISICAL_TOKEN: env.INFISICAL_TOKEN, INFISICAL_CLIENT_ID: env.INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET: env.INFISICAL_CLIENT_SECRET };
}

export async function configureBrokerCI({ env, settings, ghToken, ask, note, request, checkpoint, openBrowser }) {
  const scope = ciScopeFromEnv(env);
  const { infisical, github } = await makeProviders({ env: { ...ciProviderEnv(env), GITHUB_TOKEN: ghToken }, request })(scope);
  const repo = await github(`/repos/${env.KIT_BROKER_GITHUB_REPOSITORY}`);
  if (repo.full_name !== env.KIT_BROKER_GITHUB_REPOSITORY || typeof repo.default_branch !== 'string') throw new Error('Cannot identify the repository default branch for OIDC.');
  const identitySuffix = createHash('sha256').update(`${repo.full_name}:${env.KIT_BROKER_GITHUB_ENVIRONMENT}:${settings.KIT_BROKER_WORKER_NAME}`).digest('hex').slice(0, 12);
  const githubConfig = {
    repository: repo.full_name, environment: env.KIT_BROKER_GITHUB_ENVIRONMENT, ref: `refs/heads/${repo.default_branch}`,
    workflow: '.github/workflows/deploy-broker.yml', audience: `kitbash:broker:${repo.full_name}:${env.KIT_BROKER_GITHUB_ENVIRONMENT}`,
    roleSlug: `kit-broker-${identitySuffix}-push`, identityName: `kit-broker-${identitySuffix}-push`,
  };
  githubPolicy({ ...scope, github: githubConfig }, true);
  await ensureScope(scope, infisical, checkpoint('ci-scope', scope));
  note(`Broker deployment credentials: ${scope.domain}, project ${scope.projectSlug}, environment ${scope.environment}, folder ${scope.secretPath}.`);
  for (const event of ['push', 'workflow_dispatch']) {
    const name = `kit-broker-${identitySuffix}-${event === 'push' ? 'push' : 'manual'}`;
    await provisionBrokerGitHub({ ...scope, github: { ...githubConfig, roleSlug: name, identityName: name } }, {
      infisical, github, checkpoint: checkpoint(`ci-${event}`),
    }, event);
  }
  note('GitHub Actions OIDC configured for the default branch and deployment workflow. No GitHub secrets were created.');
  return ensureDeploymentToken({ scope, settings, infisical, request, note, checkpoint: checkpoint('cloudflare-token'), bootstrap: async () => {
    let token = env.CLOUDFLARE_TOKEN_PROVISIONING_TOKEN;
    if (!token) {
      const url = bootstrapTokenUrl(settings.KIT_BROKER_WORKER_NAME);
      note('One-time Cloudflare authorization: Wrangler login cannot create API tokens. Open the URL, select the deployment account, and create the prefilled setup token with Account API Tokens Edit and Zone Read for the hostname zone.');
      note(url);
      if (openBrowser) await openBrowser(url);
      token = await ask('Cloudflare setup token (hidden; used once and not saved)', '', true);
    }
    if (!token) throw new Error('A Cloudflare setup token is required once. Use the displayed URL or supply CLOUDFLARE_TOKEN_PROVISIONING_TOKEN.');
    return token;
  } });
}

export async function loadDeploymentToken(env, request = fetch) {
  const scope = ciScopeFromEnv(env);
  const { infisical } = await makeProviders({ env: ciProviderEnv(env), request })(scope);
  const values = await readDeploymentCredentials(scope, infisical);
  if (!values.CLOUDFLARE_API_TOKEN || values.CLOUDFLARE_ACCOUNT_ID !== env.CLOUDFLARE_ACCOUNT_ID) throw new Error('No matching Cloudflare deployment token is stored in the configured Infisical folder. Run setup.');
  return values.CLOUDFLARE_API_TOKEN;
}
