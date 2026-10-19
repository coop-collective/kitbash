/** Request-scoped JSON result caching. Authorization always runs before this utility. */
export interface ResultKey { scope: string; tenant: string; version: string; parts: readonly string[] }
export interface Result<T> { value: T; tier: 'edge' | 'kv' | 'store'; stale: boolean }
export interface ResultQuery<T> {
  key: ResultKey;
  freshSeconds: number;
  /** Opt-in stale-while-refresh window. Zero (the default) never serves stale data. */
  staleSeconds?: number;
  /** Strict authoritative read: skips all cache reads, writes and in-flight deduplication. */
  bypass?: boolean;
  parse(value: unknown): T;
  load(): Promise<unknown>;
}
export type EdgeStore = Pick<Cache, 'match' | 'put'>;
export interface ResultKV {
  get(key: string, type: 'stream'): Promise<ReadableStream<Uint8Array> | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
}
export interface ResultCacheOptions {
  origin: string;
  context: { waitUntil(promise: Promise<unknown>): void };
  /** A named Cache is used by default; null disables the edge tier. */
  edge?: EdgeStore | null;
  kv?: ResultKV;
  now?: () => number;
  onError?: (event: { operation: string; error: unknown }) => void;
}
interface Envelope { format: 1; key: string; writtenAt: number; freshUntil: number; staleUntil: number; data: unknown }
interface Loaded { data: unknown; envelope?: Envelope }
const MAX_BYTES = 65536;
const MAX_LIFETIME = 86400 * 1000;
const NAMESPACE = 'results';
const encoder = new TextEncoder();

function policy(query: ResultQuery<unknown>): { fresh: number; stale: number } {
  const fresh = query.freshSeconds * 1000, stale = (query.staleSeconds ?? 0) * 1000;
  if (!Number.isSafeInteger(fresh) || !Number.isSafeInteger(stale) || fresh < 1000 || stale < 0 || fresh + stale > MAX_LIFETIME) throw new Error('Invalid result cache lifetime');
  return { fresh, stale };
}
async function digest(origin: string, key: ResultKey): Promise<string> {
  const fields = [key.scope, key.tenant, key.version, ...key.parts];
  if (key.parts.length > 16 || fields.some((s) => typeof s !== 'string' || !s.length || encoder.encode(s).length > 256)) throw new Error('Invalid result cache key');
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify([NAMESPACE, origin, key.scope, key.tenant, key.version, key.parts])));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function boundedText(stream: ReadableStream<Uint8Array> | null): Promise<string | null> {
  if (!stream) return null;
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Cached result exceeds byte limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
}
function decode(text: string | null, key: string, now: number): Envelope | null {
  if (!text) return null;
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object') throw new Error('Invalid cache envelope');
  const e = value as Envelope;
  if (e.format !== 1 || e.key !== key || !Object.hasOwn(e, 'data') ||
      ![e.writtenAt, e.freshUntil, e.staleUntil].every(Number.isSafeInteger) ||
      e.writtenAt > now || e.freshUntil <= e.writtenAt || e.staleUntil < e.freshUntil ||
      e.staleUntil - e.writtenAt > MAX_LIFETIME) throw new Error('Invalid cache envelope');
  return e;
}
function boundedLifetime(e: Envelope, fresh: number, stale: number): Envelope {
  const freshUntil = Math.min(e.freshUntil, e.writtenAt + fresh);
  return { ...e, freshUntil, staleUntil: Math.min(e.staleUntil, freshUntil + stale) };
}

/** Create once per incoming request; never share this object or its promises across requests. */
export function createResultCache(options: ResultCacheOptions) {
  const parsedOrigin = new URL(options.origin);
  if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.username || parsedOrigin.password || parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash) throw new Error('Expected an HTTP origin');
  const origin = parsedOrigin.origin, now = options.now ?? Date.now;
  let edgePromise: Promise<EdgeStore | null> | undefined;
  const pending = new Map<string, Promise<Loaded>>();
  const report = (operation: string, error: unknown) => { try { options.onError?.({ operation, error }); } catch { /* Reporting cannot break reads. */ } };
  const background = (operation: string, promise: Promise<unknown>) => options.context.waitUntil(promise.catch((error) => report(operation, error)));
  const getEdge = () => edgePromise ??= (options.edge === null ? Promise.resolve(null) : options.edge ? Promise.resolve(options.edge) : caches.open(`kit-result-cache-${NAMESPACE}`)).catch((error) => { report('edge-open', error); return null; });
  const edgeKey = (key: string) => new Request(`${origin}/__kit_results/${NAMESPACE}/${key}`);
  const kvKey = (key: string) => `kit:${NAMESPACE}:${key}`;
  async function writeEdge(e: Envelope): Promise<void> {
    const edge = await getEdge();
    const remaining = Math.ceil((e.staleUntil - now()) / 1000);
    if (remaining <= 0 || !edge) return;
    await edge.put(edgeKey(e.key), new Response(JSON.stringify(e), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${remaining}` } }));
  }
  async function writeKV(e: Envelope): Promise<void> {
    const remaining = Math.ceil((e.staleUntil - now()) / 1000);
    if (remaining <= 0 || !options.kv) return;
    // KV requires at least 60 seconds; absolute envelope times still enforce shorter application lifetimes.
    await options.kv.put(kvKey(e.key), JSON.stringify(e), { expirationTtl: Math.max(60, remaining) });
  }
  function loadOnce<T>(key: string, query: ResultQuery<T>, fresh: number, stale: number): Promise<Loaded> {
    const flightKey = `${key}:${fresh}:${stale}`;
    const existing = pending.get(flightKey);
    if (existing) return existing;
    const task = (async () => {
      const data = await query.load();
      query.parse(data); // Authoritative schema failures propagate; no error result is cached.
      try {
        const writtenAt = now();
        const envelope: Envelope = { format: 1, key, writtenAt, freshUntil: writtenAt + fresh, staleUntil: writtenAt + fresh + stale, data };
        const serialized = JSON.stringify(envelope);
        if (encoder.encode(serialized).byteLength > MAX_BYTES) throw new Error('Result exceeds cache byte limit');
        const normalized = decode(serialized, key, writtenAt)!;
        query.parse(normalized.data); // JSON serialization must preserve the declared data contract.
        // Awaited so the very next request already sees the entry (no waitUntil race).
        await Promise.all([
          writeEdge(normalized).catch((error) => report('edge-write', error)),
          writeKV(normalized).catch((error) => report('kv-write', error)),
        ]);
        return { data: normalized.data, envelope: normalized };
      } catch (error) { report('encode', error); return { data }; }
    })().finally(() => { pending.delete(flightKey); });
    pending.set(flightKey, task);
    return task;
  }
  return {
    async get<T>(query: ResultQuery<T>): Promise<Result<T>> {
      const { fresh, stale } = policy(query);
      const key = await digest(origin, query.key);
      if (query.bypass) return { value: query.parse(await query.load()), tier: 'store', stale: false };
      let candidate: { envelope: Envelope; value: T; tier: 'edge' | 'kv' } | undefined;
      for (const tier of ['edge', 'kv'] as const) {
        if (tier === 'kv' && !options.kv) continue;
        try {
          let stream: ReadableStream<Uint8Array> | null = null;
          if (tier === 'edge') {
            const response = await (await getEdge())?.match(edgeKey(key));
            if (response?.status === 200) stream = response.body;
            else await response?.body?.cancel();
          } else stream = await options.kv!.get(kvKey(key), 'stream');
          const decoded = decode(await boundedText(stream), key, now());
          if (!decoded) continue;
          const envelope = boundedLifetime(decoded, fresh, stale);
          const value = query.parse(envelope.data), time = now();
          if (envelope.staleUntil <= time) continue;
          if (envelope.freshUntil > time) {
            if (tier === 'kv') background('edge-promote', writeEdge(envelope));
            return { value, tier, stale: false };
          }
          if (!candidate || envelope.writtenAt > candidate.envelope.writtenAt) candidate = { envelope, value, tier };
        } catch (error) { report(`${tier}-read`, error); }
      }
      if (candidate && candidate.envelope.staleUntil > now()) {
        background('refresh', loadOnce(key, query, fresh, stale));
        return { value: candidate.value, tier: candidate.tier, stale: true };
      }
      const loaded = await loadOnce(key, query, fresh, stale);
      return { value: query.parse(loaded.data), tier: 'store', stale: false };
    },
  };
}
