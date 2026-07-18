//! `select_implementation` — Best-of-N editing orchestrator.
//!
//! Mirrors freebuff's `editor-multi-prompt` pattern. The caller has
//! already drafted N candidate implementations (typically by chaining
//! `preview_edit` / `preview_write` outputs from earlier turns) and
//! needs to pick the best. This tool spawns exactly one
//! "selector" child that emits a `<selected_id>X</selected_id>` marker
//! and returns the chosen candidate.
//!
//! The tool itself stays `ToolExecutionMode::ReadOnly` so the parent
//! model stays in control of the actual file writes — it inspects the
//! returned `chosen.tool_calls` and applies them via its own `edit` /
//! `write` tool calls in the next turn. That keeps the orchestrator
//! from ever being a destructive primitive even if the selector is
//! mis-prompted.

use std::collections::BTreeMap;

use async_trait::async_trait;
use serde::Deserialize;
use serde::Serialize;
use tracing::info;

use infinitecode_protocol::SessionId;

use crate::contracts::{
    ToolCallError, ToolContext, ToolProgressSender, ToolResult, ToolResultContent,
};
use crate::json_schema::JsonSchema;
use crate::tool_handler::ToolHandler;
use crate::tool_spec::{ToolExecutionMode, ToolOutputMode, ToolPreparationFeedback, ToolSpec};
use crate::tools::handlers::orchestrator::{
    letter_id, letter_index, parse_selected_id_marker, run_selector_child,
};

pub struct SelectImplementationHandler {
    spec: ToolSpec,
}

impl Default for SelectImplementationHandler {
    fn default() -> Self {
        Self::new()
    }
}

impl SelectImplementationHandler {
    pub fn new() -> Self {
        Self {
            spec: ToolSpec {
                name: "select_implementation".into(),
                description:
                    "Best-of-N editing orchestrator. Callers pre-draft N implementations of the \
                     same change (e.g. by chaining preview_edit / preview_write to produce \
                     competing diffs), then call this tool to spawn a single selector child \
                     that picks the best candidate by strategy and diff. Returns the chosen \
                     strategy + diff + structured tool_calls that the parent model should \
                     apply via its own edit / write tool calls. Read-only — never mutates the \
                     workspace."
                        .into(),
                input_schema: input_schema(),
                output_mode: ToolOutputMode::Mixed,
                execution_mode: ToolExecutionMode::ReadOnly,
                capability_tags: vec![],
                supports_parallel: false,
                preparation_feedback: ToolPreparationFeedback::None,
                display_name: Some("Select implementation".to_string()),
                supports_cancellation: Some(true),
                supports_streaming: None,
            },
        }
    }
}

#[async_trait]
impl ToolHandler for SelectImplementationHandler {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    async fn handle(
        &self,
        ctx: ToolContext,
        input: serde_json::Value,
        progress: Option<ToolProgressSender>,
    ) -> Result<ToolResult, ToolCallError> {
        let parsed: SelectInput = serde_json::from_value(input).map_err(|error| {
            ToolCallError::InvalidInput(format!(
                "invalid select_implementation input: {error}"
            ))
        })?;

        // Coordinator check first so missing bridges surface as a
        // clean `NeedsConfiguration` instead of a session-id error.
        let coordinator = ctx.agent_coordinator.clone().ok_or_else(|| {
            ToolCallError::NeedsConfiguration(
                "select_implementation requires child agent coordination (parent session only)"
                    .into(),
            )
        })?;
        let parent_session_id = SessionId::try_from(ctx.session_id.clone()).map_err(|error| {
            ToolCallError::InvalidInput(format!("invalid parent session id: {error}"))
        })?;

        if parsed.proposals.is_empty() {
            return Err(ToolCallError::InvalidInput(
                "'proposals' must contain at least one entry".into(),
            ));
        }
        if parsed.proposals.len() > 8 {
            return Err(ToolCallError::InvalidInput(
                "'proposals' can hold at most 8 entries".into(),
            ));
        }
        let problem = parsed.problem.trim();
        if problem.is_empty() {
            return Err(ToolCallError::InvalidInput("'problem' is required".into()));
        }

        info!(
            count = parsed.proposals.len(),
            "select_implementation: spawning selector child"
        );

        let selector_payload = build_selector_prompt(problem, &parsed);
        let selection = run_selector_child(
            coordinator,
            parent_session_id,
            selector_payload,
            ctx.cancel_token,
            progress,
        )
        .await?;

        let chosen_id = parse_selected_id_marker(&selection.text);
        let chosen_index: Option<usize> = chosen_id
            .as_deref()
            .and_then(letter_index);
        if chosen_index.is_none() {
            return Ok(ToolResult::success(
                ToolResultContent::Mixed {
                    text: Some(format!(
                        "(selector emitted no <selected_id> marker. Raw reply follows.)\n\n{}",
                        selection.text.trim()
                    )),
                    json: Some(json_failure(&parsed, &selection.text)),
                },
                "select_implementation: selector did not emit a marker; raw reply returned",
            ));
        }
        let chosen_index = chosen_index.expect("checked Some above");
        let chosen = parsed.proposals.get(chosen_index).cloned();

        Ok(ToolResult::success(
            ToolResultContent::Mixed {
                text: Some(render_chosen_text(chosen.as_ref())),
                json: Some(json_success(&parsed, chosen, chosen_id.as_deref(), &selection.text)),
            },
            format!(
                "select_implementation: chose proposal {} ({} candidates)",
                chosen_id.as_deref().unwrap_or("?"),
                parsed.proposals.len()
            ),
        ))
    }
}

fn render_chosen_text(chosen: Option<&ProposalInput>) -> String {
    match chosen {
        Some(proposal) => {
            let mut out = String::new();
            out.push_str(&format!("# Chosen: {}\n\n", proposal.strategy));
            if let Some(diff) = proposal.diff.as_deref().filter(|d| !d.trim().is_empty()) {
                out.push_str("## Diff\n```\n");
                out.push_str(diff.trim());
                out.push_str("\n```\n\n");
            }
            out.push_str(&format!(
                "Apply the {} suggested tool calls with the regular edit / write tools.\n",
                proposal.tool_calls.len()
            ));
            out
        }
        None => "(no proposal matched the selector marker)\n".to_string(),
    }
}

fn json_success(
    parsed: &SelectInput,
    chosen: Option<ProposalInput>,
    chosen_id: Option<&str>,
    selector_text: &str,
) -> serde_json::Value {
    serde_json::json!({
        "schema": "select_implementation/v1",
        "problem": parsed.problem,
        "selected_id": chosen_id,
        "selected": chosen,
        "alternatives_count": parsed.proposals.len().saturating_sub(chosen.is_some() as usize),
        "selector_reply": selector_text,
    })
}

fn json_failure(parsed: &SelectInput, selector_text: &str) -> serde_json::Value {
    serde_json::json!({
        "schema": "select_implementation/v1",
        "problem": parsed.problem,
        "error": "selector did not emit a <selected_id> marker",
        "selector_reply": selector_text,
        "raw_proposals": parsed.proposals,
    })
}

fn build_selector_prompt(problem: &str, parsed: &SelectInput) -> String {
    let mut body = String::new();
    body.push_str(&format!(
        "You are the selector in a Best-of-N editing workflow. Several candidate implementations \
         (labeled A, B, C, ...) of the same change are available. Pick the single best candidate.\n\n\
         Problem:\n{problem}\n\n"
    ));
    if let Some(criteria) = parsed.selection_criteria.as_deref() {
        body.push_str(&format!(
            "Selection criteria:\n{criteria}\n\n"
        ));
    } else {
        body.push_str(
            "Selection criteria: pick the candidate that is the cleanest, smallest, and best \
             handles edge cases. Prefer reusing existing patterns over introducing new ones.\n\n",
        );
    }

    body.push_str("Candidates:\n");
    for (index, proposal) in parsed.proposals.iter().enumerate() {
        body.push_str(&format!(
            "--- Candidate {} ({}) ---\n",
            letter_id(index),
            proposal.strategy
        ));
        if let Some(diff) = proposal.diff.as_deref() {
            body.push_str(&format!("Diff:\n```\n{}\n```\n", diff.trim()));
        }
        body.push_str(&format!(
            "Tool calls: {} ({}). First one: {}.\n\n",
            proposal.tool_calls.len(),
            summarize_tool_calls(proposal),
            proposal
                .tool_calls
                .first()
                .map(|c| c.tool_name.as_str())
                .unwrap_or("none")
        ));
    }
    body.push_str(
        "Reply ONLY with a single trailing line of the form:\n<selected_id>X</selected_id>\n\
         where X is the letter you chose. Add a brief justification immediately BEFORE the marker \
         if it helps clarity, but the marker MUST be the very last non-whitespace token of your reply.",
    );
    body
}

fn summarize_tool_calls(proposal: &ProposalInput) -> String {
    // Count each exact tool name so the summary stays informative when
    // a proposal mixes `edit`, `write`, `preview_*`, and other tool
    // calls.
    let mut counts: std::collections::BTreeMap<&str, usize> = Default::default();
    for call in &proposal.tool_calls {
        *counts.entry(call.tool_name.as_str()).or_default() += 1;
    }
    let parts: Vec<String> = counts
        .iter()
        .map(|(name, count)| format!("{count} {name}"))
        .collect();
    if parts.is_empty() {
        "none".to_string()
    } else {
        parts.join(", ")
    }
}

fn input_schema() -> JsonSchema {
    JsonSchema::object(
        BTreeMap::from([
            (
                "problem".to_string(),
                JsonSchema::string(Some(
                    "Required: a brief description of the change the proposals address.",
                )),
            ),
            (
                "proposals".to_string(),
                JsonSchema::array(
                    JsonSchema::object(
                        BTreeMap::from([
                            (
                                "id".to_string(),
                                JsonSchema::string(Some(
                                    "Optional caller-assigned id. Falls back to A, B, C… based on order.",
                                )),
                            ),
                            (
                                "strategy".to_string(),
                                JsonSchema::string(Some(
                                    "One-sentence strategy summary the selector uses.",
                                )),
                            ),
                            (
                                "diff".to_string(),
                                JsonSchema::string(Some(
                                    "Unified diff or summary the selector reviews.",
                                )),
                            ),
                            (
                                "tool_calls".to_string(),
                                JsonSchema::array(
                                    JsonSchema::object(
                                        BTreeMap::from([
                                            (
                                                "toolName".to_string(),
                                                JsonSchema::string(Some(
                                                    "edit, write, preview_edit, preview_write, …",
                                                )),
                                            ),
                                            (
                                                "input".to_string(),
                                                JsonSchema {
                                                    description: Some("Call input JSON.".to_string()),
                                                    ..Default::default()
                                                },
                                            ),
                                        ]),
                                        Some(vec!["toolName".to_string(), "input".to_string()]),
                                        Some(true),
                                    ),
                                    Some("Concrete tool calls that realize this proposal."),
                                ),
                            ),
                        ]),
                        Some(vec!["strategy".to_string()]),
                        Some(true),
                    ),
                    Some("1..=8 candidate implementations."),
                ),
            ),
            (
                "selectionCriteria".to_string(),
                JsonSchema::string(Some(
                    "Optional override of the default selection criteria.",
                )),
            ),
        ]),
        Some(vec!["proposals".to_string()]),
        Some(false),
    )
}

#[derive(Debug, Deserialize)]
struct SelectInput {
    problem: String,
    proposals: Vec<ProposalInput>,
    #[serde(default)]
    selection_criteria: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ProposalInput {
    #[serde(default)]
    id: Option<String>,
    strategy: String,
    #[serde(default)]
    diff: Option<String>,
    #[serde(default)]
    tool_calls: Vec<ToolCallInput>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ToolCallInput {
    #[serde(rename = "toolName")]
    tool_name: String,
    #[serde(default)]
    input: serde_json::Value,
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use async_trait::async_trait;
    use infinitecode_protocol::{
        AgentMessageParams, AgentMessageResult, AgentOutputEventKind, AwaitTaskParams,
        AwaitTaskResult, CancelTaskParams, CancelTaskResult, CloseAgentParams, CloseAgentResult,
        ListTasksParams, ListTasksResult, ParentAgentOutputEvent, SessionId, SpawnAgentParams,
        SpawnAgentResult, TaskId, WaitAgentParams, WaitAgentResult,
    };
    use pretty_assertions::assert_eq;
    use tokio::sync::Mutex;
    use tokio_util::sync::CancellationToken;

    use super::*;
    use crate::contracts::{ToolAgentScope, ToolBudgets, ToolTerminalStatus};
    use infinitecode_tools::ToolCallId;

    #[derive(Default)]
    struct FakeCoordinator {
        spawn_log: Mutex<Vec<SpawnAgentParams>>,
        outputs: Mutex<Vec<String>>,
    }

    #[async_trait]
    impl infinitecode_tools::AgentToolCoordinator for FakeCoordinator {
        async fn spawn_agent(
            self: Arc<Self>,
            params: SpawnAgentParams,
        ) -> Result<SpawnAgentResult, ToolCallError> {
            self.spawn_log.lock().await.push(params.clone());
            Ok(SpawnAgentResult {
                task_id: TaskId(format!(
                    "select-{}",
                    self.spawn_log.lock().await.len()
                )),
                child_session_id: SessionId::new(),
                agent_path: format!("root/select/{}", self.spawn_log.lock().await.len()),
                agent_nickname: format!("selector-{}", self.spawn_log.lock().await.len()),
                status: "running".to_string(),
            })
        }

        async fn send_message(
            self: Arc<Self>,
            _params: AgentMessageParams,
        ) -> Result<AgentMessageResult, ToolCallError> {
            Ok(AgentMessageResult {
                delivered: true,
                task_id: TaskId("unused".into()),
            })
        }

        async fn wait_agent(
            self: Arc<Self>,
            _params: WaitAgentParams,
        ) -> Result<WaitAgentResult, ToolCallError> {
            let mut outputs = self.outputs.lock().await;
            let text = if outputs.is_empty() {
                "no candidates".to_string()
            } else {
                outputs.remove(0)
            };
            Ok(WaitAgentResult {
                events: vec![ParentAgentOutputEvent {
                    sequence: 1,
                    agent_path: "root/select".to_string(),
                    agent_nickname: "fake".to_string(),
                    kind: AgentOutputEventKind::AssistantMessage,
                    text: Some(text),
                    status: Some("completed".to_string()),
                }],
                next_sequence: 2,
                timed_out: false,
            })
        }

        async fn list_agents(
            self: Arc<Self>,
            _params: infinitecode_protocol::AgentListParams,
        ) -> Result<Vec<infinitecode_protocol::AgentInfo>, ToolCallError> {
            Ok(Vec::new())
        }

        async fn close_agent(
            self: Arc<Self>,
            _params: CloseAgentParams,
        ) -> Result<CloseAgentResult, ToolCallError> {
            Ok(CloseAgentResult {
                closed: true,
                status: "closed".to_string(),
            })
        }

        async fn await_task(
            self: Arc<Self>,
            _params: AwaitTaskParams,
        ) -> Result<AwaitTaskResult, ToolCallError> {
            Err(ToolCallError::ExecutionFailed(
                "fake await_task unavailable".into(),
            ))
        }

        async fn list_tasks(
            self: Arc<Self>,
            _params: ListTasksParams,
        ) -> Result<ListTasksResult, ToolCallError> {
            Err(ToolCallError::ExecutionFailed(
                "fake list_tasks unavailable".into(),
            ))
        }

        async fn cancel_task(
            self: Arc<Self>,
            _params: CancelTaskParams,
        ) -> Result<CancelTaskResult, ToolCallError> {
            Ok(CancelTaskResult {
                task: infinitecode_protocol::TaskInfo {
                    task_id: TaskId("select-fake".into()),
                    kind: infinitecode_protocol::TaskKind::Agent,
                    state: infinitecode_protocol::TaskState::Canceled,
                    agent: None,
                    command: None,
                },
            })
        }
    }

    fn ctx_with(coordinator: Arc<FakeCoordinator>) -> ToolContext {
        ToolContext {
            tool_call_id: ToolCallId("se-1".into()),
            session_id: SessionId::new().to_string(),
            turn_id: Some("t-1".into()),
            workspace_root: PathBuf::from("/tmp"),
            budgets: ToolBudgets {
                output_limit_bytes: 32_768,
                wall_time_limit_ms: None,
            },
            cancel_token: CancellationToken::new(),
            agent_scope: ToolAgentScope::Parent,
            collaboration_mode: infinitecode_protocol::CollaborationMode::Build,
            agent_coordinator: Some(coordinator),
            client_filesystem: None,
            client_terminal: None,
            file_read_ledger: None,
            network_proxy: None,
            network_no_proxy: None,
        }
    }

    fn proposals() -> serde_json::Value {
        serde_json::json!([
            {
                "strategy": "minimal patch",
                "diff": "@@ -1 +1 @@\n-hello\n+hi\n",
                "tool_calls": [
                    {"toolName": "edit", "input": {"filePath": "a.rs", "oldString": "hello", "newString": "hi"}}
                ],
            },
            {
                "strategy": "function split",
                "diff": "@@ -1 +6 @@\n-hello\n+fn hi() {}\n+fn greet() {}\n+fn shout() {}\n",
                "tool_calls": [
                    {"toolName": "write", "input": {"filePath": "a.rs", "content": "fn hi() {}\nfn greet() {}\n"}}
                ],
            },
        ])
    }

    #[tokio::test]
    async fn select_implementation_picks_winner() {
        let coordinator = Arc::new(FakeCoordinator::default());
        coordinator.outputs.try_lock().unwrap().push(
            "Candidate B is cleaner. <selected_id>A</selected_id>".to_string(),
        );

        let handler = SelectImplementationHandler::new();
        let result = handler
            .handle(
                ctx_with(coordinator.clone()),
                serde_json::json!({
                    "problem": "minimal greeting tweak",
                    "proposals": proposals(),
                }),
                None,
            )
            .await
            .expect("select succeeds");

        assert!(matches!(result.structured_status, ToolTerminalStatus::Completed));
        let spawn_log = coordinator.spawn_log.lock().await.clone();
        // Exactly one selector child spawned.
        assert_eq!(spawn_log.len(), 1);
        assert_eq!(spawn_log[0].tool_policy, infinitecode_protocol::AgentToolPolicy::DenyAll);
        assert_eq!(spawn_log[0].max_turns, Some(1));
        assert_eq!(spawn_log[0].ephemeral, true);
        assert!(spawn_log[0].message.contains("Best-of-N editing workflow"));
        if let ToolResultContent::Mixed { json, .. } = &result.content {
            let json = json.clone().unwrap();
            assert_eq!(json["schema"], "select_implementation/v1");
            assert_eq!(json["selected_id"], "A");
            assert_eq!(json["selected"]["strategy"], "minimal patch");
            assert_eq!(json["selected"]["tool_calls"][0]["toolName"], "edit");
        } else {
            panic!("expected Mixed content with json metadata");
        }
    }

    #[tokio::test]
    async fn select_implementation_handles_no_marker() {
        let coordinator = Arc::new(FakeCoordinator::default());
        coordinator
            .outputs
            .try_lock()
            .unwrap()
            .push("I'm not sure which one is best.".to_string());

        let handler = SelectImplementationHandler::new();
        let result = handler
            .handle(
                ctx_with(coordinator),
                serde_json::json!({
                    "problem": "anything",
                    "proposals": proposals(),
                }),
                None,
            )
            .await
            .expect("returns even without marker");

        if let ToolResultContent::Mixed { json, .. } = &result.content {
            let json = json.clone().unwrap();
            assert_eq!(json["error"], "selector did not emit a <selected_id> marker");
            assert_eq!(json["raw_proposals"].as_array().unwrap().len(), 2);
        } else {
            panic!("expected Mixed content with json metadata");
        }
    }

    #[tokio::test]
    async fn select_implementation_rejects_empty_proposals() {
        let coordinator = Arc::new(FakeCoordinator::default());
        let handler = SelectImplementationHandler::new();
        let error = handler
            .handle(
                ctx_with(coordinator),
                serde_json::json!({ "problem": "anything", "proposals": [] }),
                None,
            )
            .await
            .expect_err("empty proposals");
        assert!(matches!(error, ToolCallError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn select_implementation_needs_coordinator() {
        let mut ctx = ToolContext {
            tool_call_id: ToolCallId("se".into()),
            session_id: SessionId::new().to_string(),
            turn_id: Some("t".into()),
            workspace_root: PathBuf::from("/tmp"),
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
        };
        ctx.cancel_token = CancellationToken::new();
        let handler = SelectImplementationHandler::new();
        let error = handler
            .handle(ctx, serde_json::json!({ "problem": "x", "proposals": proposals() }), None)
            .await
            .expect_err("coordinator required");
        assert!(matches!(error, ToolCallError::NeedsConfiguration(_)));
    }

    #[test]
    fn summarize_tool_calls_groups_calls() {
        let proposal = ProposalInput {
            id: None,
            strategy: "mix".to_string(),
            diff: None,
            tool_calls: vec![
                ToolCallInput {
                    tool_name: "edit".to_string(),
                    input: serde_json::json!({}),
                },
                ToolCallInput {
                    tool_name: "edit".to_string(),
                    input: serde_json::json!({}),
                },
                ToolCallInput {
                    tool_name: "write".to_string(),
                    input: serde_json::json!({}),
                },
                ToolCallInput {
                    tool_name: "preview_edit".to_string(),
                    input: serde_json::json!({}),
                },
                ToolCallInput {
                    tool_name: "exec_command".to_string(),
                    input: serde_json::json!({}),
                },
            ],
        };
        let summary = summarize_tool_calls(&proposal);
        // Function counts each exact tool name and aggregates
        // duplicates. Fixture has two `edit` calls, one `write`, one
        // `preview_edit`, one `exec_command` — `edit` collapses to two.
        assert!(!summary.is_empty(), "summary must be non-empty: {summary}");
        assert!(
            summary.contains("2 edit"),
            "expected aggregated '2 edit' entry, got: {summary}"
        );
        assert!(summary.contains("1 write"));
        assert!(summary.contains("1 preview_edit"));
        assert!(summary.contains("1 exec_command"));
    }
}
