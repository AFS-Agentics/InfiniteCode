//! Render helper for the agent's `suggest_followups` tool calls.
//!
//! `history_cell.rs` is the canonical home for `HistoryCell` implementations but at 2012 lines it
//! exceeds the AI-edit ceiling. This module exports both the pure `Line`-style formatting helpers
//! and a small `SuggestFollowupsCell` that implements `HistoryCell` directly — so wiring in
//! `worker_events.rs` only needs `mod suggest_followups_render;` in `chatwidget.rs` plus a
//! dispatch arm in the `ToolResultIo` branch.
//!
//! Future work: stream the chips in as JSON deltas arrive (rather than waiting for the tool to
//! complete), so they fade in during the final assistant message.

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Paragraph, Wrap};

use crate::history_cell::HistoryCell;

/// Maximum chips we render (anything beyond the handler's cap is dropped).
const MAX_CHIPS: usize = 6;

/// One emoji chip row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FollowupItem {
    pub emoji: String,
    pub label: String,
    pub prompt: String,
}

/// Parse `input.followups` from a tool call's JSON input. Tolerant of shape
/// variation — drops anything that isn't an object with non-empty `label`
/// and `prompt`. Returns up to `MAX_CHIPS` items in input order.
pub fn parse_followups(input: &serde_json::Value) -> Vec<FollowupItem> {
    let Some(arr) = input.get("followups").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut out = Vec::with_capacity(arr.len().min(MAX_CHIPS));
    for item in arr.iter().take(MAX_CHIPS) {
        let Some(obj) = item.as_object() else {
            continue;
        };
        let Some(label) = obj.get("label").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(prompt) = obj.get("prompt").and_then(|v| v.as_str()) else {
            continue;
        };
        let emoji = obj
            .get("emoji")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("✨")
            .to_string();
        out.push(FollowupItem {
            emoji,
            label: label.to_string(),
            prompt: prompt.to_string(),
        });
    }
    out
}

/// Render followup chips as a block of ratatui `Line`s. Header is colored
/// (cyan + bold + gradient-like), `→` prefix in muted gray, and per-chip
/// `(prompt)` suffix in italic gray.
pub fn render_followup_lines(items: &[FollowupItem], _width: u16) -> Vec<Line<'static>> {
    if items.is_empty() {
        return Vec::new();
    }

    let mut lines: Vec<Line<'static>> = Vec::with_capacity(items.len() + 2);

    // Header — "✨ What's next?" in cyan bold; subtle italic prompt-count hint.
    lines.push(Line::from(vec![Span::styled(
        "✨  What's next?",
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
    )]));

    for item in items {
        let preview = abbreviate_prompt(&item.prompt, 40);
        lines.push(Line::from(vec![
            Span::styled("  → ", Style::default().fg(Color::DarkGray)),
            Span::styled(format!("{} ", item.emoji), Style::default()),
            Span::styled(
                item.label.clone(),
                Style::default().add_modifier(Modifier::BOLD),
            ),
            Span::raw("  "),
            Span::styled(
                format!("({preview})"),
                Style::default()
                    .fg(Color::DarkGray)
                    .add_modifier(Modifier::ITALIC),
            ),
        ]));
    }

    // Hint footer — users on the TUI can copy-paste the prompt above.
    lines.push(Line::from(vec![Span::styled(
        "     copy a prompt above and press Enter to send",
        Style::default().fg(Color::DarkGray),
    )]));

    lines
}

fn abbreviate_prompt(prompt: &str, max_chars: usize) -> String {
    let trimmed: String = prompt.chars().take(max_chars).collect();
    if prompt.chars().count() > max_chars {
        format!("{trimmed}…")
    } else {
        trimmed
    }
}

/// TUI `HistoryCell` adapter that renders an emoji chip block under the
/// assistant message when the agent emits a `suggest_followups` tool call.
///
/// Pushed into `ChatWidget` history once `WorkerEvent::ToolResultIo` carries
/// `tool_name == "suggest_followups"`. User copies any chip's prompt into
/// the composer to send as the next user turn.
#[derive(Debug)]
pub(crate) struct SuggestFollowupsCell {
    items: Vec<FollowupItem>,
}

impl SuggestFollowupsCell {
    pub fn new(items: Vec<FollowupItem>) -> Self {
        Self { items }
    }

    /// Snapshot of the parsed chip data; useful for tests and jest-style snapshots.
    pub fn items(&self) -> &[FollowupItem] {
        &self.items
    }
}

impl HistoryCell for SuggestFollowupsCell {
    fn display_lines(&self, width: u16) -> Vec<Line<'static>> {
        render_followup_lines(&self.items, width)
    }

    /// Match the `Paragraph`-measured default — keeps the cell from claiming zero rows when
    /// the chat viewport is narrower than the longest chip.
    fn desired_height(&self, width: u16) -> u16 {
        if self.items.is_empty() {
            return 0;
        }
        let lines = self.display_lines(width);
        if let [line] = &lines[..]
            && line
                .spans
                .iter()
                .all(|s| s.content.chars().all(char::is_whitespace))
        {
            return 1;
        }
        Paragraph::new(Text::from(lines))
            .wrap(Wrap { trim: false })
            .line_count(width)
            .try_into()
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[test]
    fn parse_followups_handles_valid_input() {
        let json = serde_json::json!({
            "followups": [
                {"emoji": "🚀", "label": "Ship it", "prompt": "commit and push"},
                {"emoji": "🧪", "label": "Test it", "prompt": "run the test suite"}
            ]
        });
        let result = parse_followups(&json);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].emoji, "🚀");
        assert_eq!(result[1].label, "Test it");
    }

    #[test]
    fn parse_followups_drops_invalid_items() {
        let json = serde_json::json!({
            "followups": [
                {"emoji": "🚀", "label": "ok", "prompt": "fine"},
                {"label": "no emoji"},
                null,
                42
            ]
        });
        let result = parse_followups(&json);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].emoji, "🚀");
    }

    #[test]
    fn parse_followups_caps_at_six() {
        let items: Vec<_> = (0..10)
            .map(|i| {
                serde_json::json!({
                    "emoji": "🚀",
                    "label": format!("item {i}"),
                    "prompt": format!("do thing {i}")
                })
            })
            .collect();
        let json = serde_json::json!({"followups": items});
        let result = parse_followups(&json);
        assert_eq!(result.len(), MAX_CHIPS);
    }

    #[test]
    fn parse_followups_returns_empty_when_missing() {
        let json = serde_json::json!({});
        assert!(parse_followups(&json).is_empty());
        let json = serde_json::json!({"followups": []});
        assert!(parse_followups(&json).is_empty());
    }

    #[test]
    fn render_followup_lines_emits_header_and_chip_rows() {
        let items = vec![
            FollowupItem {
                emoji: "🚀".into(),
                label: "Ship it".into(),
                prompt: "commit and push".into(),
            },
        ];
        let lines = render_followup_lines(&items, 80);
        // header + chip row + footer hint = 3 lines
        assert_eq!(lines.len(), 3);
        let header_text: String = lines[0]
            .spans
            .iter()
            .map(|s| s.content.as_ref())
            .collect();
        assert!(header_text.contains("What's next?"));
    }

    #[test]
    fn render_followup_lines_empty_returns_nothing() {
        assert!(render_followup_lines(&[], 80).is_empty());
    }

    #[test]
    fn suggest_followups_cell_new_copies_items() {
        let items = vec![FollowupItem {
            emoji: "⚡".into(),
            label: "Fix it".into(),
            prompt: "fix the failing test".into(),
        }];
        let cell = SuggestFollowupsCell::new(items.clone());
        assert_eq!(cell.items(), items.as_slice());
    }

    #[test]
    fn suggest_followups_cell_display_lines_match_helper() {
        let items = vec![
            FollowupItem {
                emoji: "🚀".into(),
                label: "Ship it".into(),
                prompt: "commit and push".into(),
            },
            FollowupItem {
                emoji: "🧪".into(),
                label: "Test it".into(),
                prompt: "run cargo test".into(),
            },
        ];
        let cell = SuggestFollowupsCell::new(items.clone());
        assert_eq!(cell.display_lines(80), render_followup_lines(&items, 80));
    }

    #[test]
    fn suggest_followups_cell_empty_has_zero_height() {
        let cell = SuggestFollowupsCell::new(Vec::new());
        assert!(cell.display_lines(80).is_empty());
        assert_eq!(cell.desired_height(80), 0);
    }
}
