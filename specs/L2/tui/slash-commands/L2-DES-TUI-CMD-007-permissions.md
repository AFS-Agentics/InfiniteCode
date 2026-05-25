---
artifact_id: L2-DES-TUI-CMD-007
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Assistant
last_updated: 2026-05-23
---

# L2-DES-TUI-CMD-007 — Slash Command: /permissions

## Purpose

Define the TUI behavior for `/permissions`, which lets the user choose what the program is allowed to do in the current session.

## Command Contract

- Command: `/permissions`
- Description: `choose what Devo is allowed to do`
- Parameters: none in the first milestone.
- Mutability: session permission metadata and possibly durable configuration, depending on persistence choice.
- Active-turn availability: allowed only for future work; it must not retroactively authorize already-running tool calls.

## UI Flow

`/permissions` opens a selection popup.

```text
┃ /permissions

  default
  auto-approved
  full access
```

Rules:

- The current permission mode is preselected.
- The popup must summarize the operational effect of each mode.
- Enter applies; Esc cancels.
- If a tool approval is currently pending, the TUI must distinguish changing the default permission mode from answering that specific approval.

## State And Error Behavior

- Permission changes should be recorded as session metadata changes.
- The change applies to later tool decisions, not to already-issued provider or tool requests.
- If a mode is blocked by policy, the TUI should show why and keep the existing mode.

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| refines | L1-REQ-TUI-006 | 1 | specs/L1/L1-REQ-TUI-006-command-discovery-control.md | Defines command-specific behavior for a discoverable TUI command. |
| related-to | L1-REQ-TOOL-001 | 1 | specs/L1/L1-REQ-TOOL-001-safety.md | Permissions constrain tool safety and approval behavior. |
| related-to | L2-DES-TUI-004 | 1 | specs/L2/tui/L2-DES-TUI-004-streaming-transcript-and-state.md | Approval and waiting states must remain visible. |
| related-to | L2-DES-TUI-003 | 1 | specs/L2/tui/L2-DES-TUI-003-composer-and-input-modes.md | Uses shared slash-command discovery and invocation behavior. |
| specified-by | TBD | TBD | specs/L3/tui/TBD.md | L3 behavior has not been authored yet. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-23 | Assistant | Initial | Initial `/permissions` command design. |
