---
description: Find a feature in Kitbash's local block catalog and explain its compatibility and dependencies.
argument-hint: "<what you need>"
---

Load the `kitbash-use` skill, then search for: `$ARGUMENTS`.

1. Read the project's stack, then use `kitbash_bootstrap` with `list: true` and a compatible preset for runtime discovery. Inspect the full local catalog's `block.json` files when needed: `<Kitbash checkout>/blocks/` or `<installed plugin>/runtime/catalog/blocks/`.
2. Show the relevant names, variants, capabilities, dependencies, and absolute local block paths. The catalog ships with the toolkit; do not call `registry_search` or require sign-in unless the user explicitly requested a separate legacy registry.
3. For the best matches, call `registry_get` with the local block directory and explain what each adds and what remains to wire. A discovery-only request does not install files. If installation was already requested, continue with `/kit:install` within that scope.
