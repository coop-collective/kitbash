import { Hono } from "hono";
import { startCode, verifyCode } from "{{paths.lib|rel}}/auth/codes";
import { requireBearer } from "{{paths.lib|rel}}/auth/middleware";
import type { AuthEnv, Member } from "{{paths.lib|rel}}/auth/types";

/** Mounted by the adapt step at {{kit.routePrefix}}: POST /email/start, POST /email/verify. */
export const authRoutes = new Hono<{ Bindings: AuthEnv }>();

authRoutes.post("/email/start", async (c) => {
  const body = await c.req.json<{ email?: string }>().catch(() => ({ email: undefined }));
  if (!body.email || !/^[^@\s]+@[^@\s]+$/.test(body.email)) return c.json({ error: "bad_email" }, 400);
  return c.json(await startCode(c.env, body.email));
});

authRoutes.post("/email/verify", async (c) => {
  const body = await c.req.json<{ email?: string; code?: string }>().catch(() => ({ email: undefined, code: undefined }));
  if (!body.email || !body.code) return c.json({ error: "bad_request" }, 400);
  const r = await verifyCode(c.env, body.email, body.code);
  return r ? c.json(r) : c.json({ error: "invalid_code" }, 401);
});

/** GET /api/me behind requireBearer. */
export const meRoutes = new Hono<{ Bindings: AuthEnv; Variables: { member: Member } }>();
meRoutes.get("/api/me", requireBearer, (c) => c.json(c.get("member")));
