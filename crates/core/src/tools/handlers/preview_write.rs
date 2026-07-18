//! Read-only write preview tool (`preview_write`).
//!
//! Computes the diff that a `write` call would produce without modifying
//! the file. Returns the same structured metadata as `write` but with
//! `execution_mode: ReadOnly` and no filesystem writes.

use std::path::PathBuf;

use async_trait::async_trait;
use infinitecode_tools::ClientTextFileRead;
use tracing::debug;
use tracing::info;

use super::file_change_metadata::write_tool_result;
use crate::contracts::{ToolCallError, ToolContext, ToolProgressSender, ToolResult};
use crate::json_schema::JsonSchema;
use crate::tool_handler::ToolHandler;
use crate::tool_spec::{ToolExecutionMode, ToolOutputMode, ToolSpec};

pub struct PreviewWriteHandler {
    spec: ToolSpec,
}

impl Default for PreviewWriteHandler {
    fn default() -> Self {
        Self::new()
    }
}

impl PreviewWriteHandler {
    pub fn new() -> Self {
        Self {
            spec: ToolSpec {
                name: "preview_write".into(),
                description: "Preview a file write without applying it. Returns the unified diff that would result, but does NOT create or modify the file. Use this to check what a write would look like before committing.".into(),
                input_schema: JsonSchema::object(
                    std::collections::BTreeMap::from([
                        (
                            "filePath".to_string(),
                            JsonSchema::string(Some("The absolute path to the file to preview writing")),
                        ),
                        (
                            "content".to_string(),
                            JsonSchema::string(Some("The content to preview writing to the file")),
                        ),
                    ]),
                    Some(vec!["filePath".to_string(), "content".to_string()]),
                    None,
                ),
                output_mode: ToolOutputMode::Mixed,
                execution_mode: ToolExecutionMode::ReadOnly,
                capability_tags: vec![],
                supports_parallel: true,
                preparation_feedback: crate::tool_spec::ToolPreparationFeedback::None,
                display_name: Some("Preview write".to_string()),
                supports_cancellation: None,
                supports_streaming: None,
            },
        }
    }
}

#[async_trait]
impl ToolHandler for PreviewWriteHandler {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    async fn handle(
        &self,
        ctx: ToolContext,
        input: serde_json::Value,
        _progress: Option<ToolProgressSender>,
    ) -> Result<ToolResult, ToolCallError> {
        let path_str = input["filePath"]
            .as_str()
            .ok_or_else(|| ToolCallError::InvalidInput("missing 'filePath' field".into()))?;
        let content = input["content"]
            .as_str()
            .ok_or_else(|| ToolCallError::InvalidInput("missing 'content' field".into()))?;

        let path = resolve_path(&ctx.workspace_root, path_str);
        info!(path = %path.display(), bytes = content.len(), "previewing write");

        // Read existing content for diff, but do NOT write anything
        let previous = if let Some(client_filesystem) = ctx.client_filesystem.clone() {
            match client_filesystem
                .clone()
                .read_text_file(
                    ctx.session_id.clone(),
                    path.clone(),
                    None,
                    None,
                    ctx.cancel_token.clone(),
                )
                .await
            {
                Ok(ClientTextFileRead::Content(previous)) => Some(previous),
                Ok(ClientTextFileRead::Unsupported) => tokio::fs::read_to_string(&path).await.ok(),
                Err(error) => {
                    debug!(
                        path = %path.display(),
                        %error,
                        "failed to read previous client file before preview write"
                    );
                    None
                }
            }
        } else {
            tokio::fs::read_to_string(&path).await.ok()
        };

        // NOTE: No filesystem write — this is a read-only preview.

        let kind = if previous.is_some() { "update" } else { "add" };
        let summary = if kind == "add" {
            format!(
                "preview write for new file {} ({} bytes)",
                path.display(),
                content.len()
            )
        } else {
            format!(
                "preview write for {} ({} bytes)",
                path.display(),
                content.len()
            )
        };

        Ok(write_tool_result(
            &path,
            previous.as_deref(),
            content,
            summary,
        ))
    }
}

fn resolve_path(cwd: &std::path::Path, path: &str) -> PathBuf {
    let p = PathBuf::from(path);
    if p.is_absolute() { p } else { cwd.join(p) }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use pretty_assertions::assert_eq;
    use tokio_util::sync::CancellationToken;

    use super::super::file_change_metadata::file_mtime;
    use super::*;
    use crate::contracts::{ToolAgentScope, ToolBudgets, ToolTerminalStatus};
    use crate::invocation::ToolCallId;
    use crate::tool_spec::ToolExecutionMode;
    use infinitecode_tools::FileReadLedger;

    fn ctx(root: &std::path::Path, ledger: Arc<FileReadLedger>) -> ToolContext {
        ToolContext {
            tool_call_id: ToolCallId("call-1".to_string()),
            session_id: "session-1".to_string(),
            turn_id: Some("turn-1".to_string()),
            workspace_root: root.to_path_buf(),
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
            file_read_ledger: Some(ledger),
            network_proxy: None,
            network_no_proxy: None,
        }
    }

    #[tokio::test]
    async fn preview_write_new_file_returns_add_diff() {
        let root = tempfile::tempdir().expect("tempdir");
        let path = root.path().join("new.txt");
        let ledger = Arc::new(FileReadLedger::new());

        let result = PreviewWriteHandler::new()
            .handle(
                ctx(root.path(), ledger),
                serde_json::json!({
                    "filePath": path,
                    "content": "hello\nworld\n",
                }),
                None,
            )
            .await
            .expect("handle");

        assert!(matches!(
            result.structured_status,
            ToolTerminalStatus::Completed
        ));
        // File must not exist — preview_write does not create files
        assert!(!path.exists(), "preview_write must not create files");
    }

    #[tokio::test]
    async fn preview_write_existing_file_returns_update_diff() {
        let root = tempfile::tempdir().expect("tempdir");
        let path = root.path().join("existing.txt");
        std::fs::write(&path, "old content").expect("write");
        let ledger = Arc::new(FileReadLedger::new());
        ledger.record_full_read(&path, "old content", file_mtime(&path));

        let result = PreviewWriteHandler::new()
            .handle(
                ctx(root.path(), ledger),
                serde_json::json!({
                    "filePath": path,
                    "content": "new content",
                }),
                None,
            )
            .await
            .expect("handle");

        assert!(matches!(
            result.structured_status,
            ToolTerminalStatus::Completed
        ));
        // File content must remain unchanged
        let content = std::fs::read_to_string(&path).expect("read");
        assert_eq!(
            content, "old content",
            "preview_write must not modify files"
        );
        if let crate::contracts::ToolResultContent::Mixed {
            json: Some(json), ..
        } = &result.content
        {
            assert_eq!(json["files"][0]["kind"], "update");
        } else {
            panic!("expected Mixed content with JSON metadata");
        }
    }

    #[test]
    fn preview_write_is_readonly() {
        let handler = PreviewWriteHandler::new();
        assert_eq!(handler.spec().execution_mode, ToolExecutionMode::ReadOnly);
    }
}
