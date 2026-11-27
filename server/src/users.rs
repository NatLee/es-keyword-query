//! Cookie-admin account management is never a domain operation.
use crate::{
    auth::{self, Admin},
    db,
    error::{AppError, AppResult},
    state::AppState,
};
use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
pub async fn list(State(state): State<AppState>, _admin: Admin) -> AppResult<Json<Value>> {
    let rows = sqlx::query(
        "SELECT id,username,display_name,role,disabled,account_status FROM users ORDER BY id",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        json!({"items":rows.iter().map(|r|json!({"id":r.get::<i64,_>("id"),"username":r.get::<String,_>("username"),"display_name":r.get::<String,_>("display_name"),"role":r.get::<String,_>("role"),"disabled":r.get::<i64,_>("disabled")!=0,"account_status":r.get::<String,_>("account_status")})).collect::<Vec<_>>()}),
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Create {
    username: String,
    display_name: String,
    password: String,
}
pub async fn create(
    State(state): State<AppState>,
    _admin: Admin,
    Json(body): Json<Create>,
) -> AppResult<Json<Value>> {
    let id = auth::create_user(
        &state.db,
        &body.username.trim().to_lowercase(),
        &body.display_name,
        &body.password,
        "member",
    )
    .await?;
    Ok(Json(
        json!({"id":id,"username":body.username,"display_name":body.display_name,"role":"member"}),
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Update {
    disabled: bool,
}
pub async fn update(
    State(state): State<AppState>,
    Admin(admin): Admin,
    Path(id): Path<i64>,
    Json(body): Json<Update>,
) -> AppResult<Json<Value>> {
    if admin.id == id {
        return Err(AppError::forbidden("不能在這裡停用自己"));
    }
    let changed = sqlx::query("UPDATE users SET disabled=? WHERE id=?")
        .bind(body.disabled)
        .bind(id)
        .execute(&state.db)
        .await?;
    if changed.rows_affected() == 0 {
        return Err(AppError::not_found("找不到帳號"));
    }
    if body.disabled {
        auth::delete_sessions_of(&state.db, id, None).await?;
    }
    Ok(Json(
        json!({"id":id,"disabled":body.disabled,"updated_at":db::now()}),
    ))
}
