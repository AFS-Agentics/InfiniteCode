---
artifact_id: L1-REQ-LLM-003
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Human
last_updated: 2026-05-23
---

# L1-REQ-LLM-003 — Model Usage Observability

## Purpose

Make model usage and cost-relevant information visible to users.

## Why This Matters

Model calls are often the most expensive and opaque part of the workflow. Usage observability lets users understand token pressure, caching behavior, and why context compression or model changes may be needed.

## Background / Context

Users need to understand model calls, token consumption, cached-token usage, context-window pressure, output generation, and streaming response behavior for debugging and cost control.

## User / Business Requirement

The program must expose model usage observability for user-facing and diagnostic workflows.

## Real User Scenarios

- A user asks why a long session was compressed and sees that context-window usage was near the limit.
- A user compares two turns and sees read, write, and cached-read token usage when the provider reports it.
- A user enables trace logging to diagnose streaming behavior and can inspect recorded model response stream events.

## Functional Requirements

- The program must record input token usage where available.
- The program must record output token usage where available.
- The program must record cached input token usage where available.
- The program must expose current context-window usage or estimate where available.
- When trace logging mode is enabled, the program must record streaming response data from large language model calls.
- Trace-mode streaming response records must preserve enough information to diagnose streaming behavior, such as response deltas, timing, ordering, and completion state where available.

## Non-Functional Requirements

- Usage reporting must clearly distinguish measured values from estimates.
- Usage reporting must not leak sensitive prompt content.
- Trace-mode streaming response logging must follow privacy, secret-handling, and configured log-retention controls.

## Acceptance Criteria

- Given a completed model call with usage data, when the user inspects usage, then read, write, and cached-read values are visible if provided.
- Given context-window pressure, when the program reports status, then the user can see that context usage is high or near a limit.
- Given usage values are estimated rather than provider-reported, when they are displayed, then the program labels them as estimates.
- Given usage data is unavailable from a provider, when the user inspects the turn, then the program reports that the value is unavailable rather than inventing it.
- Given trace logging mode is enabled, when a large language model response streams, then the program records the streaming response events for diagnostic inspection.
- Given trace logging mode is disabled, when a large language model response streams, then the program does not record response stream content solely for trace diagnostics.

## Out of Scope

- The program does not define provider-specific usage parsing or billing calculations in this L1 requirement.
- This requirement does not guarantee exact monetary cost reporting for every provider.

## Open Questions

- Should usage be displayed per turn, per session, or both?

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| related-to | L1-REQ-APP-004 | 1 | specs/L1/L1-REQ-APP-004-observability.md | Application observability defines trace logging behavior and diagnostic logging constraints. |
| refined-by | L2-DES-LLM-003 | 1 | specs/L2/llm/L2-DES-LLM-003-model-usage-observability.md | Defines usage metrics, context pressure, measured versus estimated values, unavailable values, and trace-mode stream records. |
| related-to | L2-DES-APP-004 | 1 | specs/L2/app/L2-DES-APP-004-observability-architecture.md | Defines the cross-system logging, diagnostics, trace-mode, privacy, and retention architecture used by model observability. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-20 | Assistant | Initial | Initial draft with approved L1 refinement. |
| 1 | 2026-05-21 | Human | Refinement | Added trace-mode logging of large language model streaming response events. |
