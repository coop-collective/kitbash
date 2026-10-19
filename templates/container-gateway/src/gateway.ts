type Session = { tenantId: string };
type Forward = (tenantId: string, request: Request) => Promise<Response>;
/** Auth and route policy stay outside the container. There is no arbitrary port/path proxy. */
export async function gateway(request: Request, authorize: (request: Request) => Promise<Session | null>, forward: Forward): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '/hash' || url.search) return new Response('Not found', { status: 404 });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
  if (request.headers.has('upgrade')) return new Response('Upgrade forbidden', { status: 400 });
  let session: Session | null;
  try { session = await authorize(request); } catch { return new Response('Auth unavailable', { status: 503 }); }
  if (!session || typeof session.tenantId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(session.tenantId)) return new Response('Unauthorized', { status: 401 });
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 1_048_576)) return new Response('Payload too large', { status: 413 });
  // Credentials, caller identity, target host and port are never forwarded.
  const upstream = new Request('http://container.internal/hash', {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: request.body,
    duplex: 'half',
  } as RequestInit);
  try { return await forward(session.tenantId, upstream); }
  catch { return new Response('Container unavailable', { status: 503 }); }
}
