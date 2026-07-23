//! HTTP listener runner for the InfiniteCode-shaped coordination bridge.
//!
//! Owns the `http://host:port` listen-entry parser and the async loop that
//! serves the bridge. Kept as a sibling of `crate::transport` (the JSON-RPC
//! over WebSocket / stdio listeners) so neither file needs to grow into the
//! other's territory:
//!
//!   - The runtime's main listener list (parsed in `transport.rs`) keeps its
//!     `ListenTarget` enum focused on the JSON-RPC ACP transports.
//!   - The HTTP bridge parses its entries with [`parse`] and spawns an
//!     axum [`axum::serve`] loop alongside the JSON-RPC listeners from
//!     `bootstrap.rs::run_listeners_with_internal_proxy`.
//!
//! Liveness model: the HTTP listener shares the same `CancellationToken` as
//! the rest of the runtime, so when `infinitecode server --shutdown` fires
//! the WebSocket loop and the HTTP loop both wind down. The axum server
//! uses `with_graceful_shutdown` so in-flight requests have a chance to
//! finish before the listener drops.

use std::sync::Arc;

use anyhow::{Context, Result, anyhow, bail};
use axum::Router;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

use crate::db::Database;
use crate::http::HttpBridgeState;

/// Parses one configured HTTP listener string. Mirrors the shape style of
/// `transport::parse_listen_target`:
///
///   - `"http://"`         → default loopback (`127.0.0.1:8090`).
///   - `"http://addr"`     → explicit `addr` (e.g. `0.0.0.0:8090`).
pub fn parse(value: &str) -> Result<String> {
    const DEFAULT_BIND: &str = "127.0.0.1:8090";
    if let Some(addr) = value.strip_prefix("http://") {
        if addr.is_empty() {
            return Ok(DEFAULT_BIND.to_string());
        }
        return Ok(addr.to_string());
    }
    bail!("infinitecode http listener entry was not http:// prefixed: {value}")
}

/// Indirection: returns `None` when the entry isn't an `http://` value, so
/// callers can drain HTTP entries from a mixed listener set without
/// crashing on unknown prefixes.
pub fn parse_optional(value: &str) -> Option<String> {
    parse(value).ok()
}

/// Binds a TCP listener and returns the resolved local address. Used by
/// `bootstrap.rs` to surface the actual bound port when the operator used
/// port 0 (so they can URL-discovery from log lines).
pub async fn bind(addr: &str) -> Result<TcpListener> {
    let listener = TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind infinitecode HTTP listener on {addr}"))?;
    Ok(listener)
}

/// Spawns the axum HTTP bridge for one configured listen address.
///
/// `router` should already have `/api/v1/...` and `/api/healthz` mounted
/// from [`crate::http::build_router`]. `state` is cloned into the
/// axum worker pool so each request handler can borrow it cheaply.
///
/// Returns when the bridge task exits; the bridge task itself returns when
/// the shutdown token fires.
pub async fn spawn(
    listener: TcpListener,
    router: Router,
    shutdown: CancellationToken,
) -> Result<std::net::SocketAddr> {
    let local_addr = listener
        .local_addr()
        .map_err(|error| anyhow!("failed to read HTTP listener local_addr: {error}"))?;

    let server = axum::serve(listener, router).with_graceful_shutdown(async move {
        shutdown.cancelled().await;
    });

    tokio::spawn(async move {
        if let Err(error) = server.await {
            tracing::error!(error = %error, "infinitecode HTTP bridge exited with error");
            return;
        }
        tracing::info!("infinitecode HTTP bridge shut down cleanly");
    });

    Ok(local_addr)
}

/// Lightweight builder for `HttpBridgeState` callable from `bootstrap.rs`.
///
/// Kept here (not in `http::mod`) so the dependency between the state type
/// and the runtime types that already live in this crate stays one-way —
/// `http::mod` doesn't need to know about `Database` or the infinitecode
/// itself, it just consumes the readymade state.
pub fn build_state(
    db: Arc<Database>,
    bridge: infinitecode_config::InfiniteCodeBridgeConfig,
    startup_instant: std::time::Instant,
) -> Arc<HttpBridgeState> {
    HttpBridgeState::new(db, bridge, startup_instant)
}

/// Runs the InfiniteCode-compatible HTTP bridge alongside the JSON-RPC
/// listeners. Returns when `shutdown` fires.
pub async fn run_http_bridge(
    bridge: infinitecode_config::InfiniteCodeBridgeConfig,
    http_listen: Vec<String>,
    db: Arc<Database>,
    shutdown: CancellationToken,
) -> anyhow::Result<()> {
    let started_at = std::time::Instant::now();
    let state = HttpBridgeState::new(db, bridge, started_at);
    let router = crate::http::build_router(state);

    let mut tasks: tokio::task::JoinSet<()> = tokio::task::JoinSet::new();
    for entry in &http_listen {
        let bind_addr = match parse(entry) {
            Ok(addr) => addr,
            Err(error) => {
                tracing::warn!(entry = %entry, error = %error, "skipping malformed infinitecode http entry");
                continue;
            }
        };
        let listener = match bind(&bind_addr).await {
            Ok(listener) => listener,
            Err(error) => {
                tracing::warn!(bind = %bind_addr, error = %error, "infinitecode HTTP bind failed; skipping entry");
                continue;
            }
        };
        let local_addr = listener
            .local_addr()
            .map_err(|error| anyhow!("failed to read HTTP listener local_addr: {error}"))?;
        tracing::info!(
            bind = %bind_addr,
            actual = %local_addr,
            "infinitecode HTTP bridge listening",
        );
        let router_clone = router.clone();
        let shutdown_clone = shutdown.clone();
        tasks.spawn(async move {
            if let Err(error) = axum::serve(listener, router_clone)
                .with_graceful_shutdown(async move {
                    shutdown_clone.cancelled().await;
                })
                .await
            {
                tracing::error!(bind = %local_addr, error = %error, "infinitecode HTTP bridge exited with error");
            }
        });
    }

    while tasks.join_next().await.is_some() {}
    tracing::info!("infinitecode HTTP bridge shut down");
    Ok(())
}
