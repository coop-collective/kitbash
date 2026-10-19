# Lifecycle experiment evidence

`evidence.json` preserves the frozen protocol, every measured attempt, original checks and content-addressed source manifests. `blobs/` contains the unique source bytes named by SHA-256. These are experimental app outputs, including failures; they are not production-ready examples. Raw model conversations, local databases, credentials and ephemeral fixture-session cookies are omitted. CLI costs are list-price estimates, not invoice charges.

See `../../lifecycle/README.md` for protocol and reproduction commands.

The [report](../../../../docs/research/lifecycle-reuse.md) compares all three integration-plus-maintenance pairs. Supporting records:

- `billing-audit.json`: independent raw-telemetry, restriction, cost/token, source-hash and export audit.
- `source-audit.json`: all twelve immutable stage reviews, including two findings missed by automated acceptance.
- `reproduction.json`: independent fresh-copy verification of pair 1 reuse maintenance.
- `diagnostics/`: post-run pinned-source mock reproductions; no revised automated scores or measured-app repairs.

All twelve original automated stages passed without repairs. Source review found a joining-socket delivery race in pair 2 scratch maintenance and an expired-recipient broadcast in pair 3 reuse integration; the latter is fixed by its later maintenance snapshot. These qualifiers remain part of the result.
