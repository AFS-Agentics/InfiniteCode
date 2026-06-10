use serde::Deserialize;
use serde::Serialize;

/// Provider-hosted tools executed by the model provider rather than by Devo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HostedToolDefinition {
    WebSearch(HostedWebSearchTool),
}

/// Provider-neutral options for hosted web search.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct HostedWebSearchTool {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_context_size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_uses: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anthropic_tool_type: Option<String>,
}

impl HostedWebSearchTool {
    pub fn new() -> Self {
        Self::default()
    }
}
