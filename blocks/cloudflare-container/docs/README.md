# Cloudflare Container block

Install one complete Worker + container feature, choosing `--variant bun` (default), `go`, or `rust`. The block installs into an existing Kitbash Worker project; it does not require copying a public starter directory.

```sh
kit install ./blocks/cloudflare-container --variant bun --apply
pnpm install
kit verify @local/cloudflare-container
```

Use the block ID reported by the installer for `kit verify`. Its shared source lands under `src/lib/hash/`, the native payload under `containers/hash/`, and the dedicated config at `container.hash.wrangler.jsonc`. `serviceName`, `routePath`, `authService` and `maxInstances` are install parameters. Native port 8080, two simultaneous jobs and a 1 MiB input cap are matching source constants across variants; change the Worker and native contract together when adapting them.

The dedicated config owns its Worker entrypoint, DO binding/class migration and image. The application's existing `wrangler.jsonc` and entrypoint remain intact. Wrangler config is merged explicitly; existing conflicting scalar values remain reviewable conflicts. The bundled legacy `migrations` format remains supported; do not add the newer `exports` provisioning format alongside it.

Before deployment, connect `AUTH` to an existing Worker service. It must authorize this hash operation and return JSON `{ "tenantId": "trusted-tenant" }` for valid callers, or a non-2xx response to deny. The Worker rejects missing/malformed identities, strips credentials and tenant headers, rejects paths/queries/upgrades outside the one declared operation, and bounds actual request bytes before it routes to a tenant-derived Container instance. Internal `/health` never becomes a public proxy route. No production identity provider is supplied.

```sh
# Host project: commands use the dedicated config, not the host Worker config.
pnpm exec wrangler types -c container.hash.wrangler.jsonc container.hash.d.ts --env-interface ContainerBindings
pnpm exec wrangler deploy -c container.hash.wrangler.jsonc --dry-run --outdir dist/hash
pnpm exec wrangler dev -c container.hash.wrangler.jsonc

# Native payload: pnpm supplies pinned Bun; Go/Rust require their toolchains.
cd containers/hash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

If the host already has a pnpm workspace, include `containers/*` in its package list and install from that workspace root; its lockfile then owns the payload's JavaScript dependencies. Otherwise install the payload independently and commit its generated standalone pnpm lockfile. Its Cargo lock travels with the Rust variant; Go uses only the standard library. Runtime tasks require Node 22.18+, Docker for image checks, and Go 1.26.4 or Rust 1.96.0 for the corresponding native host tasks. Bun uses pnpm's pinned runtime 1.4.3 and TypeScript 7.0.2. Container builds use pinned image versions and Linux amd64; image tags are version pins, not immutable digests.

Each runtime hashes a bounded request through a private temporary job directory, returns `{bytes, sha256}`, and deletes the job on success or failure. It uses a non-root user, root-owned application files, a ten-second request budget, two active jobs and bounded shutdown. The scratch selector prefers `TMPDIR`, then `/dev/shm`, `/app-tmp` and `/tmp`, rejecting symlink roots. Linux filesystem inspection reports whether the selected filesystem is tmpfs; other hosts may conservatively report false. Memory-backed scratch still counts toward memory pressure. Writable fallback disk is ephemeral and is not durable state.

From the host project, the explicit installed image test runs:

```sh
node --test test/hash-docker-smoke.mjs
```

It builds the selected amd64 image, starts it on localhost with non-root/read-only/capability/PID/memory limits and an 8 MiB tmpfs, checks real HTTP hashing and oversized input cleanup, confirms application files are unwritable, and checks SIGTERM exit. Those Docker flags establish a **local test profile**; Wrangler does not expose an equivalent arbitrary `docker run` mount/rights configuration. The shipped `USER`, bounded jobs and `enableInternet=false` remain applicable to the deployed image/Container. No Cloudflare production tmpfs, scheduler, egress enforcement or deployment is claimed by local tests.

Repository verification filters `test-e2e/install.test.mjs` to this block for clean default/custom/Go/Rust installations; `test-e2e/cloudflare-container-smoke.test.mjs` checks all installed images. Native tests travel inside every payload and run through its package tasks. Docker tests are explicit because they build and run images on the host; normal `kit verify` runs gateway tests and host TypeScript checks.

References: [Containers configuration](https://developers.cloudflare.com/containers/configuration/wrangler/), [Container class](https://developers.cloudflare.com/containers/api/container-class/), [local development](https://developers.cloudflare.com/containers/guides/local-dev/), [lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/). Current local-development documentation also warns that the newer Durable Object scheduling policy retains root capabilities for other users after deployment; changing a UID alone must never be presented as a sandbox boundary. This block uses the Container class with the default scheduling policy.
