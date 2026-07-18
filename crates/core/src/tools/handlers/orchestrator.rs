//! Shared helpers for the multi-prompt / Best-of-N orchestrator tools.
//!
//! Three new tools (`explore_solutions`, `audit_changes`,
//! `select_implementation`) compose the existing
//! `AgentToolCoordinator` primitive — spawning ephemeral single-turn
//! child agent runs in parallel, harvesting their assistant text, and
//! using a final "selector" child to pick a winner. The helpers in this
//! module own:
//!
//! 1. Parallel fan-out via `futures::future::join_all` over many
//!    `spawn_agent` calls, followed by parallel `wait_agent` polls.
//! 2. Cancellation propagation through the parent `cancel_token`.
//! 3. Partial-failure tolerance: a single child timing out, failing,
//!    or being cancelled does NOT abort the whole orchestrator tool.
//! 4. The `<selected_id>X</selected_id>` tail-marker convention that
//!    selector children emit and that this helper parses.
//!
//! The orchestrator tools themselves stay
//! `ToolExecutionMode::ReadOnly` — they never write files, so they
//! remain invokable from Plan mode and cannot be used as a destructive
//! primitive even if a child is mis-prompted.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use infinitecode_protocol::AgentOutputEventKind;
use infinitecode_protocol::AgentToolPolicy;
use infinitecode_protocol::CloseAgentParams;
use infinitecode_protocol::SpawnAgentParams;
use infinitecode_protocol::SpawnAgentResult;
use infinitecode_protocol::WaitAgentParams;
use infinitecode_protocol::resolve_wait_agent_timeout;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing::debug;
use tracing::info;
use tracing::warn;

use infinitecode_tools::AgentToolCoordinator;
use infinitecode_tools::ToolCallError;
use infinitecode_tools::ToolProgress;
use infinitecode_tools::ToolProgressSender;

use infinitecode_protocol::SessionId;

/// Pinned boxed future used by `run_parallel_children` to wait for
/// many child agent runs concurrently. Each push has a different
/// capture set so the futures are erased behind a trait object.
type WaitFuture =
    Pin<Box<dyn Future<Output = (String, String, Result<String, ToolCallError>)> + Send>>;

/// A single ephemeral child agent run.
#[derive(Debug, Clone)]
pub struct ChildOutput {
    /// Stable `agent_nickname` returned by the coordinator's spawn_agent
    /// — used for diagnostics and log lines only.
    pub nickname: String,
    /// Human-readable role label the caller passed in (e.g.
    /// "thinker", "reviewer-correctness").
    pub role: String,
    /// Accumulated assistant text from the child, or a synthetic
    /// failure string when the child timed out / failed / was cancelled.
    pub text: String,
    /// Whether the child produced actual text (`true`) or its slot is
    /// a synthetic placeholder from a partial failure (`false`).
    pub succeeded: bool,
}

/// Spawn N ephemeral single-turn child agent runs in parallel and
/// collect their assistant text.
///
/// `briefs` is `(role_label, task_message)` pairs; the caller controls
/// the role label so it can map results back to the perspective it
/// requested. Children are spawned with `max_turns: Some(1)`,
/// `fork_turns: "none"`, `tool_policy: DenyAll`, `ephemeral: true`,
/// which guarantees:
///
/// - No tool-schema bloat in the child prompt.
/// - No persisted child sessions.
/// - No leaked tools that could mutate the workspace.
///
/// Partial failures: a child whose `wait_agent` returns `timed_out`,
/// whose status event is `failed` / `interrupted` / `canceled`, or
/// whose poll is cancelled by the parent context yields a
/// `ChildOutput` with `succeeded: false` and a synthetic text marker.
/// The orchestrator keeps running so a downstream selector child sees
/// the survivors.
pub async fn run_parallel_children<I, S>(
    coordinator: Arc<dyn AgentToolCoordinator>,
    parent_session_id: SessionId,
    role_prefix: &str,
    briefs: I,
    cancel_token: CancellationToken,
    progress: Option<ToolProgressSender>,
) -> Result<Vec<ChildOutput>, ToolCallError>
where
    I: IntoIterator<Item = (S, String)>,
    S: Into<String>,
{
    let briefs: Vec<(String, String)> = briefs.into_iter().map(|(r, m)| (r.into(), m)).collect();
    if briefs.is_empty() {
        return Err(ToolCallError::InvalidInput(format!(
            "orchestrator role '{role_prefix}' requires at least one child"
        )));
    }

    info!(
        role = role_prefix,
        count = briefs.len(),
        "spawning parallel orchestrator children"
    );

    if let Some(progress) = progress.as_ref() {
        let _ = progress.send(ToolProgress::StatusUpdate {
            message: format!("Spawning {} {} children", briefs.len(), role_prefix),
            percent: None,
        });
    }

    // Phase 1: spawn each spawn_agent as a tracked `tokio::spawn`
    // task so partial cancellation can abort in-flight calls and
    // close any agents the coordinator already registered before
    // the cancel took effect. Without tracking handles, dropping
    // the join_all future on cancel would leak every agent whose
    // registration succeeded mid-cancellation.
    let mut spawn_handles: Vec<JoinHandle<(String, Result<SpawnAgentResult, ToolCallError>)>> =
        Vec::with_capacity(briefs.len());
    for (role_label, message) in briefs.iter() {
        let coordinator = Arc::clone(&coordinator);
        let session_id = parent_session_id.clone();
        let message = message.clone();
        let role = role_label.clone();
        spawn_handles.push(tokio::spawn(async move {
            let params = SpawnAgentParams {
                session_id,
                message,
                fork_turns: Some("none".to_string()),
                max_turns: Some(1),
                tool_policy: AgentToolPolicy::DenyAll,
                ephemeral: true,
            };
            let result = coordinator.spawn_agent(params).await;
            (role, result)
        }));
    }

    // Helper: collect completed-phase-1 outcomes, preserving briefs
    // slot order so children[0] still corresponds to briefs[0].
    let collect_phase1 = |join_results: Vec<
        Result<(String, Result<SpawnAgentResult, ToolCallError>), tokio::task::JoinError>,
    >|
     -> Vec<(String, Result<SpawnAgentResult, ToolCallError>)> {
        let mut out = Vec::with_capacity(join_results.len());
        for (idx, join) in join_results.into_iter().enumerate() {
            let role = briefs
                .get(idx)
                .map(|(r, _)| r.clone())
                .unwrap_or_else(|| format!("phase1-#{idx}"));
            match join {
                Ok((r, spawn)) => out.push((r, spawn)),
                Err(error) if error.is_cancelled() => {
                    out.push((role, Err(ToolCallError::Cancelled)))
                }
                Err(error) => out.push((
                    role,
                    Err(ToolCallError::InternalError(format!(
                        "spawn_agent task panicked: {error}"
                    ))),
                )),
            }
        }
        out
    };

    // INVARIANT — DO NOT REMOVE: both arms of the `tokio::select!`
    // below MUST call `std::mem::take(&mut spawn_handles)` to move
    // the `Vec<JoinHandle<_>>` into the inner `join_all`. Only one
    // arm runs per cancellation race, but each arm independently
    // needs to own the handles (Rust borrow checker). A future
    // maintainer who "simplifies" either arm without `mem::take`
    // will reintroduce E0382 (use of moved value).
    let spawn_results: Vec<(String, Result<SpawnAgentResult, ToolCallError>)> = tokio::select! {
        // The successful path: wait for every handle and unwrap.
        join_results = futures::future::join_all(std::mem::take(&mut spawn_handles)) => {
            collect_phase1(join_results)
        }
        // The cancellation path: abort every in-flight task, then
        // sweep the handles within a 5-second deadline (best-effort;
        // leaks past the deadline are reaped by session TTL) to
        // discover any agents the coordinator already registered
        // and close them.
        _ = cancel_token.cancelled() => {
            for handle in spawn_handles.iter() {
                handle.abort();
            }
            let mut closed = 0usize;
            let sweep_deadline = std::time::Duration::from_secs(5);
            let sweep = futures::future::join_all(std::mem::take(&mut spawn_handles));
            match tokio::time::timeout(sweep_deadline, sweep).await {
                Ok(join_results) => {
                    for join in join_results {
                        if let Ok((_, Ok(spawned))) = join {
                            let _ = coordinator
                                .clone()
                                .close_agent(CloseAgentParams {
                                    session_id: parent_session_id.clone(),
                                    target: spawned.agent_nickname.clone(),
                                })
                                .await;
                            closed += 1;
                        }
                    }
                }
                Err(_) => {
                    warn!(
                        role = role_prefix,
                        "Phase 1 cancellation: 5s close-sweep exceeded; some spawned agents may remain until session TTL"
                    );
                }
            }
            warn!(
                role = role_prefix,
                closed,
                "Phase 1 cancelled mid-spawn; closed all live children"
            );
            return Err(ToolCallError::Cancelled);
        }
    };

    // Phase 2: in parallel, wait for every successful spawn. Spawn
    // failures are pushed as immediately-ready futures so that the
    // caller-supplied slot index is preserved — `children[i]` always
    // corresponds to `briefs[i]`, even when `briefs[i]` failed to
    // spawn. This keeps downstream consumers' letter ids stable.
    let mut wait_futures: Vec<WaitFuture> = Vec::with_capacity(spawn_results.len());
    for (role_label, spawn_result) in spawn_results.into_iter() {
        match spawn_result {
            Ok(spawned) => {
                let nickname = spawned.agent_nickname.clone();
                let agent_path = spawned.agent_path.clone();
                let token = cancel_token.clone();
                let progress = progress.clone();
                let coordinator = Arc::clone(&coordinator);
                wait_futures.push(Box::pin(async move {
                    let outcome = wait_for_single_child(
                        coordinator,
                        parent_session_id,
                        &agent_path,
                        &nickname,
                        token,
                        progress,
                    )
                    .await;
                    (role_label, nickname, outcome)
                }));
            }
            Err(error) => {
                warn!(role = %role_label, %error, "child spawn_agent failed");
                let synthetic: Result<String, ToolCallError> = Err(ToolCallError::ExecutionFailed(
                    format!("spawn_agent failed: {error}"),
                ));
                // Inline immediately-ready future so join_all keeps
                // the slot order identical to the briefs vector.
                wait_futures.push(Box::pin(
                    async move { (role_label, String::new(), synthetic) },
                ));
            }
        }
    }
    let wait_results = futures::future::join_all(wait_futures).await;

    // The slot order is already preserved by `join_all` because both
    // branches push futures in `spawn_results` order (which matches
    // the original `briefs` order). No re-sorting is necessary.
    let mut outputs = Vec::with_capacity(wait_results.len());
    for (role_label, nickname, result) in wait_results {
        match result {
            Ok(text) => {
                debug!(
                    role = %role_label,
                    nickname = %nickname,
                    chars = text.chars().count(),
                    "child completed"
                );
                outputs.push(ChildOutput {
                    nickname,
                    role: role_label,
                    text,
                    succeeded: true,
                });
            }
            Err(error) => {
                warn!(
                    role = %role_label,
                    nickname = %nickname,
                    %error,
                    "child terminated with failure"
                );
                outputs.push(ChildOutput {
                    nickname,
                    role: role_label,
                    text: format!("(child failed: {})", short_error(&error)),
                    succeeded: false,
                });
            }
        }
    }
    Ok(outputs)
}

/// Spawn exactly one selector child. The selector is told to emit a
/// single `<selected_id>X</selected_id>` marker as the last non-empty
/// region of its reply so [`parse_selected_id_marker`] can extract the
/// winner.
pub async fn run_selector_child(
    coordinator: Arc<dyn AgentToolCoordinator>,
    parent_session_id: SessionId,
    instruction_with_payload: String,
    cancel_token: CancellationToken,
    progress: Option<ToolProgressSender>,
) -> Result<ChildOutput, ToolCallError> {
    if let Some(progress) = progress.as_ref() {
        let _ = progress.send(ToolProgress::StatusUpdate {
            message: "Running selector child".to_string(),
            percent: None,
        });
    }
    info!("spawning selector child");

    let spawn_params = SpawnAgentParams {
        session_id: parent_session_id.clone(),
        message: instruction_with_payload,
        fork_turns: Some("none".to_string()),
        max_turns: Some(1),
        tool_policy: AgentToolPolicy::DenyAll,
        ephemeral: true,
    };
    let spawned = coordinator.clone().spawn_agent(spawn_params).await?;
    let nickname = spawned.agent_nickname.clone();
    let agent_path = spawned.agent_path.clone();
    let wait_coord = Arc::clone(&coordinator);
    let text = wait_for_single_child(
        wait_coord,
        parent_session_id,
        &agent_path,
        &nickname,
        cancel_token,
        progress,
    )
    .await?;
    Ok(ChildOutput {
        nickname,
        role: "selector".to_string(),
        text,
        succeeded: true,
    })
}

/// Walk the most recent `assistant_message` events of the child and
/// concatenate their text. Cancellation is handled via `tokio::select!`
/// on the parent context.
async fn wait_for_single_child(
    coordinator: Arc<dyn AgentToolCoordinator>,
    parent_session_id: SessionId,
    agent_path: &str,
    agent_nickname: &str,
    cancel_token: CancellationToken,
    progress: Option<ToolProgressSender>,
) -> Result<String, ToolCallError> {
    const MAX_WAIT_SECS: u64 = 120;
    let resolved_timeout = resolve_wait_agent_timeout(Some(MAX_WAIT_SECS));
    let params = WaitAgentParams {
        session_id: parent_session_id.clone(),
        target: Some(agent_nickname.to_string()),
        after_sequence: None,
        timeout_secs: Some(resolved_timeout),
    };
    // Two clones because both `wait_fut` and the cancellation branch
    // each consume their own `Arc` (the trait method takes
    // `self: Arc<Self>`).
    let wait_coord = Arc::clone(&coordinator);
    let close_coord = Arc::clone(&coordinator);
    let wait_fut = wait_coord.wait_agent(params);
    let outcome = tokio::select! {
        result = wait_fut => result,
        _ = cancel_token.cancelled() => {
            // Best-effort close so the child's session is reclaimed
            // before returning Cancelled upstream. Bounded by a 5s
            // deadline so a stalled coordinator cannot hold the
            // orchestrator's cancellation path indefinitely.
            let close_target = agent_nickname.to_string();
            let close_params = CloseAgentParams {
                session_id: parent_session_id.clone(),
                target: close_target,
            };
            let _ = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                close_coord.close_agent(close_params),
            )
            .await;
            return Err(ToolCallError::Cancelled);
        }
    };
    let result = outcome?;
    if let Some(progress) = progress.as_ref() {
        let _ = progress.send(ToolProgress::StatusUpdate {
            message: format!("Child {} reported back", agent_path),
            percent: None,
        });
    }
    let mut collected = String::new();
    let mut saw_terminal_failure = false;
    for event in &result.events {
        if matches!(event.kind, AgentOutputEventKind::AssistantMessage) {
            if let Some(text) = event.text.as_ref() {
                if !collected.is_empty() {
                    collected.push('\n');
                }
                collected.push_str(text);
            }
        }
        if let Some(status) = event.status.as_ref() {
            if matches!(status.as_str(), "failed" | "interrupted" | "canceled") {
                saw_terminal_failure = true;
            }
        }
    }
    if result.timed_out && collected.is_empty() {
        return Err(ToolCallError::TimedOut(resolved_timeout));
    }
    if saw_terminal_failure && collected.is_empty() {
        return Err(ToolCallError::ExecutionFailed(format!(
            "child {agent_nickname} ended without producing assistant text"
        )));
    }
    Ok(collected)
}

/// Scan the child's reply from the tail for a
/// `<selected_id>X</selected_id>` marker. Whitespace outside the
/// marker is ignored. Returns the trimmed id (or `None`) in two
/// distinct cases:
/// - the reply contains no `<selected_id>...</selected_id>` close,
/// - the marker is present but its inner id fails [`letter_index`]’s
///   strict alphabet check (`[A-Z]`, `Z1..Z9..Z99..`). Returning
///   `None` for malformed ids lets the parent model know the
///   selector emitted *some* marker but a useless payload, so it
///   can fall back to a manual choice rather than silently
///   dropping the selection.
pub fn parse_selected_id_marker(text: &str) -> Option<String> {
    let trimmed = text.trim();
    let close = "</selected_id>";
    let end = trimmed.rfind(close)?;
    let open = trimmed[..end].rfind("<selected_id>")?;
    let id = trimmed[open + "<selected_id>".len()..end].trim();
    if id.is_empty() {
        return None;
    }
    letter_index(id).map(letter_id)
}

/// Stable per-letter id (A..Z, then Z1, Z2, ...) used by the
/// orchestrator tools to identify candidates deterministically in
/// the selector payload regardless of nicknames assigned by the
/// coordinator impl. Used together with [`letter_index`] which is
/// its strict inverse.
pub fn letter_id(index: usize) -> String {
    const LETTERS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if index < LETTERS.len() {
        (LETTERS[index] as char).to_string()
    } else {
        // Fall back to Z + ordinal beyond 26 — well past the practical
        // orchestrator fan-out limit but defined for completeness.
        format!("Z{}", index - LETTERS.len() + 1)
    }
}

/// Strict inverse of [`letter_id`].
///
/// Returns the canonical index for `id` iff:
/// - `id` is a single uppercase ASCII letter `[A-Z]`, OR
/// - `id` matches `Z\d+` with at least one digit (so `Z1` is index 26,
///   `Z2` is 27, …, `Z42` is 66, …).
///
/// Returns `None` for: empty string, lowercase letters, multi-letter
/// non-Z-prefixed run (e.g. `AA`), `Z0`, `Z` with no digits, `Z` with
/// non-digit suffix (e.g. `Z-1`, `Z `), and any non-ASCII input.
pub fn letter_index(id: &str) -> Option<usize> {
    let bytes = id.as_bytes();
    if bytes.len() == 1 && bytes[0].is_ascii_uppercase() {
        return Some((bytes[0] - b'A') as usize);
    }
    if bytes.len() >= 2 && bytes[0] == b'Z' {
        let rest = &bytes[1..];
        // Reject empty rest, non-digit chars, leading zeros that
        // would re-encode as `Z0` (which is not a valid letter_id
        // output). Any `Z0`-shaped ordinal is illegal regardless of
        // total width — `Z01` parses to the same surface as `Z1`
        // but is not a clean canonical form.
        if rest.is_empty() || !rest.iter().all(|b| b.is_ascii_digit()) {
            return None;
        }
        if rest[0] == b'0' {
            return None;
        }
        let ordinal: usize = std::str::from_utf8(rest).ok()?.parse().ok()?;
        if ordinal == 0 {
            return None;
        }
        return Some(25 + ordinal);
    }
    None
}

fn short_error(error: &ToolCallError) -> String {
    match error {
        ToolCallError::InvalidInput(m) => format!("invalid input: {}", m),
        ToolCallError::TimedOut(s) => format!("timeout ({}s)", s),
        ToolCallError::Cancelled => "cancelled".to_string(),
        ToolCallError::ExecutionFailed(m) => format!("execution failed: {}", m),
        ToolCallError::InternalError(m) => format!("internal error: {}", m),
        ToolCallError::Denied(m) => format!("denied: {}", m),
        ToolCallError::ApprovalRequired => "approval required".to_string(),
        ToolCallError::NeedsConfiguration(m) => format!("needs configuration: {}", m),
        ToolCallError::BlockedByMode(m) => format!("blocked by mode: {}", m),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_selected_id_marker_extracts_simple() {
        let text = "Here is my analysis.\n\n<selected_id>B</selected_id>";
        assert_eq!(parse_selected_id_marker(text).as_deref(), Some("B"));
    }

    #[test]
    fn parse_selected_id_marker_ignores_preamble() {
        let text = "I'll be brief.\nI considered A, B, and C.\n<selected_id>C</selected_id>\n";
        assert_eq!(parse_selected_id_marker(text).as_deref(), Some("C"));
    }

    #[test]
    fn parse_selected_id_marker_returns_none_when_missing() {
        assert_eq!(parse_selected_id_marker("I choose B but no marker"), None);
        assert_eq!(parse_selected_id_marker(""), None);
    }

    #[test]
    fn parse_selected_id_marker_handles_whitespace() {
        let text = "<selected_id>   A  </selected_id>";
        assert_eq!(parse_selected_id_marker(text).as_deref(), Some("A"));
    }

    #[test]
    fn parse_selected_id_marker_picks_last_occurrence() {
        let text = "<selected_id>A</selected_id>\nthinking more...\n<selected_id>B</selected_id>";
        assert_eq!(parse_selected_id_marker(text).as_deref(), Some("B"));
    }

    #[test]
    fn parse_selected_id_marker_rejects_empty_marker() {
        let text = "<selected_id></selected_id>";
        assert_eq!(parse_selected_id_marker(text), None);
    }

    #[test]
    fn letter_id_returns_capital_letters_up_to_26() {
        assert_eq!(letter_id(0), "A");
        assert_eq!(letter_id(1), "B");
        assert_eq!(letter_id(25), "Z");
        assert_eq!(letter_id(26), "Z1");
    }

    #[test]
    fn letter_index_roundtrips_through_letter_id() {
        for index in [0, 1, 5, 25, 26, 27, 35, 99, 125usize] {
            let id = letter_id(index);
            assert_eq!(
                letter_index(&id),
                Some(index),
                "letter_index({id:?}) != Some({index})"
            );
        }
    }

    #[test]
    fn letter_index_accepts_alphabet_and_z_ordinal() {
        assert_eq!(letter_index("A"), Some(0));
        assert_eq!(letter_index("Z"), Some(25));
        assert_eq!(letter_index("Z1"), Some(26));
        assert_eq!(letter_index("Z2"), Some(27));
        // ZN -> 25 + N (Z41 -> index 66, Z42 -> index 67, …)
        assert_eq!(letter_index("Z41"), Some(66));
        assert_eq!(letter_index("Z42"), Some(67));
        assert_eq!(letter_index("Z999"), Some(1024));
    }

    #[test]
    fn letter_index_rejects_malformed() {
        // Empty
        assert_eq!(letter_index(""), None);
        // Lowercase
        assert_eq!(letter_index("a"), None);
        assert_eq!(letter_index("z"), None);
        // Z with no digits / zero / non-digit suffix / leading-zero
        // (single-char "Z" is a valid alphabet letter, NOT malformed)
        assert_eq!(letter_index("Z0"), None);
        assert_eq!(letter_index("Z-1"), None);
        assert_eq!(letter_index("Zabc"), None);
        assert_eq!(letter_index("Z 1"), None);
        assert_eq!(letter_index("Z01"), None); // leading zero is illegal
        // Run of letters
        assert_eq!(letter_index("AA"), None);
        assert_eq!(letter_index("ZZ"), None);
        // Mixed ASCII / non-ASCII / non-letter
        assert_eq!(letter_index("1"), None);
        assert_eq!(letter_index("-A"), None);
        assert_eq!(letter_index("Á"), None); // UTF-8 upper-case, not ASCII
    }

    #[test]
    fn parse_selected_id_marker_rejects_malformed_ids() {
        // Marker present but id fails the strict alphabet.
        let text = "<selected_id>none</selected_id>";
        assert_eq!(parse_selected_id_marker(text), None);

        let text = "<selected_id>1</selected_id>";
        assert_eq!(parse_selected_id_marker(text), None);

        let text = "<selected_id>AA</selected_id>";
        assert_eq!(parse_selected_id_marker(text), None);

        let text = "<selected_id>a</selected_id>";
        assert_eq!(parse_selected_id_marker(text), None);

        let text = "<selected_id>Z0</selected_id>";
        assert_eq!(parse_selected_id_marker(text), None);

        // Valid ids still accepted.
        let text = "<selected_id>A</selected_id>";
        assert_eq!(parse_selected_id_marker(text).as_deref(), Some("A"));

        let text = "<selected_id>Z1</selected_id>";
        assert_eq!(parse_selected_id_marker(text).as_deref(), Some("Z1"));

        // Missing marker still returns None.
        assert_eq!(parse_selected_id_marker("just text"), None);
    }
}
