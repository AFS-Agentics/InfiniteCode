use std::path::PathBuf;
use std::time::Duration;

use anyhow::Context;
use anyhow::Result;
use pretty_assertions::assert_eq;
use tempfile::TempDir;
use tokio::io::AsyncBufReadExt;
use tokio::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;
use tokio::io::BufReader as AsyncBufReader;
use tokio::process::Command;
use tokio::time::timeout;

const STDIO_SERVER_STARTUP_TIMEOUT: Duration = Duration::from_secs(120);
const STDIO_SERVER_LINE_TIMEOUT: Duration = Duration::from_secs(30);

#[tokio::test]
async fn stdio_acp_initialize_negotiates_capabilities_and_allows_session_setup() -> Result<()> {
    let home_dir = TempDir::new()?;
    write_test_config(&home_dir, &["stdio://"])?;
    let test_cwd = home_dir.path().to_string_lossy().into_owned();

    let mut command = devo_command()?;
    let mut child = command
        .arg("server")
        .arg("--transport")
        .arg("stdio")
        .env("DEVO_HOME", home_dir.path().join(".devo"))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .context("spawn devo child process in server mode")?;

    let mut stdin = child.stdin.take().context("capture child stdin")?;
    let stdout = child.stdout.take().context("capture child stdout")?;
    let stderr = child.stderr.take().context("capture child stderr")?;
    let mut stdout_reader = AsyncBufReader::new(stdout).lines();
    let mut stderr_reader = AsyncBufReader::new(stderr);

    write_stdio_json(
        &mut stdin,
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": {
                "protocolVersion": 1,
                "clientCapabilities": {
                    "fs": {
                        "readTextFile": true,
                        "writeTextFile": true
                    },
                    "terminal": true
                },
                "clientInfo": {
                    "name": "acp-initialization-e2e",
                    "title": "ACP Initialization E2E",
                    "version": "1.0.0"
                }
            }
        }),
    )
    .await?;

    let initialize_response = read_stdio_json(
        &mut child,
        &mut stdout_reader,
        &mut stderr_reader,
        "ACP initialize response",
        STDIO_SERVER_STARTUP_TIMEOUT,
    )
    .await?;
    assert_eq!(initialize_response["jsonrpc"], serde_json::json!("2.0"));
    assert_eq!(initialize_response["id"], serde_json::json!(0));
    assert_eq!(
        initialize_response["result"]["protocolVersion"],
        serde_json::json!(1)
    );
    assert_eq!(
        initialize_response["result"]["agentCapabilities"]["loadSession"],
        serde_json::json!(true)
    );
    assert_eq!(
        initialize_response["result"]["agentCapabilities"]["promptCapabilities"],
        serde_json::json!({
            "image": false,
            "audio": false,
            "embeddedContext": true
        })
    );
    assert_eq!(
        initialize_response["result"]["agentCapabilities"]["mcpCapabilities"],
        serde_json::json!({
            "http": false,
            "sse": false
        })
    );
    assert_eq!(
        initialize_response["result"]["agentCapabilities"]["sessionCapabilities"],
        serde_json::json!({
            "list": {},
            "delete": {},
            "resume": {},
            "close": {}
        })
    );
    let auth_methods = &initialize_response["result"]["authMethods"];
    assert!(auth_methods.is_null() || auth_methods == &serde_json::json!([]));
    assert_eq!(
        initialize_response["result"]["agentInfo"]["name"],
        serde_json::json!("devo-server")
    );
    assert_eq!(
        initialize_response["result"]["agentInfo"]["title"],
        serde_json::json!("Devo")
    );
    assert!(
        initialize_response["result"]["agentInfo"]["version"]
            .as_str()
            .is_some_and(|version| !version.is_empty())
    );

    write_stdio_json(
        &mut stdin,
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "session/new",
            "params": {
                "cwd": test_cwd,
                "mcpServers": []
            }
        }),
    )
    .await?;

    let session_new_response = read_stdio_json_until(
        &mut child,
        &mut stdout_reader,
        &mut stderr_reader,
        "ACP session/new response",
        |value| value.get("id") == Some(&serde_json::json!(1)),
    )
    .await?;
    assert_eq!(session_new_response["jsonrpc"], serde_json::json!("2.0"));
    assert_eq!(session_new_response["id"], serde_json::json!(1));
    assert!(
        session_new_response["result"]["sessionId"]
            .as_str()
            .is_some_and(|session_id| !session_id.is_empty())
    );

    drop(stdin);
    child.kill().await.ok();
    let _ = child.wait().await;
    Ok(())
}

fn write_test_config(home_dir: &TempDir, listen: &[&str]) -> Result<()> {
    let config_dir = home_dir.path().join(".devo");

    std::fs::create_dir_all(&config_dir)?;
    let listen_entries = listen
        .iter()
        .map(|value| format!("\"{value}\""))
        .collect::<Vec<_>>()
        .join(", ");
    let config = format!(
        "[server]\nlisten = [{listen_entries}]\nmax_connections = 32\nevent_buffer_size = 128\nidle_session_timeout_secs = 300\npersist_ephemeral_sessions = false\n\n[defaults]\nmodel_binding = \"test-openai\"\n\n[providers.openai]\nenabled = true\nname = \"OpenAI\"\nwire_apis = [\"openai_chat_completions\"]\n\n[model_bindings.test-openai]\nenabled = true\nmodel_slug = \"test-model\"\nprovider = \"openai\"\nmodel_name = \"test-model\"\ninvocation_method = \"openai_chat_completions\"\n"
    );
    std::fs::write(config_dir.join("config.toml"), config)?;
    Ok(())
}

async fn write_stdio_json(
    stdin: &mut tokio::process::ChildStdin,
    value: serde_json::Value,
) -> Result<()> {
    stdin.write_all(format!("{value}\n").as_bytes()).await?;
    stdin.flush().await?;
    Ok(())
}

async fn read_stdio_json_until<F>(
    child: &mut tokio::process::Child,
    stdout_reader: &mut tokio::io::Lines<AsyncBufReader<tokio::process::ChildStdout>>,
    stderr_reader: &mut AsyncBufReader<tokio::process::ChildStderr>,
    context: &str,
    predicate: F,
) -> Result<serde_json::Value>
where
    F: Fn(&serde_json::Value) -> bool,
{
    timeout(STDIO_SERVER_LINE_TIMEOUT, async {
        loop {
            let value = read_stdio_json(
                child,
                stdout_reader,
                stderr_reader,
                context,
                STDIO_SERVER_LINE_TIMEOUT,
            )
            .await?;
            if predicate(&value) {
                return Ok(value);
            }
        }
    })
    .await
    .with_context(|| format!("timed out waiting for {context}"))?
}

async fn read_stdio_json(
    child: &mut tokio::process::Child,
    stdout_reader: &mut tokio::io::Lines<AsyncBufReader<tokio::process::ChildStdout>>,
    stderr_reader: &mut AsyncBufReader<tokio::process::ChildStderr>,
    context: &str,
    line_timeout: Duration,
) -> Result<serde_json::Value> {
    let line = timeout(line_timeout, stdout_reader.next_line())
        .await
        .with_context(|| format!("timed out waiting for {context}"))?
        .with_context(|| format!("failed reading {context} from child stdout"))?
        .with_context(|| format!("{context} reached EOF before a line was produced"))?;
    parse_stdio_json_line(child, stderr_reader, context, &line).await
}

async fn parse_stdio_json_line(
    child: &mut tokio::process::Child,
    stderr_reader: &mut AsyncBufReader<tokio::process::ChildStderr>,
    context: &str,
    line: &str,
) -> Result<serde_json::Value> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        let mut stderr_output = String::new();
        stderr_reader.read_to_string(&mut stderr_output).await?;
        let exit_status = child.try_wait()?;
        anyhow::bail!(
            "{context} was empty; child_exit_status={exit_status:?}; child_stderr={stderr_output:?}"
        );
    }

    serde_json::from_str(trimmed).with_context(|| {
        let exit_status = child.try_wait().ok().flatten();
        format!(
            "{context} was not valid JSON; raw_stdout_line={trimmed:?}; child_exit_status={exit_status:?}"
        )
    })
}

fn devo_command() -> Result<Command> {
    if let Some(binary_path) = std::env::var_os("CARGO_BIN_EXE_devo").map(PathBuf::from)
        && binary_path.is_file()
    {
        return Ok(Command::new(binary_path));
    }

    let binary_path = devo_binary_path()?;
    if binary_path.is_file() {
        return Ok(Command::new(binary_path));
    }

    let cargo_path = std::env::var_os("CARGO")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("cargo"));
    let mut command = Command::new(cargo_path);
    command
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .arg("run")
        .arg("--quiet")
        .arg("-p")
        .arg("devo-cli")
        .arg("--bin")
        .arg("devo")
        .arg("--");
    Ok(command)
}

fn devo_binary_path() -> Result<PathBuf> {
    let mut path = std::env::current_exe()?;
    path.pop();
    path.pop();
    path.push(if cfg!(windows) { "devo.exe" } else { "devo" });
    Ok(path)
}
