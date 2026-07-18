//! Gravity ads integration for the InfiniteCode CLI/TUI.
//!
//! Provides a simple REST client for fetching contextual ads from Gravity's
//! ad engine. The Desktop app uses the `@gravity-ai/api` NPM SDK; this module
//! calls the same REST endpoint directly so the CLI surfaces can earn
//! impressions without a JavaScript runtime.
//!
//! # Usage
//!
//! Set `GRAVITY_API_KEY` in the environment. If absent, `fetch_ad` returns
//! `None` and callers render nothing (production) or a placeholder (dev).
//!
//! # API
//!
//! POST `https://server.trygravity.ai/api/v1/ad`
//! Authorization: Bearer <GRAVITY_API_KEY>
//! Content-Type: application/json
//!
//! Body:
//! ```json
//! {
//!   "messages": [{ "role": "user", "content": "..." }],
//!   "sessionId": "sess_...",
//!   "placements": [{ "placement": "below_response", "placement_id": "cli-main" }],
//!   "user": { "id": "infinitecode-cli-user" },
//!   "device": { "ua": "InfiniteCode-CLI/0.1", "ip": "127.0.0.1" }
//! }
//! ```
//!
//! Response: `200` JSON array of ad objects, or `204 No Content` for no fill.

use serde::Deserialize;
use serde::Serialize;

/// Gravity ad response object returned by the engine for each placement.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GravityAdData {
    /// Main body text / description for the ad.
    #[serde(default)]
    pub ad_text: String,
    /// Short title (may be absent).
    #[serde(default)]
    pub title: Option<String>,
    /// Call-to-action label (e.g. "Learn more", "Start free trial").
    #[serde(default)]
    pub cta: Option<String>,
    /// Advertiser brand name.
    #[serde(default)]
    pub brand_name: Option<String>,
    /// Landing page URL (unwrapped, for display only).
    #[serde(default)]
    pub url: Option<String>,
    /// Click-tracked URL — use this for the actual link href.
    #[serde(default)]
    pub click_url: Option<String>,
    /// Impression pixel URL — fire this exactly once when the ad
    /// becomes visible.
    #[serde(default)]
    pub imp_url: Option<String>,
    /// Advertiser favicon URL.
    #[serde(default)]
    pub favicon: Option<String>,
}

/// A demo ad used as a fallback when no real `GRAVITY_API_KEY` is set.
/// Mirrors the shape of a real Gravity response so the placement surfaces
/// render with realistic visual chrome even without a configured API key.
pub fn demo_gravity_ad() -> GravityAdData {
    GravityAdData {
        ad_text: "Production-grade object storage with edge caching and zero-egress pricing."
            .into(),
        brand_name: Some("Cortex Cloud".into()),
        cta: Some("Start free trial".into()),
        url: Some("https://example.com/cortex".into()),
        click_url: Some("https://example.com/cortex?utm_source=infinitecode&utm_medium=cli".into()),
        imp_url: None,
        title: None,
        favicon: None,
    }
}

/// Fetches a contextual ad from Gravity for the given conversation context.
///
/// Returns `Ok(Some(ad))` on a successful fill, `Ok(None)` when the engine
/// returns no fill (204 or empty array), and `Err` on network / auth errors.
/// Callers should never block the user experience on this — treat `None` /
/// `Err` as "no ad to show" and continue normally.
///
/// When `GRAVITY_API_KEY` is not set in the environment, returns the demo ad
/// (so CLI surfaces always have something to render during development).
pub async fn fetch_gravity_ad(
    messages: &[MessageEntry],
    placement: &str,
    placement_id: &str,
    session_id: &str,
) -> Result<Option<GravityAdData>, GravityError> {
    let api_key = std::env::var("GRAVITY_API_KEY").ok();
    let api_key = api_key.as_deref().filter(|k| !k.is_empty());

    // No API key — return demo ad.
    let Some(api_key) = api_key else {
        return Ok(Some(demo_gravity_ad()));
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| GravityError::Http(e.to_string()))?;

    let body = GravityRequestBody {
        messages: messages.to_vec(),
        session_id: session_id.to_string(),
        placements: vec![PlacementEntry {
            placement: placement.to_string(),
            placement_id: placement_id.to_string(),
        }],
        user: UserEntry {
            id: "infinitecode-cli-user".to_string(),
        },
        device: DeviceEntry {
            ua: format!("InfiniteCode-CLI/{}", env!("CARGO_PKG_VERSION")),
            ip: "127.0.0.1".to_string(),
        },
    };

    let resp = client
        .post("https://server.trygravity.ai/api/v1/ad")
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| GravityError::Http(e.to_string()))?;

    let status = resp.status();
    if status == reqwest::StatusCode::NO_CONTENT {
        return Ok(None);
    }

    let ads: Vec<GravityAdData> = resp
        .json()
        .await
        .map_err(|e| GravityError::Decode(e.to_string()))?;

    Ok(ads.into_iter().next())
}

/// A single conversation message for Gravity's contextual matching.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageEntry {
    pub role: String,
    pub content: String,
}

impl MessageEntry {
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".into(),
            content: content.into(),
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant".into(),
            content: content.into(),
        }
    }
}

/// Request body sent to the Gravity ad engine.
#[derive(Debug, Serialize)]
struct GravityRequestBody {
    messages: Vec<MessageEntry>,
    #[serde(rename = "sessionId")]
    session_id: String,
    placements: Vec<PlacementEntry>,
    user: UserEntry,
    device: DeviceEntry,
}

#[derive(Debug, Serialize)]
struct PlacementEntry {
    placement: String,
    #[serde(rename = "placement_id")]
    placement_id: String,
}

#[derive(Debug, Serialize)]
struct UserEntry {
    id: String,
}

#[derive(Debug, Serialize)]
struct DeviceEntry {
    ua: String,
    ip: String,
}

/// Errors that can occur when fetching a Gravity ad.
#[derive(Debug, thiserror::Error)]
pub enum GravityError {
    /// Network or HTTP error.
    #[error("HTTP request failed: {0}")]
    Http(String),
    /// Response decoding error.
    #[error("Failed to decode ad response: {0}")]
    Decode(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn demo_ad_has_basic_fields() {
        let ad = demo_gravity_ad();
        assert!(!ad.ad_text.is_empty());
        assert!(ad.brand_name.is_some());
        assert!(ad.click_url.is_some());
    }

    #[test]
    fn message_entry_user_has_correct_role() {
        let entry = MessageEntry::user("hello");
        assert_eq!(&entry.role, "user");
        assert_eq!(&entry.content, "hello");
    }

    #[test]
    fn message_entry_assistant_has_correct_role() {
        let entry = MessageEntry::assistant("world");
        assert_eq!(&entry.role, "assistant");
        assert_eq!(&entry.content, "world");
    }

    #[test]
    fn gravity_ad_data_deserializes_from_minimal_json() {
        let json = r#"{"ad_text": "Test ad"}"#;
        let ad: GravityAdData = serde_json::from_str(json).expect("deserialize");
        assert_eq!(ad.ad_text, "Test ad");
        assert!(ad.brand_name.is_none());
        assert!(ad.click_url.is_none());
    }

    #[test]
    fn gravity_ad_data_deserializes_full_object() {
        let json = serde_json::json!({
            "ad_text": "Full ad description",
            "title": "Ad Title",
            "cta": "Click here",
            "brand_name": "Acme Corp",
            "url": "https://acme.example",
            "click_url": "https://track.example/click",
            "imp_url": "https://track.example/imp",
            "favicon": "https://acme.example/favicon.ico"
        });
        let ad: GravityAdData = serde_json::from_value(json).expect("deserialize full object");
        assert_eq!(ad.ad_text, "Full ad description");
        assert_eq!(ad.title.as_deref(), Some("Ad Title"));
        assert_eq!(ad.cta.as_deref(), Some("Click here"));
        assert_eq!(ad.brand_name.as_deref(), Some("Acme Corp"));
        assert_eq!(ad.url.as_deref(), Some("https://acme.example"));
        assert_eq!(ad.click_url.as_deref(), Some("https://track.example/click"));
        assert_eq!(ad.imp_url.as_deref(), Some("https://track.example/imp"));
        assert_eq!(
            ad.favicon.as_deref(),
            Some("https://acme.example/favicon.ico")
        );
    }
}
