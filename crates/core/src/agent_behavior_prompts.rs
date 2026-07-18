//! Agent behavior prompt fragments.
//!
//! These fragments are appended to the static system prompt when the
//! corresponding `AgentBehaviorConfig` flag is enabled. They are deliberately
//! kept at the END of the static prompt block so the upstream provider's
//! prompt cache (Anthropic, DeepSeek, etc.) sees a stable prefix across turns
//! when the flag is unchanged.
//!
//! Mirrors [`crate::collaboration_mode_prompts`] for the same inclusion
//! pattern.

const VERIFY_SOLUTION_PROMPT_TEMPLATE: &str =
    include_str!("../prompts/agent-behavior/verify-solution.md");
const SUGGEST_FOLLOWUPS_PROMPT_TEMPLATE: &str =
    include_str!("../prompts/agent-behavior/suggest-followups.md");
const EXPLORE_SOLUTIONS_PROMPT_TEMPLATE: &str =
    include_str!("../prompts/agent-behavior/explore-solutions.md");
const AUDIT_CHANGES_PROMPT_TEMPLATE: &str =
    include_str!("../prompts/agent-behavior/audit-changes.md");

/// Returns the `verify_solution` prompt fragment, or an empty string when
/// `self_verify` is disabled.
///
/// The fragment is wrapped in `<verify_solution_protocol>...</verify_solution_protocol>`
/// tags inside the markdown source. Callers append it after the rest of the
/// static system prompt.
pub(crate) fn verify_solution_prompt(enabled: bool) -> String {
    if !enabled {
        return String::new();
    }
    VERIFY_SOLUTION_PROMPT_TEMPLATE.trim().to_string()
}

/// Returns the `suggest_followups` prompt fragment, or an empty string when
/// the user has opted out via `AgentBehaviorConfig::suggest_followups`.
///
/// The fragment is wrapped in `<suggest_followups_protocol>...</suggest_followups_protocol>`
/// tags. The handler is always registered; the prompt only mentions it when
/// this function returns a non-empty string. Default-on for every agent so
/// non-trivial turns end with concrete next-step suggestions.
pub(crate) fn suggest_followups_prompt(enabled: bool) -> String {
    if !enabled {
        return String::new();
    }
    SUGGEST_FOLLOWUPS_PROMPT_TEMPLATE.trim().to_string()
}

/// Returns the `explore_solutions` prompt fragment, or an empty string when
/// the `explore_solutions` behavior flag is disabled.
///
/// The fragment is wrapped in `<explore_solutions_protocol>...</explore_solutions_protocol>`
/// tags. It instructs the model to generate multiple proposals using
/// `preview_edit`/`preview_write` before committing to a single approach.
pub(crate) fn explore_solutions_prompt(enabled: bool) -> String {
    if !enabled {
        return String::new();
    }
    EXPLORE_SOLUTIONS_PROMPT_TEMPLATE.trim().to_string()
}

/// Returns the `audit_changes` prompt fragment, or an empty string when
/// the `audit_changes` behavior flag is disabled.
///
/// The fragment is wrapped in `<audit_changes_protocol>...</audit_changes_protocol>`
/// tags. It instructs the model to review changes from quality, security,
/// and performance perspectives before finalizing.
pub(crate) fn audit_changes_prompt(enabled: bool) -> String {
    if !enabled {
        return String::new();
    }
    AUDIT_CHANGES_PROMPT_TEMPLATE.trim().to_string()
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[test]
    fn verify_solution_prompt_disabled_is_empty() {
        assert_eq!(verify_solution_prompt(false), String::new());
    }

    #[test]
    fn verify_solution_prompt_enabled_includes_protocol_block() {
        let prompt = verify_solution_prompt(true);
        assert!(prompt.starts_with("<verify_solution_protocol>"));
        assert!(prompt.ends_with("</verify_solution_protocol>"));
        assert!(prompt.contains("verify_solution"));
        assert!(prompt.contains("does NOT run external tools"));
    }

    #[test]
    fn verify_solution_prompt_matches_markdown_source() {
        let prompt = verify_solution_prompt(true);
        assert_eq!(
            prompt,
            include_str!("../prompts/agent-behavior/verify-solution.md")
                .trim()
                .to_string()
        );
    }

    #[test]
    fn suggest_followups_prompt_is_non_empty_and_wrapped_in_protocol_tags() {
        let prompt = suggest_followups_prompt(true);
        assert!(prompt.starts_with("<suggest_followups_protocol>"));
        assert!(prompt.ends_with("</suggest_followups_protocol>"));
        assert!(prompt.contains("suggest_followups"));
        assert!(prompt.contains("emoji"));
    }

    #[test]
    fn suggest_followups_prompt_disabled_is_empty() {
        assert_eq!(suggest_followups_prompt(false), String::new());
    }

    #[test]
    fn suggest_followups_prompt_matches_markdown_source() {
        let prompt = suggest_followups_prompt(true);
        assert_eq!(
            prompt,
            include_str!("../prompts/agent-behavior/suggest-followups.md")
                .trim()
                .to_string()
        );
    }
}