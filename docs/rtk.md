# RTK (Rust Token Killer) Integration

`apple-pi` integrates [RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk) seamlessly to compress CLI command outputs (e.g. `git`, `cargo`, `npm`, `vitest`, linters, directory listings) and reduce token consumption.

## How It Works

1. **Automatic Rewrite**:
   When RTK is available on the system (`>= 0.23.0`), shell commands executed via the `bash` tool are rewritten through `rtk rewrite <command>`.
   - If RTK provides an optimized command (exit codes 0 or 3), the rewritten command executes.
   - If RTK cannot optimize the command, execution falls back to the original command without errors (fail-open).

2. **System Prompt Guidance**:
   The `rtk` extension injects instructions into the system prompt during `before_agent_start`. The model is informed that commands may be rewritten or filtered to save tokens, and that the `verbatim: true` parameter on `bash` can bypass this when exact raw output is required.

3. **Clean Terminal UI**:
   The TUI displays the original intended command (e.g. `Bash(git status)`) instead of the rewritten wrapper (e.g. `Bash(rtk git status)`). The underlying compression operates transparently.

4. **Visual Indicator (`▲`)**:
   In `terse-tools`, commands rewritten or compressed by RTK display an upward triangle `▲` instead of the standard `●` bullet:
   - `● Bash(git status)`: Standard execution without RTK rewrite.
   - `▲ Bash(git status)`: Executed with RTK output compression.

5. **Subagent Support**:
   Standard mutation-capable child sessions inherit the RTK extension and benefit from command output compression.

6. **Pi Exec Isolation**:
   Inside `pi_exec`, `pi.bash` is isolated from both RTK rewriting and background tasks. Guest JavaScript scripts require deterministic, unaltered command outputs for parsing. The `pi.bash` guest signature accepts `{ command, timeout?, stdin? }` without `verbatim` or `run_in_background` parameters, ensuring commands always execute raw and return their output to the script promise.

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

- **`RTK_DISABLED`**: Set `RTK_DISABLED=1` or `RTK_DISABLED=true` in the environment to completely disable RTK detection, command rewriting, and system prompt injection.
- **Fail-Open Behavior**: If the `rtk` binary is missing from the system `PATH`, all features disable cleanly. Commands run normally with zero overhead or execution failures.
