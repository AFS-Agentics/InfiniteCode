//! `infinitecode auth <sub>` — manage the persisted Supabase session.
//!
//! Four sub-actions, all backed by the same OS-keyring entry that
//! [`auth_supabase::sign_in_via_browser`] writes to:
//!
//! - `auth login`  → opens the browser to the website's `/login?code=…`
//!   device-pairing flow.
//! - `auth logout` → clears the keyring entry. Idempotent.
//! - `auth whoami` → decodes the persisted JWT (signature NOT verified —
//!   the path is purely cosmetic) and prints id / email / display name
//!   / token expiry.
//! - `auth status` → `whoami` plus an authorized-device count fetched
//!   from Supabase REST under the user's RLS scope.
//!
//! Errors here are user-facing: messages should compose well when piped
//! into `infinitecode doctor`.
use anyhow::{Context, Result, anyhow};
use chrono::{TimeZone, Utc};
use jsonwebtoken::{Algorithm, DecodingKey, TokenData, Validation, decode};
use serde::Deserialize;

use crate::auth_supabase::{self, DEFAULT_WEBSITE, sign_in_via_browser};

// -----------------------------------------------------------
// Public entry points
// -----------------------------------------------------------

/// Delegate to `auth_supabase::sign_in_via_browser` so the device-pairing
/// protocol stays in one place.
pub async fn run_login() -> Result<()> {
    sign_in_via_browser().await
}

/// Clear the OS-keyring entry. Idempotent: signing out without a
/// session is not an error.
pub fn run_logout() -> Result<()> {
    auth_supabase::sign_out()
}

/// Print the signed-in identity parsed from the persisted access token.
pub fn run_whoami() -> Result<()> {
    let session = load_session()?;
    let claims = decode_claims(&session.access_token)?;
    print_session(
        &claims,
        &Err("not fetched (run `auth status` for live count)".to_string()),
    );
    Ok(())
}

/// Print identity + an authorized-device count fetched live from Supabase.
pub async fn run_status() -> Result<()> {
    let session = load_session()?;
    let claims = decode_claims(&session.access_token)?;
    let device_count = match fetch_device_count(&session.access_token, &claims.sub).await {
        Ok(n) => Ok(n),
        Err(err) => Err(format!("{err}")),
    };
    print_session(&claims, &device_count);
    Ok(())
}

// -----------------------------------------------------------
// internals
// -----------------------------------------------------------

#[derive(Debug, Deserialize)]
#[allow(dead_code)] // refresh_token / expires_at: reserved for future refresh
struct PersistedSession {
    /// Currently only the access token is consumed; refresh_token and
    /// expires_at are still written here for future refresh support.
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_at: Option<String>,
}

/// JWT claim subset we care about for `whoami` / `status`.
///
/// `sub` is the Supabase user UUID — what PostgREST expects on
/// `?user_id=eq.<sub>` filters. `exp` is consumed to print a
/// human-friendly "session expires at" line.
#[derive(Debug, Deserialize)]
struct JwtClaims {
    sub: String,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    user_metadata: Option<serde_json::Value>,
    #[serde(default)]
    exp: Option<i64>,
    /// JWT issued-at timestamp. Recorded for future refresh support but
    /// not consumed by the current CLI surfaces (`whoami`, `status`),
    /// so the dead-code warning is silenced under `RUSTFLAGS=-Dwarnings`.
    #[serde(default)]
    #[allow(dead_code)]
    iat: Option<i64>,
}

fn load_session() -> Result<PersistedSession> {
    let raw = auth_supabase::read_session_json()?
        .ok_or_else(|| anyhow!("not signed in — run `infinitecode auth login` first"))?;
    let session: PersistedSession =
        serde_json::from_value(raw).context("session JSON was not in expected shape")?;
    if session.access_token.is_empty() {
        return Err(anyhow!("persisted session is missing access_token"));
    }
    Ok(session)
}

fn decode_claims(access_token: &str) -> Result<JwtClaims> {
    // We use `jsonwebtoken::decode` with `insecure_disable_signature_validation`
    // because we don't have the Supabase JWT secret here and don't
    // need it: whoami/status are identity-printing paths, not authorization
    // paths. If you ever use these claims for AZ decisions, switch to
    // `jsonwebtoken::decode` with the project secret.
    //
    // Note: `jsonwebtoken` v9 removed the `dangerous_insecure_decode` helper.
    // The replacement is a regular `decode` call against an empty
    // `DecodingKey` with `Validation::insecure_disable_signature_validation()`.
    let mut validation = Validation::new(Algorithm::HS256);
    validation.insecure_disable_signature_validation();
    validation.validate_exp = false;
    let TokenData { claims, .. } =
        decode::<JwtClaims>(access_token, &DecodingKey::from_secret(&[]), &validation)
            .context("decoding signed-in JWT (token may be malformed / expired)")?;
    Ok(claims)
}

fn display_name(claims: &JwtClaims) -> String {
    if let Some(meta) = &claims.user_metadata {
        if let Some(name) = meta
            .get("full_name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            return name.to_string();
        }
    }
    if let Some(email) = claims.email.as_deref() {
        if let Some((local, _)) = email.split_once('@') {
            if !local.is_empty() {
                return local.to_string();
            }
        }
    }
    claims.sub.clone()
}

fn format_exp(exp_unix_secs: i64) -> String {
    match Utc.timestamp_opt(exp_unix_secs, 0).single() {
        Some(dt) => dt.format("%Y-%m-%d %H:%M:%S UTC").to_string(),
        None => format!("(invalid exp={exp_unix_secs})"),
    }
}

fn print_session(claims: &JwtClaims, device_count: &Result<u64, String>) {
    let name = display_name(claims);
    println!("Logged in to {DEFAULT_WEBSITE}");
    println!("  user id : {}", claims.sub);
    if let Some(email) = claims.email.as_deref() {
        println!("  email   : {email}");
    }
    println!("  name    : {name}");
    if let Some(exp) = claims.exp {
        println!("  token expires at : {}", format_exp(exp));
    }
    match device_count {
        Ok(n) => println!("  devices : {n} authorized"),
        Err(reason) => println!("  devices : <unavailable — {reason}>"),
    }
}

async fn fetch_device_count(access_token: &str, user_id: &str) -> Result<u64> {
    let base = resolve_supabase_rest_base()?;
    let anon_key = resolve_supabase_anon_key()?;

    // SECURITY: the access_token must NEVER appear in the URL. PostgREST
    // expects the filter on the user id (the JWT's `sub` claim). The
    // token is sent only via the `Authorization: Bearer …` header.
    let url = format!(
        "{base}/rest/v1/device_pairing?select=id&user_id=eq.{user_id}",
        base = base.trim_end_matches('/'),
    );

    use reqwest::header::{ACCEPT, AUTHORIZATION};
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| anyhow!("reqwest: {e}"))?
        .get(&url)
        .header(AUTHORIZATION, format!("Bearer {access_token}"))
        .header("apikey", anon_key.trim())
        .header(ACCEPT, "application/json")
        .send()
        .await
        .context("GET /rest/v1/device_pairing")?;
    if !response.status().is_success() {
        return Err(anyhow!("PostgREST returned {}", response.status()));
    }
    let body: serde_json::Value = response.json().await.context("parsing response")?;
    match body {
        serde_json::Value::Array(rows) => Ok(rows.len() as u64),
        other => Err(anyhow!("unexpected response shape: {other}")),
    }
}

fn resolve_supabase_rest_base() -> Result<String> {
    match std::env::var("INFINITECODE_SUPABASE_PROJECT_URL") {
        Ok(s) if !s.is_empty() => Ok(s.trim_end_matches('/').to_string()),
        _ => Err(anyhow!(
            "INFINITECODE_SUPABASE_PROJECT_URL is not set — required for `auth status`"
        )),
    }
}

fn resolve_supabase_anon_key() -> Result<String> {
    match std::env::var("INFINITECODE_SUPABASE_ANON_KEY") {
        Ok(s) if !s.is_empty() => Ok(s),
        _ => Err(anyhow!(
            "INFINITECODE_SUPABASE_ANON_KEY is not set — required for `auth status`"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_claims() -> JwtClaims {
        JwtClaims {
            sub: "00000000-0000-0000-0000-000000000001".to_string(),
            email: Some("jane.doe@example.com".to_string()),
            user_metadata: Some(serde_json::json!({ "full_name": "Jane Doe" })),
            exp: Some(1_700_000_000),
            iat: Some(1_699_999_400),
        }
    }

    #[test]
    fn display_name_prefers_full_name() {
        assert_eq!(display_name(&sample_claims()), "Jane Doe");
    }

    #[test]
    fn display_name_falls_back_to_email_local_part() {
        let mut c = sample_claims();
        c.user_metadata = None;
        assert_eq!(display_name(&c), "jane.doe");
    }

    #[test]
    fn display_name_falls_back_to_sub_when_no_email() {
        let mut c = sample_claims();
        c.user_metadata = None;
        c.email = None;
        assert_eq!(display_name(&c), c.sub);
    }

    #[test]
    fn display_name_skips_empty_full_name() {
        let mut c = sample_claims();
        c.user_metadata = Some(serde_json::json!({ "full_name": "" }));
        assert_eq!(display_name(&c), "jane.doe");
    }

    #[test]
    fn format_exp_renders_utc() {
        let s = format_exp(1_700_000_000);
        assert!(s.contains("2023"), "unexpected format: {s}");
        assert!(s.ends_with("UTC"));
    }

    #[test]
    fn format_exp_handles_out_of_range() {
        let s = format_exp(i64::MAX);
        assert!(s.contains("invalid"));
    }
}
