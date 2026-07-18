//! `verify_solution` — structured self-verification reflection tool.
//!
//! The model calls this tool voluntarily before submitting its final answer.
//! The tool does NOT verify anything itself; it returns a structured
//! reflection prompt that asks the model to walk through any criteria and
//! claims, then produce the verification as its next turn output. The
//! verification text becomes part of the conversation history (visible to
//! the user and the audit trail).
//!
//! This is a user-controllable, opt-in tool. It is always registered but the
//! system prompt only mentions it when `agent_behavior.self_verify = true`
//! (see [`crate::agent_behavior_prompts`]).
//!
//! Faithful to the *idea* of harness-engineering "self-check" — but with
//! no benchmark-specific anti-cheat guard, no hidden prompt manipulation,
//! and no special treatment of any provider or model.

use std::collections::BTreeMap;

use async_trait::async_trait;
use serde_json::json;

use crate::contracts::{
    ToolCallError, ToolContext, ToolProgressSender, ToolResult, ToolResultContent,
};
use crate::json_schema::JsonSchema;
use crate::tool_handler::ToolHandler;
use crate::tool_spec::{ToolExecutionMode, ToolOutputMode, ToolPreparationFeedback, ToolSpec};

pub struct VerifySolutionHandler {
    spec: ToolSpec,
}

impl Default for VerifySolutionHandler {
    fn default() -> Self {
        Self::new()
    }
}

impl VerifySolutionHandler {
    pub fn new() -> Self {
        Self {
            spec: ToolSpec {
                name: "verify_solution".into(),
                description: "Perform a structured self-verification reflection before submitting your final answer. Returns a reflection prompt asking you to walk through each criterion and claim against your proposed answer. Use when the answer makes factual claims, includes code that will be executed, or when the task is non-trivial. Skips external tools; this is a structural reflection step that asks you to re-check your reasoning.".into(),
                input_schema: JsonSchema::object(
                    BTreeMap::from([
                        (
                            "answer".to_string(),
                            JsonSchema::string(Some(
                                "Your proposed final answer — the text you would otherwise output now.",
                            )),
                        ),
                        (
                            "criteria".to_string(),
                            JsonSchema::array(
                                JsonSchema::string(None),
                                Some(
                                    "Optional list of explicit constraints from the user's request to verify the answer against.",
                                ),
                            ),
                        ),
                        (
                            "claims".to_string(),
                            JsonSchema::array(
                                JsonSchema::string(None),
                                Some(
                                    "Optional list of factual claims in the answer that the user might want to verify.",
                                ),
                            ),
                        ),
                    ]),
                    Some(vec!["answer".to_string()]),
                    Some(false),
                ),
                output_mode: ToolOutputMode::Text,
                execution_mode: ToolExecutionMode::ReadOnly,
                capability_tags: vec![],
                supports_parallel: true,
                preparation_feedback: ToolPreparationFeedback::None,
                display_name: Some("Verify solution".to_string()),
                supports_cancellation: None,
                supports_streaming: None,
            },
        }
    }
}

#[async_trait]
impl ToolHandler for VerifySolutionHandler {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    async fn handle(
        &self,
        _ctx: ToolContext,
        input: serde_json::Value,
        _progress: Option<ToolProgressSender>,
    ) -> Result<ToolResult, ToolCallError> {
        let answer = input
            .get("answer")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("");
        if answer.is_empty() {
            return Err(ToolCallError::InvalidInput(
                "'answer' must be a non-empty string".to_string(),
            ));
        }

        let criteria = string_array(input.get("criteria"));
        let claims = string_array(input.get("claims"));

        let mut reflection = String::from("## Self-verification reflection\n\n");
        reflection.push_str(
            "Review your proposed answer against the user's original request. For each \
             criterion and each claim, state pass/concern with the supporting evidence. \
             Note corrections. End with one of: 'Final verdict: stands' / 'needs revision' \
             / 'replace with corrected version'.\n\n",
        );

        if !criteria.is_empty() {
            reflection.push_str("### Criteria to verify\n");
            for (index, criterion) in criteria.iter().enumerate() {
                reflection.push_str(&format!("{}. {}\n", index + 1, criterion));
            }
            reflection.push('\n');
        }

        if !claims.is_empty() {
            reflection.push_str("### Factual claims to verify\n");
            for (index, claim) in claims.iter().enumerate() {
                reflection.push_str(&format!("{}. {}\n", index + 1, claim));
            }
            reflection.push('\n');
        }

        reflection.push_str("### Proposed answer under review\n");
        reflection.push_str(answer);
        if !reflection.ends_with('\n') {
            reflection.push('\n');
        }

        Ok(ToolResult::success(
            ToolResultContent::Mixed {
                text: Some(reflection),
                json: Some(json!({
                    "criteria_count": criteria.len(),
                    "claims_count": claims.len(),
                    "answer_chars": answer.chars().count(),
                })),
            },
            "Verification reflection prompt",
        ))
    }
}

fn string_array(value: Option<&serde_json::Value>) -> Vec<String> {
    let Some(arr) = value.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use infinitecode_protocol::CollaborationMode;
    use infinitecode_tools::ToolCallId;
    use infinitecode_tools::contracts::{ToolBudgets, ToolContext};
    use pretty_assertions::assert_eq;
    use tokio_util::sync::CancellationToken;

    use super::*;
    use crate::contracts::ToolAgentScope;

    fn test_ctx() -> ToolContext {
        ToolContext {
            tool_call_id: ToolCallId("test-call".to_string()),
            session_id: "session-1".to_string(),
            turn_id: Some("turn-1".to_string()),
            workspace_root: PathBuf::from("/tmp"),
            budgets: ToolBudgets {
                output_limit_bytes: 1024,
                wall_time_limit_ms: None,
            },
            cancel_token: CancellationToken::new(),
            agent_scope: ToolAgentScope::Parent,
            collaboration_mode: CollaborationMode::Build,
            agent_coordinator: None,
            client_filesystem: None,
            client_terminal: None,
            file_read_ledger: None,
            network_proxy: None,
            network_no_proxy: None,
        }
    }

    #[tokio::test]
    async fn handler_rejects_empty_answer() {
        let handler = VerifySolutionHandler::new();
        let error = handler
            .handle(test_ctx(), serde_json::json!({ "answer": "" }), None)
            .await
            .expect_err("empty answer must fail");
        assert!(matches!(error, ToolCallError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn handler_rejects_missing_answer() {
        let handler = VerifySolutionHandler::new();
        let error = handler
            .handle(test_ctx(), serde_json::json!({}), None)
            .await
            .expect_err("missing answer must fail");
        assert!(matches!(error, ToolCallError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn handler_returns_reflection_with_answer_only() {
        let handler = VerifySolutionHandler::new();
        let result = handler
            .handle(
                test_ctx(),
                serde_json::json!({ "answer": "The answer is 42." }),
                None,
            )
            .await
            .expect("answer-only succeeds");
        let text = match result.content {
            ToolResultContent::Mixed { text, .. } => text.unwrap_or_default(),
            ToolResultContent::Text(text) => text,
            _ => panic!("unexpected content variant"),
        };
        assert!(text.contains("Self-verification reflection"));
        assert!(text.contains("Proposed answer under review"));
        assert!(text.contains("The answer is 42."));
        assert!(!text.contains("Criteria to verify"));
        assert!(!text.contains("Factual claims to verify"));
        assert_eq!(result.result_summary, "Verification reflection prompt");
    }

    #[tokio::test]
    async fn handler_renders_criteria_and_claims_when_provided() {
        let handler = VerifySolutionHandler::new();
        let result = handler
            .handle(
                test_ctx(),
                serde_json::json!({
                    "answer": "Updated foo.rs",
                    "criteria": ["use the read tool", "preserve indentation"],
                    "claims": ["the file is 200 lines"],
                }),
                None,
            )
            .await
            .expect("with criteria and claims succeeds");
        let text = match result.content {
            ToolResultContent::Mixed { text, .. } => text.unwrap_or_default(),
            ToolResultContent::Text(text) => text,
            _ => panic!("unexpected content variant"),
        };
        assert!(text.contains("### Criteria to verify"));
        assert!(text.contains("1. use the read tool"));
        assert!(text.contains("2. preserve indentation"));
        assert!(text.contains("### Factual claims to verify"));
        assert!(text.contains("1. the file is 200 lines"));
    }

    #[tokio::test]
    async fn handler_ignores_non_string_array_entries() {
        let handler = VerifySolutionHandler::new();
        let result = handler
            .handle(
                test_ctx(),
                serde_json::json!({
                    "answer": "ok",
                    "criteria": ["valid", 42, "", "also valid"],
                    "claims": ["valid", null],
                }),
                None,
            )
            .await
            .expect("non-string entries are dropped");
        let text = match result.content {
            ToolResultContent::Mixed { text, .. } => text.unwrap_or_default(),
            ToolResultContent::Text(text) => text,
            _ => panic!("unexpected content variant"),
        };
        assert!(text.contains("1. valid"));
        assert!(text.contains("2. also valid"));
        // 42 was filtered (not a string), null was filtered
        assert!(!text.contains("3."));
    }

    #[test]
    fn spec_has_expected_metadata() {
        let handler = VerifySolutionHandler::new();
        let spec = handler.spec();
        assert_eq!(spec.name, "verify_solution");
        assert_eq!(spec.execution_mode, ToolExecutionMode::ReadOnly);
        assert!(spec.supports_parallel);
        assert_eq!(spec.display_name.as_deref(), Some("Verify solution"));
        let schema = spec.input_schema.to_json_value();
        let required = schema["required"].as_array().expect("required array");
        assert!(required.iter().any(|v| v == "answer"));
        assert!(schema["properties"]["criteria"].is_object());
        assert!(schema["properties"]["claims"].is_object());
    }
}
