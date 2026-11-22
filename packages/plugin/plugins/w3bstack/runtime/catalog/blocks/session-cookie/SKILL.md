---
name: session-cookie
description: Revocable browser cookie sessions for a Hono Worker and D1.
---

Adds one browser_sessions table and a session service, middleware, and read/logout routes. HTTPS cookies use a __Host- name, Secure, HttpOnly, SameSite=Lax and Path=/; HTTP loopback development uses a different dev_ cookie name. No Domain attribute is emitted.

Use after an existing sign-in flow has verified the identity. This block does not implement passwords, email codes, OAuth consent, or account records. createSession receives the trusted owner id and returns a Set-Cookie value. No public endpoint accepts an arbitrary owner id.

Adapt: configure SESSION_SECRET with at least 32 random characters; append createSession().setCookie after verified sign-in; mount sessionRoutes() at the routePrefix; apply requireSession to other browser APIs. The host sign-in endpoint needs its own CSRF or OAuth-state verification. Unsafe methods require an exact same-origin Origin header; browsers supply it for same-origin fetch POSTs. Non-browser clients can use the existing bearer-auth block.

Revoke all sessions when deleting or disabling an account. Await cleanupSessions from scheduled maintenance; each call removes at most 500 expired/revoked rows. There is no foreign key because the host owns its identity schema.

Verification includes real D1 migration replay, HMAC/expiry/revocation, secure/development cookies, forged/duplicate cookie rejection and mounted route origin checks. Sessions query D1 on every request; no KV or cross-request auth cache is used. Rotation of SESSION_SECRET signs out every browser. There is no sliding idle timeout, device management UI or external OAuth provider.
