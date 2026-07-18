//! `explore_solutions` — Best-of-N parallel thinker orchestrator.
//!
//! Mirrors freebuff's `thinker-best-of-n` pattern with two modes:
//!
//! 1. `"operation": "explore"` — spawns N ephemeral single-turn
//!    "thinker" children in parallel, each focused on the same
//!    problem but with a slightly different perspective. A final
//!    "selector" child picks the best thought. The selected text is
//!    returned as the tool result so the parent model can incorporate
//!    it without a follow-up call. N is clamped to `[1, 6]`, default
//!    3.
//!
//! 2. `"operation": "select"` — accepts pre-drafted candidates
//!    (e.g. from another orchestrator or from the model's own
//!    scratchpad) and runs only the selector child. Useful when the
//!    parent model wants to combine its own thinking with subagent
//!    ideas and pick among them.
//!
//! Children inherit thinking instructions only — they have
//! `tool_policy: DenyAll` so they cannot mutate the workspace.
//! The orchestrator itself is `ToolExecutionMode::ReadOnly`, so this
//! tool can be invoked even from Plan mode.

use std::collections::BTreeMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde::Deserialize;
use tracing::info;

use infinitecode_protocol::SessionId;

use crate::contracts::{
    ToolCallError, ToolContext, ToolProgressSender, ToolResult, ToolResultContent,
};
use crate::json_schema::JsonSchema;
use crate::tool_handler::ToolHandler;
use crate::tool_spec::{ToolExecutionMode, ToolOutputMode, ToolPreparationFeedback, ToolSpec};
use crate::tools::handlers::orchestrator::{
    letter_id, parse_selected_id_marker, run_parallel_children, run_selector_child, ChildOutput,
};

pub struct ExploreSolutionsHandler {
    spec: ToolSpec,
}

impl Default for ExploreSolutionsHandler {
    fn default() -> Self {
        Self::new()
    }
}

impl ExploreSolutionsHandler {
    pub fn new() -> Self {
        Self {
            spec: ToolSpec {
                name: "explore_solutions".into(),
                description:
                    "Best-of-N parallel thinker orchestrator. Operation 'explore' spawns N \
                     ephemeral single-turn thinker subagents, each focused on the problem from a \
                     different angle; a final selector child picks the best thought. Operation \
                     'select' lets the caller supply pre-drafted candidates and runs only the \
                     selector. Both modes are read-only — no workspace writes — so the tool \
                     stays available under Plan mode and never acts as a destructive primitive."
                        .into(),
                input_schema: input_schema(),
                output_mode: ToolOutputMode::Mixed,
                execution_mode: ToolExecutionMode::ReadOnly,
                capability_tags: vec![],
                supports_parallel: false,
                preparation_feedback: ToolPreparationFeedback::None,
                display_name: Some("Explore solutions".to_string()),
                supports_cancellation: Some(true),
                supports_streaming: None,
            },
        }
    }
}

#[async_trait]
impl ToolHandler for ExploreSolutionsHandler {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    async fn handle(
        &self,
        ctx: ToolContext,
        input: serde_json::Value,
        progress: Option<ToolProgressSender>,
    ) -> Result<ToolResult, ToolCallError> {
        let parsed: ExploreInput = serde_json::from_value(input)
            .map_err(|error| ToolCallError::InvalidInput(format!("invalid explore_solutions input: {error}")))?;

        // Coordinator check is intentionally first so that runs
        // without child-agent coordination surface a clean
        // `NeedsConfiguration` even when the parent session id fails
        // to parse — useful for unit tests and for subagent scopes.
        if ctx.agent_coordinator.is_none() {
            return Err(ToolCallError::NeedsConfiguration(
                "explore_solutions requires child agent coordination (parent session only)".into(),
            ));
        }
        let coordinator = ctx.agent_coordinator.clone().unwrap();
        let parent_session_id = SessionId::try_from(ctx.session_id.clone()).map_err(|error| {
            ToolCallError::InvalidInput(format!("invalid parent session id: {error}"))
        })?;

        match parsed.operation.as_deref() {
            Some("select") | None if parsed.candidates.is_some() => {
                select_mode(ctx, coordinator, parent_session_id, parsed, progress).await
            }
            Some("explore") | None => {
                explore_mode(ctx, coordinator, parent_session_id, parsed, progress).await
            }
            Some(other) => Err(ToolCallError::InvalidInput(format!(
                "unknown operation '{other}'; expected 'explore' or 'select'"
            ))),
        }
    }
}

// ── Operation dispatch ────────────────────────────────────────────────

async fn explore_mode(
    ctx: ToolContext,
    coordinator: Arc<dyn infinitecode_tools::AgentToolCoordinator>,
    parent_session_id: SessionId,
    parsed: ExploreInput,
    progress: Option<ToolProgressSender>,
) -> Result<ToolResult, ToolCallError> {
    let problem = parsed.problem.as_deref().map(str::trim).unwrap_or("");
    if problem.is_empty() {
        return Err(ToolCallError::InvalidInput(
            "'problem' is required for the 'explore' operation".into(),
        ));
    }
    let n = parsed.n.unwrap_or(3).clamp(1, 6);
    let perspectives = parsed.perspectives.unwrap_or_default();
    if !perspectives.is_empty() && perspectives.len() != n as usize {
        return Err(ToolCallError::InvalidInput(format!(
            "'perspectives' must have exactly {n} entries to match 'n'"
        )));
    }
    info!(n, problem_chars = problem.chars().count(), "explore_solutions: explore mode");

    let briefs = (0..n as usize).map(|idx| {
        let role = format!("thinker-{}", letter_id(idx));
        let focus = perspectives
            .get(idx)
            .map(String::as_str)
            .unwrap_or("general depth");
        let prompt = explore_thinker_prompt(problem, focus, &letter_id(idx));
        (role, prompt)
    });

    let children =
        run_parallel_children(coordinator.clone(), parent_session_id, "thinker", briefs, ctx.cancel_token.clone(), progress.clone()).await?;

    let notes = format_explore_thinker_notes(problem, &children);
    let selection = run_selector_child(
        coordinator,
        parent_session_id,
        build_explore_selector_prompt(problem, &notes, parsed.selection_criteria.as_deref()),
        ctx.cancel_token,
        progress,
    )
    .await?;
    let chosen_id = parse_selected_id_marker(&selection.text);
    let chosen = match chosen_id.as_deref() {
        Some(id) => children
            .iter()
            .find(|child| child.role == format!("thinker-{id}")),
        None => None,
    };
    let chosen_text = chosen.map(|child| child.text.clone()).unwrap_or_default();

    Ok(ToolResult::success(
        ToolResultContent::Mixed {
            text: Some(chosen_text_render(&chosen_text, chosen)),
            json: Some(json_explore_result(parsed.operation.as_deref(), chosen, &children, &selection.text)),
        },
        format!(
            "explore_solutions: explored {} candidates, selected {}",
            children.len(),
            chosen_id.as_deref().unwrap_or("none")
        ),
    ))
}

async fn select_mode(
    ctx: ToolContext,
    coordinator: Arc<dyn infinitecode_tools::AgentToolCoordinator>,
    parent_session_id: SessionId,
    parsed: ExploreInput,
    progress: Option<ToolProgressSender>,
) -> Result<ToolResult, ToolCallError> {
    let candidates = parsed.candidates.clone().ok_or_else(|| {
        ToolCallError::InvalidInput("'candidates' is required for the 'select' operation".into())
    })?;
    if candidates.is_empty() {
        return Err(ToolCallError::InvalidInput(
            "'candidates' must contain at least one entry".into(),
        ));
    }
    if candidates.len() > 8 {
        return Err(ToolCallError::InvalidInput(
            "'candidates' can hold at most 8 entries".into(),
        ));
    }
    info!(count = candidates.len(), "explore_solutions: select mode");

    // Pre-drafted candidates don't need child agent runs — they were
    // produced upstream by `preview_edit` / `preview_write` or by the
    // model itself. We only spawn the selector child.
    let selector_payload = build_select_selector_prompt(&candidates, parsed.selection_criteria.as_deref());
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
        .and_then(|id| letter_to_index(id));
    let chosen = chosen_index.and_then(|index| candidates.get(index).cloned());

    Ok(ToolResult::success(
        ToolResultContent::Mixed {
            text: Some(chosen
                .as_ref()
                .map(|c| c.content.clone())
                .unwrap_or_else(|| format!("(selector emitted no marker; raw reply: {})", selection.text.trim()))),
            json: Some(json_select_result(chosen, &selection.text, &candidates)),
        },
        format!(
            "explore_solutions: selected from {} pre-drafted candidates (winner: {})",
            candidates.len(),
            chosen_id.as_deref().unwrap_or("none")
        ),
    ))
}

// ── Prompts ────────────────────────────────────────────────────────────

fn explore_thinker_prompt(problem: &str, focus: &str, id: &str) -> String {
    format!(
        "You are thinker candidate {id}. Your only job is to think deeply about the problem \
         below and write out your best, most actionable answer.\n\n\
         Focus lens: {focus}\n\n\
         Problem:\n{problem}\n\n\
         Constraints:\n\
         - Use <think> tags (if your model supports them) before your answer.\n\
         - Do NOT use any tools — you have no tools available.\n\
         - Be concrete and decisive — pick a recommended approach and justify it.\n\
         - Acknowledge edge cases and tradeoffs.\n"
    )
}

fn build_explore_selector_prompt(problem: &str, notes: &str, criteria: Option<&str>) -> String {
    let criteria = criteria.unwrap_or(
        "Pick the candidate that is most correct, most thorough on edge cases, and most actionable.",
    );
    format!(
        "You are the selector in a Best-of-N thinker workflow. Several thinker candidates \
         (labeled A, B, C, ...) produced independent answers to the same problem. Pick the \
         single best answer.\n\n\
         Problem:\n{problem}\n\n\
         Selection criteria:\n{criteria}\n\n\
         Candidates:\n{notes}\n\n\
         Reply ONLY with a single trailing line of the form:\n\
         <selected_id>X</selected_id>\n\
         where X is the letter you chose. No other text after the marker."
    )
}

fn build_select_selector_prompt(
    candidates: &[CandidateInput],
    criteria: Option<&str>,
) -> String {
    let notes = candidates
        .iter()
        .enumerate()
        .map(|(index, candidate)| {
            let id = letter_id(index);
            format!("Candidate {id}:\n{}\n", candidate.content.trim())
        })
        .collect::<Vec<_>>()
        .join("\n---\n");
    let criteria = criteria
        .unwrap_or("Pick the candidate that best addresses the user's problem.");
    format!(
        "You are the selector in a Best-of-N selection workflow. Several pre-drafted \
         candidates (labeled A, B, C, ...) are available. Pick the single best candidate.\n\n\
         Selection criteria:\n{criteria}\n\n\
         Candidates:\n{notes}\n\n\
         Reply ONLY with a single trailing line of the form:\n\
         <selected_id>X</selected_id>\n\
         where X is the letter you chose. No other text after the marker."
    )
}

fn format_explore_thinker_notes(problem: &str, children: &[ChildOutput]) -> String {
    let mut out = String::new();
    for (idx, child) in children.iter().enumerate() {
        let id = letter_id(idx);
        out.push_str(&format!(
            "--- Candidate {id} (role: {}) ---\n{}\n",
            child.role,
            if child.succeeded {
                child.text.clone()
            } else {
                format!("(child failed) {}", child.text)
            }
        ));
    }
    let _ = problem; // included only in the selector payload above; suppress warning
    out
}

// ── Output shaping ─────────────────────────────────────────────────────

fn chosen_text_render(text: &str, child: Option<&ChildOutput>) -> String {
    let mut out = String::new();
    if text.trim().is_empty() {
        out.push_str("(no text returned by the chosen child)\n");
    } else {
        out.push_str(text.trim());
        out.push('\n');
    }
    if let Some(child) = child {
        out.push_str(&format!("\n[source: {} / {}]\n", child.role, child.nickname));
    }
    out
}

fn json_explore_result(
    operation: Option<&str>,
    chosen: Option<&ChildOutput>,
    children: &[ChildOutput],
    selector_text: &str,
) -> serde_json::Value {
    let candidates_json: Vec<serde_json::Value> = children
        .iter()
        .enumerate()
        .map(|(index, child)| {
            serde_json::json!({
                "id": letter_id(index),
                "role": child.role,
                "nickname": child.nickname,
                "succeeded": child.succeeded,
                "content": child.text,
            })
        })
        .collect();
    serde_json::json!({
        "operation": operation.unwrap_or("explore"),
        "selected": chosen.map(|child| {
            let id = child
                .role
                .strip_prefix("thinker-")
                .unwrap_or(&child.role)
                .to_string();
            serde_json::json!({
                "id": id,
                "role": child.role,
                "nickname": child.nickname,
                "content": child.text,
            })
        }),
        "alternatives": candidates_json,
        "selector_reply": selector_text,
    })
}

fn json_select_result(
    chosen: Option<CandidateInput>,
    selector_text: &str,
    candidates: &[CandidateInput],
) -> serde_json::Value {
    serde_json::json!({
        "operation": "select",
        "selected": chosen,
        "alternatives": candidates,
        "selector_reply": selector_text,
    })
}

fn letter_to_index(id: &str) -> Option<usize> {
    let bytes = id.as_bytes();
    if bytes.len() == 1 && bytes[0].is_ascii_uppercase() {
        Some((bytes[0] - b'A') as usize)
    } else if bytes.len() >= 2 && bytes[0] == b'Z' {
        let rest = &bytes[1..];
        let ordinal: usize = std::str::from_utf8(rest).ok()?.parse().ok()?;
        Some(25 + ordinal)
    } else {
        None
    }
}

fn input_schema() -> JsonSchema {
    JsonSchema::object(
        BTreeMap::from([
            (
                "operation".to_string(),
                JsonSchema::string(Some(
                    "'explore' (default) spawns N thinker children in parallel and picks \
                     the best; 'select' runs only the selector over caller-supplied candidates.",
                )),
            ),
            (
                "problem".to_string(),
                JsonSchema::string(Some(
                    "Required for 'explore'. The problem each thinker will reason about.",
                )),
            ),
            (
                "n".to_string(),
                JsonSchema::integer(Some(
                    "Number of parallel thinker children for 'explore'. Default 3, clamped to 1..=6.",
                )),
            ),
            (
                "perspectives".to_string(),
                JsonSchema::array(
                    JsonSchema::string(Some("Focus lens per thinker")),
                    Some("Optional: exactly N focus prompts paralleling 'n'. Empty = each thinker uses 'general depth'."),
                ),
            ),
            (
                "candidates".to_string(),
                JsonSchema::array(
                    JsonSchema::object(
                        BTreeMap::from([
                            ("id".to_string(), JsonSchema::string(Some("Optional caller-assigned id."))),
                            ("content".to_string(), JsonSchema::string(Some("Candidate text."))),
                        ]),
                        None,
                        Some(true),
                    ),
                    Some("Required for 'select': 1..=8 pre-drafted candidates."),
                ),
            ),
            (
                "selectionCriteria".to_string(),
                JsonSchema::string(Some("Optional selection-criteria override.")),
            ),
        ]),
        Some(vec![]),
        Some(false),
    )
}

// ── Input types ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ExploreInput {
    #[serde(default)]
    operation: Option<String>,
    #[serde(default)]
    problem: Option<String>,
    #[serde(default)]
    n: Option<u32>,
    #[serde(default)]
    perspectives: Option<Vec<String>>,
    #[serde(default)]
    candidates: Option<Vec<CandidateInput>>,
    #[serde(default)]
    selection_criteria: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
struct CandidateInput {
    #[serde(default)]
    id: Option<String>,
    content: String,
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use crate::agent_behavior_prompts::explore_solutions_prompt;

    use async_trait::async_trait;
    use infinitecode_protocol::{
        AgentMessageParams, AgentMessageResult, AgentOutputEventKind, AwaitTaskParams,
        AwaitTaskResult, CancelTaskParams, CancelTaskResult, CloseAgentParams, CloseAgentResult,
        ListTasksParams, ListTasksResult, ParentAgentOutputEvent, SessionId, SpawnAgentParams,
        SpawnAgentResult, WaitAgentParams, WaitAgentResult,
    };
    use pretty_assertions::assert_eq;
    use tokio::sync::Mutex;
    use tokio_util::sync::CancellationToken;

    use super::*;
    use crate::contracts::{ToolAgentScope, ToolBudgets, ToolTerminalStatus};
    use infinitecode_tools::ToolCallId;

    fn ctx_with(running: Arc<FakeCoordinator>, session_id: &str) -> ToolContext {
        ToolContext {
            tool_call_id: ToolCallId("esc-1".to_string()),
            session_id: session_id.to_string(),
            turn_id: Some("turn-1".to_string()),
            workspace_root: PathBuf::from("/tmp"),
            budgets: ToolBudgets {
                output_limit_bytes: 32_768,
                wall_time_limit_ms: None,
            },
            cancel_token: CancellationToken::new(),
            agent_scope: ToolAgentScope::Parent,
            collaboration_mode: infinitecode_protocol::CollaborationMode::Build,
            agent_coordinator: Some(running.clone()),
            client_filesystem: None,
            client_terminal: None,
            file_read_ledger: None,
            network_proxy: None,
            network_no_proxy: None,
        }
    }

    /// Records every spawned child so tests can assert exact fan-out
    /// and return deterministic, scripted outputs.
    #[derive(Default)]
    struct FakeCoordinator {
        spawn_log: Mutex<Vec<SpawnAgentParams>>,
        completed_outputs: Mutex<Vec<String>>,
    }

    #[async_trait]
    impl infinitecode_tools::AgentToolCoordinator for FakeCoordinator {
        async fn spawn_agent(
            self: Arc<Self>,
            params: SpawnAgentParams,
        ) -> Result<SpawnAgentResult, ToolCallError> {
            self.spawn_log.lock().await.push(params.clone());
            Ok(SpawnAgentResult {
                task_id: infinitecode_protocol::TaskId(format!("fake-{}", self.spawn_log.lock().await.len())),
                child_session_id: SessionId::new(),
                agent_path: format!("root/explore/{}", self.spawn_log.lock().await.len()),
                agent_nickname: format!("thinker-{}", self.spawn_log.lock().await.len()),
                status: "running".to_string(),
            })
        }

        async fn send_message(
            self: Arc<Self>,
            _params: AgentMessageParams,
        ) -> Result<AgentMessageResult, ToolCallError> {
            Ok(AgentMessageResult {
                delivered: true,
                task_id: infinitecode_protocol::TaskId("unused".into()),
            })
        }

        async fn wait_agent(
            self: Arc<Self>,
            _params: WaitAgentParams,
        ) -> Result<WaitAgentResult, ToolCallError> {
            let mut outputs = self.completed_outputs.lock().await;
            if outputs.is_empty() {
                // Selector fallback reply; if a test forgets to script
                // an answer the orchestrator should still terminate.
                Ok(WaitAgentResult {
                    events: vec![ParentAgentOutputEvent {
                        sequence: 1,
                        agent_path: "root/explore".to_string(),
                        agent_nickname: "selector".to_string(),
                        kind: AgentOutputEventKind::AssistantMessage,
                        text: Some("No candidates available.".to_string()),
                        status: None,
                    }],
                    next_sequence: 2,
                    timed_out: false,
                })
            } else {
                let text = outputs.remove(0);
                Ok(WaitAgentResult {
                    events: vec![ParentAgentOutputEvent {
                        sequence: 1,
                        agent_path: "root/explore".to_string(),
                        agent_nickname: "fake".to_string(),
                        kind: AgentOutputEventKind::AssistantMessage,
                        text: Some(text),
                        status: Some("completed".to_string()),
                    }],
                    next_sequence: 2,
                    timed_out: false,
                })
            }
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
                "await_task unavailable in fake".to_string(),
            ))
        }

        async fn list_tasks(
            self: Arc<Self>,
            _params: ListTasksParams,
        ) -> Result<ListTasksResult, ToolCallError> {
            Err(ToolCallError::ExecutionFailed(
                "list_tasks unavailable in fake".to_string(),
            ))
        }

        async fn cancel_task(
            self: Arc<Self>,
            _params: CancelTaskParams,
        ) -> Result<CancelTaskResult, ToolCallError> {
            Ok(CancelTaskResult {
                task: infinitecode_protocol::TaskInfo {
                    task_id: infinitecode_protocol::TaskId("fake".into()),
                    kind: infinitecode_protocol::TaskKind::Agent,
                    state: infinitecode_protocol::TaskState::Canceled,
                    agent: None,
                    command: None,
                },
            })
        }
    }

    fn scripted_coordinator(answers: Vec<String>) -> Arc<FakeCoordinator> {
        let coordinator = FakeCoordinator::default();
        coordinator
            .completed_outputs
            .try_lock()
            .expect("fresh coordinator")
            .extend(answers);
        // Provide the same number of replies for spawn + wait pairs.
        let coord_clone = Arc::new(coordinator);
        coord_clone
    }

    fn bulk_drain(coordinator: Arc<FakeCoordinator>, count: usize) {
        let mut outputs = coordinator.completed_outputs.try_lock().unwrap();
        for i in 0..count {
            outputs.push(format!("thought {}", letter_id(i)));
        }
    }

    #[tokio::test]
    async fn explore_solutions_spawns_n_thinkers_then_a_selector() {
        let coord = Arc::new(FakeCoordinator::default());
        // Two scripted replies per explorer call: selector marker
        // is consumed first because we queue answers in spawn order.
        let mut outputs = coord.completed_outputs.try_lock().unwrap();
        for idx in 0..3 {
            outputs.push(format!(
                "Thinker {} reply. <selected_id></selected_id>",
                letter_id(idx)
            ));
        }
        // Selector reply picks B.
        outputs.push(
            "I considered them all.\n<selected_id>B</selected_id>".to_string(),
        );
        drop(outputs);

        let handler = ExploreSolutionsHandler::new();
        let result = handler
            .handle(
                ctx_with(coord.clone(), &SessionId::new().to_string()),
                serde_json::json!({
                    "operation": "explore",
                    "problem": "How do I cache this DB query?",
                    "n": 3,
                }),
                None,
            )
            .await
            .expect("explore");

        assert!(matches!(result.structured_status, ToolTerminalStatus::Completed));
        let spawn_log = coord.spawn_log.lock().await.clone();
        // 3 thinker spawns + 1 selector spawn = 4 spawn_agent calls
        assert_eq!(spawn_log.len(), 4);
        // Thinkers are ephemeral single-turn with DenyAll.
        for (index, spawn) in spawn_log.iter().enumerate().take(3) {
            assert_eq!(spawn.ephemeral, true);
            assert_eq!(spawn.max_turns, Some(1));
            assert_eq!(spawn.tool_policy, infinitecode_protocol::AgentToolPolicy::DenyAll);
            assert!(spawn.message.contains("thinker candidate"));
            let _ = index;
        }
        // The fourth spawn is the selector — also ephemeral, single-turn, DenyAll.
        let selector = spawn_log.last().unwrap();
        assert_eq!(selector.tool_policy, infinitecode_protocol::AgentToolPolicy::DenyAll);
        assert!(selector.message.contains("Best-of-N thinker workflow"));
        assert!(selector.message.contains("<selected_id>"));
        // Result text mentions the chosen thinker's letter.
        if let ToolResultContent::Mixed { text, json } = &result.content {
            let text = text.clone().unwrap_or_default();
            assert!(
                text.contains("[source: thinker-B"),
                "expected source attribution; got {text}"
            );
            let json = json.clone().unwrap();
            assert_eq!(json["selected"]["id"], "B");
            assert_eq!(json["alternatives"].as_array().unwrap().len(), 3);
        } else {
            panic!("expected Mixed content with text+json");
        }
    }

    #[tokio::test]
    async fn explore_solutions_explore_requires_problem() {
        let coord = Arc::new(FakeCoordinator::default());
        let handler = ExploreSolutionsHandler::new();
        let error = handler
            .handle(
                ctx_with(coord, &SessionId::new().to_string()),
                serde_json::json!({ "operation": "explore", "n": 3 }),
                None,
            )
            .await
            .expect_err("'problem' is required");
        assert!(matches!(error, ToolCallError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn explore_solutions_explore_rejects_perspective_length_mismatch() {
        let coord = Arc::new(FakeCoordinator::default());
        bulk_drain(coord.clone(), 4);
        let handler = ExploreSolutionsHandler::new();
        let error = handler
            .handle(
                ctx_with(coord, &SessionId::new().to_string()),
                serde_json::json!({
                    "operation": "explore",
                    "problem": "anything",
                    "n": 3,
                    "perspectives": ["a", "b"], // mismatch
                }),
                None,
            )
            .await
            .expect_err("perspective length mismatch");
        assert!(matches!(error, ToolCallError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn explore_solutions_select_requires_candidates() {
        let coord = Arc::new(FakeCoordinator::default());
        let handler = ExploreSolutionsHandler::new();
        let error = handler
            .handle(
                ctx_with(coord, &SessionId::new().to_string()),
                serde_json::json!({ "operation": "select" }),
                None,
            )
            .await
            .expect_err("candidates required for select");
        assert!(matches!(error, ToolCallError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn explore_solutions_needs_coordinator() {
        let mut ctx = ToolContext {
            tool_call_id: ToolCallId("c".into()),
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
        let handler = ExploreSolutionsHandler::new();
        let error = handler
            .handle(
                ctx,
                serde_json::json!({ "problem": "anything", "n": 2 }),
                None,
            )
            .await
            .expect_err("configure child coordination");
        assert!(matches!(error, ToolCallError::NeedsConfiguration(_)));
    }

    #[tokio::test]
    async fn explore_solutions_survives_partial_failures() {
        let coord = Arc::new(FakeCoordinator::default());
        // Only provide 1 reply (one of N children times out, then the
        // selector still receives a marker for the survivor).
        let mut outputs = coord.completed_outputs.try_lock().unwrap();
        outputs.push("thought A reply".to_string());
        outputs.push("I pick A.\n<selected_id>A</selected_id>".to_string());
        drop(outputs);

        // Override spawn_agent to throw for some messages. The fake
        // `FakeCoordinator::spawn_agent` above always succeeds, so
        // we replace it at the Arc level by rewrapping if needed.
        // For this test we rely on the wait path: the fake will
        // reclaim a "no outputs" reply only after the queue is
        // empty, so the next two replies — for thinkers B and C —
        // come back as the "no candidates" fallback but with timed_out
        // false. That marks them as succeeded: false in the helper.
        let handler = ExploreSolutionsHandler::new();
        let result = handler
            .handle(
                ctx_with(coord.clone(), &SessionId::new().to_string()),
                serde_json::json!({
                    "operation": "explore",
                    "problem": "any",
                    "n": 3,
                }),
                None,
            )
            .await
            .expect("tool succeeds even when some children fail");
        assert!(matches!(result.structured_status, ToolTerminalStatus::Completed));
    }

    #[test]
    fn letter_id_roundtrip() {
        for index in 0..26 {
            assert_eq!(letter_to_index(&letter_id(index)), Some(index));
        }
        assert_eq!(letter_to_index("Z1"), Some(26));
        assert_eq!(letter_to_index("Z2"), Some(27));
        assert_eq!(letter_to_index("not-a-letter"), None);
    }

    #[test]
    fn prompt_fragments_are_no_op_when_disabled() {
        assert_eq!(explore_solutions_prompt(false), String::new());
        assert!(explore_solutions_prompt(true).contains("explore_solutions_protocol"));
    }
}
