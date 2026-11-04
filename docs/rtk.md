# RTK (Rust Token Killer) Integration

`apple-pi` integrates [RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk) to compress CLI command outputs (e.g. `git`, `cargo`, `npm`, `vitest`, linters, directory listings) and reduce token consumption.

RTK is off by default. Set `RTK_ENABLED=1` in the environment Pi starts with to turn it on. RTK's compact output replaces the colors and layout that Bash's [terminal](tasks.md#terminal) gives commands, so it is opt-in for now.

## How It Works

1. **Automatic Rewrite**:
   When RTK is enabled and available on the system (`>= 0.23.0`), the tasks `bash` tool (`prepareShellCommand` in `components/tasks/src/bash-tool.ts`, the only rewriter) rewrites commands through `rtk rewrite <command>`.
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
   Every top-level session loads the RTK extension, including each peer and the temporary peers that programs start. [Interns](interns.md) and the [`/btw`](btw.md) session do not load it, so their shell output is not rewritten.

6. **Raw execution boundaries**:
   A `bash` call from a codemode script or saved [program](programs.md) runs on pipes, without RTK rewriting or backgrounding, so the script receives plain output. The root `monitor` tool also bypasses RTK because each stdout line is an agent event and rewriting would change that protocol. `monitor` accepts its own command and optional event-delivery limit.

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

- **`RTK_ENABLED`**: Set `RTK_ENABLED=1` in the environment to turn on RTK detection, command rewriting, and system prompt injection. Any other value, or none, leaves RTK off.
- **Fail-Open Behavior**: If RTK is enabled but the `rtk` binary is missing from the system `PATH`, all features disable cleanly. Commands run normally with zero overhead or execution failures.
