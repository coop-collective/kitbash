import { fail } from './errors.mjs';

export function checkRecord(row, scope, name) {
  if (!row || row.secretKey !== name || row.workspace !== scope.projectId || row.environment !== scope.environment ||
      row.type !== 'shared' || (row.secretPath !== undefined && row.secretPath !== scope.secretPath)) fail('provider_failed');
}

export async function secretNames(api, scope) {
  if (api?.listNames) return api.listNames();
  const result = await api('/api/v4/secrets', { query: {
    projectId: scope.projectId, environment: scope.environment, secretPath: scope.secretPath,
    viewSecretValue: 'false', expandSecretReferences: 'false', includeImports: 'false',
    includePersonalOverrides: 'false', recursive: 'false',
  } });
  if (!Array.isArray(result.secrets)) fail('provider_failed');
  const names = new Set();
  for (const row of result.secrets) {
    checkRecord(row, scope, row.secretKey);
    if (typeof row.secretKey !== 'string' || names.has(row.secretKey)) fail('provider_failed');
    names.add(row.secretKey);
  }
  return names;
}

export async function createSecret(api, scope, name, value) {
  if (api?.createMany) return api.createMany([{ name, value }]);
  const result = await api(`/api/v4/secrets/${name}`, { method: 'POST', body: {
    projectId: scope.projectId, environment: scope.environment, secretPath: scope.secretPath,
    secretValue: value, type: 'shared', skipMultilineEncoding: true,
  } });
  if (result.approval) fail('conflict');
  checkRecord(result.secret, scope, name);
}

export async function createSecrets(api, scope, entries) {
  if (api?.createMany) return api.createMany(entries);
  const result = await api('/api/v4/secrets/batch', { method: 'POST', body: {
    projectId: scope.projectId, environment: scope.environment, secretPath: scope.secretPath,
    secrets: entries.map(entry => ({ secretKey: entry.name, secretValue: entry.value, skipMultilineEncoding: true })),
  } });
  if (result.approval || !Array.isArray(result.secrets) || result.secrets.length !== entries.length) fail('provider_failed');
  const expected = new Set(entries.map(entry => entry.name));
  for (const row of result.secrets) {
    if (!expected.delete(row.secretKey)) fail('provider_failed');
    checkRecord(row, scope, row.secretKey);
  }
}
