use serde::Deserialize;

use devo_core::SessionId;
use devo_core::tools::ToolContent;

use super::research_context::ResearchClarificationContext;

pub(super) fn parse_json_object<T>(text: &str) -> Option<T>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_str(text).ok().or_else(|| {
        let start = text.find('{')?;
        let end = text.rfind('}')?;
        serde_json::from_str(&text[start..=end]).ok()
    })
}

pub(super) fn is_request_user_input_tool_name(tool_name: &str) -> bool {
    matches!(tool_name, "request_user_input" | "question")
}

pub(super) fn request_user_input_questions_from_input(
    input: &serde_json::Value,
) -> Vec<(String, String)> {
    if let Some(question) = input
        .get("question")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|question| !question.is_empty())
    {
        return vec![("question".to_string(), question.to_string())];
    }

    let Some(questions) = input.get("questions").and_then(serde_json::Value::as_array) else {
        return Vec::new();
    };

    questions
        .iter()
        .filter_map(|question| {
            let id = question
                .get("id")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|id| !id.is_empty())?;
            let question_text = question
                .get("question")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|question| !question.is_empty())?;
            Some((id.to_string(), question_text.to_string()))
        })
        .collect()
}

pub(super) fn request_user_input_exchanges_from_response(
    questions: &[(String, String)],
    response: &devo_protocol::RequestUserInputResponse,
) -> Vec<ResearchClarificationContext> {
    questions
        .iter()
        .filter_map(|(id, question)| {
            let answer = response.answers.get(id)?;
            Some(ResearchClarificationContext {
                question: question.clone(),
                answer: first_non_empty_request_user_input_answer(answer).unwrap_or_default(),
            })
        })
        .collect()
}

fn first_non_empty_request_user_input_answer(
    answer: &devo_protocol::RequestUserInputAnswer,
) -> Option<String> {
    answer
        .answers
        .iter()
        .find(|text| !text.trim().is_empty())
        .cloned()
}

pub(super) fn is_spawn_agent_tool_name(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "spawn_agent" | "spawn_subagent" | "subagent" | "delegate"
    )
}

pub(super) fn spawn_agent_child_session_id(output: &serde_json::Value) -> Option<SessionId> {
    serde_json::from_value::<devo_protocol::SpawnAgentResult>(output.clone())
        .ok()
        .map(|result| result.child_session_id)
}

pub(super) fn tool_content_to_json(content: ToolContent) -> serde_json::Value {
    match content {
        ToolContent::Text(text) => serde_json::Value::String(text),
        ToolContent::Json(json) => json,
        ToolContent::Mixed { text, json } => {
            json.unwrap_or_else(|| serde_json::Value::String(text.unwrap_or_default()))
        }
    }
}

#[cfg(test)]
fn structured_tool_evidence_messages(
    messages: &[devo_core::Message],
) -> Vec<devo_protocol::RequestMessage> {
    messages
        .iter()
        .filter_map(|message| {
            let content = message
                .content
                .iter()
                .filter_map(structured_tool_evidence_content)
                .collect::<Vec<_>>();
            if content.is_empty() {
                None
            } else {
                Some(devo_protocol::RequestMessage {
                    role: message.role.as_str().to_string(),
                    content,
                })
            }
        })
        .collect()
}

#[cfg(test)]
fn structured_tool_evidence_content(
    block: &devo_core::ContentBlock,
) -> Option<devo_protocol::RequestContent> {
    match block {
        devo_core::ContentBlock::ProviderReasoning { provider, payload } => {
            Some(devo_protocol::RequestContent::ProviderReasoning {
                provider: provider.clone(),
                payload: payload.clone(),
            })
        }
        devo_core::ContentBlock::ToolUse { id, name, input } => {
            Some(devo_protocol::RequestContent::ToolUse {
                id: id.clone(),
                name: name.clone(),
                input: input.clone(),
            })
        }
        devo_core::ContentBlock::HostedToolUse {
            id,
            name,
            input,
            output,
            status,
        } => Some(devo_protocol::RequestContent::HostedToolUse {
            id: id.clone(),
            name: name.clone(),
            input: input.clone(),
            output: output.clone(),
            status: status.clone(),
        }),
        devo_core::ContentBlock::ToolResult {
            tool_use_id,
            content,
            is_error,
        } => Some(devo_protocol::RequestContent::ToolResult {
            tool_use_id: tool_use_id.clone(),
            content: content.clone(),
            is_error: (*is_error).then_some(true),
        }),
        devo_core::ContentBlock::Text { .. } | devo_core::ContentBlock::Reasoning { .. } => None,
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use super::*;

    #[test]
    fn request_user_input_exchanges_follow_question_order_and_ignore_unknown_answers() {
        // Trace: L2-DES-RESEARCH-001
        // Verifies: clarification tool answers map back to the original ordered questions.
        let questions = request_user_input_questions_from_input(&json!({
            "questions": [
                {"id": "scope", "question": "Which scope?"},
                {"id": "region", "question": "Which region?"},
                {"id": "empty", "question": "Optional detail?"}
            ]
        }));
        let response = serde_json::from_value::<devo_protocol::RequestUserInputResponse>(json!({
            "answers": {
                "region": {"answers": ["APAC"]},
                "unknown": {"answers": ["ignore me"]},
                "scope": {"answers": ["Product docs"]},
                "empty": {"answers": ["   "]}
            }
        }))
        .expect("request_user_input response should deserialize");

        let exchanges = request_user_input_exchanges_from_response(&questions, &response);

        assert_eq!(
            exchanges,
            vec![
                ResearchClarificationContext {
                    question: "Which scope?".to_string(),
                    answer: "Product docs".to_string(),
                },
                ResearchClarificationContext {
                    question: "Which region?".to_string(),
                    answer: "APAC".to_string(),
                },
                ResearchClarificationContext {
                    question: "Optional detail?".to_string(),
                    answer: String::new(),
                },
            ]
        );
        assert_eq!(
            exchanges
                .iter()
                .filter(|exchange| !exchange.answer.trim().is_empty())
                .cloned()
                .collect::<Vec<_>>(),
            vec![
                ResearchClarificationContext {
                    question: "Which scope?".to_string(),
                    answer: "Product docs".to_string(),
                },
                ResearchClarificationContext {
                    question: "Which region?".to_string(),
                    answer: "APAC".to_string(),
                },
            ]
        );
    }

    #[test]
    fn structured_tool_evidence_messages_preserve_hosted_pairs_without_text() {
        // Trace: L2-DES-RESEARCH-001
        // Verifies: research compression can receive provider-hosted tool context as structured blocks.
        let messages = vec![devo_core::Message {
            role: devo_core::Role::Assistant,
            content: vec![
                devo_core::ContentBlock::Text {
                    text: "visible notes stay in research_notes".to_string(),
                },
                devo_core::ContentBlock::HostedToolUse {
                    id: "hosted_ws_1".to_string(),
                    name: "web_search".to_string(),
                    input: json!({"query": "DeepSeek official website"}),
                    output: None,
                    status: None,
                },
                devo_core::ContentBlock::HostedToolUse {
                    id: "hosted_ws_1".to_string(),
                    name: "web_search".to_string(),
                    input: json!({"query": "DeepSeek official website"}),
                    output: Some(json!([{
                        "title": "DeepSeek",
                        "url": "https://www.deepseek.com/"
                    }])),
                    status: Some("completed".to_string()),
                },
            ],
        }];

        let evidence = structured_tool_evidence_messages(&messages);

        assert_eq!(
            serde_json::to_value(&evidence).expect("serialize evidence messages"),
            json!([
                {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "hosted_tool_use",
                            "id": "hosted_ws_1",
                            "name": "web_search",
                            "input": {"query": "DeepSeek official website"}
                        },
                        {
                            "type": "hosted_tool_use",
                            "id": "hosted_ws_1",
                            "name": "web_search",
                            "input": {"query": "DeepSeek official website"},
                            "output": [{
                                "title": "DeepSeek",
                                "url": "https://www.deepseek.com/"
                            }],
                            "status": "completed"
                        }
                    ]
                }
            ])
        );
    }
}
