# test-e2e (planned, WP-05 G3)

Not built yet: it depends on `@kitbash/core` and the CLI from WP-01/WP-03.

Planned `install.test.mjs` (node --test), parameterized over `blocks/*`:

1. Copy `templates/hono-d1` (without `node_modules`) to a fresh temp dir.
2. `pnpm install --ignore-workspace` there (the template carries its own `pnpm-workspace.yaml` so it is its own root).
3. Install the block from its local directory with `@kitbash/core` and the CLI (no server), once with defaults and
   once with the block's alternate params (for example `tokenPrefix=mc_ tablePrefix=app_`).
4. Run the block's `verify.commands` (normally `pnpm test`, `pnpm typecheck`) in the temp dir and assert they pass.
5. Assert the lock file records the block, and that a second install reports the expected conflicts.

Notes for the harness: installing dependencies is the slow step, so cache one installed template and copy its
`node_modules` (or symlink) into each temp project. Tests run in workerd and need no network or Cloudflare account.
