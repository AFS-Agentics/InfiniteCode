//! Deterministic sub-agent monitor scenarios for local TUI debugging.

use std::time::Duration;

use devo_core::ItemId;
use devo_core::SessionId;

use crate::app_event::AppEvent;
use crate::app_event::SubagentDebugStep;
use crate::app_event_sender::AppEventSender;
use crate::events::PlanStep;
use crate::events::PlanStepStatus;
use crate::events::SubagentMonitorAgent;
use crate::events::SubagentMonitorEvent;
use crate::events::TextItemKind;

use super::ChatWidget;

const ENV_NAME: &str = "DEVO_TUI_DEBUG_SCENARIO";
const LEGACY_ENV_NAME: &str = "DEVO_TUI_DEBUG_SUBAGENTS";

#[derive(Clone, Copy, Debug)]
enum DebugScenario {
    PreviewCycle,
    MultiFour,
    MissingDiscovery,
    Terminal,
}

enum DebugScenarioParse {
    Disabled,
    Scenario(DebugScenario),
    Unknown,
}

impl DebugScenario {
    fn parse(raw: &str) -> DebugScenarioParse {
        let normalized = raw.trim().to_ascii_lowercase();
        let scenario = normalized
            .strip_prefix("subagent:")
            .or_else(|| normalized.strip_prefix("subagents:"))
            .or_else(|| normalized.strip_prefix("subagent/"))
            .or_else(|| normalized.strip_prefix("subagents/"))
            .or_else(|| normalized.strip_prefix("subagent-"))
            .or_else(|| normalized.strip_prefix("subagents-"))
            .unwrap_or(normalized.as_str());
        match scenario {
            "" | "0" | "false" | "off" => DebugScenarioParse::Disabled,
            "1" | "true" | "on" | "preview" | "preview-cycle" => {
                DebugScenarioParse::Scenario(Self::PreviewCycle)
            }
            "multi" | "multi-4" | "four" => DebugScenarioParse::Scenario(Self::MultiFour),
            "missing" | "missing-discovery" => DebugScenarioParse::Scenario(Self::MissingDiscovery),
            "terminal" | "finish" | "completed" => DebugScenarioParse::Scenario(Self::Terminal),
            _ => DebugScenarioParse::Unknown,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::PreviewCycle => "subagent:preview-cycle",
            Self::MultiFour => "subagent:multi-4",
            Self::MissingDiscovery => "subagent:missing-discovery",
            Self::Terminal => "subagent:terminal",
        }
    }
}

impl ChatWidget {
    pub(super) fn maybe_start_subagent_debug_scenario(&self) {
        let Some((env_name, raw, legacy)) = subagent_debug_scenario_env() else {
            return;
        };
        if legacy {
            tracing::warn!(
                target: "devo_tui::subagent",
                env = LEGACY_ENV_NAME,
                replacement = ENV_NAME,
                "legacy TUI subagent debug scenario env var is deprecated"
            );
        }
        let scenario = match DebugScenario::parse(&raw) {
            DebugScenarioParse::Disabled => return,
            DebugScenarioParse::Scenario(scenario) => scenario,
            DebugScenarioParse::Unknown => {
                tracing::warn!(
                    target: "devo_tui::subagent",
                    env = env_name,
                    value = %raw,
                    "unknown TUI debug scenario"
                );
                return;
            }
        };

        let tx = self.app_event_tx.clone();
        tracing::info!(
            target: "devo_tui::subagent",
            env = env_name,
            scenario = scenario.name(),
            "starting TUI debug scenario"
        );
        tokio::spawn(async move {
            run_scenario(scenario, tx).await;
        });
    }

    pub(crate) fn apply_subagent_debug_step(&mut self, step: SubagentDebugStep) {
        tracing::debug!(
            target: "devo_tui::subagent",
            step = debug_step_name(&step),
            "applying TUI subagent debug step"
        );
        match step {
            SubagentDebugStep::Discover {
                session_id,
                parent_session_id,
                nickname,
                status,
                last_task_message,
            } => self.on_subagent_discovered(SubagentMonitorAgent {
                session_id,
                parent_session_id,
                agent_path: format!("root/{nickname}"),
                nickname,
                role: "debug".to_string(),
                status,
                last_task_message,
            }),
            SubagentDebugStep::TextDelta {
                session_id,
                item_id,
                kind,
                delta,
            } => self.on_subagent_monitor_event(SubagentMonitorEvent::TextItemDelta {
                session_id,
                item_id: Some(item_id),
                kind,
                delta,
            }),
            SubagentDebugStep::ToolCall {
                session_id,
                tool_use_id,
                summary,
            } => self.on_subagent_monitor_event(SubagentMonitorEvent::ToolCall {
                session_id,
                tool_use_id,
                summary,
            }),
            SubagentDebugStep::ToolOutputDelta {
                session_id,
                tool_use_id,
                delta,
            } => self.on_subagent_monitor_event(SubagentMonitorEvent::ToolOutputDelta {
                session_id,
                tool_use_id,
                delta,
            }),
            SubagentDebugStep::ToolResult {
                session_id,
                tool_use_id,
                title,
                preview,
                is_error,
            } => self.on_subagent_monitor_event(SubagentMonitorEvent::ToolResult {
                session_id,
                tool_use_id,
                title,
                preview,
                is_error,
            }),
            SubagentDebugStep::PlanUpdated {
                session_id,
                explanation,
                steps,
            } => self.on_subagent_monitor_event(SubagentMonitorEvent::PlanUpdated {
                session_id,
                explanation,
                steps,
            }),
            SubagentDebugStep::Finish { session_id, status } => {
                self.on_subagent_monitor_event(SubagentMonitorEvent::TurnFinished {
                    session_id,
                    status,
                })
            }
        }
    }
}

fn subagent_debug_scenario_env() -> Option<(&'static str, String, bool)> {
    match std::env::var(ENV_NAME) {
        Ok(raw) => Some((ENV_NAME, raw, false)),
        Err(_) => std::env::var(LEGACY_ENV_NAME)
            .ok()
            .map(|raw| (LEGACY_ENV_NAME, raw, true)),
    }
}

async fn run_scenario(scenario: DebugScenario, tx: AppEventSender) {
    let mut steps = match scenario {
        DebugScenario::PreviewCycle => preview_cycle_steps(),
        DebugScenario::MultiFour => multi_four_steps(),
        DebugScenario::MissingDiscovery => missing_discovery_steps(),
        DebugScenario::Terminal => terminal_steps(),
    };
    steps.sort_by_key(|(at, _)| *at);

    let mut elapsed = Duration::from_millis(0);
    for (at, step) in steps {
        if at > elapsed {
            tokio::time::sleep(at - elapsed).await;
            elapsed = at;
        }
        tx.send(AppEvent::DebugSubagentStep { step });
    }
}

fn preview_cycle_steps() -> Vec<(Duration, SubagentDebugStep)> {
    let parent = SessionId::new();
    let child = SessionId::new();
    let item = ItemId::new();
    let tool_use_id = "debug-tool-1".to_string();
    vec![
        (
            Duration::from_millis(0),
            discover_step(parent, child, "debug-preview"),
        ),
        (
            Duration::from_millis(500),
            text_delta_step(child, item, "assistant preview 1"),
        ),
        (
            Duration::from_millis(900),
            SubagentDebugStep::ToolCall {
                session_id: child,
                tool_use_id: tool_use_id.clone(),
                summary: "rg debug-subagent".to_string(),
            },
        ),
        (
            Duration::from_millis(1_300),
            SubagentDebugStep::ToolOutputDelta {
                session_id: child,
                tool_use_id: tool_use_id.clone(),
                delta: "found first batch".to_string(),
            },
        ),
        (
            Duration::from_millis(1_700),
            SubagentDebugStep::ToolOutputDelta {
                session_id: child,
                tool_use_id: tool_use_id.clone(),
                delta: "\nfound second batch RIGHT_TAIL".to_string(),
            },
        ),
        (
            Duration::from_millis(2_200),
            SubagentDebugStep::ToolResult {
                session_id: child,
                tool_use_id,
                title: "rg debug-subagent".to_string(),
                preview: "tool result preview".to_string(),
                is_error: false,
            },
        ),
        (
            Duration::from_millis(2_800),
            SubagentDebugStep::PlanUpdated {
                session_id: child,
                explanation: Some("debug plan note".to_string()),
                steps: vec![PlanStep {
                    text: "latest plan step".to_string(),
                    status: PlanStepStatus::InProgress,
                }],
            },
        ),
    ]
}

fn multi_four_steps() -> Vec<(Duration, SubagentDebugStep)> {
    let parent = SessionId::new();
    ["alpha", "bravo", "charlie", "delta"]
        .into_iter()
        .enumerate()
        .flat_map(|(index, nickname)| {
            let child = SessionId::new();
            let item = ItemId::new();
            let base_delay = u64::try_from(index).unwrap_or(0) * 300;
            [
                (
                    Duration::from_millis(base_delay),
                    discover_step(parent, child, nickname),
                ),
                (
                    Duration::from_millis(base_delay + 450),
                    text_delta_step(child, item, format!("{nickname} preview update")),
                ),
            ]
        })
        .collect()
}

fn missing_discovery_steps() -> Vec<(Duration, SubagentDebugStep)> {
    let orphan = SessionId::new();
    vec![(
        Duration::from_millis(0),
        text_delta_step(orphan, ItemId::new(), "orphan update without discovery"),
    )]
}

fn terminal_steps() -> Vec<(Duration, SubagentDebugStep)> {
    let parent = SessionId::new();
    let child = SessionId::new();
    let item = ItemId::new();
    vec![
        (
            Duration::from_millis(0),
            discover_step(parent, child, "debug-terminal"),
        ),
        (
            Duration::from_millis(500),
            text_delta_step(child, item, "visible before completion"),
        ),
        (
            Duration::from_millis(2_000),
            SubagentDebugStep::Finish {
                session_id: child,
                status: "completed".to_string(),
            },
        ),
    ]
}

fn discover_step(
    parent_session_id: SessionId,
    session_id: SessionId,
    nickname: &str,
) -> SubagentDebugStep {
    SubagentDebugStep::Discover {
        session_id,
        parent_session_id,
        nickname: nickname.to_string(),
        status: "running".to_string(),
        last_task_message: Some(format!("run {nickname}")),
    }
}

fn text_delta_step(
    session_id: SessionId,
    item_id: ItemId,
    delta: impl Into<String>,
) -> SubagentDebugStep {
    SubagentDebugStep::TextDelta {
        session_id,
        item_id,
        kind: TextItemKind::Assistant,
        delta: delta.into(),
    }
}

fn debug_step_name(step: &SubagentDebugStep) -> &'static str {
    match step {
        SubagentDebugStep::Discover { .. } => "discover",
        SubagentDebugStep::TextDelta { .. } => "text_delta",
        SubagentDebugStep::ToolCall { .. } => "tool_call",
        SubagentDebugStep::ToolOutputDelta { .. } => "tool_output_delta",
        SubagentDebugStep::ToolResult { .. } => "tool_result",
        SubagentDebugStep::PlanUpdated { .. } => "plan_updated",
        SubagentDebugStep::Finish { .. } => "finish",
    }
}
