# Protocol Trace (stdio)

When debugging client-server communication you can capture every NDJSON line
exchanged over the stdio transport. The trace runs inside the client process and
records raw wire traffic in both directions without modifying the server or its
stdout stream.

## Enabling

Set the `DEVO_PROTOCOL_TRACE` environment variable before launching Devo:

```bash
DEVO_PROTOCOL_TRACE=1 devo
```

On Windows (PowerShell):

```powershell
$env:DEVO_PROTOCOL_TRACE = "1"; devo
```

## Output location

Trace files are written to `DEVO_HOME/traces/` (default `~/.devo/traces/`)
using the naming pattern `protocol-<pid>-<utc_timestamp>.ndjsonl`.

To write to a specific path instead, set `DEVO_PROTOCOL_TRACE_FILE`:

```bash
DEVO_PROTOCOL_TRACE=1 DEVO_PROTOCOL_TRACE_FILE=/tmp/my-trace.ndjsonl devo
```

If `DEVO_HOME` cannot be resolved, the trace falls back to
`<temp_dir>/devo-traces/`.

## Record format

Each line in the trace file is a JSON object (NDJSONL):

```json
{"seq":1,"ts":"2026-07-03T15:30:00.123Z","dir":"out","bytes":128,"line":"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",...}"}
{"seq":2,"ts":"2026-07-03T15:30:00.145Z","dir":"in","bytes":256,"line":"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{...}}"}
```

| Field   | Description                                                        |
|---------|--------------------------------------------------------------------|
| `seq`   | Monotonic sequence number across both directions                   |
| `ts`    | UTC timestamp (RFC 3339, millisecond precision)                    |
| `dir`   | `"out"` = client to server, `"in"` = server to client             |
| `bytes` | Byte length of the raw JSON payload                                |
| `line`  | The original JSON-RPC line exactly as sent or received on the wire |

The `seq` counter is shared between the writer and reader async tasks via an
`AtomicU64`, so records from both directions can be sorted into a single
chronological stream.

## Hook points

The trace is inserted at two locations in
[`crates/client/src/stdio.rs`](../crates/client/src/stdio.rs):

| Direction | Function              | When                                            |
|-----------|-----------------------|-------------------------------------------------|
| C → S     | `write_ndjson_to_stdin` | After `serde_json::to_vec`, before `write_all` |
| S → C     | stdout reader loop    | After `next_line`, before `serde_json::from_str` |

This ensures the trace captures the exact bytes that cross the pipe boundary,
including malformed payloads that fail JSON parsing.

## Querying traces

Use `jq` to filter and inspect:

```bash
# Show only outbound (client → server) messages
jq 'select(.dir == "out")' ~/.devo/traces/protocol-*.ndjsonl

# Show methods of all outbound requests
jq -r 'select(.dir == "out") | .line | fromjson | .method // empty' ~/.devo/traces/protocol-*.ndjsonl

# Show inbound messages larger than 1 KB
jq 'select(.dir == "in" and .bytes > 1024)' ~/.devo/traces/protocol-*.ndjsonl
```

## Security note

Trace files contain the full protocol payload, which may include file contents,
API keys, and other sensitive data. Treat them with the same care as log files
and delete them when no longer needed. The feature is disabled by default.

## Implementation

The core logic lives in
[`crates/client/src/protocol_trace.rs`](../crates/client/src/protocol_trace.rs).
`ProtocolTrace::from_env()` is called once during `StdioServerClient::spawn`;
when disabled (`None`), the code path is a zero-cost no-op. File I/O uses
`std::sync::Mutex<std::fs::File>` with explicit `flush()` after each record.
