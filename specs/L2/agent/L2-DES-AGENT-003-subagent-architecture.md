---
artifact_id: L2-DES-AGENT-003
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Assistant
last_updated: 2026-06-07
---

# L2-DES-AGENT-003 — Subagent Architecture

## Purpose

Define the architecture for spawning, coordinating, and integrating subagents — independent, bounded execution contexts created as child sessions within a parent session, performing delegated work while the parent monitors their output.

## Scope

This document covers:
- Agent tree model and generated hierarchical naming
- Agent roles and their configuration
- Spawn lifecycle (slot reservation, config inheritance, fork modes, initial message delivery)
- Parent-to-child input delivery through child mailboxes
- Child assistant-output buffering and parent polling
- Agent status lifecycle
- Subagent tool surface (spawn, send message, wait, list, close)
- Depth and concurrency limits
- Persistence of spawn-tree edges for session resumption
- Safety, permission, and approval boundaries for subagents
- Orchestration prompt instructions injected into the model context

This document does **not** cover:
- Session forking implementation details (see L2-DES-CONV-001)
- The execution engine that dispatches subagent turns (see L2-DES-AGENT-001)
- Built-in tool registration mechanics (see L2-DES-TOOL-001)

## Design Decisions

### DD-1: Subagents are child sessions within a shared session tree

A subagent is a lightweight child execution context — a child session — that belongs to the same root session as its parent. It inherits the parent's session-level state (workspace, permissions profile, shell environment) while maintaining an independent conversation transcript. This avoids the heavyweight cost of fully separate root sessions while preserving clear boundaries.

**Decision**: Subagents are spawned as child sessions within the parent session tree. Each child session has its own conversation history, config snapshot, and state. The root session agent (`/root`) is the top of the tree.

### DD-2: Generated hierarchical agent paths provide a stable, navigable identity model

Flat UUIDs are hard for both humans and models to reason about. A tree-structured path model (`/root/researcher/worker`) mirrors the spawn hierarchy, making ownership and relationships immediately visible.

**Decision**: Every agent is assigned a canonical `AgentPath` — a slash-separated hierarchical path rooted at `/root`. The parent does not provide the child name. At spawn time, the runtime generates a unique adjective-noun nickname under the parent and joins it to the parent path. Paths remain stable for the agent's lifetime.

### DD-3: Agent roles are configurable composable layers

Different delegated tasks call for different agent configurations — a codebase explorer needs different instructions and model settings than an implementation worker. Hardcoding these differences into the spawn tool would be brittle.

**Decision**: Agent roles are named configuration layers (`default`, `explorer`, `worker`, plus user-defined roles). Each role specifies optional overrides for model, reasoning effort, system instructions, and other config knobs. Roles are applied as a high-precedence config layer layered over the parent's effective config at spawn time, preserving the parent's permission profile and provider unless the role explicitly takes ownership.

### DD-4: Parent-to-child messages are delivered as child user input

Parent agents need to send additional input to child agents without treating the child as a peer chat participant. Child agents do not need to send messages to their parent; the parent observes child output separately.

**Decision**: Each child session has an internal mailbox for parent-to-child text. `send_message` writes to that mailbox and the runtime consumes mailbox entries as normal child user turns. If the child is idle, the message starts a turn immediately. If the child is active, the message is queued for the next child turn. Child-to-parent mailbox routing is not supported.

### DD-5: Parent polling reads a child-output buffer

The parent must be able to monitor child progress and completion without receiving child-authored mailbox messages.

**Decision**: Each parent session has a sequence-numbered output buffer for direct child assistant text and terminal status events. Child assistant deltas are appended as they stream. Child terminal status changes are appended as status events. The `wait_agent` tool polls this buffer with an optional target and sequence cursor.

### DD-6: Subagents inherit permission and safety boundaries, never bypass them

A spawned subagent must not be a mechanism to escape sandboxing, approval policy, or workspace boundaries. The parent's safety posture must propagate to children.

**Decision**: At spawn time, the child inherits the parent's active permission profile, approval policy, shell environment policy, exec policy, and cwd. Role overrides cannot relax these safety constraints. Subagents are subject to the same `authorize_tool_request` flow as the parent (see L2-DES-SAFETY-002).

## Architecture

### Agent Tree Model

The agent tree organizes subagents into a spawn hierarchy rooted at the root session's parent agent.

```
/root                        ← root session agent (the user's conversation partner)
├── /root/researcher         ← subagent researching subsystem A
│   └── /root/researcher/worker  ← sub-subagent for a subtask
└── /root/implementer        ← subagent implementing subsystem B
```

Each agent in the tree is backed by a child session (a `SessionRecord` with `parent_session_id` set). The parent-child relationship is tracked as a spawn edge in the agent graph store.

#### Agent Identifiers

Each agent has three identification dimensions:

| Identifier | Type | Stability | Purpose |
|------------|------|-----------|---------|
| `session_id` | `SessionId` (UUID) | Stable for lifetime | Internal routing, persistence |
| `agent_path` | `AgentPath` | Stable for lifetime | Human/model-facing identity, inter-agent addressing |
| `agent_nickname` | String | Stable for lifetime | Friendly display name (e.g. "Scout", "Atlas") |

#### Agent Metadata

Every tracked agent carries metadata stored in the agent registry:

```
AgentMetadata {
    session_id: Option<SessionId>,
    agent_path: Option<AgentPath>,
    agent_nickname: Option<String>,
    agent_role: Option<String>,
    last_task_message: Option<String>,
}
```

These fields correspond to the existing `SessionRecord` columns: `agent_nickname`, `agent_role`, `agent_path`, and `parent_session_id`.

#### Nickname Pools

Agent nicknames are drawn from a pool of candidate names (e.g. "Scout", "Atlas", "Echo", "Falcon"). The default pool contains a curated list of short, friendly names. Roles may specify their own nickname pools. The registry tracks used nicknames to avoid duplicates. When the pool is exhausted, it resets with a generation suffix (e.g., "Scout the 2nd").

### Agent Roles

An agent role is a named configuration profile applied to a subagent at spawn time. Roles are defined either as built-in definitions shipped with the program, or as user-defined entries in config.

#### Built-in Roles

| Role | Purpose | Overrides |
|------|---------|-----------|
| `default` | General-purpose agent | None (inherits parent config entirely) |
| `explorer` | Fast, read-only codebase investigation | May specify a fast model, low reasoning effort, exploration-focused instructions |
| `worker` | Implementation and production work | May specify instructions emphasizing file ownership and peer awareness |

Additional built-in roles may be added as the system matures (e.g., `awaiter` for long-running command monitoring).

#### User-Defined Roles

Users may define custom roles in config:

```toml
[agent_roles.code-reviewer]
description = "Specialized code reviewer that identifies bugs and risks"
config_file = "~/.config/devo/roles/code-reviewer.toml"
nickname_candidates = ["Eagle", "Hawk"]
```

The `config_file` is a standard config TOML fragment containing the role's overrides (model, instructions, etc.). It is loaded as a high-precedence config layer.

#### Role Application Order

When a subagent is spawned:

1. The parent's effective config is cloned as the base.
2. Runtime fields from the current turn (model selection, reasoning effort, developer instructions, approval policy, cwd, permission profile) are applied.
3. The role config layer, if specified, is applied at session-flag precedence.
4. The parent's `profile` and `model_provider` are preserved unless the role explicitly overrides them.
5. Depth-dependent overrides are applied (e.g., disabling further multi-agent features at max depth).

### Spawn Lifecycle

#### Step 1: Model Invocation

The model calls the `spawn_agent` tool with:
- `message`: The initial task description for the new agent
- `agent_type` (optional): Role name (`"default"`, `"explorer"`, `"worker"`, or user-defined)
- `model` (optional): Override model selection
- `reasoning_effort` (optional): Override reasoning effort
- `fork_turns` (optional): `"none"` (no history) or `"all"` (full history)

#### Step 2: Slot Reservation

The `AgentRegistry` checks concurrent agent limits (`agent_max_sub_agents`). If at capacity, the spawn is rejected with an `AgentLimitReached` error. Otherwise, a `SpawnReservation` is created, reserving a slot.

#### Step 3: Path and Nickname Assignment

The runtime generates a unique adjective-noun nickname under the parent registry and computes the child's `AgentPath` by joining the parent's path with that nickname. If the generated-name pool is exhausted for the parent, spawn is rejected.

#### Step 4: Config Construction

The child session's config is built from the parent's effective config, with runtime turn-state overrides applied. If a role is specified, the role config layer is applied on top. If `fork_turns` is set to `"all"`, the child inherits the parent's model when forking full history.

#### Step 5: Child Session Creation

A new child session is created with:
- `SessionSource::SubAgent { parent_session_id, depth, agent_path, agent_nickname, agent_role }`
- The child's config snapshot
- Inherited shell snapshot and exec policy (from the parent)
- Optionally, forked conversation history (if `fork_turns` is not `"none"`)

The child session's `SessionRecord` stores `parent_session_id`, `agent_path`, `agent_nickname`, and `agent_role` for durable identity.

#### Step 6: Message Delivery

The initial task message is submitted as the child session's first user turn.

#### Step 7: Spawn-Edge Persistence

The parent-child spawn relationship is persisted to the agent graph store as an `Open` spawn edge. This edge tracks:
- `parent_session_id`
- `child_session_id`
- `status`: `Open` (agent is alive or may be resumed) or `Closed` (agent was explicitly closed)

#### Step 8: Output Buffer Initialization

The parent output buffer records child assistant text deltas and terminal status events. The parent polls this buffer with `wait_agent`.

#### Slot Reservation Lifecycle

```
┌──────────────────┐
│  reserve_spawn   │  Increments active count, creates SpawnReservation
│  _slot()         │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  SpawnReservation │  Holds reserved path and nickname
│  (in-flight)      │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  commit()        │  Registers agent metadata in tree, consumes reservation
│  (on success)     │
└──────────────────┘
       │
       │ (or on failure / drop)
       ▼
┌──────────────────┐
│  release_spawned │  Removes agent from tree, decrements count
│  _agent()        │
│  or drop()       │
└──────────────────┘
```

#### Fork Modes

Subagents may inherit conversation history from the parent through fork modes:

| Mode | Behavior |
|------|----------|
| `none` (default) | No history inherited. Child starts with a clean conversation containing only the initial task message. |
| `all` | Full conversation history up to the spawn point is forked. Assistant reasoning items and intermediate tool calls are filtered out; only user/developer/system messages and final assistant answers are retained. |

Forked history is deduplicated via reference-based storage rather than deep-copied (see L2-DES-CONV-001). When forking full history, the child inherits the parent's model context to maintain consistency.

### Inter-Agent Communication

#### Child Input Mailbox

Each child agent session has an internal mailbox for receiving parent-authored input.

```
Mailbox {
    next_sequence: u64,
    pending: VecDeque<AgentMailboxMessage>,
}
```

Key properties:
- Monotonic sequence numbers: each message gets an incrementing sequence number.
- Queue buffering: parent messages are drained into normal child user turns.
- Directionality: only parent-to-child delivery is supported.

#### Message Structure

```rust
struct AgentMailboxMessage {
    from_session_id: SessionId,
    to_session_id: SessionId,
    from_agent_path: String,
    to_agent_path: String,
    content: String,
    sequence: u64,
}
```

#### Delivery Behavior

`send_message` places the message in the target child's mailbox. The runtime drains mailbox entries as child user input:
- If the child is idle, the drained message starts a child turn immediately.
- If the child is active, the drained message is queued for the next child turn.
- If the caller is a child targeting `parent`, `root`, or the parent session id, the request is rejected.

#### Message Flow

```
Sender Agent                    Mailbox                      Recipient Agent
     │                             │                              │
     │  send_message(target, msg)  │                              │
     │────────────────────────────►│                              │
     │                             │  (queue)                     │
     │                             │                              │
     │                             │  drain as user input         │
     │                             │─────────────────────────────►│
     │                             │  starts turn or queues turn  │
```

#### Output Buffer Polling

The parent does not receive child-authored mailbox messages. Instead, each parent session has an output buffer:

```rust
struct AgentOutputEvent {
    sequence: u64,
    child_session_id: SessionId,
    agent_path: String,
    turn_id: Option<TurnId>,
    kind: String,              // "assistant_delta" or "status"
    text: Option<String>,
    status: Option<String>,
    created_at: DateTime<Utc>,
}
```

`wait_agent` reads events after an optional `after_sequence` cursor. If matching events already exist, it returns immediately. Otherwise it waits with a deadline and returns either new events or `timed_out = true`.

Timeout bounds are configurable per session (`min_wait_timeout_ms`, `max_wait_timeout_ms`, `default_wait_timeout_ms`).

### Agent Status Lifecycle

```
PendingInit ──► Running ──► Completed(Option<String>)
                  │
                  ├──► Interrupted ──► Running  (received new input)
                  │
                  ├──► Errored(String)
                  │
                  └──► Shutdown

NotFound  (queried before spawn or after removal)
```

| Status | Meaning |
|--------|---------|
| `PendingInit` | Child session created but not yet started its first turn |
| `Running` | Agent is actively processing a turn |
| `Interrupted` | Agent's current turn was interrupted; may receive more input |
| `Completed` | Agent finished a turn successfully |
| `Errored(String)` | Agent encountered a fatal error |
| `Shutdown` | Agent was explicitly closed or the parent session ended |
| `NotFound` | Agent is not known to the registry |

Terminal statuses append status events to the parent output buffer.

### Subagent Tool Surface

The subagent tool surface consists of the following built-in tools. All are gated behind a `multi_agent` feature flag.

#### `spawn_agent`

Creates a new subagent (child session) and sends an initial task message.

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `message` | Yes | string | Initial task description |
| `agent_type` | No | string | Role name: `"default"`, `"explorer"`, `"worker"`, or user-defined |
| `model` | No | string | Override model for this agent |
| `reasoning_effort` | No | string | Override reasoning effort |
| `fork_turns` | No | string | `"none"` or `"all"` |

**Output**: Child session id, generated agent path, generated nickname, and current status.

**Errors**:
- `AgentLimitReached`: Concurrent agent limit exceeded
- Generated name pool exhausted
- Invalid role name
- Invalid fork_turns value

#### `send_message`

Sends parent-authored text to an existing child agent as child user input.

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `target` | Yes | string | Target agent path (absolute or relative) |
| `message` | Yes | string | Text message content |

**Output**: Empty success acknowledgment.

**Errors**: Target not found, empty message, or caller attempts child-to-parent delivery.

#### `wait_agent`

Polls child assistant output and terminal status events, optionally waiting for new output.

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `target` | No | string | Optional child agent path or session id |
| `after_sequence` | No | integer | Only return events after this parent-buffer sequence |
| `timeout_ms` | No | integer | Wait timeout in milliseconds (clamped to `[min_wait_timeout_ms, max_wait_timeout_ms]`) |

**Output**: `{ "events": AgentOutputEvent[], "next_sequence": integer, "timed_out": bool }`.

**Behavior**: If matching output events after `after_sequence` already exist, returns immediately. Otherwise waits until a matching event arrives or the timeout expires.

#### `list_agents`

Lists live agents in the current root tree, optionally filtered by path prefix.

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `path_prefix` | No | string | Filter agents by path prefix (absolute or relative) |

**Output**: Array of `{ agent_name, agent_status, last_task_message }`.

The root agent is always included when no prefix or a matching prefix is specified.

#### `close_agent`

Shuts down an agent and all of its live descendants, marking the spawn edge as closed.

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `target` | Yes | string | Target agent path or session ID |

**Output**: Success acknowledgment.

**Errors**: Target not found.

**Behavior**:
1. Persists the spawn edge status as `Closed`.
2. Shuts down the target agent session.
3. Recursively shuts down all live descendants in the spawn tree.

### Depth and Concurrency Limits

Three configurable limits prevent runaway parallel spawning:

| Limit | Config Key | Scope | Behavior |
|-------|-----------|-------|----------|
| Max concurrent subagents | `agent_max_sub_agents` | Per root session tree | Hard cap on total live agent sessions. Spawn is rejected when at capacity. |
| Max spawn depth | `agent_max_depth` | Per root session tree | Maximum depth from root in the agent tree (root = 0). Spawn is rejected when exceeded. At the depth limit, the child's config has multi-agent features disabled to prevent further nesting. |
| Max concurrent per session | `max_concurrent_sub_agents_per_session` | Per session | Separate cap for multi-agent mode specifically. |

### Persistence and Resumption

#### Spawn-Edge Persistence

Parent-child spawn relationships are persisted as edges in the agent graph store:

```
(parent_session_id, child_session_id, status: Open | Closed)
```

This enables:
- Reconstructing the agent tree when resuming a session
- Finding child sessions that need to be re-attached on resume
- Distinguishing open agents (may still be active) from closed agents (completed and cleaned up)

#### Session Resumption

When a session is resumed:

1. The root session is loaded.
2. Open spawn edges are traversed to discover child sessions.
3. Child sessions are resumed from their persisted rollout transcripts.
4. The `AgentControl` is re-established with the reconstructed registry.
5. Completion watchers are re-attached for any child that was still running when the session was suspended.

The agent registry is rebuilt in-memory from the persisted edges. Resume is recursive: a child's descendants are also discovered and resumed.

#### Spawn-Edge States

| State | Meaning |
|-------|---------|
| `Open` | Agent was spawned and may still be active or resumable |
| `Closed` | Agent was explicitly closed via `close_agent` and its descendants were shut down |

Closing an edge does not delete the child's transcript — closed agents remain in the session history for audit and review.

### Safety, Permission, and Approval Boundaries

Subagents are subject to all normal safety constraints. They do not create a permission bypass.

#### Permission Inheritance

At spawn time, the child inherits:
- Active permission profile (filesystem policy, network policy)
- Approval policy setting
- Shell environment policy
- Execution policy (exec-policy rules)
- Working directory

These are copied from the parent's runtime turn state, not from the original config, ensuring the child sees the parent's currently-effective safety posture.

#### Approval for Subagent Actions

Subagents route their tool calls through the same `authorize_tool_request` path as the parent. This means:
- A subagent whose actions exceed the inherited permission profile will trigger approval prompts.
- The approval reviewer setting (`user` or `auto_review`) applies to subagent actions.
- Approved scopes (session, path, host) are shared within the session tree, not per-agent — a parent's cached approval benefits children and vice versa.

Subagents inherit the parent's session-level approval cache at spawn time, so previously-granted session-scoped approvals remain effective.

#### Depth-Dependent Safeguards

At or beyond `agent_max_depth`, the child's config is locked down:
- `multi_agent` features are disabled, preventing further spawning.
- This prevents unbounded recursive agent trees.

### Context Injection

#### Environment Context

When the agent's environment context is assembled, live child subagents are listed:

```
<environment_context>
Sub-agents:
  /root/researcher (Scout) — Investigating authentication module
  /root/implementer (Atlas) — Implementing database migration
</environment_context>
```

This gives the parent agent awareness of which children exist and what they're doing.

#### Orchestration Instructions

When multi-agent features are enabled, a dedicated set of instructions is injected into the system prompt. Key orchestration rules include:

- **Prefer multiple sub-agents to parallelize work.** When a task decomposes naturally into independent subtasks, spawn them in parallel rather than sequentially.
- **If sub-agents are running, wait for them before yielding**, unless the user asks an explicit question. If the user asks a question, answer it first, then continue coordinating.
- **When you delegate work to a sub-agent, your role becomes coordination.** Do not perform the actual work while sub-agents are working. Trust their results without redundant verification.
- **Assign clear ownership.** When multiple workers are spawned to modify code, explicitly assign files or modules to each to avoid merge conflicts.
- **Reuse existing sub-agents for related follow-up questions** rather than spawning new ones.
- **Use `send_message`** to send additional user input to an existing child agent.
- **Use `wait_agent`** to poll child output and terminal status events, with an appropriate timeout.
- **Close sub-agents when done** to free resources and prevent stale agents from consuming limits.

These instructions adapt to the active configuration: if model selection is hidden from the spawn tool, model descriptions are omitted; if spawn metadata is hidden, nicknames are suppressed from output.

#### Subagent Usage Hints

Configurable usage hint text can customize the instructions injected for both the root agent and subagents:

| Config Key | Default | Applied To |
|------------|---------|------------|
| `root_agent_usage_hint_text` | (built-in orchestration rules) | Root agent |
| `subagent_usage_hint_text` | (built-in subagent rules) | All subagents |

These are injected as developer messages at child session start and are stripped when history is forked (the child gets fresh hints matching its own role).

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---:|---|---|---|
| refines | L1-REQ-AGENT-004 | 1 | specs/L1/L1-REQ-AGENT-004-subagents.md | Defines subagent spawn, status inspection, result integration, and forked context. |
| refines | L1-REQ-CONV-004 | 1 | specs/L1/L1-REQ-CONV-004-session-forking.md | Subagent spawn uses session forking for context inheritance. |
| refines | L1-REQ-TOOL-002 | 1 | specs/L1/L1-REQ-TOOL-002-tools.md | Subagent coordination tools defined as built-in delegation tools. |
| related-to | L2-DES-AGENT-001 | 1 | specs/L2/agent/L2-DES-AGENT-001-execution-engine.md | Execution engine dispatches subagent turns. |
| related-to | L2-DES-AGENT-002 | 1 | specs/L2/agent/L2-DES-AGENT-002-interrupt-resume-control.md | Subagents may be interrupted and resumed. |
| related-to | L2-DES-TOOL-001 | 1 | specs/L2/tool/L2-DES-TOOL-001-built-in-tool-system.md | Subagent tools are registered as built-in delegation tools. |
| related-to | L2-DES-SAFETY-001 | 1 | specs/L2/safety/L2-DES-SAFETY-001-permission-system.md | Subagents inherit permission profiles. |
| related-to | L2-DES-SAFETY-002 | 1 | specs/L2/safety/L2-DES-SAFETY-002-approval-mechanism.md | Subagents route through the same approval flow. |
| related-to | L2-DES-CONV-001 | 1 | specs/L2/conv/L2-DES-CONV-001-session-jsonl-data-model.md | Session data model includes fork references and subagent metadata. |
| related-to | L2-DES-APP-003 | 2 | specs/L2/app/L2-DES-APP-003-client-server-protocol.md | Protocol events expose subagent spawn, status, and completion. |
| specified-by | L3-BEH-SERVER-003 | 2 | specs/L3/server/L3-BEH-SERVER-003-subagent-coordination.md | L3 defines spawn lifecycle, agent tree registry, mailbox, completion watching, and session resumption. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-25 | Assistant | Initial | Initial subagent architecture design. |
