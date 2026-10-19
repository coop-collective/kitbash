import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { clearJwtSessionCookie, destroyJwtSession, readJwtSession, revokeOwnerJwtSessions, sameOriginJwtMutation, type JwtSession, type JwtSessionEnv } from "./session";

export type JwtSessionApp = { Bindings: JwtSessionEnv; Variables: { jwtSession: JwtSession } };
export const requireJwtSession = createMiddleware<JwtSessionApp>(async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  if (!sameOriginJwtMutation(c.env, c.req.raw)) return c.json({ error: "same-origin Origin required" }, 403);
  const session = await readJwtSession(c.env, c.req.raw);
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("jwtSession", session);
  await next();
});
export function jwtSessionRoutes() {
  const app = new Hono<JwtSessionApp>();
  app.use("*", requireJwtSession);
  app.get("/", c => c.json({ owner_id: c.get("jwtSession").owner_id, expires_s: c.get("jwtSession").expires_s }));
  app.post("/logout", async c => {
    c.header("Set-Cookie", await destroyJwtSession(c.env, c.req.raw));
    return c.body(null, 204);
  });
  app.post("/logout-all", async c => {
    await revokeOwnerJwtSessions(c.env, c.get("jwtSession").owner_id);
    c.header("Set-Cookie", clearJwtSessionCookie(c.env));
    return c.body(null, 204);
  });
  return app;
}
