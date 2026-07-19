# InfiniteCode — Project Structure

> **Read this before doing any structural work, advertising work, refactor, or "where does X live" question.**

InfiniteCode ships **five user-facing surfaces** plus an agent backend. They are NOT
all under one directory — half live in `infinitecode/crates/` (Rust) and the other
half live in `infinitecode/apps/` (Bun/Electron/Web). When you grep the repo,
search **both** locations, not just one.

If you only grep `infinitecode/apps/` you will miss half the product. Past incidents
where the CLI was mistakenly reported as missing have happened for exactly this
reason. **Always read the surface table below before claiming a surface doesn't
exist.**

> **Maintenance note for the next maintainer:** this file's crate list was generated
> from a single `ls infinitecode/crates/` snapshot. Verify it against
> `infinitecode/Cargo.toml` `members = [...]` before editing — that file is the
> source of truth for what counts as a first-class crate.

---

## At-a-glance: what every surface is and where it lives

| Surface                  | Path                              | Stack                        | Bin / entry-point                  | Who uses it                          |
| ---                      | ---                               | ---                          | ---                                | ---                                  |
| **CLI** (terminal)       | `infinitecode/crates/cli/`        | Rust                         | `infinitecode` binary             | Terminal users, CI, SSH, server-side |
| **TUI** (terminal UI)    | `infinitecode/crates/tui/`        | Rust (ratatui)               | lib, used by `infinitecode`       | CLI users (above)                    |
| **Desktop** (Electron)   | `infinitecode/apps/desktop/`      | Electron + Bun + React       | `infinitecode` macOS app          | Interactive desktop users            |
| **Docs site**            | `infinitecode/apps/docs/`         | Static site                  | n/a                                | Readers, contributors                |
| **Public website**       | `infinitecode/apps/website/`      | Static site                  | n/a                                | Marketing                            |
| **Agent backend**        | `infinitecode/crates/core/`, `server/`, `tools/`, `provider/`, `protocol/`, `skills/` | Rust                         | Embedded in CLI binary + spanshots to Electron main process | Powers CLI + Desktop |

> The CLI (`infinitecode/crates/cli/`) and Desktop (`infinitecode/apps/desktop/`)
> deliberately **share the same `infinitecode` binary name and the same agent
> backend**. They are the same product, two surfaces. Don't treat them as separate
> products when changing shared behavior.

---

## CLI surface — explicit details

- **Source**: `infinitecode/crates/cli/` (Rust workspace, `[[bin]] name = "infinitecode"` → `src/main.rs`)
- **Compiled binary**: `infinitecode` (published via `install.sh` / `install.ps1` for non-Electron users)
- **TUI primitives**: `infinitecode/crates/tui/` (`AGENTS.md` per-crate reading order)
- **Embedding**: Same Rust binary can run as either a TUI/REPL (`infinitecode onboard`, `infinitecode resume <id>`) OR as an embedded agent backend (`infinitecode server --transport stdio` — invoked by the Electron Desktop's `acp-manager` over stdio).
- **Subcommands** (top-level): `onboard`, `resume`, `server`, `help`, `version`. See `infinitecode/crates/cli/src/main.rs` for the authoritative command list.
- **Why this matters**: When you add a feature (e.g. Gravity ads, telemetry, an auth flow) you usually have to update **both** surfaces or one of them will silently lack the feature. Past bug: the first Gravity ad integration landed only in `infinitecode/apps/desktop/`, missing the CLI entirely. Don't repeat.

### Quick check before claiming "the CLI doesn't have X":
1. Grep `infinitecode/crates/cli/src/` — the entry point.
2. Grep `infinitecode/crates/tui/src/` — terminal UI primitives.
3. Grep `infinitecode/crates/core/src/` and `state.rs` / `protocol/` — shared agent backend state that both CLI and Desktop reach into.

---

## Desktop (Electron) surface

- **Source**: `infinitecode/apps/desktop/`
- **Stack**: Electron + Bun + React + Vite. Multiple process boundaries:
  - Main process: `infinitecode/apps/desktop/src/main/`
  - Preload: `infinitecode/apps/desktop/src/preload/`
  - Renderer (React UI): `infinitecode/apps/desktop/src/renderer/`
- **Compound display name**: `InfiniteCode` (per `apps/desktop/package.json` `productName`).
- **Gravity ads integration** (current, as of 2026-07-17): all 9 placements are wired only into the Desktop renderer (see `infinitecode/apps/desktop/src/renderer/components/chat/gravity-ad.tsx`). The CLI binary has no equivalent surface yet.
- **AGENTS-only convention**: `infinitecode/apps/desktop/AGENTS.md` covers Electron + React coding rules for this surface.

---

## Rust crates (20 total) — quick map

All crates are prefixed `infinitecode-` and live under `infinitecode/crates/`.

| Crate dir                     | Crate name                     | Role                                              |
| ---                           | ---                            | ---                                               |
| `arg0/`                       | `infinitecode-arg0`            | Process-identity helper (Unix argv[0] trickery)   |
| `cli/`                        | `infinitecode-cli`             | CLI entry point — assembles all crates            |
| `client/`                     | `infinitecode-client`          | HTTP/WS client for OpenCode-compatible server     |
| `code-search/`                | `infinitecode-code-search`     | Semantic code search library                      |
| `config/`                     | `infinitecode-config`          | User config (paths, providers, models, auth)      |
| `core/`                       | `infinitecode-core`            | Agent loop + state machine + LLM orchestration    |
| `file-search/`                | `infinitecode-file-search`     | Ripgrep-backed full-text file search              |
| `keyring-store/`              | `infinitecode-keyring-store`   | OS-keyring credential storage                     |
| `mcp/`                        | `infinitecode-mcp`             | Model Context Protocol server                     |
| `network-proxy/`              | `infinitecode-network-proxy`   | TLS interception + provider network mediation     |
| `protocol/`                   | `infinitecode-protocol`        | JSON-RPC types, ACP, wire format                  |
| `provider/`                   | `infinitecode-provider`        | LLM provider adapters                             |
| `rmcp-client/`                | `infinitecode-rmcp-client`     | Rust MCP client (rmcp)                            |
| `safety/`                     | `infinitecode-safety`          | Tool permission auto-accept policy + safety rails |
| `server/`                     | `infinitecode-server`          | The OpenCode-compatible HTTP/WS server backend    |
| `skills/`                     | `infinitecode-skills`          | Skills catalog (install / discover / invoke)      |
| `tasks/`                      | `infinitecode-tasks`           | Scheduled + on-demand task scheduler              |
| `tools/`                      | `infinitecode-tools`           | Built-in tools (bash, edit, read, write, etc.)    |
| `tui/`                        | `infinitecode-tui`             | Terminal UI library (ratatui) — used by CLI       |
| `utils/`                      | `infinitecode-util-*`          | Small utilities                                   |

When you change a crate's public API, update the consuming crate's `AGENTS.md`
first, then the implementations.

---

## Other top-level paths

- `install.sh` / `install.ps1` — install the `infinitecode` Rust binary standalone for users who don't want Electron.
- `docs/` (under `infinitecode/docs/` and the root `docs/`) — narrative docs.
- `specs/` — design specs authored by the product team. `infinitecode/specs/AGENTS.md` covers the structure.
- `.cargo/`, `.github/`, `.vscode/`, `.opencode/`, `.vercel/` — tooling + CI + IDE config.
- `Cargo.toml` (root) — workspace manifest for all `infinitecode-*` crates.

---

## How to add a new feature — top-of-funnel checklist

1. **Identify the surface(s)** the feature touches using the table above.
2. **Read each surface's `AGENTS.md`** for coding conventions:
   - Rust surfaces → `infinitecode/AGENTS.md`
   - Per-crate Rust → `infinitecode/crates/<crate>/AGENTS.md` (e.g. `tui/AGENTS.md`)
   - Desktop (Electron) → `infinitecode/apps/desktop/AGENTS.md`
3. **Cross-surface changes are usually wider than they look.** If the feature
   speaks to the agent loop (e.g. new tool, new provider), expect edits in
   `core/` + `server/` + `tools/` + the CLI binary + Desktop renderer.
4. **Naming**: don't introduce a sixth "app directory" — extend the existing
   surfaces. New CLI commands go in `infinitecode/crates/cli/src/main.rs`,
   not in a new crate.
5. **Tests**: every Rust crate has a `tests/` directory or colocated
   `#[cfg(test)]` blocks; follow the convention of the closest neighboring file.

---

## See also

- `AGENTS.md` (top-level) — entry point for AI agents.
- `CONTRIBUTING.md` — contribution guide.
- `infinitecode/AGENTS.md` — Rust coding standards.
- `infinitecode/specs/AGENTS.md` — specs subsystem convention.
- `infinitecode/apps/desktop/AGENTS.md` — Desktop/Electron/React conventions.

---

_Maintained by the maintainers. If you add a surface, update this file first._
