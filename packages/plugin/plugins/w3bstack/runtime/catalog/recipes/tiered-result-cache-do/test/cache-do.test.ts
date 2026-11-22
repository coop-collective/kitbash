import { env, SELF } from 'cloudflare:test';
import { expect, it } from 'vitest';
import worker, { readCatalogSummary } from '../src/index';
import { createResultCache } from '../src/generated/result-cache';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
const request = (id: string, tenant = 'team-a', method = 'GET', bypass = false) => new Request(`https://example.com/catalog/${id}`, {
  method, headers: { authorization: `Bearer ${tenant}`, ...(bypass ? { 'cache-control': 'no-cache' } : {}) },
});
async function read(id: string, tenant = 'team-a', bypass = false) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request(id, tenant, 'GET', bypass), env, ctx);
  await waitOnExecutionContext(ctx);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  return response.json<{ value: { count: number; revision: number }; tier: string; stale: boolean }>();
}
it('caches real DO RPC results and reauthorizes every hit', async () => {
  const id = crypto.randomUUID(), store = env.CATALOGS.getByName(JSON.stringify(['team-a', id]));
  expect(await read(id)).toMatchObject({ tier: 'store', value: { count: 0, revision: 0 } });
  expect(await read(id)).toMatchObject({ tier: 'edge', value: { count: 0 } });
  expect(await store.summaryCalls()).toBe(1);
  expect((await SELF.fetch(request(id, 'denied'))).status).toBe(401);
  expect(await store.summaryCalls()).toBe(1);
});
it('authoritative mutation revisions invalidate without deleting or racing a KV pointer', async () => {
  const id = crypto.randomUUID(); await read(id);
  const changed = await SELF.fetch(request(id, 'team-a', 'POST'));
  expect(await changed.json()).toEqual({ count: 1, revision: 1 });
  expect(await read(id)).toMatchObject({ tier: 'store', value: { count: 1, revision: 1 } });
  expect(await read(id)).toMatchObject({ tier: 'edge', value: { count: 1, revision: 1 } });
});
it('isolates DO and cache tenants; strict bypass calls RPC again', async () => {
  const id = crypto.randomUUID(); await SELF.fetch(request(id, 'team-a', 'POST'));
  expect((await read(id)).value.count).toBe(1);
  expect((await read(id, 'team-b')).value.count).toBe(0);
  const store = env.CATALOGS.getByName(JSON.stringify(['team-a', id]));
  const before = await store.summaryCalls();
  expect((await read(id, 'team-a', true)).tier).toBe('store');
  expect(await store.summaryCalls()).toBe(before + 1);
});

it('retries a real mutation between revision and summary, and exhausts retry under repeated races', async () => {
  for (const repeat of [false, true]) {
    const id = crypto.randomUUID(), store = env.CATALOGS.getByName(JSON.stringify(['team-a', id]));
    let changed = false;
    const racingStore = {
      revision: () => store.revision(),
      summary: async (revision: number) => {
        if (!changed || repeat) { changed = true; await store.increment(); }
        return store.summary(revision);
      },
    };
    const ctx = createExecutionContext();
    const cache = createResultCache({ origin: 'https://example.com', context: ctx, kv: env.RESULT_CACHE });
    const result = await readCatalogSummary(cache, racingStore, { tenant: 'team-a', catalogId: id });
    await waitOnExecutionContext(ctx);
    if (repeat) expect(result).toBeNull(); // Worker maps exhausted retries to 409.
    else expect(result).toMatchObject({ value: { count: 1, revision: 1 }, tier: 'store' });
  }
});
