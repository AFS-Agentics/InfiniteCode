//! Bearer-token middleware + login.
//!
//! The bridge uses a shared-secret `InfiniteCodeBridgeConfig::password` to mint
//! opaque tokens on `POST /api/v1/auth/login`. Tokens are random URL-safe
//! strings whose SHA-256 hash (lowercase hex) lives in the
//! `infinitecode_bearer_tokens` table with created / expires timestamps.
//!
//! Why opaque tokens instead of JWTs: the runtime is a single operator's
//! binary, not a multi-tenant service. We don't need to verify claims
//! issued by other signers, so the simpler storage shape wins. JWTs would
//! also force a `jsonwebtoken` dependency and the signing-key management
//! that comes with them.
//!
//! Every other endpoint under `/api/v1/*` enforces the bearer via
//! [`require_bearer`] wired as an axum router layer from
//! [`crate::http::build_router`]. The healthz and login endpoints skip the
//! middleware.

use std::sync::Arc;

use axum::Json;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderValue, header};
use axum::middleware::Next;
use axum::response::Response;

use chrono::{Duration, Utc};
use rand::RngCore;

use infinitecode_protocol::{AuthLoginRequest, AuthLoginResponse};

use crate::db_infinitecode::{
    find_bearer_token, insert_bearer_token, prune_expired_bearer_tokens,
};
use crate::http::error::{BridgeError, BridgeResult};
use crate::http::HttpBridgeState;

/// True when the supplied `Authorization: Bearer …` header matches a
/// non-expired token in the infinitecode bearer table. Exposed for tests.
pub fn authenticate(header_value: Option<&str>, state: &HttpBridgeState) -> BridgeResult<()> {
    let token = match header_value.and_then(|value| value.strip_prefix("Bearer ")) {
        Some(rest) => rest,
        None => return Err(BridgeError::auth_required_or_invalid()),
    };

    let conn = state.db.shared_conn();
    let conn = conn.lock().expect("database mutex poisoned");
    let now = Utc::now();
    // Best-effort prune of expired tokens during auth so the table doesn't
    // grow unbounded for high-traffic operators. Cheap; safe even on a
    // freshly opened database.
    let _ = prune_expired_bearer_tokens(&conn, now.timestamp());

    match find_bearer_token(&conn, token)
        .map_err(|error| BridgeError::internal(format!("bearer lookup failed: {error}")))?
    {
        Some(record) if record.expires_at > now => Ok(()),
        Some(_) => Err(BridgeError::auth_invalid()),
        None => Err(BridgeError::auth_invalid()),
    }
}

/// Axum middleware: requires a valid bearer; on success, lets the request
/// fall through to the inner handler.
///
/// Wired in [`crate::http::build_router`] via
/// `Router::layer(from_fn_with_state(state.clone(), require_bearer))`.
pub async fn require_bearer(
    State(state): State<Arc<HttpBridgeState>>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, BridgeError> {
    let header_value = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok());
    authenticate(header_value, state.as_ref())?;
    Ok(next.run(request).await)
}

/// `POST /api/v1/auth/login`.
///
/// Validates the supplied password against `InfiniteCodeBridgeConfig::password`
/// and returns a freshly minted bearer. Operators can monitor
/// `INSERT INTO infinitecode_bearer_tokens` to track issued tokens.
pub async fn login(
    State(state): State<Arc<HttpBridgeState>>,
    Json(request): Json<AuthLoginRequest>,
) -> BridgeResult<Json<AuthLoginResponse>> {
    let configured = state.bridge.password.as_deref().ok_or_else(|| {
        use axum::http::StatusCode;
        // Bridge is bound but no password was provisioned. Treat as a
        // server misconfiguration rather than a missing credential.
        BridgeError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            infinitecode_protocol::CoordinationErrorBody::INTERNAL,
            "infinitecode bridge is enabled but no password was provisioned (set INFINITECODE_BRIDGE_PASSWORD or [infinitecode_bridge].password in config.toml).",
        )
    })?;
    if !constant_time_eq(request.password.as_str(), configured) {
        return Err(BridgeError::auth_invalid());
    }

    let mut buf = [0u8; 32];
    rand::rng().fill_bytes(&mut buf);
    let token = base64::Engine::encode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        buf,
    );

    let now = Utc::now();
    let expires_at = now + Duration::seconds(state.bridge.token_ttl_secs as i64);
    let conn = state.db.shared_conn();
    let conn = conn.lock().expect("database mutex poisoned");
    insert_bearer_token(&conn, &token, now.timestamp(), expires_at.timestamp())
        .map_err(|error| BridgeError::internal(format!("token insert failed: {error}")))?;

    Ok(Json(AuthLoginResponse {
        token: token.into(),
        expires_at: expires_at.timestamp(),
    }))
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Tiny helper used in tests for header construction.
#[allow(dead_code)]
pub fn bearer_header(token: &str) -> HeaderValue {
    HeaderValue::from_str(&format!("Bearer {token}")).expect("bearer header")
}
