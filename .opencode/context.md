# Project Context

## Environment
- Language: Rust (edition 2024)
- Runtime: Rust 1.88.0
- Build: `cargo build --workspace`
- Test: `cargo test --workspace --jobs 1`
- Package Manager: Cargo

## Project: InfiniteCode (v0.1.31)
Open-source Rust coding agent. 25+ crates.

## Mission: Port Freebuff Self-Review → InfiniteCode
Best-of-N editor + multi-prompt reviewer. Different names. Gated (default: off).

## Completed (5/6 Phases)

### Phase 1: Preview Tools ✓
- `preview_edit.rs` (read-only edit diff) + `preview_write.rs` (read-only write diff)
- Registered: handler_kind.rs, mod.rs, registry_plan.rs

### Phase 2: Report Outcome ✓
- `report_outcome.rs` (accepts/submits JSON findings)

### Phase 3: Behavior Flags + CLI ✓
- `AgentBehaviorConfig`: `explore_solutions`, `audit_changes` (both false default)
- CLI: `--explore-solutions`, `--audit`
- Env: `INFINITECODE_EXPLORE_SOLUTIONS`, `INFINITECODE_AUDIT_CHANGES`

### Phase 4 + 5: Prompt Fragments ✓
- `explore-solutions.md` (multi-solution exploration via preview tools)
- `audit-changes.md` (quality/security/performance review)
- Both registered in `agent_behavior_prompts.rs` + wired in `execution_context.rs`

### Test Fixes ✓
- Fixed `session_context_system_prompt_uses_stable_mode_introductions`
- Fixed `query_locks_system_prompt_and_environment_prefix_per_session`
- All 643 lib tests + 45 config tests pass

### Phase 6: Prompt assembly wiring ✓
- Done during Phase 4+5 (fragments assembled in `describe_execution_prompt`)

## Files Changed (9 crates)
- NEW: `preview_edit.rs`, `preview_write.rs`, `report_outcome.rs`
- NEW: `explore-solutions.md`, `audit-changes.md`
- MOD: `handler_kind.rs`, `mod.rs`, `registry_plan.rs`, `app.rs`, `main.rs`
- MOD: `agent_behavior_prompts.rs`, `execution_context.rs`, `query.rs`
