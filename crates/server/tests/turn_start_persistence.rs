use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;

use anyhow::Context;
use anyhow::Result;
use async_trait::async_trait;
use chrono::Datelike;
use chrono::SecondsFormat;
use futures::Stream;
use futures::stream;
use infinitecode_core::AppConfigStore;
use infinitecode_core::BundledSkillsConfig;
use infinitecode_core::FileSystemSkillCatalog;
use infinitecode_core::PresetModelCatalog;
use infinitecode_core::ProviderVendorCatalog;
use infinitecode_core::SkillsConfig;
use infinitecode_core::tools::ToolRegistry;
use infinitecode_protocol::Model;
use infinitecode_protocol::ModelRequest;
use infinitecode_protocol::ModelResponse;
use infinitecode_protocol::ResponseContent;
use infinitecode_protocol::ResponseMetadata;
use infinitecode_protocol::SessionId;
use infinitecode_protocol::StopReason;
use infinitecode_protocol::StreamEvent;
use infinitecode_protocol::TurnId;
use infinitecode_protocol::Usage;
use infinitecode_provider::ModelProviderSDK;
use infinitecode_provider::ProviderRoute;
use infinitecode_provider::ProviderRouter;
use infinitecode_provider::error::ProviderError;
use pretty_assertions::assert_eq;
use tempfile::TempDir;
use tokio::sync::mpsc;
use tokio::time::Duration;
use tokio::time::timeout;

use infinitecode_server::ClientTransportKind;
use infinitecode_server::ServerRuntime;
use infinitecode_server::ServerRuntimeDependencies;

struct BlockingRouter {
    stream_calls: mpsc::UnboundedSender<ModelRequest>,
}

#[async_trait]
impl ProviderRouter for BlockingRouter {
    async fn stream(
        &self,
        _route: ProviderRoute,
        request: ModelRequest,
    ) -> Result<Pin<Box<dyn Stream<Item = Result<StreamEvent>> + Send>>, ProviderError> {
        let _ = self.stream_calls.send(request);
        Ok(Box::pin(stream::pending()))
    }

    async fn complete(
        &self,
        _route: ProviderRoute,
        _request: ModelRequest,
    ) -> Result<ModelResponse, ProviderError> {
        Ok(model_response("Generated title"))
    }

    fn name(&self) -> &str {
        "blocking-router"
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
    ) -> Result<Pin<Box<dyn Stream<Item = Result<StreamEvent>> + Send>>> {
        anyhow::bail!("unused provider should not receive streaming requests")
    }

    fn name(&self) -> &str {
        "unused-provider"
    }
}

#[tokio::test]
async fn turn_start_append_failure_does_not_launch_model_turn_or_leave_session_active() -> Result<()>
{
    let data_root = TempDir::new()?;
    let (stream_calls_tx, mut stream_calls_rx) = mpsc::unbounded_channel();
    let runtime = build_runtime(data_root.path(), stream_calls_tx)?;
    let (connection_id, _notifications_rx) = initialize_connection(&runtime).await?;
    let session = start_session(&runtime, connection_id, data_root.path()).await?;
    let rollout_path = rollout_path_for_session(data_root.path(), &session);

    std::fs::remove_file(&rollout_path)?;
    std::fs::create_dir(&rollout_path)?;

    let failed_start = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 3,
                "method": "_infinitecode/turn/start",
                "params": turn_start_params(session.session_id)
            }),
        )
        .await
        .context("failed turn/start response")?;
    assert_eq!(
        failed_start["error"]["code"],
        serde_json::json!("InternalError")
    );
    assert!(
        failed_start["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("failed to persist turn start")
    );
    assert!(
        timeout(Duration::from_millis(150), stream_calls_rx.recv())
            .await
            .is_err(),
        "failed turn/start unexpectedly invoked provider streaming"
    );

    std::fs::remove_dir(&rollout_path)?;
    let successful_start = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 4,
                "method": "_infinitecode/turn/start",
                "params": turn_start_params(session.session_id)
            }),
        )
        .await
        .context("successful turn/start response")?;
    let response: infinitecode_server::SuccessResponse<infinitecode_server::TurnStartResult> =
        serde_json::from_value(successful_start)?;
    assert_eq!(
        response.result.status(),
        infinitecode_protocol::TurnStatus::Running
    );
    stream_calls_rx
        .recv()
        .await
        .context("provider stream call after successful turn/start")?;
    interrupt_turn(
        &runtime,
        connection_id,
        session.session_id,
        response.result.turn_id().expect("turn should have started"),
    )
    .await?;

    Ok(())
}

#[tokio::test]
async fn message_edit_previous_accepts_skip_restore_and_replaces_prompt_branch() -> Result<()> {
    let data_root = TempDir::new()?;
    let (stream_calls_tx, mut stream_calls_rx) = mpsc::unbounded_channel();
    let runtime = build_runtime(data_root.path(), stream_calls_tx)?;
    let (connection_id, _notifications_rx) = initialize_connection(&runtime).await?;
    let session = start_session(&runtime, connection_id, data_root.path()).await?;

    let original_start = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 6,
                "method": "_infinitecode/turn/start",
                "params": turn_start_params(session.session_id)
            }),
        )
        .await
        .context("original turn/start response")?;
    let original_start: infinitecode_server::SuccessResponse<infinitecode_server::TurnStartResult> =
        serde_json::from_value(original_start)?;
    let original_request = stream_calls_rx
        .recv()
        .await
        .context("original provider request")?;
    assert!(
        request_messages_json(&original_request)?.contains("hello"),
        "original request should contain submitted prompt"
    );
    interrupt_turn(
        &runtime,
        connection_id,
        session.session_id,
        original_start
            .result
            .turn_id()
            .expect("original turn should have started"),
    )
    .await?;

    let edit_response = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 7,
                "method": "_infinitecode/message/editPrevious",
                "params": {
                    "session_id": session.session_id,
                    "expected_target_message_id": null,
                    "edited_content_parts": [{ "type": "text", "text": "edited message" }],
                    "edited_mentions": [],
                    "workspace_restore_policy": "skip"
                }
            }),
        )
        .await
        .context("message/editPrevious response")?;
    let edit_response: infinitecode_server::SuccessResponse<
        infinitecode_server::MessageEditPreviousResult,
    > = serde_json::from_value(edit_response)?;
    let replacement_turn_id = edit_response
        .result
        .replacement_turn_id
        .context("replacement turn id")?;
    let replacement_request = stream_calls_rx
        .recv()
        .await
        .context("replacement provider request")?;
    let replacement_messages = request_messages_json(&replacement_request)?;
    assert!(
        replacement_messages.contains("edited message"),
        "replacement request should contain edited prompt: {replacement_messages}"
    );
    assert!(
        !replacement_messages.contains("hello"),
        "replacement request should not include superseded prompt: {replacement_messages}"
    );

    let rollout = std::fs::read_to_string(rollout_path_for_session(data_root.path(), &session))?;
    assert!(rollout.contains("MessageEditRecorded"));
    assert!(rollout.contains("TurnSuperseded"));
    assert!(rollout.contains(&edit_response.result.replacement_message_id.to_string()));
    assert!(rollout.contains(&replacement_turn_id.to_string()));

    interrupt_turn(
        &runtime,
        connection_id,
        session.session_id,
        replacement_turn_id,
    )
    .await?;

    Ok(())
}

/// Trace: L2-DES-APP-003, L1-REQ-CONV-005
/// Verifies: omitted workspace_restore_policy uses default safe restore and emits restore lifecycle records/events.
#[tokio::test]
async fn message_edit_previous_default_safe_restore_records_and_broadcasts() -> Result<()> {
    let data_root = TempDir::new()?;
    let (stream_calls_tx, mut stream_calls_rx) = mpsc::unbounded_channel();
    let runtime = build_runtime(data_root.path(), stream_calls_tx)?;
    let (connection_id, mut notifications_rx) = initialize_connection(&runtime).await?;
    let session = start_session(&runtime, connection_id, data_root.path()).await?;

    let original_start = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 6,
                "method": "_infinitecode/turn/start",
                "params": turn_start_params(session.session_id)
            }),
        )
        .await
        .context("original turn/start response")?;
    let original_start: infinitecode_server::SuccessResponse<infinitecode_server::TurnStartResult> =
        serde_json::from_value(original_start)?;
    stream_calls_rx
        .recv()
        .await
        .context("original provider request")?;
    interrupt_turn(
        &runtime,
        connection_id,
        session.session_id,
        original_start
            .result
            .turn_id()
            .expect("original turn should have started"),
    )
    .await?;
    drain_notifications(&mut notifications_rx).await;

    let edit_response = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 7,
                "method": "_infinitecode/message/editPrevious",
                "params": {
                    "session_id": session.session_id,
                    "expected_target_message_id": null,
                    "edited_content_parts": [{ "type": "text", "text": "edited message" }],
                    "edited_mentions": []
                }
            }),
        )
        .await
        .context("message/editPrevious response")?;
    let edit_response: infinitecode_server::SuccessResponse<
        infinitecode_server::MessageEditPreviousResult,
    > = serde_json::from_value(edit_response)?;
    let replacement_turn_id = edit_response
        .result
        .replacement_turn_id
        .context("replacement turn id")?;
    let replacement_request = stream_calls_rx
        .recv()
        .await
        .context("replacement provider request")?;
    let replacement_messages = request_messages_json(&replacement_request)?;
    assert!(
        replacement_messages.contains("edited message"),
        "replacement request should contain edited prompt: {replacement_messages}"
    );
    assert!(
        !replacement_messages.contains("hello"),
        "replacement request should not include superseded prompt: {replacement_messages}"
    );

    let rollout = std::fs::read_to_string(rollout_path_for_session(data_root.path(), &session))?;
    assert!(rollout.contains("TurnWorkspaceRestoreStarted"));
    assert!(rollout.contains("TurnWorkspaceRestoreCompleted"));
    assert!(rollout.contains("\"policy\":\"safe\""));

    let methods = collect_notification_methods(&mut notifications_rx).await;
    assert!(
        methods
            .iter()
            .any(|method| method == "workspace_restore_started"),
        "expected workspace_restore_started notification in {methods:?}"
    );
    assert!(
        methods
            .iter()
            .any(|method| method == "workspace_restore_completed"),
        "expected workspace_restore_completed notification in {methods:?}"
    );

    interrupt_turn(
        &runtime,
        connection_id,
        session.session_id,
        replacement_turn_id,
    )
    .await?;

    Ok(())
}

#[tokio::test]
async fn message_edit_previous_dispatches_to_edit_handler() -> Result<()> {
    let data_root = TempDir::new()?;
    let (stream_calls_tx, _stream_calls_rx) = mpsc::unbounded_channel();
    let runtime = build_runtime(data_root.path(), stream_calls_tx)?;
    let (connection_id, _notifications_rx) = initialize_connection(&runtime).await?;
    let session = start_session(&runtime, connection_id, data_root.path()).await?;

    let edit_response = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 6,
                "method": "_infinitecode/message/editPrevious",
                "params": {
                    "session_id": session.session_id,
                    "expected_target_message_id": null,
                    "edited_content_parts": [{ "type": "text", "text": "edited message" }],
                    "edited_mentions": []
                }
            }),
        )
        .await
        .context("message/editPrevious response")?;

    assert_eq!(
        edit_response["error"]["code"],
        serde_json::json!("OlderMessageRequiresFork")
    );
    assert!(
        !edit_response["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("unknown method")
    );

    Ok(())
}

#[tokio::test]
async fn message_edit_previous_rejects_malformed_edited_content_parts() -> Result<()> {
    let data_root = TempDir::new()?;
    let (stream_calls_tx, _stream_calls_rx) = mpsc::unbounded_channel();
    let runtime = build_runtime(data_root.path(), stream_calls_tx)?;
    let (connection_id, _notifications_rx) = initialize_connection(&runtime).await?;
    let session = start_session(&runtime, connection_id, data_root.path()).await?;

    let edit_response = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 6,
                "method": "_infinitecode/message/editPrevious",
                "params": {
                    "session_id": session.session_id,
                    "expected_target_message_id": null,
                    "edited_content_parts": [{ "type": "not_a_supported_part" }],
                    "edited_mentions": []
                }
            }),
        )
        .await
        .context("message/editPrevious response")?;

    assert_eq!(
        edit_response["error"]["code"],
        serde_json::json!("InvalidContentParts")
    );
    assert!(
        edit_response["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("invalid message/editPrevious edited content")
    );

    Ok(())
}

async fn drain_notifications(notifications_rx: &mut mpsc::Receiver<serde_json::Value>) {
    while timeout(Duration::from_millis(10), notifications_rx.recv())
        .await
        .is_ok()
    {}
}

async fn collect_notification_methods(
    notifications_rx: &mut mpsc::Receiver<serde_json::Value>,
) -> Vec<String> {
    let mut methods = Vec::new();
    while let Ok(Some(notification)) =
        timeout(Duration::from_millis(10), notifications_rx.recv()).await
    {
        if let Some(method) = notification["params"]["_meta"]["infinitecode/originalMethod"]
            .as_str()
            .or_else(|| {
                notification
                    .get("method")
                    .and_then(serde_json::Value::as_str)
            })
        {
            methods.push(method.to_string());
        }
    }
    methods
}

fn model_response(text: &str) -> ModelResponse {
    ModelResponse {
        id: "response-1".to_string(),
        content: vec![ResponseContent::Text(text.to_string())],
        stop_reason: Some(StopReason::EndTurn),
        usage: Usage::default(),
        metadata: ResponseMetadata::default(),
    }
}

fn build_runtime(
    data_root: &Path,
    stream_calls: mpsc::UnboundedSender<ModelRequest>,
) -> Result<Arc<ServerRuntime>> {
    let provider: Arc<dyn ModelProviderSDK> = Arc::new(UnusedProvider);
    let router: Arc<dyn ProviderRouter> = Arc::new(BlockingRouter { stream_calls });
    let db = Arc::new(infinitecode_server::db::Database::open(
        data_root.join("turn_start_persistence.db"),
    )?);
    Ok(ServerRuntime::new(
        data_root.to_path_buf(),
        ServerRuntimeDependencies::new(
            provider,
            router,
            Arc::new(ToolRegistry::new()),
            "test-model".to_string(),
            Arc::new(PresetModelCatalog::new(vec![Model {
                slug: "test-model".to_string(),
                display_name: "Test Model".to_string(),
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

fn request_messages_json(request: &ModelRequest) -> Result<String> {
    serde_json::to_string(&request.messages).context("serialize request messages")
}

async fn initialize_connection(
    runtime: &Arc<ServerRuntime>,
) -> Result<(u64, mpsc::Receiver<serde_json::Value>)> {
    let (notifications_tx, notifications_rx) = infinitecode_server::test_outbound_channel(128);
    let connection_id = runtime
        .register_connection(ClientTransportKind::Stdio, notifications_tx)
        .await;
    let initialize_response = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": 1,
                    "clientCapabilities": {},
                    "clientInfo": {
                        "name": "turn-start-persistence-test",
                        "title": "turn-start-persistence-test",
                        "version": "1.0.0"
                    }
                }
            }),
        )
        .await
        .context("initialize response")?;
    let response: serde_json::Value = initialize_response;
    assert_eq!(
        response["result"]["agentInfo"]["name"],
        serde_json::json!("infinitecode-server")
    );
    Ok((connection_id, notifications_rx))
}

async fn start_session(
    runtime: &Arc<ServerRuntime>,
    connection_id: u64,
    cwd: &Path,
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
                    "model": "test-model",
                    "model_binding_id": null
                }
            }),
        )
        .await
        .context("session/start response")?;
    let response: infinitecode_server::SuccessResponse<infinitecode_server::SessionStartResult> =
        serde_json::from_value(response)?;
    Ok(response.result.session)
}

async fn interrupt_turn(
    runtime: &Arc<ServerRuntime>,
    connection_id: u64,
    session_id: SessionId,
    turn_id: TurnId,
) -> Result<()> {
    let response = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 5,
                "method": "_infinitecode/turn/interrupt",
                "params": {
                    "session_id": session_id,
                    "turn_id": turn_id,
                    "reason": "test cleanup"
                }
            }),
        )
        .await
        .context("turn/interrupt response")?;
    let response: infinitecode_server::SuccessResponse<infinitecode_server::TurnInterruptResult> =
        serde_json::from_value(response)?;
    assert_eq!(
        response.result.status,
        infinitecode_protocol::TurnStatus::Interrupted
    );
    Ok(())
}

fn turn_start_params(session_id: SessionId) -> serde_json::Value {
    serde_json::json!({
        "session_id": session_id,
        "input": [{ "type": "text", "text": "hello" }],
        "model": null,
        "model_binding_id": null,
        "thinking": null,
        "sandbox": null,
        "approval_policy": null,
        "cwd": null
    })
}

fn rollout_path_for_session(
    data_root: &Path,
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
