# Preserved pilot, not a controlled comparison

The primary pair ran concurrently on a shared host with Claude Sonnet5.5 and a $5 CLI cap each. Scratch: 135.280s, list-price estimate $0.280862, 10/10 original grouped checks. Library:178.078s, $0.4443883, 9/10. Both passed their typecheck/test/build/migrations and the browser journey. Library made no checkout/discard calls, so it did not test the proposed selective-file workflow.

The starter needed a compatibility-date/type repair. Both agents used broad cleanup commands and a shared `/tmp/dev.log`; interference is possible, and an exit144 in one library command does not prove its cause. These observations do not support a clean causal comparison. The corrected v2 protocol uses preflighted hosts, sequential arms, no Bash, fixed commands, and owned process groups.

The original DELETE assertion expected404 for another owner's deletion, while the task wording also allowed an interpretation of idempotent204. Library returned204. The separate saved post-run diagnostic verifies the actual isolation property: the real owner's bytes remain available, and only the owner's delete removes them. Historical scores remain unchanged.

`harness/` preserves the exact primary source, verified against `harness-snapshot.json`. It is historical evidence, not the current runnable entrypoint. App source snapshots omit credentials, generated artifacts, dependencies, and local databases. Use the package's copy command to restore public local fixtures into a new project.

Two later reference preparations were interrupted: one after an MCP startup syntax error, another to protect concurrent shared-host verification before scoped tooling was ready. Neither has a final billing event. Their costs and complete token totals are unknown; partial message snapshots are not aggregate totals. They are not counted as completed reference arms or silently assigned zero cost. Raw logs remain in the original local run directory; committed artifacts contain only sanitized evidence.
