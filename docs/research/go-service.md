# Go service bootstrap

Current deliverable: the **go variant** of [cloudflare-container](../../blocks/cloudflare-container/docs/README.md). The standalone starter described in this original review was replaced by an installable Wrangler/Cloudflare Containers block; its payload is mapped into root pnpm. Historical evidence and initial checks follow.

Reviewed 2026-10-19. Deliverable: `templates/go-service`, a standalone, standard-library service.

## Workspace evidence

`platform` at `8f8ed9c2a44507490912f8631806664c724be767` is the canonical Go source in this scan. `examples/container-share-probe/container/{go.mod,main.go}` demonstrates a tiny net/http payload; its unchecked ListenAndServe and absent timeouts are appropriate limitations to flag in a probe, not repeat in a service starter. `packages/playground/container/go/{go.mod,main.go}` and `service/coverage_test.go` demonstrate separate server/service layers, shutdown drain and race-oriented tests. Its TypeScript-Go fork module name, compiler dependencies and workspace manager should not become bootstrap defaults.

The starter is original code informed by those patterns. It adds strict bounded JSON, a finite shutdown deadline, validated loopback-default addressing and executable vet/race/build checks. It does not copy the workspace executor or import its business dependencies. Go is a native container target, not the Workers JavaScript runtime.

## Verification

`go vet ./...`, `go test -race -coverprofile=coverage.out ./...` and `go build -trimpath -o bin/service ./cmd/service`. Tests cover a real listener and graceful close, invalid configuration, method/route handling, HEAD, malformed/oversized/trailing JSON. The coverage report honestly includes the startup file, which is not fully exercised by handler tests.

Primary references: [net/http Server timeouts and Shutdown](https://pkg.go.dev/net/http#Server), [MaxBytesReader](https://pkg.go.dev/net/http#MaxBytesReader), [Go race detector](https://go.dev/doc/articles/race_detector), [signal.NotifyContext](https://pkg.go.dev/os/signal#NotifyContext). No remote container deployment was performed.
