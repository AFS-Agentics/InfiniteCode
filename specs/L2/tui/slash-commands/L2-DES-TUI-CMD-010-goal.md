---
artifact_id: L2-DES-TUI-CMD-010
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Assistant
last_updated: 2026-05-23
---

# L2-DES-TUI-CMD-010 — Slash Command: /goal

## Purpose

Define the TUI behavior for `/goal`, which lets the user create, view, pause, resume, complete, cancel, or clear the session's Ralph Loop goal.

## Command Contract

- Command: `/goal`
- Description: `set or view the goal for a long-running task`
- Parameters: optional free-form objective text in the first milestone.
- Mutability: goal/session state.
- Active-turn availability: viewing is allowed during active work; mutating actions must be server-serialized and must not rewrite an already-running turn.

## UI Flow

Typing `/goal` opens the goal panel.

```text
┃ /goal

  Goal
    status    pursuing
    objective Eliminate the failing parser tests and verify the full parser suite.
    progress  quoted values fixed; escape regression still failing
    budget    ↑12.5k / 50k  25%  ·  4 turns

    [Pause] [Complete] [Cancel] [Clear]

  Build · deepseek-v4-pro high  ↑420[cached 300 71%]  ↓12  ▰▰▱▱▱▱▱▱▱▱  20%  190k/950k
```

When no goal exists, the panel enters create mode.

```text
┃ /goal <objective>

  Goal
    Create a Ralph Loop goal for this session.

    objective
    Eliminate the failing parser tests and verify the full parser suite.

    token budget
    50000

    [Create] [Cancel]
```

Rules:

- `/goal` without parameters opens the current-goal panel or create flow.
- `/goal <text>` may prefill the objective field in create mode.
- If a non-terminal goal already exists, replacing it requires explicit confirmation.
- The panel must show objective, status, progress, blocker, verification, and budget fields where available.
- User-owned actions include pause, resume, complete, cancel, clear, create, and replace.
- The model cannot trigger `/goal`; model-originated goal status changes are shown as server events.
- Successful mutations should close the popup or update it in place according to L3 interaction rules.

## Inline Rendering

When the composer recognizes `/goal`, the command token uses the theme primary color and parameter text uses muted color.

```text
┃ /goal <objective for autonomous work>

  Build · deepseek-v4-pro high  ↑0[cached 0 0%]  ↓0  ▱▱▱▱▱▱▱▱▱▱  0%  0/950k
```

## State And Error Behavior

- The command uses server-owned goal APIs; the TUI does not mutate local goal state independently.
- Read-only viewing should return the current server-confirmed projection.
- Mutating actions should pass `expected_goal_id` where the TUI has one, so stale panels do not overwrite newer goal state.
- If the server rejects a stale action, the TUI should refresh the panel and show a concise message.
- If the goal is active and a turn is running, pause/cancel/clear may take effect immediately for future continuation but must not rewrite the current turn's already-built model context.
- If Plan Mode is active, `/goal` remains viewable and user-controllable, but autonomous continuation remains suppressed until Build mode is active.
- `/goal` must not create a model-visible transcript turn.

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| refines | L1-REQ-TUI-006 | 1 | specs/L1/L1-REQ-TUI-006-command-discovery-control.md | Defines command-specific behavior for a discoverable TUI command. |
| related-to | L1-REQ-GOAL-001 | 1 | specs/L1/L1-REQ-GOAL-001-ralph-loop.md | `/goal` is the TUI control surface for Ralph Loop goals. |
| related-to | L2-DES-GOAL-001 | 1 | specs/L2/goal/L2-DES-GOAL-001-ralph-loop-goals.md | Defines the goal state model, continuation loop, and protocol behavior controlled by this command. |
| related-to | L2-DES-TUI-003 | 1 | specs/L2/tui/L2-DES-TUI-003-composer-and-input-modes.md | Defines slash-command discovery, inline command rendering, and command submission. |
| specified-by | TBD | TBD | specs/L3/tui/TBD.md | L3 behavior has not been authored yet. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-23 | Assistant | Initial | Initial `/goal` command design. |
