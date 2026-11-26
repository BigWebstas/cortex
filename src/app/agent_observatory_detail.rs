//! Single-resource Agent Observatory reads.

use serde::Serialize;

use super::agent_observatory::resolve_run;
use super::{CortexService, ServiceError, ServiceResult};
use crate::db::agent_observatory as ao;

const MAX_ACTORS: usize = 256;
const MAX_WORKTREE_EVIDENCE: usize = 128;

#[derive(Debug, Clone, Serialize)]
pub struct RunActor {
    pub key: String,
    pub native_id: String,
    pub actor_type: Option<String>,
    pub display_name: Option<String>,
    pub started_at: Option<String>,
    pub last_activity_at: Option<String>,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Evidence {
    pub kind: String,
    pub source: String,
    pub trust: String,
    pub confidence: f64,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommitSummary {
    pub sha: String,
    pub parent_shas: Vec<String>,
    pub author_name: Option<String>,
    pub authored_at: Option<String>,
    pub committed_at: Option<String>,
    pub subject: String,
    pub changed_files: Option<i64>,
    pub insertions: Option<i64>,
    pub deletions: Option<i64>,
    pub changed_paths: Vec<String>,
    pub first_observed_at: String,
    pub last_observed_at: String,
    pub reachable: bool,
    pub evidence: Vec<Evidence>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunDetail {
    pub run: ao::ObservatoryRunRow,
    pub actors: Vec<RunActor>,
    pub worktree_evidence: Vec<Evidence>,
    pub available_event_kinds: Vec<String>,
    pub commit_summary: Option<CommitSummary>,
    pub latest_stream_cursor: String,
}

fn commit_summary(
    relations: Vec<ao::AgentRunAttributedCommit>,
) -> anyhow::Result<Option<CommitSummary>> {
    let Some(commit) = relations.first().map(|item| item.commit.clone()) else {
        return Ok(None);
    };
    let evidence = relations
        .into_iter()
        .map(|item| Evidence {
            kind: item.relation.evidence_kind,
            source: item.relation.evidence_source,
            trust: item.relation.trust_level.as_str().to_owned(),
            confidence: item.relation.confidence,
            first_seen_at: item.relation.first_seen_at,
            last_seen_at: item.relation.last_seen_at,
            detail: None,
        })
        .collect();
    Ok(Some(CommitSummary {
        sha: commit.sha,
        parent_shas: serde_json::from_str(&commit.parent_shas_json)?,
        author_name: commit.author_name,
        authored_at: commit.authored_at,
        committed_at: commit.committed_at,
        subject: commit.subject,
        changed_files: commit.changed_files,
        insertions: commit.insertions,
        deletions: commit.deletions,
        changed_paths: serde_json::from_str(&commit.changed_paths_json)?,
        first_observed_at: commit.first_observed_at,
        last_observed_at: commit.last_observed_at,
        reachable: commit.reachable,
        evidence,
    }))
}

fn repository_not_found() -> ServiceError {
    ServiceError::NotFound("repository_not_found".into())
}

impl CortexService {
    pub async fn observatory_repository(
        &self,
        repository_id: i64,
    ) -> ServiceResult<ao::ObservatoryRepositoryRow> {
        self.run_db("observatory.repository", move |pool| {
            ao::resolve_observatory_repository(pool, repository_id)?
                .ok_or_else(|| anyhow::anyhow!(repository_not_found()))
        })
        .await
    }

    pub async fn observatory_run(&self, run_key: String) -> ServiceResult<RunDetail> {
        self.run_db("observatory.run", move |pool| {
            // Captured first so a stream resumed from here cannot miss a change
            // made while the related records are read.
            let cursor = ao::latest_stream_cursor(pool)?;
            let (run_id, _) = resolve_run(pool, &run_key)?;
            let run = ao::resolve_observatory_run_row(pool, run_id)?
                .ok_or_else(|| anyhow::anyhow!(ServiceError::NotFound("run_not_found".into())))?;
            let mut actors = ao::list_observatory_run_actors(pool, run_id, MAX_ACTORS)?;
            actors.truncate(MAX_ACTORS);
            Ok(RunDetail {
                run,
                actors: actors
                    .into_iter()
                    .map(|actor| RunActor {
                        key: actor.actor_key,
                        native_id: actor.native_actor_id,
                        actor_type: actor.actor_type,
                        display_name: actor.display_name,
                        started_at: actor.started_at,
                        last_activity_at: actor.last_activity_at,
                        ended_at: actor.ended_at,
                    })
                    .collect(),
                worktree_evidence: ao::list_run_worktree_evidence(
                    pool,
                    run_id,
                    MAX_WORKTREE_EVIDENCE,
                )?
                .into_iter()
                .map(|row| Evidence {
                    kind: row.kind,
                    source: row.source,
                    trust: row.trust,
                    confidence: row.confidence,
                    first_seen_at: row.first_seen_at,
                    last_seen_at: row.last_seen_at,
                    detail: Some(row.worktree_path),
                })
                .collect(),
                available_event_kinds: ao::list_run_event_kinds(pool, run_id)?,
                commit_summary: commit_summary(ao::latest_run_commit(pool, run_id)?)?,
                latest_stream_cursor: cursor.to_string(),
            })
        })
        .await
    }
}
