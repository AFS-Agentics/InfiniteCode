use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::AtomicUsize;
use std::sync::atomic::Ordering;

use anyhow::Context;
use anyhow::Result;
use async_trait::async_trait;
use chrono::Datelike;
use chrono::SecondsFormat;
use infinitecode_core::AppConfigStore;
use infinitecode_core::BundledSkillsConfig;
use infinitecode_core::FileSystemSkillCatalog;
use infinitecode_core::PresetModelCatalog;
use infinitecode_core::ProviderVendorCatalog;
use infinitecode_core::SkillsConfig;
use infinitecode_core::tools::ToolRegistry;
use infinitecode_protocol::ItemKind;
use infinitecode_protocol::Model;
use infinitecode_protocol::ModelRequest;
use infinitecode_protocol::ModelResponse;
use infinitecode_protocol::ProviderRetryPhase;
use infinitecode_protocol::ResponseContent;
use infinitecode_protocol::ResponseMetadata;
use infinitecode_protocol::ServerEvent;
use infinitecode_protocol::SessionId;
use infinitecode_protocol::StopReason;
use infinitecode_protocol::StreamEvent;
use infinitecode_protocol::TurnErrorPayload;
use infinitecode_protocol::TurnId;
use infinitecode_protocol::TurnProviderRetryStatusPayload;
use infinitecode_protocol::Usage;
use infinitecode_provider::ModelProviderSDK;
use infinitecode_provider::ProviderRoute;
use infinitecode_provider::ProviderRouter;
use infinitecode_provider::error::ProviderError;
use futures::Stream;
use futures::stream;
use pretty_assertions::assert_eq;
use tempfile::TempDir;
use tokio::sync::mpsc;
use tokio::time::Duration;
use tokio::time::timeout;

use infinitecode_server::ClientTransportKind;
use infinitecode_server::ServerRuntime;
use infinitecode_server::ServerRuntimeDependencies;

const PROVIDER_ERROR_TEXT: &str = "Internal server error";
const FAILING_ATTEMPTS: usize = 6;

#[derive(Default)]
struct ExhaustingRouter {
    attempts: AtomicUsize,
    requests: Mutex<Vec<ModelRequest>>,
}

impl ExhaustingRouter {
    fn requests(&self) -> Vec<ModelRequest> {
        self.requests.lock().expect("lock requests").clone()
    }
}

#[async_trait]
impl ProviderRouter for ExhaustingRouter {
    async fn stream(
        &self,
        _route: ProviderRoute,
        request: ModelRequest,
    ) -> Result<std::pin::Pin<Box<dyn Stream<Item = Result<StreamEvent>> + Send>>, ProviderError>
    {
        self.requests.lock().expect("lock requests").push(request);
        let attempt = self.attempts.fetch_add(1, Ordering::SeqCst);
        if attempt < FAILING_ATTEMPTS {
            return Ok(Box::pin(stream::iter(vec![Err(
                ProviderError::ProviderServerError {
                    message: PROVIDER_ERROR_TEXT.to_string(),
                    status_code: Some(500),
                    provider_name: Some("openai".to_string()),
                }
                .into(),
            )])));
        }
        Ok(Box::pin(stream::iter(vec![
            Ok(StreamEvent::TextDelta {
                index: 0,
                text: "valid response".to_string(),
            }),
            Ok(StreamEvent::MessageDone {
                response: model_response("valid response"),
            }),
        ])))
    }

    async fn complete(
        &self,
        _route: ProviderRoute,
        _request: ModelRequest,
    ) -> Result<ModelResponse, ProviderError> {
        Ok(model_response("Generated title"))
    }

    fn name(&self) -> &str {
        "exhausting-router"
    }
}

struct UnusedProvider;

#[async_trait]
impl ModelProviderSDK for UnusedProvider {
    async fn completion(&self, _request: ModelRequest) -> Result<ModelResponse> {
        anyhow::bail!("unused provider should not receive completion requests")
    }

    async fn completion_stream(
        &self,
        _request: ModelRequest,
    ) -> Result<std::pin::Pin<Box<dyn Stream<Item = Result<StreamEvent>> + Send>>> {
        anyhow::bail!("unused provider should not receive streaming requests")
    }

    fn name(&self) -> &str {
        "unused-provider"
    }
}

#[tokio::test(start_paused = true)]
async fn exhausted_provider_retries_persist_for_history_but_do_not_enter_context() -> Result<()> {
    let data_root = TempDir::new()?;
    write_provider_config(data_root.path())?;
    let router = Arc::new(ExhaustingRouter::default());
    let runtime = build_runtime(data_root.path(), router.clone())?;
    let (connection_id, mut notifications_rx) = initialize_connection(&runtime).await?;
    let session = start_session(&runtime, connection_id, data_root.path()).await?;

    let failed_turn_id = start_turn(&runtime, connection_id, session.session_id, 3).await?;
    let mut retry_statuses = Vec::new();
    let mut failed_error = None;
    let mut failed_agent_items = Vec::new();
    timeout(Duration::from_secs(30), async {
        while let Some(value) = notifications_rx.recv().await {
            let Some(event) = original_event(&value) else {
                continue;
            };
            match event {
                ServerEvent::TurnProviderRetryStatus(payload) => retry_statuses.push(payload),
                ServerEvent::ItemStarted(payload) | ServerEvent::ItemCompleted(payload)
                    if payload.item.item_kind == ItemKind::AgentMessage =>
                {
                    failed_agent_items.push(payload.item)
                }
                ServerEvent::TurnFailed(payload) => {
                    failed_error = payload.error;
                    break;
                }
                ServerEvent::SessionStarted(_)
                | ServerEvent::SessionTitleUpdated(_)
                | ServerEvent::SessionCompactionStarted(_)
                | ServerEvent::SessionCompactionCompleted(_)
                | ServerEvent::SessionCompactionFailed(_)
                | ServerEvent::SessionStatusChanged(_)
                | ServerEvent::SessionArchived(_)
                | ServerEvent::SessionUnarchived(_)
                | ServerEvent::SessionClosed(_)
                | ServerEvent::SessionDeleted(_)
                | ServerEvent::TurnStarted(_)
                | ServerEvent::TurnCompleted(_)
                | ServerEvent::TurnInterrupted(_)
                | ServerEvent::TurnPlanUpdated(_)
                | ServerEvent::TurnDiffUpdated(_)
                | ServerEvent::TurnUsageUpdated(_)
                | ServerEvent::ItemStarted(_)
                | ServerEvent::ItemCompleted(_)
                | ServerEvent::ItemDelta { .. }
                | ServerEvent::WorkspaceChangesUpdated(_)
                | ServerEvent::ToolCallStatusUpdated(_)
                | ServerEvent::RequestUserInput(_)
                | ServerEvent::InputQueueUpdated(_)
                | ServerEvent::SteerAccepted(_)
                | ServerEvent::MessageEditRecorded(_)
                | ServerEvent::TurnSuperseded(_)
                | ServerEvent::WorkspaceRestoreStarted(_)
                | ServerEvent::WorkspaceRestoreCompleted(_)
                | ServerEvent::ServerRequestResolved(_)
                | ServerEvent::ReferenceSearchUpdated(_)
                | ServerEvent::ReferenceSearchCompleted(_)
                | ServerEvent::ReferenceSearchFailed(_)
                | ServerEvent::CommandExecOutputDelta(_)
                | ServerEvent::CommandExecExited(_) => {}
            }
        }
    })
    .await
    .context("timed out waiting for failed turn")?;

    assert_eq!(
        retry_statuses,
        expected_retry_statuses(session.session_id, failed_turn_id)
    );
    assert_eq!(
        failed_error,
        Some(TurnErrorPayload {
            code: "PROVIDER_SERVER_ERROR".to_string(),
            message: format!(
                "model provider error: provider server error (Some(500)): {PROVIDER_ERROR_TEXT}"
            ),
        })
    );
    assert_eq!(failed_agent_items, Vec::new());

    wait_for_original_event(&mut notifications_rx, "turn/completed").await?;
    let rollout = std::fs::read_to_string(rollout_path(data_root.path(), &session))?;
    assert!(rollout.contains(PROVIDER_ERROR_TEXT));
    let persisted_error = rollout
        .lines()
        .filter_map(|line| serde_json::from_str::<infinitecode_core::RolloutLine>(line).ok())
        .find_map(|line| match line {
            infinitecode_core::RolloutLine::Turn(line) if line.turn.id == failed_turn_id => line.turn.error,
            _ => None,
        });
    assert_eq!(
        persisted_error,
        Some(infinitecode_core::TurnError {
            code: "PROVIDER_SERVER_ERROR".to_string(),
            message: format!(
                "model provider error: provider server error (Some(500)): {PROVIDER_ERROR_TEXT}"
            ),
        })
    );

    let resume_response = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 5,
                "method": "_infinitecode/session/resume",
                "params": { "session_id": session.session_id }
            }),
        )
        .await
        .context("session/resume after failed turn")?;
    let resume = serde_json::from_value::<
        infinitecode_server::SuccessResponse<infinitecode_server::SessionResumeResult>,
    >(resume_response)?
    .result;
    let terminal_history = resume
        .history_items
        .iter()
        .filter(|item| {
            matches!(
                item.kind,
                infinitecode_protocol::SessionHistoryItemKind::Error
                    | infinitecode_protocol::SessionHistoryItemKind::TurnSummary
            )
        })
        .cloned()
        .collect::<Vec<_>>();
    let failed_turn = resume.latest_turn.context("latest failed turn")?;
    let duration_secs = failed_turn.completed_at.and_then(|completed| {
        let seconds = (completed - failed_turn.started_at).num_seconds();
        (seconds > 0).then_some(seconds as u64)
    });
    assert_eq!(
        terminal_history,
        vec![
            infinitecode_protocol::SessionHistoryItem::new(
                None,
                infinitecode_protocol::SessionHistoryItemKind::Error,
                "PROVIDER_SERVER_ERROR".to_string(),
                format!(
                    "model provider error: provider server error (Some(500)): {PROVIDER_ERROR_TEXT}"
                ),
            ),
            infinitecode_protocol::SessionHistoryItem {
                tool_call_id: None,
                kind: infinitecode_protocol::SessionHistoryItemKind::TurnSummary,
                title: failed_turn.model,
                body: "failed".to_string(),
                tool_io: None,
                metadata: None,
                duration_ms: duration_secs,
            },
        ]
    );

    let successful_turn_id = start_turn(&runtime, connection_id, session.session_id, 4).await?;
    wait_for_original_event(&mut notifications_rx, "turn/completed").await?;
    let requests = router.requests();
    let successful_request = requests.last().context("successful provider request")?;
    let request_json = serde_json::to_string(successful_request)?;
    assert!(!request_json.contains(PROVIDER_ERROR_TEXT));
    assert_eq!(router.attempts.load(Ordering::SeqCst), FAILING_ATTEMPTS + 1);
    assert_ne!(successful_turn_id, failed_turn_id);

    Ok(())
}

fn expected_retry_statuses(
    session_id: SessionId,
    turn_id: TurnId,
) -> Vec<TurnProviderRetryStatusPayload> {
    let mut statuses = Vec::new();
    for attempt in 1..=5 {
        let backoff_ms = 250 * 2_u64.pow((attempt - 1) as u32);
        statuses.push(TurnProviderRetryStatusPayload {
            session_id,
            turn_id,
            attempt,
            backoff_ms,
            provider: "exhausting-router".to_string(),
            model: "default-model".to_string(),
            phase: ProviderRetryPhase::Scheduled,
            message: format!(
                "Retrying provider request in {:.1}s",
                Duration::from_millis(backoff_ms).as_secs_f64()
            ),
        });
        statuses.push(TurnProviderRetryStatusPayload {
            session_id,
            turn_id,
            attempt,
            backoff_ms: 0,
            provider: "exhausting-router".to_string(),
            model: "default-model".to_string(),
            phase: ProviderRetryPhase::Resumed,
            message: "Retrying provider request now".to_string(),
        });
    }
    statuses
}

fn write_provider_config(data_root: &std::path::Path) -> Result<()> {
    std::fs::write(
        data_root.join("auth.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "version": 1,
            "credentials": {
                "test_api_key": { "kind": "api_key", "value": "test-secret" }
            }
        }))?,
    )?;
    std::fs::write(
        data_root.join("config.toml"),
        r#"
[defaults]
model_binding = "main"

[providers.openai]
enabled = true
name = "OpenAI"
credential = "test_api_key"
wire_apis = ["openai_chat_completions"]

[model_bindings.main]
enabled = true
model_slug = "default-model"
provider = "openai"
request_model = "provider-model"
invocation_method = "openai_chat_completions"
"#,
    )?;
    Ok(())
}

fn build_runtime(
    data_root: &std::path::Path,
    router: Arc<ExhaustingRouter>,
) -> Result<Arc<ServerRuntime>> {
    let provider: Arc<dyn ModelProviderSDK> = Arc::new(UnusedProvider);
    let provider_router: Arc<dyn ProviderRouter> = router;
    let db = Arc::new(infinitecode_server::db::Database::open(
        data_root.join("provider_failure_reporting.db"),
    )?);
    Ok(ServerRuntime::new(
        data_root.to_path_buf(),
        ServerRuntimeDependencies::new(
            provider,
            provider_router,
            Arc::new(ToolRegistry::new()),
            "default-model".to_string(),
            Arc::new(PresetModelCatalog::new(vec![Model {
                slug: "default-model".to_string(),
                display_name: "Default Model".to_string(),
                ..Model::default()
            }])),
            Arc::new(ProviderVendorCatalog::default()),
            Box::new(FileSystemSkillCatalog::new(SkillsConfig {
                bundled: Some(BundledSkillsConfig { enabled: false }),
                ..SkillsConfig::default()
            })),
            infinitecode_core::AgentsMdConfig::default(),
            db,
            Arc::new(std::sync::Mutex::new(AppConfigStore::load(
                data_root.to_path_buf(),
                /*workspace_root*/ None,
            )?)),
        ),
    ))
}

async fn initialize_connection(
    runtime: &Arc<ServerRuntime>,
) -> Result<(u64, mpsc::Receiver<serde_json::Value>)> {
    let (notifications_tx, notifications_rx) = infinitecode_server::test_outbound_channel(128);
    let connection_id = runtime
        .register_connection(ClientTransportKind::Stdio, notifications_tx)
        .await;
    runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": 1,
                    "clientCapabilities": {},
                    "clientInfo": { "name": "failure-test", "version": "1.0.0" }
                }
            }),
        )
        .await
        .context("initialize response")?;
    Ok((connection_id, notifications_rx))
}

async fn start_session(
    runtime: &Arc<ServerRuntime>,
    connection_id: u64,
    cwd: &std::path::Path,
) -> Result<infinitecode_server::SessionMetadata> {
    let response = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 2,
                "method": "session/start",
                "params": {
                    "cwd": cwd,
                    "ephemeral": false,
                    "title": null,
                    "model_binding_id": "main"
                }
            }),
        )
        .await
        .context("session/start response")?;
    let response: infinitecode_server::SuccessResponse<infinitecode_server::SessionStartResult> =
        serde_json::from_value(response)?;
    Ok(response.result.session)
}

async fn start_turn(
    runtime: &Arc<ServerRuntime>,
    connection_id: u64,
    session_id: SessionId,
    id: u64,
) -> Result<TurnId> {
    let response = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": id,
                "method": "_infinitecode/turn/start",
                "params": {
                    "session_id": session_id,
                    "input": [{ "type": "text", "text": "try the provider" }],
                    "model_binding_id": "main"
                }
            }),
        )
        .await
        .context("turn/start response")?;
    let response: infinitecode_server::SuccessResponse<infinitecode_server::TurnStartResult> =
        serde_json::from_value(response)?;
    response.result.turn_id().context("turn should start")
}

fn original_event(value: &serde_json::Value) -> Option<ServerEvent> {
    if value.get("method") != Some(&serde_json::json!("session/update")) {
        return None;
    }
    let notification = serde_json::from_value::<infinitecode_protocol::AcpSessionNotification>(
        value.get("params")?.clone(),
    )
    .ok()?;
    infinitecode_protocol::original_event_from_acp_notification(&notification).map(|(_, event)| event)
}

async fn wait_for_original_event(
    notifications_rx: &mut mpsc::Receiver<serde_json::Value>,
    method: &str,
) -> Result<()> {
    timeout(Duration::from_secs(5), async {
        while let Some(value) = notifications_rx.recv().await {
            if value["params"]["_meta"]["infinitecode/originalMethod"].as_str() == Some(method) {
                return Ok(());
            }
        }
        anyhow::bail!("notification channel closed before {method}")
    })
    .await
    .with_context(|| format!("timed out waiting for {method}"))?
}

fn rollout_path(
    data_root: &std::path::Path,
    session: &infinitecode_server::SessionMetadata,
) -> std::path::PathBuf {
    let timestamp = session
        .created_at
        .to_rfc3339_opts(SecondsFormat::Secs, true)
        .replace(':', "-");
    data_root
        .join("sessions")
        .join(format!("{:04}", session.created_at.year()))
        .join(format!("{:02}", session.created_at.month()))
        .join(format!("{:02}", session.created_at.day()))
        .join(format!("rollout-{timestamp}-{}.jsonl", session.session_id))
}

fn model_response(text: &str) -> ModelResponse {
    ModelResponse {
        id: "response".to_string(),
        content: vec![ResponseContent::Text(text.to_string())],
        stop_reason: Some(StopReason::EndTurn),
        usage: Usage::default(),
        metadata: ResponseMetadata::default(),
    }
}
