---
artifact_id: L1-REQ-AGENT-005
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Human
last_updated: 2026-05-21
---

# L1-REQ-AGENT-005 — Plan Mode

## Purpose

Allow users to request analysis and strategic planning without allowing the agent to modify files during that mode.

## Background / Context

Some tasks require careful codebase analysis before implementation. Users may want the agent to inspect the repository, reason about constraints, and produce a plan without making changes. Plan Mode provides that behavior.

Plan Mode is not a session-level agent mode such as Coding Mode or Security Mode. It is a session-local agent collaboration mode that may be entered during a session. Normal Mode is the ordinary non-Plan agent collaboration mode.

Because asking the user a question can interrupt active execution, the dedicated question tool is reserved for Plan Mode. In Normal Mode, the agent must not invoke the question tool.

## User / Business Requirement

The program must support Plan Mode, where the agent can analyze the codebase and produce a strategic plan while being prohibited from modifying files.

## Real User Scenarios

- A user asks the agent to inspect a complex subsystem and propose an implementation plan before any files are changed.
- A user enters Plan Mode because they want clarification and design discussion before committing to edits.
- A user expects Normal Mode execution to continue without being interrupted by the question tool.

## Functional Requirements

- The program must support Plan Mode as a session-local agent collaboration mode.
- In Plan Mode, the agent must not create, edit, delete, rename, or otherwise modify files.
- In Plan Mode, the agent may read files, search the codebase, inspect project context, and use other non-mutating analysis capabilities where permitted.
- In Plan Mode, the agent must produce a strategic plan based on user input and codebase analysis.
- In Plan Mode, if the agent needs clarification from the user, it may use the question tool.
- The question tool must be available only in Plan Mode.
- In Normal Mode, the agent must not invoke the question tool.
- Entering or leaving Plan Mode must not change the session-level agent mode such as Coding Mode or Security Mode.

## Non-Functional Requirements

- Plan Mode must provide strong protection against accidental file modification.
- Plan Mode output must be actionable enough for the user to decide whether to proceed with implementation.
- The restriction on the question tool must be clear enough that Normal Mode execution is not disrupted by unexpected user-question prompts.
- Plan Mode status must be visible to the user when active.

## Acceptance Criteria

- Given Plan Mode is active, when the agent analyzes a task, then it does not modify files.
- Given Plan Mode is active, when the agent needs clarification, then it may ask the user through the question tool.
- Given Normal Mode is active, when the agent needs to continue work, then it does not invoke the question tool.
- Given Plan Mode is active, when the agent completes analysis, then it provides a strategic plan rather than applying changes.
- Given the TUI enters Plan Mode, when the user inspects the session-level agent mode, then Coding Mode or Security Mode remains unchanged.
- Given a mutating tool is requested while Plan Mode is active, when the program evaluates the request, then the program blocks the mutation or reports that Plan Mode prohibits file modification.

## Out of Scope

- This requirement does not define the exact command, keybinding, label, or visual design used to enter or leave Plan Mode.
- This requirement does not define the internal implementation of the question tool.
- This requirement does not prohibit approval prompts or safety prompts that are separate from the question tool.
- This requirement does not require Plan Mode to produce an implementation patch.

## Open Questions

- Should Plan Mode allow non-file side effects such as running commands, network requests, or subagents?
- Should Plan Mode end automatically after a plan is produced, or remain active until the user exits it?
- What exact user action should convert a Plan Mode plan into Normal Mode implementation work?

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| related-to | L1-REQ-TUI-009 | 1 | specs/L1/L1-REQ-TUI-009-session-input-modes.md | The TUI exposes Plan Mode as a session-local input mode and status-line label. |
| related-to | L1-REQ-AGENT-003 | 1 | specs/L1/L1-REQ-AGENT-003-task-planning.md | Task planning defines visible plan state refined by Plan Mode behavior. |
| related-to | L1-REQ-TOOL-002 | 1 | specs/L1/L1-REQ-TOOL-002-tools.md | Built-in tools include user-question capability, which Plan Mode restricts. |
| related-to | L2-DES-TOOL-001 | 1 | specs/L2/tool/L2-DES-TOOL-001-built-in-tool-system.md | Tool mode gating enforces Plan Mode restrictions for mutating tools and the question tool. |
| refined-by | TBD | TBD | specs/L2/agent/TBD.md | L2 design has not been authored yet. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-21 | Assistant | Initial | Initial draft from approved Plan Mode requirement. |
| 1 | 2026-05-22 | Human | Traceability | Linked Plan Mode restrictions to the L2 tool system design. |
