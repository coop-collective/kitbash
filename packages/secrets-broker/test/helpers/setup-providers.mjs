// In-memory provider fixture. No login, real provider calls, or real credentials.
export const ACCOUNT = 'a'.repeat(32);
export const ZONE = 'b'.repeat(32);
export const TOKEN_ID = 'c'.repeat(32);
export const DEPLOY_TOKEN = 'cfat_fixture_deployment_token_not_a_real_credential';
export const BOOTSTRAP_TOKEN = 'cfat_fixture_setup_token_not_a_real_credential';
export const PROJECT = '12345678-1234-4123-8123-123456789abc';
const uuid = number => `11111111-1111-4111-8111-${String(number).padStart(12, '0')}`;

export function setupProviders() {
  const records = { roles: {}, identities: {}, memberships: {}, oidc: {}, variables: {}, folders: {}, secrets: [], tokens: [], environments: {} };
  const calls = [];
  const modes = { githubEnvironment: true, remote: false, tokenStatus: 'active' };
  const zone = { id: ZONE, name: 'example.test', account: { id: ACCOUNT }, status: 'active' };
  const permissionGroups = [
    ['Workers Scripts Write', 'account'], ['Account Settings Read', 'account'],
    ['Workers Routes Write', 'account.zone'], ['Zone Read', 'account.zone'],
  ].map(([name, scope], i) => ({ id: String(i + 1).repeat(32), name, scopes: [`com.cloudflare.api.${scope}`] }));
  const missing = () => Response.json({}, { status: 404 });
  async function request(input, options = {}) {
    const url = new URL(input);
    const p = url.pathname;
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url: url.href, path: p, method, body, options });
    if (url.origin === 'https://api.github.com') {
      if (p === '/repos/test-org/template-copy') return Response.json({ id: 123, owner: { id: 456 }, full_name: 'test-org/template-copy', default_branch: 'main' });
      if (p === '/repos/test-org/template-copy/environments/production') {
        if (method === 'PUT') modes.githubEnvironment = true;
        return modes.githubEnvironment ? Response.json({ name: 'production', protection_rules: [{ type: 'required_reviewers' }] }) : missing();
      }
      if (p.endsWith('/variables') && method === 'POST') { records.variables[body.name] = body; return Response.json({}); }
      if (p.includes('/variables/')) return records.variables[p.split('/').at(-1)] ? Response.json(records.variables[p.split('/').at(-1)]) : missing();
    }
    if (url.origin === 'https://vault.example.test') {
      if (p.includes('/environments/slug/')) {
        const slug = p.split('/').at(-1);
        return records.environments[slug] ? Response.json({ environment: records.environments[slug] }) : missing();
      }
      if (p === `/api/v1/projects/${PROJECT}/environments` && method === 'POST') {
        records.environments[body.slug] = { ...body, id: uuid(100), projectId: PROJECT };
        return Response.json({ environment: records.environments[body.slug] });
      }
      if (p === '/api/v2/folders') {
        if (method === 'POST') {
          (records.folders[body.path] ??= []).push({ name: body.name, envId: uuid(100) });
          return Response.json({});
        }
        return Response.json({ folders: records.folders[url.searchParams.get('path')] ?? [] });
      }
      if (p.endsWith('/roles') && method === 'POST') {
        const role = { ...body, projectId: PROJECT, id: uuid(Object.keys(records.roles).length + 1) };
        records.roles[role.slug] = role;
        return Response.json({ role });
      }
      if (p.includes('/roles/slug/')) {
        const role = records.roles[p.split('/').at(-1)];
        return role ? Response.json({ role }) : missing();
      }
      if (p === `/api/v1/projects/${PROJECT}/identities` && method === 'POST') {
        const identity = { id: uuid(Object.keys(records.identities).length + 10), name: body.name, projectId: PROJECT, authMethods: [] };
        records.identities[identity.id] = identity;
        records.memberships[identity.id] = { project: { id: PROJECT }, identityId: identity.id, roles: [{ customRoleId: records.roles[body.roles[0].role].id, isTemporary: false }] };
        return Response.json({ identity });
      }
      if (p.startsWith('/api/v1/auth/oidc-auth/identities/')) {
        const id = p.split('/').at(-1);
        if (method === 'POST') { records.oidc[id] = { identityId: id, ...body }; records.identities[id].authMethods.push('oidc-auth'); }
        return records.oidc[id] ? Response.json({ identityOidcAuth: records.oidc[id] }) : missing();
      }
      if (p.includes('/identity-memberships/')) return Response.json({ identityMembership: records.memberships[p.split('/').at(-1)] });
      if (p.includes('/identities/')) return Response.json({ identity: records.identities[p.split('/').at(-1)] });
      if (p === '/api/v4/secrets') return Response.json({ secrets: records.secrets });
      if (p === '/api/v4/secrets/batch' && method === 'POST') {
        if (modes.failVaultBeforeWrite) throw new Error(DEPLOY_TOKEN);
        records.secrets = body.secrets.map(row => ({ ...row, workspace: body.projectId, environment: body.environment, secretPath: body.secretPath, type: 'shared' }));
        if (modes.loseVaultResponse) throw new Error(DEPLOY_TOKEN);
        return Response.json({});
      }
    }
    if (url.origin === 'https://api.cloudflare.com') {
      const ok = result => Response.json({ success: true, result });
      if (p === '/client/v4/zones') return ok(url.searchParams.get('name') === zone.name ? [zone] : []);
      if (p === `/client/v4/zones/${ZONE}`) return ok(zone);
      if (p === `/client/v4/accounts/${ACCOUNT}/workers/scripts`) return ok([]);
      if (p.endsWith('/tokens/permission_groups')) return ok(permissionGroups);
      if (p.endsWith('/tokens/verify')) return ok({ id: TOKEN_ID, status: modes.tokenStatus });
      if (p === `/client/v4/accounts/${ACCOUNT}/tokens`) {
        if (method === 'GET') return Response.json({ success: true, result: records.tokens, result_info: { total_count: records.tokens.length, per_page: 50, page: 1 } });
        const token = { ...body, id: TOKEN_ID, value: DEPLOY_TOKEN, status: 'active' };
        records.tokens.push({ ...body, id: TOKEN_ID, status: 'active' });
        if (modes.loseTokenResponse) throw new Error(DEPLOY_TOKEN);
        return ok(token);
      }
      if (p.endsWith('/secrets')) {
        if (modes.denied) return Response.json({ success: false, errors: [{ message: DEPLOY_TOKEN }] }, { status: 403 });
        if (modes.unknown404) return Response.json({ success: false, errors: [] }, { status: 404 });
        if (!modes.remote) return Response.json({ success: false, errors: [{ code: 10007 }] }, { status: 404 });
        return ok([{ name: 'KIT_BROKER_TOKEN_SHA256', type: 'secret_text' }]);
      }
    }
    throw new Error(`Unexpected fixture route: ${method} ${url.origin}${p}`);
  }
  return { request, records, calls, modes, zone, permissionGroups };
}
