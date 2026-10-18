// kit_ bearer tokens come from the email-code-auth block (installed from the registry, WP-08 dogfood): opaque, 32
// random bytes base64url, stored only as HMAC-SHA256 under a key derived from TOKEN_PEPPER (src/lib/auth/tokens.ts).
// This file adds what the registry needs on top: the caller's orgs and default org, and the contract's error
// envelope. Every route but /health goes through requireBearer.
import { createMiddleware } from "hono/factory";
import { bearerOf, issueToken as issueBlockToken, resolveBearer, TOKEN_RE } from "./lib/auth/tokens";
import { AuthError, type AuthEnv } from "./lib/auth/types";
import { ApiError, type AppEnv, type Bindings, type Caller, type OrgRef } from "./types";

export { TOKEN_RE };

const authEnv = (env: Bindings) => env as unknown as AuthEnv;

/** Mints a token for a member; returns the plaintext (shown once). Used by tests; scripts/token.mjs does the same. */
export async function issueToken(env: Bindings, memberId: string, label: string): Promise<string> {
  return issueBlockToken(authEnv(env), memberId, label);
}

export async function authenticate(env: Bindings, token: string): Promise<Caller | null> {
  let hit: Awaited<ReturnType<typeof resolveBearer>>;
  try {
    hit = await resolveBearer(authEnv(env), token);
  } catch (e) {
    if (e instanceof AuthError && e.code === "not_configured") {
      throw new ApiError("internal", "TOKEN_PEPPER is not set or shorter than 32 characters (copy .dev.vars.example to .dev.vars, or pnpm kit:dev-vars)");
    }
    throw e;
  }
  if (!hit) return null;
  const [{ results }, def] = await Promise.all([
    env.DB.prepare(
      "SELECT o.id, o.slug, o.name, o.plan, om.role FROM org_members om JOIN orgs o ON o.id = om.org_id WHERE om.member_id = ? ORDER BY om.created_at, o.slug",
    )
      .bind(hit.member.id)
      .all<OrgRef>(),
    env.DB.prepare("SELECT default_org_id FROM members WHERE id = ?").bind(hit.member.id).first<{ default_org_id: string | null }>(),
  ]);
  return {
    member: { id: hit.member.id, email: hit.member.email, name: hit.member.name },
    orgs: results,
    defaultOrg: results.find((o) => o.id === def?.default_org_id) ?? results[0] ?? null,
    tokenId: hit.tokenId,
  };
}

export const requireBearer = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearerOf(c.req.header("authorization"));
  const caller = token ? await authenticate(c.env, token) : null;
  if (!caller) {
    return c.json({ error: { code: "unauthorized", message: "a valid kit_ bearer token is required (pnpm kit:token)" } }, 401, {
      "WWW-Authenticate": 'Bearer realm="kit"',
    });
  }
  c.set("caller", caller);
  await next();
});
