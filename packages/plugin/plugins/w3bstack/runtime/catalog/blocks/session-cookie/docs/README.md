# Browser sessions

Install beside email-code-auth or an existing self-hosted identity provider. The identity provider proves who signed in; this block persists a revocable browser session. The HMAC is domain-separated and verified with Web Crypto before reading D1. Only a SHA-256 digest of the random session id is stored.

```ts
const { setCookie } = await createSession(env, verifiedMember.id, request);
response.headers.append("Set-Cookie", setCookie);
app.route("/auth/session", sessionRoutes());
app.use("/account/*", requireSession);
```

Protect the login flow itself against login CSRF (or validate OAuth state/PKCE). On cookie-backed writes, the middleware requires Origin to equal the incoming request URL's origin; do not rewrite the request origin from untrusted forwarding headers. No permissive credentialed CORS is configured.

HTTPS is required except HTTP loopback development. The browser receives a distinct dev_ name on loopback so a Secure __Host- cookie is never silently downgraded. Tests exercise headers and authorization in workerd; actual browser cookie enforcement remains the host application's browser-e2e responsibility.

The host must revoke sessions on account disable/delete, limit sign-in attempts, apply any account quotas, and schedule bounded cleanup. D1 is consulted per request so revocation does not have a KV propagation window. A concurrent request authenticated before revocation may finish. No UI, password storage, email verification, OAuth provider, idle timeout, or per-owner session cap is included.
