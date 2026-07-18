//! `suggest_followups` — emit clickable "what's next?" chip suggestions.
//!
//! Model-side behaviour:
//! - This tool is **read-only / UI-only**. It produces no side effects.
//! - The handler validates the chips so the renderer can trust the input.
//! - The canonical `ToolResult::content` carries a short ack text. UI
//!   surfaces read `input.followups` directly from the raw tool call to
//!   draw chip rows.
//!
//! Behaviour-equivalent to freebuff's `suggest_followups`. See
//! `crates/core/prompts/agent-behavior/suggest-followups.md` for the
//! agent-side prompt that teaches the model to emit this tool near the
//! end of non-trivial turns.

use std::collections::BTreeMap;

use async_trait::async_trait;

use crate::contracts::{
    ToolCallError, ToolContext, ToolProgressSender, ToolResult, ToolResultContent,
};
use crate::json_schema::JsonSchema;
use crate::tool_handler::ToolHandler;
use crate::tool_spec::{
    ToolExecutionMode, ToolOutputMode, ToolPreparationFeedback, ToolSpec,
};

/// Hard limits the renderer can rely on without re-parsing input.
pub const MAX_FOLLOWUPS: usize = 6;
pub const MIN_FOLLOWUPS: usize = 1;
pub const MAX_LABEL_CHARS: usize = 60;
pub const MAX_PROMPT_CHARS: usize = 800;

pub struct SuggestFollowupsHandler {
    spec: ToolSpec,
}

impl Default for SuggestFollowupsHandler {
    fn default() -> Self {
        Self::new()
    }
}

impl SuggestFollowupsHandler {
    pub fn new() -> Self {
        let item_schema = JsonSchema::object(
            BTreeMap::from([
                (
                    "emoji".to_string(),
                    JsonSchema::string(Some(
                        "A single emoji that signals the action category. \
                         Conventions: 🚀 ship/run, 🧪 test, 🔍 explore, \
                         🛠 modify/refactor, 📖 read/docs, 💡 idea, \
                         ⚡ fix/perf, ✅ verify, 📝 docs, 🎨 style.",
                    )),
                ),
                (
                    "label".to_string(),
                    JsonSchema::string(Some(
                        "Short chip text shown to the user (≤60 chars).",
                    )),
                ),
                (
                    "prompt".to_string(),
                    JsonSchema::string(Some(
                        "Full instruction that will be sent back as a user \
                         turn if the user clicks the chip (≤800 chars). \
                         Write it as if the user had typed it themselves.",
                    )),
                ),
            ]),
            Some(vec![
                "emoji".to_string(),
                "label".to_string(),
                "prompt".to_string(),
            ]),
            Some(false),
        );

        let spec = ToolSpec {
            name: "suggest_followups".into(),
            description:
                "Offer 1–6 clickable next steps at the end of a non-trivial turn. \
                 Each chip becomes a button the user can click to send that exact \
                 prompt back as a new user turn. Use this whenever you can foresee \
                 at least one concrete useful follow-up; skip it for trivial \
                 greetings or terminal states (e.g. one-word answers, simple \
                 syntax fixes, single-tool runs).\n\n\
                 Each follow-up object requires three fields: `emoji` (a single \
                 emoji signalling intent), `label` (short text on the chip, ≤60 \
                 chars), `prompt` (the exact instruction the chip sends, ≤800 \
                 chars). 1–6 chips per call; never duplicate intents; do not \
                 include chips whose prompt essentially restates the last user \
                 turn."
                    .into(),
            input_schema: JsonSchema::object(
                BTreeMap::from([(
                    "followups".to_string(),
                    JsonSchema::array(
                        item_schema,
                        Some("1 to 6 followups, ordered by importance."),
                    ),
                )]),
                Some(vec!["followups".to_string()]),
                Some(false),
            ),
            output_mode: ToolOutputMode::Text,
            execution_mode: ToolExecutionMode::ReadOnly,
            capability_tags: vec![],
            supports_parallel: true,
            preparation_feedback: ToolPreparationFeedback::None,
            display_name: Some("Suggest followups".into()),
            supports_cancellation: None,
            supports_streaming: None,
        };

        Self { spec }
    }
}

#[async_trait]
impl ToolHandler for SuggestFollowupsHandler {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    async fn handle(
        &self,
        _ctx: ToolContext,
        input: serde_json::Value,
        _progress: Option<ToolProgressSender>,
    ) -> Result<ToolResult, ToolCallError> {
        let followups = input
            .get("followups")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                ToolCallError::InvalidInput("missing 'followups' array".to_string())
            })?;

        if followups.len() < MIN_FOLLOWUPS {
            return Err(ToolCallError::InvalidInput(format!(
                "followups array must contain at least {MIN_FOLLOWUPS} item"
            )));
        }
        if followups.len() > MAX_FOLLOWUPS {
            return Err(ToolCallError::InvalidInput(format!(
                "followups array limited to {MAX_FOLLOWUPS} items"
            )));
        }

        for (idx, item) in followups.iter().enumerate() {
            let label = item
                .get("label")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    ToolCallError::InvalidInput(format!(
                        "followups[{idx}].label missing or not a string"
                    ))
                })?;
            let prompt = item
                .get("prompt")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    ToolCallError::InvalidInput(format!(
                        "followups[{idx}].prompt missing or not a string"
                    ))
                })?;
            let emoji = item
                .get("emoji")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    ToolCallError::InvalidInput(format!(
                        "followups[{idx}].emoji missing or not a string"
                    ))
                })?;

            if emoji.is_empty() {
                return Err(ToolCallError::InvalidInput(format!(
                    "followups[{idx}].emoji must be non-empty"
                )));
            }
            if label.chars().count() > MAX_LABEL_CHARS {
                return Err(ToolCallError::InvalidInput(format!(
                    "followups[{idx}].label exceeds {MAX_LABEL_CHARS} chars"
                )));
            }
            if prompt.chars().count() > MAX_PROMPT_CHARS {
                return Err(ToolCallError::InvalidInput(format!(
                    "followups[{idx}].prompt exceeds {MAX_PROMPT_CHARS} chars"
                )));
            }
        }

        // Renderers read tool.input.followups directly. The canonical text is
        // just an acknowledgement so the model sees "this is recorded" in
        // subsequent turns without bloating the context with the chip list.
        Ok(ToolResult::success(
            ToolResultContent::Text(format!(
                "Recorded {} followup suggestion(s) — UI will render them as \
                 clickable chip rows below the message.",
                followups.len()
            )),
            "Followups ready",
        ))
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use infinitecode_protocol::CollaborationMode;
    use infinitecode_tools::contracts::{ToolBudgets, ToolContext};
    use infinitecode_tools::ToolCallId;
    use pretty_assertions::assert_eq;
    use tokio_util::sync::CancellationToken;

    use super::*;
    use crate::contracts::ToolAgentScope;

    fn test_ctx() -> ToolContext {
        ToolContext {
            tool_call_id: ToolCallId("test-call".into()),
            session_id: "session-1".into(),
            turn_id: Some("turn-1".into()),
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
    async fn rejects_missing_followups() {
        let handler = SuggestFollowupsHandler::new();
        let error = handler
            .handle(test_ctx(), serde_json::json!({}), None)
            .await
            .expect_err("missing followups must fail");
        assert!(matches!(error, ToolCallError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn rejects_empty_array() {
        let handler = SuggestFollowupsHandler::new();
        let error = handler
            .handle(test_ctx(), serde_json::json!({"followups": []}), None)
            .await
            .expect_err("empty array must fail");
        assert!(matches!(error, ToolCallError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn rejects_too_many_items() {
        let items: Vec<_> = (0..(MAX_FOLLOWUPS + 3))
            .map(|i| {
                serde_json::json!({
                    "emoji": "🚀",
                    "label": format!("item {i}"),
                    "prompt": format!("do thing number {i}"),
                })
            })
            .collect();
        let handler = SuggestFollowupsHandler::new();
        let error = handler
            .handle(test_ctx(), serde_json::json!({"followups": items}), None)
            .await
            .expect_err("too many items must fail");
        assert!(matches!(error, ToolCallError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn rejects_label_too_long() {
        let handler = SuggestFollowupsHandler::new();
        let oversized = "a".repeat(MAX_LABEL_CHARS + 1);
        let error = handler
            .handle(
                test_ctx(),
                serde_json::json!({"followups": [{
                    "emoji": "🚀",
                    "label": oversized,
                    "prompt": "fine",
                }]}),
                None,
            )
            .await
            .expect_err("label too long must fail");
        assert!(matches!(error, ToolCallError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn rejects_prompt_too_long() {
        let handler = SuggestFollowupsHandler::new();
        let oversized = "p".repeat(MAX_PROMPT_CHARS + 1);
        let error = handler
            .handle(
                test_ctx(),
                serde_json::json!({"followups": [{
                    "emoji": "🚀",
                    "label": "ok",
                    "prompt": oversized,
                }]}),
                None,
            )
            .await
            .expect_err("prompt too long must fail");
        assert!(matches!(error, ToolCallError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn rejects_missing_field() {
        let handler = SuggestFollowupsHandler::new();
        let error = handler
            .handle(
                test_ctx(),
                serde_json::json!({"followups": [{
                    "emoji": "🚀",
                    "label": "ok"
                }]}),
                None,
            )
            .await
            .expect_err("missing prompt must fail");
        assert!(matches!(error, ToolCallError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn accepts_valid_batch() {
        let handler = SuggestFollowupsHandler::new();
        let result = handler
            .handle(
                test_ctx(),
                serde_json::json!({"followups": [
                    {"emoji": "🚀", "label": "Ship it", "prompt": "commit + push"},
                    {"emoji": "🧪", "label": "Run tests", "prompt": "run the test suite"},
                ]}),
                None,
            )
            .await
            .expect("valid batch succeeds");
        assert!(matches!(
            result.structured_status,
            crate::contracts::ToolTerminalStatus::Completed
        ));
        assert_eq!(result.result_summary, "Followups ready");
    }

    #[test]
    fn spec_metadata_is_correct() {
        let handler = SuggestFollowupsHandler::new();
        let spec = handler.spec();
        assert_eq!(spec.name, "suggest_followups");
        assert_eq!(spec.execution_mode, ToolExecutionMode::ReadOnly);
        assert!(spec.supports_parallel);
        assert_eq!(spec.display_name.as_deref(), Some("Suggest followups"));
        assert!(spec.description.contains("1"));
        assert!(spec.description.contains("6"));
    }
}
