import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { destroySession, readSession, revokeOwnerSessions, sameOriginMutation, type Session, type SessionEnv } from "./session";
export type SessionApp = { Bindings: SessionEnv; Variables: { session: Session } };
export const requireSession = createMiddleware<SessionApp>(async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  if (!sameOriginMutation(c.req.raw)) return c.json({ error: "same-origin Origin required" }, 403);
  const session = await readSession(c.env, c.req.raw);
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("session", session);
  await next();
});
export function sessionRoutes() {
  const app = new Hono<SessionApp>();
  app.use("*", requireSession);
  app.get("/", c => c.json({ owner_id: c.get("session").owner_id, expires_ms: c.get("session").expires_ms }));
  app.post("/logout", async c => {
    c.header("Set-Cookie", await destroySession(c.env, c.req.raw));
    return c.body(null, 204);
  });
  app.post("/logout-all", async c => {
    await revokeOwnerSessions(c.env, c.get("session").owner_id);
    c.header("Set-Cookie", await destroySession(c.env, c.req.raw));
    return c.body(null, 204);
  });
  return app;
}
