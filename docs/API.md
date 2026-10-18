# kit-api HTTP contract (MVP, WP-02)

The Worker in `packages/api`. This is what the `kit` CLI (WP-03), the plugin (WP-04) and the remote `/mcp` clients
call. Shapes named `Card`, `Summary`, `FileEntry`, `Error` are the zod types of `@kitbash/core/contract`
(`packages/core/src/contract.ts`, JSON Schema in `packages/core/schema/contract.v1.json`); this document only adds
the REST framing around them. Owner: WP-02. Local only, default `http://localhost:8787`:

```
pnpm -F @kitbash/api kit:dev-vars   # .dev.vars with a random TOKEN_PEPPER and a fresh registry key (gitignored)
pnpm -F @kitbash/api kit:seed       # applies migrations to the local D1, creates @coop and its owner
pnpm -F @kitbash/api kit:token      # prints export KIT_TOKEN=kit_… (shown once)
pnpm -F @kitbash/api dev            # wrangler dev
```

## 1. Conventions

- **Auth.** Every route except `GET /health` needs `Authorization: Bearer kit_<43 base64url chars>`. Tokens are opaque;
  the server stores only `HMAC-SHA256(TOKEN_PEPPER, token)` (hex). MVP tokens are minted with `pnpm kit:token`
  (`packages/api/scripts/token.mjs`). A missing, malformed, unknown or revoked token is `401 unauthorized` with
  `WWW-Authenticate: Bearer realm="kit"`.
- **Scopes are orgs.** A scope in a path is the org slug, with or without the `@`: `/api/blocks/coop/email-code-auth`
  and `/api/blocks/@coop/email-code-auth` are the same block `@coop/email-code-auth`. MVP seeds one personal org
  `@coop` (`pnpm kit:seed`). Private blocks are visible only to members of their org; a private block of another org
  answers `404 not_found` (never 403, so existence does not leak).
- **Versions.** `:version` in a path is an exact semver (`1.3.0`) or a tag (`latest`, `stable`, any `[a-z][a-z0-9-]*`).
  Tags never resolve to a yanked version. An exact yanked version answers `410 version_yanked` unless the request has
  `?allow_yanked=1` (for `kit upgrade`/`kit diff`, which must re-render what a lock pins).
- **Bodies** are JSON (`content-type: application/json`) except `PUT /api/blobs/:sha256` (raw bytes). Limit: 8 MB per
  request body (a block is at most 2 MB of files; base64 adds a third).
- **Errors** are always the contract envelope `{"error": {"code", "message", ...}}`:

| HTTP | `code` | When |
|---|---|---|
| 400 | `invalid_params` | malformed JSON/body, bad id/version/path (`..`, absolute), manifest name ≠ URL name; `rule` names the check |
| 401 | `unauthorized` | no/bad token |
| 403 | `forbidden` | authenticated but not a member of the scope's org (for writes) |
| 404 | `not_found` | unknown scope, block, version, tag, file, or a private block of another org |
| 409 | `conflicts` | the version already exists (versions are immutable), or a project id belongs to another org |
| 410 | `version_yanked` | exact yanked version without `allow_yanked=1` |
| 413 | `invalid_params` | body or block over the size cap |
| 422 | `scan_refused` | the scanner or schema refused the block: `findings[]` (`{rule, path, severity, detail}`) |
| 422 | `signature_invalid` | the publisher signature does not verify |
| 500 | `internal` | anything else (logged server side; `REGISTRY_SIGNING_KEY` missing is reported here) |

`400 invalid_params` errors also carry `rule` in `error.findings[0].rule` when a single check failed
(e.g. `path_traversal`, `name_mismatch`, `blob_missing`, `hash_mismatch`).

## 2. Routes

### `GET /health` (no auth)
`200 {"ok": true, "service": "kit-api"}`

### `GET /api/me`
The `registry_whoami` output: `{"member": "mem_…", "orgs": ["@coop"], "scope_default": "@coop", "plan": "free"}`.

### `GET /api/registry/key`
The registry's co-signing public key, for the CLI to pin (TOFU on `kit login`):
`{"public_key": "ed25519:<base64url 32 bytes>", "key_id": "k_<16 hex>"}`.

### `PUT /api/blobs/:sha256?scope=coop`
Uploads one file's bytes ahead of a publish (useful for large blocks; small blocks can inline `content_b64`).
Body: raw bytes, `≤ 2 MB`. `:sha256` must be 64 lower-case hex and equal the SHA-256 of the body (else
`400 invalid_params`, rule `hash_mismatch`). `scope` defaults to the caller's default scope; the caller must be a
member. Blobs are stored per org under `orgs/<org_id>/blobs/<sha256>` (no cross-org dedupe).
`201 {"sha256", "bytes", "existed": false}` (or `200 … "existed": true`).

`GET /api/blobs/:sha256?scope=coop` → the bytes (`application/octet-stream`), `404` when absent;
`HEAD` the same without a body (use it to skip re-uploading).

### `POST /api/blocks/:scope/:name/versions` (publish)
Request:
```jsonc
{
  "manifest": { /* block.json, with files[].sha256/bytes and size filled (core fillFileHashes) */ },
  "files": [
    // every file of the block directory except block.json: declared files AND meta files (CHANGELOG.md, SKILL.md, docs, LICENSE)
    { "path": "variants/hono-d1/src/auth/codes.ts", "content_b64": "…" },    // block-relative path (as on disk)
    { "path": "src/auth/routes.ts", "variant": "hono-d1", "content_b64": "…" }, // or variant-relative with "variant"
    { "path": "CHANGELOG.md", "sha256": "<64 hex>" }                           // or a blob uploaded with PUT /api/blobs
  ],
  "publisher_signature": "ed25519:…",   // core signBundle(manifest, files, privateJwk); or manifest.provenance.signature
  "publisher_key": "ed25519:…",         // the member's public key; registered to the member on first use
  "visibility": "private",              // default private; "public" also refuses `warn` findings
  "tag": "stable"                        // optional extra tag (string or string[]); `latest` is managed by the server
}
```
What the server does, in order: auth and org membership (`403`); `name` = manifest `name` (`400 name_mismatch`);
version not already published (`409 conflicts`); every path safe (`400 path_traversal` etc.); blob references exist in
this org (`400 blob_missing`); total ≤ 2 MB (`413`); `validateBlock` + publish policy (`422 scan_refused` with
`findings`; a known secret format is always refused); the publisher signature verifies against `publisher_key`
(`422 signature_invalid`); the summary fits 1,500 tokens (`422 scan_refused`, rule `budget`); stores blobs under
`orgs/<org_id>/blobs/<sha256>`; co-signs (core `coSignBundle`) with `REGISTRY_SIGNING_KEY`; stores the version, its
files, a card per variant, the FTS row; moves `latest` to the highest non-prerelease version.

`201`:
```jsonc
{
  "id": "@coop/email-code-auth", "version": "1.3.0",
  "manifest_sha256": "<64 hex>",
  "registry_signature": "ed25519:…", "registry_key": "ed25519:…", "publisher_key_id": "k_…",
  "scan": { "tier": "scanned", "findings": [ /* warn/info findings, {rule, path, severity, detail} */ ] },
  "card": { /* Card of the default variant */ },
  "size": { "files": 12, "lines": 431, "summary_tokens": 980 },
  "tags": { "latest": "1.3.0" },
  "url": "/api/blocks/coop/email-code-auth/1.3.0/summary"
}
```
`scan.tier` is `scanned` when there is no `warn`/`block` finding, else `unreviewed`. This is a superset of the
`registry_publish` output (`id, version, scan, url`).

### `GET /api/search?q=&framework=&db=&ui=&runtime=&tags=&scope=&limit=`
`q` (required, 1–500 chars), stack filters (each optional), `tags` comma-separated (every tag must be one of the
block's `categories`), `scope` = `private | public | all` (visibility, default `all`), `limit` 1–20 (default 10).
FTS5 over title, description, categories, tables, routes and stack of each block's `latest` version (porter stemming,
prefix match per word, any word may match), ranked by bm25 plus a stack boost: a block whose variant matches the
requested `framework`/`db`/`ui`/`runtime` ranks above one that does not, and the card shows the best-matching variant.
Only blocks visible to the caller. `200 {"results": Card[]}` (each card under 100 tokens plus the optional one-line
`summary`; `score` in 0–1 with two decimals). No match is `{"results": []}`, never an error. Bad parameters are `400`.

### `GET /api/blocks/:scope/:name`
```jsonc
{ "id": "@coop/email-code-auth", "visibility": "private", "license": "MIT", "created_at": "…",
  "tags": { "latest": "1.3.0", "stable": "1.2.0" },
  "versions": [ { "version": "1.3.0", "status": "active", "published_at": "…", "manifest_sha256": "…", "scan_tier": "scanned" },
                { "version": "1.2.0", "status": "yanked", "published_at": "…", "yanked_at": "…", "manifest_sha256": "…", "scan_tier": "scanned" } ] }
```
Versions newest first (semver order).

### `GET /api/blocks/:scope/:name/:version/{summary|manifest|files|skill|changelog}?variant=`
The `registry_get` outputs, each with its `detail` discriminator:
- `summary` → `Summary` (≤ 1,500 tokens; author prose only inside `untrusted_author_text`). `variant` defaults to the
  block's default variant; an unknown variant is `404`.
- `manifest` → `{"detail": "manifest", "id", "version", "manifest"}`: the stored `block.json`, with
  `provenance.signature` and `provenance.registry_signature` filled in.
- `files` → `{"detail": "files", "id", "version", "variant", "files": FileEntry[]}`: the variant's declared files
  (`path` as in `files[]`, `target`, `role`, `variant?`, `merge?`, `sha256`, `bytes`), no content. A `doc` file
  without a `target` gets `.kit/blocks/<name>/<path>`.
- `skill` → `{"detail": "skill", "id", "version", "untrusted_author_text": {"notice", "skill_md"}}` (`404` if none).
- `changelog` → `{"detail": "changelog", "id", "version", "untrusted_author_text": {"notice", "changelog"}}`.

### `GET /api/blocks/:scope/:name/:version/file?path=&variant=`
The `registry_read_file` output: `{"content", "encoding": "utf8"|"base64", "sha256", "bytes"}`. `path` is a
`files[].path` of the variant (default variant when omitted), or a block-relative path (`SKILL.md`,
`CHANGELOG.md`, `variants/hono-d1/src/x.ts`).

### `GET /api/blocks/:scope/:name/:version/bundle?variant=`
Everything `kit install` needs to verify and plan, in one response (≤ 2 MB of files):
```jsonc
{
  "id": "@coop/email-code-auth", "version": "1.3.0", "variant": "hono-d1",
  "manifest": { /* as signed, plus provenance.signature/registry_signature */ },
  "manifest_sha256": "…",
  "publisher_signature": "ed25519:…", "publisher_key": "ed25519:…",
  "registry_signature": "ed25519:…", "registry_key": "ed25519:…",
  "changelog": "…",  // CHANGELOG.md text when shipped (also present in files)
  "files": [ { "path": "variants/hono-d1/src/auth/codes.ts", "sha256": "…", "bytes": 2210, "content_b64": "…" } ]
}
```
`files` holds **every** file of the version (all variants and the meta files), keyed by block-relative path, because
the signatures cover all of them: the CLI rebuilds `{manifest, files}` and calls core
`verifyBundle(manifest, files, pinnedRegistryKey, {publisherPublicKey: publisher_key})`. `variant` only selects the
`variant` field (default: the block's default variant; unknown → `404`).

### `POST /api/blocks/:scope/:name/tags`
`{"tag": "stable", "version": "1.2.0"}` sets a tag; `{"tag": "stable", "version": null}` removes it. `latest` may be
set by hand too (it moves again on the next publish). The version must exist and not be yanked. Org members only.
`200 {"id", "tags": {…}}`.

### `POST /api/blocks/:scope/:name/:version/yank`
`{"reason"?: "…"}`. Marks the version yanked (hidden from search and tags, never deleted); tags pointing at it are
removed and `latest` moves to the highest remaining non-prerelease version. Idempotent.
`200 {"id", "version", "status": "yanked", "yanked_at", "tags": {…}}`.

### `POST /api/projects/:id/heartbeat`
`:id` is the `.kit/project.json` `project_id` (`prj_[A-Za-z0-9_-]{4,64}`). Body:
```jsonc
{ "scope": "coop",                     // optional; default the caller's default scope
  "stack": { "framework": "hono", "db": "d1" },   // optional
  "blocks": [ { "block": "@coop/email-code-auth", "version": "1.3.0", "variant": "hono-d1",
                "verified_at": "2026-10-20T10:40:00Z", "passed": true } ] }   // the lock's block list only
```
Upserts the project (first heartbeat binds it to the org; a project of another org is `409`) and one `installs` row
per listed block; blocks no longer listed get `removed_at`. Unknown or invisible blocks are skipped and reported.
`200 {"project_id", "installs": 1, "removed": 0, "skipped": []}`.

### `POST /api/proposals`
```jsonc
{ "block": "@coop/email-code-auth@1.3.0",   // pinned ref (or "block" + "version")
  "title": "Add resend cooldown", "rationale": "Codes were re-sent on double click",
  "patch": "--- a/src/auth/codes.ts\n+++ b/src/auth/codes.ts\n@@ …",   // unified diff, params un-rendered, ≤ 1 MB
  "stack": { "framework": "hono" }, "redactions": ["…"] }               // optional
```
The patch is scanned for known secret formats (`422 scan_refused`), stored in R2 under
`orgs/<org_id>/proposals/<id>.patch`, and recorded with status `draft`. `201 {"proposal_id": "prop_…", "status":
"draft", "hunks": 3, "redactions": []}` (the `registry_propose` output plus `status`).

## 3. `/mcp` (remote MCP, Streamable HTTP, stateless)

Same bearer as REST. `tools/list` returns the 11 `REGISTRY_TOOLS` of core with their static descriptions, input
schemas and annotations (`readOnlyHint: true` on search, get, read_file, whoami, diff). Remote tools:
`registry_search`, `registry_get`, `registry_read_file`, `registry_whoami` (same payloads as the REST routes above,
returned as JSON text content and `structuredContent`). `registry_install|verify|upgrade|diff|harvest|publish|propose`
answer an `isError` result whose JSON is `{"error": {"code": "needs_local", "message", "command": "kit …"}}`.

## 4. Not in the MVP (see the WP-02 commit)

Accounts/sign-in (email codes, OAuth: WP-10), public scopes beyond the visibility flag and `/r/` (WP-11), the scan
queue consumer (the `SCAN` producer binding exists; publish scans synchronously) and server-side scanner extensions
(WP-12), sandbox runs, Vectorize, rate limits, usage rollups, payments.
