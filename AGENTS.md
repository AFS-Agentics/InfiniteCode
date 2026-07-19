# AGENTS.md — Top-level entry point for AI agents and tooling

> **If you're an AI assistant about to do structural work, refactor, or answer a
> "where does X live" question in this repo, read
> [`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md) first.** That file lists every
> surface (CLI, Desktop, TUI, Docs, Website) and where each one lives. Past
> incidents have happened where an AI assumed the project had only Electron
> surfaces because the AI only grepped `infinitecode/apps/`. Don't repeat that.
>
> Specifically: this project has a Rust **CLI** surface that lives at
> `infinitecode/crates/cli/` (NOT under `infinitecode/apps/`). It compiles to a
> standalone `infinitecode` binary, ships via `install.sh` / `install.ps1`, and
> is used by terminal / CI / SSH users without Electron. It is a first-class
> surface, not an internal implementation detail.

---

## Quick orientation

This repo contains **two coupled workspaces**:

1. **Rust workspace** (`infinitecode/crates/*`, `infinitecode/Cargo.toml`) — 19
   `infinitecode-*` crates that build into the `infinitecode` binary. The CLI,
   TUI, and shared agent backend all live here.
2. **Bun workspace** (`infinitecode/apps/*`, root `package.json`) — Electron
   desktop, docs site, public website. The Desktop surface lives here.

For the full surface table and how to add a new feature, see
[`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md).

## Per-surface convention docs (read these before editing)

| Surface                                  | Read this first                                      |
| ---                                      | ---                                                  |
| Rust in general (clippy, formatting)     | `infinitecode/AGENTS.md`                             |
| Rust TUI (terminal UI)                   | `infinitecode/crates/tui/AGENTS.md`                  |
| Rust server backend                      | `infinitecode/crates/server/AGENTS.md`               |
| Desktop (Electron + React + Bun)         | `infinitecode/apps/desktop/AGENTS.md`                |
| Specs subsystem                          | `infinitecode/specs/AGENTS.md`                       |
| **Anything structural across surfaces**  | [`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md)     |

## Working rules

- **Don't confine yourself to `infinitecode/apps/`.** If the user's question is
  about CLI features, terminal output, or the `infinitecode` binary, look at
  `infinitecode/crates/cli/src/` and `infinitecode/crates/tui/src/` first.
- **Don't claim a feature is missing without grepping all surfaces.** Run
  text searches across **both** `infinitecode/crates/` and `infinitecode/apps/`
  before asserting "the CLI doesn't have X" or "Electron doesn't have Y".
- **The Rust binary is the source of truth for terminal behavior.** The
  Desktop UI is a Bun/Electron client on top of it. Don't reverse that
  relationship.
- **Follow `infinitecode/AGENTS.md` Rust coding standards.** Every shipment
  there is enforceable in code review (`just fix`, `cargo test`).
- **AI agents may not apply patches to files > 800 lines.** See
  `infinitecode/AGENTS.md` for the Windows-line-length workaround.
- **For step-by-step feature-development procedure** (cross-surface checklist,
  crate map, "How to add a new feature"), see
  [`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md) — don't duplicate the
  procedure here.

## Output style for agent responses

When asked "does the CLI have X?" your first action must be a structured search
across both `infinitecode/crates/` and `infinitecode/apps/`. If the answer is
"no, only the Desktop has it" that is a known limitation, not a project
structure surprise — surface it explicitly with the file paths showing where it
exists.

---

_See [`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md) for the full inventory,
the CLI's path and command list, and the cross-surface change checklist._
