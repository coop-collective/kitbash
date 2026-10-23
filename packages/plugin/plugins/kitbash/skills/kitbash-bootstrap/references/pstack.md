# Compose with pstack

Pstack supplies an engineering playbook. Kitbash supplies the project scaffold, reusable feature implementations,
and opt-in stack reviews. Select the relevant files for the current task; do not import every skill into AGENTS.md.

Use the pstack plugin already installed in the current harness. If it is absent, Kitbash still works; do not install
or modify the agent's global settings as a side effect of bootstrapping an application.

- For a new feature, use pstack's feature playbook, then `kitbash-use` for a matching block. Resolve the block's
  adapt checklist and run its verification before treating it as implemented.
- For an app with no runnable verification journey, explicitly invoke pstack's `create-verification-skill` to
  generate a project-local verifier from the real app. Existing generated checks and `.kit/verification/README.md`
  are starting points, not evidence that app-specific user journeys already pass.
- For a bug, reproduce it first. Browser actions or HTTP requests show the symptom; correlated Worker logs, traces,
  and persisted state show why it happened. Attach recordings only where they demonstrate the actual behavior.
- For a post-merge review, explicitly load only the relevant `.kit/skills/<name>/SKILL.md`. A finding needs a
  concrete failure, measured cost, or demonstrated difficulty tracing the code. Large files alone are not findings.

Keep one task owner and one verification outcome. Pstack should call the project's existing checks; Kitbash should
not start a second competing orchestration loop. A recording demonstrates visible behavior, while assertions and
backend observations establish correctness, caching, freshness, and side effects.

The integration is explicit file/skill composition, not a pstack extension API. The upstream plugin and the
Ideator-vendored subset have different capabilities and policies: retain the active harness's own boundaries.
Pinned upstream reference: [pstack 0.15.26](https://github.com/cursor/plugins/tree/0b8e952052d482ee6de06deebf14d590d77b1b34/pstack).
