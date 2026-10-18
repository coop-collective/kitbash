import { createMiddleware } from "hono/factory";
import { bearerOf, resolveBearer } from "./tokens";
import { AuthError, type AuthEnv, type AuthVariables } from "./types";

/**
 * Requires `Authorization: Bearer {{kit.tokenPrefix}}…`. Sets `member` and `tokenId`; answers 401 with WWW-Authenticate
 * otherwise (and 500 `not_configured` when TOKEN_PEPPER is missing).
 */
export const requireBearer = createMiddleware<{ Bindings: AuthEnv; Variables: AuthVariables }>(async (c, next) => {
  let hit: Awaited<ReturnType<typeof resolveBearer>>;
  try {
    hit = await resolveBearer(c.env, bearerOf(c.req.header("authorization")));
  } catch (err) {
    if (err instanceof AuthError) return c.json({ error: err.code, message: err.message }, err.status);
    throw err;
  }
  if (!hit) return c.json({ error: "unauthorized" }, 401, { "WWW-Authenticate": 'Bearer realm="api"' });
  c.set("member", hit.member);
  c.set("tokenId", hit.tokenId);
  await next();
});
