import { describe, expect, it, vi } from 'vitest';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { publicCacheKey, withPublicEdgeCache } from '{{paths.lib|rel}}/public-edge-cache/public-edge-cache';
const policy = { version: 'v1', routes: { '/catalog': ['page', 'q'] } };
const req = (path = '/catalog', init?: RequestInit) => new Request(`https://example.com${path}`, init);
const response = () => new Response('catalog', { headers: { 'cache-control': 'public, max-age=60' } });

function memoryCache() {
  const saved = new Map<string, Response>();
  return {
    saved,
    match: vi.fn(async (r: RequestInfo | URL) => saved.get(new Request(r).url)?.clone()),
    put: vi.fn(async (r: RequestInfo | URL, value: Response) => { saved.set(new Request(r).url, value.clone()); }),
  };
}
describe('public edge cache', () => {
  it('canonicalizes order while preserving host, path, full values and version', () => {
    expect(publicCacheKey(req('/catalog?q=abc&page=2'), policy)?.url).toBe(publicCacheKey(req('/catalog?page=2&q=abc'), policy)?.url);
    const key = publicCacheKey(req('/catalog?q=' + 'x'.repeat(80)), policy)!;
    expect(new URL(key.url).searchParams.get('q')).toHaveLength(80);
    expect(key.url).not.toBe(publicCacheKey(req('/catalog?q=' + 'x'.repeat(79)), policy)?.url);
    expect(key.url).not.toBe(publicCacheKey(new Request('https://other.example/catalog?q=' + 'x'.repeat(80)), policy)?.url);
    expect(key.url).not.toBe(publicCacheKey(req('/catalog?q=' + 'x'.repeat(80)), { ...policy, version: 'v2' })?.url);
  });
  it.each(['/private', '/toString', '/catalog?unknown=1', '/catalog?page=1&page=2'])('bypasses ambiguous or unlisted URL %s', (path) => {
    expect(publicCacheKey(req(path), policy)).toBeNull();
  });
  it.each(['authorization', 'cookie', 'range', 'if-none-match', 'if-modified-since', 'pragma'])('bypasses %s', (name) => {
    expect(publicCacheKey(req('/catalog', { headers: { [name]: 'present' } }), policy)).toBeNull();
  });
  it('bypasses mutations and explicit revalidation', () => {
    expect(publicCacheKey(req('/catalog', { method: 'POST' }), policy)).toBeNull();
    expect(publicCacheKey(req('/catalog', { headers: { 'cache-control': 'no-cache' } }), policy)).toBeNull();
  });
  it('writes and reads the real workerd Cache API, with remaining TTL and no internal header', async () => {
    const cache = await caches.open(`public-cache-test-${crypto.randomUUID()}`);
    const ctx = createExecutionContext();
    const produce = vi.fn(async () => response());
    expect(await (await withPublicEdgeCache(req(), ctx, policy, produce, cache)).text()).toBe('catalog');
    await waitOnExecutionContext(ctx);
    const hit = await withPublicEdgeCache(req(), ctx, policy, produce, cache);
    expect(await hit.text()).toBe('catalog');
    expect(produce).toHaveBeenCalledTimes(1);
    expect(hit.headers.has('x-kit-cache-expires')).toBe(false);
    expect(hit.headers.get('cache-control')).toMatch(/^public, max-age=\d+$/);
  });
  const nonPublicHeaders: Record<string, string>[] = [
    { 'cache-control': 'private, max-age=60' },
    { 'cache-control': 'public, no-store, max-age=60' },
    { 'cache-control': 'public, max-age=60, s-maxage=0' },
    { 'cache-control': 'public, max-age=60', 'set-cookie': 'session=value' },
    { 'cache-control': 'public, max-age=60', vary: 'Accept-Language' },
    { 'cache-control': 'max-age=60' },
  ];
  it.each(nonPublicHeaders)('never stores a non-public representation: %o', async (headers) => {
    const cache = memoryCache(), ctx = createExecutionContext();
    await withPublicEdgeCache(req(), ctx, policy, async () => new Response('private', { headers }), cache);
    await waitOnExecutionContext(ctx);
    expect(cache.put).not.toHaveBeenCalled();
  });
  it('applies the same TTL cap to the initial response and stored representation', async () => {
    const cache = memoryCache(), ctx = createExecutionContext();
    const first = await withPublicEdgeCache(req(), ctx, { ...policy, ttlSeconds: 2 }, async () => new Response('catalog', { headers: { 'cache-control': 'public, max-age=3600' } }), cache);
    expect(first.headers.get('cache-control')).toBe('public, max-age=2');
    expect(first.headers.has('x-kit-cache-expires')).toBe(false);
    await waitOnExecutionContext(ctx);
    expect(cache.saved.get(publicCacheKey(req(), policy)!.url)!.headers.get('cache-control')).toBe('public, max-age=2');
  });
  it('rejects expired hits even if the cache still returns one', async () => {
    const cache = memoryCache(), ctx = createExecutionContext();
    cache.saved.set(publicCacheKey(req(), policy)!.url, new Response('old', { headers: { 'x-kit-cache-expires': '1' } }));
    expect(await (await withPublicEdgeCache(req(), ctx, policy, async () => response(), cache)).text()).toBe('catalog');
    await waitOnExecutionContext(ctx);
  });
  it('serves origin on cache failures and never stores errors', async () => {
    const ctx = createExecutionContext();
    const cache = { match: vi.fn(async () => { throw new Error('cache unavailable'); }), put: vi.fn(async () => { throw new Error('cache unavailable'); }) };
    expect(await (await withPublicEdgeCache(req(), ctx, policy, async () => response(), cache)).text()).toBe('catalog');
    await waitOnExecutionContext(ctx);
    const memory = memoryCache();
    await withPublicEdgeCache(req(), ctx, policy, async () => new Response('failed', { status: 500 }), memory);
    expect(memory.put).not.toHaveBeenCalled();
  });
});
