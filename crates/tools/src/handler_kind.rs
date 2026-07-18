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
}
