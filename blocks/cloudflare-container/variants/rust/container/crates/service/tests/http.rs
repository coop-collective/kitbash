use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use service::{MAX_BYTES, Scratch, router, scratch_root};
use tower::ServiceExt;

#[tokio::test]
async fn hashes_and_bounds_payload_with_cleanup() {
    let root = tempfile::tempdir().unwrap();
    let app = router(Scratch {
        path: root.path().into(),
        memory_backed: false,
    });
    for size in [5, MAX_BYTES, MAX_BYTES + 1] {
        let data = if size == 5 {
            b"hello".to_vec()
        } else {
            vec![b'x'; size]
        };
        let response = app
            .clone()
            .oneshot(Request::post("/hash").body(Body::from(data)).unwrap())
            .await
            .unwrap();
        if size > MAX_BYTES {
            assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        } else {
            assert_eq!(response.status(), StatusCode::OK);
            let result =
                String::from_utf8(to_bytes(response.into_body(), 1024).await.unwrap().to_vec())
                    .unwrap();
            assert!(result.contains(&format!("\"bytes\":{size}")));
            if size == 5 {
                assert!(
                    result.contains(
                        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
                    )
                );
            }
        }
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    }
}

#[tokio::test]
async fn scratch_failures_are_errors_and_routes_stay_narrow() {
    let root = tempfile::tempdir().unwrap();
    let link = root.path().join("link");
    std::os::unix::fs::symlink(root.path(), &link).unwrap();
    assert!(scratch_root(&[link]).is_err());
    let app = router(Scratch {
        path: root.path().join("missing"),
        memory_backed: false,
    });
    let response = app
        .clone()
        .oneshot(Request::post("/hash").body(Body::from("x")).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    for route in ["/hash?port=22", "/admin"] {
        let response = app
            .clone()
            .oneshot(Request::post(route).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
    assert!(service::bind_address(Some("0")).is_err());
    assert_eq!(
        service::bind_address(None).unwrap().to_string(),
        "0.0.0.0:8080"
    );
}
