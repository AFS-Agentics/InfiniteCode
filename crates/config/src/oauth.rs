use serde::Deserialize;
use serde::Serialize;

/// Determine where InfiniteCode should store and read MCP credentials.
#[derive(Debug, Default, Copy, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OAuthCredentialsStoreMode {
    /// `Keyring` when available; otherwise, `File`.
    /// Credentials stored in the keyring will only be readable by InfiniteCode unless the user explicitly grants access via OS-level keyring access.
    #[default]
    Auto,
    /// INFINITECODE_HOME/.credentials.json
    /// This file will be readable to InfiniteCode and other applications running as the same user.
    File,
    /// Keyring when available, otherwise fail.
    Keyring,
}
