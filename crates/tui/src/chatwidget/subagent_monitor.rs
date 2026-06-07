//! Read-only sub-agent monitor for `ChatWidget`.
//!
//! The monitor renders child-agent activity in the normal TUI without switching
//! the active parent session. Worker events update per-child transcript state,
//! while keyboard input only selects, scrolls, or closes the monitor.

use std::collections::HashMap;

use crossterm::event::KeyCode;
use crossterm::event::KeyEvent;
use crossterm::event::KeyEventKind;
use ratatui::buffer::Buffer;
use ratatui::layout::Constraint;
use ratatui::layout::Layout;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::style::Stylize;
use ratatui::text::Line;
use ratatui::text::Span;
use ratatui::text::Text;
use ratatui::widgets::Block;
use ratatui::widgets::Paragraph;
use ratatui::widgets::Widget;
use ratatui::widgets::Wrap;

use devo_core::ItemId;
use devo_core::SessionId;

use crate::events::PlanStepStatus;
use crate::events::SubagentMonitorAgent;
use crate::events::SubagentMonitorEvent;
use crate::events::TextItemKind;

use super::ChatWidget;

#[derive(Debug, Default)]
pub(super) struct SubagentMonitorState {
    open: bool,
    agents: Vec<SubagentMonitorAgent>,
    selected: Option<SessionId>,
    user_selected: bool,
    sessions: HashMap<SessionId, SubagentSessionView>,
}

#[derive(Debug, Default)]
struct SubagentSessionView {
    agent: Option<SubagentMonitorAgent>,
    status: String,
    transcript: Vec<MonitorTranscriptItem>,
    active_text: HashMap<String, MonitorTextItem>,
    active_tools: HashMap<String, MonitorToolItem>,
    scroll_offset: usize,
    active_turn: Option<devo_core::TurnId>,
}

#[derive(Debug)]
struct MonitorTextItem {
    kind: TextItemKind,
    text: String,
}

#[derive(Debug)]
struct MonitorToolItem {
    title: String,
    output: String,
    is_error: bool,
}

#[derive(Debug)]
struct MonitorTranscriptItem {
    title: String,
    body: String,
    is_error: bool,
}

impl ChatWidget {
    pub(super) fn is_subagent_monitor_open(&self) -> bool {
        self.subagent_monitor.open
    }

    pub(super) fn handle_subagent_monitor_key_event(&mut self, key: KeyEvent) {
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return;
        }
        match key.code {
            KeyCode::Esc | KeyCode::Char('q') => {
                self.subagent_monitor.open = false;
                self.set_status_message("Ready");
                self.frame_requester.schedule_frame();
            }
            KeyCode::Up => {
                self.select_relative_subagent(-1);
            }
            KeyCode::Down => {
                self.select_relative_subagent(1);
            }
            KeyCode::PageUp => {
                self.adjust_selected_subagent_scroll(8);
            }
            KeyCode::PageDown => {
                self.adjust_selected_subagent_scroll(-8);
            }
            KeyCode::Home => {
                if let Some(view) = self.selected_subagent_view_mut() {
                    view.scroll_offset = usize::MAX / 2;
                    self.frame_requester.schedule_frame();
                }
            }
            KeyCode::End => {
                if let Some(view) = self.selected_subagent_view_mut() {
                    view.scroll_offset = 0;
                    self.frame_requester.schedule_frame();
                }
            }
            KeyCode::Backspace
            | KeyCode::Enter
            | KeyCode::Left
            | KeyCode::Right
            | KeyCode::Char(_)
            | KeyCode::F(_)
            | KeyCode::Tab
            | KeyCode::BackTab
            | KeyCode::Delete
            | KeyCode::Insert
            | KeyCode::Null
            | KeyCode::CapsLock
            | KeyCode::ScrollLock
            | KeyCode::NumLock
            | KeyCode::PrintScreen
            | KeyCode::Pause
            | KeyCode::Menu
            | KeyCode::KeypadBegin
            | KeyCode::Media(_)
            | KeyCode::Modifier(_) => {}
        }
    }

    pub(super) fn render_subagent_monitor_if_open(&self, area: Rect, buf: &mut Buffer) -> bool {
        if !self.subagent_monitor.open {
            return false;
        }
        let [agent_area, transcript_area] =
            Layout::horizontal([Constraint::Length(30), Constraint::Min(1)]).areas(area);
        self.render_subagent_agent_list(agent_area, buf);
        self.render_selected_subagent_transcript(transcript_area, buf);
        true
    }

    pub(crate) fn on_subagents_listed(&mut self, agents: Vec<SubagentMonitorAgent>, open: bool) {
        for agent in agents {
            self.upsert_subagent(agent, /*auto_open*/ false);
        }
        if open {
            self.subagent_monitor.open = true;
            if self.subagent_monitor.selected.is_none() {
                self.select_newest_subagent();
            }
            self.set_status_message("Sub-agent monitor");
        }
        self.frame_requester.schedule_frame();
    }

    pub(crate) fn on_subagent_discovered(&mut self, agent: SubagentMonitorAgent, auto_open: bool) {
        self.upsert_subagent(agent, auto_open);
        self.frame_requester.schedule_frame();
    }

    pub(crate) fn on_subagent_monitor_event(&mut self, event: SubagentMonitorEvent) {
        let session_id = event.session_id();
        let view = self
            .subagent_monitor
            .sessions
            .entry(session_id)
            .or_default();
        view.apply_event(event);
        if self.subagent_monitor.selected == Some(session_id) {
            view.scroll_offset = 0;
        }
        self.frame_requester.schedule_frame();
    }

    pub(crate) fn reset_subagent_monitor(&mut self) {
        self.subagent_monitor = SubagentMonitorState::default();
    }

    #[cfg(test)]
    pub(crate) fn is_subagent_monitor_open_for_test(&self) -> bool {
        self.subagent_monitor.open
    }

    #[cfg(test)]
    pub(crate) fn selected_subagent_for_test(&self) -> Option<SessionId> {
        self.subagent_monitor.selected
    }

    fn upsert_subagent(&mut self, agent: SubagentMonitorAgent, auto_open: bool) {
        let session_id = agent.session_id;
        if let Some(existing) = self
            .subagent_monitor
            .agents
            .iter_mut()
            .find(|existing| existing.session_id == session_id)
        {
            *existing = agent.clone();
        } else {
            self.subagent_monitor.agents.push(agent.clone());
        }
        let view = self
            .subagent_monitor
            .sessions
            .entry(session_id)
            .or_default();
        view.status = agent.status.clone();
        view.agent = Some(agent);
        if auto_open {
            self.subagent_monitor.open = true;
            if !self.subagent_monitor.user_selected {
                self.subagent_monitor.selected = Some(session_id);
            }
            self.set_status_message("Sub-agent monitor");
        }
    }

    fn select_newest_subagent(&mut self) {
        self.subagent_monitor.selected = self
            .subagent_monitor
            .agents
            .last()
            .map(|agent| agent.session_id);
    }

    fn select_relative_subagent(&mut self, delta: isize) {
        let len = self.subagent_monitor.agents.len();
        if len == 0 {
            return;
        }
        let current = self
            .subagent_monitor
            .selected
            .and_then(|selected| {
                self.subagent_monitor
                    .agents
                    .iter()
                    .position(|agent| agent.session_id == selected)
            })
            .unwrap_or(0);
        let next = if delta.is_negative() {
            current.saturating_sub(delta.unsigned_abs())
        } else {
            current
                .saturating_add(delta as usize)
                .min(len.saturating_sub(1))
        };
        self.subagent_monitor.selected = Some(self.subagent_monitor.agents[next].session_id);
        self.subagent_monitor.user_selected = true;
        self.frame_requester.schedule_frame();
    }

    fn adjust_selected_subagent_scroll(&mut self, delta: isize) {
        if let Some(view) = self.selected_subagent_view_mut() {
            if delta.is_negative() {
                view.scroll_offset = view.scroll_offset.saturating_sub(delta.unsigned_abs());
            } else {
                view.scroll_offset = view.scroll_offset.saturating_add(delta as usize);
            }
            self.frame_requester.schedule_frame();
        }
    }

    fn selected_subagent_view_mut(&mut self) -> Option<&mut SubagentSessionView> {
        let selected = self.subagent_monitor.selected?;
        self.subagent_monitor.sessions.get_mut(&selected)
    }

    fn render_subagent_agent_list(&self, area: Rect, buf: &mut Buffer) {
        let mut lines = vec![
            Line::from("Sub-agents".bold()),
            Line::from("Up/Down select  q close".dim()),
            Line::from(""),
        ];
        if self.subagent_monitor.agents.is_empty() {
            lines.push(Line::from("No sub-agents for this session.".dim()));
        } else {
            for agent in &self.subagent_monitor.agents {
                let selected = self.subagent_monitor.selected == Some(agent.session_id);
                let marker = if selected { ">" } else { " " };
                let label = format!("{marker} {} [{}]", agent.nickname, agent.status);
                lines.push(if selected {
                    Line::from(label).bold()
                } else {
                    Line::from(label)
                });
                lines.push(Line::from(format!("  {}", agent.agent_path)).dim());
            }
        }
        Paragraph::new(Text::from(lines))
            .block(Block::default().title("Agents"))
            .wrap(Wrap { trim: false })
            .render(area, buf);
    }

    fn render_selected_subagent_transcript(&self, area: Rect, buf: &mut Buffer) {
        let Some(selected) = self.subagent_monitor.selected else {
            Paragraph::new("Select a sub-agent.")
                .block(Block::default().title("Activity"))
                .render(area, buf);
            return;
        };
        let Some(view) = self.subagent_monitor.sessions.get(&selected) else {
            Paragraph::new("No activity yet.")
                .block(Block::default().title("Activity"))
                .render(area, buf);
            return;
        };
        let title = view
            .agent
            .as_ref()
            .map(|agent| format!("{} - {}", agent.nickname, view.status))
            .unwrap_or_else(|| format!("{selected} - {}", view.status));
        let mut lines = view.render_lines();
        if lines.is_empty() {
            lines.push(Line::from("Waiting for sub-agent activity...".dim()));
        }
        let visible_height = area.height.saturating_sub(2) as usize;
        let max_scroll = lines.len().saturating_sub(visible_height.max(1));
        let scroll_offset = view.scroll_offset.min(max_scroll);
        let start = lines
            .len()
            .saturating_sub(visible_height.saturating_add(scroll_offset));
        let end = lines.len().saturating_sub(scroll_offset);
        let visible = lines
            .into_iter()
            .skip(start)
            .take(end.saturating_sub(start))
            .collect::<Vec<_>>();
        Paragraph::new(Text::from(visible))
            .block(Block::default().title(title))
            .wrap(Wrap { trim: false })
            .render(area, buf);
    }
}

impl SubagentSessionView {
    fn apply_event(&mut self, event: SubagentMonitorEvent) {
        match event {
            SubagentMonitorEvent::TurnStarted {
                session_id: _,
                turn_id,
            } => {
                self.status = "running".to_string();
                self.active_turn = Some(turn_id);
                self.transcript.push(MonitorTranscriptItem {
                    title: "Turn started".to_string(),
                    body: String::new(),
                    is_error: false,
                });
            }
            SubagentMonitorEvent::TextItemStarted {
                session_id: _,
                item_id,
                kind,
            } => {
                self.active_text.insert(
                    text_key(Some(item_id), kind),
                    MonitorTextItem {
                        kind,
                        text: String::new(),
                    },
                );
            }
            SubagentMonitorEvent::TextItemDelta {
                session_id: _,
                item_id,
                kind,
                delta,
            } => {
                self.active_text
                    .entry(text_key(item_id, kind))
                    .or_insert_with(|| MonitorTextItem {
                        kind,
                        text: String::new(),
                    })
                    .text
                    .push_str(&delta);
            }
            SubagentMonitorEvent::TextItemCompleted {
                session_id: _,
                item_id,
                kind,
                final_text,
            } => {
                self.active_text.remove(&text_key(item_id, kind));
                self.transcript.push(MonitorTranscriptItem {
                    title: text_title(kind).to_string(),
                    body: final_text,
                    is_error: false,
                });
            }
            SubagentMonitorEvent::ToolCall {
                session_id: _,
                tool_use_id,
                summary,
            }
            | SubagentMonitorEvent::ToolCallUpdated {
                session_id: _,
                tool_use_id,
                summary,
            } => {
                self.active_tools
                    .entry(tool_use_id)
                    .and_modify(|tool| tool.title = summary.clone())
                    .or_insert(MonitorToolItem {
                        title: summary,
                        output: String::new(),
                        is_error: false,
                    });
            }
            SubagentMonitorEvent::ToolOutputDelta {
                session_id: _,
                tool_use_id,
                delta,
            } => {
                self.active_tools
                    .entry(tool_use_id)
                    .or_insert(MonitorToolItem {
                        title: "tool".to_string(),
                        output: String::new(),
                        is_error: false,
                    })
                    .output
                    .push_str(&delta);
            }
            SubagentMonitorEvent::ToolResult {
                session_id: _,
                tool_use_id,
                title,
                preview,
                is_error,
            } => {
                self.active_tools.remove(&tool_use_id);
                self.transcript.push(MonitorTranscriptItem {
                    title,
                    body: preview,
                    is_error,
                });
            }
            SubagentMonitorEvent::PlanUpdated {
                session_id: _,
                explanation,
                steps,
            } => {
                let mut body = explanation.unwrap_or_default();
                for step in steps {
                    if !body.is_empty() {
                        body.push('\n');
                    }
                    body.push_str(match step.status {
                        PlanStepStatus::Pending => "[ ] ",
                        PlanStepStatus::InProgress => "[~] ",
                        PlanStepStatus::Completed => "[x] ",
                        PlanStepStatus::Cancelled => "[-] ",
                    });
                    body.push_str(&step.text);
                }
                self.transcript.push(MonitorTranscriptItem {
                    title: "Plan updated".to_string(),
                    body,
                    is_error: false,
                });
            }
            SubagentMonitorEvent::TurnFinished {
                session_id: _,
                status,
            } => {
                self.status = status.clone();
                self.active_turn = None;
                self.flush_active_items();
                self.transcript.push(MonitorTranscriptItem {
                    title: format!("Turn {status}"),
                    body: String::new(),
                    is_error: status.to_lowercase().contains("failed"),
                });
            }
            SubagentMonitorEvent::TurnFailed {
                session_id: _,
                message,
            } => {
                self.status = "failed".to_string();
                self.active_turn = None;
                self.flush_active_items();
                self.transcript.push(MonitorTranscriptItem {
                    title: "Turn failed".to_string(),
                    body: message,
                    is_error: true,
                });
            }
            SubagentMonitorEvent::SessionStatusChanged {
                session_id: _,
                status,
            } => {
                self.status = format!("{status:?}").to_lowercase();
            }
        }
    }

    fn render_lines(&self) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        for item in &self.transcript {
            lines.push(if item.is_error {
                Line::from(item.title.clone()).red()
            } else {
                Line::from(item.title.clone()).bold()
            });
            lines.extend(body_lines(&item.body));
            lines.push(Line::from(""));
        }
        for text in self.active_text.values() {
            lines.push(Line::from(format!("{} streaming", text_title(text.kind))).bold());
            lines.extend(body_lines(&text.text));
            lines.push(Line::from(""));
        }
        for tool in self.active_tools.values() {
            lines.push(Line::from(vec![
                Span::raw("Running "),
                Span::styled(tool.title.clone(), Style::default().bold()),
            ]));
            lines.extend(body_lines(&tool.output));
            lines.push(Line::from(""));
        }
        lines
    }

    fn flush_active_items(&mut self) {
        for text in self.active_text.drain().map(|(_, text)| text) {
            if !text.text.trim().is_empty() {
                self.transcript.push(MonitorTranscriptItem {
                    title: text_title(text.kind).to_string(),
                    body: text.text,
                    is_error: false,
                });
            }
        }
        for tool in self.active_tools.drain().map(|(_, tool)| tool) {
            self.transcript.push(MonitorTranscriptItem {
                title: tool.title,
                body: tool.output,
                is_error: tool.is_error,
            });
        }
    }
}

impl SubagentMonitorEvent {
    fn session_id(&self) -> SessionId {
        match self {
            Self::TurnStarted { session_id, .. }
            | Self::TextItemStarted { session_id, .. }
            | Self::TextItemDelta { session_id, .. }
            | Self::TextItemCompleted { session_id, .. }
            | Self::ToolCall { session_id, .. }
            | Self::ToolCallUpdated { session_id, .. }
            | Self::ToolOutputDelta { session_id, .. }
            | Self::ToolResult { session_id, .. }
            | Self::PlanUpdated { session_id, .. }
            | Self::TurnFinished { session_id, .. }
            | Self::TurnFailed { session_id, .. }
            | Self::SessionStatusChanged { session_id, .. } => *session_id,
        }
    }
}

fn text_key(item_id: Option<ItemId>, kind: TextItemKind) -> String {
    item_id
        .map(|item_id| item_id.to_string())
        .unwrap_or_else(|| format!("legacy-{kind:?}"))
}

fn text_title(kind: TextItemKind) -> &'static str {
    match kind {
        TextItemKind::Assistant => "Assistant",
        TextItemKind::Reasoning => "Reasoning",
    }
}

fn body_lines(body: &str) -> Vec<Line<'static>> {
    body.lines()
        .map(|line| Line::from(format!("  {line}")))
        .collect()
}
