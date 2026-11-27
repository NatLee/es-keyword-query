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
    fn registration_admin<'a>(
        &'a self,
        connection: &'a mut sqlx::SqliteConnection,
        headers: &'a HeaderMap,
        id: i64,
    ) -> HostFuture<'a, bool> {
        Box::pin(async move {
            let Some(token) = auth::read_cookie(headers, auth::COOKIE_NAME) else {
                return Ok(false);
            };
            let hash = Sha256::digest(token.as_bytes())
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>();
            Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>? AND u.disabled=0 AND u.account_status='active' AND u.role='admin')").bind(hash).bind(id).bind(crate::db::now()).fetch_one(connection).await?)
        })
    }

    fn registration_count<'a>(
        &'a self,
        connection: &'a mut sqlx::SqliteConnection,
    ) -> HostFuture<'a, i64> {
        Box::pin(async move {
            Ok(sqlx::query_scalar("SELECT COUNT(*) FROM users")
                .fetch_one(connection)
                .await?)
        })
    }
    fn registration_create<'a>(
        &'a self,
        connection: &'a mut sqlx::SqliteConnection,
        user: access_kit::RegistrationUser,
    ) -> HostFuture<'a, i64> {
        Box::pin(async move {
            let id=sqlx::query("INSERT INTO users(username,display_name,password_hash,role,created_at,account_status,password_login_enabled) VALUES(?,?,?,'member',?,?,?)")
 .bind(&user.username).bind(&user.display_name).bind(&user.password_hash).bind(crate::db::now()).bind(&user.account_status).bind(user.password_login_enabled).execute(connection).await.map_err(|e| if e.as_database_error().is_some_and(|e|e.is_unique_violation()){AccessError::new(StatusCode::CONFLICT,"username_taken","Username is already in use")}else{unavailable()})?.last_insert_rowid();
            Ok(id)
        })
    }
    fn registration_account<'a>(
        &'a self,
        connection: &'a mut sqlx::SqliteConnection,
        id: i64,
    ) -> HostFuture<'a, Option<access_kit::RegistrationAccount>> {
        Box::pin(async move {
            let row: Option<(String, bool)> = sqlx::query_as(
                "SELECT account_status,password_login_enabled FROM users WHERE id=?",
            )
            .bind(id)
            .fetch_optional(connection)
            .await?;
            Ok(row.map(
                |(status, password_login_enabled)| access_kit::RegistrationAccount {
                    status,
                    password_login_enabled,
                },
            ))
        })
    }
    fn registration_set_status<'a>(
        &'a self,
        connection: &'a mut sqlx::SqliteConnection,
        id: i64,
        status: &'a str,
    ) -> HostFuture<'a, bool> {
        Box::pin(async move {
            Ok(sqlx::query("UPDATE users SET account_status=? WHERE id=? AND account_status='pending' AND role='member'").bind(status).bind(id).execute(connection).await?.rows_affected()==1)
        })
    }

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
                "SELECT id,username,display_name,role FROM users WHERE id=? AND disabled=0 AND account_status='active'",
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
