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
2. Installs the block's `registryDependencies` first (resolved by directory name under `blocks/`), then the block,
   with `kit install <dir> --apply --param k=v ...`; regenerates `worker-configuration.d.ts` (`wrangler types`).
3. Asserts the lock records every block (and its params), runs `kit verify @local/<name>` for each and asserts every
   command passed and `verify.passed` is recorded.
4. Asserts a second install of the last block is refused with conflicts.

## Declaring cases: `cases.json`

- Every `blocks/<name>/block.json` runs once with default params, with no entry needed.
- `blocks.<name>.cases`: extra param sets, `{ "name": "prefixed", "params": { "tokenPrefix": "mc_", "tablePrefix": "app_" } }`;
  optional `dependencyParams: { "<dep>": { ... } }` for the dependencies' params.
- `blocks.<name>.path`: a block directory outside `blocks/` (repo-relative); used for core's fixture block.
- `chains`: several blocks installed in sequence into one project, `{ "name": "auth-stack", "steps": [ { "block": "crypto-utils" }, { "block": "email-code-auth", "params": { "tokenPrefix": "kit_" } } ] }`;
  every step is verified at the end.
