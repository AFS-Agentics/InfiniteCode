//! User-facing CLI entrypoint for interactive, prompt, diagnostic, upgrade,
//! and hidden server process modes.
//!
//! This binary owns command-line parsing, startup update checks, logging
//! bootstrap, and final exit messages. Long-lived runtime behavior is delegated
//! to the server, TUI, and core crates so CLI changes stay focused on process
//! orchestration and display.

use anyhow::Result;
use clap::Parser;
use clap::Subcommand;
use clap::builder::PossibleValuesParser;
use clap::builder::TypedValueParser as _;
use infinitecode_core::AppConfig;
use infinitecode_core::AppConfigLoader;
use infinitecode_core::CompactStrategy;
use infinitecode_core::FileSystemAppConfigLoader;
use infinitecode_core::LoggingBootstrap;
use infinitecode_core::LoggingRuntime;
use infinitecode_core::SessionId;
use infinitecode_core::UpdateCheckOutcome;
use infinitecode_core::UpdateChecker;
use infinitecode_core::format_update_notification;
use infinitecode_server::ServerProcessArgs;
use infinitecode_server::ServerProcessRunOptions;
use infinitecode_server::ServerTransportMode;
use infinitecode_server::run_server_process;
use infinitecode_util_paths::find_infinitecode_home;
use tracing_subscriber::filter::LevelFilter;

mod agent_command;
mod doctor_command;
mod prompt_command;
mod upgrade_command;

use agent_command::run_agent;
use doctor_command::run_doctor;
use prompt_command::PromptOutputFormat;
use prompt_command::run_prompt;
use upgrade_command::run_upgrade;

/// Top-level `infinitecode` command that dispatches to interactive agent mode or one
/// of the supporting runtime subcommands.
///
#[derive(Debug, Parser)]
#[command(name = "infinitecode", version, about = "InfiniteCode CLI")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,

    /// Override the model used for this session.
    #[arg(long, global = true)]
    model: Option<String>,

    /// Override the logging level for this process.
    #[arg(
        long = "log-level",
        global = true,
        value_parser = PossibleValuesParser::new(["trace", "debug", "info", "warn", "error"])
            .try_map(|level| level.parse::<LevelFilter>())
    )]
    log_level: Option<LevelFilter>,

    /// Start with full-access permissions, skipping approval prompts.
    #[arg(
        long = "dangerously-skip-permissions",
        visible_alias = "yolo",
        global = true
    )]
    dangerously_skip_permissions: bool,

    /// Opt-in self-verification: the model gets a `<verify_solution_protocol>`
    /// block in its system prompt and is encouraged to call the
    /// `verify_solution` tool before submitting non-trivial final answers.
    /// Off by default. Use `--no-self-verify` to explicitly disable.
    #[arg(
        long = "self-verify",
        global = true,
        default_missing_value = "true",
        num_args = 0..=1,
        conflicts_with = "no_self_verify"
    )]
    self_verify: Option<bool>,

    /// Explicitly disable self-verification, overriding any config.toml or
    /// env-var setting.
    #[arg(long = "no-self-verify", global = true)]
    no_self_verify: bool,

    /// Opt-in / opt-out of clickable "What's next?" chip suggestions at
    /// the end of non-trivial turns. On by default. Use
    /// `--no-suggest-followups` to explicitly disable (cuts a small
    /// `<suggest_followups_protocol>` block from the system prompt).
    #[arg(
        long = "suggest-followups",
        global = true,
        default_missing_value = "true",
        num_args = 0..=1,
        conflicts_with = "no_suggest_followups"
    )]
    suggest_followups: Option<bool>,

    /// Explicitly disable suggest-followups, overriding any config.toml or
    /// env-var setting.
    #[arg(long = "no-suggest-followups", global = true)]
    no_suggest_followups: bool,

    /// Context-compaction strategy. `auto` preserves existing behavior
    /// (compact at the configured threshold), `conservative` waits until
    /// 95% of the input budget, `aggressive` triggers at 60%, `off`
    /// disables auto-compaction entirely (manual `/compact` only).
    #[arg(long = "compact-strategy", global = true, value_parser = PossibleValuesParser::new(["auto", "conservative", "aggressive", "off"]))]
    compact_strategy: Option<String>,

    /// Percent of the input budget at which auto-compaction fires, used
    /// only when `--compact-strategy auto` (or unset). Range 50-95.
    #[arg(long = "compact-threshold", global = true, value_parser = clap::value_parser!(u8).range(50..=95))]
    compact_threshold: Option<u8>,

    /// Opt-in multi-solution exploration: the agent generates N proposals
    /// using `preview_edit`/`preview_write` tools, then selects the best one
    /// and applies it. Off by default.
    #[arg(long = "explore-solutions", global = true)]
    explore_solutions: bool,

    /// Opt-in change audit: after edits, the agent reviews from quality,
    /// security, and performance perspectives before finalizing. Off by
    /// default.
    #[arg(long = "audit", global = true)]
    audit_changes: bool,
}

fn main() -> Result<()> {
    // Strict one-session-per-user enforcement. If another infinitecode
    // instance is live, this binary exits 75 with a friendly message before
    // touching stdin / TUI / stdio transport. Mirrors Freebuff's
    // `cli-engine/src/hooks/helpers/send-message.ts:600-612` UX (a 2nd CLI
    // running while one is already seated).
    infinitecode_core::session_lock::ensure_single_cli_session_or_exit(None);
    infinitecode_arg0::run_as_with_early_dispatch(
        |_paths| async {
            let result = run_cli().await;
            tracing::info!(success = result.is_ok(), "run_cli future completed");
            result
        },
        |_paths| direct_server_early_dispatch(),
    )
}

fn format_with_separators(value: usize) -> String {
    let digits = value.to_string();
    let separator_count = digits.len().saturating_sub(1) / 3;
    let first_group_len = digits.len() - separator_count * 3;
    let mut out = String::with_capacity(digits.len() + separator_count);
    for (index, ch) in digits.chars().enumerate() {
        if index > 0 && index >= first_group_len && (index - first_group_len).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

fn format_token_usage_line(
    exit: &infinitecode_tui::AppExit,
    color_enabled: bool,
) -> Option<String> {
    let total = exit.total_tokens;
    let non_cached_input = exit
        .total_input_tokens
        .saturating_sub(exit.total_cache_read_tokens);
    if total == 0 && exit.total_cache_read_tokens == 0 {
        return None;
    }
    let total_value = format_with_separators(total);
    let input_value = format_with_separators(non_cached_input);
    let output_value = format_with_separators(exit.total_output_tokens);
    let cached_suffix = if exit.total_cache_read_tokens > 0 {
        let cached_value = format_with_separators(exit.total_cache_read_tokens);
        if color_enabled {
            format!(" (+ \u{1b}[1;33m{cached_value}\u{1b}[0m \u{1b}[33mcached\u{1b}[0m)")
        } else {
            format!(" (+ {cached_value} cached)")
        }
    } else {
        String::new()
    };
    Some(format!(
        "Token usage: total={} input={}{} output={}",
        if color_enabled {
            format!("\u{1b}[1;36m{total_value}\u{1b}[0m")
        } else {
            total_value
        },
        if color_enabled {
            format!("\u{1b}[1;32m{input_value}\u{1b}[0m")
        } else {
            input_value
        },
        cached_suffix,
        if color_enabled {
            format!("\u{1b}[1;35m{output_value}\u{1b}[0m")
        } else {
            output_value
        },
    ))
}

fn exit_messages(exit: &infinitecode_tui::AppExit, color_enabled: bool) -> Vec<String> {
    let mut lines = Vec::new();
    if let Some(line) = format_token_usage_line(exit, color_enabled) {
        lines.push(line);
    }
    if let Some(session_id) = exit.session_id {
        let command = format!("infinitecode resume {session_id}");
        let command = if color_enabled {
            format!("\u{1b}[1;36m{command}\u{1b}[0m")
        } else {
            command
        };
        let prefix = if color_enabled {
            "\u{1b}[2mTo continue this session, run\u{1b}[0m"
        } else {
            "To continue this session, run"
        };
        lines.push(format!("{prefix} {command}"));
    }
    lines
}

fn onboarding_exit_messages(exit: &infinitecode_tui::AppExit, color_enabled: bool) -> Vec<String> {
    if !exit.onboarding_completed {
        return Vec::new();
    }
    let complete = if color_enabled {
        "\u{1b}[1;32mConfiguration complete\u{1b}[0m".to_string()
    } else {
        "Configuration complete".to_string()
    };
    let command = if color_enabled {
        "\u{1b}[1;36minfinitecode\u{1b}[0m".to_string()
    } else {
        "infinitecode".to_string()
    };
    vec![
        complete,
        String::new(),
        "Next step:".to_string(),
        format!("  {command}"),
    ]
}

async fn run_cli() -> Result<()> {
    let cli = Cli::parse();
    let log_level = cli.log_level.map(|level| level.to_string());

    match &cli.command {
        Some(Command::Onboard) => {
            // Resolve logging config early, install the process-wide file subscriber,
            // and keep its non-blocking writer guard alive for the command lifetime.
            let _logging = install_logging(&cli)?;
            let exit = run_agent(
                /*force_onboarding*/ true,
                /*exit_after_onboarding*/ true,
                log_level.as_deref(),
                None,
                cli.dangerously_skip_permissions,
            )
            .await?;
            for line in onboarding_exit_messages(&exit, /*color_enabled*/ true) {
                println!("{line}");
            }
            Ok(())
        }
        Some(Command::Prompt { input, format }) => {
            maybe_print_startup_update(&cli).await;
            let _logging = install_logging(&cli)?;
            run_prompt(input, cli.model.as_deref(), log_level.as_deref(), *format).await
        }
        Some(Command::Doctor) => {
            let _logging = install_logging(&cli)?;
            run_doctor().await
        }
        Some(Command::Upgrade) => run_upgrade(),
        Some(Command::Resume { session_id }) => {
            maybe_print_startup_update(&cli).await;
            let _logging = install_logging(&cli)?;
            let exit = run_agent(
                /*force_onboarding*/ false,
                /*exit_after_onboarding*/ false,
                log_level.as_deref(),
                Some(*session_id),
                cli.dangerously_skip_permissions,
            )
            .await?;
            for line in exit_messages(&exit, /*color_enabled*/ true) {
                println!("{line}");
            }
            Ok(())
        }
        Some(Command::Server {
            transport: _,
            status: _,
            shutdown: _,
        }) => {
            // Start tokio-console before file logging so the console subscriber
            // can capture task instrumentation. File logging will fall back
            // gracefully if a subscriber is already installed.
            infinitecode_arg0::maybe_init_tokio_console();
            let args = server_process_args_from_cli(&cli).expect("server command args");
            let _logging = install_server_logging(&cli)?;
            run_server_process(args, ServerProcessRunOptions::default()).await
        }
        None => {
            maybe_print_startup_update(&cli).await;
            let _logging = install_logging(&cli)?;
            tracing::info!("default interactive command starting");
            let exit = run_agent(
                /*force_onboarding*/ false,
                /*exit_after_onboarding*/ false,
                log_level.as_deref(),
                None,
                cli.dangerously_skip_permissions,
            )
            .await?;
            let exit_lines = exit_messages(&exit, /*color_enabled*/ true);
            tracing::info!(
                line_count = exit_lines.len(),
                "printing default interactive exit messages"
            );
            for line in exit_lines {
                println!("{line}");
            }
            tracing::info!("default interactive command completed");
            Ok(())
        }
    }
}

fn direct_server_early_dispatch() -> infinitecode_arg0::EarlyDispatch {
    infinitecode_arg0::EarlyDispatch::Continue
}

fn server_process_args_from_cli(cli: &Cli) -> Option<ServerProcessArgs> {
    match &cli.command {
        Some(Command::Server {
            transport,
            status,
            shutdown,
        }) => Some(ServerProcessArgs {
            transport: *transport,
            status: *status,
            shutdown: *shutdown,
        }),
        Some(Command::Onboard)
        | Some(Command::Resume { .. })
        | Some(Command::Prompt { .. })
        | Some(Command::Doctor)
        | Some(Command::Upgrade)
        | None => None,
    }
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Launch the interactive onboarding flow to configure a model provider.
    Onboard,
    /// Resume a saved interactive session by id.
    Resume {
        /// Session identifier printed by InfiniteCode at exit time.
        session_id: SessionId,
    },
    /// Send a single prompt to the model and print the response (non-interactive).
    Prompt {
        /// Output format for non-interactive prompt execution.
        #[arg(long, value_enum, default_value_t = PromptOutputFormat::Text)]
        format: PromptOutputFormat,
        /// The prompt text to send to the model.
        input: String,
    },
    /// Diagnose configuration, provider connectivity, and system health.
    Doctor,
    /// Upgrade InfiniteCode to the latest released version.
    Upgrade,
    /// Start the runtime server process.
    #[command(hide = true)]
    Server {
        /// Override the transport mode used by this server process.
        #[arg(long, value_enum, hide = true, default_value_t = ServerTransportMode::Config)]
        transport: ServerTransportMode,
        /// Print status for an existing singleton server and exit.
        #[arg(long, hide = true)]
        status: bool,
        /// Ask an existing singleton server to shut down and exit.
        #[arg(long, hide = true)]
        shutdown: bool,
    },
}

async fn maybe_print_startup_update(cli: &Cli) {
    let Ok(home_dir) = find_infinitecode_home() else {
        return;
    };
    let app_config = FileSystemAppConfigLoader::new(home_dir.clone())
        .with_cli_overrides(merged_cli_overrides(cli))
        .load(Some(
            std::env::current_dir()
                .ok()
                .as_deref()
                .unwrap_or_else(|| std::path::Path::new(".")),
        ))
        .unwrap_or_else(|_| AppConfig::default());
    let Ok(checker) = UpdateChecker::new(home_dir, app_config.updates) else {
        return;
    };

    if let UpdateCheckOutcome::UpdateAvailable(notification) =
        checker.check_for_startup_update().await
    {
        eprintln!("{}", format_update_notification(&notification));
    }
}

fn install_logging(cli: &Cli) -> Result<LoggingRuntime> {
    let home_dir = find_infinitecode_home()?;
    let app_config = infinitecode_core::FileSystemAppConfigLoader::new(home_dir.clone())
        .with_cli_overrides(merged_cli_overrides(cli))
        .load(Some(std::env::current_dir()?.as_path()))
        .unwrap_or_else(|err| {
            eprintln!("warning: failed to load app config for logging: {err}");
            infinitecode_core::AppConfig::default()
        });
    LoggingBootstrap {
        process_name: "cli",
        config: app_config.logging,
        home_dir,
    }
    .install()
    .map_err(Into::into)
}

fn install_server_logging(cli: &Cli) -> Result<LoggingRuntime> {
    let home_dir = find_infinitecode_home()?;
    let loader = infinitecode_core::FileSystemAppConfigLoader::new(home_dir.clone())
        .with_cli_overrides(merged_cli_overrides(cli));
    let app_config = loader.load(/*workspace_root*/ None).unwrap_or_else(|err| {
        eprintln!("warning: failed to load app config for logging: {err}");
        infinitecode_core::AppConfig::default()
    });
    LoggingBootstrap {
        process_name: "server",
        config: app_config.logging,
        home_dir,
    }
    .install()
    .map_err(Into::into)
}

fn cli_logging_overrides(cli: &Cli) -> toml::Value {
    let Some(log_level) = cli.log_level else {
        return toml::Value::Table(Default::default());
    };

    toml::Value::Table(toml::map::Map::from_iter([(
        "logging".to_string(),
        toml::Value::Table(toml::map::Map::from_iter([(
            "level".to_string(),
            toml::Value::String(log_level.to_string()),
        )])),
    )]))
}

/// Builds a `toml::Value` overlay from CLI flags that override
/// `AppConfig.agent_behavior`. Layered on top of the user/project TOML by
/// the FileSystemAppConfigLoader. Env vars (`INFINITECODE_SELF_VERIFY`,
/// `INFINITECODE_COMPACT_STRATEGY`, `INFINITECODE_COMPACT_THRESHOLD`) apply
/// on top of this overlay at load time.
fn cli_agent_behavior_overrides(cli: &Cli) -> toml::Value {
    let self_verify: Option<bool> = if cli.no_self_verify {
        Some(false)
    } else {
        cli.self_verify
    };
    let suggest_followups: Option<bool> = if cli.no_suggest_followups {
        Some(false)
    } else {
        cli.suggest_followups
    };
    if self_verify.is_none()
        && suggest_followups.is_none()
        && cli.compact_strategy.is_none()
        && cli.compact_threshold.is_none()
        && !cli.explore_solutions
        && !cli.audit_changes
    {
        return toml::Value::Table(Default::default());
    }

    let mut behavior_table = toml::map::Map::new();
    if let Some(value) = self_verify {
        behavior_table.insert("self_verify".to_string(), toml::Value::Boolean(value));
    }
    if let Some(value) = suggest_followups {
        behavior_table.insert("suggest_followups".to_string(), toml::Value::Boolean(value));
    }
    if cli.explore_solutions {
        behavior_table.insert(
            "explore_solutions".to_string(),
            toml::Value::Boolean(true),
        );
    }
    if cli.audit_changes {
        behavior_table.insert(
            "audit_changes".to_string(),
            toml::Value::Boolean(true),
        );
    }
    if let Some(strategy) = &cli.compact_strategy {
        behavior_table.insert(
            "compact_strategy".to_string(),
            toml::Value::String(cli_strategy_to_toml(strategy).to_string()),
        );
    }
    if let Some(threshold) = cli.compact_threshold {
        behavior_table.insert(
            "compact_threshold_percent".to_string(),
            toml::Value::Integer(threshold as i64),
        );
    }

    toml::Value::Table(toml::map::Map::from_iter([(
        "agent_behavior".to_string(),
        toml::Value::Table(behavior_table),
    )]))
}

fn cli_strategy_to_toml(value: &str) -> &'static str {
    match value {
        "auto" => "auto",
        "conservative" => "conservative",
        "aggressive" => "aggressive",
        "off" => "off",
        _ => "auto",
    }
}

/// Combines `--log-level` and the agent-behavior flags into a single
/// `toml::Value` overlay for the FileSystemAppConfigLoader. Both are layered
/// on top of the user/project TOML but under env-var overrides.
fn merged_cli_overrides(cli: &Cli) -> toml::Value {
    let logging = cli_logging_overrides(cli);
    let behavior = cli_agent_behavior_overrides(cli);
    if let (toml::Value::Table(_), toml::Value::Table(_)) = (&logging, &behavior) {
        if logging.as_table().map_or(true, |t| t.is_empty())
            && behavior.as_table().map_or(true, |t| t.is_empty())
        {
            return toml::Value::Table(Default::default());
        }
    }
    let mut merged = toml::map::Map::new();
    if let toml::Value::Table(logging_table) = logging {
        for (key, value) in logging_table {
            merged.insert(key, value);
        }
    }
    if let toml::Value::Table(behavior_table) = behavior {
        for (key, value) in behavior_table {
            merged.insert(key, value);
        }
    }
    toml::Value::Table(merged)
}

#[cfg(test)]
mod tests {
    use clap::Parser;
    use infinitecode_core::SessionId;
    use pretty_assertions::assert_eq;
    use tracing_subscriber::filter::LevelFilter;

    use super::Cli;
    use super::Command;
    use super::PromptOutputFormat;
    use super::cli_logging_overrides;
    use super::exit_messages;
    use super::format_token_usage_line;
    use super::onboarding_exit_messages;

    #[test]
    fn cli_parses_supported_log_levels() {
        for (level, expected) in [
            ("trace", LevelFilter::TRACE),
            ("debug", LevelFilter::DEBUG),
            ("info", LevelFilter::INFO),
            ("warn", LevelFilter::WARN),
            ("error", LevelFilter::ERROR),
        ] {
            let cli = Cli::try_parse_from(["infinitecode", "--log-level", level])
                .expect("parse log level");

            assert!(cli.command.is_none());
            assert_eq!(cli.log_level, Some(expected));
        }
    }

    #[test]
    fn cli_parses_dangerously_skip_permissions_flag() {
        let cli = Cli::try_parse_from(["infinitecode", "--dangerously-skip-permissions"])
            .expect("parse dangerously-skip-permissions");

        assert!(cli.command.is_none());
        assert!(cli.dangerously_skip_permissions);
    }

    #[test]
    fn cli_parses_yolo_alias_for_dangerously_skip_permissions() {
        let cli = Cli::try_parse_from(["infinitecode", "--yolo"]).expect("parse yolo");

        assert!(cli.command.is_none());
        assert!(cli.dangerously_skip_permissions);
    }

    #[test]
    fn cli_parses_yolo_alias_on_resume_subcommand() {
        let session_id = SessionId::new();
        let cli =
            Cli::try_parse_from(["infinitecode", "resume", &session_id.to_string(), "--yolo"])
                .expect("parse resume with yolo");

        assert!(matches!(cli.command, Some(Command::Resume { .. })));
        assert!(cli.dangerously_skip_permissions);
    }

    #[test]
    fn cli_rejects_unsupported_log_levels() {
        let err =
            Cli::try_parse_from(["infinitecode", "--log-level", "off"]).expect_err("reject off");

        assert_eq!(err.kind(), clap::error::ErrorKind::InvalidValue);
    }

    #[test]
    fn cli_logging_overrides_sets_logging_level() {
        for (level, expected) in [
            (LevelFilter::TRACE, "trace"),
            (LevelFilter::DEBUG, "debug"),
            (LevelFilter::INFO, "info"),
            (LevelFilter::WARN, "warn"),
            (LevelFilter::ERROR, "error"),
        ] {
            let cli = Cli {
                command: None,
                model: None,
                log_level: Some(level),
                dangerously_skip_permissions: false,
                            self_verify: None,
                no_self_verify: false,
                compact_strategy: None,
                compact_threshold: None,
            };

            assert_eq!(
                cli_logging_overrides(&cli),
                toml::Value::Table(toml::map::Map::from_iter([(
                    "logging".to_string(),
                    toml::Value::Table(toml::map::Map::from_iter([(
                        "level".to_string(),
                        toml::Value::String(expected.to_string()),
                    )])),
                )]))
            );
        }
    }

    #[test]
    fn startup_update_check_scope_covers_expected_user_facing_commands() {
        for cli in [
            Cli {
                command: None,
                model: None,
                log_level: None,
                dangerously_skip_permissions: false,
                            self_verify: None,
                no_self_verify: false,
                compact_strategy: None,
                compact_threshold: None,
            },
            Cli {
                command: Some(Command::Onboard),
                model: None,
                log_level: None,
                dangerously_skip_permissions: false,
                            self_verify: None,
                no_self_verify: false,
                compact_strategy: None,
                compact_threshold: None,
            },
            Cli {
                command: Some(Command::Prompt {
                    input: "hello".to_string(),
                    format: PromptOutputFormat::Text,
                }),
                model: None,
                log_level: None,
                dangerously_skip_permissions: false,
                            self_verify: None,
                no_self_verify: false,
                compact_strategy: None,
                compact_threshold: None,
            },
        ] {
            assert_eq!(
                matches!(
                    cli.command,
                    None | Some(Command::Onboard) | Some(Command::Prompt { .. })
                ),
                true
            );
        }
    }

    #[test]
    fn startup_update_check_scope_skips_server_and_doctor() {
        let doctor = Cli {
            command: Some(Command::Doctor),
            model: None,
            log_level: None,
            dangerously_skip_permissions: false,
                        self_verify: None,
                no_self_verify: false,
                compact_strategy: None,
                compact_threshold: None,
            };
        let server = Cli {
            command: Some(Command::Server {
                transport: infinitecode_server::ServerTransportMode::Config,
                status: false,
                shutdown: false,
            }),
            model: None,
            log_level: None,
            dangerously_skip_permissions: false,
                        self_verify: None,
                no_self_verify: false,
                compact_strategy: None,
                compact_threshold: None,
            };

        assert_eq!(
            matches!(
                doctor.command,
                None | Some(Command::Onboard) | Some(Command::Prompt { .. })
            ),
            false
        );
        assert_eq!(
            matches!(
                server.command,
                None | Some(Command::Onboard) | Some(Command::Prompt { .. })
            ),
            false
        );
    }

    #[test]
    fn cli_parses_resume_subcommand() {
        let session_id = SessionId::new();
        let cli = Cli::try_parse_from(["infinitecode", "resume", &session_id.to_string()])
            .expect("parse resume");

        match cli.command {
            Some(Command::Resume { session_id: actual }) => assert_eq!(actual, session_id),
            other => panic!("expected resume command, got {other:?}"),
        }
    }

    #[test]
    fn cli_parses_prompt_jsonl_output_format() {
        let cli = Cli::try_parse_from(["infinitecode", "prompt", "--format", "jsonl", "hello"])
            .expect("parse");

        match cli.command {
            Some(Command::Prompt { input, format }) => {
                assert_eq!(input, "hello");
                assert_eq!(format, PromptOutputFormat::Jsonl);
            }
            other => panic!("expected prompt command, got {other:?}"),
        }
    }

    #[test]
    fn cli_parses_upgrade_subcommand() {
        let cli = Cli::try_parse_from(["infinitecode", "upgrade"]).expect("parse upgrade");

        match cli.command {
            Some(Command::Upgrade) => {}
            other => panic!("expected upgrade command, got {other:?}"),
        }
    }

    #[test]
    fn cli_parses_server_status_and_shutdown_flags() {
        let status =
            Cli::try_parse_from(["infinitecode", "server", "--status"]).expect("parse status");
        let shutdown =
            Cli::try_parse_from(["infinitecode", "server", "--shutdown"]).expect("parse shutdown");

        match status.command {
            Some(Command::Server {
                transport,
                status,
                shutdown,
            }) => {
                assert_eq!(transport, infinitecode_server::ServerTransportMode::Config);
                assert_eq!([status, shutdown], [true, false]);
            }
            other => panic!("expected server command, got {other:?}"),
        }
        match shutdown.command {
            Some(Command::Server {
                transport,
                status,
                shutdown,
            }) => {
                assert_eq!(transport, infinitecode_server::ServerTransportMode::Config);
                assert_eq!([status, shutdown], [false, true]);
            }
            other => panic!("expected server command, got {other:?}"),
        }
    }

    #[test]
    fn cli_parses_websocket_server_transport_override() {
        let cli = Cli::try_parse_from(["infinitecode", "server", "--transport", "websocket"])
            .expect("parse websocket server transport");

        match cli.command {
            Some(Command::Server { transport, .. }) => {
                assert_eq!(
                    transport,
                    infinitecode_server::ServerTransportMode::WebSocket
                );
            }
            other => panic!("expected server command, got {other:?}"),
        }
    }

    #[test]
    fn server_process_args_from_cli_extracts_stdio_server_command() {
        let cli = Cli::try_parse_from(["infinitecode", "server", "--transport", "stdio"])
            .expect("parse server");

        assert_eq!(
            super::server_process_args_from_cli(&cli),
            Some(infinitecode_server::ServerProcessArgs {
                transport: infinitecode_server::ServerTransportMode::Stdio,
                status: false,
                shutdown: false,
            })
        );
    }

    #[test]
    fn server_process_args_from_cli_preserves_global_log_level_parse() {
        let cli =
            Cli::try_parse_from(["infinitecode", "--log-level", "debug", "server", "--status"])
                .expect("parse server");

        assert_eq!(cli.log_level, Some(LevelFilter::DEBUG));
        assert_eq!(
            super::server_process_args_from_cli(&cli),
            Some(infinitecode_server::ServerProcessArgs {
                transport: infinitecode_server::ServerTransportMode::Config,
                status: true,
                shutdown: false,
            })
        );
    }

    #[test]
    fn server_process_args_from_cli_skips_non_server_command() {
        let cli = Cli::try_parse_from(["infinitecode", "doctor"]).expect("parse doctor");

        assert_eq!(super::server_process_args_from_cli(&cli), None);
    }

    #[test]
    fn exit_messages_includes_usage_and_resume_hint() {
        let session_id = SessionId::new();
        let exit = infinitecode_tui::AppExit {
            session_id: Some(session_id),
            onboarding_completed: false,
            turn_count: 1,
            total_input_tokens: 10,
            total_output_tokens: 2,
            total_tokens: 12,
            total_cache_read_tokens: 5,
        };

        let lines = exit_messages(&exit, /*color_enabled*/ false);
        assert_eq!(
            lines[0],
            "Token usage: total=12 input=5 (+ 5 cached) output=2"
        );
        assert_eq!(
            lines[1],
            format!("To continue this session, run infinitecode resume {session_id}")
        );
    }

    #[test]
    fn colorized_exit_messages_include_ansi_sequences() {
        let session_id = SessionId::new();
        let exit = infinitecode_tui::AppExit {
            session_id: Some(session_id),
            onboarding_completed: false,
            turn_count: 1,
            total_input_tokens: 10,
            total_output_tokens: 2,
            total_tokens: 12,
            total_cache_read_tokens: 5,
        };

        let usage = format_token_usage_line(&exit, /*color_enabled*/ true).expect("usage line");
        assert!(usage.contains("\u{1b}["));

        let lines = exit_messages(&exit, /*color_enabled*/ true);
        assert!(lines[1].contains("\u{1b}["));
    }

    #[test]
    fn exit_usage_uses_accumulated_display_total() {
        let exit = infinitecode_tui::AppExit {
            session_id: Some(SessionId::new()),
            onboarding_completed: false,
            turn_count: 1,
            total_input_tokens: 10,
            total_output_tokens: 2,
            total_tokens: 25,
            total_cache_read_tokens: 0,
        };

        assert_eq!(
            format_token_usage_line(&exit, /*color_enabled*/ false),
            Some("Token usage: total=25 input=10 output=2".to_string())
        );
    }

    #[test]
    fn onboarding_exit_messages_include_next_step_after_success() {
        let session_id = SessionId::new();
        let exit = infinitecode_tui::AppExit {
            session_id: Some(session_id),
            onboarding_completed: true,
            turn_count: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_tokens: 0,
            total_cache_read_tokens: 0,
        };

        let lines = onboarding_exit_messages(&exit, /*color_enabled*/ false);

        assert_eq!(
            lines,
            vec![
                "Configuration complete".to_string(),
                String::new(),
                "Next step:".to_string(),
                "  infinitecode".to_string(),
            ]
        );
        assert_eq!(
            lines
                .iter()
                .any(|line| line.contains("infinitecode resume")),
            false
        );
    }

    #[test]
    fn onboarding_exit_messages_are_empty_without_success() {
        let session_id = SessionId::new();
        let exit = infinitecode_tui::AppExit {
            session_id: Some(session_id),
            onboarding_completed: false,
            turn_count: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_tokens: 0,
            total_cache_read_tokens: 0,
        };

        assert_eq!(
            onboarding_exit_messages(&exit, /*color_enabled*/ false),
            Vec::<String>::new()
        );
    }

    #[test]
    fn colorized_onboarding_exit_messages_include_ansi_sequences() {
        let exit = infinitecode_tui::AppExit {
            session_id: None,
            onboarding_completed: true,
            turn_count: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_tokens: 0,
            total_cache_read_tokens: 0,
        };

        let lines = onboarding_exit_messages(&exit, /*color_enabled*/ true);

        assert!(lines[0].contains("\u{1b}["));
        assert!(lines[3].contains("\u{1b}["));
    }
}
