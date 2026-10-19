import { DurableObject } from 'cloudflare:workers';
export type Session = { userId: string; tenantId: string; expiresAt: number };
type Connection = Session & { tokens: number; updatedAt: number };
type Message = { seq: number; userId: string; text: string };
export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT NOT NULL, text TEXT NOT NULL)');
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Upgrade required', { status: 426 });
    // Only the outer Worker creates these headers. This DO has no public route.
    const userId = request.headers.get('x-room-user'), tenantId = request.headers.get('x-room-tenant');
    const expiresAt = Number(request.headers.get('x-room-expires'));
    if (!userId || !tenantId || expiresAt <= Date.now() || !Number.isFinite(expiresAt)) return new Response('Unauthorized', { status: 401 });
    if (this.ctx.getWebSockets().length >= 100) return new Response('Room full', { status: 503 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ userId, tenantId, expiresAt, tokens: 10, updatedAt: Date.now() } satisfies Connection);
    const messages = this.ctx.storage.sql.exec<Message>('SELECT seq, userId, text FROM messages ORDER BY seq').toArray();
    pair[1].send(JSON.stringify({ type: 'snapshot', messages }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  webSocketMessage(socket: WebSocket, input: string | ArrayBuffer): void {
    // No in-memory socket map: attachment and SQL are authoritative after hibernation.
    const connection = socket.deserializeAttachment() as Connection | null;
    if (!connection || connection.expiresAt <= Date.now()) { socket.close(1008, 'Session expired'); return; }
    if (typeof input !== 'string' || new TextEncoder().encode(input).byteLength > 4096) { socket.close(1009, 'Message too large'); return; }
    let text: unknown;
    try { text = (JSON.parse(input) as { text?: unknown }).text; } catch { socket.close(1008, 'Invalid message'); return; }
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) { socket.close(1008, 'Invalid text'); return; }
    const now = Date.now();
    connection.tokens = Math.min(10, connection.tokens + Math.max(0, now - connection.updatedAt) / 1000 * 2);
    connection.updatedAt = now;
    if (connection.tokens < 1) { socket.close(1008, 'Rate limit'); return; }
    connection.tokens--;
    socket.serializeAttachment(connection);
    const row = this.ctx.storage.transactionSync(() => {
      const inserted = this.ctx.storage.sql.exec<Message>('INSERT INTO messages (userId, text) VALUES (?, ?) RETURNING seq, userId, text', connection.userId, text).one();
      this.ctx.storage.sql.exec('DELETE FROM messages WHERE seq <= ?', inserted.seq - 100);
      return inserted;
    });
    const event = JSON.stringify({ type: 'message', ...row });
    for (const peer of this.ctx.getWebSockets()) {
      const session = peer.deserializeAttachment() as Connection | null;
      try {
        if (!session || session.expiresAt <= now) peer.close(1008, 'Session expired');
        else peer.send(event);
      } catch { try { peer.close(1011, 'Send failed'); } catch { /* already closed */ } }
    }
  }
  webSocketClose(socket: WebSocket, code: number, reason: string): void { socket.close(code, reason); }
  webSocketError(socket: WebSocket): void { socket.close(1011, 'Connection error'); }
}
