//! Error type and `IntoResponse` impl for the HTTP bridge.
//!
//! Errors return `application/json` with a stable numeric code so clients can
//! branch on the shape without parsing the human-readable message. Codes
//! follow `infinitecode_protocol::CoordinationErrorBody` so the same code
//! path can be reused on the Freebuff-side SDK.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use smol_str::SmolStr;

use infinitecode_protocol::{CoordinationErrorBody, CoordinationSessionStatus};

#[derive(Debug, Clone, Serialize)]
pub struct ErrorEnvelope {
    pub error: CoordinationErrorBody,
}

#[derive(Debug, Clone)]
pub struct BridgeError {
    pub status: StatusCode,
    pub body: CoordinationErrorBody,
}

impl BridgeError {
    pub fn new(status: StatusCode, code: i32, message: impl Into<SmolStr>) -> Self {
        Self {
            status,
            body: CoordinationErrorBody {
                code,
                message: message.into(),
                status: None,
                reason: None,
            },
        }
    }

    pub fn bad_request(message: impl Into<SmolStr>) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            CoordinationErrorBody::BAD_REQUEST,
            message,
        )
    }

    #[allow(dead_code)] // wire-protocol surface; emitted when callers cannot present a token
    pub fn auth_required() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            CoordinationErrorBody::AUTH_REQUIRED,
            "Missing bearer token. Acquire one with POST /api/v1/auth/login.",
        )
    }

    pub fn auth_invalid() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            CoordinationErrorBody::AUTH_INVALID,
            "Bearer token is invalid or expired.",
        )
    }

    /// `auth_required_or_invalid`: distinguish missing vs. malformed when the
    /// caller can't tell (e.g. they only know "Authorization wasn't a Bearer
    /// token"). For now we coerce both branches to `AUTH_INVALID` because
    /// surfacing AUTH_REQUIRED for "header present but not Bearer-prefixed"
    /// leaks nothing actionable to attackers.
    pub fn auth_required_or_invalid() -> Self {
        Self::auth_invalid()
    }

    pub fn session_superseded(instance_id: impl Into<SmolStr>) -> Self {
        let body = CoordinationErrorBody {
            code: CoordinationErrorBody::SESSION_SUPERSEDED,
            message: SmolStr::new("Another session has been admitted for this acting user."),
            status: Some(coordination_status_str(CoordinationSessionStatus::Superseded)),
            reason: Some(instance_id.into()),
        };
        Self {
            status: StatusCode::CONFLICT,
            body,
        }
    }

    #[allow(dead_code)] // wire-protocol surface; emitted when the daily quota map below the threshold
    pub fn session_rate_limited() -> Self {
        let body = CoordinationErrorBody {
            code: CoordinationErrorBody::SESSION_RATE_LIMITED,
            message: SmolStr::new("Acting user has exhausted the shared daily quota for this model."),
            status: Some(coordination_status_str(CoordinationSessionStatus::RateLimited)),
            reason: None,
        };
        Self {
            status: StatusCode::TOO_MANY_REQUESTS,
            body,
        }
    }

    #[allow(dead_code)] // wire-protocol surface; emitted when ISO country code falls under a sanctions list
    pub fn session_country_blocked() -> Self {
        let body = CoordinationErrorBody {
            code: CoordinationErrorBody::SESSION_COUNTRY_BLOCKED,
            message: SmolStr::new("Sessions are not available in this region."),
            status: Some(coordination_status_str(CoordinationSessionStatus::CountryBlocked)),
            reason: None,
        };
        Self {
            status: StatusCode::UNAVAILABLE_FOR_LEGAL_REASONS,
            body,
        }
    }

    pub fn internal(message: impl Into<SmolStr>) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            CoordinationErrorBody::INTERNAL,
            message,
        )
    }

    pub fn not_implemented(message: impl Into<SmolStr>) -> Self {
        Self::new(
            StatusCode::NOT_IMPLEMENTED,
            CoordinationErrorBody::NOT_IMPLEMENTED,
            message,
        )
    }
}

impl IntoResponse for BridgeError {
    fn into_response(self) -> Response {
        let body = ErrorEnvelope { error: self.body };
        (self.status, Json(body)).into_response()
    }
}

fn coordination_status_str(status: CoordinationSessionStatus) -> SmolStr {
    let name = match status {
        CoordinationSessionStatus::None => "none",
        CoordinationSessionStatus::Active => "active",
        CoordinationSessionStatus::Ended => "ended",
        CoordinationSessionStatus::Superseded => "superseded",
        CoordinationSessionStatus::CountryBlocked => "country_blocked",
        CoordinationSessionStatus::Banned => "banned",
        CoordinationSessionStatus::RateLimited => "rate_limited",
        CoordinationSessionStatus::TakeoverPrompt => "takeover_prompt",
    };
    SmolStr::new(name)
}

pub type BridgeResult<T> = std::result::Result<T, BridgeError>;
