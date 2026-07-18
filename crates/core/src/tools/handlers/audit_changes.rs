//! `audit_changes` — multi-prompt reviewer orchestrator.
//!
//! Mirrors freebuff's `code-reviewer-multi-prompt` pattern. Spawns N
//! ephemeral single-turn reviewer children in parallel, each focused on
//! a different perspective against the same diff/summary, and
//! aggregates the responses into a structured
//! `{reviews: [{perspective, text}], summary}` payload.
//!
//! Default perspectives are fixed in [`default_perspectives`] so the
//! orchestrator works without extra configuration. Callers can override
//! via `perspectives`. The orchestrator itself stays
//! `ToolExecutionMode::ReadOnly` so it can run from Plan mode and
//! cannot be used as a destructive primitive.

use std::collections::BTreeMap;

use async_trait::async_trait;
use tracing::info;

use infinitecode_protocol::SessionId;

use crate::contracts::{
    ToolCallError, ToolContext, ToolProgressSender, ToolResult, ToolResultContent,
};
use crate::json_schema::JsonSchema;
use crate::tool_handler::ToolHandler;
use crate::tool_spec::{ToolExecutionMode, ToolOutputMode, ToolPreparationFeedback, ToolSpec};
use crate::tools::handlers::orchestrator::{run_parallel_children, ChildOutput};

pub struct AuditChangesHandler {
    spec: ToolSpec,
}

impl Default for AuditChangesHandler {
    fn default() -> Self {
        Self::new()
    }
}

impl AuditChangesHandler {
    pub fn new() -> Self {
        Self {
            spec: ToolSpec {
                name: "audit_changes".into(),
                description:
                    "Multi-prompt reviewer. Spawns N ephemeral reviewer children in parallel, \
                     each focused on a different lens (correctness, security, performance, \
                     maintainability, …) against the same change summary. Aggregates the \
                     reviews into a structured payload. Read-only — never mutates the workspace."
                        .into(),
                input_schema: input_schema(),
                output_mode: ToolOutputMode::Mixed,
                execution_mode: ToolExecutionMode::ReadOnly,
                capability_tags: vec![],
                supports_parallel: false,
                preparation_feedback: ToolPreparationFeedback::None,
                display_name: Some("Audit changes".to_string()),
                supports_cancellation: Some(true),
                supports_streaming: None,
            },
        }
    }
}

#[async_trait]
impl ToolHandler for AuditChangesHandler {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    async fn handle(
        &self,
        ctx: ToolContext,
        input: serde_json::Value,
        progress: Option<ToolProgressSender>,
    ) -> Result<ToolResult, ToolCallError> {
        let parsed: AuditInput = serde_json::from_value(input).map_err(|error| {
            ToolCallError::InvalidInput(format!("invalid audit_changes input: {error}"))
        })?;

        let changes = parsed.changes.trim();
        if changes.is_empty() {
            return Err(ToolCallError::InvalidInput("'changes' is required".into()));
        }
        // Check the coordinator first so that a missing child-agent
        // bridge surfaces a clean `NeedsConfiguration` before the
        // session-id parser gets a chance to reject the test fixture.
        let coordinator = ctx.agent_coordinator.clone().ok_or_else(|| {
            ToolCallError::NeedsConfiguration(
                "audit_changes requires child agent coordination (parent session only)".into(),
            )
        })?;

        let parent_session_id = SessionId::try_from(ctx.session_id.clone()).map_err(|error| {
            ToolCallError::InvalidInput(format!("invalid parent session id: {error}"))
        })?;

        let perspectives = parsed
            .perspectives
            .clone()
            .unwrap_or_else(default_perspectives);
        if perspectives.is_empty() {
            return Err(ToolCallError::InvalidInput(
                "perspectives must contain at least one entry".into(),
            ));
        }
        if perspectives.len() > 8 {
            return Err(ToolCallError::InvalidInput(
                "perspectives can hold at most 8 entries".into(),
            ));
        }

        info!(
            n = perspectives.len(),
            changes_chars = changes.chars().count(),
            "audit_changes: spawning reviewer children"
        );

        let briefs = perspectives.iter().enumerate().map(|(idx, perspective)| {
            let role = format!("reviewer-{}", perspective);
            let prompt =
                build_reviewer_prompt(changes, perspective, idx, parsed.max_chars_per_review);
            (role, prompt)
        });

        let children = run_parallel_children(
            coordinator,
            parent_session_id,
            "reviewer",
            briefs,
            ctx.cancel_token.clone(),
            progress,
        )
        .await?;

        let payload = build_review_aggregate(
            parsed.perspectives.as_deref(),
            &children,
            changes,
            parsed.max_chars_per_review,
        );
        let succeeded = children.iter().filter(|c| c.succeeded).count();
        let summary_text = payload["summary"].as_str().unwrap_or("").to_string();

        Ok(ToolResult::success(
            ToolResultContent::Mixed {
                text: Some(summary_text),
                json: Some(payload),
            },
            format!(
                "audit_changes: aggregated {} / {} reviews",
                succeeded,
                children.len()
            ),
        ))
    }
}

fn default_perspectives() -> Vec<String> {
    vec![
        "correctness and edge cases".to_string(),
        "security concerns".to_string(),
        "performance and maintainability".to_string(),
        "simplify / reuse / readability".to_string(),
    ]
}

fn build_reviewer_prompt(
    changes: &str,
    perspective: &str,
    index: usize,
    max_chars: Option<u32>,
) -> String {
    let label = crate::tools::handlers::orchestrator::letter_id(index);
    let budget_hint = max_chars
        .map(|n| {
            format!(
                "         - Aim for ~{n} characters total (caller-supplied soft cap).\n"
            )
        })
        .unwrap_or_else(|| "         - Stay under 400 words.\n".to_string());
    format!(
        "You are reviewer candidate {label}. Provide a focused, brief, candid review of the \
         following changes from exactly one lens. Do NOT use any tools.\n\n\
         Focus lens: {perspective}\n\n\
         Changes to review:\n```\n{changes}\n```\n\n\
         Output rules:\n\
         - Lead with the highest-impact finding (1-2 sentences).\n\
         - Cover 3-6 specific observations tied to lines / functions when possible.\n\
         - If everything looks fine for this lens, say so explicitly — don't invent issues.\n\
         - End with a one-line verdict: 'PASS' / 'NEEDS_FIX' / 'WARN'.\n{budget_hint}"
    )
}

fn build_review_aggregate(
    requested: Option<&[String]>,
    children: &[ChildOutput],
    changes: &str,
    max_chars_per_review: Option<u32>,
) -> serde_json::Value {
    // Hard-truncate each reviewer reply so the parent model never
    // gets a runaway 4k-token review. `flatten_verdicts` keeps running
    // against the *original* child text so verdict detection stays
    // robust even if the truncation marker cuts off the trailing
    // verdict line; the truncated text is purely a context cap on the
    // message that flows back to the parent model.
    let reviews: Vec<serde_json::Value> = children
        .iter()
        .enumerate()
        .map(|(idx, child)| {
            let perspective = requested
                .and_then(|r| r.get(idx))
                .cloned()
                .unwrap_or_else(|| child.role.clone());
            let truncated = truncate_text(&child.text, max_chars_per_review);
            serde_json::json!({
                "perspective": perspective,
                "role": child.role,
                "nickname": child.nickname,
                "succeeded": child.succeeded,
                "text": truncated.text,
                "truncated": truncated.was_truncated,
                "original_chars": child.text.chars().count(),
            })
        })
        .collect();

    // Findings are computed against the *original* text so PASS /
    // WARN / NEEDS_FIX verdict detection never sees a half-line.
    let findings = flatten_verdicts(children);
    let summary = render_review_summary(&findings, children.len());

    serde_json::json!({
        "schema": "audit_changes/v1",
        "changes_chars": changes.chars().count(),
        "reviews": reviews,
        "findings": findings,
        "summary": summary,
    })
}

#[derive(Debug, Default, Clone)]
struct TruncationOutcome {
    text: String,
    was_truncated: bool,
}

/// Truncate `text` to at most `max_chars` characters when supplied.
/// Truncation is char-aware and appends `\n[truncated at N chars]` so
/// downstream consumers can tell the value was capped. When
/// `max_chars` is `None` or larger than the char count, returns the
/// text unchanged.
fn truncate_text(text: &str, max_chars: Option<u32>) -> TruncationOutcome {
    let Some(cap) = max_chars else {
        return TruncationOutcome {
            text: text.to_string(),
            was_truncated: false,
        };
    };
    let total = text.chars().count();
    if total <= cap as usize {
        return TruncationOutcome {
            text: text.to_string(),
            was_truncated: false,
        };
    }
    // Use a compact marker so even modest caps (e.g. 8) keep a real
    // text prefix. Marker is 9 chars; we cap `keep` at cap/2 so even
    // pathological small caps make room for the marker and a few
    // chars of body.
    let marker = format!("[trunc @{cap}]");
    let marker_len = marker.chars().count();
    let budget = (cap as usize / 2).max(1);
    let keep = (cap as usize).saturating_sub(marker_len.max(budget));
    let body_chars = keep.min(budget.max(1));
    let mut out: String = text.chars().take(body_chars).collect();
    if out.chars().count() + marker_len <= cap as usize {
        out.push(' ');
        out.push_str(&marker);
    } else {
        // Marker alone fits — emit it as the entire truncated body.
        out = marker.chars().take(cap as usize).collect();
    }
    TruncationOutcome {
        text: out,
        was_truncated: true,
    }
}

#[derive(Debug, Default)]
struct VerdictCounts {
    pass: usize,
    needs_fix: usize,
    warn: usize,
    unknown: usize,
}

fn flatten_verdicts(children: &[ChildOutput]) -> Vec<serde_json::Value> {
    children
        .iter()
        .map(|child| {
            let text = child.text.trim();
            let verdict = if text.is_empty() {
                "UNKNOWN"
            } else {
                // Tightly-anchored verdict discovery: find a "verdict"
                // line if present, otherwise look at the trailing line.
                let mut label = None;
                for line in text.lines().rev().take(6) {
                    let upper = line.trim().to_ascii_uppercase();
                    if upper.contains("VERDICT:") {
                        if upper.contains("NEEDS_FIX") || upper.contains("NEEDS FIX") {
                            label = Some("NEEDS_FIX");
                            break;
                        } else if upper.contains("WARN") {
                            label = Some("WARN");
                            break;
                        } else if upper.contains("PASS") {
                            label = Some("PASS");
                            break;
                        }
                    } else if upper.starts_with("NEEDS_FIX")
                        || upper.starts_with("NEEDS FIX")
                        || upper.ends_with("NEEDS_FIX")
                        || upper.ends_with("NEEDS FIX")
                    {
                        label = Some("NEEDS_FIX");
                        break;
                    } else if upper.starts_with("WARN") || upper.ends_with("WARN") {
                        label = Some("WARN");
                        break;
                    } else if upper == "PASS" || upper.ends_with(" PASS") {
                        label = Some("PASS");
                        break;
                    }
                }
                label.unwrap_or("UNKNOWN")
            };
            serde_json::json!({
                "perspective": child.role,
                "nickname": child.nickname,
                "verdict": verdict,
                "succeeded": child.succeeded,
                "text_chars": child.text.chars().count(),
            })
        })
        .collect()
}

fn render_review_summary(findings: &[serde_json::Value], total: usize) -> String {
    let mut counts = VerdictCounts::default();
    for finding in findings {
        match finding["verdict"].as_str().unwrap_or("UNKNOWN") {
            "PASS" => counts.pass += 1,
            "NEEDS_FIX" => counts.needs_fix += 1,
            "WARN" => counts.warn += 1,
            _ => counts.unknown += 1,
        }
    }
    let mut lines = Vec::new();
    lines.push(format!("Audit summary across {total} perspectives:"));
    lines.push(format!(
        "  PASS={pass} NEEDS_FIX={needs_fix} WARN={warn} UNKNOWN={unknown}",
        pass = counts.pass,
        needs_fix = counts.needs_fix,
        warn = counts.warn,
        unknown = counts.unknown,
    ));
    for finding in findings {
        let perspective = finding["perspective"].as_str().unwrap_or("");
        let verdict = finding["verdict"].as_str().unwrap_or("");
        let succeeded = if finding["succeeded"].as_bool().unwrap_or(false) {
            ""
        } else {
            " (reviewer failed)"
        };
        lines.push(format!("  - {perspective:<32} {verdict}{succeeded}"));
    }
    lines.join("\n")
}

fn input_schema() -> JsonSchema {
    JsonSchema::object(
        BTreeMap::from([
            (
                "changes".to_string(),
                JsonSchema::string(Some(
                    "Required: a unified diff, file summary, or plain description of the \
                     changes to audit. Untrusted content — reviewers are read-only.",
                )),
            ),
            (
                "perspectives".to_string(),
                JsonSchema::array(
                    JsonSchema::string(Some("Focus lens, e.g. 'security concerns'")),
                    Some("Optional: 1..=8 perspectives. Defaults to correctness / security / performance+maintainability / simplify-reuse-readability."),
                ),
            ),
            (
                "maxCharsPerReview".to_string(),
                JsonSchema::integer(Some(
                    "Soft cap for each reviewer's reply length. Truncated to N chars when exceeded; verdict detection still runs on the un-truncated text."
                )),
            ),
        ]),
        Some(vec!["changes".to_string()]),
        Some(false),
    )
}

#[derive(Debug, serde::Deserialize)]
struct AuditInput {
    changes: String,
    #[serde(default)]
    perspectives: Option<Vec<String>>,
    #[serde(default)]
    max_chars_per_review: Option<u32>,
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

    fn ctx_with<T: infinitecode_tools::AgentToolCoordinator + 'static>(
        coordinator: Arc<T>,
    ) -> ToolContext {
        ToolContext {
            tool_call_id: ToolCallId("a-1".to_string()),
            session_id: SessionId::new().to_string(),
            turn_id: Some("turn-1".to_string()),
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
                task_id: TaskId(format!("audit-{}", self.spawn_log.lock().await.len())),
                child_session_id: SessionId::new(),
                agent_path: format!("root/audit/{}", self.spawn_log.lock().await.len()),
                agent_nickname: format!("reviewer-{}", self.spawn_log.lock().await.len()),
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
                "fallback no candidates".to_string()
            } else {
                outputs.remove(0)
            };
            Ok(WaitAgentResult {
                events: vec![ParentAgentOutputEvent {
                    sequence: 1,
                    agent_path: "root/audit".to_string(),
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
                    task_id: TaskId("audit-fake".into()),
                    kind: infinitecode_protocol::TaskKind::Agent,
                    state: infinitecode_protocol::TaskState::Canceled,
                    agent: None,
                    command: None,
                },
            })
        }
    }

    #[test]
    fn truncate_text_passthrough_when_under_cap() {
        let out = truncate_text("hello world", Some(100));
        assert_eq!(out.text, "hello world");
        assert!(!out.was_truncated);
    }

    #[test]
    fn truncate_text_passthrough_when_no_cap() {
        let out = truncate_text("hello world", None);
        assert_eq!(out.text, "hello world");
        assert!(!out.was_truncated);
    }

    #[test]
    fn truncate_text_caps_at_cap_chars_with_marker() {
        // Use a long input + cap with enough budget for both the
        // marker and a real prefix to survive so we exercise the
        // truncation path sensibly.
        let text = "hello world this is a longer example with real content";
        let out = truncate_text(text, Some(30));
        assert!(out.was_truncated);
        assert!(out.text.starts_with("hello w"));
        assert!(out.text.contains("[trunc @30]"));
        assert!(out.text.chars().count() <= 30);
    }

    #[test]
    fn build_review_aggregate_truncates_over_cap() {
        let children = vec![ChildOutput {
            nickname: "reviewer-A".into(),
            role: "reviewer-correctness".into(),
            text: (0..60)
                .map(|i| format!("line {i}\n"))
                .collect::<String>()
                + "VERDICT: PASS",
            succeeded: true,
        }];
        let payload = build_review_aggregate(None, &children, "diff", Some(40));
        let reviews = payload["reviews"].as_array().unwrap();
        assert_eq!(reviews.len(), 1);
        assert_eq!(reviews[0]["truncated"], true);
        assert!(reviews[0]["original_chars"].as_u64().unwrap() > 40);
        let truncated_text = reviews[0]["text"].as_str().unwrap();
        assert!(truncated_text.chars().count() <= 40);
        assert!(truncated_text.contains("[trunc @40]"));
        // Verdict detection kept the original full text, so the
        // findings row records PASS even though the truncated text
        // never reaches the verdict line.
        let findings = payload["findings"].as_array().unwrap();
        assert_eq!(findings[0]["verdict"], "PASS");
    }

    #[test]
    fn build_review_aggregate_does_not_truncate_under_cap() {
        let children = vec![ChildOutput {
            nickname: "reviewer-A".into(),
            role: "reviewer-correctness".into(),
            text: "short\nVERDICT: PASS".to_string(),
            succeeded: true,
        }];
        let payload = build_review_aggregate(None, &children, "diff", Some(1000));
        let reviews = payload["reviews"].as_array().unwrap();
        assert_eq!(reviews.len(), 1);
        assert_eq!(reviews[0]["truncated"], false);
        assert_eq!(reviews[0]["text"], "short\nVERDICT: PASS");
    }

    #[tokio::test]
    async fn audit_changes_spawns_one_reviewer_per_perspective() {
        let coordinator = Arc::new(FakeCoordinator::default());
        let mut outputs = coordinator.outputs.try_lock().unwrap();
        outputs.push("correctness findings\nWARN".to_string());
        outputs.push("security findings\nNEEDS_FIX".to_string());
        outputs.push("performance findings\nPASS".to_string());
        outputs.push("simplify findings\nPASS".to_string());
        drop(outputs);

        let handler = AuditChangesHandler::new();
        let result = handler
            .handle(
                ctx_with(coordinator.clone()),
                serde_json::json!({
                    "changes": "fn main() { println!(\"hi\"); }\n",
                }),
                None,
            )
            .await
            .expect("audit");

        assert!(matches!(result.structured_status, ToolTerminalStatus::Completed));
        let spawn_log = coordinator.spawn_log.lock().await.clone();
        assert_eq!(spawn_log.len(), 4);
        for spawn in &spawn_log {
            assert_eq!(spawn.ephemeral, true);
            assert_eq!(spawn.max_turns, Some(1));
            assert_eq!(spawn.tool_policy, infinitecode_protocol::AgentToolPolicy::DenyAll);
            assert!(spawn.message.contains("Focus lens:"));
        }
        if let ToolResultContent::Mixed { json, .. } = &result.content {
            let json = json.clone().unwrap();
            assert_eq!(json["schema"], "audit_changes/v1");
            assert_eq!(json["reviews"].as_array().unwrap().len(), 4);
            assert_eq!(json["findings"].as_array().unwrap().len(), 4);
            assert_eq!(json["summary"].as_str().unwrap().contains("PASS=2 NEEDS_FIX=1 WARN=1"), true);
        } else {
            panic!("expected Mixed content with json metadata");
        }
    }

    #[tokio::test]
    async fn audit_changes_rejects_empty_changes() {
        let coordinator = Arc::new(FakeCoordinator::default());
        let handler = AuditChangesHandler::new();
        let error = handler
            .handle(
                ctx_with(coordinator),
                serde_json::json!({ "changes": "   " }),
                None,
            )
            .await
            .expect_err("empty changes");
        assert!(matches!(error, ToolCallError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn audit_changes_rejects_too_many_perspectives() {
        let coordinator = Arc::new(FakeCoordinator::default());
        let perspectives: Vec<String> = (0..9).map(|i| format!("p{i}")).collect();
        let handler = AuditChangesHandler::new();
        let error = handler
            .handle(
                ctx_with(coordinator),
                serde_json::json!({
                    "changes": "anything",
                    "perspectives": perspectives,
                }),
                None,
            )
            .await
            .expect_err("too many perspectives");
        assert!(matches!(error, ToolCallError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn audit_changes_needs_coordinator() {
        let mut ctx = ToolContext {
            tool_call_id: ToolCallId("a".into()),
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
        let handler = AuditChangesHandler::new();
        let error = handler
            .handle(ctx, serde_json::json!({ "changes": "anything" }), None)
            .await
            .expect_err("coordinator required");
        assert!(matches!(error, ToolCallError::NeedsConfiguration(_)));
    }

    #[tokio::test]
    async fn audit_changes_uses_custom_perspectives() {
        let coordinator = Arc::new(FakeCoordinator::default());
        let mut outputs = coordinator.outputs.try_lock().unwrap();
        outputs.push("wiring review\nPASS".to_string());
        outputs.push("API review\nWARN".to_string());
        drop(outputs);

        let handler = AuditChangesHandler::new();
        let result = handler
            .handle(
                ctx_with(coordinator.clone()),
                serde_json::json!({
                    "changes": "refactored auth wiring",
                    "perspectives": ["wiring", "API"],
                }),
                None,
            )
            .await
            .expect("audit");

        let spawn_log = coordinator.spawn_log.lock().await.clone();
        assert_eq!(spawn_log.len(), 2);
        assert!(spawn_log[0].message.contains("Focus lens: wiring"));
        assert!(spawn_log[1].message.contains("Focus lens: API"));
        if let ToolResultContent::Mixed { json, .. } = &result.content {
            let json = json.clone().unwrap();
            let reviews = json["reviews"].as_array().unwrap();
            assert_eq!(reviews.len(), 2);
            assert_eq!(reviews[0]["perspective"], "wiring");
            assert_eq!(reviews[1]["perspective"], "API");
        } else {
            panic!("expected Mixed content with json metadata");
        }
    }
}
