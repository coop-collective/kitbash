# __PROJECT_NAME__

Read README.md for the runtime and verification commands. Run `pnpm check` and the relevant journey before reporting a change as verified. `pnpm smoke` starts the built app, checks HTTP behavior, and stops its own process.

For real secrets, use the Kitbash plugin's `kitbash_secrets` setup operation with a registered broker alias and target. The broker generates values and registers access outside this workspace. Do not materialize secrets locally, read them into tool output, or run arbitrary commands with production credentials. Use non-sensitive fixtures for local tests; see `docs/secrets.md`. The broker request file is metadata proposed to the operator, not permission to provision its destinations.

Kitbash block installation records adaptation status in `.kit/lock.json` and reference guides under `.kit/blocks/`. Complete required wiring and verify before claiming a feature works. Maintenance skills are explicit post-merge tools; do not load them automatically during feature work. Pstack may drive the task workflow while project verification and Kitbash supply stack-specific checks.

Migrations: name every new migration with a UTC timestamp, `migrations/YYYYMMDDHHMMSS_name.sql` (e.g. `date -u +%Y%m%d%H%M%S`). Never pick or increment a number by hand: parallel branches would collide on the same number. Never edit or rename a migration that has been merged; add a new one.
