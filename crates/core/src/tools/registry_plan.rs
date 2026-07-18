use std::collections::BTreeMap;

use crate::handler_kind::ToolHandlerKind;
use crate::json_schema::JsonSchema;
use crate::tool_spec::{
    ToolCapabilityTag, ToolExecutionMode, ToolOutputMode, ToolPreparationFeedback, ToolSpec,
};
use crate::tools::websearch_prompt::web_search_prompt;
use infinitecode_config::AppConfig;

const BASH_DESCRIPTION: &str = include_str!("bash.txt");
const READ_DESCRIPTION: &str = include_str!("read.txt");
const WRITE_DESCRIPTION: &str = include_str!("write.txt");
const EDIT_DESCRIPTION: &str = include_str!("edit.txt");
const GLOB_DESCRIPTION: &str = include_str!("glob.txt");
const GREP_DESCRIPTION: &str = include_str!("grep.txt");
const WEBFETCH_DESCRIPTION: &str = include_str!("webfetch.txt");
const APPLY_PATCH_DESCRIPTION: &str = include_str!("apply_patch.txt");

#[derive(Debug, Clone)]
pub struct ToolRegistryPlan {
    pub specs: Vec<ToolSpec>,
    pub handlers: Vec<(ToolHandlerKind, String)>,
}

impl ToolRegistryPlan {
    pub fn new() -> Self {
        ToolRegistryPlan {
            specs: Vec::new(),
            handlers: Vec::new(),
        }
    }

    fn push(&mut self, spec: ToolSpec, kind: ToolHandlerKind) {
        let name = spec.name.clone();
        self.specs.push(spec);
        self.handlers.push((kind, name));
    }
}

impl Default for ToolRegistryPlan {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone)]
pub struct ToolPlanConfig {
    pub use_shell_command: bool,
    pub use_unified_exec: bool,
    pub code_search: bool,
    pub web_search: bool,
    pub web_fetch: bool,
    pub network_proxy: Option<String>,
    pub network_no_proxy: Option<String>,
}

impl ToolPlanConfig {
    pub fn from_app_config(config: &AppConfig) -> Self {
        Self {
            web_search: app_config_uses_local_web_search(config),
            web_fetch: app_config_uses_local_web_fetch(config),
            code_search: config.experimental.code_search,
            network_proxy: config.provider_http.proxy_url.clone(),
            network_no_proxy: config.provider_http.no_proxy.clone(),
            ..Self::default()
        }
    }

    pub fn validate(&self) {
        // No incompatible combinations currently exist.
        // - use_shell_command and use_unified_exec are independent (shell_command replaces bash,
        //   unified exec adds new tools)
        // - code_search is a read-only search tool and does not conflict with either
        // - all can be true simultaneously with no conflict
    }
}

impl Default for ToolPlanConfig {
    fn default() -> Self {
        ToolPlanConfig {
            use_shell_command: true,
            use_unified_exec: true,
            code_search: true,
            web_search: false,
            web_fetch: true,
            network_proxy: None,
            network_no_proxy: None,
        }
    }
}

fn shell_command_schema() -> JsonSchema {
    JsonSchema::object(
        BTreeMap::from([
            (
                "command".to_string(),
                JsonSchema::string(Some(
                    "The shell command to execute in the selected platform shell",
                )),
            ),
            (
                "cmd".to_string(),
                JsonSchema::string(Some("Alias for command")),
            ),
            (
                "timeout".to_string(),
                JsonSchema::integer(Some("Optional timeout in milliseconds")),
            ),
            (
                "timeout_ms".to_string(),
                JsonSchema::integer(Some("Alias for timeout")),
            ),
            (
                "workdir".to_string(),
                JsonSchema::string(Some(
                    "The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.",
                )),
            ),
            (
                "description".to_string(),
                JsonSchema::string(Some(
                    "Clear, concise description of what this command does in 5-10 words.",
                )),
            ),
            (
                "shell".to_string(),
                JsonSchema::string(Some(
                    "Optional shell binary to launch. Defaults to the user's default shell.",
                )),
            ),
            (
                "tty".to_string(),
                JsonSchema::boolean(Some(
                    "Whether to allocate a TTY for the command. Defaults to false.",
                )),
            ),
            (
                "login".to_string(),
                JsonSchema::boolean(Some(
                    "Whether to run the shell with login shell semantics. Defaults to true.",
                )),
            ),
            (
                "yield_time_ms".to_string(),
                JsonSchema::number(Some(
                    "How long to wait (in milliseconds) for output before yielding.",
                )),
            ),
            (
                "max_output_tokens".to_string(),
                JsonSchema::number(Some(
                    "Maximum number of tokens to return. Excess output will be truncated.",
                )),
            ),
        ]),
        Some(vec!["command".to_string()]),
        Some(false),
    )
}

fn bash_description() -> String {
    let chaining = if cfg!(windows) {
        "If commands depend on each other and must run sequentially, use a single PowerShell command string. In Windows PowerShell 5.1, do not rely on Bash chaining semantics like `cmd1 && cmd2`; prefer `cmd1; if ($?) { cmd2 }` when the later command depends on earlier success."
    } else {
        "If commands depend on each other and must run sequentially, use a single shell command and chain with `&&` when later commands depend on earlier success."
    };

    let shell = if cfg!(windows) { "powershell" } else { "bash" };

    BASH_DESCRIPTION
        .replace(
            "${directory}",
            &std::env::current_dir().map_or_else(|_| ".".to_string(), |p| p.display().to_string()),
        )
        .replace("${os}", std::env::consts::OS)
        .replace("${shell}", shell)
        .replace("${chaining}", chaining)
        .replace("${maxBytes}", "64 KB")
}

fn read_schema() -> JsonSchema {
    JsonSchema::object(
        BTreeMap::from([
            (
                "filePath".to_string(),
                JsonSchema::string(Some("The absolute path to the file or directory to read")),
            ),
            (
                "offset".to_string(),
                JsonSchema::integer(Some(
                    "The line number to start reading from (1-indexed, default 1)",
                )),
            ),
            (
                "limit".to_string(),
                JsonSchema::integer(Some(
                    "The maximum number of lines to read (no limit by default)",
                )),
            ),
        ]),
        Some(vec!["filePath".to_string()]),
        Some(false),
    )
}

fn write_schema() -> JsonSchema {
    JsonSchema::object(
        BTreeMap::from([
            (
                "filePath".to_string(),
                JsonSchema::string(Some("The absolute path to the file to write")),
            ),
            (
                "content".to_string(),
                JsonSchema::string(Some("The full file content to write")),
            ),
        ]),
        Some(vec!["filePath".to_string(), "content".to_string()]),
        Some(false),
    )
}

fn edit_schema() -> JsonSchema {
    JsonSchema::object(
        BTreeMap::from([
            (
                "filePath".to_string(),
                JsonSchema::string(Some("The absolute path to the file to modify")),
            ),
            (
                "oldString".to_string(),
                JsonSchema::string(Some(
                    "The exact text to replace. Must be non-empty and unique unless replaceAll is true.",
                )),
            ),
            (
                "newString".to_string(),
                JsonSchema::string(Some(
                    "The text to replace oldString with. May be empty to delete text.",
                )),
            ),
            (
                "replaceAll".to_string(),
                JsonSchema::boolean(Some(
                    "Replace every occurrence of oldString. Defaults to false.",
                )),
            ),
        ]),
        Some(vec![
            "filePath".to_string(),
            "oldString".to_string(),
            "newString".to_string(),
        ]),
        Some(false),
    )
}

fn find_schema() -> JsonSchema {
    JsonSchema::object(
        BTreeMap::from([
            (
                "pattern".to_string(),
                JsonSchema::string(Some("The ripgrep glob pattern to match file paths against")),
            ),
            (
                "path".to_string(),
                JsonSchema::string(Some(
                    "The directory to search in. Defaults to workspace root.",
                )),
            ),
        ]),
        Some(vec!["pattern".to_string()]),
        Some(false),
    )
}

fn grep_schema() -> JsonSchema {
    JsonSchema::object(
        BTreeMap::from([
            (
                "pattern".to_string(),
                JsonSchema::string(Some("The regex pattern to search for")),
            ),
            (
                "include".to_string(),
                JsonSchema::string(Some("File pattern to include (e.g. '*.rs')")),
            ),
            (
                "case_insensitive".to_string(),
                JsonSchema::boolean(Some("Search without case sensitivity")),
            ),
            (
                "path".to_string(),
                JsonSchema::string(Some("The directory to search in. Defaults to current dir.")),
            ),
        ]),
        Some(vec!["pattern".to_string()]),
        Some(false),
    )
}

#[cfg(feature = "code-search")]
fn code_search_schema() -> JsonSchema {
    let enum_string = |description: &str, values: &[&str]| {
        let mut schema = JsonSchema::string(Some(description));
        schema.enum_values = Some(
            values
                .iter()
                .map(|value| serde_json::Value::String((*value).to_string()))
                .collect(),
        );
        schema
    };
    JsonSchema::object(
        BTreeMap::from([
            (
                "operation".to_string(),
                enum_string(
                    "Search operation: search for query text or find chunks related to file_path:line",
                    &["search", "find_related"],
                ),
            ),
            (
                "query".to_string(),
                JsonSchema::string(Some("Natural-language or code query. Required for search.")),
            ),
            (
                "file_path".to_string(),
                JsonSchema::string(Some(
                    "Workspace-relative or absolute source file path. Required for find_related.",
                )),
            ),
            (
                "line".to_string(),
                JsonSchema::integer(Some(
                    "1-indexed source line inside file_path. Required for find_related.",
                )),
            ),
            (
                "path".to_string(),
                JsonSchema::string(Some(
                    "Workspace-relative or absolute search root inside the workspace. Defaults to workspace root.",
                )),
            ),
            (
                "content".to_string(),
                enum_string(
                    "Content filter. Defaults to code.",
                    &["code", "docs", "config", "all"],
                ),
            ),
            (
                "top_k".to_string(),
                JsonSchema::integer(Some(
                    "Maximum results to return. Defaults to 5, maximum 20.",
                )),
            ),
            (
                "filter_paths".to_string(),
                JsonSchema::array(
                    JsonSchema::string(Some("Workspace-relative path prefix to include")),
                    Some("Optional path prefixes to include"),
                ),
            ),
            (
                "filter_languages".to_string(),
                JsonSchema::array(
                    JsonSchema::string(Some("Language name to include")),
                    Some("Optional language filters such as rust or python"),
                ),
            ),
        ]),
        Some(vec!["operation".to_string()]),
        Some(/*additional_properties*/ false),
    )
}

#[cfg(feature = "code-search")]
pub(crate) fn code_search_tool_spec() -> ToolSpec {
    ToolSpec {
        name: "code_search".to_string(),
        description: "Preferred codebase investigation and code retrieval tool for the current workspace. Use code_search before find or grep when you need to understand how code is implemented, locate relevant modules or symbols, answer architecture questions, find related code, or search by natural-language intent.".to_string(),
        input_schema: code_search_schema(),
        output_mode: ToolOutputMode::StructuredJson,
        execution_mode: ToolExecutionMode::ReadOnly,
        capability_tags: vec![ToolCapabilityTag::SearchWorkspace],
        supports_parallel: true,
        preparation_feedback: ToolPreparationFeedback::None,
        display_name: None,
        supports_cancellation: Some(true),
        supports_streaming: None,
    }
}

fn apply_patch_schema() -> JsonSchema {
    JsonSchema::object(
        BTreeMap::from([(
            "patchText".to_string(),
            JsonSchema::string(Some(
                "The full patch text that describes all changes to be made",
            )),
        )]),
        Some(vec!["patchText".to_string()]),
        Some(false),
    )
}

fn plan_schema() -> JsonSchema {
    JsonSchema::object(
        BTreeMap::from([
            (
                "explanation".to_string(),
                JsonSchema::string(Some("Optional explanation for the plan update")),
            ),
            (
                "plan".to_string(),
                JsonSchema::array(
                    JsonSchema::object(
                        BTreeMap::from([
                            (
                                "step".to_string(),
                                JsonSchema::string(Some("Description of the plan step")),
                            ),
                            (
                                "status".to_string(),
                                JsonSchema::string(Some("Status of the step")),
                            ),
                        ]),
                        Some(vec!["step".to_string(), "status".to_string()]),
                        Some(false),
                    ),
                    Some("List of plan items"),
                ),
            ),
        ]),
        Some(vec!["plan".to_string()]),
        Some(false),
    )
}

fn question_schema() -> JsonSchema {
    let option_schema = JsonSchema::object(
        BTreeMap::from([
            (
                "label".to_string(),
                JsonSchema::string(Some("Short option label shown to the user")),
            ),
            (
                "description".to_string(),
                JsonSchema::string(Some("One sentence describing the option tradeoff")),
            ),
        ]),
        Some(vec!["label".to_string(), "description".to_string()]),
        Some(false),
    );
    let question_schema = JsonSchema::object(
        BTreeMap::from([
            (
                "id".to_string(),
                JsonSchema::string(Some("Stable identifier for mapping answers")),
            ),
            (
                "header".to_string(),
                JsonSchema::string(Some("Short header label shown in the UI")),
            ),
            (
                "question".to_string(),
                JsonSchema::string(Some("Single sentence prompt shown to the user")),
            ),
            (
                "isOther".to_string(),
                JsonSchema::boolean(Some("Whether a free-form Other answer is allowed")),
            ),
            (
                "isSecret".to_string(),
                JsonSchema::boolean(Some("Whether free-form text should be treated as secret")),
            ),
            (
                "options".to_string(),
                JsonSchema::array(option_schema, Some("Mutually exclusive answer options")),
            ),
        ]),
        Some(vec![
            "id".to_string(),
            "header".to_string(),
            "question".to_string(),
        ]),
        Some(false),
    );
    JsonSchema::object(
        BTreeMap::from([(
            "questions".to_string(),
            JsonSchema::array(question_schema, Some("Questions to show the user")),
        )]),
        Some(vec!["questions".to_string()]),
        Some(false),
    )
}

fn webfetch_schema() -> JsonSchema {
    JsonSchema::object(
        BTreeMap::from([
            (
                "url".to_string(),
                JsonSchema::string(Some("The URL to fetch content from")),
            ),
            (
                "format".to_string(),
                JsonSchema::string(Some("The format to return (text, markdown, or html)")),
            ),
            (
                "timeout".to_string(),
                JsonSchema::integer(Some("Optional timeout in seconds")),
            ),
        ]),
        Some(vec!["url".to_string()]),
        Some(false),
    )
}

fn app_config_uses_local_web_search(config: &AppConfig) -> bool {
    config.tools.web_search.mode == infinitecode_config::WebSearchMode::Local
        || config.provider.providers.values().any(|provider| {
            provider.web_search.as_ref().is_some_and(|web_search| {
                web_search.mode == infinitecode_config::WebSearchMode::Local
            })
        })
        || config.provider.model_bindings.values().any(|binding| {
            binding.web_search.as_ref().is_some_and(|web_search| {
                web_search.mode == infinitecode_config::WebSearchMode::Local
            })
        })
}

fn app_config_uses_local_web_fetch(config: &AppConfig) -> bool {
    config.tools.web_fetch.mode == infinitecode_config::WebFetchMode::Local
        || config.provider.providers.values().any(|provider| {
            provider
                .web_fetch
                .as_ref()
                .is_some_and(|web_fetch| web_fetch.mode == infinitecode_config::WebFetchMode::Local)
        })
        || config.provider.model_bindings.values().any(|binding| {
            binding
                .web_fetch
                .as_ref()
                .is_some_and(|web_fetch| web_fetch.mode == infinitecode_config::WebFetchMode::Local)
        })
}

fn websearch_schema() -> JsonSchema {
    JsonSchema::object(
        BTreeMap::from([(
            "query".to_string(),
            JsonSchema::string(Some("The search query")),
        )]),
        Some(vec!["query".to_string()]),
        Some(false),
    )
}

fn lsp_schema() -> JsonSchema {
    JsonSchema::object(
        BTreeMap::from([
            (
                "filePath".to_string(),
                JsonSchema::string(Some("The absolute path to the file")),
            ),
            (
                "line".to_string(),
                JsonSchema::integer(Some("Line number (0-indexed)")),
            ),
            (
                "character".to_string(),
                JsonSchema::integer(Some("Character offset")),
            ),
        ]),
        Some(vec![
            "filePath".to_string(),
            "line".to_string(),
            "character".to_string(),
        ]),
        Some(false),
    )
}

fn exec_command_schema() -> JsonSchema {
    JsonSchema::object(
        BTreeMap::from([
            (
                "cmd".to_string(),
                JsonSchema::string(Some("Shell command to execute")),
            ),
            (
                "command".to_string(),
                JsonSchema::string(Some("Alias for cmd")),
            ),
            (
                "workdir".to_string(),
                JsonSchema::string(Some("Working directory. Defaults to current directory.")),
            ),
            (
                "shell".to_string(),
                JsonSchema::string(Some(
                    "Shell binary to launch (e.g. 'bash' or 'powershell').",
                )),
            ),
            (
                "login".to_string(),
                JsonSchema::boolean(Some(
                    "Whether to run the shell with login shell semantics. Defaults to true.",
                )),
            ),
            (
                "tty".to_string(),
                JsonSchema::boolean(Some(
                    "Whether to allocate a PTY. Must be true for write_stdin to work.",
                )),
            ),
            (
                "execution_mode".to_string(),
                JsonSchema::string(Some(
                    "attached (default) returns output or a process session; background returns a task id immediately.",
                )),
            ),
            (
                "yield_time_ms".to_string(),
                JsonSchema::number(Some(
                    "How long to wait (in ms) for output before returning. Default 10000.",
                )),
            ),
            (
                "max_output_tokens".to_string(),
                JsonSchema::number(Some("Maximum number of tokens of output to return.")),
            ),
        ]),
        Some(vec!["cmd".to_string()]),
        Some(false),
    )
}

fn write_stdin_schema() -> JsonSchema {
    JsonSchema::object(
        BTreeMap::from([
            (
                "session_id".to_string(),
                JsonSchema::integer(Some("Session ID of the running exec_command process")),
            ),
            (
                "chars".to_string(),
                JsonSchema::string(Some(
                    "Bytes to write to stdin. Empty string to poll for output.",
                )),
            ),
            (
                "yield_time_ms".to_string(),
                JsonSchema::number(Some(
                    "How long to wait (in ms) for output before returning. Default 250.",
                )),
            ),
            (
                "max_output_tokens".to_string(),
                JsonSchema::number(Some("Maximum number of tokens of output to return.")),
            ),
        ]),
        Some(vec!["session_id".to_string()]),
        Some(false),
    )
}

fn invalid_schema() -> JsonSchema {
    JsonSchema::object(BTreeMap::new(), None, Some(false))
}

pub fn build_tool_registry_plan(config: &ToolPlanConfig) -> ToolRegistryPlan {
    config.validate();
    let mut plan = ToolRegistryPlan::new();

    if config.use_shell_command {
        plan.push(
            ToolSpec {
                name: "shell_command".to_string(),
                description: bash_description(),
                input_schema: shell_command_schema(),
                output_mode: ToolOutputMode::Mixed,
                execution_mode: ToolExecutionMode::Mutating,
                capability_tags: vec![ToolCapabilityTag::ExecuteProcess],
                supports_parallel: false,
                preparation_feedback: ToolPreparationFeedback::None,
                display_name: None,
                supports_cancellation: None,
                supports_streaming: None,
            },
            ToolHandlerKind::Bash,
        );
    } else {
        plan.push(
            ToolSpec {
                name: "bash".to_string(),
                description: bash_description(),
                input_schema: shell_command_schema(),
                output_mode: ToolOutputMode::Mixed,
                execution_mode: ToolExecutionMode::Mutating,
                capability_tags: vec![ToolCapabilityTag::ExecuteProcess],
                supports_parallel: false,
                preparation_feedback: ToolPreparationFeedback::None,
                display_name: None,
                supports_cancellation: None,
                supports_streaming: None,
            },
            ToolHandlerKind::Bash,
        );
    }

    plan.push(
        ToolSpec {
            name: "read".to_string(),
            description: READ_DESCRIPTION.to_string(),
            input_schema: read_schema(),
            output_mode: ToolOutputMode::Mixed,
            execution_mode: ToolExecutionMode::ReadOnly,
            capability_tags: vec![ToolCapabilityTag::ReadFiles],
            supports_parallel: true,
            preparation_feedback: ToolPreparationFeedback::None,
            display_name: None,
            supports_cancellation: None,
            supports_streaming: None,
        },
        ToolHandlerKind::Read,
    );

    plan.push(
        ToolSpec {
            name: "write".to_string(),
            description: WRITE_DESCRIPTION.to_string(),
            input_schema: write_schema(),
            output_mode: ToolOutputMode::Mixed,
            execution_mode: ToolExecutionMode::Mutating,
            capability_tags: vec![ToolCapabilityTag::WriteFiles],
            supports_parallel: false,
            preparation_feedback: ToolPreparationFeedback::LiveOnly,
            display_name: None,
            supports_cancellation: None,
            supports_streaming: None,
        },
        ToolHandlerKind::Write,
    );

    plan.push(
        ToolSpec {
            name: "edit".to_string(),
            description: EDIT_DESCRIPTION.to_string(),
            input_schema: edit_schema(),
            output_mode: ToolOutputMode::Mixed,
            execution_mode: ToolExecutionMode::Mutating,
            capability_tags: vec![ToolCapabilityTag::WriteFiles],
            supports_parallel: false,
            preparation_feedback: ToolPreparationFeedback::LiveOnly,
            display_name: None,
            supports_cancellation: None,
            supports_streaming: None,
        },
        ToolHandlerKind::Edit,
    );

    plan.push(
        ToolSpec {
            name: "preview_edit".to_string(),
            description: "Preview an edit without applying it. Returns the unified diff that would result from the replacement, but does NOT modify the file. Use this to check what an edit would look like before committing.".to_string(),
            input_schema: edit_schema(),
            output_mode: ToolOutputMode::Mixed,
            execution_mode: ToolExecutionMode::ReadOnly,
            capability_tags: vec![],
            supports_parallel: true,
            preparation_feedback: ToolPreparationFeedback::None,
            display_name: Some("Preview edit".to_string()),
            supports_cancellation: None,
            supports_streaming: None,
        },
        ToolHandlerKind::PreviewEdit,
    );

    plan.push(
        ToolSpec {
            name: "preview_write".to_string(),
            description: "Preview a file write without applying it. Returns the unified diff that would result, but does NOT create or modify the file. Use this to check what a write would look like before committing.".to_string(),
            input_schema: write_schema(),
            output_mode: ToolOutputMode::Mixed,
            execution_mode: ToolExecutionMode::ReadOnly,
            capability_tags: vec![],
            supports_parallel: true,
            preparation_feedback: ToolPreparationFeedback::None,
            display_name: Some("Preview write".to_string()),
            supports_cancellation: None,
            supports_streaming: None,
        },
        ToolHandlerKind::PreviewWrite,
    );

    plan.push(
        ToolSpec {
            name: "report_outcome".to_string(),
            description: "Report structured outcomes from a subagent. Accepts arbitrary JSON findings and returns them so the parent can review.".to_string(),
            input_schema: {
                let mut props = std::collections::BTreeMap::new();
                props.insert("findings".to_string(), JsonSchema::object(
                    std::collections::BTreeMap::new(),
                    None,
                    Some(true),
                ));
                JsonSchema::object(props, Some(vec!["findings".to_string()]), Some(false))
            },
            output_mode: ToolOutputMode::Mixed,
            execution_mode: ToolExecutionMode::ReadOnly,
            capability_tags: vec![],
            supports_parallel: true,
            preparation_feedback: ToolPreparationFeedback::None,
            display_name: Some("Report outcome".to_string()),
            supports_cancellation: None,
            supports_streaming: None,
        },
        ToolHandlerKind::ReportOutcome,
    );

    plan.push(
        ToolSpec {
            name: "explore_solutions".to_string(),
            description: "Best-of-N parallel thinker orchestrator (freebuff-style). Use operation 'explore' (default) to spawn N=1..=6 ephemeral thinker subagents in parallel on a single problem, each with a different focus lens; a final selector child picks the best thought. Use operation 'select' to run only the selector over caller-supplied candidate ideas. Both modes are read-only and inherit the parent's provider/reasoning. Mirrors freebuff's `thinker-best-of-n` pattern.".to_string(),
            input_schema: JsonSchema::object(
                BTreeMap::from([
                    (
                        "operation".to_string(),
                        JsonSchema::string(Some("\"explore\" (default) spawns N thinker children; \"select\" runs only the selector over caller-supplied candidates.")),
                    ),
                    (
                        "problem".to_string(),
                        JsonSchema::string(Some("Required for operation='explore'. The problem each thinker reasons about.")),
                    ),
                    (
                        "n".to_string(),
                        JsonSchema::integer(Some("Number of parallel thinker children. Default 3, clamped to 1..=6.")),
                    ),
                    (
                        "perspectives".to_string(),
                        JsonSchema::array(
                            JsonSchema::string(Some("Focus lens per thinker, e.g. 'correctness edge cases'.")),
                            Some("Optional: exactly N entries paralleling 'n'. Empty = each thinker uses 'general depth'."),
                        ),
                    ),
                    (
                        "candidates".to_string(),
                        JsonSchema::array(
                            JsonSchema::object(
                                BTreeMap::from([
                                    ("id".to_string(), JsonSchema::string(Some("Optional caller-assigned id."))),
                                    ("content".to_string(), JsonSchema::string(Some("Candidate text."))),
                                ]),
                                None,
                                Some(true),
                            ),
                            Some("Required for operation='select': 1..=8 pre-drafted candidates."),
                        ),
                    ),
                    (
                        "selectionCriteria".to_string(),
                        JsonSchema::string(Some("Optional override of the selector's default criteria.")),
                    ),
                ]),
                Some(vec![]),
                Some(false),
            ),
            output_mode: ToolOutputMode::Mixed,
            execution_mode: ToolExecutionMode::ReadOnly,
            capability_tags: vec![],
            supports_parallel: false,
            preparation_feedback: ToolPreparationFeedback::None,
            display_name: Some("Explore solutions".to_string()),
            supports_cancellation: Some(true),
            supports_streaming: None,
        },
        ToolHandlerKind::ExploreSolutions,
    );

    plan.push(
        ToolSpec {
            name: "audit_changes".to_string(),
            description: "Multi-prompt reviewer orchestrator (freebuff-style). Spawns N=1..=8 ephemeral reviewer subagents in parallel, each focused on a different lens (correctness, security, performance + maintainability, simplify / reuse / readability, ...), against the same change summary. Aggregates the reviews into a structured {reviews, verdicts, summary} payload. Read-only. Equivalent to freebuff's `code-reviewer-multi-prompt` invoked with a lens array.".to_string(),
            input_schema: JsonSchema::object(
                BTreeMap::from([
                    (
                        "changes".to_string(),
                        JsonSchema::string(Some("Required: unified diff, file summary, or plain description of the changes.")),
                    ),
                    (
                        "perspectives".to_string(),
                        JsonSchema::array(
                            JsonSchema::string(Some("Focus lens, e.g. 'security concerns'.")),
                            Some("Optional: 1..=8 perspectives. Defaults to correctness / security / performance+maintainability / simplify-reuse-readability."),
                        ),
                    ),
                    (
                        "maxCharsPerReview".to_string(),
                        JsonSchema::integer(Some("Soft cap for each reviewer's reply length. Advisory only.")),
                    ),
                ]),
                Some(vec!["changes".to_string()]),
                Some(false),
            ),
            output_mode: ToolOutputMode::Mixed,
            execution_mode: ToolExecutionMode::ReadOnly,
            capability_tags: vec![],
            supports_parallel: false,
            preparation_feedback: ToolPreparationFeedback::None,
            display_name: Some("Audit changes".to_string()),
            supports_cancellation: Some(true),
            supports_streaming: None,
        },
        ToolHandlerKind::AuditChanges,
    );

    plan.push(
        ToolSpec {
            name: "select_implementation".to_string(),
            description: "Best-of-N editing orchestrator (freebuff-style). Caller pre-drafts N=1..=8 candidate implementations of the same change (typically by chaining preview_edit / preview_write), then spawns a single selector child to pick the best. Returns the chosen strategy + diff + structured tool_calls for the parent model to apply via its own edit / write tool calls. Read-only — never touches the workspace. Equivalent to freebuff's `editor-multi-prompt` invoked as a pure selector.".to_string(),
            input_schema: JsonSchema::object(
                BTreeMap::from([
                    (
                        "problem".to_string(),
                        JsonSchema::string(Some("Required: brief description of the change the proposals address.")),
                    ),
                    (
                        "proposals".to_string(),
                        JsonSchema::array(
                            JsonSchema::object(
                                BTreeMap::from([
                                    (
                                        "id".to_string(),
                                        JsonSchema::string(Some("Optional caller-assigned id. Falls back to A, B, C… based on order.")),
                                    ),
                                    (
                                        "strategy".to_string(),
                                        JsonSchema::string(Some("One-sentence strategy summary the selector uses to compare.")),
                                    ),
                                    (
                                        "diff".to_string(),
                                        JsonSchema::string(Some("Unified diff or free-form summary the selector reviews.")),
                                    ),
                                    (
                                        "tool_calls".to_string(),
                                        JsonSchema::array(
                                            JsonSchema::object(
                                                BTreeMap::from([
                                                    (
                                                        "toolName".to_string(),
                                                        JsonSchema::string(Some("edit, write, preview_edit, preview_write, …")),
                                                    ),
                                                    (
                                                        "input".to_string(),
                                                        JsonSchema {
                                                            description: Some("Call input JSON.".to_string()),
                                                            ..Default::default()
                                                        },
                                                    ),
                                                ]),
                                                Some(vec!["toolName".to_string(), "input".to_string()]),
                                                Some(true),
                                            ),
                                            Some("Concrete tool calls that realize this proposal."),
                                        ),
                                    ),
                                ]),
                                Some(vec!["strategy".to_string()]),
                                Some(true),
                            ),
                            Some("1..=8 candidate implementations."),
                        ),
                    ),
                    (
                        "selectionCriteria".to_string(),
                        JsonSchema::string(Some("Optional override of the selector's default criteria.")),
                    ),
                ]),
                Some(vec!["proposals".to_string()]),
                Some(false),
            ),
            output_mode: ToolOutputMode::Mixed,
            execution_mode: ToolExecutionMode::ReadOnly,
            capability_tags: vec![],
            supports_parallel: false,
            preparation_feedback: ToolPreparationFeedback::None,
            display_name: Some("Select implementation".to_string()),
            supports_cancellation: Some(true),
            supports_streaming: None,
        },
        ToolHandlerKind::SelectImplementation,
    );

    let find_description = GLOB_DESCRIPTION;

    plan.push(
        ToolSpec {
            name: "find".to_string(),
            description: find_description.to_string(),
            input_schema: find_schema(),
            output_mode: ToolOutputMode::Text,
            execution_mode: ToolExecutionMode::ReadOnly,
            capability_tags: vec![ToolCapabilityTag::SearchWorkspace],
            supports_parallel: true,
            preparation_feedback: ToolPreparationFeedback::None,
            display_name: None,
            supports_cancellation: None,
            supports_streaming: None,
        },
        ToolHandlerKind::Glob,
    );

    let grep_description = GREP_DESCRIPTION;

    plan.push(
        ToolSpec {
            name: "grep".to_string(),
            description: grep_description.to_string(),
            input_schema: grep_schema(),
            output_mode: ToolOutputMode::Text,
            execution_mode: ToolExecutionMode::ReadOnly,
            capability_tags: vec![ToolCapabilityTag::SearchWorkspace],
            supports_parallel: true,
            preparation_feedback: ToolPreparationFeedback::None,
            display_name: None,
            supports_cancellation: None,
            supports_streaming: None,
        },
        ToolHandlerKind::Grep,
    );

    #[cfg(feature = "code-search")]
    if config.code_search {
        plan.push(code_search_tool_spec(), ToolHandlerKind::CodeSearch);
    }

    plan.push(
        ToolSpec {
            name: "apply_patch".to_string(),
            description: APPLY_PATCH_DESCRIPTION.to_string(),
            input_schema: apply_patch_schema(),
            output_mode: ToolOutputMode::Mixed,
            execution_mode: ToolExecutionMode::Mutating,
            capability_tags: vec![ToolCapabilityTag::WriteFiles],
            supports_parallel: false,
            preparation_feedback: ToolPreparationFeedback::LiveOnly,
            display_name: None,
            supports_cancellation: None,
            supports_streaming: None,
        },
        ToolHandlerKind::ApplyPatch,
    );

    plan.push(
        ToolSpec {
            name: "verify_solution".to_string(),
            description: "Perform a structured self-verification reflection before submitting your final answer. Returns a reflection prompt asking you to walk through each criterion and claim against your proposed answer. Use when the answer makes factual claims, includes code that will be executed, or when the task is non-trivial. Skips external tools; this is a structural reflection step that asks you to re-check your reasoning.".to_string(),
            input_schema: JsonSchema::object(
                BTreeMap::from([
                    (
                        "answer".to_string(),
                        JsonSchema::string(Some(
                            "Your proposed final answer — the text you would otherwise output now.",
                        )),
                    ),
                    (
                        "criteria".to_string(),
                        JsonSchema::array(
                            JsonSchema::string(None),
                            Some(
                                "Optional list of explicit constraints from the user's request to verify the answer against.",
                            ),
                        ),
                    ),
                    (
                        "claims".to_string(),
                        JsonSchema::array(
                            JsonSchema::string(None),
                            Some(
                                "Optional list of factual claims in the answer that the user might want to verify.",
                            ),
                        ),
                    ),
                ]),
                Some(vec!["answer".to_string()]),
                Some(false),
            ),
            output_mode: ToolOutputMode::Text,
            execution_mode: ToolExecutionMode::ReadOnly,
            capability_tags: vec![],
            supports_parallel: true,
            preparation_feedback: ToolPreparationFeedback::None,
            display_name: Some("Verify solution".to_string()),
            supports_cancellation: None,
            supports_streaming: None,
        },
        ToolHandlerKind::VerifySolution,
    );

    plan.push(
        ToolSpec {
            name: "suggest_followups".to_string(),
            description: "Offer 1–6 clickable next steps at the end of a non-trivial turn. Each chip becomes a button the user can click to send that exact prompt back as a new user turn. Use this whenever you can foresee at least one concrete useful follow-up; skip it for trivial greetings or terminal states. Each follow-up object requires three fields: emoji, label (≤60 chars), prompt (≤800 chars). 1–6 chips per call; never duplicate intents.".to_string(),
            input_schema: JsonSchema::object(
                BTreeMap::from([(
                    "followups".to_string(),
                    JsonSchema::array(
                        JsonSchema::object(
                            BTreeMap::from([
                                (
                                    "emoji".to_string(),
                                    JsonSchema::string(Some(
                                        "A single emoji that signals the action category.",
                                    )),
                                ),
                                (
                                    "label".to_string(),
                                    JsonSchema::string(Some(
                                        "Short chip text shown to the user (≤60 chars).",
                                    )),
                                ),
                                (
                                    "prompt".to_string(),
                                    JsonSchema::string(Some(
                                        "Full instruction sent if the user clicks the chip (≤800 chars).",
                                    )),
                                ),
                            ]),
                            Some(vec![
                                "emoji".to_string(),
                                "label".to_string(),
                                "prompt".to_string(),
                            ]),
                            Some(false),
                        ),
                        Some("1 to 6 followups, ordered by importance."),
                    ),
                )]),
                Some(vec!["followups".to_string()]),
                Some(false),
            ),
            output_mode: ToolOutputMode::Text,
            execution_mode: ToolExecutionMode::ReadOnly,
            capability_tags: vec![],
            supports_parallel: true,
            preparation_feedback: ToolPreparationFeedback::None,
            display_name: Some("Suggest followups".to_string()),
            supports_cancellation: None,
            supports_streaming: None,
        },
        ToolHandlerKind::SuggestFollowups,
    );

    plan.push(
        ToolSpec {
            name: "update_plan".to_string(),
            description: "Updates the task plan.\nProvide an optional explanation and a list of plan items, each with a step and status.\nAt most one step can be in_progress at a time.".to_string(),
            input_schema: plan_schema(),
            output_mode: ToolOutputMode::Text,
            execution_mode: ToolExecutionMode::Mutating,
            capability_tags: vec![],
            supports_parallel: false,
            preparation_feedback: ToolPreparationFeedback::None,
            display_name: None,
            supports_cancellation: None,
            supports_streaming: None,
        },
        ToolHandlerKind::Plan,
    );

    plan.push(
        ToolSpec {
            name: "request_user_input".to_string(),
            description: "Ask the user one or more Plan Mode questions and wait for the response."
                .to_string(),
            input_schema: question_schema(),
            output_mode: ToolOutputMode::StructuredJson,
            execution_mode: ToolExecutionMode::ReadOnly,
            capability_tags: vec![],
            supports_parallel: true,
            preparation_feedback: ToolPreparationFeedback::None,
            display_name: None,
            supports_cancellation: None,
            supports_streaming: None,
        },
        ToolHandlerKind::Question,
    );

    if config.web_fetch {
        plan.push(
            ToolSpec {
                name: "webfetch".to_string(),
                description: WEBFETCH_DESCRIPTION.to_string(),
                input_schema: webfetch_schema(),
                output_mode: ToolOutputMode::Mixed,
                execution_mode: ToolExecutionMode::ReadOnly,
                capability_tags: vec![ToolCapabilityTag::NetworkAccess],
                supports_parallel: true,
                preparation_feedback: ToolPreparationFeedback::None,
                display_name: None,
                supports_cancellation: None,
                supports_streaming: None,
            },
            ToolHandlerKind::WebFetch,
        );
    }

    if config.web_search {
        plan.push(
            ToolSpec {
                name: "web_search".to_string(),
                description: web_search_prompt(),
                input_schema: websearch_schema(),
                output_mode: ToolOutputMode::Text,
                execution_mode: ToolExecutionMode::ReadOnly,
                capability_tags: vec![ToolCapabilityTag::NetworkAccess],
                supports_parallel: true,
                preparation_feedback: ToolPreparationFeedback::None,
                display_name: None,
                supports_cancellation: None,
                supports_streaming: None,
            },
            ToolHandlerKind::WebSearch,
        );
    }

    plan.push(
        ToolSpec {
            name: "lsp".to_string(),
            description:
                "Get language server protocol information about a file at a specific position."
                    .to_string(),
            input_schema: lsp_schema(),
            output_mode: ToolOutputMode::Text,
            execution_mode: ToolExecutionMode::ReadOnly,
            capability_tags: vec![ToolCapabilityTag::SearchWorkspace],
            supports_parallel: true,
            preparation_feedback: ToolPreparationFeedback::None,
            display_name: None,
            supports_cancellation: None,
            supports_streaming: None,
        },
        ToolHandlerKind::Lsp,
    );

    plan.push(
        ToolSpec {
            name: "invalid".to_string(),
            description: "A tool that always returns an error. Useful for testing error handling."
                .to_string(),
            input_schema: invalid_schema(),
            output_mode: ToolOutputMode::Text,
            execution_mode: ToolExecutionMode::ReadOnly,
            capability_tags: vec![],
            supports_parallel: true,
            preparation_feedback: ToolPreparationFeedback::None,
            display_name: None,
            supports_cancellation: None,
            supports_streaming: None,
        },
        ToolHandlerKind::Invalid,
    );

    if config.use_unified_exec {
        plan.push(
            ToolSpec {
                name: "exec_command".to_string(),
                description:
                    "Run a shell command in attached or background mode. Attached mode returns output or a process session for write_stdin; background mode returns a task id for await_task, list_tasks, and cancel_task."
                        .to_string(),
                input_schema: exec_command_schema(),
                output_mode: ToolOutputMode::Mixed,
                execution_mode: ToolExecutionMode::Mutating,
                capability_tags: vec![ToolCapabilityTag::ExecuteProcess],
                supports_parallel: true,
            preparation_feedback: ToolPreparationFeedback::None,
            display_name: None,
            supports_cancellation: None,
            supports_streaming: None,
            },
            ToolHandlerKind::ExecCommand,
        );
        plan.push(
            ToolSpec {
                name: "write_stdin".to_string(),
                description:
                    "Write bytes to stdin of a running unified exec session, or poll for output without writing. Returns any output produced since the last write_stdin."
                        .to_string(),
                input_schema: write_stdin_schema(),
                output_mode: ToolOutputMode::Mixed,
                execution_mode: ToolExecutionMode::Mutating,
                capability_tags: vec![ToolCapabilityTag::ExecuteProcess],
                supports_parallel: false,
            preparation_feedback: ToolPreparationFeedback::None,
            display_name: None,
            supports_cancellation: None,
            supports_streaming: None,
            },
            ToolHandlerKind::WriteStdin,
        );
    }

    plan
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn plan_default_starts_empty() {
        let plan = ToolRegistryPlan::new();
        assert!(plan.specs.is_empty());
        assert!(plan.handlers.is_empty());
    }

    #[test]
    fn plan_push_adds_spec_and_handler() {
        let mut plan = ToolRegistryPlan::new();
        plan.push(
            ToolSpec::new("test", "desc", JsonSchema::string(None)),
            ToolHandlerKind::Read,
        );
        assert_eq!(plan.specs.len(), 1);
        assert_eq!(plan.handlers.len(), 1);
        assert_eq!(plan.handlers[0].0, ToolHandlerKind::Read);
        assert_eq!(plan.handlers[0].1, "test");
    }

    #[test]
    fn config_default_has_unified_exec_enabled() {
        let config = ToolPlanConfig::default();
        assert!(config.use_unified_exec);
        assert!(config.use_shell_command);
        assert!(config.code_search);
    }

    #[test]
    fn config_from_app_config_copies_disabled_code_search() {
        let app_config = AppConfig {
            experimental: infinitecode_config::ExperimentalConfig { code_search: false },
            ..AppConfig::default()
        };
        let config = ToolPlanConfig::from_app_config(&app_config);

        assert!(!config.code_search);
    }

    #[test]
    fn config_validate_does_not_panic() {
        let config = ToolPlanConfig::default();
        config.validate(); // should not panic
    }

    #[test]
    fn schema_exec_command_requires_cmd() {
        let schema = exec_command_schema();
        let required = schema.required.as_ref().unwrap();
        assert!(required.contains(&"cmd".to_string()));
        assert!(
            schema
                .properties
                .as_ref()
                .is_some_and(|properties| properties.contains_key("execution_mode"))
        );
    }

    #[test]
    fn schema_write_stdin_requires_session_id() {
        let schema = write_stdin_schema();
        let required = schema.required.as_ref().unwrap();
        assert!(required.contains(&"session_id".to_string()));
    }

    #[test]
    fn schema_invalid_has_no_required() {
        let schema = invalid_schema();
        // invalid tool has no required fields and no properties
        assert!(schema.properties.as_ref().unwrap().is_empty());
    }

    #[test]
    fn shell_command_schema_has_command_and_cmd() {
        let schema = shell_command_schema();
        let props = schema.properties.as_ref().unwrap();
        assert!(props.contains_key("command"));
        assert!(props.contains_key("cmd"));
        assert!(props.contains_key("timeout_ms"));
        assert!(props.contains_key("tty"));
    }

    #[test]
    fn plan_builder_without_unified_exec() {
        let plan = build_tool_registry_plan(&ToolPlanConfig {
            use_unified_exec: false,
            ..ToolPlanConfig::default()
        });
        let handler_names: Vec<&str> = plan.handlers.iter().map(|(_, n)| n.as_str()).collect();
        assert!(!handler_names.contains(&"exec_command"));
        assert!(!handler_names.contains(&"write_stdin"));
    }

    #[test]
    fn plan_builder_registers_shell_command_not_bash_by_default() {
        let plan = build_tool_registry_plan(&ToolPlanConfig::default());
        let spec_names: Vec<&str> = plan.specs.iter().map(|spec| spec.name.as_str()).collect();

        assert!(spec_names.contains(&"shell_command"));
        assert!(!spec_names.contains(&"bash"));
        assert!(
            plan.handlers
                .iter()
                .any(|(kind, name)| *kind == ToolHandlerKind::Bash && name == "shell_command")
        );
    }

    #[test]
    fn plan_builder_registers_web_search_only_when_local_enabled() {
        let default_plan = build_tool_registry_plan(&ToolPlanConfig::default());
        let default_spec_names: Vec<&str> = default_plan
            .specs
            .iter()
            .map(|spec| spec.name.as_str())
            .collect();
        assert!(!default_spec_names.contains(&"web_search"));

        let local_plan = build_tool_registry_plan(&ToolPlanConfig {
            web_search: true,
            ..ToolPlanConfig::default()
        });
        let local_spec_names: Vec<&str> = local_plan
            .specs
            .iter()
            .map(|spec| spec.name.as_str())
            .collect();
        assert!(local_spec_names.contains(&"web_search"));
        assert!(!local_spec_names.contains(&"websearch"));
        let web_search_spec = local_plan
            .specs
            .iter()
            .find(|spec| spec.name == "web_search")
            .expect("web_search spec");
        assert!(web_search_spec.description.contains("Sources:"));
    }

    #[test]
    fn plan_builder_registers_webfetch_only_when_local_enabled() {
        let local_plan = build_tool_registry_plan(&ToolPlanConfig::default());
        let local_spec_names: Vec<&str> = local_plan
            .specs
            .iter()
            .map(|spec| spec.name.as_str())
            .collect();
        assert!(local_spec_names.contains(&"webfetch"));

        let provider_plan = build_tool_registry_plan(&ToolPlanConfig {
            web_fetch: false,
            ..ToolPlanConfig::default()
        });
        let provider_spec_names: Vec<&str> = provider_plan
            .specs
            .iter()
            .map(|spec| spec.name.as_str())
            .collect();
        assert!(!provider_spec_names.contains(&"webfetch"));
    }

    #[test]
    fn plan_builder_registers_find_not_glob() {
        let plan = build_tool_registry_plan(&ToolPlanConfig::default());
        let spec_names: Vec<&str> = plan.specs.iter().map(|spec| spec.name.as_str()).collect();

        assert!(spec_names.contains(&"find"));
        assert!(!spec_names.contains(&"glob"));
        assert!(
            plan.handlers
                .iter()
                .any(|(kind, name)| *kind == ToolHandlerKind::Glob && name == "find")
        );
    }

    /// Trace: L2-DES-TOOL-001
    /// Verifies: semantic code retrieval is registered as a read-only parallel workspace search tool.
    #[test]
    fn plan_builder_omits_code_search_when_disabled() {
        let plan = build_tool_registry_plan(&ToolPlanConfig {
            code_search: false,
            ..ToolPlanConfig::default()
        });
        let spec_names: Vec<&str> = plan.specs.iter().map(|spec| spec.name.as_str()).collect();
        let handler_names: Vec<&str> = plan
            .handlers
            .iter()
            .map(|(_, name)| name.as_str())
            .collect();

        assert!(!spec_names.contains(&"code_search"));
        assert!(!handler_names.contains(&"code_search"));
    }

    /// Trace: L2-DES-TOOL-001
    /// Verifies: semantic code retrieval is registered as a read-only parallel workspace search tool.
    #[test]
    fn plan_builder_registers_code_search_by_default() {
        let plan = build_tool_registry_plan(&ToolPlanConfig::default());
        let spec = plan
            .specs
            .iter()
            .find(|spec| spec.name == "code_search")
            .expect("code_search spec");

        assert_eq!(spec.execution_mode, ToolExecutionMode::ReadOnly);
        assert_eq!(spec.output_mode, ToolOutputMode::StructuredJson);
        assert_eq!(spec.supports_parallel, true);
        assert_eq!(spec.supports_cancellation, Some(true));
        assert!(
            spec.capability_tags
                .contains(&ToolCapabilityTag::SearchWorkspace)
        );
        assert!(
            plan.handlers
                .iter()
                .any(|(kind, name)| *kind == ToolHandlerKind::CodeSearch && name == "code_search")
        );
    }
}
