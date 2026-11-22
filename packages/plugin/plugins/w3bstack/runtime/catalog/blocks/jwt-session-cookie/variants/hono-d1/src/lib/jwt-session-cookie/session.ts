import { SignJWT, base64url, jwtVerify } from "jose";

export type JwtSessionEnv = { DB: D1Database; JWT_SESSION_SECRET: string; JWT_SESSION_ORIGIN: string };
export type JwtSession = { id: string; owner_id: string; created_s: number; expires_s: number };
export const JWT_SESSION_TTL_SECONDS = {{kit.ttlSeconds}};
const encoder = new TextEncoder();
const TYPE = "kitbash-session+jwt";
const AUDIENCE = "kitbash:{{kit.cookieName}}:browser";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function owner(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}
function seconds(now: number): number {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid session time");
  return now;
}
function origin(env: JwtSessionEnv): URL {
  const url = new URL(env.JWT_SESSION_ORIGIN);
  const loopback = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.origin !== env.JWT_SESSION_ORIGIN || (url.protocol !== "https:" && !loopback)) {
    throw new Error("JWT_SESSION_ORIGIN must be a canonical HTTPS origin or loopback HTTP origin");
  }
  return url;
}
function cookieName(env: JwtSessionEnv): string {
  return origin(env).protocol === "https:" ? "__Host-{{kit.cookieName}}" : "dev_{{kit.cookieName}}";
}
function cookie(env: JwtSessionEnv, value: string, maxAge: number): string {
  const secure = origin(env).protocol === "https:" ? "; Secure" : "";
  return `${cookieName(env)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
/** The expected origin comes from deployment configuration, never a forwarded or Host header. */
export function sameOriginJwtMutation(env: JwtSessionEnv, request: Request): boolean {
  const expected = origin(env).origin;
  return new URL(request.url).origin === expected &&
    (["GET", "HEAD", "OPTIONS"].includes(request.method) || request.headers.get("origin") === expected);
}
async function signingKey(env: JwtSessionEnv): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof env.JWT_SESSION_SECRET !== "string" || env.JWT_SESSION_SECRET.length < 32) {
    throw new Error("JWT_SESSION_SECRET must contain at least 32 random characters");
  }
  const material = await crypto.subtle.importKey("raw", encoder.encode(env.JWT_SESSION_SECRET), "HKDF", false, ["deriveBits"]);
  const info = encoder.encode(`kitbash/jwt-session-cookie/v1\n{{kit.cookieName}}\n${origin(env).origin}`);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info }, material, 256));
}
function requestToken(env: JwtSessionEnv, request: Request): string | null {
  if (new URL(request.url).origin !== origin(env).origin) return null;
  const header = request.headers.get("cookie") ?? "";
  if (header.length > 16384) return null;
  const name = cookieName(env);
  const matches = header.split(";").map(value => value.trim()).filter(value => value.startsWith(name + "="));
  if (matches.length !== 1) return null;
  const token = matches[0]!.slice(name.length + 1);
  if (token.length > 3800 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    if (token.split(".").some(part => base64url.encode(base64url.decode(part)) !== part)) return null;
  } catch { return null; }
  return token;
}

/** Call only after verifying login proof and account status. The owner id is trusted server data. */
export async function createJwtSession(env: JwtSessionEnv, ownerId: string, request: Request, now = Math.floor(Date.now() / 1000)): Promise<{ setCookie: string }> {
  if (!owner(ownerId)) throw new Error("Invalid session owner");
  if (!sameOriginJwtMutation(env, request)) throw new Error("same-origin Origin required");
  seconds(now);
  const key = await signingKey(env);
  // A new login must not re-enable a disabled owner or rotate an existing owner's version.
  const state = await env.DB.withSession("first-primary").prepare(`
    INSERT INTO {{kit.tablePrefix}}jwt_session_owners (owner_id, version, disabled) VALUES (?, ?, 0)
    ON CONFLICT(owner_id) DO UPDATE SET owner_id = excluded.owner_id RETURNING version, disabled
  `).bind(ownerId, crypto.randomUUID()).first<{ version: string; disabled: number }>();
  if (!state || state.disabled !== 0) throw new Error("Session owner is disabled");
  const token = await new SignJWT({ v: state.version }).setProtectedHeader({ alg: "HS256", typ: TYPE })
    .setIssuer(origin(env).origin).setAudience(AUDIENCE).setSubject(ownerId).setJti(crypto.randomUUID())
    .setIssuedAt(now).setExpirationTime(now + JWT_SESSION_TTL_SECONDS).sign(key);
  return { setCookie: cookie(env, token, JWT_SESSION_TTL_SECONDS) };
}

/** Every successful verification re-reads authoritative version, disabled and revocation state. */
export async function readJwtSession(env: JwtSessionEnv, request: Request, now = Math.floor(Date.now() / 1000)): Promise<JwtSession | null> {
  seconds(now);
  const token = requestToken(env, request);
  if (!token) return null;
  const key = await signingKey(env); // Configuration faults remain visible, not mistaken for bad credentials.
  let session: JwtSession;
  let version: string;
  try {
    const { payload, protectedHeader } = await jwtVerify(token, key, {
      algorithms: ["HS256"], typ: TYPE, issuer: origin(env).origin, audience: AUDIENCE,
      requiredClaims: ["sub", "jti", "iat", "exp", "v"], maxTokenAge: JWT_SESSION_TTL_SECONDS,
      clockTolerance: 0, currentDate: new Date(now * 1000),
    });
    if (protectedHeader.typ !== TYPE || Object.keys(protectedHeader).some(name => !["alg", "typ"].includes(name))) return null;
    if (Object.keys(payload).some(name => !["sub", "jti", "iat", "exp", "v", "iss", "aud"].includes(name))) return null;
    const { sub, jti, iat, exp, v } = payload;
    if (!owner(sub) || typeof jti !== "string" || !UUID.test(jti) || typeof v !== "string" || !UUID.test(v)) return null;
    if (typeof iat !== "number" || typeof exp !== "number" || !Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return null;
    if (iat < 0 || iat > now || exp <= iat || exp - iat > JWT_SESSION_TTL_SECONDS) return null;
    if (payload.aud !== AUDIENCE) return null;
    session = { id: jti, owner_id: sub, created_s: iat, expires_s: exp };
    version = v;
  } catch { return null; }
  // New first-primary session for this one query: never reuse a replica bookmark or cache an auth decision.
  const active = await env.DB.withSession("first-primary").prepare(`
    SELECT 1 AS active FROM {{kit.tablePrefix}}jwt_session_owners
    WHERE owner_id = ? AND version = ? AND disabled = 0
      AND NOT EXISTS (SELECT 1 FROM {{kit.tablePrefix}}jwt_session_revocations WHERE jti = ? AND expires_s > ?)
  `).bind(session.owner_id, version, session.id, now).first();
  return active ? session : null;
}

export function clearJwtSessionCookie(env: JwtSessionEnv): string { return cookie(env, "", 0); }

/** POST-only current-browser logout. Revocation completes before the clearing cookie is returned. */
export async function destroyJwtSession(env: JwtSessionEnv, request: Request, now = Math.floor(Date.now() / 1000)): Promise<string> {
  if (request.method !== "POST" || !sameOriginJwtMutation(env, request)) throw new Error("same-origin POST required");
  const session = await readJwtSession(env, request, now);
  if (session) {
    await env.DB.prepare(`INSERT INTO {{kit.tablePrefix}}jwt_session_revocations (jti, expires_s) VALUES (?, ?) ON CONFLICT(jti) DO NOTHING`)
      .bind(session.id, session.expires_s).run();
  }
  return clearJwtSessionCookie(env);
}
/** Rotate after password/identity recovery and for sign-out-all. A disabled owner stays disabled. */
export async function revokeOwnerJwtSessions(env: JwtSessionEnv, ownerId: string): Promise<void> {
  if (!owner(ownerId)) throw new Error("Invalid session owner");
  await env.DB.prepare(`INSERT INTO {{kit.tablePrefix}}jwt_session_owners (owner_id, version, disabled) VALUES (?, ?, 0)
    ON CONFLICT(owner_id) DO UPDATE SET version = excluded.version`).bind(ownerId, crypto.randomUUID()).run();
}
/** Mirror account suspension/deletion; re-enabling also rotates the version so old sessions stay invalid. */
export async function setJwtSessionOwnerEnabled(env: JwtSessionEnv, ownerId: string, enabled: boolean): Promise<void> {
  if (!owner(ownerId)) throw new Error("Invalid session owner");
  await env.DB.prepare(`INSERT INTO {{kit.tablePrefix}}jwt_session_owners (owner_id, version, disabled) VALUES (?, ?, ?)
    ON CONFLICT(owner_id) DO UPDATE SET version = excluded.version, disabled = excluded.disabled`)
    .bind(ownerId, crypto.randomUUID(), enabled ? 0 : 1).run();
}
/** Await from a scheduled handler. Keep revocations until their JWTs can no longer pass expiry validation. */
export async function cleanupJwtSessionRevocations(env: JwtSessionEnv, now = Math.floor(Date.now() / 1000)): Promise<number> {
  seconds(now);
  const result = await env.DB.prepare(`DELETE FROM {{kit.tablePrefix}}jwt_session_revocations
    WHERE jti IN (SELECT jti FROM {{kit.tablePrefix}}jwt_session_revocations WHERE expires_s <= ? LIMIT 500)`).bind(now).run();
  return result.meta.changes;
}
