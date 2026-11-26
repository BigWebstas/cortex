//! Agent Observatory single-resource and repository-scoped routes.

use std::convert::Infallible;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
};
use serde::Deserialize;
use serde_json::json;

use super::{ApiState, RunResources, WorktreeResources, observatory_page, respond};
use crate::agent_observatory::stream::Filter;
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
        .contract_route("GET /api/agent-runs/stream", get(stream))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct StreamQuery {
    after: Option<String>,
    repository_id: Option<i64>,
    worktree_id: Option<i64>,
    run_key: Option<String>,
}

fn stream_error(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({ "error": code }))).into_response()
}

async fn stream(
    State(state): State<ApiState>,
    Query(query): Query<StreamQuery>,
    headers: HeaderMap,
) -> Response {
    // The header a reconnecting client sends wins over the query fallback.
    let cursor = match headers.get("last-event-id") {
        Some(value) => Some(value.to_str().unwrap_or_default()),
        None => query.after.as_deref(),
    };
    let after = match cursor.map(|value| value.parse::<u64>().map(i64::try_from)) {
        None => None,
        Some(Ok(Ok(id))) => Some(id),
        Some(_) => return stream_error(StatusCode::BAD_REQUEST, "invalid_cursor"),
    };
    if query.run_key.as_ref().is_some_and(|key| key.len() > 1024) {
        return stream_error(StatusCode::BAD_REQUEST, "invalid_query");
    }
    let filter = Filter {
        run_key: query.run_key,
        repository_id: query.repository_id,
        worktree_id: query.worktree_id,
    };
    let hub = &state.observatory_stream;
    let Some(mut subscription) = hub.subscribe(state.service.clone(), after, filter) else {
        return stream_error(StatusCode::TOO_MANY_REQUESTS, "stream_client_limit");
    };
    let events = async_stream::stream! {
        yield Ok::<_, Infallible>(Event::default().retry(std::time::Duration::from_secs(3)));
        while let Some(frame) = subscription.next().await {
            yield Ok(Event::default().id(frame.id).event(frame.event).data(frame.data));
        }
    };
    let keepalive = KeepAlive::new().interval(hub.keepalive()).text("keepalive");
    let mut response = Sse::new(events).keep_alive(keepalive).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache, no-store"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("x-accel-buffering", HeaderValue::from_static("no"));
    response
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
