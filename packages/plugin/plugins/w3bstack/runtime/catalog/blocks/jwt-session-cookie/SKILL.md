---
name: jwt-session-cookie
description: HKDF-derived HS256 browser JWT cookies with uncached D1 version and logout revocation checks for Hono Workers.
---

The block adds a JWT service, Hono middleware, read/logout routes and two D1 tables: jwt_session_owners and jwt_session_revocations. It carries the house HKDF/HS256/version pattern into a multi-user Worker. It is independent of the opaque session-cookie block.

Use after an existing login flow proves a trusted account identity. The token carries only subject, version, random token id, issuer, audience and absolute issue/expiry times. JWT contents are readable; this is not encrypted storage, an OAuth access token, or a refresh-token flow. No passwords, account records, UI, role claims, device list or sign-in rate limiting are included.

Configure JWT_SESSION_ORIGIN as the canonical application origin without a trailing slash. Production requires HTTPS; loopback HTTP uses a distinct dev_ cookie. Configure JWT_SESSION_SECRET with at least 32 random bytes encoded as a string. HKDF separates the session signing key by purpose, cookie name and origin. It does not strengthen a guessable password. Rotating the secret signs out every browser.

After verified sign-in and active-account checks, call createJwtSession(env, trustedMemberId, request), append its setCookie, and return a private, no-store response. An unsafe login request must carry the configured same-origin Origin. OAuth GET callbacks still need state/PKCE verification by the host. Never accept the subject directly from request JSON. Mount jwtSessionRoutes() at routePrefix and apply requireJwtSession to cookie-authenticated APIs. Cookie mutations require the exact configured Origin; no credentialed CORS policy is installed. Native form hosts must preserve same-origin referrers so browsers can send that Origin.

Await revokeOwnerJwtSessions after credential or identity recovery. Await setJwtSessionOwnerEnabled with false on suspension/deletion, and true on authorized re-enable. Both disabling and re-enabling rotate a random version; old tokens cannot return. Keep lifecycle updates consistent with the host account system. The block's owner table has no foreign key to an application-specific identity schema.

Every cryptographically valid read makes a fresh first-primary D1 query for owner version, disabled status and token revocation. There is no authorization cache. Database/configuration failures propagate; they are not accepted as anonymous sessions. A request already authenticated before a revocation can still finish. No idle timeout or automatic renewal is provided.

Current logout adds the random token id to a denylist until expiry before clearing the cookie. Await cleanupJwtSessionRevocations from scheduled maintenance; each call removes at most 500 expired entries. Keep live revocations. The traveling workerd tests cover real migrations, key separation, strict claims, expiry, primary reads, both revocation modes, lifecycle changes, hardened cookies and Origin checks. The host owns actual browser sign-in and cookie-enforcement e2e coverage.
