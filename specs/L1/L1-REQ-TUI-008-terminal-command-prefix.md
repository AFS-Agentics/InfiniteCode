---
artifact_id: L1-REQ-TUI-008
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Human
last_updated: 2026-05-23
---

# L1-REQ-TUI-008 — Terminal Command Prefix

## Purpose

Define the TUI-only behavior for entering Shell Mode and executing terminal commands from composer input that begins with `!`.

## Background / Context

Terminal users need a fast way to run commands without leaving the TUI flow. In the TUI, a leading `!` is a compact terminal-oriented shortcut for entering Shell Mode and preparing command execution. This behavior is specific to the terminal client and should not be treated as a mandatory behavior for every client surface.

## User / Business Requirement

The TUI must recognize input beginning with `!` as a request to enter Shell Mode, execute the shell-mode input through the terminal command capability, and display the command result to the user.

## Real User Scenarios

- A user types `!` in the TUI composer, sees Shell Mode become active, then enters a command and expects the command result to be returned in the TUI.
- A user wants to run a quick diagnostic command without switching away from the active TUI session.

## Functional Requirements

- In the TUI, if composer input begins with `!`, the TUI must enter Shell Mode rather than treating the input as a normal chat message.
- Shell Mode input must execute through the program's terminal command capability.
- The result of Shell Mode command execution must be returned and displayed in the TUI.
- The TUI must make it clear when Shell Mode is active.
- Terminal command execution from the TUI must respect workspace, safety, privacy, and permission boundaries.

## Non-Functional Requirements

- Prefix behavior must be predictable and must not silently execute commands from ambiguous input.
- Command output display must be bounded and readable in the TUI.
- The terminal command prefix must not make ordinary chat input fragile or surprising.

## Acceptance Criteria

- Given the TUI user enters input beginning with `!`, when the input is submitted, then the program executes the remaining text as a terminal command and returns the command result in the TUI.
- Given the TUI user enters `!` as the input prefix, when the composer renders the input state, then the user can tell Shell Mode is active rather than normal chat input.
- Given a `!` command would exceed permissions, when the action is invoked, then the program follows the applicable safety and approval behavior.
- Given a `!` command produces output, when the TUI displays the result, then the output is bounded enough to keep the TUI usable.

## Out of Scope

- This requirement does not require non-TUI clients to support leading `!` command execution.
- This requirement does not define the shell command execution backend, command parsing rules, quoting behavior, or process lifecycle implementation.
- This requirement does not define exact TUI layout, keybindings, colors, or rendering details.

## Open Questions

- Should whitespace before `!` still trigger TUI terminal command behavior?
- Should `!` commands require confirmation under restrictive permission modes?
- How should TUI users escape a leading `!` when they intend to send a normal chat message?

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| related-to | L1-REQ-CLIENT-004 | 1 | specs/L1/L1-REQ-CLIENT-004-prefixed-input-actions.md | Separates TUI-only terminal command prefix behavior from general client fuzzy-search prefix behavior. |
| related-to | L1-REQ-TUI-009 | 1 | specs/L1/L1-REQ-TUI-009-session-input-modes.md | Defines Shell Mode as a session-local TUI input mode and its status-line visibility. |
| related-to | L1-REQ-TOOL-002 | 1 | specs/L1/L1-REQ-TOOL-002-tools.md | Built-in command execution provides the underlying terminal command capability. |
| refined-by | L2-DES-TUI-003 | 1 | specs/L2/tui/L2-DES-TUI-003-composer-and-input-modes.md | Defines leading `!` Shell Mode entry, escaping, one-shot command submission, result display, and safety boundaries. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-21 | Assistant | Initial | Initial draft from approved TUI-only terminal command prefix requirement. |
| 1 | 2026-05-21 | Human | Refinement | Clarified that entering the `!` prefix switches the TUI into Shell Mode. |
