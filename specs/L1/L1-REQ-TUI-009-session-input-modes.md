---
artifact_id: L1-REQ-TUI-009
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Human
last_updated: 2026-05-23
---

# L1-REQ-TUI-009 — Session Input Modes

## Purpose

Define TUI session-local input modes and how active non-default input modes are shown to the user.

## Background / Context

The TUI composer may temporarily enter different input modes during a session. These input modes control how composer input is interpreted in the TUI. They are different from session-level agent modes such as Coding Mode and Security Mode, which are selected before or at session creation and remain locked for that session.

The initial TUI input modes are Default Input Mode, Shell Mode, and Plan Mode. Default Input Mode is the normal chat input state. In the bottom status line, it is represented by the normal work-state label `Build` rather than a generic `Default` label. Shell Mode and Plan Mode are non-default input modes and must be visible while active.

Plan Mode is not only a visual label. When active, it applies the agent-level Plan Mode behavior: the agent analyzes and plans without modifying files, and the question tool may be used for clarification only in this mode.

## User / Business Requirement

The TUI must support session-local input modes and display active non-default input modes in the bottom status line without confusing them with session-level agent modes.

## Real User Scenarios

- A user types `!` at the start of composer input and sees the TUI enter Shell Mode before submitting a terminal command.
- A user enters Plan Mode during a session and can tell from the bottom status line that composer input is currently plan-oriented rather than normal chat input.
- A user returns to Default Input Mode and sees the normal `Build` status label rather than an unnecessary `Default` label.

## Functional Requirements

- The TUI must support Default Input Mode as the normal composer input mode.
- The TUI must support Shell Mode for terminal-command input.
- The TUI must support Plan Mode for plan-oriented interaction governed by the agent-level Plan Mode behavior.
- Session-local input modes must be changeable during a session without changing the session-level agent mode.
- The TUI must provide a bottom status line below the bottom composer.
- When Shell Mode is active, the TUI must display the active mode label on the right side of the bottom status line.
- When Plan Mode is active, the TUI must display the active mode label on the right side of the bottom status line.
- When Default Input Mode is active, the TUI must display the normal `Build` status label and must not display a generic `Default` mode label.
- The TUI must avoid presenting Shell Mode or Plan Mode as Coding Mode, Security Mode, or any other session-level agent mode.
- The TUI must not present Plan Mode as permission to modify files.

## Non-Functional Requirements

- Input mode indicators must be concise and readable in normal terminal sizes.
- Input mode changes must be visible quickly enough that users can predict how submitted input will be handled.
- The bottom status line must not obscure composer input or transcript content.
- Mode labels must remain visually subordinate to the active composer while still being discoverable.

## Acceptance Criteria

- Given the TUI composer is in Default Input Mode, when the bottom status line renders, then the normal `Build` status label is shown and no generic `Default` mode label is shown.
- Given the user enters `!` as the input prefix, when the TUI recognizes the prefix, then the TUI enters Shell Mode.
- Given Shell Mode is active, when the bottom status line renders, then a Shell Mode label appears on the right side of the bottom status line.
- Given Plan Mode is active, when the bottom status line renders, then a Plan Mode label appears on the right side of the bottom status line.
- Given Plan Mode is active, when the agent responds to user input, then the Plan Mode file-modification prohibition applies.
- Given the session-level agent mode is Coding Mode or Security Mode, when the user switches TUI input mode, then the session-level agent mode remains unchanged.
- Given the bottom composer is visible, when the TUI renders the bottom status line, then the status line appears below the composer.

## Out of Scope

- This requirement does not define the exact commands, keybindings, labels, colors, or rendering implementation for entering or leaving Plan Mode.
- This requirement does not define the terminal command execution backend used by Shell Mode.
- This requirement does not allow TUI input modes to change the session-level agent mode.

## Open Questions

- What command or keybinding should enter and leave Plan Mode?
- Should Shell Mode exit automatically after a command is submitted?

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| related-to | L1-REQ-TUI-008 | 1 | specs/L1/L1-REQ-TUI-008-terminal-command-prefix.md | The `!` terminal command prefix enters Shell Mode. |
| related-to | L1-REQ-APP-013 | 1 | specs/L1/L1-REQ-APP-013-agent-modes.md | Session-local input modes must remain distinct from session-level agent modes. |
| related-to | L1-REQ-AGENT-005 | 1 | specs/L1/L1-REQ-AGENT-005-plan-mode.md | Agent Plan Mode defines planning-only behavior and question-tool restrictions. |
| refined-by | L2-DES-TUI-003 | 1 | specs/L2/tui/L2-DES-TUI-003-composer-and-input-modes.md | Defines Default Input Mode, Shell Mode, Plan Mode, bottom status line labels, and Plan Mode submission behavior. |
| related-to | L2-DES-TUI-002 | 1 | specs/L2/tui/L2-DES-TUI-002-modern-tui-shell-layout.md | Defines the bottom status line region where non-default input modes are displayed. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-21 | Assistant | Initial | Initial draft from approved TUI session-local input mode requirement. |
| 1 | 2026-05-21 | Human | Refinement | Linked TUI Plan Mode to agent-level planning-only behavior and question-tool restrictions. |
| 1 | 2026-05-23 | Human | Refinement | Updated bottom status behavior to use `Build`, `Plan`, and `Shell` labels rather than hiding the normal work-state label. |
