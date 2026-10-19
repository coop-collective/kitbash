# Bun TypeScript bootstrap

Current deliverable: the **bun variant** of [cloudflare-container](../../blocks/cloudflare-container/docs/README.md). The standalone starter described in this original review was replaced by an installable Wrangler/Cloudflare Containers block; its payload is mapped into root pnpm. Historical evidence and initial checks follow.

Reviewed 2026-10-19. Deliverable: `templates/bun-typescript` (standalone starter; not an installable block).

## Workspace evidence

`platform` at `8f8ed9c2a44507490912f8631806664c724be767`, `.planning/orchestrate/scripts/package.json` and `tsconfig.json`, separates Bun execution/tests from `tsc --noEmit`, declares Bun globals explicitly, and uses bundler module resolution. Its app-specific Cursor/Slack dependencies and mutating `check` command are not portable. `beanstalk` at `63dae2ccf2cf76d09384f525042c21f163f383fc`, `tsconfig.base.json`, adds unchecked-index and exact-optional checks. This starter is original code informed by those configurations; no app business logic is copied.

## Boundary and choices

A project bootstrap owns package scripts and a lockfile. The current block model intentionally does not install or execute arbitrary bootstrap commands, so this lives beside the existing Hono template. Bun is pinned to 1.4.3; TypeScript to 7.0.2. Runtime types are pinned separately. Explicit checking works independently of Bun's newer built-in check mode.

Use a pure Fetch handler with process setup in a separate entrypoint, ephemeral listener tests, full numeric configuration validation, and clean shutdown. Do not infer type safety from successful transpilation, reuse a developer server during integration tests, commit `.env`, or treat Bun tests as evidence of Workers binding behavior.

## Primary references

- [Bun TypeScript runtime](https://bun.sh/docs/runtime/typescript)
- [Bun test runner](https://bun.sh/docs/test)
- [Bun HTTP server](https://bun.sh/docs/api/http)
- [TypeScript 7 release](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)

## Verification

Run `bun install --frozen-lockfile`, `bun run check`, and `bun run build` from a clean copy. The tests cover HTTP success, no-store, HEAD, unsupported methods, unknown routes, and invalid ports. No production performance claim or remote deployment is implied.
