// The authorize page (GET/POST /authorize): sign in (a pasted token, or an email code when emailSignIn is on, or the
// session cookie of an earlier sign-in), then confirm "My CLI on this computer". Approving makes a cli_logins row and
// completes the grant with props { kind: "cli", cli_id, member_id }; the CLI then acts as the person.
import { AuthorizationError, CimdFetchError, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { createCliLogin } from "./cli-logins";
import { EMAIL_SIGN_IN, memberByCode, memberById, memberByToken, sendSignInCode } from "./identity";
import { consentPage, errorPage, signInPage } from "./pages";
import { SCOPES } from "./provider";
import type { CliProps, OAuthEnv, OAuthMember } from "./types";

const SESSION_COOKIE = "__Host-oauth_session";
const SESSION_TTL_S = 12 * 3600;
/** "refuse": only redirects to this computer may sign in; "warn": others are shown a warning on the consent page. */
const REMOTE_CLIENTS = "{{kit.remoteClients}}" as "warn" | "refuse";

const enc = new TextEncoder();
async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isLoopbackUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    return ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}
function hostOf(uri: string): string {
  try {
    return new URL(uri).host || uri;
  } catch {
    return uri;
  }
}

// ------------------------------------------------------------------ sign-in sessions (KV, hashed key)

const sessionKey = async (token: string) => `oauth_session:${await sha256Hex(token)}`;

function cookieOf(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export async function sessionMember(env: OAuthEnv, req: Request): Promise<OAuthMember | null> {
  const token = cookieOf(req, SESSION_COOKIE);
  if (!token) return null;
  const s = await env.OAUTH_KV.get<{ member_id: string }>(await sessionKey(token), "json");
  return s ? memberById(env, s.member_id) : null;
}

async function startSession(env: OAuthEnv, memberId: string): Promise<string> {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.OAUTH_KV.put(await sessionKey(token), JSON.stringify({ member_id: memberId, created_at: Date.now() }), { expirationTtl: SESSION_TTL_S });
  return `${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_S}`;
}

// Browser login forms create an authenticated cookie before OAuth consent. Consent CSRF protection
// does not cover this earlier login boundary; fail closed for missing and opaque origins as well.
function signInOriginError(req: Request): Response | null {
  return req.headers.get("origin") === new URL(req.url).origin
    ? null
    : errorPage("Sign-in must be submitted from this site's own page. Reload the sign-in page and try again.", 403);
}

// ------------------------------------------------------------------ handlers

/** Only our own authorize URL is a place to come back to after signing in. */
export function safeReturn(v: unknown): string {
  const s = String(v ?? "");
  return s.startsWith("/authorize?") && !s.includes("\\") ? s : "/authorize";
}

async function form(req: Request): Promise<FormData> {
  try {
    return await req.formData();
  } catch {
    return new FormData();
  }
}

const helpers = (env: OAuthEnv): OAuthHelpers | undefined => env.OAUTH_PROVIDER;

function authError(e: unknown): Response {
  if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
  if (e instanceof AuthorizationError) return errorPage(e.description);
  if (e instanceof CimdFetchError) return errorPage("This app could not be verified (its client metadata document did not load).");
  throw e;
}

export async function authorizeGet(env: OAuthEnv, req: Request): Promise<Response> {
  const oauth = helpers(env);
  if (!oauth) return errorPage("OAuth is not available on this host (it needs https, or http on localhost).", 404);
  try {
    const auth = await oauth.parseAuthRequest(req);
    const member = await sessionMember(env, req);
    const u = new URL(req.url);
    if (!member) return signInPage(`${u.pathname}${u.search}`, { emailEnabled: EMAIL_SIGN_IN });
    const details = await oauth.describeConsent(auth);
    if (!details.redirectIsLoopback && REMOTE_CLIENTS === "refuse") {
      return errorPage(`Only a CLI on this computer can sign in here; ${details.redirectHost} is not this computer.`, 403);
    }
    const consent = await oauth.beginConsent(auth);
    const named = details.clientName && !details.clientName.startsWith("http") ? details.clientName.slice(0, 40) : "CLI";
    return consentPage(
      {
        handle: consent.handle,
        client_name: details.clientName,
        client_domain: details.clientDomain,
        redirect_host: details.redirectHost,
        loopback: details.redirectIsLoopback,
        member_name: member.name ?? member.email,
        member_email: member.email,
        label: `${named} on this computer`,
      },
      consent.headers,
    );
  } catch (e) {
    return authError(e);
  }
}

export async function signInEmail(env: OAuthEnv, req: Request): Promise<Response> {
  const originError = signInOriginError(req);
  if (originError) return originError;
  const f = await form(req);
  const ret = safeReturn(f.get("return"));
  const email = String(f.get("email") ?? "").trim();
  if (!EMAIL_SIGN_IN) return signInPage(ret, { emailEnabled: false, error: "Email sign-in is not set up here. Paste a token." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return signInPage(ret, { emailEnabled: true, error: "That is not an email address.", email });
  try {
    await sendSignInCode(env, email);
  } catch {
    return signInPage(ret, { emailEnabled: true, error: "Could not send a code.", email });
  }
  return signInPage(ret, { emailEnabled: true, step: "code", email });
}

export async function signInCode(env: OAuthEnv, req: Request): Promise<Response> {
  const originError = signInOriginError(req);
  if (originError) return originError;
  const f = await form(req);
  const ret = safeReturn(f.get("return"));
  const email = String(f.get("email") ?? "").trim();
  const member = EMAIL_SIGN_IN ? await memberByCode(env, email, String(f.get("code") ?? "").trim()) : null;
  if (!member) return signInPage(ret, { emailEnabled: EMAIL_SIGN_IN, step: "code", email, error: "That code is wrong or expired. Request a new one." });
  return new Response(null, { status: 303, headers: { location: ret, "set-cookie": await startSession(env, member.id) } });
}

export async function signInToken(env: OAuthEnv, req: Request): Promise<Response> {
  const originError = signInOriginError(req);
  if (originError) return originError;
  const f = await form(req);
  const ret = safeReturn(f.get("return"));
  const member = await memberByToken(env, String(f.get("token") ?? "").trim());
  if (!member) return signInPage(ret, { emailEnabled: EMAIL_SIGN_IN, error: "That token is not valid (or was revoked)." });
  return new Response(null, { status: 303, headers: { location: ret, "set-cookie": await startSession(env, member.id) } });
}

/** POST /authorize: the consent form. Approve makes the cli_logins row and completes the grant. */
export async function authorizePost(env: OAuthEnv, req: Request): Promise<Response> {
  const oauth = helpers(env);
  if (!oauth) return errorPage("OAuth is not available on this host.", 404);
  const raw = req.clone();
  const f = await form(req);
  const handle = String(f.get("handle") ?? "");
  try {
    const member = await sessionMember(env, raw);
    if (!member) return errorPage("Your sign-in expired. Start signing in again from your CLI.", 401);
    if (f.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(raw, handle, { description: "the person declined" });
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(raw, handle, { scope: SCOPES });
    const request = approved.request;
    const loopback = isLoopbackUri(request.redirectUri);
    if (!loopback && REMOTE_CLIENTS === "refuse") return errorPage("Only a CLI on this computer can sign in here.", 403);
    const client = await oauth.lookupClient(request.clientId);
    const login = await createCliLogin(env, member.id, {
      label: String(f.get("label") ?? ""),
      client_id: request.clientId,
      client_name: client?.clientName ?? null,
      redirect_host: hostOf(request.redirectUri),
      loopback,
    });
    const props: CliProps = { kind: "cli", cli_id: login.id, member_id: member.id };
    const { redirectTo } = await oauth.completeAuthorization({
      request,
      userId: login.id,
      metadata: { cli_id: login.id, member_id: member.id, label: login.label },
      scope: request.scope.length ? request.scope : ["mcp"],
      props,
    });
    approved.headers.set("location", redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (e) {
    return authError(e);
  }
}
