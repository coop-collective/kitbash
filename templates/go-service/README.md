# Go HTTP service starter

Copy this independent module to a new project and replace `example.com/service` in `go.mod` and imports. It uses Go 1.26.4 and the standard library only.

pnpm orchestrates this module through its local `package.json`; Go resolves dependencies from `go.mod`/`go.sum`. pnpm 12.14.0 has no native Go resolver. Install Go 1.26.4 (and a C compiler for race tests) on the host. From the repository root use `pnpm --filter kit-template-go-service test` or `build`; `pnpm bootstrap` also runs `go mod download`.

```sh
go vet ./...
go test -race -coverprofile=coverage.out ./...
go build -trimpath -o bin/service ./cmd/service
go run ./cmd/service
```

The default listener is `127.0.0.1:8080`; set `HOST=0.0.0.0` explicitly in a container behind your gateway. Ports and IPs are validated. `/healthz` returns uncached JSON; `/echo` demonstrates strict bounded JSON decoding (4 KiB, unknown-field and trailing-value rejection). Tests use both httptest and a real ephemeral-port server, with the race detector enabled.

The server sets header/body/write/idle timeouts, limits headers, emits structured slog events, and drains requests for up to ten seconds on SIGTERM/SIGINT before closing remaining connections. Configure longer streaming or WebSocket routes separately; these finite-request defaults are inappropriate for long streams. Add authentication at your product boundary before exposing business routes.

For Cloudflare Containers build a Linux binary for the architecture supported by your configured platform, then use a non-root image and authenticated Worker gateway. This starter includes no container control plane, automatic deployment, or runtime secrets. No go.sum is needed until external dependencies are added.
