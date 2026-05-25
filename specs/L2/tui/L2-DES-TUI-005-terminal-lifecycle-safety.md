---
artifact_id: L2-DES-TUI-005
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Assistant
last_updated: 2026-05-23
---

# L2-DES-TUI-005 — Terminal Lifecycle Safety

## Purpose

Refine terminal lifecycle safety into a design for TUI startup, inline mode, alternate-screen mode, interrupt handling, cleanup, and shell prompt handoff.

## Background / Context

The TUI runs inside a user's terminal. It may change terminal modes, render live regions, handle interrupts, and exit while work is active. Users rely on the terminal after exit, so cleanup correctness is more important than preserving decorative UI state.

## Source Requirements

- `L1-REQ-TUI-005` requires safe startup, terminal mode restoration, consistent normal and interrupt exit, useful inline scrollback preservation, stale live-region cleanup, and understandable cleanup failures.
- `L1-REQ-APP-007` requires inline mode and alternate full-screen mode where appropriate.
- `L1-REQ-TUI-007` requires stable layout across resize events.
- `L2-DES-TUI-002` defines the TUI shell used by inline and alternate-screen modes.

## Design Requirement

The TUI should treat terminal lifecycle as an explicit state machine.

Conceptual states:

- `not_started`
- `starting`
- `running_inline`
- `running_alternate_screen`
- `stopping`
- `restored`
- `restore_failed`

The TUI should enter terminal modes deliberately, restore them exactly once where possible, and avoid relying on fragile assumptions about shell prompt position.

## Inline Mode Model

Inline mode renders a live TUI region inside the existing terminal scrollback.

```text
Before start:

$ program
previous shell output remains above

During inline TUI:

previous shell output remains above
┌──────────────── live TUI region ────────────────┐
│ header                                           │
│ transcript                                       │
│ composer                                         │
└──────────────── bottom status ──────────────────┘

After exit:

previous shell output remains above
$ _
```

Rules:

- Inline mode should preserve useful scrollback above the live region.
- The live region may be cleared or compacted on exit so stale TUI rows do not confuse the next shell prompt.
- The shell owns the next prompt after the program exits.
- Cleanup must not depend on predicting where the shell prompt will be printed.

## Alternate-Screen Mode Model

Alternate-screen mode may use the terminal's alternate screen when configured or appropriate.

Rules:

- Entering alternate-screen mode must save the previous terminal screen according to terminal capability.
- Exiting alternate-screen mode must restore the normal screen and terminal modes.
- The same logical shell layout should be used inside alternate-screen mode.
- If alternate-screen entry fails, the TUI should fall back to inline mode or fail with an understandable message.

## Startup Rules

Startup should:

- Detect terminal capability where practical.
- Record which terminal modes were changed.
- Enter raw mode, bracketed paste, alternate screen, mouse mode, or keyboard enhancement modes only when required by supported behavior.
- Initialize the shell layout after terminal mode changes succeed.
- Preserve a cleanup guard that can restore terminal modes on normal exit or interrupt.

If startup fails after partially changing terminal modes, cleanup should attempt to restore any changed modes before reporting failure.

## Exit Rules

Normal exit and interrupt-triggered exit should share the same cleanup path.

Cleanup should:

1. Stop accepting new composer input.
2. Resolve or detach active client subscriptions according to server policy.
3. Stop live rendering.
4. Clear or compact the live TUI region where inline mode requires it.
5. Restore terminal modes changed by the TUI.
6. Leave shell prompt placement to the shell.
7. Report cleanup failure only after best-effort restore.

Cleanup should prioritize terminal usability over preserving the final decorative TUI frame.

## Interrupt Handling

Interrupt handling must distinguish TUI process exit from agent turn interruption.

Rules:

- A user interrupt intended to stop the current turn should be routed through the server interrupt protocol when the TUI remains open.
- A user interrupt intended to exit the TUI should trigger terminal cleanup.
- If the TUI exits while server work continues, the TUI should make the lifecycle policy clear where possible before exit.
- If cleanup occurs during active streaming, partial live output already persisted by the server remains recoverable through session replay.

## Stale Region Prevention

The TUI should avoid leaving stale live-rendered rows below or around the next shell prompt.

Rules:

- Inline cleanup should clear the owned live region when possible.
- Cleanup should avoid writing extra prompt-like text after terminal restore.
- Cleanup should avoid double-restoring terminal modes.
- Cleanup should not rely on exact shell prompt row prediction.
- If the terminal cannot clear the live region reliably, the TUI should prefer a concise final status line over a partially stale UI.

## Resize Handling

Resize handling should be safe in both inline and alternate-screen modes.

Rules:

- Resize events should trigger full layout recomputation.
- The TUI should not preserve stale absolute row assumptions after resize.
- If a resize makes the terminal too small, the TUI should show a minimum-size message or simplified frame.
- Exiting after resize should still restore terminal modes and avoid prompt corruption.

## Cleanup Failure Display

If cleanup cannot fully restore terminal state, the program should provide a concise, terminal-safe message after best-effort restore.

Example:

```text
program: terminal cleanup may be incomplete; run `reset` if input looks wrong.
```

The message should be emitted only when useful and should not expose internal debug details by default.

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| refines | L1-REQ-TUI-005 | 1 | specs/L1/L1-REQ-TUI-005-terminal-lifecycle-safety.md | Defines terminal lifecycle states, startup, cleanup, inline scrollback preservation, alternate-screen behavior, and interrupt-safe exit. |
| related-to | L1-REQ-APP-007 | 1 | specs/L1/L1-REQ-APP-007-tui.md | Inline and alternate-screen modes are high-level TUI requirements. |
| related-to | L1-REQ-TUI-007 | 1 | specs/L1/L1-REQ-TUI-007-responsive-layout-readability.md | Resize handling must preserve layout and safe exit behavior. |
| related-to | L2-DES-TUI-002 | 1 | specs/L2/tui/L2-DES-TUI-002-modern-tui-shell-layout.md | Defines the shell layout whose live region must be cleaned up safely. |
| specified-by | TBD | TBD | specs/L3/tui/TBD.md | L3 behavior has not been authored yet. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-23 | Assistant | Initial | Initial terminal lifecycle safety design. |
