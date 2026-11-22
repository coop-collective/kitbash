# Fix recipes

Each recipe names the cause, then the change. Apply the one that matches the evidence; do not apply them all.

## Clock

Cause: the test or the code reads the real time, so the result depends on when and how fast it runs.

- Pass the time in. The code takes `now: () => number` (TypeScript) or a clock trait or `Instant`/`SystemTime` argument (Rust); production passes the real clock, the test passes a fixed value and advances it by hand.
- TypeScript, when the code cannot take a clock: fake timers. Vitest `vi.useFakeTimers()` with `vi.setSystemTime(...)` and `vi.advanceTimersByTimeAsync(ms)`; `node:test` `mock.timers.enable({ apis: ["setTimeout", "Date"] })` with `mock.timers.tick(ms)`. Restore real timers after each test.
- Rust with Tokio (feature `test-util`): `#[tokio::test(start_paused = true)]` and `tokio::time::advance(duration).await`. Time moves only when the test moves it, so timeouts and intervals fire in a fixed order.
- Assert on the value derived from the injected time (an expiry, a sort key), never on "about now".

## Waiting

Cause: a fixed delay stands in for "the thing has happened". On a busy machine the delay is too short; everywhere else it is wasted time.

- Await the thing itself: the promise the call returns, a channel or `oneshot` the task completes, an event the server emits when it is listening, the child process's ready line on stdout.
- If the code exposes no signal, add one (a `ready` promise, a `Notify`, a readiness endpoint). That is a testability fix, not test-only code.
- Last resort, poll a condition with a deadline:

  ```ts
  async function until(check: () => boolean | Promise<boolean>, what: string, deadlineMs = 5000) {
    const end = performance.now() + deadlineMs;
    while (!(await check())) {
      if (performance.now() > end) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  ```

  The short pause inside the loop is a poll interval, not the wait: the loop ends as soon as the condition holds, and the deadline only decides when to give up. Make the deadline generous; it is never reached on a passing run.
- Never assert that something did *not* happen by sleeping and checking. Drive the code to a point after which it cannot happen (flush the queue, close the channel, advance the fake clock), then check.

## Temp files

Cause: tests share a path, or leave files that the next run reads.

- TypeScript: `const dir = await mkdtemp(path.join(tmpdir(), "name-"))`, removed in `afterEach` or `t.after`.
- Rust: `let dir = tempfile::tempdir()?;` and keep the guard alive until the end of the test; dropping it deletes the directory.
- Pass the directory to the code under test. Do not `chdir`: the working directory is process-wide.
- Databases, sockets, caches and lock files go inside that directory too.

## Ports

Cause: a fixed port is taken by another test, another checkout or a previous run that has not released it.

- Bind port 0 and read the port back: `server.listen(0)` then `server.address().port`; `TcpListener::bind("127.0.0.1:0")?.local_addr()?.port()`.
- Hand the bound listener to the server instead of picking a free port, closing it and binding again: another process can take the port in between.
- Bind `127.0.0.1`, not `0.0.0.0` or `localhost` (which may resolve to IPv6 first).

## Global and environment state

Cause: a singleton, cache, registry, current directory or environment variable set by one test is seen by another running at the same time or afterwards.

- Construct the state per test and pass it in. A module-level cache gets a constructor or a reset the code owns.
- Environment: read it once at the edge (`main`, the CLI entry) into a config value, and pass the config. In Rust, `std::env::set_var` and `remove_var` change the whole process while other test threads read it; do not call them in tests. To test behaviour under a given environment, spawn the binary with `Command::new(...).env(...)`. The same holds for `process.env` under a runner that shares a process between test files.
- If two tests must touch one real global (a system keychain, a fixed lock file), they are one serial test group in a non-parallel job, and the reason is written next to them.

## Ordering

Cause: the test asserts an order nobody promised.

- Sort both sides by a stable key, or compare as sets or maps.
- Directory listings, `HashMap`/`HashSet` iteration, object keys from external data, database rows without `ORDER BY`, and the completion order of concurrent tasks are unordered. If the product needs an order, make the code sort and test that.
- For events from background work, collect until the expected count or a terminal event, then compare without order, or assert only the pairs that are causally ordered.

## Randomness

Cause: a failing input is never seen again.

- Take the seed from the environment when given, otherwise generate one, and print it in the failure message: `seed=${seed}`. Rerun with that seed to replay.
- Use a seedable generator (`StdRng::seed_from_u64(seed)`, a small seeded PRNG in TypeScript); `Math.random()` cannot be seeded.
- Generated identifiers, UUIDs and timestamps in snapshots come from an injected source or are normalised before comparison.

## Locks and leases

Cause: a test starts while another test's forked child still holds a file lock, lease or admission slot for a moment.

- Retry admission until a bounded deadline (the `until` helper above), then fail with who holds it (pid, path, age).
- Give each test its own lock directory where the code allows it; the retry is for locks that are machine-wide by design.
- A child process the test started is waited on and reaped before the test ends, so it cannot hold anything into the next test.

## Repeat runs

Run the new or changed test at least ten times, in parallel and while the machine is busy. Every run must pass.

| Runner | Repeat one test |
| --- | --- |
| Any | `for i in $(seq 10); do <test command> || break; done` |
| Playwright | `playwright test path/to/spec.ts --repeat-each=10` |
| Go | `go test -run 'TestName' -count=10 -race ./pkg/...` |
| Cargo | `for i in $(seq 10); do cargo test test_name -- --test-threads=8 || break; done` |
| Vitest, `node:test`, Jest | the shell loop around the single file or test name |

In parallel: use the runner's normal parallel mode, not a serial flag, so the test meets its neighbours. If the suite runs files in separate processes, also run the whole file, not only the one test.

Under load: start the loop two or more times at once in separate shells, or run it while the full suite or a build is running. A test that only passes on an idle machine depends on timing.

Report the exact command and the count that passed. One failure in the repeated run is a result: find the cause before asking for review.
