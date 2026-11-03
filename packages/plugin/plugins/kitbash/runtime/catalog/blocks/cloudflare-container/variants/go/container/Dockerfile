FROM golang:1.26.4-bookworm AS build
WORKDIR /build
COPY go.mod ./
COPY cmd/ ./cmd/
COPY internal/ ./internal/
RUN CGO_ENABLED=0 go build -mod=readonly -trimpath -ldflags="-s -w" -o /service ./cmd/service
FROM debian:bookworm-slim
RUN mkdir -p /app-tmp && chown 10001:10001 /app-tmp && chmod 0700 /app-tmp
COPY --from=build --chown=root:root /service /app/service
USER 10001:10001
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/app/service"]
