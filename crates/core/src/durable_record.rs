use chrono::{DateTime, Utc};
use devo_protocol::{ItemId, SessionId, TurnId, TurnKind, TurnStatus, TurnUsage};
use serde::{Deserialize, Serialize};

// ── DurableRecord Enum ────────────────────────────────────────────────

/// Every append-only JSONL record. One variant per record type.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "record_kind", rename_all = "snake_case")]
pub enum DurableRecord {
    // Session lifecyle
    SessionCreated(SessionCreatedRecord),
    SessionForked(SessionForkedRecord),
    SessionMetadataUpdated(SessionMetadataUpdatedRecord),
    SessionDeleted(SessionDeletedRecord),

    // Transcript — turn lifecyle
    TurnStarted(TurnStartedRecord),
    TurnCompleted(TurnCompletedRecord),
    TurnFailed(TurnFailedRecord),
    TurnInterrupted(TurnInterruptedRecord),

    // Transcript — item lifecyle
    ItemStarted(ItemStartedRecord),
    ItemContentAppended(ItemContentAppendedRecord),
    ItemCompleted(ItemCompletedRecord),
    ItemFailed(ItemFailedRecord),

    // Active-turn messages
    SteerRecorded(SteerRecordedRecord),
    QueueItemRecorded(QueueItemRecordedRecord),
    QueueItemResolved(QueueItemResolvedRecord),

    // Interrupt / resume
    TurnInterruptRequested(TurnInterruptRequestedRecord),
    TurnResumeStarted(TurnResumeStartedRecord),

    // Usage
    UsageRecorded(UsageRecordedRecord),
}

impl DurableRecord {
    pub fn record_kind(&self) -> &'static str {
        match self {
            Self::SessionCreated(_) => "session_created",
            Self::SessionForked(_) => "session_forked",
            Self::SessionMetadataUpdated(_) => "session_metadata_updated",
            Self::SessionDeleted(_) => "session_deleted",
            Self::TurnStarted(_) => "turn_started",
            Self::TurnCompleted(_) => "turn_completed",
            Self::TurnFailed(_) => "turn_failed",
            Self::TurnInterrupted(_) => "turn_interrupted",
            Self::ItemStarted(_) => "item_started",
            Self::ItemContentAppended(_) => "item_content_appended",
            Self::ItemCompleted(_) => "item_completed",
            Self::ItemFailed(_) => "item_failed",
            Self::SteerRecorded(_) => "steer_recorded",
            Self::QueueItemRecorded(_) => "queue_item_recorded",
            Self::QueueItemResolved(_) => "queue_item_resolved",
            Self::TurnInterruptRequested(_) => "turn_interrupt_requested",
            Self::TurnResumeStarted(_) => "turn_resume_started",
            Self::UsageRecorded(_) => "usage_recorded",
        }
    }
}

// ── Session Lifecycle Records ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionCreatedRecord {
    pub schema_version: u32,
    pub session_id: SessionId,
    pub workspace_root: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionForkedRecord {
    pub schema_version: u32,
    pub session_id: SessionId,
    pub parent_session_id: SessionId,
    pub fork_turn_id: TurnId,
    pub workspace_root: String,
    pub fork_label: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionMetadataUpdatedRecord {
    pub schema_version: u32,
    pub session_id: SessionId,
    pub field: String,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionDeletedRecord {
    pub schema_version: u32,
    pub session_id: SessionId,
    pub deleted_at: DateTime<Utc>,
}

// ── Turn Lifecycle Records ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TurnStartedRecord {
    pub schema_version: u32,
    pub session_id: SessionId,
    pub turn_id: TurnId,
    pub sequence: u32,
    pub status: TurnStatus,
    pub kind: TurnKind,
    pub resume_of_turn_id: Option<TurnId>,
    pub submitted_by_client_id: Option<String>,
    pub model: Option<String>,
    pub thinking: Option<String>,
    pub started_at: DateTime<Utc>,
}

/// Shared terminal fields for Completed/Failed/Interrupted.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TurnTerminalFields {
    pub turn_id: TurnId,
    pub session_id: SessionId,
    pub status: TurnStatus,
    pub usage: Option<TurnUsage>,
    pub completed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TurnCompletedRecord {
    pub schema_version: u32,
    #[serde(flatten)]
    pub terminal: TurnTerminalFields,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TurnFailedRecord {
    pub schema_version: u32,
    #[serde(flatten)]
    pub terminal: TurnTerminalFields,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TurnInterruptedRecord {
    pub schema_version: u32,
    #[serde(flatten)]
    pub terminal: TurnTerminalFields,
}

// ── Item Lifecycle Records ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ItemStartedRecord {
    pub schema_version: u32,
    pub session_id: SessionId,
    pub turn_id: TurnId,
    pub item_id: ItemId,
    pub kind: ItemRecordKind,
    pub role: RecordRole,
    pub visibility: ItemVisibility,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemRecordKind {
    UserInput,
    AssistantText,
    AssistantReasoning,
    ToolCall,
    ToolResult,
    ApprovalRequest,
    QuestionRequest,
    SteerMessage,
    QueueMessage,
    Error,
    ContextSummary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordRole {
    User,
    Assistant,
    Tool,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemVisibility {
    Visible,
    Hidden,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ItemContentAppendedRecord {
    pub schema_version: u32,
    pub item_id: ItemId,
    pub content_part_index: u32,
    pub offset: u64,
    pub content_kind: ContentAppendKind,
    pub content: String,
    pub byte_count: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentAppendKind {
    Text,
    Reasoning,
    ToolCallJson,
    ToolResultText,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ItemCompletedRecord {
    pub schema_version: u32,
    pub item_id: ItemId,
    pub turn_id: TurnId,
    pub final_status: ItemStatus,
    pub content_hash: Option<String>,
    pub completed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ItemFailedRecord {
    pub schema_version: u32,
    pub item_id: ItemId,
    pub turn_id: TurnId,
    pub final_status: ItemStatus,
    pub error: Option<String>,
    pub completed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemStatus {
    Completed,
    Failed,
    Interrupted,
    Denied,
    Blocked,
    Canceled,
}

// ── Active-Turn Message Records ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SteerRecordedRecord {
    pub schema_version: u32,
    pub session_id: SessionId,
    pub turn_id: TurnId,
    pub item_id: ItemId,
    pub received_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QueueItemRecordedRecord {
    pub schema_version: u32,
    pub session_id: SessionId,
    pub turn_id: TurnId,
    pub item_id: ItemId,
    pub received_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QueueItemResolvedRecord {
    pub schema_version: u32,
    pub session_id: SessionId,
    pub item_id: ItemId,
    pub resolved_at: DateTime<Utc>,
}

// ── Interrupt / Resume Records ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TurnInterruptRequestedRecord {
    pub schema_version: u32,
    pub session_id: SessionId,
    pub turn_id: TurnId,
    pub reason: Option<String>,
    pub requested_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TurnResumeStartedRecord {
    pub schema_version: u32,
    pub session_id: SessionId,
    pub interrupted_turn_id: TurnId,
    pub resume_turn_id: TurnId,
    pub started_at: DateTime<Utc>,
}

// ── Usage Record ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UsageRecordedRecord {
    pub schema_version: u32,
    pub session_id: SessionId,
    pub turn_id: TurnId,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cached_input_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub recorded_at: DateTime<Utc>,
}

// ── Turn Execution Phase State Machine ─────────────────────────────────

/// The server-visible execution phase of a turn.
/// Drives orchestration: server checks phase to decide what to do next.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionPhase {
    /// Turn accepted but context assembly hasn't started.
    Admitted,
    /// Context assembly in progress.
    AssemblingContext,
    /// Model invocation in progress (provider call active).
    ModelInvocation,
    /// Executing tool calls requested by the model.
    ToolDispatch,
    /// Waiting for user approval on one or more tool calls.
    WaitingApproval,
    /// Recording durable state and preparing terminal status.
    Finalizing,
    /// Turn ended successfully.
    Completed,
    /// Turn ended with an unrecoverable error.
    Failed,
    /// Turn was interrupted by user or system.
    Interrupted,
}

impl ExecutionPhase {
    /// Returns `true` if this phase is terminal (no further transitions allowed).
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Completed | Self::Failed)
    }

    /// Validate a transition from `self` to `next`.
    /// Returns `Ok(())` if legal, `Err(reason)` if illegal.
    pub fn can_transition_to(&self, next: ExecutionPhase) -> Result<(), &'static str> {
        use ExecutionPhase::*;
        match (self, next) {
            // Legal transitions per L3-BEH-CORE-001 turn state machine
            (Admitted, AssemblingContext) => Ok(()),
            (Admitted, Failed) => Ok(()),
            (AssemblingContext, ModelInvocation) => Ok(()),
            (AssemblingContext, Failed) => Ok(()),
            (ModelInvocation, ToolDispatch) => Ok(()),
            (ModelInvocation, Finalizing) => Ok(()),
            (ModelInvocation, Failed) => Ok(()),
            (ToolDispatch, ModelInvocation) => Ok(()),
            (ToolDispatch, WaitingApproval) => Ok(()),
            (ToolDispatch, Finalizing) => Ok(()),
            (ToolDispatch, Failed) => Ok(()),
            (WaitingApproval, ToolDispatch) => Ok(()),
            (WaitingApproval, Finalizing) => Ok(()),
            (WaitingApproval, Failed) => Ok(()),
            (Finalizing, Completed) => Ok(()),
            (Finalizing, Failed) => Ok(()),

            // Interrupt can happen from any non-terminal phase
            (Admitted, Interrupted) => Ok(()),
            (AssemblingContext, Interrupted) => Ok(()),
            (ModelInvocation, Interrupted) => Ok(()),
            (ToolDispatch, Interrupted) => Ok(()),
            (WaitingApproval, Interrupted) => Ok(()),
            (Finalizing, Interrupted) => Ok(()),

            // Interrupted turns are terminal; resume creates a new turn.
            (Interrupted, _) => Err("interrupted turns are terminal"),

            // All other transitions are illegal.
            _ => Err("illegal transition"),
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn now() -> DateTime<Utc> {
        Utc::now()
    }

    #[test]
    fn session_created_roundtrip() {
        let record = DurableRecord::SessionCreated(SessionCreatedRecord {
            schema_version: 1,
            session_id: SessionId::new(),
            workspace_root: "/home/user/project".into(),
            created_at: now(),
        });
        let json = serde_json::to_string(&record).expect("serialize");
        let restored: DurableRecord = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(record.record_kind(), restored.record_kind());
        assert_eq!(record.record_kind(), "session_created");
    }

    #[test]
    fn turn_started_roundtrip() {
        let record = DurableRecord::TurnStarted(TurnStartedRecord {
            schema_version: 1,
            session_id: SessionId::new(),
            turn_id: TurnId::new(),
            sequence: 0,
            status: TurnStatus::Running,
            kind: TurnKind::Regular,
            resume_of_turn_id: None,
            submitted_by_client_id: Some("tui-1".into()),
            model: Some("deepseek-v4-pro".into()),
            thinking: Some("high".into()),
            started_at: now(),
        });
        let json = serde_json::to_string(&record).expect("serialize");
        let restored: DurableRecord = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(record.record_kind(), restored.record_kind());
    }

    #[test]
    fn item_started_roundtrip() {
        let record = DurableRecord::ItemStarted(ItemStartedRecord {
            schema_version: 1,
            session_id: SessionId::new(),
            turn_id: TurnId::new(),
            item_id: ItemId::new(),
            kind: ItemRecordKind::AssistantText,
            role: RecordRole::Assistant,
            visibility: ItemVisibility::Visible,
            created_at: now(),
        });
        let json = serde_json::to_string(&record).expect("serialize");
        let restored: DurableRecord = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(record.record_kind(), restored.record_kind());
        assert_eq!(record.record_kind(), "item_started");
    }

    #[test]
    fn item_content_appended_roundtrip() {
        let record = DurableRecord::ItemContentAppended(ItemContentAppendedRecord {
            schema_version: 1,
            item_id: ItemId::new(),
            content_part_index: 0,
            offset: 0,
            content_kind: ContentAppendKind::Text,
            content: "Hello, world!".into(),
            byte_count: 13,
        });
        let json = serde_json::to_string(&record).expect("serialize");
        let restored: DurableRecord = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(record.record_kind(), restored.record_kind());
    }

    #[test]
    fn turn_completed_with_usage_roundtrip() {
        let usage = TurnUsage {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: Some(0),
            cache_read_input_tokens: Some(0),
        };
        let record = DurableRecord::TurnCompleted(TurnCompletedRecord {
            schema_version: 1,
            terminal: TurnTerminalFields {
                turn_id: TurnId::new(),
                session_id: SessionId::new(),
                status: TurnStatus::Completed,
                usage: Some(usage),
                completed_at: now(),
            },
        });
        let json = serde_json::to_string(&record).expect("serialize");
        let restored: DurableRecord = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(record.record_kind(), "turn_completed");
        assert_eq!(restored.record_kind(), "turn_completed");
    }

    #[test]
    fn item_failed_with_error_roundtrip() {
        let record = DurableRecord::ItemFailed(ItemFailedRecord {
            schema_version: 1,
            item_id: ItemId::new(),
            turn_id: TurnId::new(),
            final_status: ItemStatus::Failed,
            error: Some("permission denied".into()),
            completed_at: now(),
        });
        let json = serde_json::to_string(&record).expect("serialize");
        let restored: DurableRecord = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(record.record_kind(), "item_failed");
        assert_eq!(restored.record_kind(), "item_failed");
    }

    #[test]
    fn all_record_kinds_unique() {
        let kinds = vec![
            DurableRecord::SessionCreated(SessionCreatedRecord {
                schema_version: 1,
                session_id: SessionId::new(),
                workspace_root: "/tmp".into(),
                created_at: now(),
            })
            .record_kind(),
            DurableRecord::TurnStarted(TurnStartedRecord {
                schema_version: 1,
                session_id: SessionId::new(),
                turn_id: TurnId::new(),
                sequence: 0,
                status: TurnStatus::Running,
                kind: TurnKind::Regular,
                resume_of_turn_id: None,
                submitted_by_client_id: None,
                model: None,
                thinking: None,
                started_at: now(),
            })
            .record_kind(),
            DurableRecord::ItemStarted(ItemStartedRecord {
                schema_version: 1,
                session_id: SessionId::new(),
                turn_id: TurnId::new(),
                item_id: ItemId::new(),
                kind: ItemRecordKind::UserInput,
                role: RecordRole::User,
                visibility: ItemVisibility::Visible,
                created_at: now(),
            })
            .record_kind(),
            DurableRecord::ItemContentAppended(ItemContentAppendedRecord {
                schema_version: 1,
                item_id: ItemId::new(),
                content_part_index: 0,
                offset: 0,
                content_kind: ContentAppendKind::Text,
                content: String::new(),
                byte_count: 0,
            })
            .record_kind(),
            DurableRecord::TurnCompleted(TurnCompletedRecord {
                schema_version: 1,
                terminal: TurnTerminalFields {
                    turn_id: TurnId::new(),
                    session_id: SessionId::new(),
                    status: TurnStatus::Completed,
                    usage: None,
                    completed_at: now(),
                },
            })
            .record_kind(),
            DurableRecord::ItemCompleted(ItemCompletedRecord {
                schema_version: 1,
                item_id: ItemId::new(),
                turn_id: TurnId::new(),
                final_status: ItemStatus::Completed,
                content_hash: None,
                completed_at: now(),
            })
            .record_kind(),
        ];

        let mut deduped = kinds.clone();
        deduped.sort();
        deduped.dedup();
        assert_eq!(
            kinds.len(),
            deduped.len(),
            "record kinds must be unique"
        );
    }

    #[test]
    fn item_status_serde() {
        let statuses = [
            ItemStatus::Completed,
            ItemStatus::Failed,
            ItemStatus::Interrupted,
            ItemStatus::Denied,
            ItemStatus::Blocked,
            ItemStatus::Canceled,
        ];
        for status in &statuses {
            let json = serde_json::to_string(status).expect("serialize");
            let restored: ItemStatus = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(restored, *status);
        }
    }

    // ── ExecutionPhase state machine tests ──

    #[test]
    fn admitted_to_assembling_context_is_legal() {
        assert!(ExecutionPhase::Admitted
            .can_transition_to(ExecutionPhase::AssemblingContext)
            .is_ok());
    }

    #[test]
    fn admitted_to_model_invocation_is_illegal() {
        assert!(ExecutionPhase::Admitted
            .can_transition_to(ExecutionPhase::ModelInvocation)
            .is_err());
    }

    #[test]
    fn model_invocation_to_tool_dispatch_is_legal() {
        assert!(ExecutionPhase::ModelInvocation
            .can_transition_to(ExecutionPhase::ToolDispatch)
            .is_ok());
    }

    #[test]
    fn tool_dispatch_back_to_model_invocation_is_legal() {
        assert!(ExecutionPhase::ToolDispatch
            .can_transition_to(ExecutionPhase::ModelInvocation)
            .is_ok());
    }

    #[test]
    fn finalizing_to_completed_is_legal() {
        assert!(ExecutionPhase::Finalizing
            .can_transition_to(ExecutionPhase::Completed)
            .is_ok());
    }

    #[test]
    fn completed_is_terminal() {
        assert!(ExecutionPhase::Completed.is_terminal());
        assert!(ExecutionPhase::Failed.is_terminal());
        assert!(!ExecutionPhase::Admitted.is_terminal());
        assert!(!ExecutionPhase::ModelInvocation.is_terminal());
    }

    #[test]
    fn completed_cannot_transition() {
        assert!(ExecutionPhase::Completed
            .can_transition_to(ExecutionPhase::Admitted)
            .is_err());
        assert!(ExecutionPhase::Failed
            .can_transition_to(ExecutionPhase::Completed)
            .is_err());
    }

    #[test]
    fn interrupt_from_any_non_terminal_phase() {
        for phase in &[
            ExecutionPhase::Admitted,
            ExecutionPhase::AssemblingContext,
            ExecutionPhase::ModelInvocation,
            ExecutionPhase::ToolDispatch,
            ExecutionPhase::WaitingApproval,
            ExecutionPhase::Finalizing,
        ] {
            assert!(
                phase.can_transition_to(ExecutionPhase::Interrupted).is_ok(),
                "interrupt should be legal from {phase:?}"
            );
        }
    }

    #[test]
    fn execution_phase_serde_roundtrip() {
        let phases = [
            ExecutionPhase::Admitted,
            ExecutionPhase::AssemblingContext,
            ExecutionPhase::ModelInvocation,
            ExecutionPhase::ToolDispatch,
            ExecutionPhase::WaitingApproval,
            ExecutionPhase::Finalizing,
            ExecutionPhase::Completed,
            ExecutionPhase::Failed,
            ExecutionPhase::Interrupted,
        ];
        for phase in &phases {
            let json = serde_json::to_string(phase).expect("serialize");
            let restored: ExecutionPhase = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(restored, *phase);
        }
    }
}
