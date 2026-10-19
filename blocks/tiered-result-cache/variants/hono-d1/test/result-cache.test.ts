import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { createResultCache, type ResultKey } from '{{paths.lib|rel}}/result-cache';
const key = (): ResultKey => ({ scope: 'catalog', tenant: crypto.randomUUID(), version: 'r1', parts: ['summary'] });
const parse = (value: unknown): { count: number } => {
  if (!value || typeof value !== 'object' || typeof (value as { count?: unknown }).count !== 'number') throw new Error('Invalid count');
  return value as { count: number };
};
function edgeStore() {
  const values = new Map<string, string>();
  return {
    values,
    match: vi.fn(async (input: RequestInfo | URL) => { const text = values.get(new Request(input).url); return text === undefined ? undefined : new Response(text); }),
    put: vi.fn(async (input: RequestInfo | URL, response: Response) => { values.set(new Request(input).url, await response.text()); }),
  };
}
function kvStore() {
  const values = new Map<string, string>();
  return {
    values,
    get: vi.fn(async (key: string, _type: 'stream') => { const text = values.get(key); return text === undefined ? null : new Response(text).body; }),
    put: vi.fn(async (key: string, value: string, _options: { expirationTtl: number }) => { values.set(key, value); }),
  };
}
function setup() {
  let time = Date.now();
  const ctx = createExecutionContext(), edge = edgeStore(), kv = kvStore(), errors: string[] = [];
  const options = { origin: 'https://example.com', context: ctx, edge, kv, now: () => time, onError: ({ operation }: { operation: string }) => { errors.push(operation); } };
  return { ctx, edge, kv, errors, options, advance: (ms: number) => { time += ms; }, drain: () => waitOnExecutionContext(ctx), cache: () => createResultCache(options) };
}
describe('tiered result cache', () => {
  it('loads once, serves edge, promotes KV without extending absolute expiry', async () => {
    const s = setup(), load = vi.fn(async () => ({ count: 1 })), query = { key: key(), freshSeconds: 10, parse, load };
    expect(await s.cache().get(query)).toMatchObject({ tier: 'store', stale: false, value: { count: 1 } });
    await s.drain();
    expect(s.kv.put.mock.calls[0][2].expirationTtl).toBe(60);
    expect((await s.cache().get(query)).tier).toBe('edge');
    const original = JSON.parse([...s.kv.values.values()][0]);
    s.edge.values.clear(); s.advance(6000);
    expect((await s.cache().get(query)).tier).toBe('kv'); await s.drain();
    expect(JSON.parse([...s.edge.values.values()][0]).freshUntil).toBe(original.freshUntil);
    s.advance(4001);
    expect((await s.cache().get(query)).tier).toBe('store');
    expect(load).toHaveBeenCalledTimes(2); await s.drain();
  });
  it('uses the actual workerd Cache API and optional KV binding', async () => {
    const context = createExecutionContext(), edge = await caches.open(`results-${crypto.randomUUID()}`);
    const options = { origin: 'https://example.com', context, edge, kv: env.RESULT_CACHE };
    const query = { key: key(), freshSeconds: 10, parse, load: vi.fn(async () => ({ count: 7 })) };
    expect((await createResultCache(options).get(query)).tier).toBe('store'); await waitOnExecutionContext(context);
    expect((await createResultCache({ ...options, edge: null }).get(query)).tier).toBe('kv');
    expect((await createResultCache(options).get(query)).tier).toBe('edge');
    expect(query.load).toHaveBeenCalledTimes(1);
  });
  it('isolates tenants, scopes, versions, key tuples and origins', async () => {
    const s = setup(), initial = key(), load = vi.fn(async () => ({ count: 1 }));
    for (const k of [initial, { ...initial, tenant: 'other' }, { ...initial, version: 'r2' }, { ...initial, scope: 'other' }, { ...initial, parts: ['a:b', 'c'] }, { ...initial, parts: ['a', 'b:c'] }]) {
      expect((await s.cache().get({ key: k, freshSeconds: 30, parse, load })).tier).toBe('store'); await s.drain();
    }
    expect((await createResultCache({ ...s.options, origin: 'https://other.example' }).get({ key: initial, freshSeconds: 30, parse, load })).tier).toBe('store');
    await s.drain(); expect(load).toHaveBeenCalledTimes(7); expect(s.kv.values.size).toBe(7);
  });
  it('deduplicates overlapping loaders within one request', async () => {
    const s = setup(), cache = s.cache();
    let resolve!: (value: unknown) => void;
    const load = vi.fn(() => new Promise((done) => { resolve = done; }));
    const query = { key: key(), freshSeconds: 30, parse, load };
    const reads = [cache.get(query), cache.get(query)];
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    resolve({ count: 4 });
    expect((await Promise.all(reads)).map((r) => r.value.count)).toEqual([4, 4]); await s.drain();
  });
  it('only serves stale with opt-in, refreshes asynchronously, and stops at hard expiry', async () => {
    const s = setup(), load = vi.fn(async () => ({ count: 1 })), query = { key: key(), freshSeconds: 2, staleSeconds: 3, parse, load };
    await s.cache().get(query); await s.drain(); s.advance(2001);
    load.mockResolvedValue({ count: 2 });
    expect(await s.cache().get(query)).toMatchObject({ value: { count: 1 }, stale: true }); await s.drain();
    expect(await s.cache().get(query)).toMatchObject({ value: { count: 2 }, stale: false });
    s.advance(5001); load.mockRejectedValue(new Error('store down'));
    await expect(s.cache().get(query)).rejects.toThrow('store down');
  });
  it('keeps stale-on-refresh-error bounded and fresh-only readers reject stale', async () => {
    const s = setup(), load = vi.fn(async () => ({ count: 1 })), query = { key: key(), freshSeconds: 2, staleSeconds: 3, parse, load };
    await s.cache().get(query); await s.drain(); const stored = [...s.kv.values.values()][0]; s.advance(2001);
    load.mockRejectedValue(new Error('store down'));
    expect((await s.cache().get(query)).stale).toBe(true); await s.drain();
    expect(s.errors).toContain('refresh'); expect([...s.kv.values.values()][0]).toBe(stored);
    await expect(s.cache().get({ ...query, staleSeconds: 0 })).rejects.toThrow('store down');
  });
  it('rechecks hard expiry after a slow lower-tier read', async () => {
    const s = setup(), load = vi.fn(async () => ({ count: 1 }));
    const query = { key: key(), freshSeconds: 2, staleSeconds: 3, parse, load };
    await s.cache().get(query); await s.drain(); s.advance(2001);
    let finish!: (value: ReadableStream<Uint8Array> | null) => void;
    s.kv.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    load.mockRejectedValue(new Error('store unavailable after deadline'));
    const pending = s.cache().get(query);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    s.advance(3001); finish(null);
    await expect(pending).rejects.toThrow('store unavailable after deadline');
  });
  it('uses fresh KV instead of an older stale edge entry', async () => {
    const s = setup(), query = { key: key(), freshSeconds: 2, staleSeconds: 3, parse, load: async () => ({ count: 1 }) };
    await s.cache().get(query); await s.drain(); s.advance(2001);
    const kvKey = [...s.kv.values.keys()][0], e = JSON.parse(s.kv.values.get(kvKey)!);
    e.writtenAt += 2000; e.freshUntil += 2000; e.staleUntil += 2000; e.data.count = 2; s.kv.values.set(kvKey, JSON.stringify(e));
    expect(await s.cache().get(query)).toMatchObject({ tier: 'kv', stale: false, value: { count: 2 } }); await s.drain();
  });
  it('falls through malformed envelopes, schema mismatches and failed cache reads/writes', async () => {
    const s = setup(), query = { key: key(), freshSeconds: 20, parse, load: vi.fn(async () => ({ count: 1 })) };
    await s.cache().get(query); await s.drain();
    for (const k of s.edge.values.keys()) s.edge.values.set(k, '{broken');
    for (const k of s.kv.values.keys()) { const e = JSON.parse(s.kv.values.get(k)!); e.data = { count: 'bad' }; s.kv.values.set(k, JSON.stringify(e)); }
    expect((await s.cache().get(query)).tier).toBe('store'); await s.drain();
    s.edge.match.mockRejectedValue(new Error('edge down')); s.kv.get.mockRejectedValue(new Error('kv down'));
    s.edge.put.mockRejectedValue(new Error('edge write down')); s.kv.put.mockRejectedValue(new Error('kv write down'));
    expect((await s.cache().get(query)).value.count).toBe(1); await s.drain();
    expect(s.errors).toEqual(expect.arrayContaining(['edge-read', 'kv-read', 'edge-write', 'kv-write']));
  });
  it('bounds UTF-8 payload bytes on writes and cache reads', async () => {
    const s = setup(), long = '😀'.repeat(Math.ceil({{kit.maxBytes}} / 4));
    const query = { key: key(), freshSeconds: 20, parse: (x: unknown) => String(x), load: async () => long };
    expect((await s.cache().get(query)).value).toBe(long); await s.drain();
    expect(s.edge.put).not.toHaveBeenCalled(); expect(s.kv.put).not.toHaveBeenCalled();
    s.edge.match.mockResolvedValue(new Response(long + long));
    s.kv.get.mockResolvedValue(new Response(long + long).body);
    expect((await s.cache().get({ ...query, load: async () => 'small' })).value).toBe('small'); await s.drain();
    expect(s.errors).toEqual(expect.arrayContaining(['encode', 'edge-read', 'kv-read']));
  });
  it('bypass reads current store state without cache I/O or deduping an earlier load', async () => {
    const s = setup(), cache = s.cache(), k = key(); let finish!: (v: unknown) => void;
    const pending = cache.get({ key: k, freshSeconds: 20, parse, load: () => new Promise((done) => { finish = done; }) });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const reads = s.edge.match.mock.calls.length;
    expect(await cache.get({ key: k, freshSeconds: 20, bypass: true, parse, load: async () => ({ count: 9 }) })).toMatchObject({ value: { count: 9 }, tier: 'store' });
    expect(s.edge.match.mock.calls.length).toBe(reads); expect(s.kv.put).not.toHaveBeenCalled();
    finish({ count: 1 }); await pending; await s.drain();
  });
  it('an old in-flight generation cannot overwrite a newer version key', async () => {
    const s = setup(), cache = s.cache(), old = key(); let finish!: (v: unknown) => void;
    const pending = cache.get({ key: old, freshSeconds: 20, parse, load: () => new Promise((done) => { finish = done; }) });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const current = { ...old, version: 'r2' }, load = vi.fn(async () => ({ count: 9 }));
    await cache.get({ key: current, freshSeconds: 20, parse, load }); await s.drain();
    finish({ count: 1 }); await pending; await s.drain();
    expect((await s.cache().get({ key: current, freshSeconds: 20, parse, load })).value.count).toBe(9);
    expect(load).toHaveBeenCalledTimes(1); expect(s.kv.values.size).toBe(2);
  });
  it('reader TTL can shorten but never extend a stored representation lifetime', async () => {
    const s = setup(), query = { key: key(), freshSeconds: 20, parse, load: vi.fn(async () => ({ count: 1 })) };
    await s.cache().get(query); await s.drain(); s.advance(3000);
    expect((await s.cache().get({ ...query, freshSeconds: 2 })).tier).toBe('store'); await s.drain();
    s.advance(2001);
    expect((await s.cache().get({ ...query, freshSeconds: 20 })).tier).toBe('store'); await s.drain();
  });
  it('opens the named cache lazily and contains opening failures, including bypass-only factories', async () => {
    const s = setup(), open = vi.fn(async () => { throw new Error('cache open failed'); });
    vi.stubGlobal('caches', { open });
    try {
      const cache = createResultCache({ ...s.options, edge: undefined, kv: undefined });
      expect(open).not.toHaveBeenCalled();
      const query = { key: key(), freshSeconds: 20, parse, load: async () => ({ count: 3 }) };
      expect((await cache.get({ ...query, bypass: true })).value.count).toBe(3);
      expect(open).not.toHaveBeenCalled();
      expect((await cache.get(query)).value.count).toBe(3); await s.drain();
      expect(open).toHaveBeenCalledTimes(1); expect(s.errors).toContain('edge-open');
    } finally { vi.unstubAllGlobals(); }
  });
  it('does not cache store exceptions or invalid authoritative data; supports no KV', async () => {
    const s = setup(), cache = createResultCache({ ...s.options, kv: undefined });
    const query = { key: key(), freshSeconds: 20, parse, load: async () => { throw new Error('store unavailable'); } };
    await expect(cache.get(query)).rejects.toThrow('store unavailable');
    await expect(cache.get({ ...query, load: async () => ({ count: 'bad' }) })).rejects.toThrow('Invalid count');
    expect(s.edge.put).not.toHaveBeenCalled();
    expect((await cache.get({ ...query, load: async () => ({ count: 2 }) })).value.count).toBe(2); await s.drain();
    expect(s.kv.get).not.toHaveBeenCalled(); expect(s.kv.put).not.toHaveBeenCalled();
  });
});
