# Existing-app integration and maintenance experiment

This opt-in follow-up tests whether feature-source reuse helps on a harder task than the earlier kitchen-sink benchmark. It adds shared review rooms to the **same existing app** for both treatments, then adds read-only membership, live authorization changes and durable retry deduplication. The baseline already uses shared framework dependencies and includes sessions, profiles, personal files and reports.

The treatment is access to the existing catalog. Reuse agents can search, inspect, copy/adapt or install suitable blocks and can skip unsuitable ones. Scratch agents receive the existing application and ordinary dependencies. No ritual requires downloading every file or using an unsuitable block. Catalog access continues during maintenance.

## Fixed protocol

- Three pairs, one task, exact model `claude-sonnet-5-5`, explicit high effort. Integration order is scratch/reuse, reuse/scratch, scratch/reuse; maintenance reverses each pair's order. Every call is sequential and starts a fresh session. The odd number of pairs does not perfectly balance order within a phase.
- Each agent works in a fresh copy of the same baseline with seeded personal data. Maintenance starts from that arm's own implementation and persisted data, including failures. The follow-up request is withheld during integration.
- Integration has a $1.50 CLI limit and at most one $0.75 repair. Maintenance has a $1 limit and at most one $0.75 repair. The limits total $24 across all pairs; actual CLI list-price estimates and any provider overshoot are reported. They are not invoice charges.
- Independent checks run after each attempt. A repair receives the same structured failed-check feedback format. Initial failures remain visible, and every attempt counts. Missing final billing halts further paid calls; unknown costs are never recorded as zero.
- Source, tasks, acceptance, harness, catalog, lockfile, runtime versions and schedule are frozen before model execution and rechecked before every attempt. Acceptance code remains outside agent projects. File tools run in Claude's restricted mode; project commands have fixed arguments and own their process groups. This is cooperative local code execution, not a hostile-code sandbox.
- Existing-app regressions, old data, append-only migrations, team boundaries, actual upload limits, browser behavior, concurrent WebSocket messages, restart persistence and follow-up permissions/retries are tested. Local restart checks do not prove production hibernation timing or billing savings. Independent source review checks architecture that black-box tests cannot establish.

This is a descriptive repeated comparison of **one deliberately relevant feature**, not a representative sample of all software work. It also changes the earlier benchmark's forced-reference workflow and pins effort, so differences between the two studies cannot be attributed solely to task size. Preparation, harness construction and coordinating-agent costs are outside the measured task-agent totals and must not be described as zero or as end-to-end project ROI.

## Commands

Normal package tests never invoke a paid model:

```sh
pnpm --filter @kitbash/discovery-eval test
node packages/discovery-eval/lifecycle/run.mjs --prepare-only
```

The preparation command prints its new temporary directory. It copies/preflights six baseline apps and seeds their local D1/R2 data without calling a model. Once frozen inputs are reviewed, execute the paid experiment explicitly:

```sh
node packages/discovery-eval/lifecycle/run.mjs --run-paid --resume /absolute/prepared/directory
```

An authenticated Claude CLI and installed Playwright Chromium are required. Apps and raw logs remain in the temporary run directory. Public evidence uses content-addressed source snapshots, billing summaries and sanitized check outcomes; it omits raw conversations, ephemeral session cookies, local databases and credentials. Failed app outputs are evidence, not production-ready examples.
