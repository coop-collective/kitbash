---
description: Create a Worker, vinext or local Rust server project with selected blocks and optional Git hosting.
argument-hint: "<directory> --preset worker|vinext|rust-server [--blocks a,b]"
---

Load the `kitbash-bootstrap` skill and use `kitbash_bootstrap` for the new project described by `$ARGUMENTS`.
List presets and compatible blocks when needed. Preserve the requested Git host, hostname, and selected blocks.
Local generation is the default; create a remote only when the user requested that named repository.
After generation, resolve pending adaptation items and run the project's checks before claiming it is ready.
