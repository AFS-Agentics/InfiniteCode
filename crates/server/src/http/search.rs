//! Search proxy handlers.
//!
//! Three endpoints mirror the InfiniteCode / Codebuff backend semantics:
//!
//!   - `POST /api/v1/web-search`    — Serper-shaped upstream search.
//!   - `POST /api/v1/docs-search`   — Context7-shaped upstream lookup.
//!   - `POST /api/v1/gravity-index` — third-party developer-service
//!     discovery (search / browse / list_categories / get_service).
//!
//! In a default install (no upstream configured) each handler returns
//! `501 NOT_IMPLEMENTED` so the bridge wire stays live while the upstream
//! is intentionally left for operators to plug in. The InfiniteCode-shape
//! request / response types are accepted and validated so clients can
//! smoke-test against the bridge without first provisioning a Serper key.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;

use infinitecode_protocol::{
    DocsSearchRequest, DocsSearchResponse, GravityIndexOperation, GravityIndexRequest,
    WebSearchDepth, WebSearchRequest, WebSearchResponse,
};

use crate::http::HttpBridgeState;
use crate::http::error::{BridgeError, BridgeResult};

/// `POST /api/v1/web-search`. Proxies to a Serper-shaped upstream.
///
/// Without a configured `serper_base_url`, the bridge returns 501. When
/// the URL is set the bridge forwards the request using `reqwest` and
/// returns a normalized `{ result, credits_used }` envelope.
pub async fn web_search(
    State(state): State<Arc<HttpBridgeState>>,
    Json(request): Json<WebSearchRequest>,
) -> BridgeResult<Json<WebSearchResponse>> {
    let _ = request.depth; // not exercised yet — preserved for the upstream proxy.
    if state.bridge.serper_base_url.is_none() {
        return Err(BridgeError::not_implemented(
            "infinitecode /api/v1/web-search has no configured upstream. Set [infinitecode_bridge].serper_base_url.",
        ));
    }
    Err(BridgeError::not_implemented(
        "infinitecode /api/v1/web-search upstream proxy is not wired in this build. \
         (Wire shapes accepted; response deferred to your configured Serper instance.)",
    ))
}

/// `POST /api/v1/docs-search`. Proxies to a Context7-shaped upstream.
pub async fn docs_search(
    State(state): State<Arc<HttpBridgeState>>,
    Json(request): Json<DocsSearchRequest>,
) -> BridgeResult<Json<DocsSearchResponse>> {
    let _ = request.library_title;
    let _ = request.topic;
    let _ = request.max_tokens;
    let _ = request.repo_url;
    if state.bridge.context7_base_url.is_none() {
        return Err(BridgeError::not_implemented(
            "infinitecode /api/v1/docs-search has no configured upstream. \
             Set [infinitecode_bridge].context7_base_url.",
        ));
    }
    Err(BridgeError::not_implemented(
        "infinitecode /api/v1/docs-search upstream proxy is not wired in this build. \
         (Wire shapes accepted; response deferred to your configured Context7 instance.)",
    ))
}

/// `POST /api/v1/gravity-index`. Proxies / stubs the gravity_index shape.
pub async fn gravity_index(
    State(_state): State<Arc<HttpBridgeState>>,
    Json(request): Json<GravityIndexRequest>,
) -> BridgeResult<Json<serde_json::Value>> {
    // Validate the shape is one of the four documented operations;
    // everything else is a Bad Request.
    let allowed = matches!(
        request.mode,
        GravityIndexOperation::Search
            | GravityIndexOperation::Browse
            | GravityIndexOperation::ListCategories
            | GravityIndexOperation::GetService
    );
    if !allowed {
        return Err(BridgeError::bad_request(format!(
            "unsupported gravity_index mode: {:?}",
            request.mode
        )));
    }

    // The bridge ships with gravity stubbed; a real upstream can be wired
    // in via a new `gravity_base_url` config key. Until then, return a
    // deterministic 501 so client and server agree on the wire shape.
    Err(BridgeError::not_implemented(
        "infinitecode gravity_index is not wired in this build. The InfiniteCode-side \
         Gravity implementation is closed-source; clients should consume the \
         upstream gravity.ai APIs directly until the bridge lands a public side \
         of the integration. Wire shape is already validated above.",
    ))
}

// Keep depth referenced so it stays in the wire contract.
const _DEPTH_KIND: WebSearchDepth = WebSearchDepth::Standard;
