//! Sub-agent metadata helpers for the TUI worker.
//!
//! Live sub-agent monitor updates are routed from ACP `session/update`
//! notifications. This module only normalizes agent metadata returned by ACP
//! session info and `agent/list`.

use infinitecode_protocol::AgentInfo;
use infinitecode_protocol::SessionMetadata;

use crate::events::SubagentMonitorAgent;

pub(super) fn agent_from_info(info: AgentInfo) -> Option<SubagentMonitorAgent> {
    Some(SubagentMonitorAgent {
        session_id: info.session_id,
        parent_session_id: info.parent_session_id?,
        agent_path: info.agent_path,
        nickname: info.agent_nickname,
        role: info.agent_role,
        status: info.status,
        last_task_message: info.last_task_message,
    })
}

pub(super) fn agent_from_session(session: &SessionMetadata) -> Option<SubagentMonitorAgent> {
    Some(SubagentMonitorAgent {
        session_id: session.session_id,
        parent_session_id: session.parent_session_id?,
        agent_path: session.agent_path.clone()?,
        nickname: session
            .agent_nickname
            .clone()
            .unwrap_or_else(|| session.session_id.to_string()),
        role: session
            .agent_role
            .clone()
            .unwrap_or_else(|| "default".to_string()),
        status: format!("{:?}", session.status).to_lowercase(),
        last_task_message: None,
    })
}
