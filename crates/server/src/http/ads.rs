//! Ad endpoints. Mirrors the InfiniteCode-side surface (`POST /api/v1/ads`,
//! `/impression`, `/click`) so the same client code can target either
//! backend. Default behaviour is no-op (returns `auction: null`,
//! `200 OK`, and increments the in-process counters) so a InfiniteCode-side
//! SDK can talk to the bridge without first wiring a real ad upstream.
//!
//! Operators flip `[infinitecode_bridge].ads_enabled = true` when they have
//! configured an ad provider upstream.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;

use infinitecode_protocol::{
    AdAuctionRequest, AdAuctionResponse, AdClickRequest, AdImpressionRequest, AdPlacement,
};

use crate::http::error::{BridgeError, BridgeResult};
use crate::http::HttpBridgeState;

pub async fn auction(
    State(state): State<Arc<HttpBridgeState>>,
    Json(request): Json<AdAuctionRequest>,
) -> BridgeResult<axum::response::Response> {
    state.record_auction();
    if !state.bridge.ads_enabled {
        // Default no-op shape: empty auction payload, 200 OK.
        return Ok((StatusCode::OK, Json(AdAuctionResponse { auction: None })).into_response());
    }
    if !matches!(
        request.placement,
        AdPlacement::DesktopInlineChat | AdPlacement::DesktopBelowChat
    ) {
        return Err(BridgeError::bad_request(format!(
            "unsupported ad placement: {:?}",
            request.placement
        )));
    }
    Err(BridgeError::not_implemented(
        "infinitecode ad upstream is not wired in this build. Set [infinitecode_bridge].ads_enabled=false \
         to receive default no-op auctions, or supply an upstream service \
         implementing the InfiniteCode ad contract.",
    ))
}

pub async fn impression(
    State(state): State<Arc<HttpBridgeState>>,
    Json(request): Json<AdImpressionRequest>,
) -> BridgeResult<StatusCode> {
    state.record_impression();
    let _ = request;
    Ok(StatusCode::OK)
}

pub async fn click(
    State(state): State<Arc<HttpBridgeState>>,
    Json(request): Json<AdClickRequest>,
) -> BridgeResult<StatusCode> {
    state.record_click();
    let _ = request;
    Ok(StatusCode::OK)
}
