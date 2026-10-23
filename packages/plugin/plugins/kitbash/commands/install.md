---
description: Install a Kitbash block into this project, dry run first, then adapt and verify.
argument-hint: "</absolute/path/to/kitbash/blocks/name>"
---

Load the `kitbash-use` skill and follow it from step 3 for the block `$ARGUMENTS`. Prefer an absolute local catalog path. Registry IDs require a separately configured legacy registry and are only for an explicitly requested remote workflow.

1. `registry_get` the block (summary) and decide whether it fits; stop and say why if the skill's "when not to use" applies.
2. `registry_install` with `dry_run: true` (the default) and `project_root` set to this project. Read the plan: `conflicts`, every `config-patch` write, `dependencies_to_add`, `verify`, and the diff at `diff_preview_path` (at least its config and conflict hunks). Resolve conflicts with a param (for example `tablePrefix`), never with `on_conflict: "overwrite"` unless the user agreed.
3. Summarize the reviewed plan and apply within the user's requested installation scope: `registry_install` with `dry_run: false` and its `plan_id`. A request only to preview does not authorize applying the plan.
4. Work the `adapt` checklist, run the package manager's install if `dependencies_to_add` is not empty, then `registry_verify`. Report the result.
