# Tests must be deterministic

The same code gives the same result on every run, on any machine, in parallel with other tests. A test that sometimes fails teaches everyone to ignore red and hides real regressions.

- **Time:** never assert on the wall clock. Inject a clock or use fake timers.
- **Waiting:** never `sleep`/`setTimeout` to wait for something. Wait on a signal, or poll a condition with a deadline.
- **Resources:** give each test its own private temp directory, never under the working directory or at a fixed path. Bind ephemeral ports (port 0). No shared global state. No `set_var` or other process-environment changes in tests that run in parallel.
- **Ordering:** never assert an order the code does not guarantee. Sort first or compare as sets. Background work can arrive in any order.
- **Randomness:** seed it, and print the seed when the test fails.
- **Locks:** retry lock and lease admission races with other tests' forked children, with a bounded deadline.
- **Repeat before review:** a new test must pass repeated runs (for example 10 times, in parallel, under load) before the PR opens.
- **A flaky test is a bug in the test.** Fix the root cause. If it cannot be fixed now, remove it from the gating suite and open a tracking issue. Never retry until green and never weaken the assertion.

For the detailed checklist and fix recipes, use the `deterministic-tests` skill.

