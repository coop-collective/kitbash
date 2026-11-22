# JWT browser sessions

This block extracts mailcheap's purpose-separated HKDF/HS256 session token and version revocation into a Hono + D1
feature. It is an alternative to the opaque `session-cookie` block. The host still proves identity using its chosen
password, email-code or OAuth login flow.

```ts
import { createJwtSession, revokeOwnerJwtSessions, setJwtSessionOwnerEnabled } from "./lib/jwt-session-cookie/session";
import { jwtSessionRoutes, requireJwtSession } from "./lib/jwt-session-cookie/routes";

// Inside an authenticated login callback, after checking account status and login CSRF/OAuth state:
const { setCookie } = await createJwtSession(env, verifiedMember.id, request);
response.headers.append("Set-Cookie", setCookie);
response.headers.set("Cache-Control", "private, no-store");

app.route("/auth/jwt-session", jwtSessionRoutes()); // use the rendered routePrefix
app.use("/account/*", requireJwtSession);

// Await in the account's credential-reset and suspension/deletion flows:
await revokeOwnerJwtSessions(env, verifiedMember.id);
await setJwtSessionOwnerEnabled(env, verifiedMember.id, false);
```

Set `JWT_SESSION_ORIGIN` to the exact public origin, such as `https://app.example.test`, without a trailing slash.
Use a secret generated from at least 32 random bytes, encoded as a string, for `JWT_SESSION_SECRET`. A minimum string
length check cannot establish entropy. Keep the secret in local/deployment secret storage. The block receives a small
binding interface; hosts can compose it with their generated Wrangler environment types.

The JWT profile fixes HS256 and `typ=kitbash-session+jwt`, requires issuer, audience, subject, random `jti`, random
owner version `v`, `iat` and `exp`, and limits lifetime to the configured TTL. Unknown claims and key-selection headers
are rejected. HKDF includes a versioned purpose, cookie name and configured origin. Using the raw secret, another
purpose, another origin or another cookie namespace cannot produce an accepted session. JWTs are signed, not encrypted;
the subject and other claims are visible. Do not add passwords, profile data, roles or mutable authorization facts.

HTTPS cookies are `__Host-<cookieName>; Secure; HttpOnly; SameSite=Lax; Path=/` without Domain. HTTP is accepted only for
configured loopback development, with a distinct `dev_<cookieName>` cookie. Duplicate cookie names, noncanonical token
encoding, oversized cookie headers and requests to a different origin are rejected. Unsafe requests must carry an
Origin exactly matching configuration. For native forms, use a referrer policy such as `same-origin`; `no-referrer` can
cause an opaque Origin. GET/HEAD handlers must stay read-only. OAuth callback handlers must validate state and PKCE.

The two tables deliberately keep authorization authoritative:

- `jwt_session_owners` stores each subject's random version and disabled flag. Revoke-all rotates the version even
  within the same second. Disabling and re-enabling both rotate it; old sessions stay invalid. These operations are
  host service functions, not public endpoints that accept arbitrary subjects.
- `jwt_session_revocations` stores only a logged-out token's random id and expiry. Current-browser logout waits for
  this write before clearing the cookie. Await bounded cleanup from a scheduled handler after token expiry.

Each accepted session makes one fresh `withSession("first-primary")` query combining version, disabled status and
denylist checks. There is no KV, Cache API, process or result cache for these decisions. D1 and configuration failures
propagate. Middleware responses are private/no-store. An in-flight request authorized before a revocation may finish;
a login racing a version rotation may issue a token that is immediately invalid and needs a new login attempt.

The host must call lifecycle hooks consistently with account changes, authenticate active account status before
issuing a token, rate-limit login attempts and supply application authorization. For deletion, keep the disabled owner
record as a tombstone until the account lifecycle guarantees that identity cannot sign in again. No refresh flow,
idle timeout, key ring, session/device inventory or UI is included. HS256 verifiers possess signing capability; use an
asymmetric design for mutually untrusted verifiers. This profile is intentionally incompatible with existing mailcheap
JWTs and the opaque block; adoption requires a planned sign-out.

The traveling tests exercise migrations and bindings in workerd for both default and alternate parameters. Browser
cookie enforcement, UI sign-in, real replica propagation and production lifecycle wiring require host integration
tests; local D1 does not simulate a geographically distributed read replica.
