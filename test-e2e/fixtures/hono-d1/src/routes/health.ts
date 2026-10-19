import { Hono } from "hono";

export const health = new Hono<{ Bindings: Env }>();

// Liveness plus a D1 round trip. 503 when the database is unreachable.
health.get("/health", async (c) => {
  try {
    const row = await c.env.DB.prepare("SELECT value FROM meta WHERE key = 'schema'").first<{ value: string }>();
    return c.json({ ok: true, schema: row?.value ?? null });
  } catch {
    return c.json({ ok: false }, 503);
  }
});
