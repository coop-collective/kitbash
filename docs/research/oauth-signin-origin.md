# OAuth browser login Origin guard (2026-10-19)

Concrete defect reproduced in the existing cli-oauth-login 1.1.0 block: a foreign-origin form POST containing a valid
attacker-owned bearer token returned 303 and a new OAuth browser session cookie. The provider's consent protection
starts later and does not guard this login step. The first regression failed with expected 403 / actual 303 while
20 existing OAuth tests passed. The fix is a 1.1.1 patch to that block, not another OAuth implementation.

Canonical source: `/Users/coop/Workspace/ideator` at `3faf4c64cc6e2fe279b2a48d5e8b01ca40443a73`,
`packages/api/src/oauth.ts` (`signInEmail`, `signInCode`, `signInToken`) shares the missing login Origin check.
A related source, `/Users/coop/Workspace/inference-market` at `9231c25a2b7cbf9a04c428fe44324efaec3344f4`,
`packages/web/src/auth/routes.ts`, has a same-origin mutation guard and documents the browser form interaction with
Referrer-Policy. Its permissive missing/null Origin fallback was not copied.

The block now rejects foreign, absent and opaque origins before parsing forms or touching identity state. Its pages
change from no-referrer to same-origin: basic form POSTs can otherwise send Origin: null under no-referrer, so a guard
alone would break legitimate browser sign-in. Same-origin suppresses referrers to external destinations while keeping
same-origin native forms verifiable. Token endpoint, registration, refresh and API bearer requests keep their existing
non-browser behavior. Consent still uses the provider's existing handle/cookie protection.

Sources: [Ideator sign-in](https://github.com/Disturbing/ideator/blob/3faf4c64cc6e2fe279b2a48d5e8b01ca40443a73/packages/api/src/oauth.ts),
[reference guard](https://github.com/null-shot/inference-market/blob/9231c25a2b7cbf9a04c428fe44324efaec3344f4/packages/web/src/auth/routes.ts).
Protocol references checked: [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html),
[MDN Origin](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin) and
[MDN Referrer-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy).

Verification: the pre-fix default-template regression demonstrates the 303 bug. After the fix,
`KIT_E2E_ONLY=cli-oauth-login node --test test-e2e/install.test.mjs` exercises defaults, prefixed/no-email/refuse-remote,
table-conflict resolution and both existing auth stack chains (five cases), each installed into a clean template with traveling
workerd tests, real D1/KV, TypeScript and lock verification. New regressions cover all three login endpoints,
foreign/subdomain/port/missing/null origins, no new KV sessions, no foreign-triggered email, preservation of a valid
code for a later same-origin submit, and the same-origin referrer policy. There is no deploy or source-repo edit.

Remaining scope: this is a login-CSRF fix, not a full OAuth audit. Body-size/rate policy and the block's existing
loopback-development cookie behavior remain independent concerns. The provider also warns that client metadata
documents are disabled unless the host enables the global_fetch_strictly_public compatibility flag; this patch does
not silently change the host's global fetch semantics.

A local Chromium 151.0.7922.34 native-form smoke check also read the page module's configured policy and verified
three browser behaviors: the old no-referrer policy produced Origin: null; same-origin produced the actual local
server Origin on a same-origin form POST; and a cross-origin form destination received no Referer. This was a
one-off browser semantics check using the installed Playwright runtime, not a shipped multi-browser e2e suite.
