export interface PublicCachePolicy {
  /** Increment when the response representation changes. */
  version: string;
  /** Exact paths and every query key the handler understands. Unknown or duplicate keys bypass. */
  routes: Readonly<Record<string, readonly string[]>>;
  ttlSeconds?: number;
}
type Lifetime = { waitUntil(promise: Promise<unknown>): void };
type CacheStore = Pick<Cache, 'match' | 'put'>;
const PREFIX = '/__kit_public_cache/{{kit.cacheNamespace}}/';
const EXPIRES = 'x-kit-cache-expires';
const MAX_TTL = {{kit.maxTtlSeconds}};

/** A deliberately conservative cache: every eligible response must be public for all callers. */
export function publicCacheKey(request: Request, policy: PublicCachePolicy): Request | null {
  if (request.method !== 'GET') return null;
  for (const name of ['authorization', 'cookie', 'range', 'if-range', 'if-none-match', 'if-modified-since']) {
    if (request.headers.has(name)) return null;
  }
  if (/no-cache|no-store|max-age\s*=\s*0/i.test(request.headers.get('cache-control') ?? '') || request.headers.has('pragma')) return null;
  const url = new URL(request.url);
  const allowed = Object.hasOwn(policy.routes, url.pathname) ? policy.routes[url.pathname] : undefined;
  if (!allowed || !/^[A-Za-z0-9_-]{1,80}$/.test(policy.version)) return null;
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || seen.has(key)) return null;
    seen.add(key);
  }
  url.pathname = `${PREFIX}${policy.version}${url.pathname}`;
  url.hash = '';
  url.searchParams.sort();
  return new Request(url.toString());
}

function ttl(response: Response, requested: number): number {
  if (response.status !== 200 || response.headers.has('set-cookie') || response.headers.has('vary')) return 0;
  const cc = response.headers.get('cache-control') ?? '';
  if (!/(?:^|,)\s*public\s*(?:,|$)/i.test(cc) || /private|no-store|no-cache/i.test(cc)) return 0;
  const ages = [...cc.matchAll(/(?:^|,)\s*(?:s-maxage|max-age)\s*=\s*(\d+)\s*(?=,|$)/gi)].map((m) => Number(m[1]));
  if (!ages.length || !Number.isFinite(requested) || requested <= 0) return 0;
  return Math.floor(Math.min(requested, MAX_TTL, ...ages));
}

export async function withPublicEdgeCache(
  request: Request,
  ctx: Lifetime,
  policy: PublicCachePolicy,
  produce: () => Promise<Response>,
  cache: CacheStore = caches.default,
): Promise<Response> {
  const key = publicCacheKey(request, policy);
  if (!key) return produce();
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) {
    const left = Math.floor((Number(hit.headers.get(EXPIRES)) - Date.now()) / 1000);
    if (Number.isFinite(left) && left > 0) {
      const headers = new Headers(hit.headers);
      headers.delete(EXPIRES);
      headers.set('cache-control', `public, max-age=${left}`);
      return new Response(hit.body, { status: hit.status, headers });
    }
    await hit.body?.cancel();
  }
  const response = await produce();
  const seconds = ttl(response, policy.ttlSeconds ?? MAX_TTL);
  if (seconds > 0) {
    const copy = response.clone();
    const headers = new Headers(copy.headers);
    headers.set('cache-control', `public, max-age=${seconds}`);
    headers.set(EXPIRES, String(Date.now() + seconds * 1000));
    // Keep the stream; buffering a whole response here would multiply memory use.
    ctx.waitUntil(cache.put(key, new Response(copy.body, { status: 200, headers })).catch(() => undefined));
    headers.delete(EXPIRES);
    return new Response(response.body, { status: response.status, headers });
  }
  return response;
}
