use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use tower::ServiceExt;

#[tokio::test]
async fn health_is_json_and_never_cached() {
    let response = service::router()
        .oneshot(
            Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "application/json");
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(
        response.into_body().collect().await.unwrap().to_bytes(),
        "{\"ok\":true}"
    );
}

#[tokio::test]
async fn methods_and_missing_routes() {
    for (method, path, expected) in [
        ("HEAD", "/healthz", 200),
        ("POST", "/healthz", 405),
        ("GET", "/missing", 404),
    ] {
        let response = service::router()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), expected);
        if method == "HEAD" {
            assert!(
                response
                    .into_body()
                    .collect()
                    .await
                    .unwrap()
                    .to_bytes()
                    .is_empty()
            );
        }
    }
}

#[test]
fn configuration_rejects_partial_and_out_of_range_ports() {
    assert_eq!(
        service::bind_address(None, None).unwrap().to_string(),
        "127.0.0.1:8080"
    );
    for invalid in ["", "0", "-1", "+123", "65536", "80abc", "1.2"] {
        assert!(
            service::bind_address(None, Some(invalid)).is_err(),
            "{invalid}"
        );
    }
    assert!(service::bind_address(Some("not-an-ip"), None).is_err());
    assert_eq!(
        service::bind_address(Some("::1"), Some("65535"))
            .unwrap()
            .port(),
        65535
    );
}
