# test-e2e (WP-05 G3)

`install.test.mjs` (node --test) installs real block directories into a copy of `templates/hono-d1` with the kit CLI
(local path, no server), applies, runs each block's `verify.commands` through `kit verify`, and asserts they pass.

```
pnpm install                                        # once, at the repo root (the CLI runs from source)
node --test test-e2e/install.test.mjs               # all cases
KIT_E2E_ONLY=crypto-utils,my-chain node --test test-e2e/install.test.mjs   # by block or chain name
```

`KIT_E2E_ONLINE=0` forbids the online fallback when installing the template's dependencies. Tests skip (with the
reason) when dependencies cannot be installed.

What each case does:

1. Copies the cached, installed template to a fresh temp dir. The cache (`$TMPDIR/kitbash-e2e-template-<hash>`) is built
   once per machine: `pnpm install --ignore-workspace --offline`, falling back to online. The install exit code is not
   trusted (ignored build scripts make pnpm exit non-zero); the template's own `pnpm test` exit code is.
2. `kit install <dir> --apply --blocks-dir blocks/ --param k=v ... --param <dependency>.k=v ...`: kit installs the
   block's `registryDependencies` first itself (by directory name under `blocks/`). When a block added npm dependencies
   (`package.json` changed), runs `pnpm install` (offline first) and asserts they are linked; then regenerates
   `worker-configuration.d.ts` (`wrangler types`).
3. Asserts the lock records every block (and its and its dependencies' params) and that no `e2e.json` was installed,
   runs `kit verify` for every block in the lock and asserts every command passed and `verify.passed` is recorded.
4. Asserts a second install of the last block is refused with conflicts.

A `conflicts` case first writes its `setup` files into the project, expects the dry run (`--json`) to exit 1 with the
listed conflicts and no lock, then installs with `resolve.params` / `resolve.on_conflict` and runs steps 2-4.

## Declaring cases: `blocks/<name>/e2e.json` and `cases.json`

- Every `blocks/<name>/block.json` runs once with default params, with no entry needed.
- A block's own cases live in `blocks/<name>/e2e.json` (core allows the file undeclared; it is never installed):
  `cases` (`{ "name", "params", "dependencyParams"?: { "<dep>": { ... } } }`), `conflicts`
  (`{ "name", "setup": { "<path>": "<content>" }, "params"?, "expect": [{ "kind", "name", "resolve_with_param"? }],
  "resolve": { "params"?, "on_conflict"? } }`) and `chains`.
- `test-e2e/cases.json` has the same keys under `blocks.<name>` (merged by case name; the block's file wins), entries
  with their own `path` (core's fixture block), and cross-block `chains`: several blocks installed in sequence into one
  project, `{ "name": "mvp-auth-stack", "steps": [ { "block": "email-code-auth" }, { "block": "cli-oauth-login", "params": { ... } } ] }`;
  every block in the lock is verified at the end.
