import { Container, getContainer } from '@cloudflare/containers';
import { gateway } from './gateway';
export class HashContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '1m';
  enableInternet = false;
  envVars = { NODE_ENV: 'production' };
}
export default {
  fetch(request, env) {
    return gateway(request, async (incoming) => {
      const response = await env.AUTH.fetch(new Request('https://auth.internal/authorize-hash', {
        method: 'POST', headers: { authorization: incoming.headers.get('authorization') ?? '' },
      }));
      return response.ok ? response.json<{ tenantId: string }>() : null;
    }, (tenant, upstream) => getContainer(env.HASH_CONTAINER, JSON.stringify(['tenant', tenant])).fetch(upstream));
  },
} satisfies ExportedHandler<Env>;
