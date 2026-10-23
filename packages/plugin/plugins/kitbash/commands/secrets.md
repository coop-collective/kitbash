---
description: Generate registered secrets or provision CI and Worker access through a configured broker, returning metadata only.
argument-hint: "<operation> <project-alias> <target> [secret-name]"
---

Load the `kitbash-secrets` skill and use `kitbash_secrets` for the operation described by `$ARGUMENTS`.
Use the operator's registered project alias and target. Do not accept or request secret values in arguments or chat.
If the broker is unavailable or denies access, report that boundary rather than using local vault credentials.
