---
artifact_id: L2-DES-TUI-CMD-004
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Assistant
last_updated: 2026-05-23
---

# L2-DES-TUI-CMD-004 — Slash Command: /resume

## Purpose

Define the TUI behavior for `/resume`, which lets the user reopen a saved chat session.

## Command Contract

- Command: `/resume`
- Description: `resume a saved chat`
- Parameters: none in the first milestone.
- Mutability: current client session selection.
- Active-turn availability: requires explicit confirmation if the current session has active work.

## UI Flow

`/resume` opens a searchable saved-session popup.

```text
┃ /resume

  Resume session
  ~/Desktop/devo   deepseek-v4-pro   10m ago
  ~/work/api       gpt-5.5           yesterday
```

Rules:

- Sessions should show enough metadata to choose safely: workspace, title or first message preview, model, and last activity time.
- Enter opens the selected session through the server.
- Esc cancels without changing the current session.
- If the current session has active work, the TUI must offer a clear choice: stay, interrupt, detach, or cancel where supported by server policy.

## State And Error Behavior

- The TUI should use `session.list` and `session.open`.
- Resuming a session must replay or load durable state from the server rather than reconstructing locally.
- The command must not delete or mutate the previously active session.
- If replay fails, the TUI should show a recoverable error and keep the current session selected.

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| refines | L1-REQ-TUI-006 | 1 | specs/L1/L1-REQ-TUI-006-command-discovery-control.md | Defines command-specific behavior for a discoverable TUI command. |
| related-to | L1-REQ-CONV-001 | 1 | specs/L1/L1-REQ-CONV-001-session-lifecycle.md | Resuming saved sessions is a session lifecycle workflow. |
| related-to | L2-DES-APP-003 | 1 | specs/L2/app/L2-DES-APP-003-client-server-protocol.md | Defines session listing, opening, and subscription behavior. |
| related-to | L2-DES-TUI-003 | 1 | specs/L2/tui/L2-DES-TUI-003-composer-and-input-modes.md | Uses shared slash-command discovery and invocation behavior. |
| specified-by | TBD | TBD | specs/L3/tui/TBD.md | L3 behavior has not been authored yet. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-23 | Assistant | Initial | Initial `/resume` command design. |
