#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ToolHandlerKind {
    Bash,
    CodeSearch,
    ShellCommand,
    Read,
    Write,
    Edit,
    Glob,
    Grep,
    ApplyPatch,
    Plan,
    Question,
    WebFetch,
    WebSearch,
    Skill,
    Lsp,
    Invalid,
    ExecCommand,
    WriteStdin,
    ToolSearch,
    /// Structural self-verification reflection tool. The model calls this
    /// voluntarily before submitting a final answer. Always registered
    /// (cheap), opt-in via `AgentBehaviorConfig::self_verify` in the system
    /// prompt. See `crates/core/src/tools/handlers/verify_solution.rs`.
    VerifySolution,
    /// UI-only "what's next?" chip suggestions. Read-only tool; the model
    /// emits it near the end of non-trivial turns. Renderers read the raw
    /// input to draw the chips. See
    /// `crates/core/src/tools/handlers/suggest_followups.rs`.
    SuggestFollowups,
    /// Read-only edit preview. Returns the diff that `edit` would produce
    /// without modifying the file.
    PreviewEdit,
    /// Read-only write preview. Returns the diff that `write` would produce
    /// without modifying the file.
    PreviewWrite,
    /// Structured outcome reporter. Subagents call this to pass JSON findings
    /// back to the parent agent.
    ReportOutcome,
    /// Best-of-N parallel thinker orchestrator. Spawns N ephemeral
    /// single-turn thinker subagents and a final selector child.
    /// Mirrors freebuff's `thinker-best-of-n` pattern. Read-only.
    /// See `crates/core/src/tools/handlers/explore_solutions.rs`.
    ExploreSolutions,
    /// Multi-prompt reviewer orchestrator. Spawns N ephemeral
    /// reviewer subagents with different focus prompts and aggregates
    /// the results. Mirrors freebuff's `code-reviewer-multi-prompt`.
    /// Read-only. See `crates/core/src/tools/handlers/audit_changes.rs`.
    AuditChanges,
    /// Best-of-N editing orchestrator. Caller pre-drafts N candidate
    /// implementations (preview_edit / preview_write outputs) and the
    /// selector picks the best. Mirrors freebuff's
    /// `editor-multi-prompt`. Read-only —
    /// `crates/core/src/tools/handlers/select_implementation.rs`.
    SelectImplementation,
}
