use std::path::Path;
use std::path::PathBuf;

use devo_protocol::parse_command::ParsedCommand;

pub(crate) fn read_action_from_tool_input(
    command: &str,
    input: &serde_json::Value,
) -> Option<ParsedCommand> {
    let path = input
        .get("filePath")
        .or_else(|| input.get("path"))
        .and_then(serde_json::Value::as_str)?
        .trim();
    if path.is_empty() {
        return None;
    }

    let name = Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());

    Some(ParsedCommand::Read {
        cmd: command.to_string(),
        name,
        path: PathBuf::from(path),
    })
}

pub(crate) fn read_action_from_tool_summary(summary: &str) -> Option<ParsedCommand> {
    let path = summary
        .strip_prefix("read: ")
        .or_else(|| summary.strip_prefix("read "))
        .unwrap_or_default()
        .trim();
    let path = path
        .split_once(" (offset:")
        .or_else(|| path.split_once(" (limit:"))
        .map_or(path, |(path, _)| path)
        .trim();
    if path.is_empty() {
        return None;
    }

    let input = serde_json::json!({ "filePath": path });
    read_action_from_tool_input(&summary.replacen(": ", " ", 1), &input)
}
