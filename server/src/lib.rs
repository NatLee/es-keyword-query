//! Optional standalone service. The library package's default dependency graph is unchanged.
pub mod access;
pub mod auth;
mod auth_routes;
pub mod compiler;
pub mod config;
pub mod db;
pub mod error;
pub mod state;
mod users;
use axum::{
    extract::DefaultBodyLimit,
    http::{header, HeaderValue},
    middleware,
    routing::{get, patch, post},
    Router,
};
pub use config::Config;
pub use state::{AppState, Inner};
use std::sync::Arc;
use tower_http::{
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
};
pub async fn build_state(mut config: Config) -> anyhow::Result<AppState> {
    let origin = std::env::var("ACCESS_PUBLIC_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| {
            config
                .public_origin
                .clone()
                .unwrap_or_else(|| "http://127.0.0.1:8670".into())
        });
    let access_config = access_kit::AccessConfig::from_env(&origin)?;
    config.cookie_secure |= access_config.secure_cookies();
    config.public_origin = Some(url::Url::parse(&origin)?.origin().ascii_serialization());
    let db = db::connect(&config.database_path).await?;
    let state = Arc::new(Inner::new(db, config));
    access::install(&state, access_config).await?;
    Ok(state)
}
pub fn app(state: AppState) -> Router {
    let api = Router::new()
        .route("/auth/state", get(auth_routes::state))
        .route("/auth/setup", post(auth_routes::setup))
        .route("/auth/login", post(auth_routes::login))
        .route("/auth/logout", post(auth_routes::logout))
        .route("/auth/me", patch(auth_routes::update_me))
        .route("/auth/password", post(auth_routes::change_password))
        .route("/compiler/inspect", post(compiler::inspect))
        .route("/users", get(users::list).post(users::create))
        .route("/users/{id}", patch(users::update));
    let static_dir = &state.config.static_dir;
    let files = ServeDir::new(static_dir).fallback(ServeFile::new(static_dir.join("index.html")));
    let router = Router::new()
        .nest("/api", api)
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::origin_guard,
        ))
        .fallback_service(files)
        .layer(DefaultBodyLimit::max(1024 * 1024))
        .with_state(state.clone());
    let router = if let Some(kit) = state.access.get() {
        router.merge(kit.router())
    } else {
        router
    };
    router
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::REFERRER_POLICY,
            HeaderValue::from_static("same-origin"),
        ))
}
