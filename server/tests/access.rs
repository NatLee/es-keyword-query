use axum::{
    body::{to_bytes, Body},
    extract::ConnectInfo,
    http::{header, Method, Request, StatusCode},
    Router,
};
use es_keyword_query_server::{app, build_state, Config};
use serde_json::{json, Value};
use std::net::SocketAddr;
use tower::ServiceExt;
async fn call(
    router: &Router,
    method: Method,
    path: &str,
    cookie: Option<&str>,
    token: Option<&str>,
    body: Value,
) -> (StatusCode, Value, Option<String>) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header(header::CONTENT_TYPE, "application/json")
        .extension(ConnectInfo("127.0.0.1:1234".parse::<SocketAddr>().unwrap()));
    if let Some(cookie) = cookie {
        request = request.header(header::COOKIE, cookie);
    }
    if let Some(token) = token {
        request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .map(|v| v.to_str().unwrap().split(';').next().unwrap().to_owned());
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        cookie,
    )
}
#[tokio::test]
async fn standalone_bootstrap_compile_key_revoke_and_disabled_identity() {
    let dir = tempfile::TempDir::new().unwrap();
    let state = build_state(Config {
        bind: "127.0.0.1:0".into(),
        database_path: dir.path().join("db"),
        static_dir: dir.path().join("web"),
        public_origin: Some("http://127.0.0.1:8670".into()),
        cookie_secure: false,
        setup_token: None,
        default_slop: 20,
    })
    .await
    .unwrap();
    let router = app(state.clone());
    let (status, admin, cookie) = call(
        &router,
        Method::POST,
        "/api/auth/setup",
        None,
        None,
        json!({"username":"admin","password":"test-password-123"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let cookie = cookie.unwrap();
    assert_eq!(admin["role"], "admin");
    assert_eq!(
        call(
            &router,
            Method::POST,
            "/api/auth/setup",
            None,
            None,
            json!({"username":"other","password":"test-password-123"})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let(status,key,_)=call(&router,Method::POST,"/api/access/credentials",Some(&cookie),None,json!({"name":"compiler","scopes":["queries:read"],"audiences":["api","mcp"],"expires_in_days":1})).await;
    assert_eq!(status, StatusCode::CREATED);
    let token = key["token"].as_str().unwrap();
    let (status, result, _) = call(
        &router,
        Method::POST,
        "/api/v1/compile_query",
        None,
        Some(token),
        json!({"expression":"(tea|coffee)&shop!ad"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        result["query_string"],
        "(\"tea\" OR \"coffee\") AND \"shop\" NOT \"ad\""
    );
    assert_eq!(
        call(
            &router,
            Method::POST,
            "/api/v1/compile_query",
            None,
            Some(token),
            json!({"expression":"a&&b"})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (_, usage, _) = call(
        &router,
        Method::GET,
        "/api/access/usage",
        Some(&cookie),
        None,
        Value::Null,
    )
    .await;
    assert_eq!(usage["totals"]["attempts"], 2);
    assert_eq!(usage["totals"]["failures"], 1);
    let id = key["credential"]["id"].as_str().unwrap();
    assert_eq!(
        call(
            &router,
            Method::DELETE,
            &format!("/api/access/credentials/{id}"),
            Some(&cookie),
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        call(
            &router,
            Method::POST,
            "/api/v1/compile_query",
            None,
            Some(token),
            json!({"expression":"a"})
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let (_, key, _) = call(
        &router,
        Method::POST,
        "/api/access/credentials",
        Some(&cookie),
        None,
        json!({"name":"disabled test","scopes":["queries:read"]}),
    )
    .await;
    let token = key["token"].as_str().unwrap();
    sqlx::query("UPDATE users SET disabled=1 WHERE id=?")
        .bind(admin["id"].as_i64().unwrap())
        .execute(&state.db)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            Method::POST,
            "/api/v1/extract_terms",
            None,
            Some(token),
            json!({"expression":"a"})
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn official_sdk_compiles_same_library_output_and_rechecks_account_and_revocation() {
    use es_keyword_query_server::auth;
    use rmcp::{
        model::{CallToolRequestParams, ProtocolVersion},
        transport::{
            streamable_http_client::StreamableHttpClientTransportConfig,
            StreamableHttpClientTransport,
        },
        ClientLifecycleMode, ClientServiceExt,
    };
    use std::future::IntoFuture;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let dir = tempfile::TempDir::new().unwrap();
    let state = build_state(Config {
        bind: "127.0.0.1:0".into(),
        database_path: dir.path().join("db"),
        static_dir: dir.path().join("web"),
        public_origin: Some(origin.clone()),
        cookie_secure: false,
        setup_token: None,
        default_slop: 20,
    })
    .await
    .unwrap();
    let router = app(state.clone());
    let id = auth::create_user(
        &state.db,
        "sdkreader",
        "SDK reader",
        "test-password-123",
        "member",
    )
    .await
    .unwrap();
    let session = auth::create_session(&state.db, id).await.unwrap();
    let cookie = format!("{}={session}", auth::COOKIE_NAME);
    let (status, key, _) = call(
        &router,
        Method::POST,
        "/api/access/credentials",
        Some(&cookie),
        None,
        json!({"name":"sdk","scopes":["queries:read"],"audiences":["mcp"]}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let token = key["token"].as_str().unwrap();
    let server = tokio::spawn(axum::serve(listener, router.clone()).into_future());
    let config =
        StreamableHttpClientTransportConfig::with_uri(format!("{origin}/mcp")).auth_header(token);
    let client = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        ().serve_with_lifecycle(
            StreamableHttpClientTransport::from_config(config),
            ClientLifecycleMode::Discover {
                preferred_versions: vec![ProtocolVersion::V_2026_07_28],
            },
        ),
    )
    .await
    .unwrap()
    .expect("official SDK discovery");
    assert_eq!(client.list_tools(None).await.unwrap().tools.len(), 3);
    let result = client
        .call_tool(
            CallToolRequestParams::new("compile_query").with_arguments(
                json!({"expression":"(tea|coffee)&shop!ad"})
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
        )
        .await
        .unwrap();
    let result = serde_json::to_value(result).unwrap();
    assert_eq!(
        result["structuredContent"]["query_string"],
        es_keyword_query::Query::parse("(tea|coffee)&shop!ad")
            .unwrap()
            .to_query_string()
    );
    let result = client
        .call_tool(
            CallToolRequestParams::new("extract_terms").with_arguments(
                json!({"expression":"tea|coffee"})
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
        )
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(result).unwrap()["structuredContent"]["terms"],
        json!(["tea", "coffee"])
    );
    let result = client
        .call_tool(
            CallToolRequestParams::new("inspect_query")
                .with_arguments(json!({"expression":"a&&b"}).as_object().unwrap().clone()),
        )
        .await
        .unwrap();
    assert_eq!(serde_json::to_value(result).unwrap()["isError"], true);
    let (_, usage, _) = call(
        &router,
        Method::GET,
        "/api/access/usage?transport=mcp",
        Some(&cookie),
        None,
        Value::Null,
    )
    .await;
    assert_eq!(usage["totals"]["attempts"], 3);
    assert_eq!(usage["totals"]["successes"], 2);
    assert_eq!(usage["totals"]["failures"], 1);
    sqlx::query("UPDATE users SET disabled=1 WHERE id=?")
        .bind(id)
        .execute(&state.db)
        .await
        .unwrap();
    assert!(client
        .call_tool(
            CallToolRequestParams::new("extract_terms")
                .with_arguments(json!({"expression":"a"}).as_object().unwrap().clone())
        )
        .await
        .is_err());
    sqlx::query("UPDATE users SET disabled=0 WHERE id=?")
        .bind(id)
        .execute(&state.db)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            Method::DELETE,
            &format!(
                "/api/access/credentials/{}",
                key["credential"]["id"].as_str().unwrap()
            ),
            Some(&cookie),
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert!(client
        .call_tool(
            CallToolRequestParams::new("extract_terms")
                .with_arguments(json!({"expression":"a"}).as_object().unwrap().clone())
        )
        .await
        .is_err());
    let _ = client.cancel().await;
    server.abort();
}

#[tokio::test]
async fn bootstrap_is_local_only_and_bearer_cannot_manage_accounts() {
    let dir = tempfile::TempDir::new().unwrap();
    let state = build_state(Config {
        bind: "127.0.0.1:0".into(),
        database_path: dir.path().join("db"),
        static_dir: dir.path().join("web"),
        public_origin: Some("http://127.0.0.1:8670".into()),
        cookie_secure: false,
        setup_token: None,
        default_slop: 20,
    })
    .await
    .unwrap();
    let router = app(state);
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/auth/setup")
                .header(header::CONTENT_TYPE, "application/json")
                .extension(ConnectInfo("192.0.2.9:1234".parse::<SocketAddr>().unwrap()))
                .body(Body::from(
                    json!({"username":"remote","password":"test-password-123"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let (_, _, cookie) = call(
        &router,
        Method::POST,
        "/api/auth/setup",
        None,
        None,
        json!({"username":"admin","password":"test-password-123"}),
    )
    .await;
    let cookie = cookie.unwrap();
    let (status, member, _) = call(
        &router,
        Method::POST,
        "/api/users",
        Some(&cookie),
        None,
        json!({"username":"member","display_name":"Member","password":"test-password-123"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(member["role"], "member");
    let (_, key, _) = call(
        &router,
        Method::POST,
        "/api/access/credentials",
        Some(&cookie),
        None,
        json!({"name":"no admin","scopes":["queries:read"]}),
    )
    .await;
    assert_eq!(
        call(
            &router,
            Method::GET,
            "/api/users",
            None,
            key["token"].as_str(),
            Value::Null
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &router,
            Method::GET,
            "/api/access/credentials",
            None,
            key["token"].as_str(),
            Value::Null
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
}
