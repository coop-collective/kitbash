# vinext build guardrails

A portable check for an already migrated **Cloudflare App Router** project using `wrangler.jsonc`. It reads package/config/artifact data without importing application code. It does not scaffold or migrate a site.

```sh
pnpm install
pnpm test
# Build your app first, then choose a measured baseline budget:
node scripts/check-vinext.mjs /path/to/app 500000
```

The number is the total gzip bytes of all client JS chunks, including lazy chunks. It is an explicit regression budget, not first-page transfer size or a universal performance threshold. Record baseline route timings and browser transfer sizes separately. The check rejects empty builds, escaping/symlinked artifacts, floating framework versions, mismatched React packages, `next build`, stale OpenNext adapters, SPA asset fallback, and missing observability. Dependency pins are project policy; update the tested combination together with its lockfile.

## Checks that require a running app

These are acceptance cases for your browser suite, beyond what static checks prove:

1. SSR HTML appears, hydration and client navigation work, and direct navigation to a missing route returns the expected 404 rather than a SPA shell.
2. Exercise sign-in, protected navigation, a Server Action and logout with two separate browser contexts. Cookies or private data must never cross users through response/data caches.
3. Test public cache hits and invalidation independently of private pages. Use the adapter supported by the pinned vinext version. Do not enable blanket caching merely because a public page benefits.
4. Test service bindings in workerd and production build output. A Node dev server passing does not prove Workers bindings exist.
5. Run asset requests under the production base path and test RSC navigation through middleware. Check response status, content type and cache headers, not screenshots alone.

For the current Workers integration, the RSC environment is wired through the Cloudflare Vite plugin and SSR as its child; bindings belong on the server side via `cloudflare:workers`. Select `CLOUDFLARE_ENV` at **build time** and deploy that generated artifact. A later deploy flag does not retarget an already flattened configuration. Keep compatibility dates in source; regenerate binding types before checking code.

Consult [vinext's compatibility status](https://github.com/cloudflare/vinext#project-status), [caching guide](https://github.com/cloudflare/vinext/blob/main/docs/caching.mdx), and [Vite environment handling](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/) for the installed release. Avoid assuming full Cache Components/PPR parity. Prefer measured lazy loading and narrower client boundaries; preserve authorization/middleware before optimizing response caching.

This guard intentionally supports a narrow configuration profile, not every vinext target. Static success does not prove auth, caching correctness, generated deployment bindings, browser hydration, or improved performance. The example versions in tests are parser fixtures, not a newly validated framework compatibility matrix.

This recipe is a root pnpm workspace member. For a standalone copy, run `pnpm install` once and commit its generated lockfile; use `pnpm install --frozen-lockfile` in that project’s CI.
