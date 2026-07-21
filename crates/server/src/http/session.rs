//! Session lifecycle handlers (admit / poll / release).
//!
//! Three endpoints model the Freebuff-shaped session lifecycle:
//!
//!   - `POST   /api/v1/freebuff/session`         — admit (returns
//!     `CoordinationSessionResponse`).
//!   - `GET    /api/v1/freebuff/session/:id`    — poll (same shape, may be
//!     `superseded` if another acting-user instance rotated us).
//!   - `DELETE /api/v1/freebuff/session/:id`    — release (returns 204).
//!
//! Bucket resolution (`occupyFreebuffDesktopSlot`-shaped) lives in [`bucket_for`]
//! below. We model only the structural coercion because the upstream
//! server-side admission gate (the real quota / country / ban logic) lives
//! at codebuff.com in the upstream system and is intentionally not
//! replicated here. Operators wanting equivalent admission controls should
//! plug those into [`bucket_for`] via the bridge config.

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;

use chrono::Utc;

use infinitecode_protocol::{
    CoordinationSessionBucket, CoordinationSessionRequest, CoordinationSessionResponse,
    CoordinationSessionStatus,
};

use crate::db_freebuff::{self, FreebuffSessionRow, parse_session_row_pub};
use crate::http::error::{BridgeError, BridgeResult};
use crate::http::HttpBridgeState;

/// `POST /api/v1/freebuff/session`.
///
/// Admit flow:
///   1. Pick a `CoordinationSessionBucket` based on the model +
///      `default_session_length_secs` config.
///   2. Atomically supersede any prior active session for the same
///      acting user, then insert the new row.
///   3. Return the freshly admitted row.
pub async fn admit(
    State(state): State<Arc<HttpBridgeState>>,
    Json(request): Json<CoordinationSessionRequest>,
) -> BridgeResult<(StatusCode, Json<CoordinationSessionResponse>)> {
    let bucket = bucket_for(&request.model, &state.bridge);
    let now = Utc::now();
    let length_ms = (state.bridge.default_session_length_secs as i64) * 1000;
    let expires_at = now + chrono::Duration::milliseconds(length_ms);
    let started_at_secs = now.timestamp();
    let expires_at_secs = Some(expires_at.timestamp());

    let conn = state.db.shared_conn();
    let mut conn = conn.lock().expect("database mutex poisoned");

    db_freebuff::supersede_and_admit(
        &mut conn,
        request.instance_id.as_str(),
        request.acting_user_id.as_str(),
        request.model.as_str(),
        bucket,
        started_at_secs,
        expires_at_secs,
        Some(length_ms),
        request.iso_country_code.as_deref(),
        request.device_fingerprint.as_deref(),
        request.app_version.as_deref(),
    )
    .map_err(|error| BridgeError::internal(format!("admit failed: {error}")))?;

    let row = db_freebuff::get_session(&conn, request.instance_id.as_str())
        .map_err(|error| BridgeError::internal(format!("read-after-write failed: {error}")))?
        .ok_or_else(|| BridgeError::internal("admit did not persist in database"))?;

    Ok((StatusCode::CREATED, Json(row.into_response())))
}

/// `GET /api/v1/freebuff/session/:instance_id`.
///
/// Returns the row as-is. If the caller's instance was rotated out, the
/// row will be in `superseded` state and we return 409 so the bridge
/// client surfaces the "Superseded" UI without polling repeatedly.
pub async fn read(
    State(state): State<Arc<HttpBridgeState>>,
    Path(instance_id): Path<String>,
) -> BridgeResult<Json<CoordinationSessionResponse>> {
    let row = fetch_row(&state, &instance_id)?;
    let response: CoordinationSessionResponse = row.into_response();
    if matches!(
        response.status,
        CoordinationSessionStatus::Superseded | CoordinationSessionStatus::CountryBlocked
    ) {
        // Surface 409 specifically for superseded rows so the bridge
        // client can fan-out a flush / re-admit; geographic blocks are
        // also surfaced as 409 because they're terminal-for-session and a
        // naive client would otherwise loop forever.
        return Err(BridgeError::session_superseded(response.instance_id.clone()));
    }
    Ok(Json(response))
}

/// `GET /api/v1/freebuff/session` (no instance path).
///
/// Roughly mirrors Freebuff's polling endpoint. We treat it as "current
/// active row for the supplied acting user" — the `acting_user_id` comes
/// from `x-freebuff-acting-user-id`.
pub async fn poll(
    State(state): State<Arc<HttpBridgeState>>,
    headers: axum::http::HeaderMap,
) -> BridgeResult<Json<CoordinationSessionResponse>> {
    let acting_user_id = headers
        .get("x-freebuff-acting-user-id")
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| BridgeError::bad_request("missing x-freebuff-acting-user-id header"))?;

    let conn = state.db.shared_conn();
    let conn = conn.lock().expect("database mutex poisoned");
    let maybe = conn
        .query_row(
            "SELECT instance_id, acting_user_id, model, bucket, status, time_remaining_ms,
                    started_at, expires_at, reason, iso_country_code, device_fingerprint, app_version
             FROM freebuff_sessions
             WHERE acting_user_id = ?1 AND status = 'active'
             ORDER BY started_at DESC LIMIT 1",
            rusqlite::params![acting_user_id],
            parse_session_row_pub,
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => BridgeError::bad_request(format!(
                "no active session for acting_user_id={acting_user_id}"
            )),
            other => BridgeError::internal(format!("poll query failed: {other}")),
        })?;

    Ok(Json(maybe.into_response()))
}

/// `DELETE /api/v1/freebuff/session/:instance_id`.
///
/// Marks the row ended. Returns 204 on success; 404 if the row does not
/// exist (no-op, mirrors Freebuff's idempotency).
pub async fn release(
    State(state): State<Arc<HttpBridgeState>>,
    Path(instance_id): Path<String>,
) -> BridgeResult<axum::response::Response> {
    let conn = state.db.shared_conn();
    let conn = conn.lock().expect("database mutex poisoned");
    let released = db_freebuff::release_session(&conn, &instance_id)
        .map_err(|error| BridgeError::internal(format!("release failed: {error}")))?;
    if !released {
        return Err(BridgeError::bad_request(format!(
            "no active session for instance_id={instance_id}"
        )));
    }
    Ok(StatusCode::NO_CONTENT.into_response())
}

fn fetch_row(state: &HttpBridgeState, instance_id: &str) -> BridgeResult<FreebuffSessionRow> {
    let conn = state.db.shared_conn();
    let conn = conn.lock().expect("database mutex poisoned");
    db_freebuff::get_session(&conn, instance_id)
        .map_err(|error| BridgeError::internal(format!("get-session failed: {error}")))?
        .ok_or_else(|| BridgeError::bad_request(format!("no session for instance_id={instance_id}")))
}

fn bucket_for(
    model: &str,
    bridge: &infinitecode_config::FreebuffBridgeConfig,
) -> CoordinationSessionBucket {
    if bridge.default_session_length_secs <= 0 {
        return CoordinationSessionBucket::Limited;
    }
    // Structural-only bucket resolution. Real admission gates (country
    // block, ownership-bans, rate-limit windows) are intentionally not
    // replicated here — operators plug their own upstream into the
    // bridge via additional config. We default to Premium for premium
    // picker models, Unlimited for the lighter tier.
    let premium_picker: &[&str] = &[
        "deepseek/deepseek-v4-pro",
        "mimo/mimo-v2.5-pro",
        "moonshotai/kimi-k2.7-code",
        "minimax/minimax-m3",
        "z-ai/glm-5.2",
        "tencent/hy3",
        "kwaipilot/kat-coder-pro-v2",
    ];
    if premium_picker.iter().any(|m| model == *m) {
        return CoordinationSessionBucket::Premium;
    }
    if model.is_empty() {
        // Caller passed empty model on a non-strict admit; default to
        // Unlimited so the slot policy doesn't kick in unnecessarily.
        return CoordinationSessionBucket::Unlimited;
    }
    CoordinationSessionBucket::Unlimited
}
