use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{Request, StatusCode},
};
use es_keyword_query_server::{app, build_state, Config};
use std::io::Read;
use tower::ServiceExt;
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let state = build_state(Config::from_env()?).await?;
    match args.as_slice() {
        [] => {
            let listener = tokio::net::TcpListener::bind(&state.config.bind).await?;
            println!("Compiler Foundry optional server listening on {}", listener.local_addr()?);
            axum::serve(listener, app(state).into_make_service_with_connect_info::<std::net::SocketAddr>()).await?;
        }
        [command, username] if command == "bootstrap" => {
            let mut password = String::new();
            std::io::stdin().lock().take(4097).read_to_string(&mut password)?;
            if password.len() > 4096 {
                anyhow::bail!("Password input is too long");
            }
            let body = serde_json::json!({
                "username": username,
                "password": password.trim_end_matches(&['\r', '\n'][..]),
            });
            // This is a fixed local host operation, not a bearer-domain proxy.
            let request = Request::builder()
                .method("POST")
                .uri("/api/auth/setup")
                .header("content-type", "application/json")
                .extension(ConnectInfo("127.0.0.1:0".parse::<std::net::SocketAddr>()?))
                .body(Body::from(body.to_string()))?;
            let response = app(state).oneshot(request).await?;
            if response.status() != StatusCode::OK {
                anyhow::bail!("Bootstrap denied (HTTP {}); the service may already have an account", response.status());
            }
            println!("Administrator created; sign in through the native login page.");
        }
        _ => anyhow::bail!("Usage: es-keyword-query-server [bootstrap <username>] (bootstrap reads password from stdin)"),
    }
    Ok(())
}
