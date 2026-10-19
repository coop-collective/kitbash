# Stopped lifecycle pilot — 2026-10-19

This pilot was stopped after an inherited baseline UI race affected the first scratch attempt. It is not a completed scratch-versus-reuse comparison and provides no reuse savings estimate.

The initial scratch attempt passed 10/11 integration groups, including the feature checks, but only 9/10 nested legacy groups. Its homepage script matched the supplied baseline; the only initial homepage change was a teams navigation link. The repair passed 12/12 groups (including the added prior-checkpoint check) and the restart check. These original scores are preserved.

Two completed model calls have CLI-reported list-price estimates totaling **$0.7133287**. A third, reuse call started before the runner stopped and has **unknown cost** because no final billing event was recorded. The **$1.50 reserve** in `pilot-audit.json` is conservative budget accounting for that interrupted call, not an observed charge. Its partial token snapshots are not complete usage totals. This pilot also incurred unmetered preparation and orchestration work.

`evidence.json` preserves the frozen protocol, original result statuses, checks, and content-addressed source manifests. Its interrupted stage remains `running` as it appeared in the stopped source ledger; `pilot-audit.json` records the observed stop state separately. `baseline-snapshot.json` and the SHA-256-named `blobs/` retain the original baseline and measured app outputs, including failures. Per-attempt summaries and metadata-only MCP audits omit raw conversations, local databases, credentials, and ephemeral session cookies. The interrupted call had no completed source snapshot and is not represented as a successful app.

See [the lifecycle harness](../../lifecycle/README.md) for reproduction commands. These are experimental outputs, not public starter templates.
