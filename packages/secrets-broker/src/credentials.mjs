import { fail } from './errors.mjs';

/** Only the broker calls this. Credentials never enter tool arguments/results/state. */
export async function ensureCloudflareCredentials(scope, api, checkpoint, env) {
  const names = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];
  const read = async () => {
    const result = await api('/api/v4/secrets', { query: {
      projectId: scope.projectId, environment: scope.environment, secretPath: '/ci',
      viewSecretValue: 'true', expandSecretReferences: 'false', includeImports: 'false', includePersonalOverrides: 'false', recursive: 'false',
    } });
    if (!Array.isArray(result.secrets)) fail('provider_failed');
    const values = {};
    for (const row of result.secrets.filter(row => names.includes(row.secretKey))) {
      if (row.workspace !== scope.projectId || row.environment !== scope.environment || row.type !== 'shared' ||
          (row.secretPath !== undefined && row.secretPath !== '/ci') || row.secretValueHidden || typeof row.secretValue !== 'string' ||
          Object.hasOwn(values, row.secretKey)) fail('provider_failed');
      values[row.secretKey] = row.secretValue;
    }
    return values;
  };
  const valid = values => /^[a-f0-9]{32}$/i.test(values.CLOUDFLARE_ACCOUNT_ID ?? '') &&
    typeof values.CLOUDFLARE_API_TOKEN === 'string' && /^[A-Za-z0-9_-]{16,256}$/.test(values.CLOUDFLARE_API_TOKEN);
  let values = await read();
  if (!Object.keys(values).length) {
    if (checkpoint.state.pending) fail('conflict');
    const supplied = Object.fromEntries(names.map(name => [name, env[name]]));
    if (!valid(supplied)) fail('unavailable');
    checkpoint.state.pending = true;
    await checkpoint.save();
    const result = await api('/api/v4/secrets/batch', { method: 'POST', body: {
      projectId: scope.projectId, environment: scope.environment, secretPath: '/ci',
      secrets: names.map(secretKey => ({ secretKey, secretValue: supplied[secretKey], skipMultilineEncoding: true })),
    } });
    if (result.approval) fail('conflict');
    values = await read();
    if (names.some(name => values[name] !== supplied[name])) fail('provider_failed');
  }
  // Never silently combine half a pre-existing pair with a credential for a different account.
  if (!valid(values)) fail('conflict');
  delete checkpoint.state.pending;
  checkpoint.state.configured = true;
  await checkpoint.save();
  return { apiToken: values.CLOUDFLARE_API_TOKEN, accountId: values.CLOUDFLARE_ACCOUNT_ID };
}
