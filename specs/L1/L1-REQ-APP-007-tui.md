---
artifact_id: L1-REQ-APP-007
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Human
last_updated: 2026-05-23
---

# L1-REQ-APP-007 — Terminal User Interface

## Purpose

Define the high-level user experience expected from the terminal client.

## Why This Matters

The TUI is the initial way users interact with the program. It must make agent work understandable in a terminal while preserving terminal workflows such as scrollback, keyboard input, and safe exit behavior.

## Background / Context

The initial client surface is a terminal interface. It must support interactive agent work while preserving useful terminal behavior.

## User / Business Requirement

The program must provide a terminal user interface that supports interactive sessions, visible execution state, transcript review, and efficient input.

## Real User Scenarios

- A user runs the TUI inside an existing terminal and wants prior terminal scrollback to remain useful after exit.
- A user watches a running turn and needs to see session status, transcript updates, and the composer without switching tools.

## Functional Requirements

- The TUI must support an inline mode that preserves terminal scrollback where appropriate.
- The TUI should support an alternate full-screen mode where appropriate.
- The TUI must expose a header or status area, transcript area, and composer area.
- The TUI must support onboarding, command discovery, and visible state for active work.

## Non-Functional Requirements

- The TUI must be usable in common terminal environments.
- The TUI must avoid corrupting terminal state after exit.

## Acceptance Criteria

- Given an interactive session, when the user opens the TUI, then the user can identify the current session state and input area.
- Given inline mode, when the user exits, then useful terminal scrollback remains available.
- Given a turn is running, when the user looks at the TUI, then active work state is visible without requiring log inspection.
- Given the TUI exits normally, when control returns to the shell, then terminal state is not visibly corrupted.

## Out of Scope

- The program does not define detailed widget layout, keybinding mapping, color theme implementation, or rendering algorithms in this L1 requirement.
- This requirement does not require all terminal clients to render identically.

## Open Questions

- Which terminal environments are part of the required support matrix?

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| refined-by | L2-DES-TUI-002 | 1 | specs/L2/tui/L2-DES-TUI-002-modern-tui-shell-layout.md | Defines the modern terminal shell, core regions, inline/fullscreen consistency, responsive layout, and visible active-work UX. |
| related-to | L2-DES-TUI-003 | 1 | specs/L2/tui/L2-DES-TUI-003-composer-and-input-modes.md | Defines the composer, command discovery, and input-mode behavior used by the TUI shell. |
| related-to | L2-DES-TUI-004 | 1 | specs/L2/tui/L2-DES-TUI-004-streaming-transcript-and-state.md | Defines streaming transcript and active state rendering. |
| related-to | L2-DES-TUI-005 | 1 | specs/L2/tui/L2-DES-TUI-005-terminal-lifecycle-safety.md | Defines inline scrollback preservation and terminal-safe exit behavior. |
| related-to | L2-DES-TUI-001 | 1 | specs/L2/tui/L2-DES-TUI-001-onboarding-ui-flow.md | Defines the onboarding flow required by the TUI. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-20 | Assistant | Initial | Initial draft with approved L1 refinement. |
