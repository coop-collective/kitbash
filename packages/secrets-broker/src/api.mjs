import { BrokerError, fail } from './errors.mjs';
import { httpsOrigin } from './config.mjs';
import { cloudflareSecretStore } from './cloudflare-store.mjs';

// Nothing below logs requests, provider errors, login bodies, or raw responses.
export async function requestJson(url, { headers, method = 'GET', body, request = fetch } = {}) {
  const failed = (phase, status) => {
    const error = new BrokerError('provider_failed', status);
    error.phase = phase;
    throw error;
  };
  const controller = new AbortController();
  // Clear completed request timers so Durable Objects can evict immediately after an operation.
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    let response;
    try {
      response = await request(url, {
        method, headers: { 'content-type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // Workers supports manual/follow, but not the Fetch standard's error
        // mode. Manual plus the non-2xx check below still refuses redirects.
        redirect: 'manual', signal: controller.signal,
      });
    } catch { failed('transport'); }
    if (!response.ok || response.redirected) {
      await response.body?.cancel().catch(() => {});
      failed('response', response.status);
    }
    if (response.status === 204) return {};
    let value;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) fail('provider_failed');
        chunks.push(chunk);
      }
      value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { failed('decode'); }
    if (!value || typeof value !== 'object') failed('shape');
    if (value.approval) fail('conflict');
    return value;
  } finally { clearTimeout(timer); }
}

function providerApi(origin, token, request, extraHeaders = {}) {
  return (endpoint, { method, query, body } = {}) => {
    if (!endpoint.startsWith('/api/') && origin !== 'https://api.github.com') fail('invalid_request');
    const url = new URL(endpoint, origin);
    if (url.origin !== origin || url.hash || url.username || url.password) fail('invalid_request');
    if (query) url.search = new URLSearchParams(query).toString();
    return requestJson(url, { method, body, request, headers: { authorization: `Bearer ${token}`, ...extraHeaders } });
  };
}

/** Server process credentials only; never reads agent workspace files or a local CLI login. */
export function makeProviders({ env = process.env, request = fetch } = {}) {
  return async scope => {
    if (scope.backend === 'cloudflare-secrets-store') return {
      storage: cloudflareSecretStore(scope, { token: env.KIT_BROKER_SECRETS_API_TOKEN, request }),
    };
    const domain = httpsOrigin(scope.domain);
    let token = env.INFISICAL_TOKEN;
    if (!token) {
      if (!env.INFISICAL_CLIENT_ID || !env.INFISICAL_CLIENT_SECRET) fail('unavailable');
      const result = await requestJson(new URL('/api/v1/auth/universal-auth/login', domain), {
        method: 'POST', body: { clientId: env.INFISICAL_CLIENT_ID, clientSecret: env.INFISICAL_CLIENT_SECRET }, request,
      });
      token = result.accessToken;
    }
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) fail('unavailable');
    const github = env.GITHUB_TOKEN
      ? providerApi('https://api.github.com', env.GITHUB_TOKEN, request, { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'kitbash-secrets-broker' })
      : async () => fail('unavailable');
    return { infisical: providerApi(domain, token, request), github };
  };
}
