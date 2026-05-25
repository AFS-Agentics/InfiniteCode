---
artifact_id: L1-REQ-TUI-007
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Human
last_updated: 2026-05-23
---

# L1-REQ-TUI-007 — Responsive Layout and Readability

## Purpose

Ensure that the TUI remains readable and usable across practical terminal sizes.

## Background / Context

Terminal users may run the program in narrow panes, full-screen terminals, split panes, or resized windows. The TUI includes header/status information, transcript content, live tool output, command suggestions, composer input, and a bottom status line. Layout failures can make the interface unusable even when the underlying agent is working correctly.

## User / Business Requirement

The TUI must adapt to practical terminal sizes without overlapping, truncating critical state incorrectly, or making input and output unreadable.

## Functional Requirements

- The TUI must preserve a usable composer area across supported terminal sizes.
- The TUI must keep transcript content readable with long lines, long outputs, and narrow widths.
- The TUI must avoid overlapping header, transcript, live output, command suggestions, composer content, and the bottom status line.
- The TUI must degrade gracefully when optional information does not fit.
- The TUI must make truncation, folding, or omission visible when important content cannot be shown inline.

## Non-Functional Requirements

- Layout behavior must remain stable during streaming updates and terminal resize events.
- Essential state must take priority over decorative or secondary information.
- The TUI must avoid visual jitter that prevents users from reading active content.

## Acceptance Criteria

- Given a narrow but supported terminal width, when the TUI renders, then composer input remains usable.
- Given long transcript output, when it is displayed, then it wraps, folds, or truncates in a way that remains understandable.
- Given the terminal is resized during a turn, when the TUI redraws, then visible regions do not overlap incoherently.
- Given optional header, status, or input-mode details do not fit, when the TUI renders, then essential task state remains visible.

## Out of Scope

- This requirement does not define exact breakpoints, layout algorithms, cell dimensions, or rendering primitives.
- This requirement does not require the TUI to support terminal dimensions too small for meaningful interaction.

## Open Questions

- What minimum terminal size should be considered supported?

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| related-to | L1-REQ-TUI-009 | 1 | specs/L1/L1-REQ-TUI-009-session-input-modes.md | Session input modes require a bottom status line below the composer. |
| refined-by | L2-DES-TUI-002 | 1 | specs/L2/tui/L2-DES-TUI-002-modern-tui-shell-layout.md | Defines responsive region priorities, narrow layout behavior, non-overlap rules, and graceful degradation. |
| related-to | L2-DES-TUI-003 | 1 | specs/L2/tui/L2-DES-TUI-003-composer-and-input-modes.md | Defines composer and bottom status line layout behavior. |
| related-to | L2-DES-TUI-004 | 1 | specs/L2/tui/L2-DES-TUI-004-streaming-transcript-and-state.md | Defines streaming and transcript rendering stability. |
| related-to | L2-DES-CLIENT-001 | 1 | specs/L2/client/L2-DES-CLIENT-001-localization-readiness.md | Defines display-width aware rendering for Unicode and localized text. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-21 | Assistant | Initial | Initial draft approved for L1 expansion. |
| 1 | 2026-05-21 | Human | Refinement | Added bottom status line layout considerations for session input mode display. |
