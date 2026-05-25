---
artifact_id: L1-REQ-TUI-003
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Human
last_updated: 2026-05-23
---

# L1-REQ-TUI-003 — Transcript

## Purpose

Provide a durable and readable record of the session inside the TUI.

## Why This Matters

The transcript is the user's audit trail. It must make messages, tool work, approvals, errors, and final results reviewable without requiring the user to inspect raw logs.

## Background / Context

The transcript is how users review messages, reasoning summaries, tool calls, tool outputs, approvals, errors, and final results.

## User / Business Requirement

The TUI must provide a transcript that supports review, audit, and recovery of session activity.

## Real User Scenarios

- A user scrolls back to find the command output that explained a test failure.
- A user reviews a previous approval decision before allowing a similar action.

## Functional Requirements

- The transcript must display user messages and assistant responses.
- The transcript must display tool calls, tool outputs, approvals, questions, and errors where relevant.
- The transcript must preserve completed turn history after live rendering finishes.
- The transcript must support scrolling or review of previous content.

## Non-Functional Requirements

- Transcript layout must remain readable with long outputs and narrow terminal widths.

## Acceptance Criteria

- Given a completed tool call, when the user reviews the transcript, then the command or tool summary and result are visible.
- Given a long session, when the user scrolls back, then prior relevant messages remain reviewable.
- Given output is truncated or folded, when the user views the transcript, then the transcript indicates that not all content is shown inline.
- Given a turn fails, when the transcript is reviewed, then the error and last known task state are visible.

## Out of Scope

- The program does not define exact cell rendering, folding behavior, or scroll implementation in this L1 requirement.
- This requirement does not require the transcript to display unlimited raw output inline.

## Open Questions

- Which transcript items should be collapsible by default?

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| refined-by | L2-DES-TUI-004 | 1 | specs/L2/tui/L2-DES-TUI-004-streaming-transcript-and-state.md | Defines transcript cell types, durable/live reconciliation, scrolling review, folding, and failure display. |
| related-to | L2-DES-TUI-002 | 1 | specs/L2/tui/L2-DES-TUI-002-modern-tui-shell-layout.md | Defines transcript viewport placement in the modern TUI shell. |
| related-to | L2-DES-CLIENT-001 | 1 | specs/L2/client/L2-DES-CLIENT-001-localization-readiness.md | Defines Unicode and localized content preservation for transcript rendering. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-20 | Assistant | Initial | Initial draft with approved L1 refinement. |
