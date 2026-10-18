---
description: Turn a feature already built in this project into a Kitbash block draft.
argument-hint: "<feature name> <paths…>"
---

Load the `kitbash-harvest` skill and harvest: `$ARGUMENTS`.

1. Agree the boundary with the user: which paths are the feature, and the block name (lowercase, hyphens).
2. Call `registry_harvest` with `project_root`, `paths`, `name`, `description` and, if you already know them, `params_hints` (literal to param name).
3. Work through the `todo` list in `.kit/drafts/<name>/`, then check the draft with `registry_get` on the draft directory (it runs the client scanner and refuses a block with blocking findings) and dry-run install it into a scratch copy of the template, as the skill says, before anything is published. Never publish in this command: that is `kitbash-publish`, and only when the user asks.
