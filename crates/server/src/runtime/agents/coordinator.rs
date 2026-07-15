use super::*;

impl ServerRuntime {
    fn wait_agent_cursor_key(target: Option<&str>) -> String {
        infinitecode_protocol::wait_agent_cursor_key(target)
    }

    async fn wait_agent_cursor(&self, parent_session_id: SessionId, target_key: &str) -> u64 {
        self.agent_wait_cursors
            .lock()
            .await
            .get(&parent_session_id)
            .and_then(|cursors| cursors.get(target_key).copied())
            .unwrap_or_default()
    }

    async fn update_wait_agent_cursor(
        &self,
        parent_session_id: SessionId,
        target_key: &str,
        consumed_sequence: u64,
    ) {
        if consumed_sequence == 0 {
            return;
        }
        self.agent_wait_cursors
            .lock()
            .await
            .entry(parent_session_id)
            .or_default()
            .insert(target_key.to_string(), consumed_sequence);
    }

    async fn send_message_inner(
        self: &Arc<Self>,
        params: infinitecode_protocol::AgentMessageParams,
    ) -> Result<infinitecode_protocol::AgentMessageResult, ToolCallError> {
        let message = params.message;
        let route = self
            .queue_agent_message(params.session_id, &params.target, message.clone())
            .await?;
        if let Some(metadata) = self
            .agent_registries
            .lock()
            .await
            .get_mut(&params.session_id)
            .and_then(|registry| registry.agents.get_mut(&route.to_session_id))
        {
            metadata.last_task_message = Some(message);
        }
        if self
            .active_turn_id_for_session(route.to_session_id)
            .await
            .is_none()
        {
            self.drain_child_mailbox_into_user_turns(route.to_session_id)
                .await?;
        }
        Ok(infinitecode_protocol::AgentMessageResult {
            delivered: true,
            task_id: infinitecode_protocol::TaskId::from(route.to_session_id),
        })
    }

    async fn wait_agent_inner(
        &self,
        params: infinitecode_protocol::WaitAgentParams,
    ) -> Result<infinitecode_protocol::WaitAgentResult, ToolCallError> {
        let timeout = Duration::from_secs(infinitecode_protocol::resolve_wait_agent_timeout(
            params.timeout_secs,
        ));
        let target_session_ids = self
            .resolve_wait_agent_targets(params.session_id, params.target.as_deref())
            .await?;
        let cursor_key = Self::wait_agent_cursor_key(params.target.as_deref());
        let effective_after_sequence = match params.after_sequence {
            Some(after_sequence) => after_sequence,
            None => self.wait_agent_cursor(params.session_id, &cursor_key).await,
        };
        let output_buffer = self.output_buffer(params.session_id).await;
        let cancel = self.active_turns.cancel_token(params.session_id).await;
        let (events, next_sequence, timed_out) = output_buffer
            .wait_after(
                effective_after_sequence,
                &target_session_ids,
                timeout,
                cancel,
            )
            .await;
        if let Some(consumed_sequence) = events.iter().map(|event| event.sequence).max()
            && params.after_sequence.is_none()
        {
            self.update_wait_agent_cursor(params.session_id, &cursor_key, consumed_sequence)
                .await;
        }
        Ok(infinitecode_protocol::WaitAgentResult {
            events: events
                .into_iter()
                .map(infinitecode_protocol::ParentAgentOutputEvent::from)
                .collect(),
            next_sequence,
            timed_out,
        })
    }

    async fn list_agents_inner(
        &self,
        params: infinitecode_protocol::AgentListParams,
    ) -> Result<Vec<infinitecode_protocol::AgentInfo>, ToolCallError> {
        let registries = self.agent_registries.lock().await;
        Ok(registries
            .get(&params.session_id)
            .map(|registry| {
                registry.list_children(params.session_id, params.path_prefix.as_deref())
            })
            .unwrap_or_default())
    }

    async fn close_agent_inner(
        self: &Arc<Self>,
        params: infinitecode_protocol::CloseAgentParams,
    ) -> Result<infinitecode_protocol::CloseAgentResult, ToolCallError> {
        let child_session_id = self
            .resolve_child_agent(params.session_id, &params.target)
            .await?
            .session_id;
        let status = self
            .close_child_agent(params.session_id, child_session_id)
            .await?;
        Ok(infinitecode_protocol::CloseAgentResult {
            closed: true,
            status,
        })
    }

    fn task_state_from_agent_status(status: &str) -> infinitecode_protocol::TaskState {
        match status {
            "completed" | "waiting_for_input" => infinitecode_protocol::TaskState::Completed,
            "failed" => infinitecode_protocol::TaskState::Failed,
            "interrupted" | "canceled" | "closed" => infinitecode_protocol::TaskState::Canceled,
            "spawning" | "running" => infinitecode_protocol::TaskState::Running,
            _ => infinitecode_protocol::TaskState::Failed,
        }
    }

    async fn task_info_from_agent(
        &self,
        info: infinitecode_protocol::AgentInfo,
    ) -> infinitecode_protocol::TaskInfo {
        let waiting_approval = match info.parent_session_id {
            Some(parent_session_id) => {
                self.session_interactive
                    .has_pending_approval_for_session(parent_session_id, info.session_id)
                    .await
                    || self
                        .session_interactive
                        .has_pending_approval_for_session(info.session_id, info.session_id)
                        .await
            }
            None => {
                self.session_interactive
                    .has_pending_approval_for_session(info.session_id, info.session_id)
                    .await
            }
        };
        let state = if waiting_approval {
            infinitecode_protocol::TaskState::WaitingApproval
        } else {
            Self::task_state_from_agent_status(&info.status)
        };
        infinitecode_protocol::TaskInfo {
            task_id: infinitecode_protocol::TaskId::from(info.session_id),
            kind: infinitecode_protocol::TaskKind::Agent,
            state,
            agent: Some(infinitecode_protocol::AgentTaskMetadata {
                session_id: info.session_id,
                parent_session_id: info.parent_session_id,
                agent_path: info.agent_path,
                agent_nickname: info.agent_nickname,
                agent_role: info.agent_role,
                last_task_message: info.last_task_message,
            }),
            command: None,
        }
    }

    async fn await_task_inner(
        &self,
        params: infinitecode_protocol::AwaitTaskParams,
    ) -> Result<infinitecode_protocol::AwaitTaskResult, ToolCallError> {
        let task_id = params.task_id;
        let wait_result = self
            .wait_agent_inner(infinitecode_protocol::WaitAgentParams {
                session_id: params.session_id,
                target: Some(task_id.0.clone()),
                after_sequence: None,
                timeout_secs: params.timeout_secs,
            })
            .await?;
        let task = self
            .task_info_from_agent(self.agent_info(params.session_id, task_id.as_ref()).await?)
            .await;
        if wait_result.timed_out {
            return Ok(infinitecode_protocol::AwaitTaskResult::TimedOut { task });
        }
        let output = wait_result
            .events
            .into_iter()
            .rev()
            .filter(|event| event.kind.is_assistant_text())
            .filter_map(|event| event.text)
            .next();
        Ok(infinitecode_protocol::AwaitTaskResult::Terminal { task, output })
    }

    async fn list_tasks_inner(
        &self,
        params: infinitecode_protocol::ListTasksParams,
    ) -> Result<infinitecode_protocol::ListTasksResult, ToolCallError> {
        let agents = self
            .list_agents_inner(infinitecode_protocol::AgentListParams {
                session_id: params.session_id,
                path_prefix: params.path_prefix,
            })
            .await?;
        let mut tasks = Vec::with_capacity(agents.len());
        for agent in agents {
            tasks.push(self.task_info_from_agent(agent).await);
        }
        Ok(infinitecode_protocol::ListTasksResult { tasks })
    }

    async fn cancel_task_inner(
        self: &Arc<Self>,
        params: infinitecode_protocol::CancelTaskParams,
    ) -> Result<infinitecode_protocol::CancelTaskResult, ToolCallError> {
        let child = self
            .resolve_child_agent(params.session_id, params.task_id.as_ref())
            .await?;
        self.close_agent_inner(infinitecode_protocol::CloseAgentParams {
            session_id: params.session_id,
            target: params.task_id.0.clone(),
        })
        .await?;
        self.set_agent_status(params.session_id, child.session_id, SubagentStatus::Closed)
            .await;
        let task = self
            .task_info_from_agent(
                self.agent_info(params.session_id, params.task_id.as_ref())
                    .await?,
            )
            .await;
        Ok(infinitecode_protocol::CancelTaskResult { task })
    }
}

#[async_trait::async_trait]
impl AgentToolCoordinator for ServerRuntime {
    async fn spawn_agent(
        self: Arc<Self>,
        params: infinitecode_protocol::SpawnAgentParams,
    ) -> Result<infinitecode_protocol::SpawnAgentResult, ToolCallError> {
        self.spawn_agent_inner(params).await
    }

    async fn send_message(
        self: Arc<Self>,
        params: infinitecode_protocol::AgentMessageParams,
    ) -> Result<infinitecode_protocol::AgentMessageResult, ToolCallError> {
        self.send_message_inner(params).await
    }

    async fn wait_agent(
        self: Arc<Self>,
        params: infinitecode_protocol::WaitAgentParams,
    ) -> Result<infinitecode_protocol::WaitAgentResult, ToolCallError> {
        self.wait_agent_inner(params).await
    }

    async fn list_agents(
        self: Arc<Self>,
        params: infinitecode_protocol::AgentListParams,
    ) -> Result<Vec<infinitecode_protocol::AgentInfo>, ToolCallError> {
        self.list_agents_inner(params).await
    }

    async fn close_agent(
        self: Arc<Self>,
        params: infinitecode_protocol::CloseAgentParams,
    ) -> Result<infinitecode_protocol::CloseAgentResult, ToolCallError> {
        self.close_agent_inner(params).await
    }

    async fn await_task(
        self: Arc<Self>,
        params: infinitecode_protocol::AwaitTaskParams,
    ) -> Result<infinitecode_protocol::AwaitTaskResult, ToolCallError> {
        self.await_task_inner(params).await
    }

    async fn list_tasks(
        self: Arc<Self>,
        params: infinitecode_protocol::ListTasksParams,
    ) -> Result<infinitecode_protocol::ListTasksResult, ToolCallError> {
        self.list_tasks_inner(params).await
    }

    async fn cancel_task(
        self: Arc<Self>,
        params: infinitecode_protocol::CancelTaskParams,
    ) -> Result<infinitecode_protocol::CancelTaskResult, ToolCallError> {
        self.cancel_task_inner(params).await
    }

    async fn request_user_input(
        self: Arc<Self>,
        session_id: String,
        turn_id: String,
        tool_call_id: String,
        args: infinitecode_protocol::RequestUserInputArgs,
    ) -> Result<infinitecode_protocol::RequestUserInputResponse, ToolCallError> {
        let session_id = SessionId::try_from(session_id.as_str())
            .map_err(|error| ToolCallError::InvalidInput(error.to_string()))?;
        let turn_id = TurnId::try_from(turn_id.as_str())
            .map_err(|error| ToolCallError::InvalidInput(error.to_string()))?;
        self.request_user_input_for_tool(session_id, turn_id, tool_call_id, args)
            .await
    }

    async fn update_goal(
        self: Arc<Self>,
        session_id: String,
        status: String,
    ) -> Result<serde_json::Value, ToolCallError> {
        if status != "complete" {
            return Err(ToolCallError::InvalidInput(
                "update_goal only accepts status='complete'".to_string(),
            ));
        }
        let session_id = SessionId::try_from(session_id.as_str())
            .map_err(|error| ToolCallError::InvalidInput(error.to_string()))?;

        let mut stores = self.goal_stores.lock().await;
        let store = stores.get_mut(&session_id).ok_or_else(|| {
            ToolCallError::InvalidInput("no active goal exists for this session".to_string())
        })?;
        let previous_status = store.get().map(|goal| goal.status).ok_or_else(|| {
            ToolCallError::InvalidInput("no active goal exists for this session".to_string())
        })?;
        let goal = store
            .set_status(infinitecode_protocol::ThreadGoalStatus::Complete)
            .map_err(|error| ToolCallError::ExecutionFailed(error.to_string()))?;
        let thread_goal = goal.to_thread_goal();
        drop(stores);

        if let Err(error) = self
            .goal_durable_store
            .append_status_changed(&goal, previous_status, None)
            .await
        {
            tracing::warn!(session_id = %session_id, error = %error, "failed to persist update_goal status record");
        }
        self.sync_core_session_goal(session_id, None).await;
        Ok(serde_json::json!({
            "status": "complete",
            "tokens_used": thread_goal.tokens_used,
            "time_used_seconds": thread_goal.time_used_seconds,
        }))
    }
}
