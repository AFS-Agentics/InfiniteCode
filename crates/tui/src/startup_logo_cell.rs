//! Startup logo transcript cell used before first-run inline onboarding.

use ratatui::style::Color;
use ratatui::text::Line;

use crate::history_cell::HistoryCell;
use crate::startup_header::build_devo_logo_intro;

#[derive(Debug)]
pub(crate) struct StartupLogoCell {
    accent_color: Color,
}

impl StartupLogoCell {
    pub(crate) fn new(accent_color: Color) -> Self {
        Self { accent_color }
    }
}

impl HistoryCell for StartupLogoCell {
    fn display_lines(&self, width: u16) -> Vec<Line<'static>> {
        build_devo_logo_intro(width, self.accent_color)
    }
}
