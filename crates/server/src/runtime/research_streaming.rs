use super::research_capture::StreamedTextItem;
use super::research_stages::StreamedResearchArtifact;
use super::*;

impl ServerRuntime {
    pub(super) async fn emit_research_artifact(
        &self,
        session_id: SessionId,
        turn_id: TurnId,
        artifact_type: ResearchArtifactType,
        title: impl Into<String>,
        content: impl Into<String>,
    ) {
        let artifact = ResearchArtifactItem {
            artifact_type,
            title: title.into(),
            content: content.into(),
        };
        self.emit_turn_item(
            session_id,
            turn_id,
            ItemKind::ResearchArtifact,
            TurnItem::ResearchArtifact(artifact.clone()),
            serde_json::to_value(artifact).expect("serialize research artifact item"),
        )
        .await;
    }

    pub(super) async fn push_agent_message_delta(
        &self,
        session_id: SessionId,
        turn_id: TurnId,
        state: &mut StreamedTextItem,
        delta: String,
    ) {
        if delta.is_empty() {
            return;
        }
        let item_id = match (state.item_id, state.item_seq) {
            (Some(item_id), Some(_)) => item_id,
            (None, None) => {
                let (item_id, item_seq) = self
                    .start_item(
                        session_id,
                        turn_id,
                        ItemKind::AgentMessage,
                        serde_json::json!({ "title": "Assistant", "text": "" }),
                    )
                    .await;
                state.item_id = Some(item_id);
                state.item_seq = Some(item_seq);
                item_id
            }
            _ => return,
        };
        state.text.push_str(&delta);
        self.broadcast_event(ServerEvent::ItemDelta {
            delta_kind: ItemDeltaKind::AgentMessageDelta,
            payload: ItemDeltaPayload {
                context: EventContext {
                    session_id,
                    turn_id: Some(turn_id),
                    item_id: Some(item_id),
                    seq: 0,
                },
                delta,
                stream_index: None,
                channel: None,
            },
        })
        .await;
    }

    pub(super) async fn complete_agent_message_item(
        &self,
        session_id: SessionId,
        turn_id: TurnId,
        state: &mut StreamedTextItem,
        final_text: String,
    ) {
        if state.item_id.is_none() && !final_text.trim().is_empty() {
            let (item_id, item_seq) = self
                .start_item(
                    session_id,
                    turn_id,
                    ItemKind::AgentMessage,
                    serde_json::json!({ "title": "Assistant", "text": "" }),
                )
                .await;
            state.item_id = Some(item_id);
            state.item_seq = Some(item_seq);
        }
        let (Some(item_id), Some(item_seq)) = (state.item_id.take(), state.item_seq.take()) else {
            return;
        };
        self.complete_item(
            session_id,
            turn_id,
            item_id,
            item_seq,
            ItemKind::AgentMessage,
            TurnItem::AgentMessage(TextItem {
                text: final_text.clone(),
            }),
            serde_json::json!({ "title": "Assistant", "text": final_text }),
        )
        .await;
    }

    pub(super) async fn push_reasoning_delta(
        &self,
        session_id: SessionId,
        turn_id: TurnId,
        state: &mut StreamedTextItem,
        delta: String,
    ) {
        if delta.is_empty() {
            return;
        }
        let item_id = match (state.item_id, state.item_seq) {
            (Some(item_id), Some(_)) => item_id,
            (None, None) => {
                let (item_id, item_seq) = self
                    .start_item(
                        session_id,
                        turn_id,
                        ItemKind::Reasoning,
                        serde_json::json!({ "title": "Reasoning", "text": "" }),
                    )
                    .await;
                state.item_id = Some(item_id);
                state.item_seq = Some(item_seq);
                item_id
            }
            _ => return,
        };
        state.text.push_str(&delta);
        self.broadcast_event(ServerEvent::ItemDelta {
            delta_kind: ItemDeltaKind::ReasoningTextDelta,
            payload: ItemDeltaPayload {
                context: EventContext {
                    session_id,
                    turn_id: Some(turn_id),
                    item_id: Some(item_id),
                    seq: 0,
                },
                delta,
                stream_index: None,
                channel: None,
            },
        })
        .await;
    }

    pub(super) async fn complete_reasoning_item(
        &self,
        session_id: SessionId,
        turn_id: TurnId,
        state: &mut StreamedTextItem,
    ) {
        let (Some(item_id), Some(item_seq)) = (state.item_id.take(), state.item_seq.take()) else {
            return;
        };
        let text = std::mem::take(&mut state.text);
        self.complete_item(
            session_id,
            turn_id,
            item_id,
            item_seq,
            ItemKind::Reasoning,
            TurnItem::Reasoning(TextItem { text: text.clone() }),
            serde_json::json!({ "title": "Reasoning", "text": text }),
        )
        .await;
    }

    pub(super) async fn push_research_artifact_delta(
        &self,
        session_id: SessionId,
        turn_id: TurnId,
        state: &mut StreamedTextItem,
        artifact: &StreamedResearchArtifact,
        delta: String,
    ) {
        if delta.is_empty() {
            return;
        }
        let item_id = match (state.item_id, state.item_seq) {
            (Some(item_id), Some(_)) => item_id,
            (None, None) => {
                let (item_id, item_seq) = self
                    .start_item(
                        session_id,
                        turn_id,
                        ItemKind::ResearchArtifact,
                        serde_json::to_value(ResearchArtifactItem {
                            artifact_type: artifact.artifact_type.clone(),
                            title: artifact.title.clone(),
                            content: String::new(),
                        })
                        .expect("serialize streamed research artifact"),
                    )
                    .await;
                state.item_id = Some(item_id);
                state.item_seq = Some(item_seq);
                item_id
            }
            _ => return,
        };
        state.text.push_str(&delta);
        self.broadcast_event(ServerEvent::ItemDelta {
            delta_kind: ItemDeltaKind::ResearchArtifactDelta,
            payload: ItemDeltaPayload {
                context: EventContext {
                    session_id,
                    turn_id: Some(turn_id),
                    item_id: Some(item_id),
                    seq: 0,
                },
                delta,
                stream_index: None,
                channel: None,
            },
        })
        .await;
    }

    pub(super) async fn complete_research_artifact_item(
        &self,
        session_id: SessionId,
        turn_id: TurnId,
        state: &mut StreamedTextItem,
        artifact: &StreamedResearchArtifact,
        final_text: &str,
    ) {
        if state.item_id.is_none() && !final_text.trim().is_empty() {
            let (item_id, item_seq) = self
                .start_item(
                    session_id,
                    turn_id,
                    ItemKind::ResearchArtifact,
                    serde_json::to_value(ResearchArtifactItem {
                        artifact_type: artifact.artifact_type.clone(),
                        title: artifact.title.clone(),
                        content: String::new(),
                    })
                    .expect("serialize streamed research artifact"),
                )
                .await;
            state.item_id = Some(item_id);
            state.item_seq = Some(item_seq);
        }
        let (Some(item_id), Some(item_seq)) = (state.item_id.take(), state.item_seq.take()) else {
            return;
        };
        let content = if final_text.trim().is_empty() {
            std::mem::take(&mut state.text)
        } else {
            final_text.to_string()
        };
        self.complete_item(
            session_id,
            turn_id,
            item_id,
            item_seq,
            ItemKind::ResearchArtifact,
            TurnItem::ResearchArtifact(ResearchArtifactItem {
                artifact_type: artifact.artifact_type.clone(),
                title: artifact.title.clone(),
                content: content.clone(),
            }),
            serde_json::to_value(ResearchArtifactItem {
                artifact_type: artifact.artifact_type.clone(),
                title: artifact.title.clone(),
                content,
            })
            .expect("serialize completed research artifact"),
        )
        .await;
    }
}
