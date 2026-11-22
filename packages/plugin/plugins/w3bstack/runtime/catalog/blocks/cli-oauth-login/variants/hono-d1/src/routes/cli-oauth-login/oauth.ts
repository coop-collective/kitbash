// Routes of cli-oauth-login. Mount both, and wrap the app for the provider:
//   app.route("/", oauthRoutes); app.route("/api", cliLoginRoutes); export default oauthWorker(app);
// The provider itself serves /.well-known/oauth-*, /oauth/register and /oauth/token.
import { Hono } from "hono";
import { requireBearer } from "{{paths.lib|rel}}/email-code-auth/middleware";
import { authorizeGet, authorizePost, signInCode, signInEmail, signInToken } from "{{paths.lib|rel}}/cli-oauth-login/authorize";
import { listCliLogins, revokeCliLogin } from "{{paths.lib|rel}}/cli-oauth-login/cli-logins";
import { oauthOrigin, revokeCliGrants } from "{{paths.lib|rel}}/cli-oauth-login/provider";
import type { OAuthEnv, OAuthMember } from "{{paths.lib|rel}}/cli-oauth-login/types";

/** Browser sign-in handlers enforce Origin; the provider validates authorization and consent separately. */
export const oauthRoutes = new Hono<{ Bindings: OAuthEnv }>();
oauthRoutes.get("/authorize", (c) => authorizeGet(c.env, c.req.raw));
oauthRoutes.post("/authorize", (c) => authorizePost(c.env, c.req.raw));
const SIGN_IN = { email: signInEmail, code: signInCode, token: signInToken } as const;
/** POST /authorize/signin/:how — token (paste a bearer), email (send a code), code (check it). */
oauthRoutes.post("/authorize/signin/:how", (c) => {
  const how = c.req.param("how");
  return Object.hasOwn(SIGN_IN, how) ? SIGN_IN[how as keyof typeof SIGN_IN](c.env, c.req.raw) : c.notFound();
});

/** GET /cli-logins, DELETE /cli-logins/:id: my CLI sign-ins (mount under /api). Bearer only. */
export const cliLoginRoutes = new Hono<{ Bindings: OAuthEnv; Variables: { member: OAuthMember } }>();
cliLoginRoutes.use("/cli-logins", requireBearer as never);
cliLoginRoutes.use("/cli-logins/*", requireBearer as never);
cliLoginRoutes.get("/cli-logins", async (c) => c.json({ cli_logins: await listCliLogins(c.env, c.get("member").id) }));
cliLoginRoutes.delete("/cli-logins/:id", async (c) => {
  const row = await revokeCliLogin(c.env, c.get("member").id, c.req.param("id"));
  if (!row) return c.json({ error: { code: "not_found", message: "CLI sign-in not found" } }, 404);
  // its OAuth grants go too (a grant's userId is the sign-in's id), so no refresh token outlives it
  const grants = await revokeCliGrants(c.env, oauthOrigin(c.env, c.req.url), row.id);
  return c.json({ revoked: row.id, grants });
});
