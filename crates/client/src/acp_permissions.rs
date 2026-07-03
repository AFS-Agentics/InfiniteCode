//! ACP permission prompt bridge: server `session/request_permission` is
//! surfaced to the UI via notifications; the JSON-RPC response is sent later
//! when the user approves or denies, using the original request `id`.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;

use devo_protocol::ApprovalDecisionPayload;
use devo_protocol::ApprovalDecisionValue;
use devo_protocol::ApprovalRequestPayload;
use devo_protocol::ApprovalResponseParams;
use devo_protocol::ApprovalScopeValue;
use devo_protocol::EventContext;
use devo_protocol::ItemEnvelope;
use devo_protocol::ItemEventPayload;
use devo_protocol::ItemId;
use devo_protocol::ItemKind;
use devo_protocol::PendingServerRequestContext;
use devo_protocol::ServerEvent;
use devo_protocol::ServerRequestKind;
use devo_protocol::TurnId;
use devo_protocol::acp_success_response;
use tokio::sync::Mutex;
use tokio::sync::mpsc;

use crate::client_core::ServerNotificationMessage;

static ACP_PERMISSION_NEXT_ID: AtomicU64 = AtomicU64::new(1);

pub(crate) type AcpPendingPermissions = Arc<Mutex<HashMap<String, AcpPendingPermission>>>;

pub(crate) struct AcpPendingPermission {
    request_id: serde_json::Value,
    session_id: devo_protocol::SessionId,
    turn_id: TurnId,
    item_id: ItemId,
    options: Vec<AcpPermissionOption>,
}

struct AcpPermissionOption {
    option_id: String,
    kind: String,
}

pub(crate) async fn handle_acp_request_permission(
    request_id: serde_json::Value,
    params: serde_json::Value,
    pending_permissions: AcpPendingPermissions,
    notifications_tx: mpsc::UnboundedSender<ServerNotificationMessage>,
) -> std::result::Result<(), String> {
    let session_id = params
        .get("sessionId")
        .cloned()
        .ok_or_else(|| "session/request_permission params.sessionId is required".to_string())
        .and_then(|value| {
            serde_json::from_value::<devo_protocol::SessionId>(value)
                .map_err(|error| format!("invalid session/request_permission sessionId: {error}"))
        })?;
    let options = acp_permission_options(&params)?;
    if !options
        .iter()
        .any(|option| option.kind.starts_with("allow"))
    {
        return Err("session/request_permission options must include an allow option".to_string());
    }

    let approval_id = format!(
        "acp-permission-{}",
        ACP_PERMISSION_NEXT_ID.fetch_add(1, Ordering::SeqCst)
    );
    let pending = AcpPendingPermission {
        request_id,
        session_id,
        turn_id: TurnId::new(),
        item_id: ItemId::new(),
        options,
    };
    let notification = acp_approval_request_notification(&approval_id, &params, &pending);
    pending_permissions
        .lock()
        .await
        .insert(approval_id.clone(), pending);
    if let Err(error) = notifications_tx.send(notification) {
        pending_permissions.lock().await.remove(&approval_id);
        return Err(format!("failed to deliver permission request: {error}"));
    }
    Ok(())
}

pub(crate) async fn resolve_acp_permission_response(
    pending_permissions: &AcpPendingPermissions,
    params: &ApprovalResponseParams,
) -> Option<(serde_json::Value, ServerNotificationMessage)> {
    let pending = pending_permissions
        .lock()
        .await
        .remove(&params.approval_id.to_string())?;
    let decision = acp_permission_response_from_approval(params, &pending);
    let response = acp_success_response(pending.request_id.clone(), decision);
    let notification = acp_approval_decision_notification(params, &pending);
    Some((response, notification))
}

fn acp_permission_options(
    params: &serde_json::Value,
) -> std::result::Result<Vec<AcpPermissionOption>, String> {
    let options = params
        .get("options")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "session/request_permission params.options must be an array".to_string())?;
    options
        .iter()
        .map(|option| {
            let option_id = option
                .get("optionId")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| {
                    "session/request_permission option.optionId must be a string".to_string()
                })?
                .to_string();
            let kind = option
                .get("kind")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| {
                    "session/request_permission option.kind must be a string".to_string()
                })?
                .to_string();
            Ok(AcpPermissionOption { option_id, kind })
        })
        .collect()
}

fn acp_approval_request_notification(
    approval_id: &str,
    params: &serde_json::Value,
    pending: &AcpPendingPermission,
) -> ServerNotificationMessage {
    let action_summary = params
        .get("toolCall")
        .and_then(|tool_call| tool_call.get("title"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("ACP tool permission request")
        .to_string();
    let target = params
        .get("toolCall")
        .and_then(|tool_call| tool_call.get("toolCallId"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let request = PendingServerRequestContext {
        request_id: approval_id.to_string().into(),
        request_kind: ServerRequestKind::ItemPermissionsRequestApproval,
        session_id: pending.session_id,
        turn_id: Some(pending.turn_id),
        item_id: Some(pending.item_id),
    };
    let payload = ApprovalRequestPayload {
        request,
        approval_id: approval_id.to_string().into(),
        action_summary,
        justification: "ACP agent requested permission to continue this tool call.".to_string(),
        resource: target.clone(),
        available_scopes: acp_approval_scopes(&pending.options),
        path: None,
        host: None,
        target,
    };
    acp_item_notification(
        "item/completed",
        ServerEvent::ItemCompleted(ItemEventPayload {
            context: EventContext {
                session_id: pending.session_id,
                turn_id: Some(pending.turn_id),
                item_id: Some(pending.item_id),
                seq: 0,
            },
            item: ItemEnvelope {
                item_id: pending.item_id,
                item_kind: ItemKind::ApprovalRequest,
                payload: serde_json::to_value(payload).expect("serialize ACP approval request"),
            },
        }),
    )
}

fn acp_approval_decision_notification(
    params: &ApprovalResponseParams,
    pending: &AcpPendingPermission,
) -> ServerNotificationMessage {
    let payload = ApprovalDecisionPayload {
        approval_id: params.approval_id.clone(),
        decision: acp_approval_decision_label(&params.decision).to_string(),
        scope: acp_approval_scope_label(&params.scope).to_string(),
    };
    acp_item_notification(
        "item/completed",
        ServerEvent::ItemCompleted(ItemEventPayload {
            context: EventContext {
                session_id: pending.session_id,
                turn_id: Some(pending.turn_id),
                item_id: Some(pending.item_id),
                seq: 0,
            },
            item: ItemEnvelope {
                item_id: ItemId::new(),
                item_kind: ItemKind::ApprovalDecision,
                payload: serde_json::to_value(payload).expect("serialize ACP approval decision"),
            },
        }),
    )
}

fn acp_item_notification(method: &str, event: ServerEvent) -> ServerNotificationMessage {
    ServerNotificationMessage {
        method: method.to_string(),
        params: serde_json::to_value(event).expect("serialize ACP bridged event"),
    }
}

fn acp_approval_scopes(options: &[AcpPermissionOption]) -> Vec<String> {
    let mut scopes = Vec::new();
    if options.iter().any(|option| option.kind == "allow_once") {
        scopes.push("once".to_string());
    }
    if options.iter().any(|option| option.kind == "allow_always") {
        scopes.push("session".to_string());
    }
    scopes
}

fn acp_permission_response_from_approval(
    params: &ApprovalResponseParams,
    pending: &AcpPendingPermission,
) -> serde_json::Value {
    if let Some(option_id) = acp_selected_permission_option(params, pending) {
        serde_json::json!({
            "outcome": {
                "outcome": "selected",
                "optionId": option_id
            }
        })
    } else {
        acp_cancelled_permission_response()
    }
}

fn acp_selected_permission_option(
    params: &ApprovalResponseParams,
    pending: &AcpPendingPermission,
) -> Option<String> {
    let preferred_kinds: &[&str] = match params.decision {
        ApprovalDecisionValue::Approve => match params.scope {
            ApprovalScopeValue::Session => &["allow_always", "allow_once"],
            ApprovalScopeValue::Once
            | ApprovalScopeValue::Turn
            | ApprovalScopeValue::PathPrefix
            | ApprovalScopeValue::Host
            | ApprovalScopeValue::Tool
            | ApprovalScopeValue::CommandPrefix => &["allow_once", "allow_always"],
        },
        ApprovalDecisionValue::Deny => match params.scope {
            ApprovalScopeValue::Session => &["reject_always", "reject_once"],
            ApprovalScopeValue::Once
            | ApprovalScopeValue::Turn
            | ApprovalScopeValue::PathPrefix
            | ApprovalScopeValue::Host
            | ApprovalScopeValue::Tool
            | ApprovalScopeValue::CommandPrefix => &["reject_once", "reject_always"],
        },
        ApprovalDecisionValue::Cancel => return None,
    };
    preferred_kinds.iter().find_map(|kind| {
        pending
            .options
            .iter()
            .find(|option| option.kind == *kind)
            .map(|option| option.option_id.clone())
    })
}

fn acp_cancelled_permission_response() -> serde_json::Value {
    serde_json::json!({
        "outcome": {
            "outcome": "cancelled"
        }
    })
}

fn acp_approval_decision_label(decision: &ApprovalDecisionValue) -> &'static str {
    match decision {
        ApprovalDecisionValue::Approve => "approve",
        ApprovalDecisionValue::Deny => "deny",
        ApprovalDecisionValue::Cancel => "cancel",
    }
}

fn acp_approval_scope_label(scope: &ApprovalScopeValue) -> &'static str {
    match scope {
        ApprovalScopeValue::Once => "once",
        ApprovalScopeValue::Turn => "turn",
        ApprovalScopeValue::Session => "session",
        ApprovalScopeValue::PathPrefix => "path_prefix",
        ApprovalScopeValue::Host => "host",
        ApprovalScopeValue::Tool => "tool",
        ApprovalScopeValue::CommandPrefix => "command_prefix",
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[tokio::test]
    async fn permission_request_resolves_selected_approval_response() {
        let pending_permissions = Arc::new(Mutex::new(HashMap::new()));
        let (notifications_tx, mut notifications_rx) = mpsc::unbounded_channel();
        let session_id = devo_protocol::SessionId::new();

        handle_acp_request_permission(
            serde_json::json!(77),
            serde_json::json!({
                "sessionId": session_id,
                "toolCall": {
                    "toolCallId": "call-1",
                    "title": "Edit file"
                },
                "options": [
                    { "optionId": "allow-once", "kind": "allow_once" },
                    { "optionId": "allow-always", "kind": "allow_always" },
                    { "optionId": "reject-once", "kind": "reject_once" }
                ]
            }),
            Arc::clone(&pending_permissions),
            notifications_tx,
        )
        .await
        .expect("permission request is accepted");

        let request_notification = notifications_rx
            .try_recv()
            .expect("approval request notification");
        assert_eq!(request_notification.method, "item/completed".to_string());
        let ServerEvent::ItemCompleted(request_item) =
            serde_json::from_value::<ServerEvent>(request_notification.params)
                .expect("decode approval request event")
        else {
            panic!("expected item/completed request event");
        };
        let request_payload =
            serde_json::from_value::<ApprovalRequestPayload>(request_item.item.payload.clone())
                .expect("decode approval request payload");
        let turn_id = request_item.context.turn_id.expect("request turn id");
        let item_id = request_item.context.item_id.expect("request item id");

        assert_eq!(
            request_item.context,
            EventContext {
                session_id,
                turn_id: Some(turn_id),
                item_id: Some(item_id),
                seq: 0,
            }
        );
        assert_eq!(request_item.item.item_id, item_id);
        assert_eq!(request_item.item.item_kind, ItemKind::ApprovalRequest);
        assert_eq!(
            request_payload,
            ApprovalRequestPayload {
                request: PendingServerRequestContext {
                    request_id: request_payload.approval_id.clone(),
                    request_kind: ServerRequestKind::ItemPermissionsRequestApproval,
                    session_id,
                    turn_id: Some(turn_id),
                    item_id: Some(item_id),
                },
                approval_id: request_payload.approval_id.clone(),
                action_summary: "Edit file".to_string(),
                justification: "ACP agent requested permission to continue this tool call."
                    .to_string(),
                resource: Some("call-1".to_string()),
                available_scopes: vec!["once".to_string(), "session".to_string()],
                path: None,
                host: None,
                target: Some("call-1".to_string()),
            }
        );

        let response_params = ApprovalResponseParams {
            session_id,
            turn_id,
            approval_id: request_payload.approval_id.clone(),
            decision: ApprovalDecisionValue::Approve,
            scope: ApprovalScopeValue::Once,
        };
        let (response, decision_notification) =
            resolve_acp_permission_response(&pending_permissions, &response_params)
                .await
                .expect("pending permission resolves");
        assert_eq!(
            response,
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": 77,
                "result": {
                    "outcome": {
                        "outcome": "selected",
                        "optionId": "allow-once"
                    }
                }
            })
        );

        let ServerEvent::ItemCompleted(decision_item) =
            serde_json::from_value::<ServerEvent>(decision_notification.params)
                .expect("decode approval decision event")
        else {
            panic!("expected item/completed decision event");
        };
        let decision_payload =
            serde_json::from_value::<ApprovalDecisionPayload>(decision_item.item.payload)
                .expect("decode approval decision payload");
        assert_eq!(
            decision_item.context,
            EventContext {
                session_id,
                turn_id: Some(turn_id),
                item_id: Some(item_id),
                seq: 0,
            }
        );
        assert_eq!(decision_item.item.item_kind, ItemKind::ApprovalDecision);
        assert_eq!(
            decision_payload,
            ApprovalDecisionPayload {
                approval_id: request_payload.approval_id,
                decision: "approve".to_string(),
                scope: "once".to_string(),
            }
        );
    }
}
