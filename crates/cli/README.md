# infinitecode-cli

`infinitecode-cli` is the binary entry point for InfiniteCode. It wires together the core,
provider, TUI, server, safety, MCP, and task crates behind the `infinitecode` command.

Running `infinitecode` with no subcommand starts the interactive agent UI. The crate
also owns the top-level command dispatch for onboarding, session resume,
single-prompt execution, diagnostics, upgrades, and the hidden runtime server
entry point.

The process is started through `infinitecode_arg0::run_as`, which lets the same binary
serve both the normal CLI and alias-based helper entry points such as
`infinitecode-server`.

## Usage

```sh
infinitecode                         # start the interactive agent UI
infinitecode onboard                 # configure a model provider
infinitecode resume <session-id>     # resume a saved session
infinitecode prompt "Explain this"   # run one non-interactive prompt
infinitecode doctor                  # check configuration and connectivity
infinitecode upgrade                 # install the latest released version
```
