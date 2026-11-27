//! HTTP serialization around the unchanged library compiler.
use crate::{
    auth::CurrentUser,
    error::{AppError, AppResult},
    state::AppState,
};
use axum::{extract::State, Json};
use es_keyword_query::{ClauseKind, Joiner, Options, Query};
use serde::Deserialize;
use serde_json::{json, Value};
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    pub expression: String,
    pub precise: Option<bool>,
    pub default_slop: Option<u32>,
}
pub fn evaluate(input: Input, operation: &str, default_slop: u32) -> AppResult<Value> {
    if input.expression.chars().count() > 40000 {
        return Err(AppError::bad(
            "Expression must be at most 40,000 characters",
        ));
    }
    let query = Query::parse_with(
        &input.expression,
        Options {
            precise: input.precise.unwrap_or(true),
            default_slop: input.default_slop.unwrap_or(default_slop),
            ..Options::default()
        },
    )
    .map_err(|error| AppError::bad(error.to_string()))?;
    match operation {
        "compile_query" => Ok(json!({"query_string":query.to_query_string()})),
        "extract_terms" => Ok(json!({"terms":query.terms()})),
        "inspect_query" => Ok(
            json!({"query_string":query.to_query_string(),"terms":query.terms(),"clauses":query.clauses().into_iter().map(|c|json!({"parent":c.parent,"kind":match c.kind{ClauseKind::Term=>"term",ClauseKind::Group=>"group",ClauseKind::Proximity=>"proximity"},"joiner":c.joiner.map(|j|match j{Joiner::And=>"AND",Joiner::Or=>"OR"}),"negated":c.negated,"text":c.text,"slop":c.slop,"output":c.output})).collect::<Vec<_>>()}),
        ),
        _ => Err(AppError::not_found("Unknown compiler operation")),
    }
}
pub async fn inspect(
    State(state): State<AppState>,
    _user: CurrentUser,
    Json(input): Json<Input>,
) -> AppResult<Json<Value>> {
    Ok(Json(evaluate(
        input,
        "inspect_query",
        state.config.default_slop,
    )?))
}
