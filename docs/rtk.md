# RTK (Rust Token Killer) Integration

`apple-pi` integrates [RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk) seamlessly to compress CLI command outputs (e.g. `git`, `cargo`, `npm`, `vitest`, linters, directory listings) and reduce token consumption.

## How It Works

1. **Automatic Rewrite**:
   When RTK is available on the system (`>= 0.23.0`), the tasks `bash` tool (`prepareShellCommand` in `components/tasks/src/bash-tool.ts`, the only rewriter) rewrites commands through `rtk rewrite <command>`.
   - If RTK provides an optimized command (exit codes 0 or 3), the rewritten command executes.
   - If RTK cannot optimize the command, execution falls back to the original command without errors (fail-open).

2. **System Prompt Guidance**:
   The `rtk` extension only adds a `<shell-output>` section to the system prompt during `before_agent_start`. The model is informed that commands may be rewritten or filtered to save tokens, and that the `verbatim: true` parameter on `bash` can bypass this when exact raw output is required.

3. **Clean Terminal UI**:
   The TUI displays the original intended command (e.g. `Bash(git status)`) instead of the rewritten wrapper (e.g. `Bash(rtk git status)`). The underlying compression operates transparently.

4. **Visual Indicator (`▲`)**:
   In `terse-tools`, commands rewritten or compressed by RTK display an upward triangle `▲` instead of the standard `●` bullet:
   - `● Bash(git status)`: Standard execution without RTK rewrite.
   - `▲ Bash(git status)`: Executed with RTK output compression.

5. **Where it loads**:
   Every top-level session loads the RTK extension, including each peer and the temporary peers that `pi_exec` starts. [Interns](interns.md) and the [`/btw`](btw.md) session do not load it, so their shell output is not rewritten.

6. **Raw execution boundaries**:
   Inside `pi_exec`, `bash` is isolated from both RTK rewriting and background tasks. Monty programs receive deterministic, unaltered command output for parsing. The root `monitor` tool also bypasses RTK because each stdout line is an agent event and rewriting would change that protocol. Pi Exec's Python `bash` accepts `command`, `timeout`, and `stdin` keyword arguments without `verbatim` or `run_in_background`; `monitor` accepts its own command and optional event-delivery limit.

## The `verbatim` Parameter

The `bash` tool includes an optional `verbatim` parameter:

```json
{
  "command": "git diff",
  "verbatim": true
}
```

- When `verbatim: true` is supplied, RTK rewriting is bypassed completely. The command runs unaltered.
- Use `verbatim: true` when exact uncompressed output, raw patch data, or character-for-character formatting is required.

## Configuration & Environment Variables

- **`RTK_DISABLED`**: Set `RTK_DISABLED=1` in the environment to completely disable RTK detection, command rewriting, and system prompt injection.
- **Fail-Open Behavior**: If the `rtk` binary is missing from the system `PATH`, all features disable cleanly. Commands run normally with zero overhead or execution failures.
