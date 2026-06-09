use unicode_width::UnicodeWidthChar;
use unicode_width::UnicodeWidthStr;

/// A single visual row produced by RowBuilder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Row {
    pub text: String,
    /// True if this row ends with an explicit line break (as opposed to a hard wrap).
    pub explicit_break: bool,
}

impl Row {
    pub fn width(&self) -> usize {
        self.text.width()
    }
}

/// Incrementally wraps input text into visual rows of at most `width` cells.
///
/// Step 1: plain-text only. ANSI-carry and styled spans will be added later.
pub struct RowBuilder {
    target_width: usize,
    /// Buffer for the current logical line (until a '\n' is seen).
    current_line: String,
    /// Output rows built so far for the current logical line and previous ones.
    rows: Vec<Row>,
}

impl RowBuilder {
    pub fn new(target_width: usize) -> Self {
        Self {
            target_width: target_width.max(1),
            current_line: String::new(),
            rows: Vec::new(),
        }
    }

    pub fn width(&self) -> usize {
        self.target_width
    }

    pub fn set_width(&mut self, width: usize) {
        self.target_width = width.max(1);
        // Rewrap everything we have (simple approach for Step 1).
        let mut all = String::new();
        for row in self.rows.drain(..) {
            all.push_str(&row.text);
            if row.explicit_break {
                all.push('\n');
            }
        }
        all.push_str(&self.current_line);
        self.current_line.clear();
        self.push_fragment(&all);
    }

    /// Push an input fragment. May contain newlines.
    pub fn push_fragment(&mut self, fragment: &str) {
        if fragment.is_empty() {
            return;
        }
        let mut start = 0usize;
        for (i, ch) in fragment.char_indices() {
            if ch == '\n' {
                // Flush anything pending before the newline.
                if start < i {
                    self.current_line.push_str(&fragment[start..i]);
                }
                self.flush_current_line(/*explicit_break*/ true);
                start = i + ch.len_utf8();
            }
        }
        if start < fragment.len() {
            self.current_line.push_str(&fragment[start..]);
            self.wrap_current_line();
        }
    }

    /// Mark the end of the current logical line (equivalent to pushing a '\n').
    pub fn end_line(&mut self) {
        self.flush_current_line(/*explicit_break*/ true);
    }

    /// Drain and return all produced rows.
    pub fn drain_rows(&mut self) -> Vec<Row> {
        std::mem::take(&mut self.rows)
    }

    /// Return a snapshot of produced rows (non-draining).
    pub fn rows(&self) -> &[Row] {
        &self.rows
    }

    /// Rows suitable for display, including the current partial line if any.
    pub fn display_rows(&self) -> Vec<Row> {
        let mut out = self.rows.clone();
        if !self.current_line.is_empty() {
            out.push(Row {
                text: self.current_line.clone(),
                explicit_break: false,
            });
        }
        out
    }

    /// Drain the oldest rows that exceed `max_keep` display rows (including the
    /// current partial line, if any). Returns the drained rows in order.
    pub fn drain_commit_ready(&mut self, max_keep: usize) -> Vec<Row> {
        let display_count = self.rows.len() + if self.current_line.is_empty() { 0 } else { 1 };
        if display_count <= max_keep {
            return Vec::new();
        }
        let to_commit = display_count - max_keep;
        let commit_count = to_commit.min(self.rows.len());
        let mut kept = self.rows.split_off(commit_count);
        std::mem::swap(&mut self.rows, &mut kept);
        kept
    }

    fn flush_current_line(&mut self, explicit_break: bool) {
        // Wrap any remaining content in the current line and then finalize with explicit_break.
        self.wrap_current_line();
        // If the current line ended exactly on a width boundary and is non-empty, represent
        // the explicit break as an empty explicit row so that fragmentation invariance holds.
        if explicit_break {
            if self.current_line.is_empty() {
                // We ended on a boundary previously; add an empty explicit row.
                self.rows.push(Row {
                    text: String::new(),
                    explicit_break: true,
                });
            } else {
                // There is leftover content that did not wrap yet; push it now with the explicit flag.
                let mut s = String::new();
                std::mem::swap(&mut s, &mut self.current_line);
                self.rows.push(Row {
                    text: s,
                    explicit_break: true,
                });
            }
        }
        // Reset current line buffer for next logical line.
        self.current_line.clear();
    }

    fn wrap_current_line(&mut self) {
        if self.current_line.len() > self.target_width {
            let printable_prefix_len = self
                .current_line
                .bytes()
                .position(|byte| byte != b' ' && !byte.is_ascii_graphic())
                .unwrap_or(self.current_line.len());
            if printable_prefix_len > self.target_width {
                let wrapped_len =
                    ((printable_prefix_len - 1) / self.target_width) * self.target_width;
                let remainder = self.current_line.split_off(wrapped_len);
                let wrapped = std::mem::replace(&mut self.current_line, remainder);
                for offset in (0..wrapped.len()).step_by(self.target_width) {
                    let end = offset + self.target_width;
                    self.rows.push(Row {
                        text: wrapped[offset..end].to_string(),
                        explicit_break: false,
                    });
                }
                if self.current_line.len() <= self.target_width {
                    return;
                }
            }
        }

        // While the current_line exceeds width, cut a prefix.
        loop {
            if self.current_line.is_empty() {
                break;
            }
            let (prefix, suffix, taken) =
                take_prefix_by_width(&self.current_line, self.target_width);
            if taken == 0 {
                // Avoid infinite loop on pathological inputs; take one scalar and continue.
                if let Some((i, ch)) = self.current_line.char_indices().next() {
                    let len = i + ch.len_utf8();
                    let p = self.current_line[..len].to_string();
                    self.rows.push(Row {
                        text: p,
                        explicit_break: false,
                    });
                    self.current_line = self.current_line[len..].to_string();
                    continue;
                }
                break;
            }
            if suffix.is_empty() {
                // Fits entirely; keep in buffer (do not push yet) so we can append more later.
                break;
            } else {
                // Emit wrapped prefix as a non-explicit row and continue with the remainder.
                self.rows.push(Row {
                    text: prefix,
                    explicit_break: false,
                });
                self.current_line = suffix.to_string();
            }
        }
    }
}

/// Take a prefix of `text` whose visible width is at most `max_cols`.
/// Returns (prefix, suffix, prefix_width).
pub fn take_prefix_by_width(text: &str, max_cols: usize) -> (String, &str, usize) {
    if max_cols == 0 || text.is_empty() {
        return (String::new(), text, 0);
    }
    let bytes = text.as_bytes();
    let printable_prefix_len = bytes.len().min(max_cols);
    if bytes[..printable_prefix_len]
        .iter()
        .all(|byte| *byte == b' ' || byte.is_ascii_graphic())
    {
        if bytes.len() > max_cols {
            return (text[..max_cols].to_string(), &text[max_cols..], max_cols);
        }
        return (text.to_string(), "", bytes.len());
    }

    let mut cols = 0usize;
    let mut end_idx = 0usize;
    for (i, ch) in text.char_indices() {
        let ch_width = UnicodeWidthChar::width(ch).unwrap_or(0);
        if cols.saturating_add(ch_width) > max_cols {
            break;
        }
        cols += ch_width;
        end_idx = i + ch.len_utf8();
        if cols == max_cols {
            break;
        }
    }
    let prefix = text[..end_idx].to_string();
    let suffix = &text[end_idx..];
    (prefix, suffix, cols)
}

#[cfg(test)]
mod tests {
    use std::hint::black_box;
    use std::time::Instant;

    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn rows_do_not_exceed_width_ascii() {
        let mut rb = RowBuilder::new(/*target_width*/ 10);
        rb.push_fragment("hello whirl this is a test");
        let rows = rb.rows().to_vec();
        assert_eq!(
            rows,
            vec![
                Row {
                    text: "hello whir".to_string(),
                    explicit_break: false
                },
                Row {
                    text: "l this is ".to_string(),
                    explicit_break: false
                }
            ]
        );
    }

    #[test]
    fn rows_do_not_exceed_width_emoji_cjk() {
        // 😀 is width 2; 你/好 are width 2.
        let mut rb = RowBuilder::new(/*target_width*/ 6);
        rb.push_fragment("😀😀 你好");
        let rows = rb.rows().to_vec();
        // At width 6, we expect the first row to fit exactly two emojis and a space
        // (2 + 2 + 1 = 5) plus one more column for the first CJK char (2 would overflow),
        // so only the two emojis and the space fit; the rest remains buffered.
        assert_eq!(
            rows,
            vec![Row {
                text: "😀😀 ".to_string(),
                explicit_break: false
            }]
        );
    }

    #[test]
    fn printable_prefix_wraps_before_control_tail() {
        let mut rb = RowBuilder::new(/*target_width*/ 4);
        rb.push_fragment("abcdefgh\tijkl");

        assert_eq!(
            rb.display_rows(),
            vec![
                Row {
                    text: "abcd".to_string(),
                    explicit_break: false
                },
                Row {
                    text: "efgh".to_string(),
                    explicit_break: false
                },
                Row {
                    text: "\tijkl".to_string(),
                    explicit_break: false
                }
            ]
        );
    }

    #[test]
    fn take_prefix_by_width_truncates_ascii_by_columns() {
        assert_eq!(
            (String::from("abcd"), "efgh", 4),
            take_prefix_by_width("abcdefgh", /*max_cols*/ 4)
        );
    }

    #[test]
    fn take_prefix_by_width_preserves_control_width_behavior() {
        assert_eq!(
            (String::from("a\tb"), "", 2),
            take_prefix_by_width("a\tb", /*max_cols*/ 2)
        );
    }

    #[test]
    fn fragmentation_invariance_long_token() {
        let s = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // 26 chars
        let mut rb_all = RowBuilder::new(/*target_width*/ 7);
        rb_all.push_fragment(s);
        let all_rows = rb_all.rows().to_vec();

        let mut rb_chunks = RowBuilder::new(/*target_width*/ 7);
        for i in (0..s.len()).step_by(3) {
            let end = (i + 3).min(s.len());
            rb_chunks.push_fragment(&s[i..end]);
        }
        let chunk_rows = rb_chunks.rows().to_vec();

        assert_eq!(all_rows, chunk_rows);
    }

    #[test]
    fn newline_splits_rows() {
        let mut rb = RowBuilder::new(/*target_width*/ 10);
        rb.push_fragment("hello\nworld");
        let rows = rb.display_rows();
        assert!(rows.iter().any(|r| r.explicit_break));
        assert_eq!(rows[0].text, "hello");
        // Second row should begin with 'world'
        assert!(rows.iter().any(|r| r.text.starts_with("world")));
    }

    #[test]
    fn rewrap_on_width_change() {
        let mut rb = RowBuilder::new(/*target_width*/ 10);
        rb.push_fragment("abcdefghijK");
        assert!(!rb.rows().is_empty());
        rb.set_width(/*width*/ 5);
        for r in rb.rows() {
            assert!(r.width() <= 5);
        }
    }

    #[test]
    fn drain_commit_ready_preserves_order_and_keeps_tail() {
        let mut rb = RowBuilder {
            target_width: 80,
            current_line: "partial".to_string(),
            rows: (0..5)
                .map(|index| Row {
                    text: format!("row-{index}"),
                    explicit_break: false,
                })
                .collect(),
        };

        let drained = rb.drain_commit_ready(/*max_keep*/ 2);

        assert_eq!(
            drained,
            vec![
                Row {
                    text: "row-0".to_string(),
                    explicit_break: false
                },
                Row {
                    text: "row-1".to_string(),
                    explicit_break: false
                },
                Row {
                    text: "row-2".to_string(),
                    explicit_break: false
                },
                Row {
                    text: "row-3".to_string(),
                    explicit_break: false
                }
            ]
        );
        assert_eq!(
            rb.display_rows(),
            vec![
                Row {
                    text: "row-4".to_string(),
                    explicit_break: false
                },
                Row {
                    text: "partial".to_string(),
                    explicit_break: false
                }
            ]
        );
    }

    #[test]
    #[ignore]
    fn bench_drain_commit_ready_many_rows() {
        let template = (0..20_000)
            .map(|index| Row {
                text: format!("streamed row {index}"),
                explicit_break: false,
            })
            .collect::<Vec<_>>();

        let started = Instant::now();
        let mut total_drained = 0;
        for _ in 0..100 {
            let mut rb = RowBuilder {
                target_width: 80,
                current_line: "partial row".to_string(),
                rows: black_box(template.clone()),
            };
            total_drained += black_box(rb.drain_commit_ready(/*max_keep*/ 32)).len();
        }
        let elapsed = started.elapsed();

        assert_eq!(total_drained, 1_996_900);
        println!(
            "drain_commit_ready_many_rows iterations=100 rows=20000 max_keep=32 elapsed_ms={} per_call_us={:.2}",
            elapsed.as_secs_f64() * 1_000.0,
            elapsed.as_secs_f64() * 1_000_000.0 / 100.0
        );
    }

    #[test]
    #[ignore]
    fn bench_push_fragment_wraps_long_stream() {
        let chunk = "abcdefghijklmnopqrstuvwxyz0123456789 ".repeat(1_000);

        let started = Instant::now();
        let mut total_rows = 0;
        for _ in 0..200 {
            let mut rb = RowBuilder::new(/*target_width*/ 80);
            rb.push_fragment(black_box(&chunk));
            total_rows += black_box(rb.rows().len());
        }
        let elapsed = started.elapsed();

        assert_eq!(total_rows, 92_400);
        println!(
            "push_fragment_wraps_long_stream iterations=200 chars={} width=80 elapsed_ms={} per_call_us={:.2}",
            chunk.len(),
            elapsed.as_secs_f64() * 1_000.0,
            elapsed.as_secs_f64() * 1_000_000.0 / 200.0
        );
    }

    #[test]
    #[ignore]
    fn bench_take_prefix_by_width_ascii_truncates() {
        let text = "abcdefghijklmnopqrstuvwxyz0123456789 ".repeat(8);

        let started = Instant::now();
        let mut total_width = 0;
        for _ in 0..500_000 {
            let (prefix, suffix, width) =
                take_prefix_by_width(black_box(&text), black_box(/*max_cols*/ 80));
            total_width += black_box(prefix.len() + suffix.len() + width);
        }
        let elapsed = started.elapsed();

        assert_eq!(total_width, 188_000_000);
        println!(
            "take_prefix_by_width_ascii_truncates iterations=500000 chars={} max_cols=80 elapsed_ms={} per_call_ns={:.2}",
            text.len(),
            elapsed.as_secs_f64() * 1_000.0,
            elapsed.as_secs_f64() * 1_000_000_000.0 / 500_000.0
        );
    }

    #[test]
    #[ignore]
    fn bench_take_prefix_by_width_ascii_no_truncation() {
        let text = "background terminal running /ps to view /stop to close";

        let started = Instant::now();
        let mut total_width = 0;
        for _ in 0..1_000_000 {
            let (prefix, suffix, width) =
                take_prefix_by_width(black_box(text), black_box(/*max_cols*/ 200));
            total_width += black_box(prefix.len() + suffix.len() + width);
        }
        let elapsed = started.elapsed();

        assert_eq!(total_width, 108_000_000);
        println!(
            "take_prefix_by_width_ascii_no_truncation iterations=1000000 chars={} max_cols=200 elapsed_ms={} per_call_ns={:.2}",
            text.len(),
            elapsed.as_secs_f64() * 1_000.0,
            elapsed.as_secs_f64() * 1_000_000_000.0 / 1_000_000.0
        );
    }
}
