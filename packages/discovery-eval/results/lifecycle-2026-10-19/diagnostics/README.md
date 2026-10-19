# Post-run source diagnostics

These checks were added after all timed calls finished. They demonstrate the two source-review findings without modifying measured apps, feeding extra repair feedback, or changing frozen acceptance scores. They load exact SHA-256-pinned TypeScript from the published blobs and mock the class's clock, D1, SQL and sockets. **They are not workerd or hosted Cloudflare reproductions.** Node 25.8.1 was used; `stripTypeScriptTypes` emits an experimental-API warning.

From the repository root, with no paid model calls or network required:

```sh
node packages/discovery-eval/results/lifecycle-2026-10-19/diagnostics/fanout-race.mjs
node packages/discovery-eval/results/lifecycle-2026-10-19/diagnostics/expired-fanout.mjs
```

Both commands exit successfully only if the pinned defect reproduces. Their recorded outputs are the adjacent `*-result.json` files.

- `fanout-race.mjs`: pair 2 scratch maintenance accepts a new socket while D1 authorization is deferred. Its snapshot precedes the commit, but the later broadcast uses the earlier recipient array and misses it.
- `expired-fanout.mjs`: pair 3 reuse integration delivers a message to an expired recipient while the sender remains valid. That phase's fanout omits recipient expiry checks. The later maintenance snapshot independently fixes the issue.
