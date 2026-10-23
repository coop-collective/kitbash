import { createHash, randomBytes } from 'node:crypto';
import { authorize, validateConfig, validateOperation } from './config.mjs';
import { fail } from './errors.mjs';
import { makeProviders } from './api.mjs';
import { connectCloudflare, provisionGitHub, provisionWorkerSync } from './provision.mjs';
import { ensureScope } from './scope.mjs';
import { ensureCloudflareCredentials } from './credentials.mjs';

function checkRecord(row, scope, name) {
  if (!row || row.secretKey !== name || row.workspace !== scope.projectId || row.environment !== scope.environment ||
      row.type !== 'shared' || (row.secretPath !== undefined && row.secretPath !== scope.secretPath)) fail('provider_failed');
}

async function secretNames(api, scope) {
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

/** This service never loads, executes, or trusts code/config from the agent's repo. */
export function createService(config, store, { env = process.env, providers = makeProviders({ env }), entropy = randomBytes, githubProvision = provisionGitHub, workerProvision = provisionWorkerSync, scopeProvision = ensureScope, credentialsProvision = ensureCloudflareCredentials, connectionProvision = connectCloudflare } = {}) {
  validateConfig(config);
  let queue = Promise.resolve();
  let queued = 0;

  function checkpoint(input, scope) {
    const key = `${input.project}:${input.target}:${input.operation}`;
    const digest = createHash('sha256').update(JSON.stringify(scope)).digest('hex');
    const entry = store.data.entries[key] ??= { digest, state: {} };
    if (entry.digest !== digest) fail('conflict');
    return { state: entry.state, save: store.save };
  }

  async function perform(input, sharedProviders) {
    const project = config.projects[input.project];
    const target = project.targets[input.target];
    const scope = { ...target, projectId: project.projectId, projectSlug: project.projectSlug, domain: project.domain };
    const clients = sharedProviders ?? await providers(scope);
    const { infisical, github } = clients;
    const base = { operation: input.operation, project: input.project, target: input.target };
    if (input.operation === 'setup') {
      await scopeProvision(scope, infisical, checkpoint(input, scope));
      for (const [name, policy] of Object.entries(project.secrets)) {
        if (policy.generate) await perform({ ...input, operation: 'generate', name }, clients);
      }
      const status = await perform({ ...input, operation: 'status' }, clients);
      if (status.secrets.some(secret => secret.status === 'missing' && project.secrets[secret.name].required !== false)) {
        return { ...status, ...base, status: 'pending' };
      }
      if (scope.github) {
        const github = await perform({ ...input, operation: 'provision-github' }, clients);
        status.github = github.github;
      }
      if (scope.cloudflare) {
        const worker = await perform({ ...input, operation: 'provision-worker-sync' }, clients);
        status.workerSync = worker.workerSync;
      }
      return { ...status, ...base, status: status.github?.configured === false || status.workerSync?.configured === false ? 'pending' : 'ready' };
    }
    if (input.operation === 'status') {
      const names = await secretNames(infisical, scope);
      const receipt = operation => store.data.entries[`${input.project}:${input.target}:${operation}`]?.state.completed === true;
      return {
        ...base, status: 'ready', secrets: Object.keys(project.secrets).map(name => ({ name, status: names.has(name) ? 'present' : 'missing' })),
        ...(scope.github ? { github: { configured: receipt('provision-github') } } : {}),
        ...(scope.cloudflare ? { workerSync: { configured: receipt('provision-worker-sync') } } : {}),
      };
    }
    if (input.operation === 'generate') {
      const policy = Object.hasOwn(project.secrets, input.name) && project.secrets[input.name];
      if (!policy?.generate || policy.rotation === 'provider') fail('forbidden');
      const names = await secretNames(infisical, scope);
      // Existence is sufficient to refuse replacement; neither value nor value hash is retrieved.
      if (names.has(input.name)) return { ...base, name: input.name, status: 'already-exists' };
      const receipt = checkpoint(input, scope);
      receipt.state.keys ??= {};
      if (receipt.state.keys[input.name]) fail('conflict');
      receipt.state.keys[input.name] = 'pending';
      await receipt.save();
      const secretValue = entropy(policy.bytes ?? 32).toString('base64url');
      const result = await infisical(`/api/v4/secrets/${input.name}`, { method: 'POST', body: {
        projectId: scope.projectId, environment: scope.environment, secretPath: scope.secretPath,
        secretValue, type: 'shared', skipMultilineEncoding: true,
      } });
      if (result.approval) fail('conflict');
      checkRecord(result.secret, scope, input.name);
      if (!(await secretNames(infisical, scope)).has(input.name)) fail('provider_failed');
      receipt.state.keys[input.name] = 'created';
      await receipt.save();
      return { ...base, name: input.name, status: 'created' };
    }
    const receipt = checkpoint(input, scope);
    const nested = key => ({ state: receipt.state[key] ??= {}, save: receipt.save });
    let result;
    if (input.operation === 'provision-github') {
      if (!scope.github) fail('forbidden');
      await credentialsProvision(scope, infisical, nested('credentials'), env);
      result = await githubProvision(scope, { infisical, github, checkpoint: nested('github') });
    } else {
      if (!scope.cloudflare) fail('forbidden');
      const names = await secretNames(infisical, scope);
      if ([...names].some(name => !Object.hasOwn(project.secrets, name))) fail('conflict');
      const connection = nested('connection');
      const credentials = scope.cloudflare.connectionId || connection.state.connectionId ? {}
        : await credentialsProvision(scope, infisical, nested('credentials'), env);
      await connectionProvision(scope, { infisical, checkpoint: connection, credentials });
      const resolved = { ...scope, cloudflare: { ...scope.cloudflare, connectionId: connection.state.connectionId } };
      result = await workerProvision(resolved, { infisical, checkpoint: nested('sync') });
    }
    if (!['configured', 'pending'].includes(result?.status)) fail('provider_failed');
    receipt.state.completed = result.status === 'configured';
    await receipt.save();
    // Reconstruct output here too: adapters cannot accidentally expose provider responses.
    const key = input.operation === 'provision-github' ? 'github' : 'workerSync';
    return { ...base, status: result.status, [key]: { configured: result.status === 'configured' } };
  }

  return {
    async execute(input, bearer) {
      validateOperation(input);
      authorize(config, bearer, input);
      if (queued >= 32) fail('unavailable');
      queued++;
      const job = queue.then(() => perform(input));
      queue = job.catch(() => {});
      try { return await job; } finally { queued--; }
    },
  };
}
