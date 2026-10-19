Build a usable fullstack local Cloudflare Workers app called Kitchen Sink, using the supplied Hono + TypeScript + D1 + private R2 + optional KV starter. Implement the following HTTP contract and browser journey. Work only in this project. Do not browse the web, deploy, send email, use external services, or read any other project. You can install npm dependencies. All credentials below are public local fixtures. Keep the app runnable with pnpm dev and its migrations applicable with pnpm db:local. Use the project_check tool to run typecheck, test, build, and local migrations. It executes fixed argv commands and handles its own process cleanup. Bash is unavailable; use Read/Write/Edit/Glob/Grep for project files. Never send process signals, invoke pkill/killall, write shared /tmp files, or affect another project. You have a $5 model budget; prioritize working behavior and tests over explanation.

Session and local demo login:
- POST /api/login accepts JSON {email,password}. Only alice@example.test and bob@example.test with password local-demo-password are accepted, and only when ENVIRONMENT=dev. In other environments reject demo login. Persist revocable sessions in D1, use an HMAC-authenticated HttpOnly SameSite=Lax cookie (Secure on HTTPS, loopback-only HTTP development), with no credential in localStorage. Do not accept arbitrary supplied owner IDs. Reject unsafe API requests unless Origin exactly matches the request origin; missing/foreign/null origins return 403.
- GET /api/session returns {user:{id,email}} or 401.
- POST /api/logout returns 204, expires the cookie and revokes its server-side session. Replaying that cookie must return 401.

Profiles:
- Authenticated GET /api/profile returns {profile:{handle,display_name,bio,avatar_id,is_public},revision}. Start at revision 0 if no profile exists.
- PUT /api/profile accepts {handle,display_name,bio,avatar_id:null,is_public:false,revision}. Enforce bounds (handle 3..30 lowercase letters/digits/underscore, display_name 1..80, bio at most 500) and optimistic concurrency. Return the new profile and increased revision. Stale updates return 409 without overwriting current values. Owner comes only from session. Persist across browser reloads.

Private files:
- Authenticated POST /api/uploads accepts a raw request body (Content-Type application/octet-stream) of at most 1 MiB and returns 201 {id}. Stream and bound reads; oversized bodies return 413. Store privately in the R2 UPLOADS binding under a session-owner-specific key; do not use client paths as object keys.
- GET /api/uploads/:id returns exact bytes, Content-Disposition attachment, X-Content-Type-Options nosniff, and private/no-store cache policy. GET by other owners and missing IDs returns 404. DELETE /api/uploads/:id by another owner may return 404 or an idempotent 204, but MUST leave the real owner’s bytes intact. Deletion by the real owner returns 204, and subsequent reads return 404.

Cached report:
- Authenticated GET /api/report returns {revision,displayName,cacheTier}. Load authoritative current profile revision before selecting a cache entry. Use a tenant- and revision-specific key for Cache API and/or RESULT_CACHE KV. The first report after an update is origin-loaded; repeated requests hit edge or kv. cacheTier is origin, edge, or kv. Revision changes must immediately prevent an old report being served. Never cache authorization or share profile content between accounts.

Browser UI:
- Serve a readable responsive page at /. Include labels and these exact data-testid attributes for automation:
  login-email, login-password, login-submit; profile-handle, profile-display-name, profile-bio, profile-save, profile-status; upload-file (input type=file), upload-submit, upload-download (download link for last uploaded file); report-refresh, report-status; logout.
- After login show editable profile, upload/download, report, and logout controls. Hide authenticated controls after logout. Show saved status in profile-status, and display name + revision in report-status. Login must survive reload; logout must clear the UI.

Add focused tests for your implementation and document how to run it. An independent acceptance suite will test real local D1/R2 behavior, cross-account isolation, CSRF, revocation, conflicts, cache freshness, upload limits, and the browser journey. Keep the interface exact. Do not replace pnpm commands with success stubs.
