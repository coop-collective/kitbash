import type { Session } from './room';
export { Room } from './room';
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/rooms/')) return env.ASSETS.fetch(request);
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    if (!/^\/rooms\/[a-zA-Z0-9_-]{1,80}$/.test(url.pathname) || url.search) return new Response('Invalid room', { status: 400 });
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Upgrade required', { status: 426 });
    if (request.headers.get('origin') !== url.origin) return new Response('Forbidden origin', { status: 403 });
    // The auth service must validate the cookie AND membership in this requested room.
    let session: Session;
    try {
      const auth = await env.AUTH.fetch(new Request('https://auth.internal/authorize-room', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: request.headers.get('cookie') ?? '' },
        body: JSON.stringify({ room: url.pathname.slice('/rooms/'.length) }),
      }));
      if (!auth.ok) return new Response('Unauthorized', { status: 401 });
      session = await auth.json<Session>();
      if (![session.userId, session.tenantId].every((s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(s)) ||
        !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return new Response('Unauthorized', { status: 401 });
    } catch { return new Response('Auth unavailable', { status: 503 }); }
    const headers = new Headers({ upgrade: 'websocket', 'x-room-user': session.userId, 'x-room-tenant': session.tenantId,
      'x-room-expires': String(Math.min(session.expiresAt, Date.now() + 300_000)) });
    const name = JSON.stringify([session.tenantId, url.pathname.slice('/rooms/'.length)]);
    return env.ROOMS.getByName(name).fetch(new Request(request.url, { headers }));
  },
} satisfies ExportedHandler<Env>;
