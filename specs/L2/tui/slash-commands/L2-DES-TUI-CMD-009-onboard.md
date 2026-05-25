---
artifact_id: L2-DES-TUI-CMD-009
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Assistant
last_updated: 2026-05-23
---

# L2-DES-TUI-CMD-009 — Slash Command: /onboard

## Purpose

Define the TUI behavior for `/onboard`, which enters the onboarding process after the initial startup path.

## Command Contract

- Command: `/onboard`
- Description: `configure model provider connection`
- Parameters: none in the first milestone.
- Mutability: determined by the onboarding process.
- Active-turn availability: blocked while active work is running.

## UI Flow

`/onboard` is an entry command. After invocation, the TUI enters the onboarding process defined by `L2-DES-TUI-001`.

Rules:

- This command must not duplicate or redefine the onboarding sequence.
- Model selection, provider selection or creation, provider fields, invocation method selection, reasoning effort selection, validation, credential handling, and persistence are owned by `L2-DES-TUI-001`.
- The command should hand control to the onboarding UI without creating a transcript turn.
- If onboarding is already active, invoking `/onboard` should focus or resume the existing onboarding flow rather than starting a conflicting second flow.

## State And Error Behavior

- If active work blocks onboarding entry, the TUI must explain why and keep the current session state unchanged.
- Once onboarding starts, all state changes, validation failures, persistence failures, and successful setup behavior follow `L2-DES-TUI-001`.
- Canceling onboarding returns the user to the prior session view.

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| refines | L1-REQ-TUI-006 | 1 | specs/L1/L1-REQ-TUI-006-command-discovery-control.md | Defines command-specific behavior for a discoverable TUI command. |
| related-to | L1-REQ-TUI-010 | 1 | specs/L1/L1-REQ-TUI-010-onboarding-ui.md | `/onboard` reopens the TUI onboarding workflow. |
| related-to | L2-DES-TUI-001 | 1 | specs/L2/tui/L2-DES-TUI-001-onboarding-ui-flow.md | Defines the concrete onboarding UI flow. |
| related-to | L2-DES-MODEL-001 | 1 | specs/L2/model/L2-DES-MODEL-001-model-provider-binding.md | Defines provider and model-provider binding records. |
| related-to | L2-DES-TUI-003 | 1 | specs/L2/tui/L2-DES-TUI-003-composer-and-input-modes.md | Uses shared slash-command discovery and invocation behavior. |
| specified-by | TBD | TBD | specs/L3/tui/TBD.md | L3 behavior has not been authored yet. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-23 | Assistant | Initial | Initial `/onboard` command design. |
| 1 | 2026-05-23 | Human | Refinement | Clarified that `/onboard` only enters the onboarding process owned by `L2-DES-TUI-001`. |
