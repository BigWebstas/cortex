//! Read side of the durable Agent Observatory stream outbox.

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, params_from_iter, types::Value};

use crate::db::pool::DbPool;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OutboxFilter {
    pub run_key: Option<String>,
    pub repository_id: Option<i64>,
    pub worktree_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboxStreamRow {
    pub id: i64,
    pub event_name: String,
    pub run_key: String,
    pub payload_json: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutboxCursorState {
    Current,
    /// History after the cursor has aged out or been deleted.
    Expired,
    /// The cursor is beyond anything this database has issued.
    Unknown,
}

#[derive(Debug, Clone)]
pub struct OutboxPage {
    pub state: OutboxCursorState,
    /// Newest ID issued before `rows` was read.
    pub head: i64,
    pub rows: Vec<OutboxStreamRow>,
}

/// Newest ID ever issued, which survives deletion of the rows themselves.
pub fn latest_outbox_id(connection: &Connection) -> Result<i64> {
    connection
        .query_row(
            "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='agent_stream_outbox'),0)",
            [],
            |row| row.get(0),
        )
        .context("read latest outbox ID")
}

fn cursor_state(
    connection: &Connection,
    after: i64,
    head: i64,
    cutoff: &str,
) -> Result<OutboxCursorState> {
    if after > head {
        return Ok(OutboxCursorState::Unknown);
    }
    if after == head {
        return Ok(OutboxCursorState::Current);
    }
    let oldest: Option<i64> =
        connection.query_row("SELECT MIN(id) FROM agent_stream_outbox", [], |row| {
            row.get(0)
        })?;
    if oldest.is_none_or(|oldest| after < oldest - 1) {
        return Ok(OutboxCursorState::Expired);
    }
    // `created_at` rises with the ID, so checking the first unseen row is
    // enough. `expires_at` follows source time and would not be monotonic.
    let aged: Option<bool> = connection
        .query_row(
            "SELECT created_at <= ?2 FROM agent_stream_outbox WHERE id > ?1 ORDER BY id LIMIT 1",
            rusqlite::params![after, cutoff],
            |row| row.get(0),
        )
        .optional()?;
    Ok(if aged == Some(true) {
        OutboxCursorState::Expired
    } else {
        OutboxCursorState::Current
    })
}

/// Rows after `after` in ascending ID order. `after = None` starts at the head.
pub fn outbox_page(
    pool: &DbPool,
    after: Option<i64>,
    filter: &OutboxFilter,
    cutoff: &str,
    limit: usize,
) -> Result<OutboxPage> {
    let connection = pool.get()?;
    let head = latest_outbox_id(&connection)?;
    let Some(after) = after else {
        return Ok(OutboxPage {
            state: OutboxCursorState::Current,
            head,
            rows: Vec::new(),
        });
    };
    let state = cursor_state(&connection, after, head, cutoff)?;
    if state != OutboxCursorState::Current {
        return Ok(OutboxPage {
            state,
            head,
            rows: Vec::new(),
        });
    }
    let mut sql = "SELECT o.id,o.stream_event_type,r.run_key,o.payload_json,o.created_at
        FROM agent_stream_outbox o JOIN agent_runs r ON r.id=o.run_id WHERE o.id > ?"
        .to_string();
    let mut values = vec![Value::from(after)];
    if let Some(run_key) = &filter.run_key {
        sql.push_str(" AND r.run_key = ?");
        values.push(run_key.clone().into());
    }
    if let Some(id) = filter.worktree_id {
        sql.push_str(
            " AND EXISTS(SELECT 1 FROM agent_run_worktrees rw
                WHERE rw.run_id=o.run_id AND rw.worktree_id=?)",
        );
        values.push(id.into());
    }
    if let Some(id) = filter.repository_id {
        sql.push_str(
            " AND EXISTS(SELECT 1 FROM agent_run_worktrees rw
                JOIN repository_worktrees w ON w.id=rw.worktree_id
                WHERE rw.run_id=o.run_id AND w.repository_id=?)",
        );
        values.push(id.into());
    }
    sql.push_str(" ORDER BY o.id LIMIT ?");
    values.push((limit as i64).into());
    let rows = connection
        .prepare(&sql)?
        .query_map(params_from_iter(values), |row| {
            Ok(OutboxStreamRow {
                id: row.get(0)?,
                event_name: row.get(1)?,
                run_key: row.get(2)?,
                payload_json: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()
        .context("read stream outbox")?;
    Ok(OutboxPage { state, head, rows })
}
