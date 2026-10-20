type Session = { tenantId: string };
type Forward = (tenantId: string, request: Request) => Promise<Response>;
const MAX_BYTES = 1_048_576;
/** Only one operation is exposed; credentials and caller-selected hosts/ports never reach the container. */
export async function gateway(request: Request, authorize: (request: Request) => Promise<Session | null>, forward: Forward): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '{{kit.routePath}}' || url.search) return new Response('Not found', { status: 404 });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
  if (request.headers.has('upgrade')) return new Response('Upgrade forbidden', { status: 400 });
  let session: Session | null;
  try { session = await authorize(request); } catch { return new Response('Auth unavailable', { status: 503 }); }
  if (!session || typeof session.tenantId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(session.tenantId)) return new Response('Unauthorized', { status: 401 });
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) return new Response('Payload too large', { status: 413 });
  const reader = request.body?.getReader(), body = new Uint8Array(MAX_BYTES);
  let bytes = 0, timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader?.cancel().catch(() => {}); }, 10_000);
  try {
    if (reader) for (;;) {
      const { value, done } = await reader.read();
      if (timedOut) return new Response('Request timeout', { status: 408 });
      if (done) break;
      if (value.byteLength > MAX_BYTES - bytes) { await reader.cancel(); return new Response('Payload too large', { status: 413 }); }
      body.set(value, bytes);
      bytes += value.byteLength;
    }
  } catch { return new Response('Invalid body', { status: 400 }); }
  finally { clearTimeout(timer); reader?.releaseLock(); }
  const upstream = new Request('http://container.internal/hash', {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: body.subarray(0, bytes),
  });
  try {
    const response = await forward(session.tenantId, upstream);
    return new Response(response.body, { status: response.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch { return new Response('Container unavailable', { status: 503 }); }
}
