use async_trait::async_trait;
use devo_config::LocalWebSearchProviderKind;
use devo_config::ResolvedLocalWebSearchConfig;
use serde::Deserialize;
use serde_json::Value;

use crate::contracts::{
    ToolCallError, ToolContext, ToolProgressSender, ToolResult, ToolResultContent,
};
use crate::json_schema::JsonSchema;
use crate::tool_handler::ToolHandler;
use crate::tool_spec::{ToolCapabilityTag, ToolExecutionMode, ToolOutputMode, ToolSpec};

const LOCAL_CONFIG_KEY: &str = "__devo_local_web_search";
const DEFAULT_EXA_BASE_URL: &str = "https://api.exa.ai/search";
const DEFAULT_TAVILY_BASE_URL: &str = "https://api.tavily.com/search";
const DEFAULT_MAX_RESULTS: u32 = 5;

pub struct WebSearchHandler {
    spec: ToolSpec,
}

impl Default for WebSearchHandler {
    fn default() -> Self {
        Self::new()
    }
}

impl WebSearchHandler {
    pub fn new() -> Self {
        Self {
            spec: ToolSpec {
                name: "web_search".into(),
                description: "Search the web using the configured local search provider.".into(),
                input_schema: JsonSchema::object(
                    std::collections::BTreeMap::from([(
                        "query".to_string(),
                        JsonSchema::string(Some("The search query")),
                    )]),
                    Some(vec!["query".to_string()]),
                    None,
                ),
                output_mode: ToolOutputMode::Text,
                execution_mode: ToolExecutionMode::ReadOnly,
                capability_tags: vec![ToolCapabilityTag::NetworkAccess],
                supports_parallel: true,
                preparation_feedback: crate::tool_spec::ToolPreparationFeedback::None,
                display_name: None,
                supports_cancellation: None,
                supports_streaming: None,
            },
        }
    }
}

#[async_trait]
impl ToolHandler for WebSearchHandler {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    async fn handle(
        &self,
        _ctx: ToolContext,
        input: serde_json::Value,
        _progress: Option<ToolProgressSender>,
    ) -> Result<ToolResult, ToolCallError> {
        let query = input["query"].as_str().unwrap_or("").trim();
        if query.is_empty() {
            return Ok(tool_error("Search query is required"));
        }
        let config = input
            .get(LOCAL_CONFIG_KEY)
            .cloned()
            .ok_or_else(|| {
                ToolCallError::NeedsConfiguration(
                    "local web_search provider is not configured for this turn".to_string(),
                )
            })
            .and_then(|value| {
                serde_json::from_value::<ResolvedLocalWebSearchConfig>(value).map_err(|error| {
                    ToolCallError::NeedsConfiguration(format!(
                        "invalid local web_search provider configuration: {error}"
                    ))
                })
            })?;
        let max_results = config
            .max_results
            .or_else(|| {
                input["max_results"]
                    .as_u64()
                    .and_then(|value| u32::try_from(value).ok())
            })
            .unwrap_or(DEFAULT_MAX_RESULTS);

        let response = match config.kind {
            LocalWebSearchProviderKind::Exa => search_exa(&config, query, max_results).await?,
            LocalWebSearchProviderKind::Tavily => {
                search_tavily(&config, query, max_results).await?
            }
        };

        Ok(ToolResult::success(
            ToolResultContent::Text(response),
            "Search completed",
        ))
    }
}

async fn search_exa(
    config: &ResolvedLocalWebSearchConfig,
    query: &str,
    max_results: u32,
) -> Result<String, ToolCallError> {
    let url = config.base_url.as_deref().unwrap_or(DEFAULT_EXA_BASE_URL);
    let response = reqwest::Client::new()
        .post(url)
        .header("x-api-key", &config.api_key)
        .json(&serde_json::json!({
            "query": query,
            "type": "auto",
            "numResults": max_results,
            "contents": { "highlights": true }
        }))
        .send()
        .await
        .map_err(|error| ToolCallError::ExecutionFailed(format!("Exa search failed: {error}")))?;
    response_text("Exa", response)
        .await
        .map(|value| format_exa_results(query, &value))
}

async fn search_tavily(
    config: &ResolvedLocalWebSearchConfig,
    query: &str,
    max_results: u32,
) -> Result<String, ToolCallError> {
    let url = config
        .base_url
        .as_deref()
        .unwrap_or(DEFAULT_TAVILY_BASE_URL);
    let response = reqwest::Client::new()
        .post(url)
        .bearer_auth(&config.api_key)
        .json(&serde_json::json!({
            "query": query,
            "max_results": max_results
        }))
        .send()
        .await
        .map_err(|error| {
            ToolCallError::ExecutionFailed(format!("Tavily search failed: {error}"))
        })?;
    response_text("Tavily", response)
        .await
        .map(|value| format_tavily_results(query, &value))
}

async fn response_text(
    provider: &str,
    response: reqwest::Response,
) -> Result<Value, ToolCallError> {
    let status = response.status();
    let text = response.text().await.map_err(|error| {
        ToolCallError::ExecutionFailed(format!("{provider} search response read failed: {error}"))
    })?;
    if !status.is_success() {
        return Err(ToolCallError::ExecutionFailed(format!(
            "{provider} search error ({status}): {text}"
        )));
    }
    serde_json::from_str(&text).map_err(|error| {
        ToolCallError::ExecutionFailed(format!(
            "{provider} search returned invalid JSON: {error}; body: {text}"
        ))
    })
}

#[derive(Deserialize)]
struct ExaResult {
    title: Option<String>,
    url: Option<String>,
    text: Option<String>,
    summary: Option<String>,
    highlights: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct ExaResponse {
    results: Option<Vec<ExaResult>>,
}

fn format_exa_results(query: &str, value: &Value) -> String {
    let parsed = serde_json::from_value::<ExaResponse>(value.clone())
        .unwrap_or(ExaResponse { results: None });
    format_results(
        query,
        parsed
            .results
            .unwrap_or_default()
            .into_iter()
            .map(|result| {
                let snippet = result.summary.or(result.text).or_else(|| {
                    result
                        .highlights
                        .and_then(|values| values.into_iter().next())
                });
                SearchResultLine {
                    title: result.title,
                    url: result.url,
                    snippet,
                }
            }),
    )
}

#[derive(Deserialize)]
struct TavilyResult {
    title: Option<String>,
    url: Option<String>,
    content: Option<String>,
}

#[derive(Deserialize)]
struct TavilyResponse {
    answer: Option<String>,
    results: Option<Vec<TavilyResult>>,
}

fn format_tavily_results(query: &str, value: &Value) -> String {
    let parsed =
        serde_json::from_value::<TavilyResponse>(value.clone()).unwrap_or(TavilyResponse {
            answer: None,
            results: None,
        });
    let mut text = format_results(
        query,
        parsed
            .results
            .unwrap_or_default()
            .into_iter()
            .map(|result| SearchResultLine {
                title: result.title,
                url: result.url,
                snippet: result.content,
            }),
    );
    if let Some(answer) = parsed.answer.filter(|answer| !answer.trim().is_empty()) {
        text.push_str("\nAnswer:\n");
        text.push_str(answer.trim());
    }
    text
}

struct SearchResultLine {
    title: Option<String>,
    url: Option<String>,
    snippet: Option<String>,
}

fn format_results(query: &str, results: impl IntoIterator<Item = SearchResultLine>) -> String {
    let mut output = format!("Search results for: {query}\n");
    for (index, result) in results.into_iter().enumerate() {
        let title = result
            .title
            .unwrap_or_else(|| "Untitled result".to_string());
        output.push_str(&format!("\n{}. {title}\n", index + 1));
        if let Some(url) = result.url.filter(|url| !url.trim().is_empty()) {
            output.push_str(&format!("URL: {}\n", url.trim()));
        }
        if let Some(snippet) = result.snippet.filter(|snippet| !snippet.trim().is_empty()) {
            output.push_str("Snippet: ");
            output.push_str(snippet.trim());
            output.push('\n');
        }
    }
    output
}

fn tool_error(message: &str) -> ToolResult {
    ToolResult::error(
        ToolResultContent::Text(message.to_string()),
        "Search error",
        ToolCallError::InvalidInput(message.to_string()),
    )
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use super::*;

    #[test]
    fn exa_results_format_title_url_and_snippet() {
        let text = format_exa_results(
            "rust async",
            &json!({
                "results": [
                    {
                        "title": "Async Rust",
                        "url": "https://example.com/rust",
                        "summary": "A concise summary."
                    }
                ]
            }),
        );

        assert_eq!(
            text,
            "Search results for: rust async\n\n1. Async Rust\nURL: https://example.com/rust\nSnippet: A concise summary.\n"
        );
    }

    #[test]
    fn tavily_results_append_answer() {
        let text = format_tavily_results(
            "search api",
            &json!({
                "answer": "Short answer.",
                "results": [
                    {
                        "title": "Search API",
                        "url": "https://example.com/search",
                        "content": "Result content."
                    }
                ]
            }),
        );

        assert_eq!(
            text,
            "Search results for: search api\n\n1. Search API\nURL: https://example.com/search\nSnippet: Result content.\n\nAnswer:\nShort answer."
        );
    }

    #[tokio::test]
    async fn exa_live_search_works_when_api_key_is_configured() {
        let Ok(api_key) = std::env::var("EXA_API_KEY") else {
            eprintln!("skipping Exa live search test because EXA_API_KEY is not set");
            return;
        };
        if api_key.trim().is_empty() {
            eprintln!("skipping Exa live search test because EXA_API_KEY is empty");
            return;
        }

        let config = ResolvedLocalWebSearchConfig {
            provider_id: "exa".to_string(),
            kind: LocalWebSearchProviderKind::Exa,
            api_key,
            base_url: None,
            max_results: Some(2),
        };

        let text = search_exa(&config, "Rust programming language official website", 2)
            .await
            .expect("Exa live search should succeed");

        assert!(text.contains("Search results for: Rust programming language official website"));
        assert!(text.contains("URL:"));
    }
}
