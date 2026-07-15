use std::net::TcpListener as StdTcpListener;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use anyhow::Result;
use async_trait::async_trait;
use infinitecode_core::AppConfigStore;
use infinitecode_core::FileSystemSkillCatalog;
use infinitecode_core::PresetModelCatalog;
use infinitecode_core::ProviderVendorCatalog;
use infinitecode_core::SkillsConfig;
use infinitecode_core::tools::ToolRegistry;
use infinitecode_protocol::InputItem;
use infinitecode_protocol::ModelRequest;
use infinitecode_protocol::ModelResponse;
use infinitecode_protocol::ServerEvent;
use infinitecode_protocol::StreamEvent;
use infinitecode_protocol::TurnId;
use infinitecode_protocol::TurnInterruptParams;
use infinitecode_protocol::TurnStartParams;
use infinitecode_provider::ModelProviderSDK;
use infinitecode_provider::SingleProviderRouter;
use infinitecode_server::ServerRuntime;
use infinitecode_server::ServerRuntimeDependencies;
use infinitecode_server::WebSocketServerClient;
use infinitecode_server::WebSocketServerClientConfig;
use futures::stream;
use tempfile::TempDir;
use tokio::time::timeout;

struct PendingProvider;

#[async_trait]
impl ModelProviderSDK for PendingProvider {
    async fn completion(&self, _request: ModelRequest) -> Result<ModelResponse> {
        anyhow::bail!("test provider does not support completion")
    }

    async fn completion_stream(
        &self,
        _request: ModelRequest,
    ) -> Result<std::pin::Pin<Box<dyn futures::Stream<Item = Result<StreamEvent>> + Send>>> {
        Ok(Box::pin(stream::pending()))
    }

    fn name(&self) -> &str {
        "pending-test-provider"
    }
}

#[tokio::test]
async fn websocket_server_client_drives_listener_session_and_notifications() -> Result<()> {
    let workspace = TempDir::new()?;
    let server_home = TempDir::new()?;
    let bind_address = free_loopback_address()?;
    let db = Arc::new(infinitecode_server::db::Database::open(
        server_home.path().join("websocket-client-e2e.db"),
    )?);
    let provider: Arc<dyn ModelProviderSDK> = Arc::new(PendingProvider);
    let runtime = ServerRuntime::new(
        server_home.path().to_path_buf(),
        ServerRuntimeDependencies::new(
            Arc::clone(&provider),
            Arc::new(SingleProviderRouter::new(provider)),
            Arc::new(ToolRegistry::new()),
            "test-model".to_string(),
            Arc::new(PresetModelCatalog::default()),
            Arc::new(ProviderVendorCatalog::default()),
            Box::new(FileSystemSkillCatalog::new(SkillsConfig::default())),
            infinitecode_core::AgentsMdConfig::default(),
            db,
            Arc::new(std::sync::Mutex::new(AppConfigStore::load(
                server_home.path().to_path_buf(),
                None,
            )?)),
        ),
    );
    let listen = vec![format!("ws://{bind_address}")];
    let listener_task =
        tokio::spawn(
            async move { infinitecode_server::run_listeners(Arc::clone(&runtime), &listen).await },
        );
    tokio::time::sleep(Duration::from_millis(200)).await;

    let mut client = WebSocketServerClient::connect(WebSocketServerClientConfig {
        endpoint: format!("ws://{bind_address}"),
        client_capabilities: Default::default(),
    })
    .await?;
    let initialize = client.initialize().await?;
    assert_eq!(initialize.server_name, "infinitecode-server");

    let session = client
        .session_start(infinitecode_protocol::SessionStartParams {
            cwd: workspace.path().to_path_buf(),
            additional_directories: Vec::new(),
            ephemeral: false,
            title: None,
            model: None,
            model_binding_id: None,
        })
        .await?
        .session;
    assert_eq!(session.cwd, workspace.path());

    client
        .turn_start(TurnStartParams {
            session_id: session.session_id,
            input: vec![InputItem::Text {
                text: "hello".to_string(),
            }],
            model: None,
            model_binding_id: None,
            reasoning_effort_selection: None,
            sandbox: None,
            approval_policy: None,
            cwd: None,
            collaboration_mode: Default::default(),
            execution_mode: Default::default(),
        })
        .await?;
    let turn_id = wait_for_turn_started(&mut client).await?;
    let interrupt = client
        .turn_interrupt(TurnInterruptParams {
            session_id: session.session_id,
            turn_id,
            reason: Some("websocket client e2e".to_string()),
        })
        .await?;
    assert_eq!(interrupt.turn_id, turn_id);

    client.shutdown().await?;
    listener_task.abort();
    let _ = listener_task.await;
    Ok(())
}

fn free_loopback_address() -> Result<String> {
    let listener = StdTcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(format!("127.0.0.1:{port}"))
}

async fn wait_for_turn_started(client: &mut WebSocketServerClient) -> Result<TurnId> {
    timeout(Duration::from_secs(5), async {
        loop {
            let Some(notification) = client.recv_notification().await else {
                anyhow::bail!("websocket client event stream closed");
            };
            if notification.method != "turn/started" {
                continue;
            }
            let event: ServerEvent =
                serde_json::from_value(notification.params).context("decode turn/started event")?;
            let ServerEvent::TurnStarted(payload) = event else {
                continue;
            };
            return Ok(payload.turn.turn_id);
        }
    })
    .await
    .context("timed out waiting for turn/started")?
}
