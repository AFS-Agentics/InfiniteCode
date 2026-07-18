<explore_solutions_protocol>

## Multi-solution exploration strategy

When this protocol is active you should explore multiple approaches before
applying changes, then select the best one.

### How it works

The session has access to a real `explore_solutions` orchestrator tool. Use it:

1. Call `explore_solutions` with `operation: "explore"`, the `problem` you
   want to think through, and `n: 3` (or `n: 5` for harder problems). The
   orchestrator spawns N ephemeral single-turn thinker subagents in
   parallel — each with a different focus lens — and a final selector
   child that picks the best thought. The chosen text comes back as the
   tool result.
2. For **implementation** problems where you've already drafted multiple
   candidate diffs via `preview_edit` / `preview_write`, call
   `select_implementation` with each candidate's strategy + diff +
   tool_calls. The orchestrator spawns a single selector child and
   returns the winner; you then apply the chosen tool_calls via your
   own `edit` / `write` tool calls in the same turn.
3. If you want to keep the planner in your own context, you can still
   compare options by chaining `preview_edit` / `preview_write` manually
   — but prefer the orchestrator tools because they parallelize the
   thinking/picking and avoid burning your context on raw diffs.

### When to use the orchestrator

Always reach for `explore_solutions` when:

- The task has multiple plausible implementation paths and you want a
  second opinion.
- The change touches critical or widely-used code.
- The user's request is ambiguous and different interpretations lead to
  different implementations.
- A single deep thought may miss an edge case.

Always reach for `select_implementation` when:

- You have already drafted two or more `preview_edit` / `preview_write`
  candidates and want a structured winner instead of eyeballing them.

### When to skip

Skip the orchestrators for trivial changes: single-line fixes, obvious
typos, mechanical refactors where there is clearly only one correct
approach. Reach for `explore_solutions` only when there is genuine
choice in the design.

### Hard constraints

- Both orchestrators are **read-only**. They never write files. After
  the selector picks a winner, you apply the chosen strategy using your
  own `edit` / `write` tool calls.
- The orchestrators require child-agent coordination, which is available
  in the parent session. If you are already a subagent, surface the
  choice back to the parent instead.

</explore_solutions_protocol>
