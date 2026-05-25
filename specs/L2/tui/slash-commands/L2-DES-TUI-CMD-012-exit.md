---
artifact_id: L2-DES-TUI-CMD-012
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Assistant
last_updated: 2026-05-23
---

# L2-DES-TUI-CMD-012 — Slash Command: /exit

## Purpose

Define the TUI behavior for `/exit`, which exits the TUI while preserving terminal safety and server-owned session durability.

## Command Contract

- Command: `/exit`
- Description: `exit Devo`
- Parameters: none in the first milestone.
- Mutability: TUI process lifecycle only, unless the user also chooses an active-work policy.
- Active-turn availability: allowed, but must clearly handle active work.

## UI Flow

If no active turn exists, `/exit` starts terminal cleanup immediately.

If active work exists, the TUI must present a concise choice before exit.

```text
┃ /exit

  Active work is still running.
  [Keep Running And Exit] [Interrupt And Exit] [Cancel]
```

## State And Error Behavior

- `/exit` must use the terminal lifecycle cleanup path defined by `L2-DES-TUI-005`.
- The TUI must restore terminal modes and leave shell prompt placement to the shell.
- The command must not delete the current session.
- If the server continues active work after the TUI exits, the session must remain resumable.
- If cleanup fails, the TUI should emit the terminal-safe cleanup warning defined by the lifecycle design.

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| refines | L1-REQ-TUI-006 | 1 | specs/L1/L1-REQ-TUI-006-command-discovery-control.md | Defines command-specific behavior for a discoverable TUI command. |
| related-to | L1-REQ-TUI-005 | 1 | specs/L1/L1-REQ-TUI-005-terminal-lifecycle-safety.md | Exit must use terminal-safe cleanup behavior. |
| related-to | L2-DES-TUI-005 | 1 | specs/L2/tui/L2-DES-TUI-005-terminal-lifecycle-safety.md | Defines exit, cleanup, and shell prompt handoff. |
| related-to | L2-DES-TUI-003 | 1 | specs/L2/tui/L2-DES-TUI-003-composer-and-input-modes.md | Uses shared slash-command discovery and invocation behavior. |
| specified-by | TBD | TBD | specs/L3/tui/TBD.md | L3 behavior has not been authored yet. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-23 | Assistant | Initial | Initial `/exit` command design. |
