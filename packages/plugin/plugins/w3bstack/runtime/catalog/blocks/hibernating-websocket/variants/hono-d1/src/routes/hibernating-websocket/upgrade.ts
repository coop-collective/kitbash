import type { {{kit.className}}, Session } from '{{paths.lib|rel}}/hibernating-websocket/room';
import { Hono } from 'hono';

export type AuthorizeRoom = (request: Request, room: string) => Promise<Session | null>;

/** Mount at / when authorization is supplied as a closure over the host's services. */
export function createRoomRoutes(authorize: AuthorizeRoom) {
  const routes = new Hono<{ Bindings: { {{kit.bindingName}}: DurableObjectNamespace<{{kit.className}}> } }>();
  routes.get('{{kit.routePrefix}}/:room', (c) => handleRoomUpgrade(c.req.raw, c.env.{{kit.bindingName}}, authorize));
  return routes;
}

/** Mount in the existing Worker. The callback must validate both session and room membership. */
export async function handleRoomUpgrade(
  request: Request,
  rooms: DurableObjectNamespace<{{kit.className}}>,
  authorize: AuthorizeRoom,
): Promise<Response> {
  const url = new URL(request.url), prefix = '{{kit.routePrefix}}/';
  if (!url.pathname.startsWith(prefix)) return new Response('Not found', { status: 404 });
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const room = url.pathname.slice(prefix.length);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(room) || url.search) return new Response('Invalid room', { status: 400 });
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Upgrade required', { status: 426 });
  if (request.headers.get('origin') !== url.origin) return new Response('Forbidden origin', { status: 403 });
  let session: Session | null;
  try { session = await authorize(request, room); }
  catch { return new Response('Auth unavailable', { status: 503 }); }
  if (!session || ![session.userId, session.tenantId].every((s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(s)) ||
      !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return new Response('Unauthorized', { status: 401 });
  // Replace all client-supplied identity headers. Only this gateway reaches the bound DO.
  const headers = new Headers({ upgrade: 'websocket', 'x-room-user': session.userId, 'x-room-tenant': session.tenantId,
    'x-room-expires': String(Math.min(session.expiresAt, Date.now() + {{kit.leaseSeconds}} * 1000)) });
  const name = JSON.stringify([session.tenantId, room]);
  return rooms.getByName(name).fetch(new Request(request.url, { headers }));
}
