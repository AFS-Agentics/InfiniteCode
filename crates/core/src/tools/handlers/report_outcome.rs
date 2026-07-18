//! Structured outcome reporter (`report_outcome`).
//!
//! Subagents call this tool to pass structured JSON findings back to the
//! parent agent. The tool accepts arbitrary JSON, validates the structure,
//! and returns it as the tool result. No filesystem side effects.

use async_trait::async_trait;
use tracing::debug;

use crate::contracts::{
    ToolCallError, ToolContext, ToolProgressSender, ToolResult, ToolResultContent,
};
use crate::json_schema::JsonSchema;
use crate::tool_handler::ToolHandler;
use crate::tool_spec::{ToolExecutionMode, ToolOutputMode, ToolSpec};

pub struct ReportOutcomeHandler {
    spec: ToolSpec,
}

impl Default for ReportOutcomeHandler {
    fn default() -> Self {
        Self::new()
    }
}

impl ReportOutcomeHandler {
    pub fn new() -> Self {
        Self {
            spec: ToolSpec {
                name: "report_outcome".into(),
                description:
                    "Report structured outcomes from a subagent. Accepts arbitrary JSON \
                     findings and returns them so the parent can review."
                        .into(),
                input_schema: JsonSchema::object(
                    std::collections::BTreeMap::from([(
                        "findings".to_string(),
                        JsonSchema {
                            description: Some(
                                "Structured findings to report. Accepts any JSON value (object or array)."
                                    .to_string(),
                            ),
                            ..Default::default()
                        },
                    )]),
                    Some(vec!["findings".to_string()]),
                    Some(false),
                ),
                output_mode: ToolOutputMode::Mixed,
                execution_mode: ToolExecutionMode::ReadOnly,
                capability_tags: vec![],
                supports_parallel: true,
                preparation_feedback: crate::tool_spec::ToolPreparationFeedback::None,
                display_name: Some("Report outcome".to_string()),
                supports_cancellation: None,
                supports_streaming: None,
            },
        }
    }
}

#[async_trait]
impl ToolHandler for ReportOutcomeHandler {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    async fn handle(
        &self,
        _ctx: ToolContext,
        input: serde_json::Value,
        _progress: Option<ToolProgressSender>,
    ) -> Result<ToolResult, ToolCallError> {
        let findings = &input["findings"];
        if !findings.is_object() && !findings.is_array() {
            return Err(ToolCallError::InvalidInput(
                "'findings' must be a JSON object or array".into(),
            ));
        }

        debug!(
            findings = %serde_json::to_string(findings).unwrap_or_default(),
            "report_outcome received findings"
        );

        Ok(ToolResult::success(
            ToolResultContent::Mixed {
                json: Some(serde_json::json!({
                    "status": "reported",
                    "findings": findings,
                })),
                text: Some("Findings reported successfully.".to_string()),
            },
            "Reported outcome successfully",
        ))
    }
}

#[cfg(test)]
mod tests {
    use tokio_util::sync::CancellationToken;

    use super::*;
    use crate::contracts::{ToolAgentScope, ToolBudgets, ToolTerminalStatus};
    use crate::invocation::ToolCallId;
    use crate::tool_spec::ToolExecutionMode;

    fn ctx() -> ToolContext {
        ToolContext {
            tool_call_id: ToolCallId("call-1".to_string()),
            session_id: "session-1".to_string(),
            turn_id: Some("turn-1".to_string()),
            workspace_root: std::path::PathBuf::from("/tmp"),
            budgets: ToolBudgets {
                output_limit_bytes: 32_768,
                wall_time_limit_ms: None,
            },
            cancel_token: CancellationToken::new(),
            agent_scope: ToolAgentScope::Parent,
            collaboration_mode: infinitecode_protocol::CollaborationMode::Build,
            agent_coordinator: None,
            client_filesystem: None,
            client_terminal: None,
            file_read_ledger: None,
            network_proxy: None,
            network_no_proxy: None,
        }
    }

    #[tokio::test]
    async fn report_outcome_accepts_object() {
        let result = ReportOutcomeHandler::new()
            .handle(
                ctx(),
                serde_json::json!({
                    "findings": {
                        "quality": "good",
                        "issues": [],
                        "summary": "All checks passed",
                    },
                }),
                None,
            )
            .await
            .expect("handle");

        assert!(matches!(
            result.structured_status,
            ToolTerminalStatus::Completed
        ));
        if let ToolResultContent::Mixed {
            json: Some(json),
            text: _,
        } = &result.content
        {
            assert_eq!(json["status"], "reported");
            assert_eq!(json["findings"]["quality"], "good");
        } else {
            panic!("expected Mixed content with JSON metadata");
        }
    }

    #[tokio::test]
    async fn report_outcome_accepts_array() {
        let result = ReportOutcomeHandler::new()
            .handle(
                ctx(),
                serde_json::json!({
                    "findings": [
                        { "proposal": "use Vec<u8>", "confidence": 0.9 },
                        { "proposal": "use Box<[u8]>", "confidence": 0.7 },
                    ],
                }),
                None,
            )
            .await
            .expect("handle");

        assert!(matches!(
            result.structured_status,
            ToolTerminalStatus::Completed
        ));
        if let ToolResultContent::Mixed {
            json: Some(json),
            text: _,
        } = &result.content
        {
            assert_eq!(json["findings"][0]["proposal"], "use Vec<u8>");
        } else {
            panic!("expected Mixed content with JSON metadata");
        }
    }

    #[tokio::test]
    async fn report_outcome_rejects_primitive() {
        let result = ReportOutcomeHandler::new()
            .handle(
                ctx(),
                serde_json::json!({ "findings": "just a string" }),
                None,
            )
            .await;

        assert!(result.is_err(), "string findings should be rejected");
    }

    #[test]
    fn report_outcome_is_readonly() {
        let handler = ReportOutcomeHandler::new();
        assert_eq!(handler.spec().execution_mode, ToolExecutionMode::ReadOnly);
    }
}
