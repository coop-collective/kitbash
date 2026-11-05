import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: { serviceBindings: { AUTH: async (request) => {
      // Test fixture only. Production must validate credentials and resource membership.
      const token = request.headers.get('authorization');
      return token === 'Bearer team-a' || token === 'Bearer team-b'
        ? Response.json({ tenant: token.slice('Bearer '.length) }) : new Response('', { status: 401 });
    } } },
  })],
  test: { include: ['test/**/*.test.ts'] },
});
