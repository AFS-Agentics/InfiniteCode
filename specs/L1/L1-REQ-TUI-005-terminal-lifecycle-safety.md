---
artifact_id: L1-REQ-TUI-005
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Human
last_updated: 2026-05-23
---

# L1-REQ-TUI-005 — Terminal Lifecycle Safety

## Purpose

Ensure that using and exiting the TUI does not leave the user's terminal in a broken or confusing state.

## Background / Context

The TUI may run inline or in an alternate-screen style. It may change terminal modes, render live regions, receive interrupts, and exit while work is active or recently completed. Users rely on the terminal scrollback and shell prompt after the TUI exits.

## User / Business Requirement

The TUI must enter, run, interrupt, and exit without corrupting terminal state or losing useful user-visible context.

## Functional Requirements

- The TUI must support safe startup from a normal terminal session.
- The TUI must restore terminal modes when it exits.
- The TUI must handle normal exit and interrupt-triggered exit consistently.
- Inline mode must preserve useful terminal scrollback where possible.
- The TUI must avoid leaving stale live-rendered regions that confuse the next shell prompt.
- If the TUI cannot restore or clean up terminal state completely, it must make the failure understandable to the user where possible.

## Non-Functional Requirements

- Terminal lifecycle behavior must be reliable across supported terminal environments.
- Exit behavior must prioritize terminal usability over decorative rendering.
- Safe cleanup must not depend on fragile shell prompt positioning assumptions.

## Acceptance Criteria

- Given the TUI exits normally, when control returns to the shell, then the terminal accepts input normally.
- Given the user interrupts the TUI, when cleanup completes, then terminal modes are restored.
- Given inline mode has displayed transcript content, when the TUI exits, then useful scrollback above the live region remains available where the terminal supports it.
- Given active live content exists at exit time, when the shell prompt returns, then stale TUI rendering does not obscure the prompt.

## Out of Scope

- This requirement does not define terminal escape sequences, prompt-row math, crossterm behavior, or alternate-screen implementation.
- This requirement does not guarantee identical behavior in unsupported terminal emulators.

## Open Questions

- Which terminal environments are included in the required support matrix?

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| refined-by | L2-DES-TUI-005 | 1 | specs/L2/tui/L2-DES-TUI-005-terminal-lifecycle-safety.md | Defines startup, inline mode, alternate-screen mode, interrupt handling, cleanup, terminal restore, stale-region prevention, and shell prompt handoff. |
| related-to | L2-DES-TUI-002 | 1 | specs/L2/tui/L2-DES-TUI-002-modern-tui-shell-layout.md | Defines the live TUI region that lifecycle cleanup must manage. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-21 | Assistant | Initial | Initial draft approved for L1 expansion. |
