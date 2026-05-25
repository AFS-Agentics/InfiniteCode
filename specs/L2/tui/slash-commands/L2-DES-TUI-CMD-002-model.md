---
artifact_id: L2-DES-TUI-CMD-002
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Assistant
last_updated: 2026-05-23
---

# L2-DES-TUI-CMD-002 — Slash Command: /model

## Purpose

Define the TUI behavior for `/model`, the post-onboarding command for changing the active session model and reasoning effort.

## Command Contract

- Command: `/model`
- Description: `choose the active model`
- Parameters: none in the first milestone.
- Mutability: session metadata and, when needed, model-provider configuration.
- Active-turn availability: blocked while a turn is generating, running tools, or waiting on active execution.

## UI Flow

`/model` opens a searchable model-selection popup. After the model is selected, the TUI resolves the usable provider binding.

```text
┃ /model

  deepseek-v4-pro
  gpt-5.5
  claude-sonnet-5
```

Flow:

1. Select supported model slug.
2. Select an existing provider binding for that model, or open the provider setup flow if no binding exists.
3. Enter provider-specific model name when a new binding is required.
4. Select invocation SDK when a new binding is required.
5. Select reasoning effort if the selected model supports reasoning.
6. Confirm the selection and apply it to future turns in the current session.

## State And Error Behavior

- The TUI should use `model.list` to populate supported and configured model choices.
- The final selection should use `model.select`.
- The command must show credential status but must not display plaintext API keys in routine lists.
- If invoked during active work, the TUI shows a concise blocked message such as `Cannot change model while generating`.
- The selected model and reasoning effort affect the next turn, not an already-running invocation.

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| refines | L1-REQ-TUI-006 | 1 | specs/L1/L1-REQ-TUI-006-command-discovery-control.md | Defines `/model`, the required post-onboarding model-selection command. |
| related-to | L1-REQ-MODEL-001 | 1 | specs/L1/L1-REQ-MODEL-001-config.md | Model selection uses configured model-provider bindings. |
| related-to | L2-DES-MODEL-001 | 1 | specs/L2/model/L2-DES-MODEL-001-model-provider-binding.md | Defines supported models, user providers, and model-provider bindings. |
| related-to | L2-DES-TUI-001 | 1 | specs/L2/tui/L2-DES-TUI-001-onboarding-ui-flow.md | Provider setup may reuse the onboarding flow. |
| related-to | L2-DES-TUI-003 | 1 | specs/L2/tui/L2-DES-TUI-003-composer-and-input-modes.md | Uses shared slash-command discovery, popup, and invocation behavior. |
| specified-by | TBD | TBD | specs/L3/tui/TBD.md | L3 behavior has not been authored yet. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-23 | Assistant | Initial | Initial `/model` command design. |
