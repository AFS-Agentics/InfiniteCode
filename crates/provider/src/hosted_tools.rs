use devo_protocol::HostedToolDefinition;
use devo_protocol::HostedWebSearchTool;
use serde_json::Map;
use serde_json::Value;
use serde_json::json;

const DEFAULT_ANTHROPIC_WEB_SEARCH_TOOL_TYPE: &str = "web_search_20250305";

pub(crate) fn append_openai_responses_hosted_tools(
    root: &mut Value,
    hosted_tools: &[HostedToolDefinition],
) {
    for hosted_tool in hosted_tools {
        match hosted_tool {
            HostedToolDefinition::WebSearch(options) => push_tool(root, openai_web_search(options)),
        }
    }
}

pub(crate) fn apply_openai_chat_completions_hosted_tools(
    root: &mut Value,
    hosted_tools: &[HostedToolDefinition],
) {
    if let Some(HostedToolDefinition::WebSearch(options)) = hosted_tools.iter().next() {
        let mut value = Map::new();
        if let Some(search_context_size) = &options.search_context_size {
            value.insert(
                "search_context_size".to_string(),
                json!(search_context_size),
            );
        }
        root["web_search_options"] = Value::Object(value);
    }
}

pub(crate) fn append_anthropic_hosted_tools(
    root: &mut Value,
    hosted_tools: &[HostedToolDefinition],
) {
    for hosted_tool in hosted_tools {
        match hosted_tool {
            HostedToolDefinition::WebSearch(options) => {
                push_tool(root, anthropic_web_search(options));
            }
        }
    }
}

fn openai_web_search(options: &HostedWebSearchTool) -> Value {
    let mut value = Map::from_iter([("type".to_string(), json!("web_search"))]);
    if let Some(search_context_size) = &options.search_context_size {
        value.insert(
            "search_context_size".to_string(),
            json!(search_context_size),
        );
    }
    Value::Object(value)
}

fn anthropic_web_search(options: &HostedWebSearchTool) -> Value {
    let tool_type = options
        .anthropic_tool_type
        .as_deref()
        .unwrap_or(DEFAULT_ANTHROPIC_WEB_SEARCH_TOOL_TYPE);
    let mut value = Map::from_iter([
        ("type".to_string(), json!(tool_type)),
        ("name".to_string(), json!("web_search")),
    ]);
    if let Some(max_uses) = options.max_uses {
        value.insert("max_uses".to_string(), json!(max_uses));
    }
    Value::Object(value)
}

fn push_tool(root: &mut Value, tool: Value) {
    match root.get_mut("tools").and_then(Value::as_array_mut) {
        Some(tools) => tools.push(tool),
        None => root["tools"] = Value::Array(vec![tool]),
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use super::*;

    fn web_search_tools() -> Vec<HostedToolDefinition> {
        vec![HostedToolDefinition::WebSearch(HostedWebSearchTool::new())]
    }

    #[test]
    fn openai_responses_appends_hosted_web_search_tool() {
        let mut root = json!({ "tools": [] });

        append_openai_responses_hosted_tools(&mut root, &web_search_tools());

        assert_eq!(root["tools"], json!([{ "type": "web_search" }]));
    }

    #[test]
    fn openai_chat_completions_adds_web_search_options_without_touching_model() {
        let mut root = json!({ "model": "vendor/search-capable-model" });

        apply_openai_chat_completions_hosted_tools(&mut root, &web_search_tools());

        assert_eq!(root["model"], json!("vendor/search-capable-model"));
        assert_eq!(root["web_search_options"], json!({}));
    }

    #[test]
    fn anthropic_messages_appends_server_web_search_tool() {
        let mut root = json!({});

        append_anthropic_hosted_tools(&mut root, &web_search_tools());

        assert_eq!(
            root["tools"],
            json!([{ "type": "web_search_20250305", "name": "web_search" }])
        );
    }
}
