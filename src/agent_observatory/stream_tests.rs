use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;

use super::*;
use crate::config::{AgentObservatoryStreamConfig, StorageConfig};
use crate::db::{DbPool, init_pool};

struct Fixture {
    service: CortexService,
    pool: Arc<DbPool>,
    _dir: tempfile::TempDir,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let storage = StorageConfig::for_test(dir.path().join("stream.db"));
    let pool = Arc::new(init_pool(&storage).unwrap());
    pool.get()
        .unwrap()
        .execute_batch(
            "INSERT INTO agent_runs
                (id,run_key,native_session_id,tool,hostname,status,status_observed_at,started_at,last_activity_at)
             VALUES (1,'run-one','a','codex','host','active','2026-09-02T12:00:00Z','2026-09-02T12:00:00Z','2026-09-02T12:00:00Z'),
                    (2,'run-two','b','codex','host','active','2026-09-02T12:00:00Z','2026-09-02T12:00:00Z','2026-09-02T12:00:00Z');
             INSERT INTO repositories
                (id,repository_key,hostname,common_git_dir,primary_path,display_name,first_seen_at,last_seen_at)
             VALUES (5,'repo','host','/w/.git','/w','w','2026-09-02T12:00:00Z','2026-09-02T12:00:00Z');
             INSERT INTO repository_worktrees
                (id,worktree_key,repository_id,hostname,path,git_dir,first_seen_at,last_seen_at)
             VALUES (7,'wt',5,'host','/w','/w/.git','2026-09-02T12:00:00Z','2026-09-02T12:00:00Z');
             INSERT INTO agent_run_worktrees
                (relation_key,run_id,worktree_id,evidence_kind,evidence_source,trust_level,confidence,first_seen_at,last_seen_at)
             VALUES ('rel',2,7,'cwd','transcript','verified',1.0,'2026-09-02T12:00:00Z','2026-09-02T12:00:00Z');",
        )
        .unwrap();
    Fixture {
        service: CortexService::new(Arc::clone(&pool), storage),
        pool,
        _dir: dir,
    }
}

impl Fixture {
    fn emit(&self, run_id: i64, count: usize) {
        let conn = self.pool.get().unwrap();
        for _ in 0..count {
            conn.execute(
                "INSERT INTO agent_stream_outbox(outbox_key,run_id,stream_event_type,expires_at,payload_json)
                 VALUES (lower(hex(randomblob(16))),?1,'run.event','2999-01-01T00:00:00Z','{\"n\":1}')",
                [run_id],
            )
            .unwrap();
        }
    }

    fn execute(&self, sql: &str) {
        self.pool.get().unwrap().execute_batch(sql).unwrap();
    }
}

fn hub(adjust: impl FnOnce(&mut AgentObservatoryStreamConfig)) -> StreamHub {
    let mut config = AgentObservatoryStreamConfig::default();
    adjust(&mut config);
    StreamHub::new(&config).with_timing(Duration::from_millis(10), Duration::from_millis(200))
}

async fn next(subscription: &mut Subscription) -> Frame {
    tokio::time::timeout(Duration::from_secs(5), subscription.next())
        .await
        .expect("frame before timeout")
        .expect("stream still open")
}

async fn idle(subscription: &mut Subscription) -> bool {
    tokio::time::timeout(Duration::from_millis(80), subscription.next())
        .await
        .is_err()
}

async fn assert_reset(subscription: &mut Subscription, reason: &str) {
    let frame = next(subscription).await;
    assert_eq!(frame.event, "observatory.reset");
    let data: Value = serde_json::from_str(&frame.data).unwrap();
    assert_eq!(data["id"], frame.id);
    assert_eq!(data["data"]["reason"], reason);
    assert!(subscription.next().await.is_none(), "reset ends the stream");
}

#[tokio::test]
async fn replay_then_live_delivers_each_event_once() {
    let fx = fixture();
    fx.emit(1, 3);
    let mut stream = hub(|_| {})
        .subscribe(fx.service.clone(), Some(1), Filter::default())
        .unwrap();
    for expected in ["2", "3"] {
        let frame = next(&mut stream).await;
        assert_eq!(frame.id, expected);
        assert_eq!(frame.event, "run.event");
        let data: Value = serde_json::from_str(&frame.data).unwrap();
        assert_eq!(data["id"], expected);
        assert_eq!(data["run_key"], "run-one");
        assert_eq!(data["entity_type"], "run");
        assert_eq!(data["data"]["n"], 1);
    }
    assert!(idle(&mut stream).await);
    fx.emit(1, 1);
    assert_eq!(next(&mut stream).await.id, "4");
    assert!(idle(&mut stream).await);
}

#[tokio::test]
async fn without_a_cursor_only_new_events_are_sent() {
    let fx = fixture();
    fx.emit(1, 2);
    let mut stream = hub(|_| {})
        .subscribe(fx.service.clone(), None, Filter::default())
        .unwrap();
    assert!(idle(&mut stream).await);
    fx.emit(1, 1);
    assert_eq!(next(&mut stream).await.id, "3");
}

#[tokio::test]
async fn filters_limit_events_to_a_run_repository_or_worktree() {
    let fx = fixture();
    fx.emit(1, 1);
    fx.emit(2, 1);
    for filter in [
        Filter {
            run_key: Some("run-two".into()),
            ..Default::default()
        },
        Filter {
            repository_id: Some(5),
            ..Default::default()
        },
        Filter {
            worktree_id: Some(7),
            ..Default::default()
        },
    ] {
        let mut stream = hub(|_| {})
            .subscribe(fx.service.clone(), Some(0), filter)
            .unwrap();
        assert_eq!(next(&mut stream).await.id, "2");
        assert!(idle(&mut stream).await);
    }
}

#[tokio::test]
async fn a_cursor_ahead_of_the_outbox_is_unknown() {
    let fx = fixture();
    fx.emit(1, 1);
    let mut stream = hub(|_| {})
        .subscribe(fx.service.clone(), Some(50), Filter::default())
        .unwrap();
    assert_reset(&mut stream, "cursor_unknown").await;
}

#[tokio::test]
async fn aged_out_or_deleted_history_expires_the_cursor() {
    let fx = fixture();
    fx.emit(1, 3);
    fx.execute("UPDATE agent_stream_outbox SET created_at='2000-01-01T00:00:00.000Z' WHERE id<=2");
    let mut stream = hub(|_| {})
        .subscribe(fx.service.clone(), Some(0), Filter::default())
        .unwrap();
    assert_reset(&mut stream, "cursor_expired").await;
    // Everything after cursor 2 is still inside retention.
    let mut stream = hub(|_| {})
        .subscribe(fx.service.clone(), Some(2), Filter::default())
        .unwrap();
    assert_eq!(next(&mut stream).await.id, "3");

    fx.execute("DELETE FROM agent_stream_outbox");
    let mut stream = hub(|_| {})
        .subscribe(fx.service.clone(), Some(1), Filter::default())
        .unwrap();
    assert_reset(&mut stream, "cursor_expired").await;
}

#[tokio::test]
async fn too_much_replay_asks_the_client_to_resynchronise() {
    let fx = fixture();
    fx.emit(1, 4);
    let mut stream = hub(|config| config.replay_limit = 3)
        .subscribe(fx.service.clone(), Some(0), Filter::default())
        .unwrap();
    assert_reset(&mut stream, "replay_limit_exceeded").await;
    let mut stream = hub(|config| config.replay_limit = 3)
        .subscribe(fx.service.clone(), Some(1), Filter::default())
        .unwrap();
    assert_eq!(next(&mut stream).await.id, "2");
}

#[tokio::test]
async fn a_slow_client_is_reset_while_a_fast_client_receives_the_burst() {
    let fx = fixture();
    let hub = hub(|config| config.client_queue = 8);
    let mut fast = hub
        .subscribe(fx.service.clone(), None, Filter::default())
        .unwrap();
    let mut slow = hub
        .subscribe(fx.service.clone(), None, Filter::default())
        .unwrap();
    // Let both capture the empty starting position.
    assert!(idle(&mut fast).await);
    assert!(idle(&mut slow).await);
    fx.emit(1, 500);
    for expected in 1..=500 {
        assert_eq!(next(&mut fast).await.id, expected.to_string());
    }
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_reset(&mut slow, "subscriber_lagged").await;
}

#[tokio::test]
async fn client_slots_are_bounded_and_released_on_drop() {
    let fx = fixture();
    let hub = hub(|config| config.max_clients = 1);
    let first = hub
        .subscribe(fx.service.clone(), None, Filter::default())
        .unwrap();
    assert!(
        hub.subscribe(fx.service.clone(), None, Filter::default())
            .is_none()
    );
    drop(first);
    assert!(
        hub.subscribe(fx.service.clone(), None, Filter::default())
            .is_some()
    );
}

#[tokio::test]
async fn oversized_payloads_are_replaced_with_a_marker() {
    let fx = fixture();
    fx.emit(1, 1);
    fx.execute(
        "UPDATE agent_stream_outbox SET payload_json=json_object('big',hex(zeroblob(4000)))",
    );
    let mut stream = hub(|config| config.max_event_bytes = 1024)
        .subscribe(fx.service.clone(), Some(0), Filter::default())
        .unwrap();
    let frame = next(&mut stream).await;
    assert!(frame.data.len() <= 1024);
    let data: Value = serde_json::from_str(&frame.data).unwrap();
    assert_eq!(data["data"], serde_json::json!({"truncated": true}));
}
