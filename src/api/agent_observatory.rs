//! Agent Observatory single-resource and repository-scoped routes.

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::IntoResponse,
};
use serde::Deserialize;

use super::{ApiState, RunResources, WorktreeResources, observatory_page, respond};
use crate::db::agent_observatory as observatory;
use crate::surfaces::get;

pub(super) fn routes() -> Router<ApiState> {
    use crate::surfaces::ContractRouterExt as _;
    Router::new()
        .contract_route("GET /api/repositories/{repository_id}", get(repository))
        .contract_route(
            "GET /api/repositories/{repository_id}/worktrees",
            get(observatory_repository_worktrees),
        )
        .contract_route(
            "GET /api/repositories/{repository_id}/runs",
            get(repository_runs),
        )
        .contract_route("GET /api/agent-runs/{run_key}", get(run))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct NoQuery {}

async fn repository(
    State(state): State<ApiState>,
    Path(repository_id): Path<i64>,
    Query(NoQuery {}): Query<NoQuery>,
) -> impl IntoResponse {
    respond(state.service.observatory_repository(repository_id).await)
}

async fn run(
    State(state): State<ApiState>,
    Path(run_key): Path<String>,
    Query(NoQuery {}): Query<NoQuery>,
) -> impl IntoResponse {
    respond(state.service.observatory_run(run_key).await)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RepositoryRunsQuery {
    worktree_id: Option<i64>,
    branch: Option<String>,
    #[serde(default)]
    status: Vec<String>,
    #[serde(default)]
    tool: Vec<String>,
    host: Option<String>,
    query: Option<String>,
    since: Option<String>,
    until: Option<String>,
    active_only: Option<bool>,
    cursor: Option<String>,
    limit: Option<usize>,
}

async fn repository_runs(
    State(state): State<ApiState>,
    Path(repository_id): Path<i64>,
    serde_qs::axum::QsQuery(query): serde_qs::axum::QsQuery<RepositoryRunsQuery>,
) -> impl IntoResponse {
    if let Err(error) = state.service.observatory_repository(repository_id).await {
        return respond::<()>(Err(error));
    }
    let filters = observatory::AgentRunQuery {
        repository_id: Some(repository_id),
        worktree_id: query.worktree_id,
        branch: query.branch,
        statuses: query.status,
        tools: query.tool,
        host: query.host,
        query: query.query,
        since: query.since,
        until: query.until,
        active_only: query.active_only.unwrap_or(false),
        ..Default::default()
    };
    match state
        .service
        .observatory_runs(filters, query.cursor, query.limit.unwrap_or(50))
        .await
    {
        Ok(page) => Json(observatory_page(page, |runs| RunResources { runs })).into_response(),
        Err(error) => respond::<()>(Err(error)),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ObservatoryRepositoryWorktreesQuery {
    branch: Option<String>,
    dirty: Option<bool>,
    include_removed: Option<bool>,
    cursor: Option<String>,
    limit: Option<usize>,
}

async fn observatory_repository_worktrees(
    State(state): State<ApiState>,
    Path(repository_id): Path<i64>,
    serde_qs::axum::QsQuery(query): serde_qs::axum::QsQuery<ObservatoryRepositoryWorktreesQuery>,
) -> impl IntoResponse {
    if let Err(error) = state.service.observatory_repository(repository_id).await {
        return respond::<()>(Err(error));
    }
    match state
        .service
        .observatory_worktrees(
            repository_id,
            query.branch,
            query.dirty,
            query.include_removed.unwrap_or(false),
            query.cursor,
            query.limit.unwrap_or(50),
        )
        .await
    {
        Ok(page) => Json(observatory_page(page, |worktrees| WorktreeResources {
            worktrees,
        }))
        .into_response(),
        Err(error) => respond::<()>(Err(error)),
    }
}
