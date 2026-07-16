use std::time::Duration;

use anyhow::Context;
use anyhow::Result;
use chrono::Utc;
use futures::SinkExt;
use futures::StreamExt;
use infinitecode_client::WebSocketServerClient;
use infinitecode_client::WebSocketServerClientConfig;
use infinitecode_protocol::AcpAgentCapabilities;
use infinitecode_protocol::AcpClientCapabilities;
use infinitecode_protocol::AcpImplementation;
use infinitecode_protocol::AcpInitializeResult;
use infinitecode_protocol::AcpNewSessionResult;
use infinitecode_protocol::AcpSuccessResponse;
use infinitecode_protocol::InputItem;
use infinitecode_protocol::SessionId;
use infinitecode_protocol::SessionStartParams;
use infinitecode_protocol::TurnId;
use infinitecode_protocol::TurnStartParams;
use infinitecode_protocol::TurnStartResult;
use infinitecode_protocol::TurnStatus;
use pretty_assertions::assert_eq;
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio::time::timeout;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

#[tokio::test]
async fn websocket_client_initializes_sends_requests_and_receives_notifications() -> Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let endpoint = format!("ws://{}", listener.local_addr()?);
    let (requests_tx, mut requests_rx) = mpsc::unbounded_channel();
    let server_task = tokio::spawn(run_loopback_server(listener, requests_tx));

    let mut client = WebSocketServerClient::connect(WebSocketServerClientConfig {
        endpoint,
        client_capabilities: AcpClientCapabilities::default(),
    })
    .await?;

    let initialize = client.initialize().await?;
    assert_eq!(initialize.server_name, "infinitecode-server");
    assert_eq!(
        next_request_method(&mut requests_rx).await?,
        "initialize".to_string()
    );

    let cwd = std::env::temp_dir();
    let session = client
        .session_start(SessionStartParams {
            cwd: cwd.clone(),
            additional_directories: Vec::new(),
            ephemeral: false,
            title: Some("websocket".to_string()),
            model: None,
            model_binding_id: None,
        })
        .await?
        .session;
    assert_eq!(session.cwd, cwd);
    assert_eq!(
        next_request_method(&mut requests_rx).await?,
        "session/new".to_string()
    );

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
    assert_eq!(
        next_request_method(&mut requests_rx).await?,
        "_infinitecode/turn/start".to_string()
    );

    let notification = timeout(Duration::from_secs(2), client.recv_notification())
        .await?
        .context("notification")?;
    assert_eq!(notification.method, "_infinitecode/test/event");
    assert_eq!(notification.params, serde_json::json!({ "ok": true }));

    client.shutdown().await?;
    server_task.await??;
    Ok(())
}

async fn run_loopback_server(
    listener: TcpListener,
    requests_tx: mpsc::UnboundedSender<serde_json::Value>,
) -> Result<()> {
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_async(stream).await?;
    let session_id = SessionId::new();
    let turn_id = TurnId::new();

    while let Some(frame) = socket.next().await {
        let Message::Text(text) = frame? else {
            continue;
        };
        let request: serde_json::Value = serde_json::from_str(text.as_str())?;
        let _ = requests_tx.send(request.clone());
        let id = request
            .get("id")
            .cloned()
            .context("request id from client")?;
        match request
            .get("method")
            .and_then(serde_json::Value::as_str)
            .context("request method from client")?
        {
            "initialize" => {
                send_success(
                    &mut socket,
                    id,
                    AcpInitializeResult {
                        protocol_version: 1,
                        agent_capabilities: AcpAgentCapabilities::default(),
                        auth_methods: Vec::new(),
                        agent_info: Some(AcpImplementation::new("infinitecode-server", "test")),
                        meta: None,
                    },
                )
                .await?;
            }
            "session/new" => {
                send_success(
                    &mut socket,
                    id,
                    AcpNewSessionResult {
                        session_id,
                        modes: None,
                        config_options: None,
                        meta: None,
                    },
                )
                .await?;
            }
            "_infinitecode/turn/start" => {
                send_success(
                    &mut socket,
                    id,
                    TurnStartResult::Started {
                        turn_id,
                        status: TurnStatus::Running,
                        accepted_at: Utc::now(),
                    },
                )
                .await?;
                socket
                    .send(Message::Text(
                        serde_json::json!({
                            "method": "_infinitecode/test/event",
                            "params": { "ok": true }
                        })
                        .to_string()
                        .into(),
                    ))
                    .await?;
            }
            other => anyhow::bail!("unexpected client request: {other}"),
        }
    }
    Ok(())
}

async fn send_success<T: serde::Serialize>(
    socket: &mut tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    id: serde_json::Value,
    result: T,
) -> Result<()> {
    socket
        .send(Message::Text(
            serde_json::to_string(&AcpSuccessResponse::new(id, result))?.into(),
        ))
        .await?;
    Ok(())
}

async fn next_request_method(
    requests_rx: &mut mpsc::UnboundedReceiver<serde_json::Value>,
) -> Result<String> {
    let request = timeout(Duration::from_secs(2), requests_rx.recv())
        .await?
        .context("captured request")?;
    request
        .get("method")
        .and_then(serde_json::Value::as_str)
        .map(ToString::to_string)
        .context("captured request method")
}
