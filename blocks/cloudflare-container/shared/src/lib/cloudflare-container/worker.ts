import { Container } from '@cloudflare/containers';
import { gateway } from './gateway';
interface ContainerEnv {
  AUTH: Fetcher;
  HASH_CONTAINER: DurableObjectNamespace<HashContainer>;
}
export class HashContainer extends Container<ContainerEnv> {
  defaultPort = 8080;
  sleepAfter = '1m';
  enableInternet = false;
  envVars: Record<string, string> = { PORT: '8080', NODE_ENV: 'production' };
}
export default {
  fetch(request, env) {
    return gateway(request, async (incoming) => {
      const result = await env.AUTH.fetch(new Request('https://auth.internal/authorize-hash', {
        method: 'POST', headers: { authorization: incoming.headers.get('authorization') ?? '' },
      }));
      return result.ok ? result.json<{ tenantId: string }>() : null;
    }, (tenant, upstream) => env.HASH_CONTAINER.getByName(JSON.stringify(['tenant', tenant])).fetch(upstream));
  },
} satisfies ExportedHandler<ContainerEnv>;
