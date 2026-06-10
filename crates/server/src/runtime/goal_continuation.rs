//! Server-owned autonomous continuation for active thread goals.
//!
//! The TUI persists goal state through `goal/set`; this module decides when an
//! active goal is eligible to become an internal Build turn and launches that
//! turn without adding a synthetic user message to the transcript.

use super::*;
use crate::goal::GoalStatus;
use futures::future::BoxFuture;

struct GoalContinuationCandidate {
    goal_id: GoalId,
    goal: devo_protocol::ThreadGoal,
}

impl ServerRuntime {
    pub(super) fn maybe_start_goal_continuation_turn(
        self: &Arc<Self>,
        session_id: SessionId,
    ) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            let Some(session_arc) = self.sessions.lock().await.get(&session_id).cloned() else {
                return;
            };
            if self
                .pause_goal_continuation_after_failed_turn(session_id, &session_arc)
                .await
            {
                return;
            }
            if !session_allows_goal_continuation(&session_arc).await {
                return;
            }
            let Some(candidate) = self.goal_continuation_candidate(session_id).await else {
                return;
            };
            if !session_allows_goal_continuation(&session_arc).await {
                return;
            }

            let (turn_config, resolved_request) = {
                let session = session_arc.lock().await;
                let requested_model = session.summary.model.as_deref();
                let requested_thinking = session.summary.thinking.clone();
                let turn_config = self
                    .deps
                    .resolve_turn_config(requested_model, requested_thinking);
                let resolved_request = turn_config
                    .model
                    .resolve_thinking_selection(turn_config.thinking_selection.as_deref());
                (turn_config, resolved_request)
            };
            let request_model = turn_config.provider_request_model(&resolved_request.request_model);

            let now = Utc::now();
            let turn = {
                let mut session = session_arc.lock().await;
                if !session_allows_goal_continuation_locked(&session) {
                    return;
                }
                let turn = TurnMetadata {
                    turn_id: TurnId::new(),
                    session_id,
                    sequence: session
                        .latest_turn
                        .as_ref()
                        .map_or(1, |turn| turn.sequence + 1),
                    status: TurnStatus::Running,
                    kind: devo_core::TurnKind::Regular,
                    model: turn_config.model.slug.clone(),
                    thinking: turn_config.thinking_selection.clone(),
                    reasoning_effort: resolved_request.effective_reasoning_effort,
                    request_model,
                    request_thinking: resolved_request.request_thinking.clone(),
                    started_at: now,
                    completed_at: None,
                    usage: None,
                };
                session.summary.status = SessionRuntimeStatus::ActiveTurn;
                session.summary.updated_at = now;
                session.summary.model = Some(turn_config.model.slug.clone());
                session.summary.thinking = turn_config.thinking_selection.clone();
                session.active_turn = Some(turn.clone());
                turn
            };
            if !self
                .mark_goal_continuation_turn_started(session_id, &candidate.goal_id)
                .await
            {
                self.clear_goal_continuation_turn_reservation(&session_arc, turn.turn_id)
                    .await;
                return;
            }

            if let Err(error) = self
                .append_goal_continuation_turn_start(session_id, &turn)
                .await
            {
                tracing::warn!(
                    session_id = %session_id,
                    turn_id = %turn.turn_id,
                    error = %error,
                    "failed to persist goal continuation turn start"
                );
                self.clear_goal_continuation_turn_reservation(&session_arc, turn.turn_id)
                    .await;
                return;
            }

            self.broadcast_event(ServerEvent::SessionStatusChanged(
                SessionStatusChangedPayload {
                    session_id,
                    status: SessionRuntimeStatus::ActiveTurn,
                },
            ))
            .await;
            self.broadcast_event(ServerEvent::TurnStarted(TurnEventPayload {
                session_id,
                turn: turn.clone(),
            }))
            .await;

            let cancel_token = CancellationToken::new();
            self.active_turn_cancellations
                .lock()
                .await
                .insert(session_id, cancel_token);
            let runtime = Arc::clone(self);
            let task_turn = turn.clone();
            let task_turn_config = turn_config.clone();
            let task = tokio::spawn(async move {
                runtime
                    .execute_turn(ExecuteTurnRequest {
                        session_id,
                        turn: task_turn,
                        turn_config: task_turn_config,
                        display_input: String::new(),
                        input: String::new(),
                        collaboration_mode: devo_protocol::CollaborationMode::Build,
                        input_mode: TurnInputMode::HiddenGoalContinuation {
                            goal: candidate.goal,
                        },
                    })
                    .await;
            });
            self.active_tasks
                .lock()
                .await
                .insert(session_id, task.abort_handle());
        })
    }

    async fn goal_continuation_candidate(
        &self,
        session_id: SessionId,
    ) -> Option<GoalContinuationCandidate> {
        let stores = self.goal_stores.lock().await;
        let goal = stores.get(&session_id)?.get()?;
        if !goal.check_continuation().should_continue {
            return None;
        }
        Some(GoalContinuationCandidate {
            goal_id: goal.goal_id.clone(),
            goal: goal.to_thread_goal(),
        })
    }

    async fn pause_goal_continuation_after_failed_turn(
        &self,
        session_id: SessionId,
        session_arc: &Arc<Mutex<RuntimeSession>>,
    ) -> bool {
        let latest_turn = {
            let session = session_arc.lock().await;
            session.latest_turn.clone()
        };

        let mut stores = self.goal_stores.lock().await;
        let Some(goal) = stores.get_mut(&session_id).and_then(GoalStore::get_mut) else {
            return false;
        };
        if goal.status != GoalStatus::Active
            || !failed_turn_should_suppress_goal(goal.updated_at, latest_turn.as_ref())
        {
            return false;
        }

        goal.status = GoalStatus::Paused;
        goal.blocker_summary = Some(
            "Goal continuation paused because the previous turn failed before the goal could continue."
                .to_string(),
        );
        goal.updated_at = Utc::now();
        drop(stores);

        self.sync_core_session_goal(session_id, None).await;
        tracing::warn!(
            session_id = %session_id,
            "paused active goal continuation after failed turn"
        );
        true
    }

    async fn append_goal_continuation_turn_start(
        &self,
        session_id: SessionId,
        turn: &TurnMetadata,
    ) -> anyhow::Result<()> {
        let Some(session_arc) = self.sessions.lock().await.get(&session_id).cloned() else {
            return Ok(());
        };
        let (record, session_context, turn_context) = {
            let session = session_arc.lock().await;
            let core_session = session.core_session.lock().await;
            (
                session.record.clone(),
                core_session.session_context.clone(),
                core_session.latest_turn_context.clone(),
            )
        };
        if let Some(record) = record {
            self.rollout_store.append_turn(
                &record,
                build_turn_record(turn, session_context, turn_context),
            )?;
        }
        Ok(())
    }

    async fn mark_goal_continuation_turn_started(
        &self,
        session_id: SessionId,
        goal_id: &GoalId,
    ) -> bool {
        let mut stores = self.goal_stores.lock().await;
        stores
            .get_mut(&session_id)
            .and_then(GoalStore::get_mut)
            .filter(|goal| &goal.goal_id == goal_id)
            .filter(|goal| goal.check_continuation().should_continue)
            .map(|goal| {
                goal.usage.record_turn();
                true
            })
            .unwrap_or(false)
    }

    async fn clear_goal_continuation_turn_reservation(
        &self,
        session_arc: &Arc<Mutex<RuntimeSession>>,
        turn_id: TurnId,
    ) {
        let mut session = session_arc.lock().await;
        if session
            .active_turn
            .as_ref()
            .is_some_and(|active| active.turn_id == turn_id)
        {
            session.active_turn = None;
            session.summary.status = SessionRuntimeStatus::Idle;
        }
    }
}

async fn session_allows_goal_continuation(session_arc: &Arc<Mutex<RuntimeSession>>) -> bool {
    let session = session_arc.lock().await;
    session_allows_goal_continuation_locked(&session)
}

fn session_allows_goal_continuation_locked(session: &RuntimeSession) -> bool {
    if session.active_turn.is_some()
        || !session.pending_approvals.is_empty()
        || !session.pending_user_inputs.is_empty()
    {
        return false;
    }
    session
        .pending_turn_queue
        .lock()
        .expect("pending turn queue mutex should not be poisoned")
        .is_empty()
}

fn failed_turn_should_suppress_goal(
    goal_updated_at: chrono::DateTime<Utc>,
    latest_turn: Option<&TurnMetadata>,
) -> bool {
    let Some(turn) = latest_turn else {
        return false;
    };
    if turn.status != TurnStatus::Failed {
        return false;
    }
    turn.completed_at.unwrap_or(turn.started_at) > goal_updated_at
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(status: TurnStatus, completed_at: chrono::DateTime<Utc>) -> TurnMetadata {
        TurnMetadata {
            turn_id: TurnId::new(),
            session_id: SessionId::new(),
            sequence: 1,
            status,
            kind: devo_core::TurnKind::Regular,
            model: "model-a".into(),
            thinking: None,
            reasoning_effort: None,
            request_model: "provider/model-a".into(),
            request_thinking: None,
            started_at: completed_at - chrono::Duration::seconds(1),
            completed_at: Some(completed_at),
            usage: None,
        }
    }

    #[test]
    fn failed_turn_after_goal_update_suppresses_continuation() {
        // Trace: L2-DES-GOAL-001
        let goal_updated_at = Utc::now();
        let latest_turn = turn(
            TurnStatus::Failed,
            goal_updated_at + chrono::Duration::seconds(1),
        );

        assert!(failed_turn_should_suppress_goal(
            goal_updated_at,
            Some(&latest_turn)
        ));
    }

    #[test]
    fn failed_turn_before_goal_update_allows_manual_resume() {
        // Trace: L2-DES-GOAL-001
        let latest_turn_completed_at = Utc::now();
        let goal_updated_at = latest_turn_completed_at + chrono::Duration::seconds(1);
        let latest_turn = turn(TurnStatus::Failed, latest_turn_completed_at);

        assert!(!failed_turn_should_suppress_goal(
            goal_updated_at,
            Some(&latest_turn)
        ));
    }

    #[test]
    fn completed_turn_does_not_suppress_continuation() {
        // Trace: L2-DES-GOAL-001
        let goal_updated_at = Utc::now();
        let latest_turn = turn(
            TurnStatus::Completed,
            goal_updated_at + chrono::Duration::seconds(1),
        );

        assert!(!failed_turn_should_suppress_goal(
            goal_updated_at,
            Some(&latest_turn)
        ));
    }
}
