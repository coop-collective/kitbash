# vinext optimization and bug avoidance

Reviewed 2026-10-19. Deliverable: tested `recipes/vinext-guardrails` artifact/config checker plus runtime acceptance matrix.

## Workspace evidence

| Source | Pattern worth retaining | Avoid carrying forward |
|---|---|---|
| `beanstalk` `63dae2ccf2cf76d09384f525042c21f163f383fc`, `packages/web/{vite.config.ts,tsconfig.json,wrangler.jsonc}` | RSC workerd environment with SSR child, generated binding types, service RPC, no SPA fallback | App-specific remote AI bindings and secrets |
| `transchat` `76469273ce247b9fc548c3d6c7662c3346dcf066`, `vite.config.ts`, `wrangler.jsonc`, `package.json` | Lower client JS/CSS targets for measured old-browser support, explicit cache adapter | Floating TypeScript, unexamined beta adapter/framework combinations, compatibility flags copied without their original reason |
| `enginebox` `19f834a344d91bb1e6aa1cc46841ad42eea830ee`, dashboard `package.json`, `tsconfig.json`, `vite.config.ts` | Exact framework pins, loopback strict-port development, incremental checks | Node-only verification as evidence for Workers, residual `.next` generated type paths without checking their generator |
| `mailcheap` `6fd333e2b9a66d65785958de40061afa72fa6059`, `scripts/check-cloudflare.mjs`, `wrangler.jsonc` | Read source as data for architecture checks and keep production builds on Vite | Product-specific provider bans and fragile lockfile string parsing as a generic architecture policy |

The recipe is original implementation, with no source app logic or credentials copied. Unlike a broad scanner, it has an explicit App Router/JSONC profile and only enforces checks it can mechanically establish. Configuration is parsed as JSONC; application code is never evaluated. Bundle gzip totals expose regressions without claiming route-level performance.

## Version-sensitive guidance

[vinext upstream](https://github.com/cloudflare/vinext) still documents compatibility gaps. [Cache adapter configuration](https://github.com/cloudflare/vinext/blob/main/docs/caching.mdx) and [Cloudflare Vite environment selection](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/) must be checked against pinned dependencies. Do not transplant older `cdnAdapter` wiring into a newer release without its build/runtime tests. A framework compile is not an auth or cache-isolation test.

## Validation

`npm ci` and `npm test` exercise valid source configs, actionable mismatch errors, JSONC parse failure, empty artifacts, gzip budget failure, symlink/path escapes and nonzero CLI status. This contribution does not claim to build/deploy the source apps or test their authenticated journeys.
