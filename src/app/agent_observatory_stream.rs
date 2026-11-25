//! Outbox reads used by the Agent Observatory stream.

use super::{CortexService, ServiceResult};
use crate::db::agent_observatory as ao;

impl CortexService {
    pub async fn observatory_outbox_page(
        &self,
        after: Option<i64>,
        filter: ao::OutboxFilter,
        cutoff: String,
        limit: usize,
    ) -> ServiceResult<ao::OutboxPage> {
        self.run_db("observatory.outbox", move |pool| {
            ao::outbox_page(pool, after, &filter, &cutoff, limit)
        })
        .await
    }
}
