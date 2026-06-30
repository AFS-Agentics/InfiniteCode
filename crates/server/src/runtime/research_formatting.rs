use devo_core::SessionState;

use super::research_context::ResearchClarificationContext;

pub(super) fn assistant_text_from_session(session: &SessionState) -> String {
    session
        .messages
        .iter()
        .rev()
        .find(|message| message.role == devo_core::Role::Assistant)
        .map(|message| {
            message
                .content
                .iter()
                .filter_map(|block| match block {
                    devo_core::ContentBlock::Text { text } => Some(text.as_str()),
                    devo_core::ContentBlock::Reasoning { .. }
                    | devo_core::ContentBlock::ProviderReasoning { .. }
                    | devo_core::ContentBlock::ToolUse { .. }
                    | devo_core::ContentBlock::HostedToolUse { .. }
                    | devo_core::ContentBlock::ToolResult { .. } => None,
                })
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

pub(super) fn clarification_artifact_content(exchanges: &[ResearchClarificationContext]) -> String {
    match exchanges {
        [] => "No clarification needed.".to_string(),
        [exchange] => format!(
            "Question: {}\n\nAnswer: {}",
            exchange.question,
            exchange.answer.trim()
        ),
        _ => exchanges
            .iter()
            .enumerate()
            .map(|(index, exchange)| {
                let item = index + 1;
                format!(
                    "Question {item}: {}\n\nAnswer {item}: {}",
                    exchange.question,
                    exchange.answer.trim()
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n"),
    }
}

pub(super) fn build_research_context_reference(
    question: &str,
    final_report: &str,
    compressed_findings: &[String],
    task_count: usize,
    max_chars: usize,
) -> String {
    if max_chars == 0 {
        return String::new();
    }
    let mut reference = format!(
        "Original question:\n{}\n\nResearch workers: {}",
        question.trim(),
        task_count
    );
    let source_hints = collect_reference_hints(final_report, compressed_findings, 8);
    if !source_hints.is_empty() {
        reference.push_str("\n\nSource/reference hints:\n");
        reference.push_str(&source_hints.join("\n"));
    }
    truncate_chars(&reference, max_chars)
}

fn collect_reference_hints(
    final_report: &str,
    compressed_findings: &[String],
    max_hints: usize,
) -> Vec<String> {
    let mut hints = Vec::new();
    for text in std::iter::once(final_report).chain(compressed_findings.iter().map(String::as_str))
    {
        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let lower = trimmed.to_ascii_lowercase();
            let looks_like_reference = trimmed.contains("http://")
                || trimmed.contains("https://")
                || lower.starts_with("source")
                || lower.starts_with("sources")
                || lower.starts_with("citation")
                || lower.starts_with("citations");
            if !looks_like_reference {
                continue;
            }
            let mut line_hints = extract_urls(trimmed);
            if line_hints.is_empty()
                && (lower.starts_with("source")
                    || lower.starts_with("sources")
                    || lower.starts_with("citation")
                    || lower.starts_with("citations"))
            {
                line_hints.push(truncate_chars(trimmed, 300));
            }
            for hint in line_hints {
                if !hints.contains(&hint) {
                    hints.push(hint);
                }
                if hints.len() >= max_hints {
                    return hints;
                }
            }
        }
    }
    hints
}

fn extract_urls(text: &str) -> Vec<String> {
    text.split_whitespace()
        .filter(|part| part.starts_with("http://") || part.starts_with("https://"))
        .map(|part| {
            part.trim_end_matches(['.', ',', ';', ')', ']', '}'])
                .to_string()
        })
        .filter(|url| !url.is_empty())
        .collect()
}

pub(super) fn final_report_file_requested_by_default(question: &str) -> bool {
    let question = question.to_ascii_lowercase();
    ![
        "inline-only",
        "inline only",
        "in chat only",
        "chat only",
        "no local file",
        "no file",
        "do not write",
        "don't write",
        "without writing",
        "do not create",
        "don't create",
    ]
    .iter()
    .any(|phrase| question.contains(phrase))
}

pub(super) fn final_report_file_name(question: &str) -> String {
    let mut slug = String::new();
    let mut previous_dash = false;
    for ch in question.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            previous_dash = false;
        } else if !previous_dash && !slug.is_empty() {
            slug.push('-');
            previous_dash = true;
        }
        if slug.len() >= 64 {
            break;
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        "research-report.md".to_string()
    } else {
        format!("{slug}.md")
    }
}

pub(super) fn final_report_written_response(path: &str, report_text: &str) -> String {
    let summary = report_text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.trim_start_matches('#').trim())
        .filter(|line| !line.is_empty())
        .unwrap_or("Research report completed.");
    format!("Wrote the full research report to `{path}`.\n\n{summary}")
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    if max_chars <= 14 {
        return text.chars().take(max_chars).collect();
    }
    let mut truncated = text
        .chars()
        .take(max_chars.saturating_sub(14))
        .collect::<String>();
    truncated.push_str("\n[truncated]");
    truncated
}

pub(super) fn research_display_input(display_input: &str) -> String {
    let trimmed = display_input.trim();
    if trimmed == "/research" || trimmed.starts_with("/research ") {
        trimmed.to_string()
    } else {
        format!("/research {trimmed}")
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[test]
    fn clarification_artifact_content_numbers_multiple_questions() {
        // Trace: L2-DES-RESEARCH-001
        // Verifies: multiple clarification exchanges render deterministically for transcript artifacts.
        let content = clarification_artifact_content(&[
            ResearchClarificationContext {
                question: "Which scope?".to_string(),
                answer: "Product docs".to_string(),
            },
            ResearchClarificationContext {
                question: "Optional detail?".to_string(),
                answer: String::new(),
            },
        ]);

        assert_eq!(
            content,
            "Question 1: Which scope?\n\nAnswer 1: Product docs\n\nQuestion 2: Optional detail?\n\nAnswer 2: "
        );
    }

    #[test]
    fn research_context_reference_keeps_source_hints_without_evidence_pack_text() {
        // Trace: L2-DES-RESEARCH-001
        // Verifies: follow-up coding turns receive a compact research handoff instead of internal artifacts.
        let reference = build_research_context_reference(
            "What changed?",
            "Final answer cites https://example.com/a and includes a concise conclusion.",
            &[String::from(
                "Internal evidence pack.\nSource: https://example.com/b\nHidden notes should only appear if room remains.",
            )],
            2,
            1_000,
        );

        assert_eq!(
            reference,
            "Original question:\nWhat changed?\n\nResearch workers: 2\n\nSource/reference hints:\nhttps://example.com/a\nhttps://example.com/b"
        );
    }
}
