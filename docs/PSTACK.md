# Kitbash with pstack

Kitbash owns runtime presets, feature blocks, stack-specific review guidance, and project setup. Pstack is a separate
optional dependency that can own the engineering workflow. One task owner selects the necessary capabilities;
there is no competing Kitbash orchestration loop or required pstack extension API.

The examples below were checked against [pstack 0.15.26](https://github.com/cursor/plugins/tree/0b8e952052d482ee6de06deebf14d590d77b1b34/pstack).
Upstream exposes task playbooks and a generator for project-local verification skills. Its full plugin and
Ideator's vendored subset differ; an installed adapter's own execution and approval rules remain applicable.

## Starting a project

First use [Kitbash bootstrap](BOOTSTRAP.md), selecting the preset and only the blocks the app needs:

```text
Use $kitbash-bootstrap to create ../scoreboard with vinext,
public-edge-cache and tiered-result-cache. Keep the Git repository local.
```

The resulting check commands, block adaptation list, source snapshots, and `.kit/verification/README.md` give the
implementation agent concrete entrypoints. They do not establish that an application feature already works.

If pstack is already installed, invoke its task entrypoint with a bounded implementation request. In Cursor this
is `/poteto-mode`; the upstream Claude plugin exposes `/pstack:poteto-mode`. For example:

```text
/poteto-mode Build the global leaderboard in this generated project.
Use the installed Kitbash cache blocks and resolve their pending adaptation items.
Choose page rendering and cache freshness from the product requirements.
Verify the visible leaderboard, refresh behavior, and source-query counts.
```

Kitbash also works without pstack. To install pstack separately, follow its [upstream installation instructions](https://github.com/cursor/plugins/blob/0b8e952052d482ee6de06deebf14d590d77b1b34/pstack/README.md#install)
for the chosen harness; bootstrapping an app does not change global agent settings.

## Verification during work

When the application lacks a runnable journey, explicitly invoke pstack's `create-verification-skill` with the real
project. Its [generator](https://github.com/cursor/plugins/blob/0b8e952052d482ee6de06deebf14d590d77b1b34/pstack/skills/create-verification-skill/SKILL.md)
builds a project-local launch/drive/evidence procedure and feature map. The verifier should use the generated
project's existing scripts, then extend them for actual behavior rather than recording a second source of truth.

For a Worker-backed UI, a useful proof combines the actual browser journey, assertions on the resulting state,
and correlated backend observations. A leaderboard recording can show correct rows and pagination. Request counts
or traces establish whether repeated visits avoid recomputing the leaderboard. Freshness checks establish when
updates appear. A video alone cannot prove backend caching or authorization.

Keep recordings, screenshots, test results, and log/trace excerpts as run artifacts associated with the commit and
environment. Preserve them after cleanup, and redact credentials and unrelated customer data. The generated
bootstrap does not automatically capture videos, configure production observability access, or supply all those
application-specific assertions: those are implementation work for the verifier.

## Post-merge maintenance

Maintenance remains explicitly invoked. A scheduler or operator chooses a task and relevant skill; do not preload
all of `.kit/skills/` into every feature agent or put blanket refactoring rules in AGENTS.md.

Example runner prompt, with budget and process limits enforced by the runner:

```text
Review the merged leaderboard change at this checkout's commit.
Read .kit/skills/page-delivery/SKILL.md explicitly.
Determine whether observed traffic, recomputation, or freshness violates the page's requirements.
Use existing telemetry and project checks; a healthy implementation should produce no change.
If there is an evidenced problem, make one focused improvement and verify the same journey.
Report measurements and remaining uncertainty; do not deploy or enable another automation.
```

TypeScript and Rust reviews similarly use `.kit/skills/clean-code-typescript/SKILL.md` and
`.kit/skills/clean-code-rust/SKILL.md` when selected. They assess demonstrated debugging or maintenance cost, not
function-length ceilings. Pstack's relevant bug-fix or performance playbook can handle an accepted finding.

Skill metadata that disables automatic invocation must stay intact. A platform event alone does not invoke a
skill: the configured harness must explicitly load the selected instruction file using its supported mechanism.
GitHub, Cursor, and Gitstalk adapters can share that prompt and project commands while retaining their own trigger,
budget, credential, and artifact handling. Creating a project does not enable those automations.
