use std::sync::Arc;

use super::*;

impl ServerRuntime {
    pub(super) async fn remember_research_child_agent(
        &self,
        parent_session_id: SessionId,
        child_session_id: SessionId,
    ) {
        self.research_child_agents
            .lock()
            .await
            .entry(parent_session_id)
            .or_default()
            .insert(child_session_id);
    }

    pub(super) async fn clear_research_child_agents(&self, parent_session_id: SessionId) {
        self.research_child_agents
            .lock()
            .await
            .remove(&parent_session_id);
    }

    pub(super) async fn close_research_child_agents(self: Arc<Self>, parent_session_id: SessionId) {
        let child_session_ids = self
            .research_child_agents
            .lock()
            .await
            .remove(&parent_session_id)
            .map(|children| children.into_iter().collect::<Vec<_>>())
            .unwrap_or_default();
        for child_session_id in child_session_ids {
            if let Err(error) = Arc::clone(&self)
                .close_agent(devo_protocol::CloseAgentParams {
                    session_id: parent_session_id,
                    target: child_session_id.to_string(),
                })
                .await
            {
                tracing::warn!(
                    parent_session_id = %parent_session_id,
                    child_session_id = %child_session_id,
                    error = %error,
                    "failed to close research child agent"
                );
            }
        }
    }
}
