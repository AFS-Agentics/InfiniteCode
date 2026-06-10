---
artifact_id: L1-REQ-TOOL-002
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Human
last_updated: 2026-05-21
---

# L1-REQ-TOOL-002 — Built-In Tools

## Purpose

Define the baseline tool capabilities users expect from the program.

## Why This Matters

Tools are how the program inspects projects, changes files, runs commands, searches, asks users, and interacts with external content. A clear baseline tells users what work the program can perform.

## Background / Context

Coding-agent workflows require file operations, command execution, search, web access, planning, approval, Plan Mode clarification questions, and delegated work.

## User / Business Requirement

The program must provide a baseline set of built-in tools for coding-agent workflows.

## Real User Scenarios

- A user asks the program to inspect a bug, and it reads files, searches references, edits code, and runs tests.
- A user asks the program to interact with a long-running process and expects stdout, stderr, and stdin interaction to be handled visibly.

## Functional Requirements

- The program must support reading, writing, and editing files.
- The program must support command execution, background process execution, and process stdin interaction.
- The program must expose current background processes started by command execution tools and provide a manual stop path for those processes.
- The program must support file-name search and content search.
- The program must support planning, approval requests, Plan Mode clarification questions, web fetch, web search, and subagent coordination where enabled.
- The question tool must be reserved for Plan Mode and must not be invoked during Normal Mode.
- The program should support explicit parallel tool orchestration through `multi_tool_use` where enabled.
- Tools that require user or environment configuration must expose clear configuration behavior. If such a tool is enabled but unavailable or misconfigured, it must expose clear unavailable-state behavior.

## Non-Functional Requirements

- Tool use must be visible, auditable, and subject to safety policy.
- Tool outputs must be bounded and understandable.

## Acceptance Criteria

- Given a request to inspect project files, when the program uses built-in tools, then it can search and read relevant files.
- Given a request requiring user approval, when a tool exceeds permission boundaries, then the approval workflow is used before execution.
- Given a background command is launched, when it remains running, then the program exposes process state and output access.
- Given a background command remains running, when the user views current background processes, then the user can identify and manually stop that process.
- Given a tool is unavailable or disabled, when the model requests it, then the program reports the capability gap instead of fabricating a result.
- Given Normal Mode is active, when the model requests the question tool, then the program blocks or rejects that request.
- Given Plan Mode is active, when the agent needs clarification, then the question tool is available where enabled.
- Given a configured tool such as web search is enabled, when the program uses that tool, then the effective configuration path is respected.
- Given explicit parallel tool orchestration is enabled, when `multi_tool_use` is invoked, then the listed tool calls are treated as an explicit parallel group.

## Out of Scope

- The program does not define exact tool names, schemas, backend implementation, or provider tool-call mappings in this L1 requirement.
- This requirement does not require every possible external capability to be built in.

## Open Questions

- Which built-in tools are mandatory for the first usable milestone?
- Which built-in tools require explicit configuration before first use?

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| related-to | L1-REQ-TOOL-005 | 1 | specs/L1/L1-REQ-TOOL-005-background-process-management.md | Background process management refines user-visible control over command execution processes. |
| related-to | L1-REQ-AGENT-005 | 1 | specs/L1/L1-REQ-AGENT-005-plan-mode.md | Plan Mode restricts question-tool availability to planning-only clarification. |
| refined-by | L2-DES-TOOL-001 | 1 | specs/L2/tool/L2-DES-TOOL-001-built-in-tool-system.md | Defines built-in tool categories, lifecycle, registry behavior, mode gating, and the plan tool. |
| related-to | L2-DES-AGENT-001 | 1 | specs/L2/agent/L2-DES-AGENT-001-execution-engine.md | The execution engine dispatches model-requested tools. |
| related-to | L2-DES-AGENT-002 | 1 | specs/L2/agent/L2-DES-AGENT-002-interrupt-resume-control.md | Interrupt and resume control active tool and background process work. |
| related-to | L2-DES-APP-003 | 1 | specs/L2/app/L2-DES-APP-003-client-server-protocol.md | Protocol events expose tool calls, plan updates, and background process state. |
| related-to | L2-DES-CONV-001 | 1 | specs/L2/conv/L2-DES-CONV-001-session-jsonl-data-model.md | Durable records preserve tool calls, tool results, and plan state. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-20 | Assistant | Initial | Initial draft with approved L1 refinement. |
| 1 | 2026-05-21 | Human | Refinement | Added configurable-tool behavior for web search and other configured tools. |
| 1 | 2026-05-21 | Human | Refinement | Added explicit `multi_tool_use` parallel orchestration capability. |
| 1 | 2026-05-21 | Human | Refinement | Added current background process visibility and manual stop requirements. |
| 1 | 2026-05-21 | Human | Refinement | Reserved the question tool for Plan Mode and blocked it in Normal Mode. |
| 1 | 2026-05-22 | Human | Traceability | Linked built-in tools to the L2 tool system design. |
