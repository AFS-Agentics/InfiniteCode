use serde::{Deserialize, Serialize};

/// Stores transport and connection-management defaults for the runtime server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerConfig {
    /// The websocket listener addresses the server should bind to by default.
    pub listen: Vec<String>,
    /// HTTP bridge listener addresses the runtime should bind.
    ///
    /// Each entry is parsed by `infinitecode_server::transport_http::parse`
    /// and currently accepts `http://host:port`. Empty list disables the
    /// HTTP coordination layer entirely (InfiniteCode-style endpoints will
    /// not be served).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub http_listen: Vec<String>,
    /// The maximum number of simultaneous client connections.
    pub max_connections: u32,
    /// The per-connection event buffer size used for streaming notifications.
    pub event_buffer_size: usize,
    /// The idle timeout applied to loaded sessions, in seconds.
    pub idle_session_timeout_secs: u64,
    /// Whether ephemeral sessions should be persisted despite their transient nature.
    pub persist_ephemeral_sessions: bool,
    /// Server authentication gate configuration.
    #[serde(default)]
    pub auth: ServerAuthConfig,
    /// InfiniteCode-compatible HTTP bridge configuration.
    ///
    /// Mirrors the placement of the InfiniteCode coordination API on top of the
    /// InfiniteCode runtime. When `enabled` is `false` (default) the HTTP
    /// layer is dormant — routes are not registered and no graceful-shutdown
    /// work is scheduled. To turn the bridge on, set either
    /// `[infinitecode_bridge]` `enabled = true` in `config.toml` *and* add at
    /// least one entry to `server.http_listen`.
    #[serde(default)]
    pub infinitecode_bridge: InfiniteCodeBridgeConfig,
}

/// Controls the optional server authentication gate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerAuthConfig {
    /// Whether clients must authenticate before calling server methods.
    pub enabled: bool,
    /// ACP authentication method identifier advertised during initialization.
    pub method_id: String,
    /// Human-readable authentication method label.
    pub name: String,
    /// Optional authentication method description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Whether the ACP `logout` method is advertised and supported.
    pub logout: bool,
}

impl Default for ServerAuthConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            method_id: "agent-login".to_string(),
            name: "Agent login".to_string(),
            description: None,
            logout: true,
        }
    }
}

/// Coordinates the InfiniteCode-shaped HTTP bridge that sits on top of the
/// InfiniteCode runtime.
///
/// The bridge exposes the same wire shapes (sessions, web-search proxies,
/// docs-search proxies, gravity-index, token-count, ads, auth, healthz) that
/// the InfiniteCode / Codebuff backend exposes, so a InfiniteCode-compatible client
/// can target either backend by swapping `NEXT_PUBLIC_CODEBUFF_APP_URL` for
/// `INFINITECODE_HTTP_BRIDGE_URL`. The agent itself stays client-side —
/// the bridge is only a coordination / quota layer.
///
/// Defaults are conservative so the bridge is opt-in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InfiniteCodeBridgeConfig {
    /// Whether the HTTP bridge is enabled. `false` by default. The HTTP
    /// listener is only mounted when `enabled` is true AND at least one
    /// entry exists in `server.http_listen`.
    pub enabled: bool,
    /// Shared secret clients must present in
    /// `POST /api/v1/auth/login` body.
    ///
    /// If unset, the bridge still binds but every protected endpoint returns
    /// `401 AUTH_REQUIRED`. Setting this via the `INFINITECODE_BRIDGE_PASSWORD`
    /// environment variable is preferred for non-interactive setups.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    /// Issued bearer-token lifetime, seconds. Default 24h.
    #[serde(default = "default_token_ttl_secs")]
    pub token_ttl_secs: u64,
    /// Default session length for a freshly admitted free session, seconds.
    /// Default 1h (matches `INFINITECODE_GLM_V52_SESSION_LENGTH_MS` semantics).
    #[serde(default = "default_session_length_secs")]
    pub default_session_length_secs: u64,
    /// Whether the ad endpoints are wired into the bridge.
    /// When `false`, `POST /api/v1/ads/{auction,impression,click}` returns
    /// `auction: null` / 200 OK no-ops. Default `false` because no real
    /// ad backend is plugged in by default.
    #[serde(default)]
    pub ads_enabled: bool,
    /// Optional Serper-shaped upstream for `POST /api/v1/web-search`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub serper_base_url: Option<String>,
    /// Optional Context7-shaped upstream for `POST /api/v1/docs-search`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context7_base_url: Option<String>,
}

fn default_token_ttl_secs() -> u64 {
    24 * 60 * 60
}

fn default_session_length_secs() -> u64 {
    60 * 60
}

impl Default for InfiniteCodeBridgeConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            password: None,
            token_ttl_secs: default_token_ttl_secs(),
            default_session_length_secs: default_session_length_secs(),
            ads_enabled: false,
            serper_base_url: None,
            context7_base_url: None,
        }
    }
}

impl InfiniteCodeBridgeConfig {
    /// True when the bridge can serve traffic: configuration is on, a
    /// password is provisioned, and the operator added at least one
    /// `http_listen` entry. The HTTP listener can't register routes
    /// without all three.
    pub fn is_operational(&self, http_listen: &[String]) -> bool {
        self.enabled
            && self.password.is_some()
            && !http_listen.is_empty()
    }
}
