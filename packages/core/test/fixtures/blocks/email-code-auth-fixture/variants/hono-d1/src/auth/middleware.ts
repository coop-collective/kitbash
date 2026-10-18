import { createMiddleware } from "hono/factory";
import { authenticate } from "./tokens";
import type { AuthEnv, Member } from "./types";

const BEARER = /^Bearer\s+({{kit.tokenPrefix}}[A-Za-z0-9_-]{43})$/;

export const requireBearer = createMiddleware<{ Bindings: AuthEnv; Variables: { member: Member } }>(async (c, next) => {
  const m = BEARER.exec(c.req.header("authorization") ?? "");
  const member = m ? await authenticate(c.env, m[1]!) : null;
  if (!member) return c.json({ error: "unauthorized" }, 401, { "WWW-Authenticate": 'Bearer realm="api"' });
  c.set("member", member);
  await next();
});
