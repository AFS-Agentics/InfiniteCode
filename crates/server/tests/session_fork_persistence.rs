use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;

use anyhow::Context;
use anyhow::Result;
use async_trait::async_trait;
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

struct SingleReplyProvider;

#[async_trait]
impl ModelProviderSDK for SingleReplyProvider {
    async fn completion(&self, _request: ModelRequest) -> Result<ModelResponse> {
        Ok(model_response("Generated title"))
    }

    async fn completion_stream(
        &self,
        _request: ModelRequest,
    ) -> Result<Pin<Box<dyn Stream<Item = Result<StreamEvent>> + Send>>> {
        Ok(Box::pin(stream::iter(vec![
            Ok(StreamEvent::TextDelta {
                index: 0,
                text: "Fork persistence reply.".to_string(),
            }),
            Ok(StreamEvent::MessageDone {
                response: model_response("Fork persistence reply."),
            }),
        ])))
    }

    fn name(&self) -> &str {
        "single-reply-test-provider"
    }
}

#[tokio::test]
async fn session_fork_reports_and_replays_parent_session_id() -> Result<()> {
    let data_root = TempDir::new()?;
    let runtime = build_runtime(data_root.path())?;
    let (connection_id, mut notifications_rx) = initialize_connection(&runtime).await?;
    let source = start_session(&runtime, connection_id, data_root.path()).await?;
    start_and_complete_turn(
        &runtime,
        connection_id,
        &mut notifications_rx,
        source.session_id,
    )
    .await?;

    let fork_response = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 4,
                "method": "_infinitecode/session/fork",
                "params": {
                    "session_id": source.session_id,
                    "title": "Forked session",
                    "cwd": null,
                    "user_turn_index": 0
                }
            }),
        )
        .await
        .context("session/fork response")?;
    let fork = serde_json::from_value::<
        infinitecode_server::SuccessResponse<infinitecode_server::SessionForkResult>,
    >(fork_response)?
    .result;

    assert_eq!(fork.forked_from_session_id, source.session_id);
    assert_eq!(fork.session.parent_session_id, Some(source.session_id));
    assert_eq!(fork.session.title.as_deref(), Some("Forked session"));

    let rebuilt_runtime = build_runtime(data_root.path())?;
    rebuilt_runtime.load_persisted_sessions().await?;
    let (rebuilt_connection_id, _notifications_rx) =
        initialize_connection(&rebuilt_runtime).await?;
    let sessions = list_sessions(&rebuilt_runtime, rebuilt_connection_id).await?;
    let replayed_fork = sessions
        .iter()
        .find(|session| session.session_id == fork.session.session_id)
        .context("replayed fork session")?;
    assert_eq!(replayed_fork.parent_session_id, Some(source.session_id));

    Ok(())
}

#[tokio::test]
async fn failed_session_fork_metadata_persistence_does_not_register_fork() -> Result<()> {
    let data_root = TempDir::new()?;
    let runtime = build_runtime(data_root.path())?;
    let (connection_id, mut notifications_rx) = initialize_connection(&runtime).await?;
    let source = start_session(&runtime, connection_id, data_root.path()).await?;
    start_and_complete_turn(
        &runtime,
        connection_id,
        &mut notifications_rx,
        source.session_id,
    )
    .await?;
    let sessions_before = list_sessions(&runtime, connection_id).await?;
    assert_eq!(sessions_before.len(), 1);

    let sessions_root = data_root.path().join("sessions");
    std::fs::remove_dir_all(&sessions_root)?;
    std::fs::write(&sessions_root, "not a directory")?;

    let fork_response = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 4,
                "method": "_infinitecode/session/fork",
                "params": {
                    "session_id": source.session_id,
                    "title": "Unpersistable fork",
                    "cwd": null,
                    "user_turn_index": 0
                }
            }),
        )
        .await
        .context("failed session/fork response")?;

    assert_eq!(
        fork_response["error"]["code"],
        serde_json::json!("InternalError")
    );
    assert!(
        fork_response["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("failed to persist forked session metadata")
    );
    let sessions_after = list_sessions(&runtime, connection_id).await?;
    assert_eq!(sessions_after, sessions_before);

    Ok(())
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

fn build_runtime(data_root: &Path) -> Result<Arc<ServerRuntime>> {
    let provider: Arc<dyn ModelProviderSDK> = Arc::new(SingleReplyProvider);
    let db = Arc::new(infinitecode_server::db::Database::open(
        data_root.join("session_fork_persistence.db"),
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
                        "name": "session-fork-persistence-test",
                        "title": "session-fork-persistence-test",
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
                    "title": "Source session",
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

async fn start_and_complete_turn(
    runtime: &Arc<ServerRuntime>,
    connection_id: u64,
    notifications_rx: &mut mpsc::Receiver<serde_json::Value>,
    session_id: SessionId,
) -> Result<()> {
    let response = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 3,
                "method": "_infinitecode/turn/start",
                "params": {
                    "session_id": session_id,
                    "input": [{ "type": "text", "text": "seed fork history" }],
                    "model": null,
                    "model_binding_id": null,
                    "thinking": null,
                    "sandbox": null,
                    "approval_policy": null,
                    "cwd": null
                }
            }),
        )
        .await
        .context("turn/start response")?;
    let _: infinitecode_server::SuccessResponse<infinitecode_server::TurnStartResult> =
        serde_json::from_value(response)?;
    wait_for_turn_completed(notifications_rx).await
}

async fn wait_for_turn_completed(
    notifications_rx: &mut mpsc::Receiver<serde_json::Value>,
) -> Result<()> {
    timeout(Duration::from_secs(5), async {
        while let Some(value) = notifications_rx.recv().await {
            if value.get("method") == Some(&serde_json::json!("turn/completed"))
                || has_original_method(&value, "turn/completed")
            {
                return Ok(());
            }
        }
        anyhow::bail!("notification channel closed before turn/completed")
    })
    .await
    .context("timed out waiting for turn/completed")??;
    Ok(())
}

fn has_original_method(value: &serde_json::Value, method: &str) -> bool {
    value.get("method") == Some(&serde_json::json!("session/update"))
        && value["params"]["_meta"]["infinitecode/originalMethod"].as_str() == Some(method)
}

async fn list_sessions(
    runtime: &Arc<ServerRuntime>,
    connection_id: u64,
) -> Result<Vec<infinitecode_server::SessionMetadata>> {
    let response = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 5,
                "method": "session/list",
                "params": {}
            }),
        )
        .await
        .context("session/list response")?;
    let response: infinitecode_server::AcpSuccessResponse<infinitecode_server::AcpListSessionsResult> =
        serde_json::from_value(response)?;
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
