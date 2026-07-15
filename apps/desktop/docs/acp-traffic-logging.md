# ACP stdio traffic logging

The desktop app talks to the local InfiniteCode server over **ACP** (Agent Client Protocol) on **stdio**: JSON-RPC messages on the child process stdin/stdout. To debug that wire protocol, the main process can append every message to a **JSONL** file.

This uses the same enable switch and default output location as the CLI **Protocol Trace** (see [`docs/protocol-trace.md`](../../../docs/protocol-trace.md)).

Implementation lives in:

- `src/main/acp-traffic-log.ts` — logger, `INFINITECODE_PROTOCOL_TRACE`, and path resolution
- `src/main/acp-stdio-client.ts` — records each stdin/stdout message
- `src/main/infinitecode-manager.ts` — wires the logger into the stdio client at startup

## Enabling

Set `INFINITECODE_PROTOCOL_TRACE=1` (or `true`) **before starting the desktop app**. The value is read once when the main process loads `infinitecode-manager`; changing it at runtime has no effect until you restart the app.

### Development (from repo)

**macOS / Linux**

```bash
export INFINITECODE_PROTOCOL_TRACE=1
cd apps/desktop && bun run dev
```

**Windows (PowerShell)**

```powershell
$env:INFINITECODE_PROTOCOL_TRACE = "1"
cd apps\desktop; bun run dev
```

### Packaged app

Set `INFINITECODE_PROTOCOL_TRACE` in the environment used to launch InfiniteCode (shell profile, shortcut, CI job, etc.).

## Output location

Trace files are written to `INFINITECODE_HOME/traces/` (default `~/.infinitecode/traces/`) using the naming pattern `protocol-<pid>-<utc_timestamp>.ndjsonl`, where `<pid>` is the Electron main-process PID.

To write to a specific path instead, set `INFINITECODE_PROTOCOL_TRACE_FILE`:

```bash
INFINITECODE_PROTOCOL_TRACE=1 INFINITECODE_PROTOCOL_TRACE_FILE=/tmp/my-trace.ndjsonl bun run dev
```

If `INFINITECODE_HOME` cannot be resolved, the trace falls back to `<temp_dir>/infinitecode-traces/`.

| Platform | Default traces directory |
|----------|--------------------------|
| macOS / Linux | `~/.infinitecode/traces/` |
| Windows | `%USERPROFILE%\.infinitecode\traces\` |

## View the log path in the UI

When logging is enabled, open **Settings → Server**. Under **Developer options**, expand **ACP traffic log** to see the active file path.

The renderer loads this via `window.infinitecode.acpTraffic.getState()` (`acp-traffic-log:state` IPC).

## Log format

Each line is one JSON object (JSONL). Fields:

| Field | Description |
|-------|-------------|
| `timestamp` | ISO-8601 time when the entry was written |
| `direction` | `desktop-to-server`, `server-to-desktop`, or `system` |
| `kind` | `request`, `response`, `notification`, `invalid`, or `closed` |
| `id` | JSON-RPC id when present |
| `method` | ACP method name when present |
| `payload` | Full JSON-RPC message or system metadata |

Example line:

```json
{"timestamp":"2026-06-27T01:02:03.004Z","direction":"desktop-to-server","kind":"request","id":1,"method":"initialize","payload":{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}}
```

The CLI protocol trace records raw wire lines (`seq`, `dir`, `bytes`, `line`). The desktop trace records parsed ACP messages with direction and kind, which is easier to filter when debugging the managed runtime.

### What is recorded

`StdioAcpClient` logs:

- **desktop → server**: outbound requests and responses (e.g. permission replies)
- **server → desktop**: inbound responses, notifications, and server-initiated requests
- **system**: invalid stdout lines and transport `closed` events (with error text)

### What is not recorded

- **Server stderr** is not written to the traffic log. Non-empty stderr lines are emitted to the main-process console as `[main:acp-stdio-client]` warnings (`[stderr] …`).
- **Renderer ↔ main IPC** is not included; only the stdio link to `infinitecode server --transport stdio`.

## Inspect the log

**Tail live**

```bash
tail -f ~/.infinitecode/traces/protocol-*.ndjsonl
```

**Pretty-print with jq**

```bash
jq -c '{ts: .timestamp, dir: .direction, kind, method, id}' ~/.infinitecode/traces/protocol-*.ndjsonl
```

**Filter by method**

```bash
jq 'select(.method == "session/prompt")' ~/.infinitecode/traces/protocol-*.ndjsonl
```

## Security

The log can contain sensitive data: prompts, file paths, tool arguments, model/provider details, and credentials in params. Use a private path, disable logging when not debugging, and do not commit or share log files. The feature is disabled by default.

## Legacy environment variables

These are **ignored**:

- `TRAFFIC_LOG_PATH`
- `INFINITECODE_DESKTOP_ACP_TRAFFIC_LOG`
- `INFINITECODE_DESKTOP_ACP_TRAFFIC_LOG_PATH`

## Related debugging

For general main-process diagnostics (spawn errors, slow IPC handlers, transport close), watch the terminal where Electron runs. Log lines are tagged `[main:<module>]`, e.g. `[main:acp-stdio-client]` and `[main:infinitecode-manager]`.
