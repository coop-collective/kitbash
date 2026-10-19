use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use axum::{Router, http::header, routing::get};

/// Validate configuration without mutating process-wide environment in tests.
pub fn bind_address(host: Option<&str>, port: Option<&str>) -> Result<SocketAddr, &'static str> {
    let host = match host {
        Some(value) => value
            .parse::<IpAddr>()
            .map_err(|_| "HOST must be an IP address")?,
        None => IpAddr::V4(Ipv4Addr::LOCALHOST),
    };
    let port = match port {
        Some(value) if !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()) => {
            value
                .parse::<u16>()
                .map_err(|_| "PORT must be from 1 to 65535")?
        }
        Some(_) => return Err("PORT must be from 1 to 65535"),
        None => 8080,
    };
    if port == 0 {
        return Err("PORT must be from 1 to 65535");
    }
    Ok(SocketAddr::new(host, port))
}

pub fn router() -> Router {
    Router::new().route(
        "/healthz",
        get(|| async {
            (
                [
                    (header::CONTENT_TYPE, "application/json"),
                    (header::CACHE_CONTROL, "no-store"),
                ],
                "{\"ok\":true}",
            )
        }),
    )
}
