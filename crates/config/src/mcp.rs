use serde::Deserialize;
use serde::Serialize;

/// Environment variable forwarding rule for configured MCP servers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum McpServerEnvVar {
    /// Legacy config shape where the string is the environment variable name.
    Name(String),
    /// Explicit config shape that may choose where the value should be read.
    Config {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source: Option<String>,
    },
}

impl McpServerEnvVar {
    pub fn name(&self) -> &str {
        match self {
            Self::Name(name) | Self::Config { name, .. } => name,
        }
    }

    pub fn is_remote_source(&self) -> bool {
        matches!(
            self,
            Self::Config {
                source: Some(source),
                ..
            } if source == "remote"
        )
    }
}

impl From<String> for McpServerEnvVar {
    fn from(value: String) -> Self {
        Self::Name(value)
    }
}

impl From<&str> for McpServerEnvVar {
    fn from(value: &str) -> Self {
        Self::Name(value.to_string())
    }
}
