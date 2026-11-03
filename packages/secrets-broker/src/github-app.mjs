import { createPrivateKey, randomBytes, timingSafeEqual } from 'node:crypto';
import { APP_FIELDS, httpsOrigin } from './config.mjs';
import { fail } from './errors.mjs';
import { requestJson } from './api.mjs';
import { createSecrets, secretNames } from './secrets.mjs';

const lifetime = 15 * 60 * 1000;
const opaque = /^[A-Za-z0-9_-]{43}$/;
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export const APP_COOKIE = '__Host-kit-github-app';

function credentials(result, app) {
  if (!Number.isSafeInteger(result?.id) || result.id <= 0 ||
      result.owner?.login?.toLowerCase() !== app.owner.toLowerCase() ||
      result.owner?.type !== (app.ownerType === 'organization' ? 'Organization' : 'User')) fail('provider_failed');
  const permissions = { metadata: 'read', ...app.manifest.default_permissions };
  if (!result.permissions || Object.keys(result.permissions).length !== Object.keys(permissions).length ||
      Object.entries(permissions).some(([key, value]) => result.permissions[key] !== value) ||
      !Array.isArray(result.events) || result.events.length !== app.manifest.default_events.length ||
      app.manifest.default_events.some(event => !result.events.includes(event))) fail('provider_failed');
  const values = { appId: String(result.id), clientId: result.client_id, clientSecret: result.client_secret, privateKey: result.pem, webhookSecret: result.webhook_secret };
  if (Object.values(values).some(value => typeof value !== 'string' || !value.trim() || value.length > 16_384)) fail('provider_failed');
  try {
    const key = createPrivateKey(values.privateKey);
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) fail('provider_failed');
  } catch { fail('provider_failed'); }
  return values;
}

/** Browser capabilities stay in trusted storage; checkpoints contain no provider credentials or codes. */
export function createGitHubAppFlow({ publicOrigin, now = Date.now, entropy = randomBytes, request = fetch, pathPrefix = '/github-app', flowStorage, resolve } = {}) {
  const flows = new Map((flowStorage?.data ?? []).map(flow => [flow.id, flow]));
  const save = async () => {
    if (!flowStorage) return;
    flowStorage.data = [...flows.values()].map(({ scope, receipt, ...flow }) => flow);
    await flowStorage.save();
  };
  const context = flow => {
    if (!flow.scope || !flow.receipt) Object.assign(flow, resolve(flow.input));
    return flow;
  };
  const random = () => entropy(32).toString('base64url');
  const prune = () => { for (const [id, flow] of flows) if (flow.expires <= now()) flows.delete(id); };
  const origin = () => { if (!publicOrigin) fail('unavailable'); return httpsOrigin(publicOrigin); };

  return {
    async begin(input, scope, infisical, receipt) {
      const baseUrl = origin();
      prune();
      if (receipt.state.pending) fail('conflict');
      const names = Object.values(scope.githubApp.secrets);
      const existing = await secretNames(infisical, scope);
      const present = names.filter(name => existing.has(name));
      if (present.length === names.length) return { status: 'configured', secrets: names.map(name => ({ name, status: 'present' })) };
      if (present.length || receipt.state.completed) fail('conflict');
      const prior = [...flows.values()].find(flow => flow.input.project === input.project && flow.input.target === input.target);
      if (!prior && receipt.state.registrationStarted) fail('conflict');
      if (!prior && flows.size >= 32) fail('unavailable');
      const flow = prior ?? { id: random(), input: { ...input }, scope, receipt, expires: now() + lifetime };
      flows.set(flow.id, flow);
      await save();
      return { status: 'pending', secrets: names.map(name => ({ name, status: 'missing' })),
        ...(!flow.opened ? { approvalUrl: `${baseUrl}${pathPrefix}/start/${flow.id}` } : {}) };
    },

    preview(id) {
      prune();
      const flow = opaque.test(id) && flows.get(id);
      if (!flow || flow.opened) fail('forbidden');
      return '<!doctype html><html lang="en"><meta charset="utf-8"><title>GitHub App handoff</title>' +
        `<h1>Register ${escape(context(flow).scope.githubApp.manifest.name)}</h1>` +
        '<p>Continue in your own browser to prepare this GitHub registration.</p>' +
        `<form method="post" action="${pathPrefix}/start/${flow.id}"><button type="submit">Prepare registration</button></form></html>`;
    },

    async open(id, requestOrigin) {
      if (requestOrigin !== origin()) fail('forbidden');
      prune();
      const flow = opaque.test(id) && flows.get(id);
      if (!flow || flow.opened) fail('forbidden');
      context(flow);
      flow.opened = true;
      // The next click can register an app on GitHub. Persist intent before handing off to the browser.
      flow.receipt.state.registrationStarted = true;
      await flow.receipt.save();
      flow.state = random();
      flow.cookie = random();
      await save();
      const app = flow.scope.githubApp;
      const manifest = { ...app.manifest, redirect_url: `${origin()}${pathPrefix}/callback` };
      const action = app.ownerType === 'organization' ? `https://github.com/organizations/${app.owner}/settings/apps/new` : 'https://github.com/settings/apps/new';
      return {
        cookie: `${APP_COOKIE}=${flow.cookie}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=900`,
        html: '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="referrer" content="no-referrer">' +
          '<title>Register GitHub App</title><h1>Register GitHub App</h1>' +
          `<p>Register ${escape(app.manifest.name)} for ${escape(app.owner)}. Credentials will be saved directly to the configured vault.</p>` +
          `<form method="post" action="${escape(action)}?state=${flow.state}">` +
          `<input type="hidden" name="manifest" value="${escape(JSON.stringify(manifest))}">` +
          '<button type="submit">Continue to GitHub</button></form></html>',
      };
    },

    async consume(state, cookie) {
      prune();
      if (typeof state !== 'string' || typeof cookie !== 'string' || !opaque.test(state) || !opaque.test(cookie)) fail('forbidden');
      const flow = [...flows.values()].find(flow => flow.state === state);
      if (!flow || !timingSafeEqual(Buffer.from(flow.cookie), Buffer.from(cookie))) fail('forbidden');
      flows.delete(flow.id);
      await save();
      return flow.input;
    },

    async complete(code, scope, infisical, receipt) {
      if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(code)) fail('invalid_request');
      if (!receipt.state.registrationStarted || receipt.state.pending || receipt.state.completed) fail('conflict');
      const app = scope.githubApp;
      const existing = await secretNames(infisical, scope);
      if (Object.values(app.secrets).some(name => existing.has(name))) fail('conflict');
      receipt.state.pending = true;
      await receipt.save();
      const result = await requestJson(`https://api.github.com/app-manifests/${code}/conversions`, {
        method: 'POST', request, headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'kitbash-secrets-broker' },
      });
      const values = credentials(result, app);
      await createSecrets(infisical, scope, APP_FIELDS.map(field => ({ name: app.secrets[field], value: values[field] })));
      const confirmed = await secretNames(infisical, scope);
      if (Object.values(app.secrets).some(name => !confirmed.has(name))) fail('provider_failed');
      receipt.state.pending = false;
      receipt.state.completed = true;
      await receipt.save();
    },
  };
}
