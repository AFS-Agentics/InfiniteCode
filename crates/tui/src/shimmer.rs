use std::sync::OnceLock;
use std::time::Duration;
use std::time::Instant;

use ratatui::style::Color;
use ratatui::style::Modifier;
use ratatui::style::Style;
use ratatui::text::Span;

use crate::color::blend;
use crate::terminal_palette::default_bg;
use crate::terminal_palette::default_fg;

static PROCESS_START: OnceLock<Instant> = OnceLock::new();

fn elapsed_since_start() -> Duration {
    let start = PROCESS_START.get_or_init(Instant::now);
    start.elapsed()
}

pub(crate) fn shimmer_spans(text: &str) -> Vec<Span<'static>> {
    let char_count = text.chars().count();
    if char_count == 0 {
        return Vec::new();
    }
    // Use time-based sweep synchronized to process start.
    let padding = 10usize;
    let period = char_count + padding * 2;
    let sweep_seconds = 2.0f32;
    let pos_f =
        (elapsed_since_start().as_secs_f32() % sweep_seconds) / sweep_seconds * (period as f32);
    let pos = pos_f as usize;
    let has_true_color = supports_color::on_cached(supports_color::Stream::Stdout)
        .map(|level| level.has_16m)
        .unwrap_or(false);
    let band_half_width = 5.0;

    let mut spans: Vec<Span<'static>> = Vec::with_capacity(char_count);
    let base_color = default_fg().unwrap_or((128, 128, 128));
    let highlight_color = default_bg().unwrap_or((255, 255, 255));
    for (i, ch) in text.chars().enumerate() {
        let i_pos = i as isize + padding as isize;
        let pos = pos as isize;
        let dist = (i_pos - pos).abs() as f32;

        let t = if dist <= band_half_width {
            let x = std::f32::consts::PI * (dist / band_half_width);
            0.5 * (1.0 + x.cos())
        } else {
            0.0
        };
        let style = if has_true_color {
            let highlight = t.clamp(0.0, 1.0);
            let (r, g, b) = blend(highlight_color, base_color, highlight * 0.9);
            // Allow custom RGB colors, as the implementation is thoughtfully
            // adjusting the level of the default foreground color.
            #[allow(clippy::disallowed_methods)]
            {
                Style::default()
                    .fg(Color::Rgb(r, g, b))
                    .add_modifier(Modifier::BOLD)
            }
        } else {
            color_for_level(t)
        };
        spans.push(Span::styled(ch.to_string(), style));
    }
    spans
}

fn color_for_level(intensity: f32) -> Style {
    // Tune fallback styling so the shimmer band reads even without RGB support.
    if intensity < 0.2 {
        Style::default().add_modifier(Modifier::DIM)
    } else if intensity < 0.6 {
        Style::default()
    } else {
        Style::default().add_modifier(Modifier::BOLD)
    }
}

#[cfg(test)]
mod tests {
    use std::hint::black_box;
    use std::time::Instant;

    use pretty_assertions::assert_eq;

    use super::*;

    fn span_text(spans: &[Span<'static>]) -> String {
        spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<String>()
    }

    #[test]
    fn shimmer_spans_preserves_text_content() {
        let text = "thinking…";
        let spans = shimmer_spans(text);
        assert_eq!(span_text(&spans), text);
    }

    #[test]
    fn shimmer_spans_handles_empty_text() {
        assert_eq!(shimmer_spans(""), Vec::<Span<'static>>::new());
    }

    #[test]
    #[ignore]
    fn bench_shimmer_spans_short_text() {
        let text = "⠋";

        let started = Instant::now();
        let mut total_spans = 0;
        for _ in 0..200_000 {
            total_spans += black_box(shimmer_spans(black_box(text))).len();
        }
        let elapsed = started.elapsed();

        assert_eq!(total_spans, 200_000);
        println!(
            "shimmer_spans_short_text iterations=200000 chars=1 elapsed_ms={} per_call_us={:.2}",
            elapsed.as_secs_f64() * 1_000.0,
            elapsed.as_secs_f64() * 1_000_000.0 / 200_000.0
        );
    }

    #[test]
    #[ignore]
    fn bench_shimmer_spans_status_text() {
        let text = "Working on performance profiling";

        let started = Instant::now();
        let mut total_spans = 0;
        for _ in 0..50_000 {
            total_spans += black_box(shimmer_spans(black_box(text))).len();
        }
        let elapsed = started.elapsed();

        assert_eq!(total_spans, 1_600_000);
        println!(
            "shimmer_spans_status_text iterations=50000 chars=32 elapsed_ms={} per_call_us={:.2}",
            elapsed.as_secs_f64() * 1_000.0,
            elapsed.as_secs_f64() * 1_000_000.0 / 50_000.0
        );
    }
}
