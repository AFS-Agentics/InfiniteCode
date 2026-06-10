use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::Ordering;
use std::time::Duration;

use anyhow::Context;
use anyhow::Result;
use pretty_assertions::assert_eq;
use tempfile::TempDir;
use tokio::sync::Notify;

#[path = "support/goal_continuation.rs"]
mod support;

use support::CapturingProvider;
use support::PendingProvider;
use support::QueuedPriorityProvider;
use support::build_runtime;
use support::collect_until_turn_completed;
use support::initialize_connection;
use support::is_user_message_item;
use support::pause_goal_and_interrupt_turn;
use support::request_contains_text;
use support::request_last_message_contains_text;
use support::start_session;
use support::wait_for_captured_request_count;
use support::wait_for_notification;
use support::wait_for_request_count;

#[tokio::test]
async fn goal_set_starts_hidden_continuation_turn() -> Result<()> {
    // Trace: L2-DES-GOAL-001
    let data_root = TempDir::new()?;
    let provider = Arc::new(CapturingProvider::default());
    let runtime = build_runtime(data_root.path(), provider.clone())?;
    let (connection_id, mut notifications_rx) = initialize_connection(&runtime).await?;
    let session_id = start_session(&runtime, connection_id, data_root.path()).await?;

    let _ = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 19,
                "method": "turn/start",
                "params": {
                    "session_id": session_id,
                    "input": [{ "type": "text", "text": "previous visible prompt" }],
                    "model": null,
                    "sandbox": null,
                    "approval_policy": null,
                    "cwd": null
                }
            }),
        )
        .await
        .context("prior turn/start response")?;
    collect_until_turn_completed(&mut notifications_rx).await?;

    let goal_response = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 20,
                "method": "goal/set",
                "params": {
                    "sessionId": session_id,
                    "objective": "write a benchmark note",
                    "status": "active"
                }
            }),
        )
        .await
        .context("goal/set response")?;
    let response: devo_server::SuccessResponse<devo_protocol::GoalSetResult> =
        serde_json::from_value(goal_response)?;
    assert_eq!(response.result.goal.objective, "write a benchmark note");

    runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 21,
                "method": "goal/set",
                "params": {
                    "sessionId": session_id,
                    "status": "paused"
                }
            }),
        )
        .await
        .context("goal pause response")?;

    let notifications = collect_until_turn_completed(&mut notifications_rx).await?;
    assert!(
        notifications
            .iter()
            .any(|value| value.get("method") == Some(&serde_json::json!("turn/started"))),
        "goal continuation should start a turn"
    );
    assert!(
        !notifications.iter().any(is_user_message_item),
        "goal continuation must not emit a synthetic user message item"
    );

    let requests = provider.requests.lock().expect("lock requests");
    assert_eq!(requests.len(), 2);
    assert!(
        request_contains_text(&requests[1], "Completion audit:")
            && request_contains_text(&requests[1], "write a benchmark note"),
        "goal continuation request should include hidden goal context"
    );
    assert!(
        request_last_message_contains_text(&requests[1], "Completion audit:"),
        "autonomous goal context should be the latest request message"
    );

    Ok(())
}

#[tokio::test]
async fn goal_set_does_not_start_continuation_while_turn_is_active() -> Result<()> {
    let data_root = TempDir::new()?;
    let provider = Arc::new(PendingProvider::default());
    let runtime = build_runtime(data_root.path(), provider.clone())?;
    let (connection_id, mut notifications_rx) = initialize_connection(&runtime).await?;
    let session_id = start_session(&runtime, connection_id, data_root.path()).await?;

    let _ = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 30,
                "method": "turn/start",
                "params": {
                    "session_id": session_id,
                    "input": [{ "type": "text", "text": "keep this turn active" }],
                    "model": null,
                    "sandbox": null,
                    "approval_policy": null,
                    "cwd": null
                }
            }),
        )
        .await
        .context("turn/start response")?;
    let turn_started = wait_for_notification(&mut notifications_rx, "turn/started").await?;
    wait_for_request_count(&provider.requests, /*expected*/ 1).await?;

    let _ = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 31,
                "method": "goal/set",
                "params": {
                    "sessionId": session_id,
                    "objective": "continue after this turn",
                    "status": "active"
                }
            }),
        )
        .await
        .context("goal/set response")?;
    tokio::time::sleep(Duration::from_millis(/*millis*/ 50)).await;
    assert_eq!(provider.requests.load(Ordering::SeqCst), 1);

    let _ = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 32,
                "method": "goal/set",
                "params": {
                    "sessionId": session_id,
                    "status": "paused"
                }
            }),
        )
        .await
        .context("goal pause response")?;
    let turn_id = turn_started["params"]["turn"]["turn_id"]
        .as_str()
        .context("turn id")?;
    let _ = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 33,
                "method": "turn/interrupt",
                "params": {
                    "session_id": session_id,
                    "turn_id": turn_id,
                    "reason": "test cleanup"
                }
            }),
        )
        .await
        .context("turn/interrupt response")?;

    Ok(())
}

#[tokio::test]
async fn goal_create_starts_hidden_continuation_turn() -> Result<()> {
    let data_root = TempDir::new()?;
    let provider = Arc::new(PendingProvider::default());
    let runtime = build_runtime(data_root.path(), provider.clone())?;
    let (connection_id, mut notifications_rx) = initialize_connection(&runtime).await?;
    let session_id = start_session(&runtime, connection_id, data_root.path()).await?;

    let _ = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 34,
                "method": "goal/create",
                "params": {
                    "sessionId": session_id,
                    "objective": "created goal should run",
                    "replaceExisting": false
                }
            }),
        )
        .await
        .context("goal/create response")?;
    let turn_started = wait_for_notification(&mut notifications_rx, "turn/started").await?;
    wait_for_request_count(&provider.requests, /*expected*/ 1).await?;

    let turn_id: devo_protocol::TurnId =
        serde_json::from_value(turn_started["params"]["turn"]["turn_id"].clone())?;
    pause_goal_and_interrupt_turn(&runtime, connection_id, session_id, turn_id).await?;
    Ok(())
}

#[tokio::test]
async fn goal_resume_starts_hidden_continuation_turn() -> Result<()> {
    let data_root = TempDir::new()?;
    let provider = Arc::new(PendingProvider::default());
    let runtime = build_runtime(data_root.path(), provider.clone())?;
    let (connection_id, mut notifications_rx) = initialize_connection(&runtime).await?;
    let session_id = start_session(&runtime, connection_id, data_root.path()).await?;

    let _ = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 35,
                "method": "goal/set",
                "params": {
                    "sessionId": session_id,
                    "objective": "paused goal should resume",
                    "status": "paused"
                }
            }),
        )
        .await
        .context("paused goal/set response")?;
    assert_eq!(provider.requests.load(Ordering::SeqCst), 0);

    let _ = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 36,
                "method": "goal/resume",
                "params": {
                    "sessionId": session_id,
                    "status": "active"
                }
            }),
        )
        .await
        .context("goal/resume response")?;
    let turn_started = wait_for_notification(&mut notifications_rx, "turn/started").await?;
    wait_for_request_count(&provider.requests, /*expected*/ 1).await?;

    let turn_id: devo_protocol::TurnId =
        serde_json::from_value(turn_started["params"]["turn"]["turn_id"].clone())?;
    pause_goal_and_interrupt_turn(&runtime, connection_id, session_id, turn_id).await?;
    Ok(())
}

#[tokio::test]
async fn queued_user_turn_runs_before_goal_continuation() -> Result<()> {
    let data_root = TempDir::new()?;
    let release_first = Arc::new(Notify::new());
    let provider = Arc::new(QueuedPriorityProvider {
        requests: Mutex::new(Vec::new()),
        release_first: Arc::clone(&release_first),
    });
    let runtime = build_runtime(data_root.path(), provider.clone())?;
    let (connection_id, mut notifications_rx) = initialize_connection(&runtime).await?;
    let session_id = start_session(&runtime, connection_id, data_root.path()).await?;

    let _ = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 40,
                "method": "turn/start",
                "params": {
                    "session_id": session_id,
                    "input": [{ "type": "text", "text": "hold the first turn" }],
                    "model": null,
                    "sandbox": null,
                    "approval_policy": null,
                    "cwd": null
                }
            }),
        )
        .await
        .context("active turn/start response")?;
    wait_for_captured_request_count(&provider.requests, /*expected*/ 1).await?;
    wait_for_notification(&mut notifications_rx, "turn/started").await?;

    let _ = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 41,
                "method": "turn/start",
                "params": {
                    "session_id": session_id,
                    "input": [{ "type": "text", "text": "queued user input wins" }],
                    "model": null,
                    "sandbox": null,
                    "approval_policy": null,
                    "cwd": null
                }
            }),
        )
        .await;
    let _ = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 42,
                "method": "goal/set",
                "params": {
                    "sessionId": session_id,
                    "objective": "do not skip queued input",
                    "status": "active"
                }
            }),
        )
        .await
        .context("goal/set response")?;

    release_first.notify_one();
    let queued_turn_started = wait_for_notification(&mut notifications_rx, "turn/started").await?;
    wait_for_captured_request_count(&provider.requests, /*expected*/ 2).await?;
    tokio::time::sleep(Duration::from_millis(/*millis*/ 50)).await;
    {
        let requests = provider.requests.lock().expect("lock requests");
        assert_eq!(requests.len(), 2);
        assert!(
            request_contains_text(&requests[1], "queued user input wins"),
            "queued user turn should be the next provider request"
        );
    }

    let _ = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 43,
                "method": "goal/set",
                "params": {
                    "sessionId": session_id,
                    "status": "paused"
                }
            }),
        )
        .await
        .context("goal pause response")?;
    let _ = runtime
        .handle_incoming(
            connection_id,
            serde_json::json!({
                "id": 44,
                "method": "turn/interrupt",
                "params": {
                    "session_id": session_id,
                    "turn_id": queued_turn_started["params"]["turn"]["turn_id"],
                    "reason": "test cleanup"
                }
            }),
        )
        .await;

    Ok(())
}
