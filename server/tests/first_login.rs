use axum::{
    body::{to_bytes, Body},
    extract::ConnectInfo,
    http::{header, Method, Request, StatusCode},
    Router,
};
use es_keyword_query_server::{app, build_state, Config};
use serde_json::{json, Value};
use std::{net::SocketAddr, sync::Mutex};
use tower::ServiceExt;

const SETUP_TOKEN: &str = "test-only-deployment-setup-code-123456789";
static ENV_LOCK: Mutex<()> = Mutex::new(());

fn config(dir: &std::path::Path, token: Option<&str>) -> Config {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(token) = token {
        std::env::set_var("ACCESS_SETUP_TOKEN", token);
    } else {
        std::env::remove_var("ACCESS_SETUP_TOKEN");
    }
    let mut config = Config::from_env().unwrap();
    std::env::remove_var("ACCESS_SETUP_TOKEN");
    config.database_path = dir.join("db");
    config.static_dir = dir.join("web");
    config.public_origin = Some("http://127.0.0.1:8670".into());
    config
}

async fn request(
    router: &Router,
    peer: Option<&str>,
    method: Method,
    path: &str,
    body: Value,
    origin: Option<&str>,
) -> (StatusCode, Value, bool) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(peer) = peer {
        request = request.extension(ConnectInfo(peer.parse::<SocketAddr>().unwrap()));
    }
    if let Some(origin) = origin {
        request = request.header(header::ORIGIN, origin);
    }
    // Forwarded headers are deliberately false; only the connection peer counts.
    request = request
        .header("x-forwarded-for", "127.0.0.1")
        .header("x-forwarded-host", "127.0.0.1:8670");
    let response = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let cookie = response.headers().contains_key(header::SET_COOKIE);
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        cookie,
    )
}
fn account(token: Option<&str>, username: &str) -> Value {
    json!({"username":username,"password":"test-password-123","setup_token":token})
}

#[tokio::test]
async fn remote_setup_requires_valid_token_and_closes_after_first_account() {
    let dir = tempfile::TempDir::new().unwrap();
    let state = build_state(config(dir.path(), Some(SETUP_TOKEN)))
        .await
        .unwrap();
    let router = app(state.clone());
    for token in [None, Some("wrong-token")] {
        assert_eq!(
            request(
                &router,
                Some("192.0.2.9:1234"),
                Method::POST,
                "/api/auth/setup",
                account(token, "admin"),
                None
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
    }
    assert_eq!(
        request(
            &router,
            Some("192.0.2.9:1234"),
            Method::POST,
            "/api/auth/setup",
            account(Some(SETUP_TOKEN), "admin"),
            Some("https://evil.example")
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let (status, user, cookie) = request(
        &router,
        Some("192.0.2.9:1234"),
        Method::POST,
        "/api/auth/setup",
        account(Some(SETUP_TOKEN), "admin"),
        Some("http://127.0.0.1:8670"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(user["role"], "admin");
    assert!(cookie);
    assert_eq!(
        request(
            &router,
            Some("192.0.2.9:1234"),
            Method::POST,
            "/api/auth/setup",
            account(Some(SETUP_TOKEN), "other"),
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    for token in [None, Some("wrong-token")] {
        assert_eq!(
            request(
                &router,
                Some("192.0.2.9:1234"),
                Method::POST,
                "/api/auth/setup",
                account(token, "other"),
                None
            )
            .await
            .0,
            StatusCode::CONFLICT
        );
    }
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(count, 1);
    let (_, closed, _) = request(
        &router,
        Some("192.0.2.9:1234"),
        Method::GET,
        "/api/auth/state",
        Value::Null,
        None,
    )
    .await;
    assert_eq!(closed["setup_required"], false);
    assert_eq!(closed["setup_token_required"], false);
    assert_eq!(closed["setup_token_configured"], false);
}

#[tokio::test]
async fn setup_state_only_exposes_token_requirement_and_configuration() {
    for token in [None, Some(SETUP_TOKEN)] {
        let dir = tempfile::TempDir::new().unwrap();
        let router = app(build_state(config(dir.path(), token)).await.unwrap());
        for peer in [
            None,
            Some("192.0.2.9:1234"),
            Some("127.0.0.1:1234"),
            Some("[::1]:1234"),
        ] {
            let (_, data, _) = request(
                &router,
                peer,
                Method::GET,
                "/api/auth/state",
                Value::Null,
                None,
            )
            .await;
            assert_eq!(
                data["setup_token_required"],
                !peer.is_some_and(|p| p.starts_with("127.") || p.starts_with("[::1]"))
            );
            assert_eq!(data["setup_token_configured"], token.is_some());
            assert!(!data.to_string().contains(SETUP_TOKEN));
        }
    }
}

#[tokio::test]
async fn loopback_is_compatible_but_remote_without_configuration_is_closed() {
    for token in [None, Some(SETUP_TOKEN)] {
        let dir = tempfile::TempDir::new().unwrap();
        let router = app(build_state(config(dir.path(), token)).await.unwrap());
        for peer in [None, Some("192.0.2.9:1234")] {
            let candidate = if token.is_some() {
                None
            } else {
                Some(SETUP_TOKEN)
            };
            assert_eq!(
                request(
                    &router,
                    peer,
                    Method::POST,
                    "/api/auth/setup",
                    account(candidate, "admin"),
                    None
                )
                .await
                .0,
                StatusCode::FORBIDDEN
            );
        }
        let peer = if token.is_some() {
            "127.0.0.1:1234"
        } else {
            "[::1]:1234"
        };
        assert_eq!(
            request(
                &router,
                Some(peer),
                Method::POST,
                "/api/auth/setup",
                account(None, "admin"),
                None
            )
            .await
            .0,
            StatusCode::OK
        );
    }
}

#[tokio::test]
async fn simultaneous_remote_setup_creates_exactly_one_administrator() {
    let dir = tempfile::TempDir::new().unwrap();
    let state = build_state(config(dir.path(), Some(SETUP_TOKEN)))
        .await
        .unwrap();
    let router = app(state.clone());
    let (one, two) = tokio::join!(
        request(
            &router,
            Some("192.0.2.9:1234"),
            Method::POST,
            "/api/auth/setup",
            account(Some(SETUP_TOKEN), "first"),
            None
        ),
        request(
            &router,
            Some("192.0.2.10:1234"),
            Method::POST,
            "/api/auth/setup",
            account(Some(SETUP_TOKEN), "second"),
            None
        )
    );
    let mut statuses = [one.0.as_u16(), two.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, [200, 409]);
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE role='admin'")
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn deployment_setup_token_validation_and_debug_never_disclose_secrets() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    for secret in [
        "".to_owned(),
        "short-secret-canary".to_owned(),
        " ".repeat(32),
        "x".repeat(513),
    ] {
        std::env::set_var("ACCESS_SETUP_TOKEN", &secret);
        let result = Config::from_env();
        std::env::remove_var("ACCESS_SETUP_TOKEN");
        assert!(
            result.is_err(),
            "invalid deployment tokens must be rejected"
        );
        if !secret.is_empty() {
            assert!(!result.unwrap_err().to_string().contains(&secret));
        }
    }
    std::env::set_var("ACCESS_SETUP_TOKEN", SETUP_TOKEN);
    let config = Config::from_env().unwrap();
    std::env::remove_var("ACCESS_SETUP_TOKEN");
    assert!(!format!("{config:?}").contains(SETUP_TOKEN));
}
