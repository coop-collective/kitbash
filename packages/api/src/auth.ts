// kit_ bearer tokens (DESIGN §6.4, MVP): opaque, 32 random bytes base64url, stored only as HMAC-SHA256 with
// TOKEN_PEPPER. Every route but /health goes through requireBearer.
import { base64UrlEncode, hex } from "@kitbash/core";
import { createMiddleware } from "hono/factory";
import { ApiError, type AppEnv, type Bindings, type Caller, type OrgRef } from "./types";
import { newId, now } from "./util";

export const TOKEN_RE = /^kit_[A-Za-z0-9_-]{43}$/;

async function pepperKey(env: Bindings): Promise<CryptoKey> {
  if (!env.TOKEN_PEPPER) throw new ApiError("internal", "TOKEN_PEPPER is not set (copy .dev.vars.example to .dev.vars, or pnpm kit:dev-vars)");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(env.TOKEN_PEPPER), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export async function hashToken(env: Bindings, token: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await pepperKey(env), new TextEncoder().encode(token));
  return hex(sig);
}

/** Mints a token for a member; returns the plaintext (shown once). Used by tests; scripts/token.mjs does the same. */
export async function issueToken(env: Bindings, memberId: string, label: string): Promise<string> {
  const token = `kit_${base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))}`;
  await env.DB.prepare("INSERT INTO member_tokens (id, member_id, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(newId("tok"), memberId, await hashToken(env, token), label, now())
    .run();
  return token;
}

export async function authenticate(env: Bindings, token: string): Promise<Caller | null> {
  if (!TOKEN_RE.test(token)) return null;
  const row = await env.DB.prepare(
    `SELECT t.id AS token_id, t.last_used_at, m.id, m.email, m.name, m.default_org_id
       FROM member_tokens t JOIN members m ON m.id = t.member_id
      WHERE t.token_hash = ? AND t.revoked_at IS NULL`,
  )
    .bind(await hashToken(env, token))
    .first<{ token_id: string; last_used_at: string | null; id: string; email: string; name: string | null; default_org_id: string | null }>();
  if (!row) return null;
  const { results } = await env.DB.prepare(
    "SELECT o.id, o.slug, o.name, o.plan, om.role FROM org_members om JOIN orgs o ON o.id = om.org_id WHERE om.member_id = ? ORDER BY om.created_at, o.slug",
  )
    .bind(row.id)
    .all<OrgRef>();
  const ts = now();
  // last_used_at at most once a minute
  if (!row.last_used_at || Date.parse(ts) - Date.parse(row.last_used_at) > 60_000) {
    await env.DB.prepare("UPDATE member_tokens SET last_used_at = ? WHERE id = ?").bind(ts, row.token_id).run();
  }
  return {
    member: { id: row.id, email: row.email, name: row.name },
    orgs: results,
    defaultOrg: results.find((o) => o.id === row.default_org_id) ?? results[0] ?? null,
    tokenId: row.token_id,
  };
}

export const requireBearer = createMiddleware<AppEnv>(async (c, next) => {
  const m = /^Bearer\s+(\S+)$/.exec(c.req.header("authorization") ?? "");
  const caller = m ? await authenticate(c.env, m[1]!) : null;
  if (!caller) {
    return c.json({ error: { code: "unauthorized", message: "a valid kit_ bearer token is required (pnpm kit:token)" } }, 401, {
      "WWW-Authenticate": 'Bearer realm="kit"',
    });
  }
  c.set("caller", caller);
  await next();
});
