import { fail } from './errors.mjs';

/** Setup may create the exact policy environment/folders, never a project or an arbitrary path. */
export async function ensureScope(scope, api, checkpoint) {
  const { state, save } = checkpoint;
  state.scope ??= {};
  const pending = state.scope;
  async function createOnce(key, endpoint, body) {
    if (pending[key]) fail('conflict');
    pending[key] = true;
    await save();
    await api(endpoint, { method: 'POST', body });
    // Keep the intent until readback below. A timeout or approval never silently retries.
  }
  const endpoint = `/api/v1/projects/${scope.projectId}/environments/slug/${scope.environment}`;
  let result;
  try { result = await api(endpoint); } catch (error) {
    if (error.status !== 404) throw error;
    await createOnce('environment', `/api/v1/projects/${scope.projectId}/environments`, {
      name: scope.environment, slug: scope.environment,
    });
    result = await api(endpoint);
  }
  const environment = result?.environment;
  if (environment?.projectId !== scope.projectId || environment.slug !== scope.environment || environment.softDeletedAt || !environment.id) fail('provider_failed');
  delete pending.environment;
  await save();
  const paths = [...new Set([scope.secretPath, ...(scope.github || scope.cloudflare ? ['/ci'] : [])])];
  for (const folder of paths) {
    let parent = '/';
    for (const name of folder.slice(1).split('/')) {
      const query = { projectId: scope.projectId, environment: scope.environment, path: parent, recursive: 'false' };
      const list = async () => {
        const result = await api('/api/v2/folders', { query });
        if (!Array.isArray(result?.folders)) fail('provider_failed');
        const matches = result.folders.filter(row => row.name === name);
        if (matches.length > 1 || (matches.length && matches[0].envId !== environment.id)) fail('provider_failed');
        return matches.length === 1;
      };
      const key = parent === '/' ? `/${name}` : `${parent}/${name}`;
      if (!(await list())) {
        await createOnce(key, '/api/v2/folders', { projectId: scope.projectId, environment: scope.environment, path: parent, name });
        if (!(await list())) fail('provider_failed');
      }
      delete pending[key];
      await save();
      parent = key;
    }
  }
}
