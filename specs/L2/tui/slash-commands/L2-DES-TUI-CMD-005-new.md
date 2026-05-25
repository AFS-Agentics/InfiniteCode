---
artifact_id: L2-DES-TUI-CMD-005
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Assistant
last_updated: 2026-05-23
---

# L2-DES-TUI-CMD-005 — Slash Command: /new

## Purpose

Define the TUI behavior for `/new`, which starts a new chat session.

## Command Contract

- Command: `/new`
- Description: `start a new chat`
- Parameters: none in the first milestone.
- Mutability: creates a new session and switches the client to it.
- Active-turn availability: requires explicit confirmation if the current session has active work.

## UI Flow

`/new` creates a fresh session using the current workspace and effective default model configuration.

```text
┃ /new

  Start a new chat?
  Current session remains saved.
  [New Chat] [Cancel]
```

Rules:

- The current session remains durable and resumable.
- The new session starts with an empty transcript and current workspace metadata.
- If onboarding or model configuration is incomplete, the command should route to `/onboard`.

## State And Error Behavior

- The TUI should use `session.create`.
- The command must not clear, delete, or overwrite the previous session.
- If creation fails, the TUI remains in the current session and shows a concise error.

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| refines | L1-REQ-TUI-006 | 1 | specs/L1/L1-REQ-TUI-006-command-discovery-control.md | Defines command-specific behavior for a discoverable TUI command. |
| related-to | L1-REQ-CONV-001 | 1 | specs/L1/L1-REQ-CONV-001-session-lifecycle.md | Starting a new chat creates a new session. |
| related-to | L2-DES-APP-003 | 1 | specs/L2/app/L2-DES-APP-003-client-server-protocol.md | Defines session creation behavior. |
| related-to | L2-DES-TUI-003 | 1 | specs/L2/tui/L2-DES-TUI-003-composer-and-input-modes.md | Uses shared slash-command discovery and invocation behavior. |
| specified-by | TBD | TBD | specs/L3/tui/TBD.md | L3 behavior has not been authored yet. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-23 | Assistant | Initial | Initial `/new` command design. |
