# Container gateway with bounded scratch space

A Worker authenticates a narrow HTTP operation and selects a container from the verified tenant. The container runs as the unprivileged `node` user, has outbound internet disabled, and processes at most two one-MiB requests concurrently with a ten-second deadline. This example hashes a temporary input file; real compilers or media tools can replace that operation while retaining the boundaries.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Bind your `container-auth` Worker before interactive use. `POST /authorize-hash` receives the original Authorization header; return `{tenantId}` only after validating the caller and their permission to invoke the operation. The authorization helper is a seam, not a login provider. The gateway fails closed on auth errors. No credentials or caller-chosen identity headers reach the container. Only `POST /hash` without query parameters is routed; no arbitrary URL, path, WebSocket, shell or port forwarding is provided. `EXPOSE 8080` documents an image port, not a public port authorization rule.

The Worker uses the stable `@cloudflare/containers` 0.3.7 class API found throughout the source projects. There is one named instance per tenant, a one-minute sleep policy, and a five-instance application cap. This is a starting capacity guard, not a fair scheduler or globally enforced account quota. Add admission limits and workload-specific tenancy before exposing expensive compute publicly.

Scratch selection checks the configured `TMPDIR`, then writable `/dev/shm`, `/app-tmp`, and `/tmp`. Linux `statfs` identifies tmpfs and the startup log reports `scratchMemoryBacked`; the path name alone never establishes RAM backing. The code never mounts filesystems or escalates privileges. `/tmp` in a Cloudflare container is not the Workers Node virtual filesystem, and is not automatically promised to be memory-backed. Each job gets a private 0700 directory and an exclusive 0600 file; cleanup runs on success, failure, disconnect and timeout. The root-owned app files require no writes.

To exercise a stricter local Linux configuration:

```sh
docker build -t kit-container-gateway:test .
docker run --rm --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --memory=128m --tmpfs /tmp:rw,noexec,nosuid,size=8m,mode=1777 \
  -e TMPDIR=/tmp -p 127.0.0.1:8080:8080 kit-container-gateway:test
```

`pnpm test:docker` runs this profile automatically, verifies the HTTP digest, non-root identity, root-owned app files, tmpfs backing and cleanup, then removes its container.

These Docker flags are a **local validation profile**, not Wrangler options or a claim that Cloudflare applies them. Confirm deployed scratch backing from the startup event. tmpfs consumes the instance memory budget; bound bytes and concurrency, and stream directly when the tool does not require paths. Container disk is ephemeral by default; use R2/D1 or deliberately managed platform snapshots for durable results. FUSE is not an in-memory substitute.

`pnpm test` covers the real local HTTP service and scratch lifecycle plus gateway routing/auth policy. `pnpm typecheck` and dry-run build validate the installed container SDK and Wrangler bindings. Docker validates process rights and tmpfs behavior; it does not exercise Cloudflare scheduling, egress enforcement or deployment permissions. Oversized/aborted streams may disconnect rather than deliver an HTTP error because pipeline destroys the inbound stream. Pin the base image digest according to your application's update policy before production adoption.

This template is also a root pnpm workspace member. Its local workspace settings apply to standalone copies. After copying, run `pnpm install` and commit the generated lockfile before using frozen installs in CI.
