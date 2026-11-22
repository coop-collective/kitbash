---
name: deterministic-tests
description: Tests must be deterministic. Never assert on the wall clock, never sleep to wait, give each test a private temp directory and port 0, share no global or environment state, assert no order the code does not guarantee, seed randomness, and never retry until green or weaken an assertion. Use when writing, reviewing or changing any test, or when a test fails intermittently, passes only alone, or fails only in CI, in parallel or on another machine. Checklist and fix recipes for clocks, waiting, temp directories, ports, global state, ordering, randomness and lock races, plus the repeated-run check a new test must pass before review.
---

# Deterministic tests

A test is deterministic when the same code gives the same result on every run, on any machine, in parallel with other tests. A test that sometimes fails teaches everyone to ignore red and hides real regressions. A flaky test is a bug in the test: fix its cause, never its symptom.

## Checklist for every new or changed test

- **Time.** No assertion reads the wall clock (`Date.now()`, `new Date()`, `performance.now()`, `SystemTime::now()`, `Instant::now()`). The code under test takes a clock, or the test uses fake timers.
- **Waiting.** No `sleep`, `setTimeout`, `tokio::time::sleep` or `thread::sleep` used to wait for something to happen. Wait on the signal the code emits (a promise, channel, event, log line, readiness endpoint), or poll a condition with a deadline that fails with a message.
- **Temp files.** Each test makes its own private temp directory (`mkdtemp`, `tempfile::tempdir()`) and removes it. Never write under the working directory, the repository or a fixed path such as `/tmp/test-db`.
- **Ports.** Servers bind port 0 and the test reads the assigned port back. No hard-coded ports.
- **Global state.** No shared mutable singletons, caches, registries or environment between tests. Pass configuration in. Never call `std::env::set_var`/`remove_var` (or mutate `process.env`) in tests that run in parallel; spawn a child process with its own environment instead.
- **Ordering.** Assert only orders the code guarantees. Sort both sides, or compare as sets or maps. Results of concurrent or background work arrive in any order; directory listings, hash maps and `Promise.all` side effects are unordered.
- **Randomness.** Every random source is seeded. Print the seed when the test fails so the run can be replayed.
- **Locks and leases.** When the code takes a file lock, lease or admission slot that another test's forked child may still hold, retry admission until a bounded deadline, then fail with the holder's details.
- **External services.** No live network, real accounts or shared databases in the gating suite. Use local fakes or disposable instances the test starts and stops itself.
- **Assertions.** Tolerances are stated and justified (floating point, measured durations). A timing threshold that depends on machine speed is a performance check, not a correctness test; keep it out of the gating suite.

## Repeat before review

Before the PR opens, run each new or changed test repeatedly, in parallel and under load, and require every run to pass. Ten runs is the minimum. Commands for common runners are in [recipes.md](references/recipes.md#repeat-runs). One failure in the repeated run means the test is not ready.

## When a test is flaky

1. Reproduce it: repeat the single test, then the whole file, in parallel and under CPU load, until it fails. Record the seed, the order and the failure.
2. Find the shared or timing-dependent input with the checklist above. The usual causes, in order: a sleep standing in for a signal, shared temp paths or ports, global or environment state, assumed ordering, wall-clock assertions, unseeded randomness.
3. Fix the cause in the test or in the code's testability (inject the clock, expose a ready signal, accept a directory). Use the recipes in [recipes.md](references/recipes.md).
4. Prove it with the repeated run.
5. If it cannot be fixed now, remove it from the gating suite (skip with a reason, or move it to a non-gating job) and open a tracking issue that names the failure and the suspected cause.

Never add retries until green, raise a timeout as the fix, or weaken an assertion to make a flaky test pass. Those hide the bug the test was written to catch.

## Report

State which tests were added or changed, the repeated-run command and its result, and any test removed from the gating suite with its tracking issue.
