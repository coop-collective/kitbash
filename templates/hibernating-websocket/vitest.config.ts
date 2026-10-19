import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: { serviceBindings: { AUTH: async (request) => {
      const cookie = request.headers.get('cookie');
      const body = await request.json() as { room: string };
      if (!cookie || body.room === 'forbidden') return new Response('', { status: 401 });
      return Response.json({ userId: cookie === 'session=bob' ? 'bob' : 'alice', tenantId: cookie === 'session=other' ? 'other' : 'team', expiresAt: Date.now() + 60_000 });
    } } },
  })],
  test: { include: ['test/**/*.test.ts'] },
});
