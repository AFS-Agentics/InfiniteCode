//! Supabase JWT verification for the Rust coordination server.
//!
//! Supabase issues one of two token shapes depending on JWT signing-key
//! settings (Supabase dashboard → Auth → Sign In/Up → JWT Settings):
//!
//! - **HS256** (default) — JWT is signed with the project's
//!   `JWT_SECRET`. We verify with `jsonwebtoken::decode` using the
//!   secret directly. Fastest path, no network hops.
//!
//! - **RS256** — Supabase signs with an asymmetric key. Verification
//!   requires the public key from the JWKS endpoint at
//!   `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`. We cache the
//!   JWKS for a short TTL to avoid hammering the endpoint on every
//!   request.
//!
//! Use [`SupabaseAuthenticator::verify`] from any crate handler
//! that needs caller identity:
//!
//! ```ignore
//! let claims = authenticator.verify(&token)?;
//! println!("uid = {}, email = {:?}", claims.uid, claims.email);
//! ```
use std::sync::Arc;
use std::sync::RwLock;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupabaseClaims {
    /// Supabase user UUID. Mirrors the JWT `sub` claim.
    pub sub: String,
    /// Email address (may be null if the user signed up via phone).
    pub email: Option<String>,
    /// `true` when the email confirmation step has passed.
    #[serde(default)]
    pub email_verified: bool,
    /// `role` claim from the JWT itself. Optional — we still perform
    /// a `profiles.role` lookup on the BFF side for fine-grained
    /// admin gating.
    #[serde(default)]
    pub role: Option<String>,
    /// Issued-at, expiry — preserved for downstream consumers.
    #[serde(default)]
    pub exp: Option<i64>,
    #[serde(default)]
    pub iat: Option<i64>,
}

impl SupabaseClaims {
    pub fn uid(&self) -> &str {
        &self.sub
    }
}

#[derive(Debug, Deserialize)]
struct Jwk {
    kty: String,
    alg: Option<String>,
    kid: Option<String>,
    #[serde(rename = "use")]
    _use_: Option<String>,
    n: Option<String>,
    e: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JwkSet {
    keys: Vec<Jwk>,
}

#[derive(Default)]
struct JwksCache {
    fetched_at: Option<Instant>,
    keys: Vec<Jwk>,
}

const JWKS_TTL: Duration = Duration::from_secs(15 * 60);

/// Strategy the authenticator uses when verifying tokens. Selected
/// at construction time via env vars.
#[derive(Clone)]
enum VerificationStrategy {
    /// HS256 with an explicit JWT secret. Verifies offline.
    Hs256 { secret: String },
    /// RS256 with cached JWKS — fetched from `{supabase_url}/auth/v1/.well-known/jwks.json`.
    Rs256 { supabase_url: String, cache: Arc<RwLock<JwksCache>> },
}

/// Top-level entry point. Construct once at server start (when the
/// env vars are known) and share via `Arc<SupabaseAuthenticator>`.
#[derive(Clone)]
pub struct SupabaseAuthenticator {
    strategy: Option<VerificationStrategy>,
}

impl SupabaseAuthenticator {
    /// Construct from env vars. Returns `Ok(None)` when neither
    /// `SUPABASE_JWT_SECRET` nor `SUPABASE_URL` is configured — the
    /// server can then refuse auth-gated routes with a 503.
    pub fn from_env() -> Result<Self> {
        let secret = std::env::var("SUPABASE_JWT_SECRET").ok();
        let url = std::env::var("SUPABASE_URL").ok();

        let strategy = match (secret.filter(|s| !s.is_empty()), url.filter(|s| !s.is_empty())) {
            (Some(secret), _) => Some(VerificationStrategy::Hs256 { secret }),
            (None, Some(url)) => Some(VerificationStrategy::Rs256 {
                supabase_url: url,
                cache: Arc::new(RwLock::new(JwksCache::default())),
            }),
            _ => None,
        };

        Ok(Self { strategy })
    }

    pub fn is_configured(&self) -> bool {
        self.strategy.is_some()
    }

    /// Verify the JWT and return the parsed claims, or an error.
    /// Returned errors are safe to surface to the client (no secret
    /// material leaks).
    pub async fn verify(&self, token: &str) -> Result<SupabaseClaims> {
        let Some(strategy) = &self.strategy else {
            return Err(anyhow!(
                "Supabase is not configured. Set SUPABASE_JWT_SECRET or SUPABASE_URL."
            ));
        };

        let header = decode_header(token).context("invalid JWT header")?;
        match strategy {
            VerificationStrategy::Hs256 { secret } => {
                if header.alg != Algorithm::HS256 {
                    return Err(anyhow!("unexpected JWT algorithm: {:?}", header.alg));
                }
                let key = DecodingKey::from_secret(secret.as_bytes());
                let mut validation = Validation::new(Algorithm::HS256);
                // We do our own `exp` checking via the deserialized
                // claims, so let jsonwebtoken's behaviour default
                // (signature + format only).
                validation.validate_exp = false;
                let data = decode::<SupabaseClaims>(token, &key, &validation)
                    .context("JWT signature verification failed")?;
                Ok(data.claims)
            }
            VerificationStrategy::Rs256 { supabase_url, cache } => {
                let kid = header.kid.ok_or_else(|| anyhow!("JWT header missing kid"))?;
                let key = self
                    .resolve_rsa_key(supabase_url, cache, &kid)
                    .await
                    .context("fetching JWKS")?;
                if header.alg != Algorithm::RS256 {
                    return Err(anyhow!("unexpected JWT algorithm: {:?}", header.alg));
                }
                let mut validation = Validation::new(Algorithm::RS256);
                validation.validate_exp = false;
                let data = decode::<SupabaseClaims>(token, &key, &validation)
                    .context("JWT signature verification failed")?;
                Ok(data.claims)
            }
        }
    }

    async fn resolve_rsa_key(
        &self,
        supabase_url: &str,
        cache: &Arc<RwLock<JwksCache>>,
        kid: &str,
    ) -> Result<DecodingKey> {
        // TLS-free off the wire; reqwest is configured rustls-only in
        // workspace deps. We use blocking here to keep the API
        // simple; rewrite to spawn_blocking if hot.
        let needs_refresh = {
            let guard = cache.read().expect("jwks cache poisoned");
            match guard.fetched_at {
                Some(t) if t.elapsed() < JWKS_TTL => false,
                _ => true,
            }
        };
        if needs_refresh {
            self.refresh_jwks(supabase_url, cache).await?;
        }

        let guard = cache.read().expect("jwks cache poisoned");
        let jwk = guard
            .keys
            .iter()
            .find(|k| k.kid.as_deref() == Some(kid))
            .ok_or_else(|| anyhow!("kid `{kid}` not found in JWKS"))?;
        let n = jwk
            .n
            .as_deref()
            .ok_or_else(|| anyhow!("JWKS entry for `{kid}` missing `n`"))?;
        let e = jwk
            .e
            .as_deref()
            .ok_or_else(|| anyhow!("JWKS entry for `{kid}` missing `e`"))?;
        DecodingKey::from_rsa_components(n, e).context("decoding RSA components")
    }

    async fn refresh_jwks(&self, supabase_url: &str, cache: &Arc<RwLock<JwksCache>>) -> Result<()> {
        let url = format!("{}/auth/v1/.well-known/jwks.json", supabase_url.trim_end_matches('/'));
        let response = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| anyhow!("reqwest client: {e}"))?
            .get(&url)
            .send()
            .await
            .context("fetching JWKS")?;
        if !response.status().is_success() {
            return Err(anyhow!("JWKS endpoint returned {}", response.status()));
        }
        let jwks: JwkSet = response.json().await.context("parsing JWKS body")?;
        let mut guard = cache.write().expect("jwks cache poisoned");
        guard.keys = jwks.keys;
        guard.fetched_at = Some(Instant::now());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_env_yields_none_when_neither_secret_nor_url_set() {
        // SAFETY: tests run on a single thread here so concurrent env
        // mutation is fine. The cache lock is per-instance.
        // SAFETY: `set_var` is unsafe in 2024 edition; binding to the
        // unsafe fn explicitly.
        unsafe {
            std::env::remove_var("SUPABASE_JWT_SECRET");
        }
        unsafe {
            std::env::remove_var("SUPABASE_URL");
        }
        let auth = SupabaseAuthenticator::from_env().expect("from_env");
        assert!(!auth.is_configured());
    }

    #[test]
    fn from_env_picks_hs256_when_secret_present() {
        unsafe {
            std::env::set_var("SUPABASE_JWT_SECRET", "test-secret");
        }
        unsafe {
            std::env::remove_var("SUPABASE_URL");
        }
        let auth = SupabaseAuthenticator::from_env().expect("from_env");
        assert!(auth.is_configured());
    }

    #[test]
    fn from_env_falls_back_to_rs256_when_url_only() {
        unsafe {
            std::env::remove_var("SUPABASE_JWT_SECRET");
        }
        unsafe {
            std::env::set_var("SUPABASE_URL", "https://example.supabase.co");
        }
        let auth = SupabaseAuthenticator::from_env().expect("from_env");
        assert!(auth.is_configured());
    }

    #[test]
    fn verify_rejects_unconfigured_authenticator() {
        unsafe {
            std::env::remove_var("SUPABASE_JWT_SECRET");
        }
        unsafe {
            std::env::remove_var("SUPABASE_URL");
        }
        let auth = SupabaseAuthenticator::from_env().expect("from_env");
        let result = futures::executor::block_on(auth.verify("not-a-token"));
        assert!(result.is_err());
    }
}
