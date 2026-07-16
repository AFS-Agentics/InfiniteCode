use std::path::Path;
use std::time::Duration;

use ratatui::style::Color;
use ratatui::style::Style;
use ratatui::style::Stylize;
use ratatui::text::Line;
use ratatui::text::Span;
use unicode_width::UnicodeWidthChar;
use unicode_width::UnicodeWidthStr;

use crate::exec_command::relativize_to_home;

pub(crate) const STARTUP_HEADER_ANIMATION_INTERVAL: Duration = Duration::from_millis(400);

const STARTUP_HEADER_MAX_TOTAL_WIDTH: usize = 62;
const STARTUP_HEADER_MIN_FULL_WIDTH: usize = 44;
const DIRECTORY_LABEL: &str = "Workspace  ";
const INFINITECODE_LOGO: [&str; 5] = [
    " ___ _   _ _____ ___ _   _ ___ _____ _____ ",
    "|_ _| \\ | |  ___|_ _| \\ | |_ _|_   _| ____|",
    " | ||  \\| | |_   | ||  \\| || |  | | |  _|  ",
    " | || |\\  |  _|  | || |\\  || |  | | | |___ ",
    "|___|_| \\_|_|   |___|_| \\_|___| |_| |_____|",
];

pub(crate) struct StartupHeaderData<'a> {
    pub(crate) version: &'static str,
    pub(crate) model: &'a str,
    pub(crate) reasoning: &'a str,
    pub(crate) directory: &'a Path,
    pub(crate) accent_color: Color,
    pub(crate) mascot_frame_index: usize,
}

pub(crate) fn build_startup_header(data: StartupHeaderData<'_>, width: u16) -> Vec<Line<'static>> {
    let available_width = usize::from(width);
    if available_width < 4 {
        return Vec::new();
    }

    let total_width = available_width.min(STARTUP_HEADER_MAX_TOTAL_WIDTH);
    let inner_width = total_width.saturating_sub(2);
    if inner_width == 0 {
        return Vec::new();
    }

    if total_width < STARTUP_HEADER_MIN_FULL_WIDTH {
        build_compact_header(data, inner_width)
    } else {
        build_full_header(data, inner_width)
    }
}

pub(crate) fn build_infinitecode_logo_intro(width: u16, accent_color: Color) -> Vec<Line<'static>> {
    let available_width = usize::from(width);
    if available_width == 0 {
        return Vec::new();
    }
    if available_width < STARTUP_HEADER_MIN_FULL_WIDTH {
        return vec![Line::from(Span::styled(
            truncate_right("InfiniteCode", available_width),
            Style::default().fg(accent_color).bold(),
        ))];
    }

    let logo_style = Style::default().fg(accent_color).bold();
    INFINITECODE_LOGO
        .iter()
        .map(|logo_line| {
            Line::from(Span::styled(
                truncate_right(logo_line, available_width),
                logo_style,
            ))
        })
        .collect()
}

fn build_full_header(data: StartupHeaderData<'_>, inner_width: usize) -> Vec<Line<'static>> {
    let border_style = Style::default().dim();
    let muted_style = Style::default().dim();
    let logo_style = Style::default().fg(data.accent_color).bold();
    let version = format!("v{}", data.version);
    let mut lines = Vec::with_capacity(10);

    lines.push(border_line('┏', '━', '┓', inner_width, border_style));
    for (idx, logo_line) in INFINITECODE_LOGO.iter().enumerate() {
        lines.push(content_line(
            build_logo_row(
                logo_line,
                (idx == 2).then_some(version.as_str()),
                inner_width,
                logo_style,
                muted_style,
            ),
            inner_width,
            border_style,
        ));
    }
    lines.push(border_line('┣', '━', '┫', inner_width, border_style));
    lines.push(content_line(
        build_directory_row(data.directory, inner_width, muted_style),
        inner_width,
        border_style,
    ));
    lines.push(border_line('┗', '━', '┛', inner_width, border_style));
    lines
}

fn build_compact_header(data: StartupHeaderData<'_>, inner_width: usize) -> Vec<Line<'static>> {
    let border_style = Style::default().dim();
    let muted_style = Style::default().dim();
    let accent_style = Style::default().fg(data.accent_color).bold();
    let version = format!("v{}", data.version);

    let title = truncate_right(&format!("InfiniteCode {version}"), inner_width);

    vec![
        border_line('┏', '━', '┓', inner_width, border_style),
        content_line(
            vec![
                Span::styled(title, accent_style),
                Span::styled(String::new(), Style::default()),
            ],
            inner_width,
            border_style,
        ),
        border_line('┣', '━', '┫', inner_width, border_style),
        content_line(
            build_directory_row(data.directory, inner_width, muted_style),
            inner_width,
            border_style,
        ),
        border_line('┗', '━', '┛', inner_width, border_style),
    ]
}

fn build_logo_row(
    logo_line: &str,
    version: Option<&str>,
    inner_width: usize,
    logo_style: Style,
    version_style: Style,
) -> Vec<Span<'static>> {
    let logo = truncate_right(logo_line, inner_width);
    let logo_width = UnicodeWidthStr::width(logo.as_str());
    let mut spans = vec![Span::styled(logo, logo_style)];

    if let Some(version) = version {
        let version_width = UnicodeWidthStr::width(version);
        if inner_width > logo_width + version_width {
            push_spaces(&mut spans, inner_width - logo_width - version_width);
            spans.push(Span::styled(version.to_string(), version_style));
        }
    }

    spans
}

fn build_directory_row(
    directory: &Path,
    inner_width: usize,
    label_style: Style,
) -> Vec<Span<'static>> {
    let available_path_width = inner_width.saturating_sub(UnicodeWidthStr::width(DIRECTORY_LABEL));
    let path = format_directory(directory, available_path_width);
    vec![
        Span::styled(DIRECTORY_LABEL.to_string(), label_style),
        Span::from(path),
    ]
}

fn format_directory(directory: &Path, max_width: usize) -> String {
    if max_width == 0 {
        return String::new();
    }

    let formatted = if let Some(relative) = relativize_to_home(directory) {
        if relative.as_os_str().is_empty() {
            "~".to_string()
        } else {
            format!("~{}{}", std::path::MAIN_SEPARATOR, relative.display())
        }
    } else {
        directory.display().to_string()
    };

    truncate_left(&formatted, max_width)
}

fn border_line(
    left: char,
    horizontal: char,
    right: char,
    inner_width: usize,
    style: Style,
) -> Line<'static> {
    Line::from(Span::styled(
        format!(
            "{left}{}{right}",
            horizontal.to_string().repeat(inner_width)
        ),
        style,
    ))
}

fn content_line(
    spans: Vec<Span<'static>>,
    inner_width: usize,
    border_style: Style,
) -> Line<'static> {
    let used_width = spans_width(&spans);
    let mut row = Vec::with_capacity(spans.len() + 3);
    row.push(Span::styled("┃".to_string(), border_style));
    row.extend(spans);
    if used_width < inner_width {
        row.push(Span::from(" ".repeat(inner_width - used_width)));
    }
    row.push(Span::styled("┃".to_string(), border_style));
    Line::from(row)
}

fn spans_width(spans: &[Span<'_>]) -> usize {
    spans
        .iter()
        .map(|span| UnicodeWidthStr::width(span.content.as_ref()))
        .sum()
}

fn push_spaces(spans: &mut Vec<Span<'static>>, count: usize) {
    if count > 0 {
        spans.push(Span::from(" ".repeat(count)));
    }
}

fn truncate_right(text: &str, max_width: usize) -> String {
    truncate_text(text, max_width, TruncationSide::Right)
}

fn truncate_left(text: &str, max_width: usize) -> String {
    truncate_text(text, max_width, TruncationSide::Left)
}

enum TruncationSide {
    Left,
    Right,
}

fn truncate_text(text: &str, max_width: usize, side: TruncationSide) -> String {
    if max_width == 0 {
        return String::new();
    }
    if UnicodeWidthStr::width(text) <= max_width {
        return text.to_string();
    }
    if max_width == 1 {
        return "…".to_string();
    }

    let budget = max_width - 1;
    match side {
        TruncationSide::Right => {
            let mut out = String::new();
            let mut used = 0;
            for ch in text.chars() {
                let char_width = UnicodeWidthChar::width(ch).unwrap_or(0);
                if used + char_width > budget {
                    break;
                }
                out.push(ch);
                used += char_width;
            }
            out.push('…');
            out
        }
        TruncationSide::Left => {
            let mut kept = Vec::new();
            let mut used = 0;
            for ch in text.chars().rev() {
                let char_width = UnicodeWidthChar::width(ch).unwrap_or(0);
                if used + char_width > budget {
                    break;
                }
                kept.push(ch);
                used += char_width;
            }
            kept.reverse();
            let tail = kept.into_iter().collect::<String>();
            format!("…{tail}")
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use pretty_assertions::assert_eq;
    use ratatui::style::Color;
    use unicode_width::UnicodeWidthStr;

    use super::StartupHeaderData;
    use super::build_startup_header;

    fn rendered_strings(width: u16, model: &str, reasoning: &str, directory: &Path) -> Vec<String> {
        build_startup_header(
            StartupHeaderData {
                version: "0.1.3",
                model,
                reasoning,
                directory,
                accent_color: Color::Cyan,
                mascot_frame_index: 0,
            },
            width,
        )
        .into_iter()
        .map(|line| {
            line.spans
                .into_iter()
                .map(|span| span.content.into_owned())
                .collect::<String>()
        })
        .collect()
    }

    #[test]
    fn full_header_renders_at_wide_widths() {
        let rows = rendered_strings(
            80,
            "gpt-5-high",
            "medium",
            Path::new("/Users/tester/Desktop/infinitecode"),
        );
        assert_eq!(9, rows.len());
        assert!(rows[0].starts_with('┏'));
        assert!(rows[2].contains("|_ _|"));
        // v0.1.3 version appears on the 3rd logo line (idx==2), which is rows[3]
        assert!(rows[3].contains("v0.1.3") || rows[3].contains("0.1.3"));
        // v0.1.3 version appears on the middle line (index 2 with 5 rows)
        assert!(rows[2].contains("v0.1.3") || rows[2].contains("0.1.3"));
        assert!(rows[7].contains("Workspace"));
        let rendered = rows.join("\n");
        assert!(!rendered.contains("Model"));
        assert!(!rendered.contains("Reasoning"));
    }

    #[test]
    fn compact_header_renders_at_narrow_widths() {
        let rows = rendered_strings(
            40,
            "gpt-5-high",
            "medium",
            Path::new("/Users/tester/Desktop/infinitecode"),
        );
        assert_eq!(5, rows.len());
        assert!(rows[1].contains("InfiniteCode v0.1.3"));
        assert!(rows[3].contains('/'));
    }

    #[test]
    fn very_long_model_and_directory_are_truncated_without_overflow() {
        let rows = rendered_strings(
            60,
            "gpt-5-ultra-long-model-name-with-many-suffixes",
            "medium",
            Path::new("/Users/tester/Desktop/projects/infinitecode/some/really/long/path"),
        );
        assert!(rows[7].contains('…'));
        assert!(rows[7].contains("long/path"));
        assert!(
            rows.iter()
                .all(|row| UnicodeWidthStr::width(row.as_str()) <= 60)
        );
    }

    #[test]
    fn windows_paths_are_supported() {
        let rows = rendered_strings(
            60,
            "gpt-5-high",
            "",
            Path::new(r"C:\Users\tester\Desktop\infinitecode\long\workspace"),
        );
        assert!(rows[7].contains("workspace"));
        assert!(
            rows.iter()
                .all(|row| UnicodeWidthStr::width(row.as_str()) <= 60)
        );
    }

    #[test]
    fn header_handles_requested_validation_widths() {
        for width in [120_u16, 80, 60, 40] {
            let rows = rendered_strings(
                width,
                "gpt-5-high",
                "medium",
                Path::new("/Users/tester/Desktop/infinitecode"),
            );
            assert!(!rows.is_empty());
            assert!(
                rows.iter()
                    .all(|row| UnicodeWidthStr::width(row.as_str()) <= usize::from(width))
            );
        }
    }
}
