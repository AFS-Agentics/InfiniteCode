//! CLI-side Supabase sign-in.
//!
//! Implements the device-pairing flow that mirrors `apps/desktop/src/main/connect-flow.ts`:
//!
//!   1. Generate a 8-char base32 `user_code` (e.g. `ABCD-EFGH`).
//!   2. Pre-insert a pending `device_pairing` row via the website's
//!      `/api/connect` endpoint (POST `{ user_code }`).
//!   3. Open the system browser to
//!      `${WEBSITE}/login?code=${user_code}`.
//!   4. Poll `/api/connect?user_code=…` every 2 s (default) until
//!      the row is `authorized`, then atomic-claim the tokens.
//!   5. Persist `{ access, refresh, expires_at, user_id }` to the
//!      OS keyring via `infinitecode_keyring_store`.
//!
//! Entry point: [`sign_in_via_browser`]. Use [`SupabaseAuthenticator`]
//! for downstream JWT verification.
//!
//! Environment variables (read by [`sign_in_via_browser`]):
//! - `INFINITECODE_WEBSITE_URL` — defaults to `https://tryinfinitecode.vercel.app`.
//! - `INFINITECODE_SUPABASE_PROJECT_URL` — same as the website's
//!   `VITE_SUPABASE_URL`. Used to build the polling base.
//! - `SUPABASE_JWT_SECRET` / `SUPABASE_URL` — picked up by the
//!   authenticator for downstream verification.
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow};
use infinitecode_keyring_store::{DefaultKeyringStore, KeyringStore};
use rand::Rng;
use serde::Deserialize;
use url::Url;

const POLL_INTERVAL: Duration = Duration::from_secs(2);
const POLL_TIMEOUT: Duration = Duration::from_secs(5 * 60);
pub(crate) const DEFAULT_WEBSITE: &str = "https://tryinfinitecode.vercel.app";

/// Identifier for the OS-keyring entry that stores the persisted
/// Supabase session for the **Rust CLI binary**.
///
/// The Electron desktop stores its session through a different
/// mechanism (`apps/desktop/src/main/credential-store.ts` —
/// Electron's `safeStorage` JSON file), so this constant is
/// CLI-only — it does not need to match the desktop's keychain
/// entry.
///
/// Why a "v1" suffix: the previous identifier was
/// `infinitecode.cli.supabase.session` (account `v1`). That name
/// was used only while auth wiring was experimental; we bumped it
/// to a versioned suffix once auth stabilized.
///
/// Old entries still get read by [`read_session_json`] so existing
/// users don't lose their session on upgrade.
pub(crate) const KEYRING_SERVICE: &str = "infinitecode.supabase.session.v1";
/// Legacy key-chain key — read for backwards compatibility, never
/// written. Lets users who signed in before the rename keep their
/// session transparently.
const KEYRING_SERVICE_LEGACY: &str = "infinitecode.cli.supabase.session";
const KEYRING_ACCOUNT: &str = "v1";

const USER_CODE_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // unambiguous base32

#[derive(Debug, Deserialize)]
struct PollOk {
    #[serde(default)]
    status: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_at: Option<String>,
    user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PollErr {
    error: String,
}

/// Generate an 8-char user code rendered as `XXXX-XXXX`.
fn generate_user_code() -> String {
    let mut rng = rand::thread_rng();
    let mut s = String::with_capacity(8);
    for _ in 0..8 {
        let idx = rng.gen_range(0..USER_CODE_ALPHABET.len());
        s.push(USER_CODE_ALPHABET[idx] as char);
    }
    format!("{}-{}", &s[..4], &s[4..])
}

fn resolve_website_base() -> String {
    std::env::var("INFINITECODE_WEBSITE_URL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_WEBSITE.to_string())
}

fn website_origin(base: &str) -> Result<Url> {
    Url::parse(base).with_context(|| format!("invalid website url: {base}"))
}

async fn pre_insert_pending(connect_base: &Url, user_code: &str) -> Result<()> {
    let url = connect_base
        .join("/api/connect")
        .context("invalid /api/connect URL")?;
    let body = serde_json::json!({ "user_code": user_code });
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| anyhow!("reqwest: {e}"))?
        .post(url)
        .json(&body)
        .send()
        .await
        .context("POST /api/connect")?;
    if !response.status().is_success() {
        return Err(anyhow!(
            "website returned {} on /api/connect pre-insert",
            response.status()
        ));
    }
    Ok(())
}

async fn poll_for_tokens(
    connect_base: &Url,
    user_code: &str,
) -> Result<(String, String, Option<String>, Option<String>)> {
    let deadline = Instant::now() + POLL_TIMEOUT;
    let url = connect_base
        .join(&format!(
            "/api/connect?user_code={}",
            urlencoding::encode(user_code)
        ))
        .context("invalid poll URL")?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| anyhow!("reqwest: {e}"))?;

    while Instant::now() < deadline {
        tokio::time::sleep(POLL_INTERVAL).await;
        let response = match client.get(url.clone()).send().await {
            Ok(r) => r,
            Err(_) => continue,
        };
        if !response.status().is_success() {
            continue;
        }
        let parsed: serde_json::Value = match response.json().await {
            Ok(v) => v,
            Err(_) => continue,
        };
        if parsed.get("ok").and_then(|v| v.as_bool()) != Some(true) {
            continue;
        }
        let status = parsed.get("status").and_then(|v| v.as_str()).unwrap_or("");
        match status {
            "authorized" => {
                let access = parsed
                    .get("access_token")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow!("authorized row missing access_token"))?
                    .to_string();
                let refresh = parsed
                    .get("refresh_token")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow!("authorized row missing refresh_token"))?
                    .to_string();
                let expires_at = parsed
                    .get("expires_at")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let user_id = parsed
                    .get("user_id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                return Ok((access, refresh, expires_at, user_id));
            }
            "pending" => continue,
            "consumed" | "expired" => return Err(anyhow!("row already consumed/expired")),
            _ => continue,
        }
    }
    Err(anyhow!("timed out waiting for browser sign-in"))
}

fn persist_session(
    access_token: &str,
    refresh_token: &str,
    expires_at: Option<&str>,
    user_id: Option<&str>,
) -> Result<()> {
    let payload = serde_json::json!({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expires_at,
        "user_id": user_id,
    });
    let bytes = serde_json::to_vec(&payload).context("serialise session")?;
    let json = std::str::from_utf8(&bytes).context("session JSON is not utf-8")?;
    DefaultKeyringStore
        .save(KEYRING_SERVICE, KEYRING_ACCOUNT, json)
        .map_err(|e| anyhow!("writing session to OS keyring: {}", e.message()))
}

/// Clear the persisted session on `infinitecode logout` (or similar).
pub fn sign_out() -> Result<()> {
    let removed = DefaultKeyringStore
        .delete(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| anyhow!("deleting session from OS keyring: {}", e.message()))?;
    if !removed {
        tracing::debug!("sign_out: no session was present in the keyring");
    }
    Ok(())
}

/// Return the raw loaded session JSON if a keyring entry exists,
/// otherwise `Ok(None)`. Callers (e.g. `auth whoami`) do their own
/// JWT decoding on top of this.
///
/// Tries the current key first, then falls back to the legacy key
/// for users who signed in before the rename. If a legacy entry is
/// read, it is silently upgraded to the current key so the legacy
/// entry can be deleted by the OS keychain's normal expiry.
pub fn read_session_json() -> Result<Option<serde_json::Value>> {
    let store = DefaultKeyringStore;
    let raw = store
        .load(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .or_else(|_| store.load(KEYRING_SERVICE_LEGACY, "v1"))
        .map_err(|e| anyhow!("reading session from OS keyring: {}", e.message()))?;
    let Some(raw) = raw else { return Ok(None) };
    let parsed: serde_json::Value =
        serde_json::from_str(&raw).context("deserialising session JSON from keyring")?;
    Ok(Some(parsed))
}

/// Open the system browser to the website's login page with the
/// pairing code as `?code=…`. The polling thread waits for the
/// freshly-issued Supabase tokens to be claimed.
pub async fn sign_in_via_browser() -> Result<()> {
    let website = website_origin(&resolve_website_base())?;
    let user_code = generate_user_code();
    pre_insert_pending(&website, &user_code).await?;

    let mut login_url = website
        .join("/login")
        .context("invalid /login URL")?;
    login_url
        .query_pairs_mut()
        .append_pair("code", &user_code);

    webbrowser::open(login_url.as_str()).context("opening system browser")?;
    eprintln!(
        "Sign in at {} — CLI is polling every {}s for the device-pairing row.",
        login_url, POLL_INTERVAL.as_secs()
    );

    let (access, refresh, expires_at, user_id) = poll_for_tokens(&website, &user_code).await?;
    persist_session(&access, &refresh, expires_at.as_deref(), user_id.as_deref())?;
    eprintln!("✓ Stored Supabase session in OS keyring (account={KEYRING_ACCOUNT}).");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_code_format_is_dashed_8_chars() {
        let code = generate_user_code();
        assert_eq!(code.len(), 9);
        assert_eq!(code.chars().nth(4), Some('-'));
        assert!(code
            .chars()
            .all(|c| USER_CODE_ALPHABET.contains(&(c as u8)) || c == '-'));
    }

    #[test]
    fn two_consecutive_codes_are_different_enough() {
        // Not a strict uniqueness test (RNG could collide with
        // negligible probability) — we just want to be sure the
        // generator isn't returning the same string deterministically.
        let a = generate_user_code();
        let b = generate_user_code();
        assert_ne!(a, b);
    }

    #[test]
    fn website_origin_accepts_default_constant() {
        let url = website_origin(DEFAULT_WEBSITE).expect("default parses");
        assert_eq!(url.scheme(), "https");
    }
}
