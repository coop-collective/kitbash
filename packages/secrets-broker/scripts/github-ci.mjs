import { createHash } from 'node:crypto';
import { requestJson } from '../src/api.mjs';
import { bootstrapTokenUrl, createDeploymentToken, verifyDeploymentAccess } from './cloudflare-token.mjs';
import { packageDir, run } from './deployment.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const reconcile = () => { throw new Error('Cloudflare deployment credential setup needs reconciliation. Inspect the recorded token ID and organization secret before retrying; setup will not replace an existing organization credential.'); };

// Capture Wrangler's local OAuth credential only for the operator-side API
// preflight. Never persist it, put it in GitHub, or deploy it to the Worker.
export async function localCloudflareToken({ env, runner = run }) {
  if (env.CLOUDFLARE_API_TOKEN) return env.CLOUDFLARE_API_TOKEN;
  const childEnv = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' };
  delete childEnv.WRANGLER_LOG;
  delete childEnv.CLOUDFLARE_API_TOKEN;
  const output = await runner('pnpm', ['exec', 'wrangler', 'auth', 'token', '--json'], {
    cwd: packageDir, env: childEnv,
    failure: 'Cloudflare login is required for local deployment. Run pnpm --filter @kitbash/secrets-broker exec wrangler login, then rerun setup.',
  });
  try {
    const result = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1));
    if (typeof result.token !== 'string' || !result.token) throw new Error();
    return result.token;
  } catch { throw new Error('Cannot read the existing Wrangler login. Run Wrangler login, then rerun setup.'); }
}

/** GitHub stores only the CI deployment token. No application values or broker
 * credentials are sent to GitHub, and no runtime GitHub identity is required. */
export async function configureGitHubCI({ env, settings, ghToken, ask, note, request = fetch, checkpoint, openBrowser, runner = run }) {
  const repository = env.KIT_BROKER_GITHUB_REPOSITORY;
  const organization = env.KIT_BROKER_GITHUB_ORGANIZATION || repository.split('/')[0];
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(organization) || repository.split('/')[0] !== organization) throw new Error('The deployment organization must own the selected repository.');
  const github = endpoint => requestJson(new URL(endpoint, 'https://api.github.com'), {
    request, headers: { authorization: `Bearer ${ghToken}`, accept: 'application/vnd.github+json', 'user-agent': 'kitbash-setup' },
  });
  const optional = async endpoint => {
    try { return await github(endpoint); }
    catch (error) { if (error.status === 404) return undefined; throw new Error('Cannot inspect organization deployment credentials. Check the GitHub login has organization secrets and variables access.'); }
  };
  const repo = await github(`/repos/${repository}`);
  const org = await github(`/orgs/${organization}`);
  if (repo.full_name !== repository || repo.owner?.type !== 'Organization' || org.login !== organization || !repo.private) throw new Error('Organization deployment credentials are restricted to private repositories owned by the selected organization.');
  if (org.plan?.name === 'free') throw new Error('GitHub Free does not expose organization secrets to private repositories. Upgrade the organization plan before configuring this deployment.');
  const secretPath = `/orgs/${organization}/actions/secrets/CLOUDFLARE_API_TOKEN`;
  const accountPath = `/orgs/${organization}/actions/variables/CLOUDFLARE_ACCOUNT_ID`;
  const existing = await optional(secretPath);
  const account = await optional(accountPath);
  if (existing && (existing.name !== 'CLOUDFLARE_API_TOKEN' || existing.visibility !== 'private')) throw new Error('The existing Cloudflare organization secret must have private-repository visibility. Review its access policy; setup will not change it automatically.');
  if (account && (account.value !== settings.CLOUDFLARE_ACCOUNT_ID || account.visibility !== 'private')) throw new Error('The existing organization Cloudflare account variable has a different value or access policy. Setup will not overwrite it.');
  const receipt = checkpoint('github-cloudflare-token', { organization, accountId: settings.CLOUDFLARE_ACCOUNT_ID });
  const { state } = receipt;
  const ghEnv = { ...process.env, GH_TOKEN: ghToken };
  const setAccount = async () => {
    if (!account) await runner('gh', ['variable', 'set', 'CLOUDFLARE_ACCOUNT_ID', '--org', organization, '--visibility', 'private', '--body', settings.CLOUDFLARE_ACCOUNT_ID], { env: ghEnv });
    const readback = await github(accountPath);
    if (readback.value !== settings.CLOUDFLARE_ACCOUNT_ID || readback.visibility !== 'private') throw new Error('Cannot verify the organization Cloudflare account variable.');
  };
  if (existing) {
    if (state.pending) reconcile();
    if (!account) throw new Error('An organization deployment token exists without its Cloudflare account variable. Configure the matching organization variable before setup; the secret value cannot be read back.');
    note(`Reusing ${organization}'s private-repository deployment secret. Local deployment uses your Wrangler login; GitHub secret values cannot be read back.`);
    const token = await localCloudflareToken({ env, runner });
    await verifyDeploymentAccess(token, settings, request);
    return { token, useLocalLogin: !env.CLOUDFLARE_API_TOKEN };
  }
  if (state.pending || state.tokenId || state.configured) reconcile();
  let token = env.CLOUDFLARE_API_TOKEN;
  if (token) {
    await verifyDeploymentAccess(token, settings, request);
  } else {
    const values = await createDeploymentToken({ settings, request, note, checkpoint: receipt,
      fingerprint: digest(JSON.stringify({ organization, accountId: settings.CLOUDFLARE_ACCOUNT_ID })),
      bootstrap: async () => {
        if (env.CLOUDFLARE_TOKEN_PROVISIONING_TOKEN) return env.CLOUDFLARE_TOKEN_PROVISIONING_TOKEN;
        const url = bootstrapTokenUrl(settings.KIT_BROKER_WORKER_NAME);
        note('One-time Cloudflare authorization: create the prefilled setup token with Account API Tokens Edit and Zone Read for this hostname. Paste it only into the hidden terminal prompt.');
        note(url);
        if (openBrowser) await openBrowser(url);
        const value = await ask('Cloudflare setup token (hidden; used once and not saved)', '', true);
        if (!value) throw new Error('A Cloudflare setup token is required once.');
        return value;
      },
    });
    token = values.CLOUDFLARE_API_TOKEN;
  }
  // Write through stdin: never put bearer values in process arguments.
  state.pending = 'github-secret';
  await receipt.save();
  await runner('gh', ['secret', 'set', 'CLOUDFLARE_API_TOKEN', '--org', organization, '--visibility', 'private'], {
    env: ghEnv, input: token,
    failure: 'Writing the organization deployment secret failed. Inspect the setup checkpoint and organization before retrying.',
  });
  const stored = await github(secretPath);
  if (stored.name !== 'CLOUDFLARE_API_TOKEN' || stored.visibility !== 'private') reconcile();
  await setAccount();
  delete state.pending;
  state.configured = true;
  await receipt.save();
  note(`Stored the deployment token in ${organization}'s private-repository organization secret and the account ID in an organization variable. No application secrets or Infisical identities were created. The one-time setup token can now be revoked.`);
  return { token, useLocalLogin: false };
}
