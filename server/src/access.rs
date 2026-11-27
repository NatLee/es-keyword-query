use crate::{
    auth::{self, CurrentUser},
    compiler,
    state::{AppState, Inner},
};
use access_kit::{
    AccessConfig, AccessError, AccessKit, CookieSession, DomainOperation, Host, HostFuture,
    HostPaths, Invocation, Principal, Role,
};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Weak};
struct CompilerHost {
    state: Weak<Inner>,
}
fn unavailable() -> AccessError {
    AccessError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "host_unavailable",
        "Compiler service is unavailable",
    )
}
fn principal(user: CurrentUser) -> Principal {
    let role = if user.is_admin() {
        Role::Admin
    } else {
        Role::Member
    };
    Principal {
        user_id: user.id,
        username: user.username,
        display_name: user.display_name,
        role,
    }
}
impl CompilerHost {
    fn state(&self) -> Result<AppState, AccessError> {
        self.state.upgrade().ok_or_else(unavailable)
    }
}
pub async fn install(state: &AppState, config: AccessConfig) -> anyhow::Result<()> {
    let kit = AccessKit::new(
        state.db.clone(),
        config,
        Arc::new(CompilerHost {
            state: Arc::downgrade(state),
        }),
    )
    .await?;
    state
        .access
        .set(kit)
        .map_err(|_| anyhow::anyhow!("Access core already installed"))?;
    Ok(())
}
impl Host for CompilerHost {
    fn cookie_principal<'a>(
        &'a self,
        headers: &'a HeaderMap,
    ) -> HostFuture<'a, Option<CookieSession>> {
        Box::pin(async move {
            let state = self.state()?;
            let user = auth::optional_user(&state.db, headers)
                .await
                .map_err(|_| unavailable())?;
            Ok(
                match (user, auth::read_cookie(headers, auth::COOKIE_NAME)) {
                    (Some(user), Some(token)) => Some(CookieSession {
                        principal: principal(user),
                        session_binding: Sha256::digest(token.as_bytes()).into(),
                    }),
                    _ => None,
                },
            )
        })
    }
    fn active_principal(&self, id: i64) -> HostFuture<'_, Option<Principal>> {
        Box::pin(async move {
            let state = self.state()?;
            Ok(sqlx::query_as::<_, CurrentUser>(
                "SELECT id,username,display_name,role FROM users WHERE id=? AND disabled=0",
            )
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .map(principal))
        })
    }
    fn create_session(&self, id: i64) -> HostFuture<'_, HeaderValue> {
        Box::pin(async move {
            let state = self.state()?;
            let token = auth::create_session(&state.db, id)
                .await
                .map_err(|_| unavailable())?;
            HeaderValue::from_str(&auth::session_cookie(&token, state.config.cookie_secure))
                .map_err(|_| unavailable())
        })
    }
    fn paths(&self) -> HostPaths {
        HostPaths {
            login: "/login",
            connections: "/connections",
            consent: "/consent",
        }
    }
    fn operations(&self) -> Vec<DomainOperation> {
        [
 ("compile_query","Compile an expression using the unchanged Rust library"),
 ("inspect_query","Inspect written groups, exclusions and terms with the Rust library"),
 ("extract_terms","Extract normalized terms in the Rust library's written order")
 ].into_iter().map(|(name,description)|DomainOperation{name,description,required_scope:"queries:read",read_only:true,input_schema:json!({"type":"object","additionalProperties":false,"required":["expression"],"properties":{"expression":{"type":"string","maxLength":40000},"precise":{"type":"boolean"},"default_slop":{"type":"integer","minimum":0,"maximum":4294967295_u64}}})}).collect()
    }
    fn execute(&self, invocation: Invocation) -> HostFuture<'_, Value> {
        Box::pin(async move {
            let state = self.state()?;
            // A second active read closes host permission races before local compilation.
            if self
                .active_principal(invocation.principal().user_id)
                .await?
                .is_none()
            {
                return Err(AccessError::new(
                    StatusCode::UNAUTHORIZED,
                    "inactive_user",
                    "Account is unavailable",
                ));
            }
            let input = serde_json::from_value(invocation.arguments().clone()).map_err(|_| {
                AccessError::new(
                    StatusCode::BAD_REQUEST,
                    "invalid_arguments",
                    "Invalid compiler arguments",
                )
            })?;
            compiler::evaluate(input, invocation.operation(), state.config.default_slop).map_err(
                |error| match error {
                    crate::error::AppError::BadRequest(message) => {
                        AccessError::new(StatusCode::BAD_REQUEST, "compile_error", message)
                    }
                    _ => unavailable(),
                },
            )
        })
    }
}
