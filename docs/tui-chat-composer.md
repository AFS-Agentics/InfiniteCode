# TUI Chat Composer

## Scope

The TUI composer is the bottom-pane text editor used for chat input. Its behavior lives primarily in `crates/tui/src/bottom_pane/chat_composer.rs`, with popup rendering split into smaller bottom-pane modules.

## Popup Routing

The composer keeps one active popup at a time:

- Slash-command popup for command names.
- Combined `@` reference popup for skills, configured MCP servers, and files.
- `$` skill popup for compatibility with existing skill mention behavior.

Popup routing is token-local. A token begins after whitespace and ends before whitespace. Typing `@` anywhere inside the active token opens the combined reference popup, including normal prose and slash-command arguments such as `/review @src`.

When the cursor is on an `@` token, the reference popup takes priority over the slash-command popup. When the cursor is on a `$` token, the compatibility skill popup takes priority over `@` and slash-command handling.

## Combined `@` Reference Popup

The combined popup displays one result box ordered by category:

1. Skills from server-owned skill metadata.
2. MCP servers from server-loaded configured MCP server records.
3. Files from the server-managed `devo-file-search` session.

The TUI does not fuzzy-filter `@` rows locally. It renders `ReferenceSearchSnapshot` rows returned by the server over the worker/client boundary. Result rows include kind, display text, insert token, target reference, disabled state, and match indices for highlighting.

Selecting a skill inserts the existing `$skill` mention token so server-side skill activation keeps working. Selecting an MCP server inserts `@mcp:<server_id>` and stores an `mcp://server/<server_id>` mention binding. Selecting a file preserves existing file behavior: non-image files insert the path, while image files are attached when image metadata can be read.

## Reference Search Events

The composer does not own fuzzy servicing or file walking. It emits explicit app events:

- `AppEvent::ReferenceSearchRequested { query }` when an `@` token opens or changes, including an empty query for bare `@`.
- `AppEvent::ReferenceSearchCancelled` when the popup is closed or the cursor leaves reference-search context.
- `WorkerEvent::ReferenceSearchUpdated { snapshot }` when the server returns or later pushes unified search results.

The host forwards request/cancel events to `QueryWorkerHandle`. The worker calls `search/start`, `search/update`, or `search/cancel` on the stdio server client and converts `search/updated` server notifications back into worker events. Result snapshots are accepted only when their query still matches the current `@` token and the reference popup is active.

## Selection And Dismissal

While the combined reference popup is open:

- `Enter` and `Tab` confirm the focused result.
- `Enter` with no focused result does not submit the chat turn.
- `Esc` closes the popup, preserves typed text, cancels active reference search, and does not immediately reopen for the same token.
- `Up`, `Down`, `Ctrl+P`, and `Ctrl+N` move focus within the popup.

After confirmation, the composer returns to normal editing with a trailing space after the inserted reference.
