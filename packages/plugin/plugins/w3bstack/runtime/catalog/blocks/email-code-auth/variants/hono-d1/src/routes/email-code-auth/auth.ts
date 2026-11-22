import { Hono } from "hono";
import { CODE_TTL_MIN, startCode, verifyCode } from "{{paths.lib|rel}}/email-code-auth/codes";
import { requireBearer } from "{{paths.lib|rel}}/email-code-auth/middleware";
import { revokeTokenId } from "{{paths.lib|rel}}/email-code-auth/tokens";
import { AuthError, type AuthEnv, type AuthVariables } from "{{paths.lib|rel}}/email-code-auth/types";

type AuthApp = { Bindings: AuthEnv; Variables: AuthVariables };

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b: unknown = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

/** Mounted at {{kit.routePrefix}} by the adapt step: POST /email/start, POST /email/verify, POST /logout. */
export const authRoutes = new Hono<AuthApp>();

authRoutes.onError((err, c) => {
  if (err instanceof AuthError) return c.json({ error: err.code, message: err.message }, err.status);
  throw err;
});

authRoutes.post("/email/start", async (c) => {
  const b = await body(c.req.raw);
  await startCode(c.env, str(b.email, 320) ?? "");
  return c.json({ ok: true, message: `If the address can receive mail, a code is on its way. It works once, for ${CODE_TTL_MIN} minutes.` });
});

authRoutes.post("/email/verify", async (c) => {
  const b = await body(c.req.raw);
  const email = str(b.email, 320);
  const code = str(b.code, 32);
  if (!email || !code) return c.json({ error: "bad_request", message: "email and code are required" }, 400);
  const r = await verifyCode(c.env, email, code, str(b.label, 80) ?? "sign-in", str(b.name, 80));
  if (!r) return c.json({ error: "invalid_code", message: "That code is wrong or expired. Request a new one." }, 401);
  return c.json(r);
});

/** Revokes the token that made the request. */
authRoutes.post("/logout", requireBearer, async (c) => {
  await revokeTokenId(c.env, c.get("tokenId"));
  return c.json({ ok: true });
});

/** GET /api/me behind requireBearer; mounted at / by the adapt step. */
export const meRoutes = new Hono<AuthApp>();
meRoutes.get("/api/me", requireBearer, (c) => c.json({ member: c.get("member") }));
