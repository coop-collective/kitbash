import { DurableObject } from 'cloudflare:workers';
import { createResultCache } from './generated/result-cache';
type Summary = { count: number; revision: number };
export class Catalog extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS catalog (id INTEGER PRIMARY KEY CHECK(id=1), count INTEGER NOT NULL, revision INTEGER NOT NULL, summary_calls INTEGER NOT NULL)');
    ctx.storage.sql.exec('INSERT OR IGNORE INTO catalog VALUES (1, 0, 0, 0)');
  }
  revision(): number { return this.ctx.storage.sql.exec<{ revision: number }>('SELECT revision FROM catalog').one().revision; }
  increment(): Summary { return this.ctx.storage.sql.exec<Summary>('UPDATE catalog SET count=count+1, revision=revision+1 WHERE id=1 RETURNING count, revision').one(); }
  summary(expectedRevision: number): Summary {
    const row = this.ctx.storage.sql.exec<Summary>('SELECT count, revision FROM catalog').one();
    if (row.revision !== expectedRevision) throw new Error('Revision changed');
    this.ctx.storage.sql.exec('UPDATE catalog SET summary_calls=summary_calls+1 WHERE id=1');
    return row; // Replace with the expensive projection; keep its revision check.
  }
  summaryCalls(): number { return this.ctx.storage.sql.exec<{ n: number }>('SELECT summary_calls AS n FROM catalog').one().n; }
}
function parseSummary(value: unknown): Summary {
  if (!value || typeof value !== 'object') throw new Error('Invalid summary');
  const summary = value as Summary;
  if (!Number.isSafeInteger(summary.count) || !Number.isSafeInteger(summary.revision)) throw new Error('Invalid summary');
  return summary;
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url), match = /^\/catalog\/([A-Za-z0-9_-]{1,80})$/.exec(url.pathname);
    if (!match) return new Response('Not found', { status: 404 });
    if (!['GET', 'POST'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    // Auth is called on EVERY request, including hits. The cache never stores its response.
    const auth = await env.AUTH.fetch(new Request('https://auth.internal/catalog', {
      method: 'POST', headers: { authorization: request.headers.get('authorization') ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({ catalogId: match[1], operation: request.method === 'POST' ? 'write' : 'read' }),
    }));
    if (!auth.ok) return new Response('Unauthorized', { status: 401 });
    const { tenant } = await auth.json<{ tenant?: unknown }>();
    if (typeof tenant !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(tenant)) return new Response('Unauthorized', { status: 401 });
    const store = env.CATALOGS.getByName(JSON.stringify([tenant, match[1]]));
    if (request.method === 'POST') return Response.json(await store.increment(), { headers: { 'cache-control': 'no-store' } });
    const cache = createResultCache({ origin: url.origin, context: ctx, kv: env.RESULT_CACHE });
    const result = await readCatalogSummary(cache, store, { tenant, catalogId: match[1] }, request.headers.get('cache-control') === 'no-cache');
    return result ? Response.json(result, { headers: { 'cache-control': 'private, no-store' } }) : new Response('State changed during read', { status: 409 });
  },
} satisfies ExportedHandler<Env>;

/** Shared retry boundary, also exercised against real RPCs with an intentionally racing mutation. */
export async function readCatalogSummary(
  cache: ReturnType<typeof createResultCache>,
  store: { revision(): Promise<number>; summary(expectedRevision: number): Promise<Summary> },
  identity: { tenant: string; catalogId: string },
  bypass = false,
) {
  // The lightweight revision RPC is intentional; a KV pointer cannot guarantee current state.
  for (let attempt = 0; attempt < 2; attempt++) {
    const revision = await store.revision();
    try {
      return await cache.get({
        key: { scope: 'catalog-summary-v1', tenant: identity.tenant, version: String(revision), parts: [identity.catalogId] },
        freshSeconds: 30, bypass, parse: parseSummary,
        load: () => store.summary(revision),
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('Revision changed')) throw error;
    }
  }
  return null;
}
