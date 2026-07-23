//! InfiniteCode-compatible HTTP bridge (mounts on `axum`).
//!
//! [`build_router`] returns a ready-to-serve `axum::Router`. The router is
//! composed of three sub-routers merged together:
//!
//!   - `healthz_router` — `GET /api/healthz` — public.
//!   - `login_router`   — `POST /api/v1/auth/login` — public (mints bearer).
//!   - `protected_router` — every other `/api/v1/*` route, gated by the
//!     `require_bearer` middleware.
//!
//! Splitting at the sub-router level keeps the auth middleware out of the
//! unauthenticated paths so an unauthenticated client never even sees a
//! 401-vs-200 fingerprint, which matches InfiniteCode's wire behaviour.

mod ads;
mod auth;
mod error;
mod healthz;
mod search;
mod session;
mod state;
mod tokens;

use std::sync::Arc;

use axum::Router;
use axum::middleware::from_fn_with_state;
use axum::routing::{delete, get, post};

pub use state::HttpBridgeState;

/// Assembles the InfiniteCode-shaped HTTP router.
///
/// Idempotent: call as many times as you like to get a fresh router bound
/// to the same `state`. The bridge's wiring is purely via `axum::extract::State`;
/// `transport_http::spawn` does the rest.
pub fn build_router(state: Arc<HttpBridgeState>) -> Router {
    let public_router = Router::new()
        .route("/api/healthz", get(healthz::handler))
        .route("/api/v1/auth/login", post(auth::login));

    let protected_router = Router::new()
        // InfiniteCode-shape session lifecycle. `POST` admits; `GET` with no
        // path returns the acting-user's current active row (using header
        // `x-infinitecode-acting-user-id`); `GET /:id` polls; `DELETE` releases.
        .route(
            "/api/v1/infinitecode/session",
            post(session::admit).get(session::poll),
        )
        .route(
            "/api/v1/infinitecode/session/{instance_id}",
            get(session::read),
        )
        .route(
            "/api/v1/infinitecode/session/{instance_id}",
            delete(session::release),
        )
        .route("/api/v1/web-search", post(search::web_search))
        .route("/api/v1/docs-search", post(search::docs_search))
        .route("/api/v1/gravity-index", post(search::gravity_index))
        .route("/api/v1/token-count", post(tokens::token_count))
        .route("/api/v1/ads", post(ads::auction))
        .route("/api/v1/ads/impression", post(ads::impression))
        .route("/api/v1/ads/click", post(ads::click))
        .layer(from_fn_with_state(state.clone(), auth::require_bearer));

    public_router.merge(protected_router).with_state(state)
}
