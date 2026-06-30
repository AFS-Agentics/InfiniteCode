#[derive(Debug, Clone)]
pub(super) struct ResearchRequestContext {
    question: String,
    current_date: String,
    timezone: String,
    cwd: String,
    pub(super) clarifications: Vec<ResearchClarificationContext>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ResearchClarificationContext {
    pub(super) question: String,
    pub(super) answer: String,
}

impl ResearchRequestContext {
    pub(super) fn new(question: &str, current_date: String, timezone: String, cwd: String) -> Self {
        Self {
            question: question.to_string(),
            current_date,
            timezone,
            cwd,
            clarifications: Vec::new(),
        }
    }

    pub(super) fn session_messages(
        &self,
        additional_context: Vec<String>,
    ) -> Vec<devo_core::Message> {
        self.context_texts(additional_context)
            .into_iter()
            .map(devo_core::Message::user)
            .collect()
    }

    fn context_texts(&self, additional_context: Vec<String>) -> Vec<String> {
        let mut messages = vec![
            devo_core::research::prompts::environment_context(
                &self.current_date,
                &self.timezone,
                &self.cwd,
            ),
            self.question.clone(),
        ];
        for clarification in &self.clarifications {
            messages.push(devo_core::research::prompts::clarification_context(
                &clarification.question,
                &clarification.answer,
            ));
        }
        messages.extend(
            additional_context
                .into_iter()
                .filter(|context| !context.trim().is_empty()),
        );
        messages
    }
}
