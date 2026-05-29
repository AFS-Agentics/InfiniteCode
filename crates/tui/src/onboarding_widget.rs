//! Standalone onboarding widget for first-run model setup.
//!
//! This widget renders inline in the TUI bottom area. It handles all keyboard
//! input directly during onboarding, and is owned by `ChatWidget` — not by
//! `BottomPane` — keeping it decoupled from the composer and popup system.
//!
//! Follows L2-DES-TUI-001 flow:
//! 1. Model slug selection (searchable popup)
//! 2. Provider selection (existing or "Add provider...")
//! 3. Inline setup with vertical rail (* / | markers)
//! 4. Invocation method popup
//! 5. Reasoning effort popup (if model supports reasoning)
//! 6. Validation

use std::time::Instant;

use crossterm::event::KeyCode;
use crossterm::event::KeyEvent;
use crossterm::event::KeyEventKind;
use crossterm::event::KeyModifiers;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::style::Stylize;
use ratatui::text::Line;
use ratatui::text::Span;
use ratatui::widgets::Paragraph;
use ratatui::widgets::Widget;
use ratatui::widgets::Wrap;

use devo_protocol::Model;
use devo_protocol::ProviderWireApi;

use crate::app_command::AppCommand;
use crate::app_event::AppEvent;
use crate::app_event_sender::AppEventSender;
use crate::bottom_pane::popup_consts::MAX_POPUP_ROWS;
use crate::bottom_pane::scroll_state::ScrollState;
use crate::exec_cell::spinner;
use crate::render::renderable::Renderable;
use crate::tui::frame_requester::FrameRequester;

const CUSTOM_MODEL_SENTINEL: &str = "__custom_model__";
const SPINNER_INTERVAL: std::time::Duration = std::time::Duration::from_millis(80);

/// Simple content area with padding, no background styling.
fn onboarding_content_area(area: Rect) -> Rect {
    if area.height < 2 || area.width < 2 {
        return area;
    }
    Rect {
        x: area.x + 1,
        y: area.y + 1,
        width: area.width.saturating_sub(2),
        height: area.height.saturating_sub(2),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum OnboardingResult {
    /// Validation succeeded, config should be saved.
    ValidationSucceeded {
        model: String,
        provider: ProviderWireApi,
        base_url: Option<String>,
        api_key: Option<String>,
    },
    /// User cancelled onboarding.
    Cancelled,
}

/// Which field is active in the inline setup view.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InlineField {
    ProviderName,
    BaseUrl,
    ApiKey,
    ModelName,
    DisplayName,
}

/// Onboarding state machine following L2-DES-TUI-001.
#[derive(Debug)]
enum OnboardingState {
    /// Step 1: Select a model from catalog or enter custom.
    ModelSelection {
        items: Vec<ModelSelectionItem>,
        state: ScrollState,
        search_query: String,
        filtered_indices: Vec<usize>,
    },
    /// Step 1b: Enter custom model name.
    CustomModelName { input: String, cursor_pos: usize },
    /// Step 2: Select an existing provider or add one.
    ProviderSelection {
        model: String,
        items: Vec<ProviderSelectionItem>,
        selected_idx: usize,
    },
    /// Steps 3-7: Inline setup with vertical rail.
    InlineSetup {
        model: String,
        provider: ProviderWireApi,
        provider_name: String,
        base_url: String,
        api_key: String,
        model_name: String,
        display_name: String,
        active_field: InlineField,
        input: String,
        cursor_pos: usize,
    },
    /// Step 9: Select invocation method.
    InvocationMethod {
        model: String,
        provider: ProviderWireApi,
        provider_name: String,
        base_url: String,
        api_key: String,
        model_name: String,
        display_name: String,
        items: Vec<InvocationMethodItem>,
        selected_idx: usize,
    },
    /// Step 10: Select reasoning effort.
    ReasoningEffort {
        model: String,
        provider: ProviderWireApi,
        provider_name: String,
        base_url: String,
        api_key: String,
        model_name: String,
        display_name: String,
        invocation_method: ProviderWireApi,
        items: Vec<ReasoningEffortItem>,
        selected_idx: usize,
    },
    /// Validating connection.
    Validating {
        model: String,
        provider: ProviderWireApi,
        base_url: Option<String>,
        api_key: Option<String>,
        started_at: Instant,
    },
    /// Validation failed, show error and retry options.
    ValidationFailed {
        model: String,
        provider: ProviderWireApi,
        base_url: Option<String>,
        api_key: Option<String>,
        error_message: String,
        selected_action: usize,
    },
}

#[derive(Debug)]
struct ModelSelectionItem {
    slug: String,
    display_name: String,
    description: String,
    context_window: u32,
    thinking_label: String,
    is_custom: bool,
}

#[derive(Debug)]
struct ProviderSelectionItem {
    label: String,
    description: String,
    /// None means "Add provider..." (create new).
    provider: Option<ProviderWireApi>,
}

#[derive(Debug)]
struct InvocationMethodItem {
    label: String,
    description: String,
    provider: ProviderWireApi,
}

#[derive(Debug)]
struct ReasoningEffortItem {
    label: String,
}

pub(crate) struct OnboardingWidget {
    state: OnboardingState,
    complete: bool,
    result: Option<OnboardingResult>,
    /// Models from the catalog, stored so `go_back_to_model_selection` can restore them.
    original_models: Vec<Model>,
    app_event_tx: AppEventSender,
    frame_requester: FrameRequester,
    animations_enabled: bool,
}

impl OnboardingWidget {
    pub(crate) fn new(
        models: &[Model],
        app_event_tx: AppEventSender,
        frame_requester: FrameRequester,
        animations_enabled: bool,
    ) -> Self {
        let items = Self::build_model_items(models);
        let filtered_indices = (0..items.len()).collect();
        let mut state = ScrollState::new();
        state.selected_idx = Some(0);

        Self {
            state: OnboardingState::ModelSelection {
                items,
                state,
                search_query: String::new(),
                filtered_indices,
            },
            complete: false,
            result: None,
            original_models: models.to_vec(),
            app_event_tx,
            frame_requester,
            animations_enabled,
        }
    }

    /// Build `ModelSelectionItem` list from the catalog models, with a trailing
    /// "Custom Model" sentinel entry.
    fn build_model_items(models: &[Model]) -> Vec<ModelSelectionItem> {
        let mut items: Vec<ModelSelectionItem> = models
            .iter()
            .map(|m| {
                let thinking_label = match &m.thinking_capability {
                    devo_protocol::ThinkingCapability::Unsupported => String::new(),
                    devo_protocol::ThinkingCapability::Toggle => "thinking".to_string(),
                    devo_protocol::ThinkingCapability::Levels(levels) => {
                        // TODO: What's this, why empty here?
                        if levels.is_empty() {
                            String::new()
                        } else {
                            format!("thinking: {}", levels.len())
                        }
                    }
                    devo_protocol::ThinkingCapability::ToggleWithLevels(_) => {
                        "thinking".to_string()
                    }
                };
                ModelSelectionItem {
                    slug: m.slug.clone(),
                    display_name: m.display_name.clone(),
                    description: m.description.clone().unwrap_or_default(),
                    context_window: m.context_window,
                    thinking_label,
                    is_custom: false,
                }
            })
            .collect();
        items.push(ModelSelectionItem {
            slug: CUSTOM_MODEL_SENTINEL.to_string(),
            display_name: "Custom Model".to_string(),
            description: "Enter a custom model slug".to_string(),
            context_window: 0,
            thinking_label: String::new(),
            is_custom: true,
        });
        items
    }

    pub(crate) fn take_result(&mut self) -> Option<OnboardingResult> {
        self.result.take()
    }

    pub(crate) fn is_complete(&self) -> bool {
        self.complete
    }

    pub(crate) fn cancel(&mut self) {
        self.complete = true;
        self.result = Some(OnboardingResult::Cancelled);
    }

    /// Called when validation succeeds.
    pub(crate) fn on_validation_succeeded(&mut self, _reply_preview: String) {
        if let OnboardingState::Validating {
            model,
            provider,
            base_url,
            api_key,
            ..
        } = &self.state
        {
            self.result = Some(OnboardingResult::ValidationSucceeded {
                model: model.clone(),
                provider: *provider,
                base_url: base_url.clone(),
                api_key: api_key.clone(),
            });
            self.complete = true;
        }
    }

    /// Called when validation fails.
    pub(crate) fn on_validation_failed(&mut self, error_message: String) {
        if let OnboardingState::Validating {
            model,
            provider,
            base_url,
            api_key,
            ..
        } = &self.state
        {
            self.state = OnboardingState::ValidationFailed {
                model: model.clone(),
                provider: *provider,
                base_url: base_url.clone(),
                api_key: api_key.clone(),
                error_message,
                selected_action: 0,
            };
        }
    }

    // ── Helpers ──

    fn infer_provider(slug: &str) -> ProviderWireApi {
        let slug_lower = slug.to_lowercase();
        if slug_lower.contains("claude") || slug_lower.contains("anthropic") {
            ProviderWireApi::AnthropicMessages
        } else {
            ProviderWireApi::OpenAIChatCompletions
        }
    }

    fn default_base_url(provider: ProviderWireApi) -> String {
        match provider {
            ProviderWireApi::AnthropicMessages => "https://api.anthropic.com".to_string(),
            ProviderWireApi::OpenAIChatCompletions => "https://api.openai.com/v1".to_string(),
            ProviderWireApi::OpenAIResponses => "https://api.openai.com/v1".to_string(),
        }
    }

    fn provider_display_name(provider: ProviderWireApi) -> &'static str {
        match provider {
            ProviderWireApi::AnthropicMessages => "Anthropic",
            ProviderWireApi::OpenAIChatCompletions => "OpenAI Chat Completions",
            ProviderWireApi::OpenAIResponses => "OpenAI Responses",
        }
    }

    fn go_back_to_model_selection(&mut self) {
        let items = Self::build_model_items(&self.original_models);
        let filtered_indices = (0..items.len()).collect();
        let mut state = ScrollState::new();
        state.selected_idx = Some(0);
        self.state = OnboardingState::ModelSelection {
            items,
            state,
            search_query: String::new(),
            filtered_indices,
        };
    }

    fn start_validation(
        &mut self,
        model: String,
        provider: ProviderWireApi,
        base_url: Option<String>,
        api_key: Option<String>,
    ) {
        self.state = OnboardingState::Validating {
            model: model.clone(),
            provider,
            base_url: base_url.clone(),
            api_key: api_key.clone(),
            started_at: Instant::now(),
        };
        let payload = serde_json::json!({
            "model": model,
            "base_url": base_url,
            "api_key": api_key,
        });
        self.app_event_tx
            .send(AppEvent::Command(AppCommand::RunUserShellCommand {
                command: format!("onboard {payload}"),
            }));
    }

    // ── Key Handling ──

    fn model_selection_handle_key(&mut self, key: KeyEvent) {
        let OnboardingState::ModelSelection {
            items,
            state,
            search_query,
            filtered_indices,
        } = &mut self.state
        else {
            return;
        };

        match key.code {
            KeyCode::Up | KeyCode::Char('p') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                Self::model_move_up(state, filtered_indices);
            }
            KeyCode::Up => {
                Self::model_move_up(state, filtered_indices);
            }
            KeyCode::Char('k') if key.modifiers.is_empty() => {
                Self::model_move_up(state, filtered_indices);
            }
            KeyCode::Down | KeyCode::Char('n') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                Self::model_move_down(state, filtered_indices);
            }
            KeyCode::Down => {
                Self::model_move_down(state, filtered_indices);
            }
            KeyCode::Char('j') if key.modifiers.is_empty() => {
                Self::model_move_down(state, filtered_indices);
            }
            KeyCode::Char(c)
                if key.modifiers.is_empty() || key.modifiers.contains(KeyModifiers::SHIFT) =>
            {
                search_query.push(c);
                Self::model_apply_filter(items, search_query, filtered_indices, state);
            }
            KeyCode::Backspace => {
                search_query.pop();
                Self::model_apply_filter(items, search_query, filtered_indices, state);
            }
            KeyCode::Enter => {
                if let Some(visible_idx) = state.selected_idx
                    && let Some(&actual_idx) = filtered_indices.get(visible_idx)
                    && let Some(item) = items.get(actual_idx)
                {
                    if item.is_custom {
                        self.state = OnboardingState::CustomModelName {
                            input: String::new(),
                            cursor_pos: 0,
                        };
                    } else {
                        let slug = item.slug.clone();
                        self.state = OnboardingState::ProviderSelection {
                            model: slug,
                            items: Self::provider_selection_items(),
                            selected_idx: 0,
                        };
                    }
                }
            }
            KeyCode::Esc => {
                self.complete = true;
                self.result = Some(OnboardingResult::Cancelled);
            }
            _ => {}
        }
    }

    fn model_move_up(state: &mut ScrollState, filtered_indices: &[usize]) {
        let len = filtered_indices.len();
        if len == 0 {
            return;
        }
        let current = state.selected_idx.unwrap_or(0);
        state.selected_idx = Some(if current == 0 { len - 1 } else { current - 1 });
    }

    fn model_move_down(state: &mut ScrollState, filtered_indices: &[usize]) {
        let len = filtered_indices.len();
        if len == 0 {
            return;
        }
        let current = state.selected_idx.unwrap_or(0);
        state.selected_idx = Some((current + 1) % len);
    }

    fn model_apply_filter(
        items: &[ModelSelectionItem],
        query: &str,
        filtered_indices: &mut Vec<usize>,
        state: &mut ScrollState,
    ) {
        let query_lower = query.to_lowercase();
        if query.is_empty() {
            *filtered_indices = (0..items.len()).collect();
        } else {
            *filtered_indices = items
                .iter()
                .enumerate()
                .filter(|(_, item)| {
                    item.slug.to_lowercase().contains(&query_lower)
                        || item.display_name.to_lowercase().contains(&query_lower)
                        || item.description.to_lowercase().contains(&query_lower)
                })
                .map(|(idx, _)| idx)
                .collect();
        }
        state.selected_idx = if filtered_indices.is_empty() {
            None
        } else {
            Some(0)
        };
    }

    fn custom_model_name_handle_key(&mut self, key: KeyEvent) {
        let OnboardingState::CustomModelName { input, cursor_pos } = &mut self.state else {
            return;
        };

        match key.code {
            KeyCode::Char(c)
                if key.modifiers.is_empty() || key.modifiers.contains(KeyModifiers::SHIFT) =>
            {
                input.insert(*cursor_pos, c);
                *cursor_pos += 1;
            }
            KeyCode::Backspace => {
                if *cursor_pos > 0 {
                    input.remove(*cursor_pos - 1);
                    *cursor_pos -= 1;
                }
            }
            KeyCode::Delete => {
                if *cursor_pos < input.len() {
                    input.remove(*cursor_pos);
                }
            }
            KeyCode::Left => {
                if *cursor_pos > 0 {
                    *cursor_pos -= 1;
                }
            }
            KeyCode::Right => {
                if *cursor_pos < input.len() {
                    *cursor_pos += 1;
                }
            }
            KeyCode::Home => {
                *cursor_pos = 0;
            }
            KeyCode::End => {
                *cursor_pos = input.len();
            }
            KeyCode::Enter => {
                let model = input.trim().to_string();
                if model.is_empty() {
                    return;
                }
                self.state = OnboardingState::ProviderSelection {
                    model,
                    items: Self::provider_selection_items(),
                    selected_idx: 0,
                };
            }
            KeyCode::Esc => {
                self.go_back_to_model_selection();
            }
            _ => {}
        }
    }

    fn provider_selection_items() -> Vec<ProviderSelectionItem> {
        vec![
            ProviderSelectionItem {
                label: "OpenAI Chat Completions".to_string(),
                description: "Most providers (OpenAI, Together, Groq, ...)".to_string(),
                provider: Some(ProviderWireApi::OpenAIChatCompletions),
            },
            ProviderSelectionItem {
                label: "OpenAI Responses".to_string(),
                description: "OpenAI native Responses API".to_string(),
                provider: Some(ProviderWireApi::OpenAIResponses),
            },
            ProviderSelectionItem {
                label: "Anthropic Messages".to_string(),
                description: "Claude models via Anthropic API".to_string(),
                provider: Some(ProviderWireApi::AnthropicMessages),
            },
            ProviderSelectionItem {
                label: "Add provider...".to_string(),
                description: "Enter custom provider settings".to_string(),
                provider: None,
            },
        ]
    }

    fn provider_selection_handle_key(&mut self, key: KeyEvent) {
        let OnboardingState::ProviderSelection {
            model,
            items,
            selected_idx,
        } = &mut self.state
        else {
            return;
        };

        match key.code {
            KeyCode::Up => {
                *selected_idx = if *selected_idx == 0 {
                    items.len() - 1
                } else {
                    *selected_idx - 1
                };
            }
            KeyCode::Down => {
                *selected_idx = (*selected_idx + 1) % items.len();
            }
            KeyCode::Enter => {
                if let Some(item) = items.get(*selected_idx) {
                    let model_slug = model.clone();
                    if let Some(provider) = item.provider {
                        // Existing provider selected — skip to model name entry.
                        let default_url = Self::default_base_url(provider);
                        self.state = OnboardingState::InlineSetup {
                            model: model_slug.clone(),
                            provider,
                            provider_name: Self::provider_display_name(provider).to_string(),
                            base_url: default_url,
                            api_key: String::new(),
                            model_name: model_slug.clone(),
                            display_name: String::new(),
                            active_field: InlineField::ModelName,
                            input: model_slug.clone(),
                            cursor_pos: model_slug.len(),
                        };
                    } else {
                        // "Add provider..." — enter inline setup from provider name.
                        self.state = OnboardingState::InlineSetup {
                            model: model_slug.clone(),
                            provider: ProviderWireApi::OpenAIChatCompletions,
                            provider_name: String::new(),
                            base_url: String::new(),
                            api_key: String::new(),
                            model_name: model_slug.clone(),
                            display_name: String::new(),
                            active_field: InlineField::ProviderName,
                            input: String::new(),
                            cursor_pos: 0,
                        };
                    }
                }
            }
            KeyCode::Esc => {
                self.go_back_to_model_selection();
            }
            _ => {}
        }
    }

    // ── Inline Setup ──

    fn inline_setup_handle_key(&mut self, key: KeyEvent) {
        let OnboardingState::InlineSetup {
            model,
            provider,
            provider_name,
            base_url,
            api_key,
            model_name,
            display_name,
            active_field,
            input,
            cursor_pos,
        } = &mut self.state
        else {
            return;
        };

        match key.code {
            KeyCode::Char(c)
                if key.modifiers.is_empty() || key.modifiers.contains(KeyModifiers::SHIFT) =>
            {
                input.insert(*cursor_pos, c);
                *cursor_pos += 1;
            }
            KeyCode::Backspace => {
                if *cursor_pos > 0 {
                    input.remove(*cursor_pos - 1);
                    *cursor_pos -= 1;
                }
            }
            KeyCode::Delete => {
                if *cursor_pos < input.len() {
                    input.remove(*cursor_pos);
                }
            }
            KeyCode::Left => {
                if *cursor_pos > 0 {
                    *cursor_pos -= 1;
                }
            }
            KeyCode::Right => {
                if *cursor_pos < input.len() {
                    *cursor_pos += 1;
                }
            }
            KeyCode::Home => {
                *cursor_pos = 0;
            }
            KeyCode::End => {
                *cursor_pos = input.len();
            }
            KeyCode::Enter => {
                // Save current field and advance.
                match active_field {
                    InlineField::ProviderName => {
                        *provider_name = input.trim().to_string();
                        *active_field = InlineField::BaseUrl;
                        *input = Self::default_base_url(*provider);
                        *cursor_pos = input.len();
                    }
                    InlineField::BaseUrl => {
                        *base_url = input.trim().to_string();
                        *active_field = InlineField::ApiKey;
                        *input = String::new();
                        *cursor_pos = 0;
                    }
                    InlineField::ApiKey => {
                        *api_key = input.trim().to_string();
                        *active_field = InlineField::ModelName;
                        *input = model_name.clone();
                        *cursor_pos = input.len();
                    }
                    InlineField::ModelName => {
                        *model_name = input.trim().to_string();
                        *active_field = InlineField::DisplayName;
                        // Prefill display name from model slug.
                        let suggestion = model_name.clone();
                        *input = suggestion.clone();
                        *cursor_pos = suggestion.len();
                    }
                    InlineField::DisplayName => {
                        *display_name = input.trim().to_string();
                        // Move to invocation method selection.
                        let model = model.clone();
                        let provider = *provider;
                        let provider_name = provider_name.clone();
                        let base_url = base_url.clone();
                        let api_key = api_key.clone();
                        let model_name = model_name.clone();
                        let display_name = display_name.clone();
                        self.state = OnboardingState::InvocationMethod {
                            model,
                            provider,
                            provider_name,
                            base_url,
                            api_key,
                            model_name,
                            display_name,
                            items: Self::invocation_method_items(),
                            selected_idx: 0,
                        };
                    }
                }
            }
            KeyCode::Esc => {
                // Go back to previous field or provider selection.
                match active_field {
                    InlineField::ProviderName => {
                        // Go back to provider selection.
                        let model = model.clone();
                        self.state = OnboardingState::ProviderSelection {
                            model,
                            items: Self::provider_selection_items(),
                            selected_idx: 0,
                        };
                    }
                    InlineField::BaseUrl => {
                        *active_field = InlineField::ProviderName;
                        *input = provider_name.clone();
                        *cursor_pos = input.len();
                    }
                    InlineField::ApiKey => {
                        *active_field = InlineField::BaseUrl;
                        *input = base_url.clone();
                        *cursor_pos = input.len();
                    }
                    InlineField::ModelName => {
                        *active_field = InlineField::ApiKey;
                        *input = api_key.clone();
                        *cursor_pos = input.len();
                    }
                    InlineField::DisplayName => {
                        *active_field = InlineField::ModelName;
                        *input = model_name.clone();
                        *cursor_pos = input.len();
                    }
                }
            }
            _ => {}
        }
    }

    fn invocation_method_items() -> Vec<InvocationMethodItem> {
        vec![
            InvocationMethodItem {
                label: "OpenAI Chat Completions".to_string(),
                description: "Most providers (OpenAI, Together, Groq, ...)".to_string(),
                provider: ProviderWireApi::OpenAIChatCompletions,
            },
            InvocationMethodItem {
                label: "OpenAI Responses".to_string(),
                description: "OpenAI native Responses API".to_string(),
                provider: ProviderWireApi::OpenAIResponses,
            },
            InvocationMethodItem {
                label: "Anthropic Messages".to_string(),
                description: "Claude models via Anthropic API".to_string(),
                provider: ProviderWireApi::AnthropicMessages,
            },
        ]
    }

    fn invocation_method_handle_key(&mut self, key: KeyEvent) {
        let OnboardingState::InvocationMethod {
            model,
            provider,
            provider_name,
            base_url,
            api_key,
            model_name,
            display_name,
            items,
            selected_idx,
            ..
        } = &mut self.state
        else {
            return;
        };

        match key.code {
            KeyCode::Up => {
                *selected_idx = if *selected_idx == 0 {
                    items.len() - 1
                } else {
                    *selected_idx - 1
                };
            }
            KeyCode::Down => {
                *selected_idx = (*selected_idx + 1) % items.len();
            }
            KeyCode::Enter => {
                if let Some(item) = items.get(*selected_idx) {
                    let invocation = item.provider;
                    let model = model.clone();
                    let provider = *provider;
                    let provider_name = provider_name.clone();
                    let base_url = base_url.clone();
                    let api_key = api_key.clone();
                    let model_name = model_name.clone();
                    let display_name = display_name.clone();

                    // Check if model supports reasoning — if so, show reasoning effort picker.
                    let original = self.original_models.iter().find(|m| m.slug == model);
                    let supports_reasoning = original.map_or(false, |m| {
                        !matches!(
                            m.thinking_capability,
                            devo_protocol::ThinkingCapability::Unsupported
                        )
                    });

                    if supports_reasoning {
                        self.state = OnboardingState::ReasoningEffort {
                            model,
                            provider,
                            provider_name,
                            base_url,
                            api_key,
                            model_name,
                            display_name,
                            invocation_method: invocation,
                            items: Self::reasoning_effort_items(),
                            selected_idx: 0,
                        };
                    } else {
                        // No reasoning — go straight to validation.
                        let base_url_opt = if base_url.is_empty() {
                            None
                        } else {
                            Some(base_url)
                        };
                        let api_key_opt = if api_key.is_empty() {
                            None
                        } else {
                            Some(api_key)
                        };
                        self.start_validation(model, provider, base_url_opt, api_key_opt);
                    }
                }
            }
            KeyCode::Esc => {
                // Go back to inline setup, display name field.
                let model = model.clone();
                let provider = *provider;
                let provider_name = provider_name.clone();
                let base_url = base_url.clone();
                let api_key = api_key.clone();
                let model_name_val = model_name.clone();
                let display_name_val = display_name.clone();
                self.state = OnboardingState::InlineSetup {
                    model,
                    provider,
                    provider_name,
                    base_url,
                    api_key,
                    model_name: model_name_val.clone(),
                    display_name: display_name_val.clone(),
                    active_field: InlineField::DisplayName,
                    input: display_name_val,
                    cursor_pos: display_name.len(),
                };
            }
            _ => {}
        }
    }

    fn reasoning_effort_items() -> Vec<ReasoningEffortItem> {
        vec![
            ReasoningEffortItem {
                label: "medium".to_string(),
            },
            ReasoningEffortItem {
                label: "high".to_string(),
            },
            ReasoningEffortItem {
                label: "xhigh".to_string(),
            },
        ]
    }

    fn reasoning_effort_handle_key(&mut self, key: KeyEvent) {
        let OnboardingState::ReasoningEffort {
            model,
            provider,
            base_url,
            api_key,
            items,
            selected_idx,
            ..
        } = &mut self.state
        else {
            return;
        };

        match key.code {
            KeyCode::Up => {
                *selected_idx = if *selected_idx == 0 {
                    items.len() - 1
                } else {
                    *selected_idx - 1
                };
            }
            KeyCode::Down => {
                *selected_idx = (*selected_idx + 1) % items.len();
            }
            KeyCode::Enter => {
                let model = model.clone();
                let provider = *provider;
                let base_url = base_url.clone();
                let api_key = api_key.clone();
                let base_url_opt = if base_url.is_empty() {
                    None
                } else {
                    Some(base_url)
                };
                let api_key_opt = if api_key.is_empty() {
                    None
                } else {
                    Some(api_key)
                };
                self.start_validation(model, provider, base_url_opt, api_key_opt);
            }
            KeyCode::Esc => {
                // Go back to invocation method selection.
                // Extract values before reassigning self.state.
                let (m, prov, pn, bu, ak, mn, dn) = match &self.state {
                    OnboardingState::ReasoningEffort {
                        model,
                        provider,
                        provider_name,
                        base_url,
                        api_key,
                        model_name,
                        display_name,
                        ..
                    } => (
                        model.clone(),
                        *provider,
                        provider_name.clone(),
                        base_url.clone(),
                        api_key.clone(),
                        model_name.clone(),
                        display_name.clone(),
                    ),
                    _ => return,
                };
                self.state = OnboardingState::InvocationMethod {
                    model: m,
                    provider: prov,
                    provider_name: pn,
                    base_url: bu,
                    api_key: ak,
                    model_name: mn,
                    display_name: dn,
                    items: Self::invocation_method_items(),
                    selected_idx: 0,
                };
            }
            _ => {}
        }
    }

    // ── Validation Failed ──

    fn validation_failed_handle_key(&mut self, key: KeyEvent) {
        let OnboardingState::ValidationFailed {
            model,
            provider,
            base_url,
            api_key,
            error_message: _,
            selected_action,
        } = &mut self.state
        else {
            return;
        };

        let actions = [
            "Retry with current settings",
            "Edit settings",
            "Choose different model",
        ];

        match key.code {
            KeyCode::Up => {
                *selected_action = if *selected_action == 0 {
                    actions.len() - 1
                } else {
                    *selected_action - 1
                };
            }
            KeyCode::Down => {
                *selected_action = (*selected_action + 1) % actions.len();
            }
            KeyCode::Enter => match *selected_action {
                0 => {
                    // Retry.
                    let model = model.clone();
                    let provider = *provider;
                    let base_url = base_url.clone();
                    let api_key = api_key.clone();
                    self.start_validation(model, provider, base_url, api_key);
                }
                1 => {
                    // Edit settings — go back to inline setup API key field.
                    let model_slug = model.clone();
                    let provider = *provider;
                    let base_url = base_url.clone().unwrap_or_default();
                    let api_key = api_key.clone().unwrap_or_default();
                    self.state = OnboardingState::InlineSetup {
                        model: model_slug.clone(),
                        provider,
                        provider_name: Self::provider_display_name(provider).to_string(),
                        base_url,
                        api_key: api_key.clone(),
                        model_name: model_slug,
                        display_name: String::new(),
                        active_field: InlineField::ApiKey,
                        input: api_key.clone(),
                        cursor_pos: api_key.len(),
                    };
                }
                2 => {
                    self.go_back_to_model_selection();
                }
                _ => {}
            },
            KeyCode::Esc => {
                self.complete = true;
                self.result = Some(OnboardingResult::Cancelled);
            }
            _ => {}
        }
    }

    // ── Rendering: Inline Setup with Vertical Rail ──

    fn render_inline_setup(
        model: &str,
        provider_name: &str,
        base_url: &str,
        api_key: &str,
        model_name: &str,
        display_name: &str,
        active_field: &InlineField,
        input: &str,
        cursor_pos: usize,
        area: Rect,
        buf: &mut Buffer,
    ) {
        if area.height < 3 {
            return;
        }
        let content_area = onboarding_content_area(area);

        let mut lines: Vec<Line<'static>> = Vec::new();

        // Model slug header.
        lines.push(Line::from(vec![Span::styled(
            format!("Model: {model}"),
            Style::default().dim(),
        )]));

        // Provider name.
        lines.push(Line::from("|"));
        if active_field == &InlineField::ProviderName {
            Self::render_active_field(
                &mut lines,
                "provider name:",
                "Enter a name to recognize this provider later.",
                input,
                cursor_pos,
            );
        } else {
            Self::render_completed_field(&mut lines, "provider name:", provider_name);
        }

        // Base URL.
        lines.push(Line::from("|"));
        if active_field == &InlineField::BaseUrl {
            Self::render_active_field(
                &mut lines,
                "base url:",
                "Enter the provider API base URL.",
                input,
                cursor_pos,
            );
        } else {
            Self::render_completed_field(&mut lines, "base url:", base_url);
        }

        // API key.
        lines.push(Line::from("|"));
        if active_field == &InlineField::ApiKey {
            Self::render_active_field(
                &mut lines,
                "api key:",
                "Enter the API key for this provider.",
                input,
                cursor_pos,
            );
        } else {
            let masked = if api_key.is_empty() {
                "(skip)"
            } else {
                "••••••••"
            };
            Self::render_completed_field(&mut lines, "api key:", masked);
        }

        // Model name.
        lines.push(Line::from("|"));
        if active_field == &InlineField::ModelName {
            Self::render_active_field(
                &mut lines,
                "model name:",
                "Enter the model name this provider expects.",
                input,
                cursor_pos,
            );
        } else {
            Self::render_completed_field(&mut lines, "model name:", model_name);
        }

        // Display name.
        lines.push(Line::from("|"));
        if active_field == &InlineField::DisplayName {
            Self::render_active_field(
                &mut lines,
                "display name:",
                "Enter the name clients should show for this model.",
                input,
                cursor_pos,
            );
        } else {
            Self::render_completed_field(&mut lines, "display name:", display_name);
        }

        // Footer.
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled("Enter", Style::default().dim()),
            Span::styled(": next field", Style::default().dim()),
        ]));
        lines.push(Line::from(vec![
            Span::styled("Esc", Style::default().dim()),
            Span::styled(": back", Style::default().dim()),
        ]));

        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .render(content_area, buf);
    }

    fn render_active_field(
        lines: &mut Vec<Line<'static>>,
        label: &str,
        hint: &str,
        input: &str,
        cursor_pos: usize,
    ) {
        lines.push(Line::from(vec![Span::styled(
            format!("* {label}"),
            Style::default().bold(),
        )]));
        lines.push(Line::from(vec![Span::styled(
            format!("| Hint: {hint}"),
            Style::default().dim(),
        )]));
        let byte_pos = input
            .char_indices()
            .nth(cursor_pos.min(input.chars().count()))
            .map(|(i, _)| i)
            .unwrap_or(input.len());
        let before_cursor = input[..byte_pos].to_string();
        lines.push(Line::from(vec![
            Span::styled("| ", Style::default()),
            Span::styled(before_cursor, Style::default()),
            Span::styled("▌", Style::default().cyan()),
        ]));
    }

    fn render_completed_field(lines: &mut Vec<Line<'static>>, label: &str, value: &str) {
        lines.push(Line::from(vec![Span::styled(
            format!("* {label}"),
            Style::default().dim(),
        )]));
        lines.push(Line::from(vec![Span::styled(
            format!("| {value}"),
            Style::default().dim(),
        )]));
    }

    // ── Rendering: Popup Lists ──

    fn render_model_selection(
        items: &[ModelSelectionItem],
        state: &ScrollState,
        search_query: &str,
        filtered_indices: &[usize],
        area: Rect,
        buf: &mut Buffer,
    ) {
        if area.height < 3 {
            return;
        }
        let content_area = onboarding_content_area(area);
        let mut lines: Vec<Line<'static>> = Vec::new();

        lines.push(Line::from(vec![Span::styled(
            "Select Model Slug",
            Style::default().bold(),
        )]));
        lines.push(Line::from(vec![Span::styled(
            "Hint: Choose the model capability profile the program should use.",
            Style::default().dim(),
        )]));
        lines.push(Line::from(""));

        if search_query.is_empty() {
            lines.push(Line::from(vec![Span::styled(
                "Search: ",
                Style::default().dim(),
            )]));
        } else {
            lines.push(Line::from(vec![
                Span::styled("Search: ", Style::default().dim()),
                Span::styled(search_query.to_string(), Style::default()),
            ]));
        }
        lines.push(Line::from(""));

        let max_visible = MAX_POPUP_ROWS.min(filtered_indices.len().max(1));
        let scroll_offset = state
            .selected_idx
            .map(|sel| {
                if sel >= max_visible.saturating_sub(2) {
                    sel.saturating_sub(max_visible.saturating_sub(3))
                } else {
                    0
                }
            })
            .unwrap_or(0);

        for (vis_idx, &actual_idx) in filtered_indices
            .iter()
            .enumerate()
            .skip(scroll_offset)
            .take(max_visible)
        {
            if let Some(item) = items.get(actual_idx) {
                let is_selected = state.selected_idx == Some(vis_idx);
                let prefix = if is_selected { "> " } else { "  " };
                let name_style = if is_selected {
                    Style::default().bold()
                } else {
                    Style::default()
                };
                lines.push(Line::from(vec![
                    Span::styled(
                        prefix.to_string(),
                        if is_selected {
                            Style::default().cyan()
                        } else {
                            Style::default()
                        },
                    ),
                    Span::styled(item.slug.clone(), name_style),
                ]));
            }
        }

        lines.push(Line::from(""));
        lines.push(Line::from(vec![Span::styled(
            "Enter: select and close popup",
            Style::default().dim(),
        )]));
        lines.push(Line::from(vec![Span::styled(
            "Esc: cancel",
            Style::default().dim(),
        )]));

        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .render(content_area, buf);
    }

    fn render_custom_model_name(input: &str, cursor_pos: usize, area: Rect, buf: &mut Buffer) {
        if area.height < 3 {
            return;
        }
        let content_area = onboarding_content_area(area);
        let mut lines: Vec<Line<'static>> = Vec::new();

        lines.push(Line::from(vec![Span::styled(
            "Enter Model Slug",
            Style::default().bold(),
        )]));
        lines.push(Line::from(vec![Span::styled(
            "Hint: Type the model slug for your custom model.",
            Style::default().dim(),
        )]));
        lines.push(Line::from(""));

        let byte_pos = input
            .char_indices()
            .nth(cursor_pos.min(input.chars().count()))
            .map(|(i, _)| i)
            .unwrap_or(input.len());
        let before_cursor = input[..byte_pos].to_string();
        lines.push(Line::from(vec![
            Span::styled("> ", Style::default().cyan()),
            Span::styled(before_cursor, Style::default()),
            Span::styled("▌", Style::default().cyan()),
        ]));
        lines.push(Line::from(""));
        lines.push(Line::from(vec![Span::styled(
            "Enter: confirm",
            Style::default().dim(),
        )]));
        lines.push(Line::from(vec![Span::styled(
            "Esc: back",
            Style::default().dim(),
        )]));

        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .render(content_area, buf);
    }

    fn render_provider_selection(
        model: &str,
        items: &[ProviderSelectionItem],
        selected_idx: usize,
        area: Rect,
        buf: &mut Buffer,
    ) {
        if area.height < 3 {
            return;
        }
        let content_area = onboarding_content_area(area);
        let mut lines: Vec<Line<'static>> = Vec::new();

        lines.push(Line::from(vec![Span::styled(
            "Select Provider",
            Style::default().bold(),
        )]));
        lines.push(Line::from(vec![Span::styled(
            "Hint: Choose a provider or add one.",
            Style::default().dim(),
        )]));
        lines.push(Line::from(""));

        for (idx, item) in items.iter().enumerate() {
            let is_selected = idx == selected_idx;
            let prefix = if is_selected { "> " } else { "  " };
            let name_style = if is_selected {
                Style::default().bold()
            } else {
                Style::default()
            };
            lines.push(Line::from(vec![
                Span::styled(
                    prefix.to_string(),
                    if is_selected {
                        Style::default().cyan()
                    } else {
                        Style::default()
                    },
                ),
                Span::styled(item.label.clone(), name_style),
            ]));
            lines.push(Line::from(vec![
                Span::raw("  "),
                Span::styled(item.description.clone(), Style::default().dim()),
            ]));
        }

        lines.push(Line::from(""));
        lines.push(Line::from(vec![Span::styled(
            "Enter: select and close popup",
            Style::default().dim(),
        )]));
        lines.push(Line::from(vec![Span::styled(
            "Esc: back",
            Style::default().dim(),
        )]));

        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .render(content_area, buf);
    }

    fn render_invocation_method(
        items: &[InvocationMethodItem],
        selected_idx: usize,
        area: Rect,
        buf: &mut Buffer,
    ) {
        if area.height < 3 {
            return;
        }
        let content_area = onboarding_content_area(area);
        let mut lines: Vec<Line<'static>> = Vec::new();

        lines.push(Line::from(vec![Span::styled(
            "Invocation Method",
            Style::default().bold(),
        )]));
        lines.push(Line::from(vec![Span::styled(
            "Hint: Choose the API protocol used to call this model.",
            Style::default().dim(),
        )]));
        lines.push(Line::from(""));

        for (idx, item) in items.iter().enumerate() {
            let is_selected = idx == selected_idx;
            let prefix = if is_selected { "> " } else { "  " };
            let name_style = if is_selected {
                Style::default().bold()
            } else {
                Style::default()
            };
            lines.push(Line::from(vec![
                Span::styled(
                    prefix.to_string(),
                    if is_selected {
                        Style::default().cyan()
                    } else {
                        Style::default()
                    },
                ),
                Span::styled(item.label.clone(), name_style),
            ]));
            lines.push(Line::from(vec![
                Span::raw("  "),
                Span::styled(item.description.clone(), Style::default().dim()),
            ]));
        }

        lines.push(Line::from(""));
        lines.push(Line::from(vec![Span::styled(
            "Enter: select and close popup",
            Style::default().dim(),
        )]));
        lines.push(Line::from(vec![Span::styled(
            "Esc: back",
            Style::default().dim(),
        )]));

        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .render(content_area, buf);
    }

    fn render_reasoning_effort(
        items: &[ReasoningEffortItem],
        selected_idx: usize,
        area: Rect,
        buf: &mut Buffer,
    ) {
        if area.height < 3 {
            return;
        }
        let content_area = onboarding_content_area(area);
        let mut lines: Vec<Line<'static>> = Vec::new();

        lines.push(Line::from(vec![Span::styled(
            "Reasoning Effort",
            Style::default().bold(),
        )]));
        lines.push(Line::from(vec![Span::styled(
            "Hint: Choose the default reasoning effort for this model binding.",
            Style::default().dim(),
        )]));
        lines.push(Line::from(""));

        for (idx, item) in items.iter().enumerate() {
            let is_selected = idx == selected_idx;
            let prefix = if is_selected { "> " } else { "  " };
            let name_style = if is_selected {
                Style::default().bold()
            } else {
                Style::default()
            };
            lines.push(Line::from(vec![
                Span::styled(
                    prefix.to_string(),
                    if is_selected {
                        Style::default().cyan()
                    } else {
                        Style::default()
                    },
                ),
                Span::styled(item.label.clone(), name_style),
            ]));
        }

        lines.push(Line::from(""));
        lines.push(Line::from(vec![Span::styled(
            "Enter: select and close popup",
            Style::default().dim(),
        )]));
        lines.push(Line::from(vec![Span::styled(
            "Esc: back",
            Style::default().dim(),
        )]));

        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .render(content_area, buf);
    }

    fn render_validating(
        model: &str,
        provider: ProviderWireApi,
        started_at: Instant,
        animations_enabled: bool,
        area: Rect,
        buf: &mut Buffer,
    ) {
        if area.height < 3 {
            return;
        }
        let content_area = onboarding_content_area(area);
        let provider_name = Self::provider_display_name(provider);
        let elapsed = started_at.elapsed().as_secs();
        let remaining = 20u64.saturating_sub(elapsed);

        let mut lines: Vec<Line<'static>> = Vec::new();
        lines.push(Line::from(vec![Span::styled(
            "Validating...",
            Style::default().bold(),
        )]));
        lines.push(Line::from(vec![Span::styled(
            format!("Model: {model} ({provider_name})"),
            Style::default().dim(),
        )]));
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::raw("  "),
            spinner(Some(started_at), animations_enabled),
            Span::raw(" Connecting to API..."),
        ]));
        lines.push(Line::from(vec![Span::styled(
            format!("  Timeout: {remaining}s remaining"),
            Style::default().dim(),
        )]));
        lines.push(Line::from(""));
        lines.push(Line::from(vec![Span::styled(
            "Esc: cancel",
            Style::default().dim(),
        )]));

        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .render(content_area, buf);
    }

    fn render_validation_failed(
        error_message: &str,
        selected_action: usize,
        area: Rect,
        buf: &mut Buffer,
    ) {
        if area.height < 3 {
            return;
        }
        let content_area = onboarding_content_area(area);
        let actions = [
            "Retry with current settings",
            "Edit settings",
            "Choose different model",
        ];

        let mut lines: Vec<Line<'static>> = vec![
            Line::from(vec![Span::styled(
                "✗ Validation Failed",
                Style::default().bold().red(),
            )]),
            Line::from(""),
            Line::from(vec![Span::styled(
                error_message.to_string(),
                Style::default().red(),
            )]),
            Line::from(""),
        ];

        for (idx, action) in actions.iter().enumerate() {
            let is_selected = idx == selected_action;
            let prefix = if is_selected { "> " } else { "  " };
            let style = if is_selected {
                Style::default().bold()
            } else {
                Style::default().dim()
            };
            lines.push(Line::from(vec![
                Span::styled(
                    prefix.to_string(),
                    if is_selected {
                        Style::default().cyan()
                    } else {
                        Style::default()
                    },
                ),
                Span::styled(action.to_string(), style),
            ]));
        }

        lines.push(Line::from(""));
        lines.push(Line::from(vec![Span::styled(
            "Esc: exit onboarding",
            Style::default().dim(),
        )]));

        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .render(content_area, buf);
    }
}

// ── Key event entry point ──

impl OnboardingWidget {
    pub(crate) fn handle_key_event(&mut self, key_event: KeyEvent) {
        if matches!(key_event.kind, KeyEventKind::Release) {
            return;
        }
        match &self.state {
            OnboardingState::ModelSelection { .. } => self.model_selection_handle_key(key_event),
            OnboardingState::CustomModelName { .. } => self.custom_model_name_handle_key(key_event),
            OnboardingState::ProviderSelection { .. } => {
                self.provider_selection_handle_key(key_event)
            }
            OnboardingState::InlineSetup { .. } => self.inline_setup_handle_key(key_event),
            OnboardingState::InvocationMethod { .. } => {
                self.invocation_method_handle_key(key_event)
            }
            OnboardingState::ReasoningEffort { .. } => self.reasoning_effort_handle_key(key_event),
            OnboardingState::Validating { .. } => {
                if key_event.code == KeyCode::Esc {
                    self.complete = true;
                    self.result = Some(OnboardingResult::Cancelled);
                }
            }
            OnboardingState::ValidationFailed { .. } => {
                self.validation_failed_handle_key(key_event)
            }
        }
    }
}

// ── Renderable ──

impl Renderable for OnboardingWidget {
    fn desired_height(&self, _width: u16) -> u16 {
        match &self.state {
            OnboardingState::ModelSelection {
                filtered_indices, ..
            } => {
                let items = MAX_POPUP_ROWS.min(filtered_indices.len().max(1)) as u16;
                items + 8
            }
            OnboardingState::CustomModelName { .. } => 8,
            OnboardingState::ProviderSelection { items, .. } => items.len() as u16 * 2 + 6,
            OnboardingState::InlineSetup { .. } => 20,
            OnboardingState::InvocationMethod { items, .. } => items.len() as u16 * 2 + 6,
            OnboardingState::ReasoningEffort { items, .. } => items.len() as u16 + 6,
            OnboardingState::Validating { .. } => 10,
            OnboardingState::ValidationFailed { .. } => 12,
        }
    }

    fn render(&self, area: Rect, buf: &mut Buffer) {
        match &self.state {
            OnboardingState::ModelSelection {
                items,
                state,
                search_query,
                filtered_indices,
            } => {
                Self::render_model_selection(
                    items,
                    state,
                    search_query,
                    filtered_indices,
                    area,
                    buf,
                );
            }
            OnboardingState::CustomModelName { input, cursor_pos } => {
                Self::render_custom_model_name(input, *cursor_pos, area, buf);
            }
            OnboardingState::ProviderSelection {
                model: _,
                items,
                selected_idx,
            } => {
                Self::render_provider_selection("", items, *selected_idx, area, buf);
            }
            OnboardingState::InlineSetup {
                model,
                provider_name,
                base_url,
                api_key,
                model_name,
                display_name,
                active_field,
                input,
                cursor_pos,
                ..
            } => {
                Self::render_inline_setup(
                    model,
                    provider_name,
                    base_url,
                    api_key,
                    model_name,
                    display_name,
                    active_field,
                    input,
                    *cursor_pos,
                    area,
                    buf,
                );
            }
            OnboardingState::InvocationMethod {
                items,
                selected_idx,
                ..
            } => {
                Self::render_invocation_method(items, *selected_idx, area, buf);
            }
            OnboardingState::ReasoningEffort {
                items,
                selected_idx,
                ..
            } => {
                Self::render_reasoning_effort(items, *selected_idx, area, buf);
            }
            OnboardingState::Validating {
                model,
                provider,
                started_at,
                ..
            } => {
                if self.animations_enabled {
                    self.frame_requester.schedule_frame_in(SPINNER_INTERVAL);
                }
                Self::render_validating(
                    model,
                    *provider,
                    *started_at,
                    self.animations_enabled,
                    area,
                    buf,
                );
            }
            OnboardingState::ValidationFailed {
                error_message,
                selected_action,
                ..
            } => {
                Self::render_validation_failed(error_message, *selected_action, area, buf);
            }
        }
    }

    fn cursor_pos(&self, _area: Rect) -> Option<(u16, u16)> {
        None
    }
}
