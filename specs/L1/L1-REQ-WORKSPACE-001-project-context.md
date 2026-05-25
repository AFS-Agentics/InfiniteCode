---
artifact_id: L1-REQ-WORKSPACE-001
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Human
last_updated: 2026-05-21
---

# L1-REQ-WORKSPACE-001 — Project Context

## Purpose

Ensure the program acts in the intended project and respects existing work.

## Why This Matters

Most coding mistakes become expensive when the program works in the wrong directory, ignores local instructions, or overwrites user changes. Workspace awareness is the foundation for safe project work.

## Background / Context

Coding tasks depend on current workspace, repository status, local instructions, ignored paths, generated outputs, and user-created changes. Local instructions may be stored in recognized project instruction files discovered along the directory hierarchy from the project root to the current working directory.

## User / Business Requirement

The program must maintain and respect project context while performing coding work.

## Real User Scenarios

- A user runs the program in a repository with dirty files and expects unrelated changes to be preserved.
- A workspace contains local instructions, and the user expects the program to follow them during edits and verification.

## Functional Requirements

- The program must identify the current workspace or working directory.
- The program must consider local project instructions where present.
- The program must automatically discover and read recognized project instruction files where present and accessible.
- The program must inspect repository state before risky file or git operations.
- The program must distinguish relevant task changes from unrelated existing changes where possible.

## Non-Functional Requirements

- The program must avoid searching obvious generated or build-artifact paths during normal project search.
- Workspace boundary changes must be visible to the user.

## Acceptance Criteria

- Given a dirty repository, when the program edits files, then it does not claim unrelated pre-existing changes as its own.
- Given a task that requires access outside the workspace, when the program proceeds, then the user is informed of the boundary and reason.
- Given generated or build-output directories exist, when the program searches the project, then it avoids those paths unless they are relevant to the task.
- Given local project instructions exist, when the program begins work, then those instructions are considered as part of the workspace context.
- Given recognized project instruction files exist, when the program begins workspace-dependent work, then those files are discovered and read where accessible.

## Out of Scope

- The program does not define project-type detection, indexing implementation, or VCS abstraction in this L1 requirement.
- This requirement does not allow the program to ignore user-owned dirty changes for convenience.

## Open Questions

- Should one session support multiple workspaces?

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| refined-by | TBD | TBD | specs/L2/workspace/TBD.md | L2 design has not been authored yet. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-20 | Assistant | Initial | Initial draft with approved L1 refinement. |
| 1 | 2026-05-21 | Human | Refinement | Added automatic discovery and reading of recognized project instruction files. |
| 1 | 2026-05-22 | Human | Refinement | Removed hardcoded instruction-file list; discovery order is now defined by the project instruction file requirement. |
