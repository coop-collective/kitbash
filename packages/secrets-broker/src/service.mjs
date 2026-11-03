import { createHash, randomBytes } from 'node:crypto';
import { authenticate, authorize, validateConfig, validateOperation } from './config.mjs';
import { fail } from './errors.mjs';
import { makeProviders } from './api.mjs';
import { connectCloudflare, provisionGitHub, provisionWorkerSync } from './provision.mjs';
import { ensureScope } from './scope.mjs';
import { ensureCloudflareCredentials } from './credentials.mjs';
import { createSecret, secretNames } from './secrets.mjs';
import { createGitHubAppFlow } from './github-app.mjs';

/** This service never loads, executes, or trusts code/config from the agent's repo. */
export function createService(config, store, { env = process.env, providers = makeProviders({ env }), entropy = randomBytes, githubProvision = provisionGitHub, workerProvision = provisionWorkerSync, scopeProvision = ensureScope, credentialsProvision = ensureCloudflareCredentials, connectionProvision = connectCloudflare, githubAppFlow, githubAppOptions = {} } = {}) {
  validateConfig(config);
  let queue = Promise.resolve();
  let queued = 0;

  async function enqueue(work) {
    if (queued >= 32) fail('unavailable');
    queued++;
    const job = queue.then(work);
    queue = job.catch(() => {});
    try { return await job; } finally { queued--; }
  }

  function scopeOf(input) {
    const project = config.projects[input.project];
    if (project.backend === 'cloudflare-secrets-store') return {
      ...project.targets[input.target], backend: project.backend, accountId: project.accountId, storeId: project.storeId,
    };
    return { ...project.targets[input.target], projectId: project.projectId, projectSlug: project.projectSlug, domain: project.domain };
  }

  function checkpoint(input, scope) {
    const key = `${input.project}:${input.target}:${input.operation}`;
    const digest = createHash('sha256').update(JSON.stringify(scope)).digest('hex');
    const entry = store.data.entries[key] ??= { digest, state: {} };
    if (entry.digest !== digest) fail('conflict');
    return { state: entry.state, save: store.save };
  }

  githubAppFlow ??= createGitHubAppFlow({
    publicOrigin: env.KIT_BROKER_PUBLIC_ORIGIN, ...githubAppOptions,
    resolve(input) {
      validateOperation(input);
      if (!config.projects[input.project]?.targets[input.target]?.githubApp) fail('forbidden');
      const scope = scopeOf(input);
      return { scope, receipt: checkpoint(input, scope) };
    },
  });

  async function perform(input, sharedProviders) {
    const project = config.projects[input.project];
    const scope = scopeOf(input);
    if (input.operation === 'presence' && !Object.hasOwn(project.secrets, input.name)) fail('forbidden');
    const clients = sharedProviders ?? await providers(scope);
    const { infisical, github } = clients;
    const storage = clients.storage ?? infisical;
    const ensure = receipt => clients.storage ? secretNames(storage, scope) : scopeProvision(scope, infisical, receipt);
    const base = { operation: input.operation, project: input.project, target: input.target };
    if (input.operation === 'provision-github-app') {
      if (!scope.githubApp) fail('forbidden');
      const receipt = checkpoint(input, scope);
      await ensure(receipt);
      return { ...base, ...await githubAppFlow.begin(input, scope, storage, receipt) };
    }
    if (input.operation === 'presence') {
      const names = await secretNames(storage, scope);
      return { ...base, name: input.name, status: names.has(input.name) ? 'present' : 'missing' };
    }
    if (input.operation === 'setup') {
      await ensure(checkpoint(input, scope));
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
      const names = await secretNames(storage, scope);
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
      const names = await secretNames(storage, scope);
      // Existence is sufficient to refuse replacement; neither value nor value hash is retrieved.
      if (names.has(input.name)) return { ...base, name: input.name, status: 'already-exists' };
      const receipt = checkpoint(input, scope);
      receipt.state.keys ??= {};
      if (receipt.state.keys[input.name]) fail('conflict');
      receipt.state.keys[input.name] = 'pending';
      await receipt.save();
      const secretValue = entropy(policy.bytes ?? 32).toString('base64url');
      await createSecret(storage, scope, input.name, secretValue);
      if (!(await secretNames(storage, scope)).has(input.name)) fail('provider_failed');
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
    // Authenticate discovery and protocol requests too, before any MCP response is served.
    authenticate(bearer) { return authenticate(config, bearer).id; },
    previewGitHubApp(id) { return githubAppFlow.preview(id); },
    openGitHubApp(id, origin) { return enqueue(() => githubAppFlow.open(id, origin)); },
    async completeGitHubApp(state, cookie, code) {
      return enqueue(async () => {
        const input = await githubAppFlow.consume(state, cookie);
        const scope = scopeOf(input);
        const receipt = checkpoint(input, scope);
        const clients = await providers(scope);
        await githubAppFlow.complete(code, scope, clients.storage ?? clients.infisical, receipt);
        return { ...input, status: 'configured' };
      });
    },
    async execute(input, bearer) {
      validateOperation(input);
      authorize(config, bearer, input);
      return enqueue(() => perform(input));
    },
  };
}
