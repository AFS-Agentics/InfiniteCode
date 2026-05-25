---
artifact_id: L1-REQ-TUI-002
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Human
last_updated: 2026-05-23
---

# L1-REQ-TUI-002 — Streaming Rendering

## Purpose

Make live agent progress visible while a turn is running.

## Why This Matters

Streaming is how users know the program is actively working. Late or batch-only updates make tool execution and model output feel stuck even when work is progressing.

## Background / Context

Users need to see model text, reasoning summaries, tool starts, tool output deltas, and completion states as work progresses.

## User / Business Requirement

The TUI must render streaming model and tool progress in a timely, readable way.

## Real User Scenarios

- A user watches assistant text appear incrementally instead of waiting for the full response.
- A user sees a tool row appear when a tool starts, then sees output deltas before the tool completes.

## Functional Requirements

- The TUI must stream assistant text as it becomes available.
- The TUI must stream reasoning summaries where available and appropriate.
- The TUI must show tool calls when they start, update when output arrives, and complete when results are available.
- The TUI must render Markdown content in transcript and live output where supported.

## Non-Functional Requirements

- Streaming must feel responsive during normal operation.
- Streaming rendering must not corrupt transcript layout.

## Acceptance Criteria

- Given streaming assistant text, when deltas arrive, then the TUI updates before the whole response completes.
- Given a running tool with output deltas, when output arrives, then the TUI shows progress before final completion.
- Given multiple tools run in parallel, when one tool starts or produces output, then that progress can appear before all parallel tools finish.
- Given streaming content includes Markdown, when it is displayed live, then the transcript remains readable and does not collapse into malformed layout.

## Out of Scope

- The program does not define frame scheduler, Markdown parser implementation, or internal event pipeline in this L1 requirement.
- This requirement does not require every provider to deliver streaming events with identical granularity.

## Open Questions

- What latency target should define acceptable streaming responsiveness?

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| refined-by | L2-DES-TUI-004 | 1 | specs/L2/tui/L2-DES-TUI-004-streaming-transcript-and-state.md | Defines live assistant, reasoning, tool, approval, question, background process, and Markdown streaming behavior. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-20 | Assistant | Initial | Initial draft with approved L1 refinement. |
