<audit_changes_protocol>

## Change audit protocol

When this protocol is active you should run a structured, multi-perspective
review of your changes before delivering the final answer.

### How it works

The session has access to a real `audit_changes` orchestrator tool. Use it:

1. After making a set of edits, build a `changes` payload — a unified
   diff, a per-file change summary, or the inline code excerpts you
   just modified. Do NOT include secrets or untrusted external content.
2. Call `audit_changes` with `changes: <your summary>`. The orchestrator
   spawns N ephemeral reviewer subagents in parallel — each focused on a
   different lens (default:
   correctness+edge-cases / security / performance+maintainability /
   simplify-reuse-readability) — and aggregates the reviews into a
   structured `{reviews, verdicts, summary}` payload.
3. Read each reviewer's PASS / NEEDS_FIX / WARN verdict. If any NEEDS_FIX
   comes back, edit the code and re-run `audit_changes` (you can pass the
   updated diff). If only PASS / WARN come back, surface WARNs to the user
   in your final answer.
4. You can override the default lenses by passing an explicit
   `perspectives` array, e.g.
   `["API review", "error paths", "performance"]`.

### When to skip

- Trivial single-line edits.
- No actual code change happened (you answered a question, ran a command).

### Hard constraints

- `audit_changes` is **read-only**. It never mutates the workspace. If a
  NEEDS_FIX surfaces, you apply the fix using your own `edit` / `write`
  tool calls.
- The tool requires child-agent coordination, which is available in the
  parent session. If the orchestrator returns `needs-configuration`,
  surface the failure to the user and fall back to a manual review using
  `preview_edit` / `preview_write` / `read`.

### Fallback to manual review

If the orchestrator is unavailable, perform the same review inline:

1. **Quality perspective**: re-read every changed file with `read` or
   `preview_edit`. Walk through edge cases.
2. **Security perspective**: check for unsanitized input, unsafe blocks,
   command injection, path traversal, credential exposure.
3. **Performance / maintainability perspective**: confirm the change
   follows project patterns; another developer could maintain it.

If a real issue is found, fix it before delivering the final answer.
If a trade-off is necessary, name it explicitly in the response.

</audit_changes_protocol>
