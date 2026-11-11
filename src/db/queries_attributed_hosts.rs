//! Indexed per-device log reads without materializing a device's history.

use super::*;

pub(super) fn search(
    conn: &rusqlite::Connection,
    params: &SearchParams,
    limit: u32,
) -> Result<Vec<LogEntry>> {
    let mut statement = conn.prepare(&super::super::queries_hosts::host_alias_select("?1"))?;
    let aliases = statement
        .query_map([params.host.as_deref().expect("device filter")], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut rows = Vec::new();
    for alias in aliases {
        for attributed in [false, true] {
            if attributed && !super::super::host_attribution::device_claim_allowed(conn, &alias)? {
                continue;
            }
            let (sql, bindings) = query_sql(params, &alias, limit, attributed);
            rows.extend(
                conn.prepare(&sql)?
                    .query_map(rusqlite::params_from_iter(bindings.iter()), |row| {
                        map_attributed_row(conn, row)
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?,
            );
        }
    }
    rows.sort_unstable_by(|a, b| b.timestamp.cmp(&a.timestamp).then_with(|| b.id.cmp(&a.id)));
    let mut seen = std::collections::HashSet::new();
    rows.retain(|row| seen.insert(row.id));
    rows.truncate(limit as usize);
    Ok(rows)
}

/// A host plus severity-set read (e.g. `tail host=X severity_min=error`) cannot
/// walk `idx_logs_host_time` newest-first and filter on severity: when the host
/// has few or no rows at that severity the walk visits every row the host ever
/// wrote (a 513k-row host took 26-85 s to return nothing). Probe
/// `idx_logs_sev_host_time` once per severity instead, each arm bounded by its
/// own LIMIT, then merge. Only used for the direct (non-attributed) branch
/// with no FTS query and no single-severity filter, so the arms stay
/// equivalent to the generic `severity IN (...)` query.
fn severity_split_applies(params: &SearchParams, attributed: bool) -> bool {
    !attributed
        && params.query.is_none()
        && params.severity.is_none()
        && params
            .severity_in
            .as_ref()
            .is_some_and(|levels| !levels.is_empty())
}

fn severity_split_sql(
    params: &SearchParams,
    hostname: &str,
    limit: u32,
) -> (String, Vec<rusqlite::types::Value>) {
    let mut bindings = vec![rusqlite::types::Value::Text(hostname.to_string())];
    let mut idx = 2;
    let mut seen = std::collections::HashSet::new();
    let mut arms = Vec::new();
    for level in params.severity_in.as_deref().unwrap_or_default() {
        if !seen.insert(level.as_str()) {
            continue;
        }
        let mut filters = params.clone();
        filters.host = None;
        filters.severity = Some(level.clone());
        filters.severity_in = None;
        let mut arm = format!(
            "SELECT * FROM (SELECT {FTS_SELECT_COLS} FROM logs l \
             INDEXED BY idx_logs_sev_host_time WHERE l.hostname=?1"
        );
        append_filters(&mut arm, &mut bindings, &mut idx, &filters);
        arm.push_str(" ORDER BY l.timestamp DESC,l.id DESC");
        push_bound_limit(&mut arm, &mut bindings, &mut idx, "LIMIT", limit);
        arm.push(')');
        arms.push(arm);
    }
    let mut sql = arms.join(" UNION ALL ");
    sql.push_str(" ORDER BY timestamp DESC,id DESC");
    push_bound_limit(&mut sql, &mut bindings, &mut idx, "LIMIT", limit);
    (sql, bindings)
}

pub(super) fn query_sql(
    params: &SearchParams,
    hostname: &str,
    limit: u32,
    attributed: bool,
) -> (String, Vec<rusqlite::types::Value>) {
    if severity_split_applies(params, attributed) {
        return severity_split_sql(params, hostname, limit);
    }
    let mut sql = if attributed {
        let guard = super::super::host_attribution::projected_host_guard("a.hostname");
        format!(
            "SELECT {FTS_SELECT_COLS} FROM forwarded_log_hosts a
                 INDEXED BY idx_forwarded_log_hosts_host_time CROSS JOIN logs l
                 WHERE a.hostname=?1 AND l.id=a.log_id AND {guard}"
        )
    } else {
        let index = if host_only_search(params) {
            " INDEXED BY idx_logs_host_time"
        } else {
            ""
        };
        format!("SELECT {FTS_SELECT_COLS} FROM logs l{index} WHERE l.hostname=?1")
    };
    let mut bindings = vec![rusqlite::types::Value::Text(hostname.to_string())];
    let mut idx = 2;
    let mut filters = params.clone();
    filters.host = None;
    append_filters(&mut sql, &mut bindings, &mut idx, &filters);
    if let Some(query) = params.query.as_deref() {
        sql.push_str(&format!(
            " AND l.id IN (
            SELECT rowid FROM logs_fts WHERE logs_fts MATCH ?{idx}
            ORDER BY rowid DESC LIMIT {SEARCH_FTS_FAST_PATH_MATCH_CAP})"
        ));
        bindings.push(rusqlite::types::Value::Text(query.to_string()));
        idx += 1;
    }
    sql.push_str(if attributed {
        " ORDER BY a.timestamp DESC,a.log_id DESC"
    } else {
        " ORDER BY l.timestamp DESC,l.id DESC"
    });
    push_bound_limit(&mut sql, &mut bindings, &mut idx, "LIMIT", limit);
    (sql, bindings)
}
