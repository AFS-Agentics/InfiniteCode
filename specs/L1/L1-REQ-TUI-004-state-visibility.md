---
artifact_id: L1-REQ-TUI-004
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Human
last_updated: 2026-05-23
---

# L1-REQ-TUI-004 — State Visibility

## Purpose

Ensure that users can always understand what the TUI is currently doing.

## Background / Context

The TUI is the primary interactive surface for agent work. A turn may be idle, generating model output, running tools, waiting for approval, waiting for a user answer, interrupted, failed, or completed. If these states are not visible, users cannot decide whether to wait, interrupt, approve, retry, or inspect results.

## User / Business Requirement

The TUI must make the current execution state visible and understandable to the user.

## Functional Requirements

- The TUI must show when the program is idle and ready for input.
- The TUI must show when model output is being generated.
- The TUI must show when a tool is preparing, running, producing output, completed, failed, or waiting.
- The TUI must expose current background processes started by the program and provide access to their manual stop controls.
- The TUI must show active non-default session-local input modes such as Shell Mode and Plan Mode.
- The TUI must show when the program is waiting for approval or a user answer.
- The TUI must show when a turn has been interrupted, failed, or completed.
- The TUI must preserve important state transitions in the transcript where they are relevant for later review.

## Non-Functional Requirements

- State indicators must be concise enough to remain readable during normal work.
- State indicators must not obscure the composer, transcript, or active tool output.
- State transitions must be timely enough that users do not mistake active work for a frozen interface.

## Acceptance Criteria

- Given no turn is active, when the TUI is open, then the user can tell that input may be submitted.
- Given model output is streaming, when the turn is running, then the user can tell that generation is active.
- Given a tool is running, when the tool starts or produces output, then the user can tell which tool is active.
- Given a background process started by the program remains active, when the user views TUI state, then the user can identify that process and access the stop control.
- Given Shell Mode or Plan Mode is active, when the user views TUI state, then the active non-default input mode is visible.
- Given the program waits for approval or a user answer, when the user looks at the TUI, then the waiting reason is visible.
- Given a turn fails or is interrupted, when the user reviews the transcript, then the final state is visible.

## Out of Scope

- This requirement does not define exact symbols, colors, spinner frames, layout positions, or animation implementation.
- This requirement does not define the internal event model used to represent execution state.

## Open Questions

- Which states require persistent transcript entries, and which states should remain live-only?

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| related-to | L1-REQ-TOOL-005 | 1 | specs/L1/L1-REQ-TOOL-005-background-process-management.md | Background process management defines the current process state and manual stop behavior the TUI must expose. |
| related-to | L1-REQ-TUI-009 | 1 | specs/L1/L1-REQ-TUI-009-session-input-modes.md | Session input modes define Shell Mode and Plan Mode visibility in the TUI. |
| refined-by | L2-DES-TUI-004 | 1 | specs/L2/tui/L2-DES-TUI-004-streaming-transcript-and-state.md | Defines visible state mapping for idle, model generation, tool lifecycle, approvals, questions, interruptions, failures, completion, and background processes. |
| related-to | L2-DES-TUI-002 | 1 | specs/L2/tui/L2-DES-TUI-002-modern-tui-shell-layout.md | Defines shell regions that present current execution state. |
| related-to | L2-DES-TUI-003 | 1 | specs/L2/tui/L2-DES-TUI-003-composer-and-input-modes.md | Defines bottom status line labels for active input modes. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-21 | Assistant | Initial | Initial draft approved for L1 expansion. |
| 1 | 2026-05-21 | Human | Refinement | Added current background process visibility and manual stop control requirements. |
| 1 | 2026-05-21 | Human | Refinement | Added visibility for active non-default session-local input modes. |
