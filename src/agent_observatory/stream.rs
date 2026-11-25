//! Replay-then-live delivery of the Agent Observatory outbox.
//!
//! Each subscriber has its own task that reads the database and feeds a bounded
//! queue. Nothing is published to subscribers, so a slow one cannot delay the
//! projector or any other client.

use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use chrono::{SecondsFormat, Utc};
use serde_json::{Value, json};
use tokio::sync::{OwnedSemaphorePermit, Semaphore, mpsc};
use tokio::time::Instant;

use crate::app::CortexService;
use crate::config::AgentObservatoryStreamConfig;
use crate::db::agent_observatory as ao;

pub use ao::OutboxFilter as Filter;

const POLL_INTERVAL: Duration = Duration::from_secs(1);
const LAG_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_CONNECTION: Duration = Duration::from_secs(15 * 60);
const NOT_LAGGED: i64 = -1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ResetReason {
    CursorExpired,
    CursorUnknown,
    ReplayLimitExceeded,
    SubscriberLagged,
}

impl ResetReason {
    fn as_str(self) -> &'static str {
        match self {
            Self::CursorExpired => "cursor_expired",
            Self::CursorUnknown => "cursor_unknown",
            Self::ReplayLimitExceeded => "replay_limit_exceeded",
            Self::SubscriberLagged => "subscriber_lagged",
        }
    }
}

/// One server-sent event: `id` always equals the envelope's `id`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub id: String,
    pub event: String,
    pub data: String,
}

#[derive(Debug, Clone, Copy)]
struct Settings {
    retention: Duration,
    replay_limit: usize,
    client_queue: usize,
    max_event_bytes: usize,
    poll_interval: Duration,
    lag_timeout: Duration,
}

/// Shared limits and client slots for the observatory stream.
#[derive(Debug, Clone)]
pub struct StreamHub {
    settings: Settings,
    clients: Arc<Semaphore>,
    keepalive: Duration,
}

impl StreamHub {
    pub fn new(config: &AgentObservatoryStreamConfig) -> Self {
        Self {
            settings: Settings {
                retention: Duration::from_secs(config.outbox_retention_secs),
                replay_limit: config.replay_limit,
                client_queue: config.client_queue.max(1),
                max_event_bytes: config.max_event_bytes,
                poll_interval: POLL_INTERVAL,
                lag_timeout: LAG_TIMEOUT,
            },
            clients: Arc::new(Semaphore::new(config.max_clients)),
            keepalive: Duration::from_secs(config.keepalive_secs),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_timing(mut self, poll_interval: Duration, lag_timeout: Duration) -> Self {
        self.settings.poll_interval = poll_interval;
        self.settings.lag_timeout = lag_timeout;
        self
    }

    pub fn keepalive(&self) -> Duration {
        self.keepalive
    }

    /// Returns `None` when every client slot is in use.
    pub fn subscribe(
        &self,
        service: CortexService,
        after: Option<i64>,
        filter: Filter,
    ) -> Option<Subscription> {
        let permit = Arc::clone(&self.clients).try_acquire_owned().ok()?;
        let (sender, receiver) = mpsc::channel(self.settings.client_queue);
        let lagged_at = Arc::new(AtomicI64::new(NOT_LAGGED));
        let producer = Producer {
            service,
            settings: self.settings,
            filter,
            sender,
            lagged_at: Arc::clone(&lagged_at),
        };
        tokio::spawn(producer.run(after));
        Some(Subscription {
            receiver,
            lagged_at,
            finished: false,
            _permit: permit,
        })
    }
}

#[derive(Debug)]
pub struct Subscription {
    receiver: mpsc::Receiver<Frame>,
    lagged_at: Arc<AtomicI64>,
    finished: bool,
    _permit: OwnedSemaphorePermit,
}

impl Subscription {
    /// The next frame, or `None` once the stream has ended.
    pub async fn next(&mut self) -> Option<Frame> {
        if self.finished {
            return None;
        }
        let queued = if self.lagged_at.load(Ordering::Acquire) == NOT_LAGGED {
            self.receiver.recv().await
        } else {
            None
        };
        let lagged_at = self.lagged_at.load(Ordering::Acquire);
        if lagged_at != NOT_LAGGED {
            // Queued frames are dropped: the client must take a new snapshot.
            self.finished = true;
            return Some(reset_frame(ResetReason::SubscriberLagged, lagged_at));
        }
        self.finished = queued.is_none();
        queued
    }
}

struct Producer {
    service: CortexService,
    settings: Settings,
    filter: Filter,
    sender: mpsc::Sender<Frame>,
    lagged_at: Arc<AtomicI64>,
}

impl Producer {
    async fn run(self, after: Option<i64>) {
        let deadline = Instant::now() + MAX_CONNECTION;
        let mut position = after;
        // The first read of a resumed stream is the replay, which is capped.
        let mut replaying = after.is_some();
        while Instant::now() < deadline {
            let limit = if replaying {
                self.settings.replay_limit.saturating_add(1)
            } else {
                self.settings.client_queue
            };
            let cutoff =
                (Utc::now() - self.settings.retention).to_rfc3339_opts(SecondsFormat::Millis, true);
            let page = match self
                .service
                .observatory_outbox_page(position, self.filter.clone(), cutoff, limit)
                .await
            {
                Ok(page) => page,
                Err(error) => {
                    // The client reconnects with its last event ID.
                    tracing::warn!(%error, "agent observatory stream read failed");
                    return;
                }
            };
            let reset = match page.state {
                ao::OutboxCursorState::Expired => Some(ResetReason::CursorExpired),
                ao::OutboxCursorState::Unknown => Some(ResetReason::CursorUnknown),
                ao::OutboxCursorState::Current
                    if replaying && page.rows.len() > self.settings.replay_limit =>
                {
                    Some(ResetReason::ReplayLimitExceeded)
                }
                ao::OutboxCursorState::Current => None,
            };
            if let Some(reason) = reset {
                let _ = self.send(reset_frame(reason, page.head), page.head).await;
                return;
            }
            let full = page.rows.len() >= limit;
            for row in page.rows {
                position = Some(row.id);
                let frame = event_frame(row, self.settings.max_event_bytes);
                if !self.send(frame, page.head).await {
                    return;
                }
            }
            replaying = false;
            if full {
                continue;
            }
            // Everything up to the head has been considered, including rows the
            // filter excluded, so a quiet filtered stream does not expire.
            position = Some(position.map_or(page.head, |seen| seen.max(page.head)));
            tokio::select! {
                () = tokio::time::sleep(self.settings.poll_interval) => {}
                () = self.sender.closed() => return,
            }
        }
    }

    /// Queues one frame, giving up if the client stops draining its queue.
    async fn send(&self, frame: Frame, head: i64) -> bool {
        match tokio::time::timeout(self.settings.lag_timeout, self.sender.send(frame)).await {
            Ok(result) => result.is_ok(),
            Err(_) => {
                self.lagged_at.store(head, Ordering::Release);
                false
            }
        }
    }
}

fn envelope(
    id: &str,
    event: &str,
    entity_type: &str,
    entity_key: &str,
    run_key: Option<&str>,
    occurred_at: &str,
    data: Value,
) -> String {
    json!({
        "id": id,
        "event": event,
        "entity_type": entity_type,
        "entity_key": entity_key,
        "run_key": run_key,
        "occurred_at": occurred_at,
        "data": data,
    })
    .to_string()
}

fn event_frame(row: ao::OutboxStreamRow, max_event_bytes: usize) -> Frame {
    let id = row.id.to_string();
    // An SSE event name cannot span lines.
    let event = if row.event_name.contains(['\r', '\n']) {
        "run.updated".to_string()
    } else {
        row.event_name
    };
    let build = |data| {
        envelope(
            &id,
            &event,
            "run",
            &row.run_key,
            Some(&row.run_key),
            &row.created_at,
            data,
        )
    };
    let payload = serde_json::from_str(&row.payload_json)
        .ok()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}));
    let mut data = build(payload);
    if data.len() > max_event_bytes {
        data = build(json!({"truncated": true}));
    }
    Frame { id, event, data }
}

fn reset_frame(reason: ResetReason, head: i64) -> Frame {
    let id = head.to_string();
    let event = "observatory.reset";
    let data = envelope(
        &id,
        event,
        "observatory",
        "stream",
        None,
        &Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        json!({"reason": reason.as_str()}),
    );
    Frame {
        id,
        event: event.to_string(),
        data,
    }
}

#[cfg(test)]
#[path = "stream_tests.rs"]
mod tests;
