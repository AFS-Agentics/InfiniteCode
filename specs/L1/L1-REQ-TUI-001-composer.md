---
artifact_id: L1-REQ-TUI-001
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Human
last_updated: 2026-05-23
---

# L1-REQ-TUI-001 — Composer

## Purpose

Define user expectations for the TUI input composer.

## Why This Matters

The composer is where users express tasks, corrections, and commands. Input behavior must be predictable so users do not accidentally submit when they intended to insert a newline or lose non-ASCII text.

## Background / Context

The composer is the primary place where users write prompts, commands, and multi-line task descriptions.

## User / Business Requirement

The TUI must provide a reliable and ergonomic composer for entering user input.

## Real User Scenarios

- A user writes a multi-line task description and submits it as one message.
- A user enters Chinese or other IME text and expects the composer to preserve it in supported terminals.

## Functional Requirements

- The composer must support normal text entry.
- The composer must support multi-line input.
- The composer must support submitting user input intentionally.
- The composer must support session-local input modes where input interpretation differs from normal chat input.
- The composer should support command entry and discovery where appropriate.

## Non-Functional Requirements

- Input behavior must be predictable across supported terminals.
- The composer must preserve non-ASCII and IME input where supported by the terminal.

## Acceptance Criteria

- Given the user enters multi-line text, when the user submits, then the full input is sent as one user message.
- Given the user uses non-ASCII input, when the terminal supports it, then the composer preserves the entered text.
- Given the user intends to insert a newline, when the required key sequence is supported, then the composer inserts a newline instead of submitting.
- Given the composer enters a non-default input mode, when the user submits input, then the TUI interprets the input according to that active mode.
- Given the user opens command entry, when command suggestions are available, then the composer makes them discoverable without replacing typed text unexpectedly.

## Out of Scope

- The program does not define specific keybindings, terminal event handling, or composer rendering implementation in this L1 requirement.
- This requirement does not guarantee identical keyboard behavior in terminals that do not report the required input events.

## Open Questions

- Which submit and newline keybindings should be required across supported terminals?

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| related-to | L1-REQ-TUI-009 | 1 | specs/L1/L1-REQ-TUI-009-session-input-modes.md | Session input modes define how composer input interpretation changes during a session. |
| refined-by | L2-DES-TUI-003 | 1 | specs/L2/tui/L2-DES-TUI-003-composer-and-input-modes.md | Defines composer layout, multi-line input, submission semantics, command discovery, Shell Mode, Plan Mode, and Unicode constraints. |
| related-to | L2-DES-CLIENT-001 | 1 | specs/L2/client/L2-DES-CLIENT-001-localization-readiness.md | Defines Unicode, IME, grapheme, and display-width constraints used by composer input. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-20 | Assistant | Initial | Initial draft with approved L1 refinement. |
| 1 | 2026-05-21 | Human | Refinement | Added support for session-local composer input modes. |
