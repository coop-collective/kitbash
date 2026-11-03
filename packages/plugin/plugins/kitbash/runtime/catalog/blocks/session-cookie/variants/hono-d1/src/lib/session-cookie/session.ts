export type SessionEnv = { DB: D1Database; SESSION_SECRET: string };
export type Session = { id: string; owner_id: string; created_ms: number; expires_ms: number };
export const SESSION_TTL_SECONDS = {{kit.ttlSeconds}};
const encoder = new TextEncoder();

function cookieConfig(request: Request): { name: string; secure: string } | null {
  const url = new URL(request.url);
  if (url.protocol === "https:") return { name: "__Host-{{kit.cookieName}}", secure: "; Secure" };
  if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return { name: "dev_{{kit.cookieName}}", secure: "" };
  }
  return null;
}
function cookie(request: Request, value: string, age: number): string {
  const config = cookieConfig(request);
  if (!config) throw new Error("Browser sessions require HTTPS or loopback HTTP");
  return `${config.name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${config.secure}`;
}
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "="), c => c.charCodeAt(0));
}
async function key(env: SessionEnv): Promise<CryptoKey> {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return crypto.subtle.importKey("raw", encoder.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function idHash(id: string): Promise<string> {
  return encode(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(id))));
}
async function authenticatedId(env: SessionEnv, request: Request): Promise<string | null> {
  const config = cookieConfig(request);
  if (!config) return null;
  const matches = (request.headers.get("cookie") ?? "").split(";").map(v => v.trim()).filter(v => v.startsWith(config.name + "="));
  // Duplicate cookie names can hide path/domain shadowing; reject rather than picking one.
  if (matches.length !== 1) return null;
  const value = matches[0]!.slice(config.name.length + 1);
  const match = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return null;
  const id = match[1]!;
  const signature = decode(match[2]!);
  if (encode(signature) !== match[2]) return null;
  if (!await crypto.subtle.verify("HMAC", await key(env), signature, encoder.encode(`kitbash/session/v1:${id}`))) return null;
  return idHash(id);
}
/** The owner id comes from a verified login, never from untrusted JSON or a URL parameter. */
export async function createSession(env: SessionEnv, ownerId: string, request: Request, now = Date.now()): Promise<{ setCookie: string }> {
  if (!ownerId || ownerId.length > 256) throw new Error("Invalid session owner");
  const signingKey = await key(env);
  const id = encode(crypto.getRandomValues(new Uint8Array(32)));
  const signature = encode(new Uint8Array(await crypto.subtle.sign("HMAC", signingKey, encoder.encode(`kitbash/session/v1:${id}`))));
  const setCookie = cookie(request, `${id}.${signature}`, SESSION_TTL_SECONDS);
  await env.DB.prepare(`INSERT INTO {{kit.tablePrefix}}browser_sessions (id, owner_id, created_ms, expires_ms) VALUES (?, ?, ?, ?)`)
    .bind(await idHash(id), ownerId, now, now + SESSION_TTL_SECONDS * 1000).run();
  return { setCookie };
}
export async function readSession(env: SessionEnv, request: Request, now = Date.now()): Promise<Session | null> {
  const id = await authenticatedId(env, request);
  if (!id) return null;
  return env.DB.prepare(`SELECT id, owner_id, created_ms, expires_ms FROM {{kit.tablePrefix}}browser_sessions WHERE id = ? AND revoked_ms IS NULL AND expires_ms > ?`)
    .bind(id, now).first<Session>();
}
export async function destroySession(env: SessionEnv, request: Request, now = Date.now()): Promise<string> {
  const id = await authenticatedId(env, request);
  if (id) await env.DB.prepare(`UPDATE {{kit.tablePrefix}}browser_sessions SET revoked_ms = ? WHERE id = ? AND revoked_ms IS NULL`).bind(now, id).run();
  return cookie(request, "", 0);
}
export async function revokeOwnerSessions(env: SessionEnv, ownerId: string, now = Date.now()): Promise<number> {
  const result = await env.DB.prepare(`UPDATE {{kit.tablePrefix}}browser_sessions SET revoked_ms = ? WHERE owner_id = ? AND revoked_ms IS NULL`).bind(now, ownerId).run();
  return result.meta.changes;
}
/** Bounded work for an awaited cron task; repeat on later runs until no rows remain. */
export async function cleanupSessions(env: SessionEnv, now = Date.now()): Promise<number> {
  const result = await env.DB.prepare(`DELETE FROM {{kit.tablePrefix}}browser_sessions WHERE id IN (SELECT id FROM {{kit.tablePrefix}}browser_sessions WHERE expires_ms <= ? OR revoked_ms IS NOT NULL LIMIT 500)`).bind(now).run();
  return result.meta.changes;
}
export function sameOriginMutation(request: Request): boolean {
  return ["GET", "HEAD", "OPTIONS"].includes(request.method) || request.headers.get("origin") === new URL(request.url).origin;
}
