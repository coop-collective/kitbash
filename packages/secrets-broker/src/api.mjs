import { BrokerError, fail } from './errors.mjs';
import { httpsOrigin } from './config.mjs';

// Nothing below logs requests, provider errors, login bodies, or raw responses.
export async function requestJson(url, { headers, method = 'GET', body, request = fetch } = {}) {
  let response;
  try {
    response = await request(url, {
      method, headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
  } catch { fail('provider_failed'); }
  if (!response.ok || response.redirected) {
    await response.body?.cancel().catch(() => {});
    throw new BrokerError('provider_failed', response.status);
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
  } catch { fail('provider_failed'); }
  if (!value || typeof value !== 'object') fail('provider_failed');
  if (value.approval) fail('conflict');
  return value;
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
