import { randomUUID } from 'node:crypto';
import { fail, publicError } from './errors.mjs';
import { createSecretsMcp } from './mcp.mjs';
import { APP_COOKIE } from './github-app.mjs';

const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
export function errorResponse(error) {
  const output = publicError(error);
  return Response.json(output, { headers, status: { forbidden: 403, invalid_request: 400, conflict: 409, unavailable: 503, provider_failed: 502 }[output.error.code] });
}

async function readJson(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') fail('invalid_request');
  const reader = request.body?.getReader();
  if (!reader) fail('invalid_request');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 8192) fail('invalid_request');
      chunks.push(part.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('invalid_request'); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Shared HTTP boundary for the Node host and Cloudflare Worker. Never log URLs, bodies, or headers. */
export function createBrokerHandler(service, { audit = entry => console.log(JSON.stringify(entry)), githubAppPrefix = '/github-app' } = {}) {
  const mcp = createSecretsMcp(service, audit);
  return {
    close: () => mcp.close(),
    async fetch(request) {
      const requestId = randomUUID();
      try {
        const url = new URL(request.url);
        const route = url.pathname + url.search;
        const start = route.startsWith(`${githubAppPrefix}/start/`) && /^[A-Za-z0-9_-]{43}$/.test(route.slice(githubAppPrefix.length + 7))
          ? route.slice(githubAppPrefix.length + 7) : null;
        if (request.headers.has('origin') && !(start && request.method === 'POST')) fail('forbidden');
        const callback = url.pathname === `${githubAppPrefix}/callback`;
        if (start || callback || route === `${githubAppPrefix}/complete`) {
          if (request.method !== 'GET' && !(start && request.method === 'POST')) fail('invalid_request');
          const browserHeaders = { ...headers, 'content-security-policy': "default-src 'none'; frame-ancestors 'none'; form-action 'self' https://github.com; base-uri 'none'" };
          if (start) {
            const page = request.method === 'POST' ? await service.openGitHubApp(start, request.headers.get('origin')) : { html: await service.previewGitHubApp(start) };
            return new Response(page.html, { headers: { ...browserHeaders, 'content-type': 'text/html; charset=utf-8', ...(page.cookie ? { 'set-cookie': page.cookie } : {}) } });
          }
          if (callback) {
            const params = url.searchParams;
            if (params.size !== 2 || !params.has('state') || !params.has('code')) fail('invalid_request');
            const cookies = (request.headers.get('cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${APP_COOKIE}=`));
            if (cookies.length !== 1) fail('forbidden');
            const result = await service.completeGitHubApp(params.get('state'), cookies[0].slice(APP_COOKIE.length + 1), params.get('code'));
            audit({ requestId, operation: result.operation, project: result.project, target: result.target, status: result.status });
            return new Response(null, { status: 303, headers: { ...browserHeaders, location: `${githubAppPrefix}/complete`, 'set-cookie': `${APP_COOKIE}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` } });
          }
          return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><title>GitHub App handoff</title><p>Return to your agent and check secret presence to confirm setup.</p></html>', { headers: { ...browserHeaders, 'content-type': 'text/html; charset=utf-8' } });
        }
        if (!['/v1/operations', '/mcp', '/health'].includes(route)) fail('invalid_request');
        const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.get('authorization') ?? '');
        if (!match) fail('forbidden');
        const principalId = await service.authenticate(match[1]);
        if (route === '/health' && request.method === 'GET') return Response.json({ status: 'ready' }, { headers });
        if (route === '/mcp') {
          const body = request.method === 'POST' ? await readJson(request) : undefined;
          const result = await mcp.fetch(request, { ...(body === undefined ? {} : { parsedBody: body }), authInfo: { token: match[1], clientId: principalId, scopes: [], extra: { requestId } } });
          const responseHeaders = new Headers(result.headers);
          for (const [key, value] of Object.entries(headers)) if (key !== 'content-type') responseHeaders.set(key, value);
          return new Response(result.body, { status: result.status, headers: responseHeaders });
        }
        if (route !== '/v1/operations' || request.method !== 'POST') fail('invalid_request');
        const output = await service.execute(await readJson(request), match[1]);
        audit({ requestId, operation: output.operation, project: output.project, target: output.target, status: output.status });
        return Response.json(output, { headers });
      } catch (error) {
        audit({ requestId, code: publicError(error).error.code });
        return errorResponse(error);
      }
    },
  };
}
