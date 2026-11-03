FROM rust:1.96.0-bookworm AS build
WORKDIR /build
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates/ ./crates/
RUN cargo build --locked --release -p service
FROM debian:bookworm-slim
RUN mkdir -p /app-tmp && chown 10001:10001 /app-tmp && chmod 0700 /app-tmp
COPY --from=build --chown=root:root /build/target/release/service /app/service
USER 10001:10001
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/app/service"]
