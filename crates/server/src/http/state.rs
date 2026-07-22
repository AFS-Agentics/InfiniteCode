//! Shared state for the InfiniteCode-shaped HTTP bridge.
//!
//! Every handler receives this via `axum::extract::State<HttpBridgeState>`.
//! The state owns:
//!
//!   - The shared [`crate::db::Database`] (single `Arc` to the SQLite
//!     connection pool, same one the canonical runtime sessions use).
//!   - A snapshot of the operator-applied `InfiniteCodeBridgeConfig` (HTTP-bind
//!     configuration is kept at the listener level).
//!   - The process startup instant for uptime reporting in `/api/healthz`.
//!   - Process counters for the no-op ad endpoints.
//!
//! The state object is intentionally tiny — read paths that touch the
//! bridge don't have to walk through any other warm-up loop. The handlers
//! are the only ones that go through this state; they then call into
//! [`crate::db_infinitecode`] for persistence.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use crate::db::Database;

pub struct HttpBridgeState {
    pub db: Arc<Database>,
    pub bridge: infinitecode_config::InfiniteCodeBridgeConfig,
    pub started_at: Instant,
    /// Total `POST /api/v1/ads/impression` calls served.
    pub ad_impressions_total: AtomicU64,
    /// Total `POST /api/v1/ads/click` calls served.
    pub ad_clicks_total: AtomicU64,
    /// Total `POST /api/v1/ads` auctions served (regardless of whether
    /// they returned an ad).
    pub ad_auctions_total: AtomicU64,
}

impl HttpBridgeState {
    pub fn new(
        db: Arc<Database>,
        bridge: infinitecode_config::InfiniteCodeBridgeConfig,
        started_at: Instant,
    ) -> Arc<Self> {
        Arc::new(Self {
            db,
            bridge,
            started_at,
            ad_impressions_total: AtomicU64::new(0),
            ad_clicks_total: AtomicU64::new(0),
            ad_auctions_total: AtomicU64::new(0),
        })
    }

    pub fn record_auction(&self) {
        self.ad_auctions_total.fetch_add(1, Ordering::Relaxed);
    }
    pub fn record_impression(&self) {
        self.ad_impressions_total.fetch_add(1, Ordering::Relaxed);
    }
    pub fn record_click(&self) {
        self.ad_clicks_total.fetch_add(1, Ordering::Relaxed);
    }
    pub fn uptime_secs(&self) -> u64 {
        self.started_at.elapsed().as_secs()
    }
}
