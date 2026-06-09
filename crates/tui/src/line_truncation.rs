use ratatui::text::Line;
use ratatui::text::Span;
use unicode_width::UnicodeWidthChar;
use unicode_width::UnicodeWidthStr;

pub(crate) fn line_width(line: &Line<'_>) -> usize {
    line.iter()
        .map(|span| text_width(span.content.as_ref()))
        .sum()
}

pub(crate) fn truncate_line_to_width(line: Line<'static>, max_width: usize) -> Line<'static> {
    if max_width == 0 {
        return Line::from(Vec::<Span<'static>>::new());
    }

    let Line {
        style,
        alignment,
        spans,
    } = line;
    let mut used = 0usize;
    let mut spans_out: Vec<Span<'static>> = Vec::with_capacity(spans.len().min(max_width));

    for span in spans {
        let span_width = text_width(span.content.as_ref());

        if span_width == 0 {
            spans_out.push(span);
            continue;
        }

        if used >= max_width {
            break;
        }

        if used + span_width <= max_width {
            used += span_width;
            spans_out.push(span);
            continue;
        }

        let style = span.style;
        let text = span.content.as_ref();
        if is_single_width_ascii(text) {
            let take = max_width.saturating_sub(used).min(text.len());
            if take > 0 {
                spans_out.push(Span::styled(text[..take].to_string(), style));
            }
        } else {
            let mut end_idx = 0usize;
            for (idx, ch) in text.char_indices() {
                let ch_width = UnicodeWidthChar::width(ch).unwrap_or(0);
                if used + ch_width > max_width {
                    break;
                }
                end_idx = idx + ch.len_utf8();
                used += ch_width;
            }

            if end_idx > 0 {
                spans_out.push(Span::styled(text[..end_idx].to_string(), style));
            }
        }

        break;
    }

    Line {
        style,
        alignment,
        spans: spans_out,
    }
}

fn text_width(text: &str) -> usize {
    if is_single_width_ascii(text) {
        text.len()
    } else {
        UnicodeWidthStr::width(text)
    }
}

fn is_single_width_ascii(text: &str) -> bool {
    text.bytes()
        .all(|byte| byte == b' ' || byte.is_ascii_graphic())
}

/// Truncate a styled line to `max_width` and append an ellipsis on overflow.
///
/// Intended for short UI rows. This preserves a fast no-overflow path (width
/// pre-scan + return original line unchanged) and uses `truncate_line_to_width`
/// for the overflow case.
/// Performance should be reevaluated if using this method in loops/over larger content in the future.
pub(crate) fn truncate_line_with_ellipsis_if_overflow(
    line: Line<'static>,
    max_width: usize,
) -> Line<'static> {
    if max_width == 0 {
        return Line::from(Vec::<Span<'static>>::new());
    }

    let mut width = 0usize;
    let mut overflows = false;
    for span in line.iter() {
        width = width.saturating_add(text_width(span.content.as_ref()));
        if width > max_width {
            overflows = true;
            break;
        }
    }

    if !overflows {
        return line;
    }

    let truncated = truncate_line_to_width(line, max_width.saturating_sub(1));
    let Line {
        style,
        alignment,
        mut spans,
    } = truncated;
    let ellipsis_style = spans.last().map(|span| span.style).unwrap_or_default();
    spans.push(Span::styled("…", ellipsis_style));
    Line {
        style,
        alignment,
        spans,
    }
}

#[cfg(test)]
mod tests {
    use std::hint::black_box;
    use std::time::Instant;

    use pretty_assertions::assert_eq;
    use ratatui::style::Style;

    use super::*;

    fn styled_line(span_count: usize, span_text: &str) -> Line<'static> {
        Line::from(
            (0..span_count)
                .map(|index| {
                    Span::styled(
                        format!("{span_text}{index:04}"),
                        Style::default().fg(ratatui::style::Color::Blue),
                    )
                })
                .collect::<Vec<_>>(),
        )
    }

    #[test]
    fn truncate_line_with_ellipsis_keeps_no_overflow_line() {
        let line = Line::from(vec![Span::raw("short"), Span::raw(" row")]);
        let truncated = truncate_line_with_ellipsis_if_overflow(line.clone(), 16);
        assert_eq!(truncated, line);
    }

    #[test]
    fn truncate_line_with_ellipsis_truncates_overflow_line() {
        let line = Line::from(vec![Span::raw("abcdef"), Span::raw("ghijkl")]);
        let truncated = truncate_line_with_ellipsis_if_overflow(line, 8);
        assert_eq!(line_width(&truncated), 8);
        assert_eq!(
            truncated,
            Line::from(vec![Span::raw("abcdef"), Span::raw("g"), Span::raw("…")])
        );
    }

    #[test]
    fn line_width_preserves_control_character_width() {
        let line = Line::from(vec![Span::raw("a\tb")]);
        assert_eq!(line_width(&line), UnicodeWidthStr::width("a\tb"));
    }

    #[test]
    fn truncate_line_with_ellipsis_preserves_wide_character_width() {
        let line = Line::from(vec![Span::raw("你a好")]);
        let truncated = truncate_line_with_ellipsis_if_overflow(line, 4);

        assert_eq!(
            truncated,
            Line::from(vec![Span::raw("你a"), Span::raw("…")])
        );
        assert_eq!(line_width(&truncated), 4);
    }

    #[test]
    #[ignore]
    fn bench_truncate_line_with_ellipsis_overflow_many_spans() {
        let template = styled_line(1_000, "abcdefghij");

        let started = Instant::now();
        let mut total_width = 0;
        for _ in 0..5_000 {
            let truncated =
                truncate_line_with_ellipsis_if_overflow(black_box(template.clone()), black_box(80));
            total_width += black_box(line_width(&truncated));
        }
        let elapsed = started.elapsed();

        assert_eq!(total_width, 400_000);
        println!(
            "truncate_line_with_ellipsis_overflow_many_spans iterations=5000 spans=1000 max_width=80 elapsed_ms={} per_call_us={:.2}",
            elapsed.as_secs_f64() * 1_000.0,
            elapsed.as_secs_f64() * 1_000_000.0 / 5_000.0
        );
    }

    #[test]
    #[ignore]
    fn bench_truncate_line_with_ellipsis_no_overflow() {
        let template = styled_line(4, "abc");

        let started = Instant::now();
        let mut total_width = 0;
        for _ in 0..200_000 {
            let truncated =
                truncate_line_with_ellipsis_if_overflow(black_box(template.clone()), black_box(80));
            total_width += black_box(line_width(&truncated));
        }
        let elapsed = started.elapsed();

        assert_eq!(total_width, 5_600_000);
        println!(
            "truncate_line_with_ellipsis_no_overflow iterations=200000 spans=4 max_width=80 elapsed_ms={} per_call_us={:.2}",
            elapsed.as_secs_f64() * 1_000.0,
            elapsed.as_secs_f64() * 1_000_000.0 / 200_000.0
        );
    }
}
