use ansi_to_tui::Error;
use ansi_to_tui::IntoText;
use ratatui::text::Line;
use ratatui::text::Text;

// Expand tabs in a best-effort way for transcript rendering.
// Tabs can interact poorly with left-gutter prefixes in our TUI and CLI
// transcript views (e.g., `nl` separates line numbers from content with a tab).
// Replacing tabs with spaces avoids odd visual artifacts without changing
// semantics for our use cases.
fn expand_tabs(s: &str) -> std::borrow::Cow<'_, str> {
    if s.contains('\t') {
        // Keep it simple: replace each tab with 4 spaces.
        // We do not try to align to tab stops since most usages (like `nl`)
        // look acceptable with a fixed substitution and this avoids stateful math
        // across spans.
        std::borrow::Cow::Owned(s.replace('\t', "    "))
    } else {
        std::borrow::Cow::Borrowed(s)
    }
}

/// This function should be used when the contents of `s` are expected to match
/// a single line. If multiple lines are found, a warning is logged and only the
/// first line is returned.
pub fn ansi_escape_line(s: &str) -> Line<'static> {
    if !s
        .as_bytes()
        .iter()
        .any(|byte| matches!(byte, b'\x1b' | b'\n'))
    {
        return Line::from(expand_tabs(s).into_owned());
    }

    // Normalize tabs to spaces to avoid odd gutter collisions in transcript mode.
    let s = expand_tabs(s);
    let text = ansi_escape(&s);
    match text.lines.as_slice() {
        [] => "".into(),
        [only] => only.clone(),
        [first, rest @ ..] => {
            tracing::warn!("ansi_escape_line: expected a single line, got {first:?} and {rest:?}");
            first.clone()
        }
    }
}

pub fn ansi_escape(s: &str) -> Text<'static> {
    // to_text() claims to be faster, but introduces complex lifetime issues
    // such that it's not worth it.
    match s.into_text() {
        Ok(text) => text,
        Err(err) => match err {
            Error::NomError(message) => {
                tracing::error!(
                    "ansi_to_tui NomError docs claim should never happen when parsing `{s}`: {message}"
                );
                panic!();
            }
            Error::Utf8Error(utf8error) => {
                tracing::error!("Utf8Error: {utf8error}");
                panic!();
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use std::hint::black_box;
    use std::time::Instant;

    use pretty_assertions::assert_eq;
    use ratatui::style::Color;
    use ratatui::style::Style;
    use ratatui::text::Span;

    use super::*;

    #[test]
    fn ansi_escape_line_preserves_plain_text() {
        assert_eq!(
            ansi_escape_line("plain tool output"),
            Line::from("plain tool output")
        );
    }

    #[test]
    fn ansi_escape_line_expands_tabs() {
        assert_eq!(ansi_escape_line("line\tvalue"), Line::from("line    value"));
    }

    #[test]
    fn ansi_escape_line_preserves_ansi_style() {
        assert_eq!(
            ansi_escape_line("\u{1b}[31mred\u{1b}[0m"),
            Line::from(vec![Span::styled("red", Style::default().fg(Color::Red))])
        );
    }

    #[test]
    fn ansi_escape_line_expands_tabs_after_ansi_sequence() {
        assert_eq!(
            ansi_escape_line("\u{1b}[31mred\tvalue\u{1b}[0m"),
            Line::from(vec![Span::styled(
                "red    value",
                Style::default().fg(Color::Red)
            )])
        );
    }

    #[test]
    #[ignore]
    fn bench_ansi_escape_line_plain_tool_output() {
        let text = "line 4242: plain command output payload without ansi escapes";
        let iterations = 200_000;
        let expected_len = ansi_escape_line(text).width();
        let started = Instant::now();
        let mut total_len = 0usize;

        for _ in 0..iterations {
            total_len += black_box(ansi_escape_line(black_box(text))).width();
        }

        let elapsed = started.elapsed();
        assert_eq!(total_len, expected_len * iterations);
        println!(
            "ansi_escape_line_plain_tool_output iterations={iterations} bytes={} elapsed_ms={} per_call_us={:.2}",
            text.len(),
            elapsed.as_secs_f64() * 1_000.0,
            elapsed.as_secs_f64() * 1_000_000.0 / iterations as f64
        );
    }

    #[test]
    #[ignore]
    fn bench_ansi_escape_line_with_ansi_style() {
        let text = "\u{1b}[32mline 4242:\u{1b}[0m styled command output";
        let iterations = 100_000;
        let expected_len = ansi_escape_line(text).width();
        let started = Instant::now();
        let mut total_len = 0usize;

        for _ in 0..iterations {
            total_len += black_box(ansi_escape_line(black_box(text))).width();
        }

        let elapsed = started.elapsed();
        assert_eq!(total_len, expected_len * iterations);
        println!(
            "ansi_escape_line_with_ansi_style iterations={iterations} bytes={} elapsed_ms={} per_call_us={:.2}",
            text.len(),
            elapsed.as_secs_f64() * 1_000.0,
            elapsed.as_secs_f64() * 1_000_000.0 / iterations as f64
        );
    }
}
