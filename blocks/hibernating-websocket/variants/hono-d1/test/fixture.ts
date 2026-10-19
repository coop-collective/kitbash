// Local test entrypoint only. Production exports the original class and supplies real authorization.
import { {{kit.className}} as RoomBase } from '{{paths.lib|rel}}/{{kit.fileSlug}}';
import { createRoomRoutes } from '{{paths.routes|rel}}/{{kit.fileSlug}}';
export class {{kit.className}} extends RoomBase {
  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== '/__inspect') return super.fetch(request);
    const { action } = await request.json<{ action: string }>();
    const socket = this.ctx.getWebSockets()[0];
    if (action === 'reconstruct') new RoomBase(this.ctx, this.env).webSocketMessage(socket, JSON.stringify({ text: 'w' }));
    if (action === 'expire') for (const peer of this.ctx.getWebSockets()) peer.serializeAttachment({ ...peer.deserializeAttachment(), expiresAt: 1 });
    if (action === 'expired-message') {
      socket.serializeAttachment({ ...socket.deserializeAttachment(), expiresAt: 1 });
      this.webSocketMessage(socket, JSON.stringify({ text: 'x' }));
    }
    if (action === 'history') {
      for (let index = 0; index < {{kit.historySize}} + 10; index++) {
        socket.serializeAttachment({ ...socket.deserializeAttachment(), tokens: {{kit.rateBurst}} });
        this.webSocketMessage(socket, JSON.stringify({ text: 'x' }));
      }
      socket.serializeAttachment({ ...socket.deserializeAttachment(), tokens: 0, updatedAt: Date.now() });
      this.webSocketMessage(socket, JSON.stringify({ text: 'x' }));
    }
    return Response.json(this.ctx.storage.sql.exec('SELECT COUNT(*) AS n, MIN(seq) AS first, MAX(seq) AS last FROM messages').one());
  }
}
interface TestEnv { {{kit.bindingName}}: DurableObjectNamespace<{{kit.className}}> }
const routes = createRoomRoutes(async (input, room) => {
      const cookie = input.headers.get('cookie');
      if (!['session=alice', 'session=bob', 'session=other'].includes(cookie ?? '') || room === 'forbidden') return null;
      return { userId: cookie === 'session=bob' ? 'bob' : 'alice', tenantId: cookie === 'session=other' ? 'other' : 'team', expiresAt: Date.now() + 60_000 };
    });
export default {
  async fetch(request: Request, env: TestEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/__test/')) {
      const room = url.pathname.slice('/__test/'.length);
      return env.{{kit.bindingName}}.getByName(JSON.stringify(['team', room])).fetch(new Request('https://test.internal/__inspect', request));
    }
    return routes.fetch(request, env);
  },
};
