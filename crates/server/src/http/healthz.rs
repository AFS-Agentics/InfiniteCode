//! Liveness handler. Reports uptime, version, and the static `status: ok`.
//!
//! This endpoint is intentionally cheap and does not require auth: it is the
//! canonical first ping for orchestrators, healthz containers, and reverse
//! proxies. The endpoint does **not** verify SQLite connectivity because
//! doing so on every healthz call would conflict with the existing
//! `Database::shared_conn` lock discipline (we don't `await` while holding
//! the lock).

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use chrono::Utc;

use infinitecode_protocol::HealthzResponse;
use smol_str::SmolStr;

use crate::http::HttpBridgeState;

pub async fn handler(State(state): State<Arc<HttpBridgeState>>) -> Json<HealthzResponse> {
    let response = HealthzResponse {
        status: SmolStr::new("ok"),
        version: SmolStr::new(env!("CARGO_PKG_VERSION")),
        uptime_secs: state.uptime_secs(),
    };
    tracing::debug!(
        uptime_secs = response.uptime_secs,
        checked_at = %Utc::now(),
        "freebuff healthz served",
    );
    Json(response)
}
