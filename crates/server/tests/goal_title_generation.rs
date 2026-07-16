use std::pin::Pin;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::AtomicUsize;
use std::sync::atomic::Ordering;
use std::time::Duration;

use anyhow::Context;
use anyhow::Result;
use async_trait::async_trait;
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
use infinitecode_protocol::Usage;
use infinitecode_provider::ModelProviderSDK;
use infinitecode_provider::SingleProviderRouter;
use infinitecode_server::ClientTransportKind;
use infinitecode_server::ServerRuntime;
use infinitecode_server::ServerRuntimeDependencies;
use pretty_assertions::assert_eq;
use tempfile::TempDir;
use tokio::sync::mpsc;
use tokio::time::timeout;

#[derive(Default)]
struct GoalTitleProvider {
    title_requests: Mutex<Vec<ModelRequest>>,
    stream_requests: AtomicUsize,
}

#[async_trait]
impl ModelProviderSDK for GoalTitleProvider {
    async fn completion(&self, request: ModelRequest) -> Result<ModelResponse> {
        self.title_requests
            .lock()
            .expect("lock title requests")
            .push(request);
        Ok(ModelResponse {
            id: "goal-title".to_string(),
            content: vec![ResponseContent::Text("Generated goal title".to_string())],
            stop_reason: Some(StopReason::EndTurn),
            usage: Usage::default(),
            metadata: ResponseMetadata::default(),
        })
    }

    async fn completion_stream(
        &self,
        _request: ModelRequest,
    ) -> Result<Pin<Box<dyn Stream<Item = Result<StreamEvent>> + Send>>> {
        self.stream_requests.fetch_add(1, Ordering::SeqCst);
        Ok(Box::pin(stream::pending()))
    }

    fn name(&self) -> &str {
        "goal-title-provider"
    }
}

#[tokio::test]
async fn goal_set_objective_generates_session_title_for_new_session() -> Result<()> {
    let data_root = TempDir::new()?;
    let provider = Arc::new(GoalTitleProvider::default());
    let runtime = build_runtime(data_root.path(), provider.clone())?;
    let (connection_id, mut notifications_rx) = initialize_connection(&runtime).await?;
    let session_id = start_untitled_session(&runtime, connection_id, data_root.path()).await?;

    runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 3,
                "method": "_infinitecode/goal/set",
                "params": {
                    "sessionId": session_id,
                    "objective": "investigate goal title generation",
                    "status": "active"
                }
            }),
        )
        .await
        .context("goal/set response")?;

    wait_for_title_update(&mut notifications_rx, "Generated goal title").await?;

    let list_response = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 4,
                "method": "session/list",
                "params": {}
            }),
        )
        .await
        .context("session/list response")?;
    let sessions = decode_acp_session_list_response(list_response)?;
    assert_eq!(sessions[0].title.as_deref(), Some("Generated goal title"));

    let title_requests = provider.title_requests.lock().expect("lock title requests");
    assert_eq!(title_requests.len(), 1);
    assert!(
        title_request_contains(&title_requests[0], "investigate goal title generation"),
        "title request should use the goal objective"
    );
    assert!(
        !title_request_contains(&title_requests[0], "/goal"),
        "title request should not include the slash-command wrapper"
    );
    Ok(())
}

#[tokio::test]
async fn goal_create_rejects_unknown_session() -> Result<()> {
    let data_root = TempDir::new()?;
    let provider = Arc::new(GoalTitleProvider::default());
    let runtime = build_runtime(data_root.path(), provider.clone())?;
    let (connection_id, _notifications_rx) = initialize_connection(&runtime).await?;
    let unknown_session_id = SessionId::new();

    let response = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 5,
                "method": "_infinitecode/goal/create",
                "params": {
                    "sessionId": unknown_session_id,
                    "objective": "unknown session goal",
                    "replaceExisting": false
                }
            }),
        )
        .await
        .context("goal/create response")?;

    assert_session_not_found(response)?;
    assert_eq!(
        provider
            .title_requests
            .lock()
            .expect("lock title requests")
            .len(),
        0
    );
    assert_eq!(provider.stream_requests.load(Ordering::SeqCst), 0);
    assert_goal_status_empty(&runtime, connection_id, unknown_session_id).await?;
    Ok(())
}

#[tokio::test]
async fn goal_set_rejects_unknown_session() -> Result<()> {
    let data_root = TempDir::new()?;
    let provider = Arc::new(GoalTitleProvider::default());
    let runtime = build_runtime(data_root.path(), provider.clone())?;
    let (connection_id, _notifications_rx) = initialize_connection(&runtime).await?;
    let unknown_session_id = SessionId::new();

    let response = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 6,
                "method": "_infinitecode/goal/set",
                "params": {
                    "sessionId": unknown_session_id,
                    "objective": "unknown session goal",
                    "status": "active"
                }
            }),
        )
        .await
        .context("goal/set response")?;

    assert_session_not_found(response)?;
    assert_eq!(
        provider
            .title_requests
            .lock()
            .expect("lock title requests")
            .len(),
        0
    );
    assert_eq!(provider.stream_requests.load(Ordering::SeqCst), 0);
    assert_goal_status_empty(&runtime, connection_id, unknown_session_id).await?;
    Ok(())
}

fn build_runtime(
    data_root: &std::path::Path,
    provider: Arc<GoalTitleProvider>,
) -> Result<Arc<ServerRuntime>> {
    let provider: Arc<dyn ModelProviderSDK> = provider;
    let db = Arc::new(infinitecode_server::db::Database::open(
        data_root.join("goal_title.db"),
    )?);
    Ok(ServerRuntime::new(
        data_root.to_path_buf(),
        ServerRuntimeDependencies::new(
            Arc::clone(&provider),
            Arc::new(SingleProviderRouter::new(provider)),
            Arc::new(ToolRegistry::new()),
            "test-model".to_string(),
            Arc::new(PresetModelCatalog::new(vec![Model {
                slug: "test-model".to_string(),
                display_name: "test-model".to_string(),
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
                None,
            )?)),
        ),
    ))
}

async fn initialize_connection(
    runtime: &Arc<ServerRuntime>,
) -> Result<(u64, mpsc::Receiver<serde_json::Value>)> {
    let (notifications_tx, notifications_rx) = infinitecode_server::test_outbound_channel(1024);
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
                        "name": "goal-title-test",
                        "title": "goal-title-test",
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

async fn start_untitled_session(
    runtime: &Arc<ServerRuntime>,
    connection_id: u64,
    cwd: &std::path::Path,
) -> Result<SessionId> {
    let start_response = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 2,
                "method": "session/start",
                "params": {
                    "cwd": cwd,
                    "ephemeral": false,
                    "title": null,
                    "model": "test-model"
                }
            }),
        )
        .await
        .context("session/start response")?;
    let response: infinitecode_server::SuccessResponse<infinitecode_server::SessionStartResult> =
        serde_json::from_value(start_response)?;
    Ok(response.result.session.session_id)
}

async fn wait_for_title_update(
    notifications_rx: &mut mpsc::Receiver<serde_json::Value>,
    expected_title: &str,
) -> Result<()> {
    timeout(Duration::from_secs(/*secs*/ 5), async {
        while let Some(value) = notifications_rx.recv().await {
            let is_legacy_title_update = value.get("method")
                == Some(&serde_json::json!("session/title/updated"))
                && value["params"]["session"]["title"] == serde_json::json!(expected_title);
            let is_acp_title_update = value.get("method")
                == Some(&serde_json::json!("session/update"))
                && value["params"]["update"]["sessionUpdate"]
                    == serde_json::json!("session_info_update")
                && value["params"]["update"]["title"] == serde_json::json!(expected_title);
            if is_legacy_title_update || is_acp_title_update {
                return Ok(());
            }
        }
        anyhow::bail!("notification channel closed before expected session/title/updated")
    })
    .await
    .context("timed out waiting for session/title/updated")??;
    Ok(())
}

fn title_request_contains(request: &ModelRequest, needle: &str) -> bool {
    request.messages.iter().any(|message| {
        message.content.iter().any(|content| match content {
            infinitecode_protocol::RequestContent::Text { text }
            | infinitecode_protocol::RequestContent::Reasoning { text } => text.contains(needle),
            infinitecode_protocol::RequestContent::ProviderReasoning { .. }
            | infinitecode_protocol::RequestContent::ToolUse { .. }
            | infinitecode_protocol::RequestContent::HostedToolUse { .. }
            | infinitecode_protocol::RequestContent::ToolResult { .. } => false,
        })
    })
}

fn decode_acp_session_list_response(
    response: serde_json::Value,
) -> Result<Vec<infinitecode_server::SessionMetadata>> {
    let response_value = response.clone();
    let response: infinitecode_server::AcpSuccessResponse<
        infinitecode_server::AcpListSessionsResult,
    > = serde_json::from_value(response)
        .with_context(|| format!("decode ACP session/list response: {response_value}"))?;
    response
        .result
        .sessions
        .into_iter()
        .map(|session| {
            session
                .meta
                .as_ref()
                .and_then(|meta| meta.get(infinitecode_server::INFINITECODE_SESSION_META))
                .cloned()
                .map(serde_json::from_value)
                .transpose()
                .context("decode InfiniteCode session metadata from ACP session/list response")?
                .with_context(|| {
                    format!(
                        "ACP session/list response missing InfiniteCode session metadata for {}",
                        session.session_id
                    )
                })
        })
        .collect()
}

fn assert_session_not_found(response: serde_json::Value) -> Result<()> {
    let response: infinitecode_server::ErrorResponse = serde_json::from_value(response)?;
    assert_eq!(
        response.error.code,
        infinitecode_server::ProtocolErrorCode::SessionNotFound
    );
    Ok(())
}

async fn assert_goal_status_empty(
    runtime: &Arc<ServerRuntime>,
    connection_id: u64,
    session_id: SessionId,
) -> Result<()> {
    let response = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 7,
                "method": "_infinitecode/goal/status",
                "params": {
                    "sessionId": session_id
                }
            }),
        )
        .await
        .context("goal/status response")?;
    let response: infinitecode_server::SuccessResponse<infinitecode_protocol::GoalStatusResult> =
        serde_json::from_value(response)?;
    assert_eq!(response.result.goal, None);
    Ok(())
}
