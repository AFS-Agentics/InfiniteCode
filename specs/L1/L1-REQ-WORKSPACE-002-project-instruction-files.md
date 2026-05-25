---
artifact_id: L1-REQ-WORKSPACE-002
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Human
last_updated: 2026-05-22
---

# L1-REQ-WORKSPACE-002 — Project Instruction Files

## Purpose

Ensure that the program automatically discovers and reads project instruction files along the directory hierarchy from the project root to the current working directory, without imposing arbitrary depth limits.

## Background / Context

Many coding projects include repository-local instruction files for agents or coding assistants. These files may describe coding style, safety expectations, verification commands, project structure, or workflow constraints. Users should not have to manually paste these instructions into every session.

A project may organize its codebase into nested directories, each with its own local conventions. An instruction file in a parent directory should apply to work in child directories, while an instruction file closer to the current working directory should carry more specific, localized rules.

The program should discover instruction files along the entire linear path from the project root to the current working directory. There is no artificial depth cap — if the current working directory is thirty levels deep, all thirty directories on the path should be checked.

## User / Business Requirement

The program must automatically discover, read, and apply recognized project instruction files across the entire directory hierarchy from the project root down to the current working directory.

## Functional Requirements

### Discovery

- The program must locate a project root by walking upward from the current working directory and stopping at the first ancestor that contains a recognized project-root marker. The default marker is a `.git` directory. The marker set should be configurable.
- Once the project root is found, the program must collect all directories on the linear path from the project root down to the current working directory, inclusive of both endpoints.
- For each directory on that path, the program must look for recognized instruction files.
- If the current working directory is not inside any project root (no marker found on any ancestor), the program must still check the current working directory itself for instruction files.
- The program must also check a user-level global directory (e.g., `~/.devo/`) for instruction files that apply across all projects.

### Filename Priority Per Directory

- In each directory, the program must check for instruction files in a fixed priority order:
  1. `AGENTS.override.md`
  2. `AGENTS.md`
  3. Additional configurable fallback filenames provided by the user.
- Only the highest-priority file found in a given directory is used. If `AGENTS.override.md` exists, `AGENTS.md` and fallback filenames are not checked for that directory.
- Configurable fallback filenames allow projects that already maintain instruction files for other assistants (e.g., `CLAUDE.md`, `PROMPT.md`) to work without duplication or migration.
- Fallback filenames are user-configured, not hardcoded. The program should provide a sensible default set.

### Assembly And Ordering

- Discovered instruction files must be assembled in order from the project root down to the current working directory: root-first, cwd-last.
- Global instruction files should appear before project-root instructions.
- Files discovered closer to the current working directory carry more localized rules and come later in the assembled context, nearer to the model's response generation.
- The total assembled content must be bounded to a configurable maximum size. Truncation must be indicated clearly rather than hidden.
- Instruction files that are empty or contain only whitespace should be treated as absent — they do not contribute to the assembled instructions and do not prevent lower-priority files from being discovered in the same directory.

### Content Semantics

- The assembled project instructions must be included in the instruction hierarchy used during model-context assembly.
- Project instruction files must never silently overwrite higher-priority instructions such as system-level safety constraints or explicit user-provided instructions in the current conversation.
- Project instruction files are instructions, not conversation turns. They belong to the instruction hierarchy, not the transcript.

### Error And Unavailability Handling

- If an instruction file cannot be read because it is missing, the program must treat this as normal — the file simply does not apply to that directory.
- If an instruction file cannot be read because it is inaccessible, too large, binary, or blocked by permissions, the program must produce a diagnostic that explains which file was affected and why, without exposing file contents that should remain private.
- If the total assembled instruction content exceeds the configured maximum size, the program must truncate and indicate truncation rather than silently dropping content.
- A single unreadable file on the path must not prevent discovery and reading of other instruction files.

### Discovery Boundary

- The program must not walk upward past the project root.
- The program must not walk into sibling directories, parent directories of the project root, or arbitrary filesystem locations outside the linear project-root-to-cwd path.
- If the project root cannot be determined (no marker found and no explicit root configured), the discovery scope is the current working directory only, plus the global user-level directory.

### Refresh

- When the current working directory changes during a session, the program must re-discover instruction files along the new path.
- When an instruction file on the active path is modified during a session, the program should detect the change and refresh the assembled instructions subject to reasonable detection latency.

## Non-Functional Requirements

- Instruction-file discovery must be predictable and auditable. The user must be able to understand which files were discovered, from which directories, and in what order.
- Discovery must not scan irrelevant directory trees, generated output directories, or large build-artifact paths.
- Large instruction files must not cause unbounded context growth.
- The discovery mechanism must be fast enough that it does not introduce noticeable latency during session startup or directory changes.

## Acceptance Criteria

- Given a workspace with a project root at level 0 and the current working directory at level 5, when the program assembles instructions, then instruction files from all six directories on the path are discovered in root-to-cwd order.
- Given a project root directory contains `AGENTS.md` and a child directory contains `AGENTS.override.md`, when the program assembles instructions, then the root contributes the `AGENTS.md` content and the child contributes the `AGENTS.override.md` content (the override replaces the default in that directory only, not the root).
- Given a directory contains both `AGENTS.override.md` and `AGENTS.md`, when the program checks that directory, then only `AGENTS.override.md` is used.
- Given a project has no `.git` directory or other project-root markers, when the program starts in a subdirectory, then only the current working directory and the global user-level directory are checked for instruction files.
- Given a configurable fallback filename is set to `CLAUDE.md`, when a directory contains `CLAUDE.md` but not `AGENTS.md` or `AGENTS.override.md`, then the `CLAUDE.md` content is used for that directory.
- Given a directory contains both `AGENTS.md` and `CLAUDE.md`, when the program checks that directory, then `AGENTS.md` is used and `CLAUDE.md` is not checked because a higher-priority file was found.
- Given an instruction file cannot be read due to a permission error, when the program assembles instructions, then a diagnostic is produced and discovery continues for remaining directories.
- Given the total assembled instruction content exceeds the configured maximum size, when the program assembles instructions, then content is truncated and the truncation is indicated.
- Given the user changes the current working directory during a session, when the next model context is assembled, then instruction files along the new path are discovered.
- Given the current working directory is thirty levels deep, when the program discovers instruction files, then all thirty directories on the path are checked without any depth-based cutoff.

## Out of Scope

- This requirement does not define exact file-size limits, truncation format, or serialization schema.
- This requirement does not define the exact mechanism for detecting file changes or refresh latency targets.
- This requirement does not require the program to follow instructions that conflict with higher-priority safety, system, or user instructions.
- This requirement does not require reading instruction files outside the linear project-root-to-cwd path or the configured permission boundary.

## Open Questions

- What should the default set of configurable fallback filenames include (e.g., `CLAUDE.md`, `PROMPT.md`)?
- What is the appropriate default maximum size for assembled instruction content?

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---:|---|---|---|
| refined-by | TBD | TBD | specs/L2/workspace/TBD.md | L2 design has not been authored yet. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-21 | Assistant | Initial | Initial draft from approved user requirement. |
| 1 | 2026-05-22 | Human | Refinement | Replaced the "maximum depth of five levels" concept with linear ancestor-chain discovery. Defined per-directory filename priority (AGENTS.override.md, AGENTS.md, configurable fallbacks), first-match-per-directory behavior, root-to-cwd concatenation order, configurable fallback filenames for cross-assistant compatibility, global instruction file support, size bounding, and no artificial depth limit. |

