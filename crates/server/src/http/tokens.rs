//! Token-count proxy handler.
//!
//! `POST /api/v1/token-count` mirrors the InfiniteCode-side proxy to Anthropic
//! `count_tokens`. The agent normally uses this on the paid Codebuff
//! tier; in free mode the runtime switches to the local tiktoken-shaped
//! estimate so the per-step round-trip overhead + 1M+ web services
//! requests/day don't bite.
//!
//! Default behaviour: 501 NOT_IMPLEMENTED. Operators plug in an upstream
//! via the bridge config (out of scope for this stub).

use std::sync::Arc;

use axum::Json;
use axum::extract::State;

use infinitecode_protocol::{TokenCountRequest, TokenCountResponse};

use crate::http::error::{BridgeError, BridgeResult};
use crate::http::HttpBridgeState;

pub async fn token_count(
    State(_state): State<Arc<HttpBridgeState>>,
    Json(request): Json<TokenCountRequest>,
) -> BridgeResult<Json<TokenCountResponse>> {
    // Cheap no-op sanity that the request has *something* message-shaped
    // even though we don't proxy to Anthropic yet. Operators who wire in
    // an upstream can use `request.messages` / `request.system` /
    // `request.model` / `request.tools` directly.
    if !request.messages.is_object() && !request.messages.is_array() {
        return Err(BridgeError::bad_request(
            "request.messages must be a JSON object or array",
        ));
    }
    Err(BridgeError::not_implemented(
        "infinitecode /api/v1/token-count upstream is not wired in this build. \
         Agents should fall back to the local token estimate (see \
         infinitecode.provider.TokenCountBackend::estimate_local).",
    ))
}
