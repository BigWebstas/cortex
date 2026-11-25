//! Related records for one Agent Observatory run.

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, params};

use super::{AgentRunAttributedCommit, list_run_commit_attributions};
use crate::db::pool::DbPool;

#[derive(Debug, Clone, PartialEq)]
pub struct RunWorktreeEvidenceRow {
    pub kind: String,
    pub source: String,
    pub trust: String,
    pub confidence: f64,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub worktree_path: String,
}

/// Current and historical worktree relations, strongest first.
pub fn list_run_worktree_evidence(
    pool: &DbPool,
    run_id: i64,
    limit: usize,
) -> Result<Vec<RunWorktreeEvidenceRow>> {
    let conn = pool.get()?;
    let mut statement = conn.prepare(
        "SELECT rw.evidence_kind,rw.evidence_source,rw.trust_level,rw.confidence,
                rw.first_seen_at,rw.last_seen_at,w.path
           FROM agent_run_worktrees rw JOIN repository_worktrees w ON w.id=rw.worktree_id
          WHERE rw.run_id=?1
          ORDER BY rw.is_primary DESC,rw.confidence DESC,rw.last_seen_at DESC,rw.id DESC
          LIMIT ?2",
    )?;
    statement
        .query_map(params![run_id, limit as i64], |row| {
            Ok(RunWorktreeEvidenceRow {
                kind: row.get(0)?,
                source: row.get(1)?,
                trust: row.get(2)?,
                confidence: row.get(3)?,
                first_seen_at: row.get(4)?,
                last_seen_at: row.get(5)?,
                worktree_path: row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()
        .context("list run worktree evidence")
}

pub fn list_run_event_kinds(pool: &DbPool, run_id: i64) -> Result<Vec<String>> {
    let conn = pool.get()?;
    let mut statement = conn.prepare(
        "SELECT DISTINCT event_kind FROM agent_run_events WHERE run_id=?1 ORDER BY event_kind",
    )?;
    statement
        .query_map([run_id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()
        .context("list run event kinds")
}

/// The attribution relations for the commit most recently related to the run.
pub fn latest_run_commit(pool: &DbPool, run_id: i64) -> Result<Vec<AgentRunAttributedCommit>> {
    let latest: Option<i64> = pool
        .get()?
        .query_row(
            "SELECT commit_id FROM agent_run_commits WHERE run_id=?1
              ORDER BY last_seen_at DESC,id DESC LIMIT 1",
            [run_id],
            |row| row.get(0),
        )
        .optional()
        .context("find latest run commit")?;
    let Some(commit_id) = latest else {
        return Ok(Vec::new());
    };
    list_run_commit_attributions(pool, run_id, commit_id, 200)
}

pub fn latest_stream_cursor(pool: &DbPool) -> Result<i64> {
    pool.get()?
        .query_row(
            "SELECT COALESCE(MAX(id),0) FROM agent_stream_outbox",
            [],
            |row| row.get(0),
        )
        .context("read latest stream cursor")
}
