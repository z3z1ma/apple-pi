## file

Open pseudo-terminal pairs with the native module's `open()` and give the slave to Node's `spawn` as stdout and stderr; do not use the package's `spawn()`.
Why: the package's spawn makes the terminal the child's controlling terminal and its stdin. Programs then wait forever on `/dev/tty` prompts (sudo, ssh) and pagers, and the process no longer fits the detached process-group kill, stdin pipe, and Ctrl+B handoff the tasks code relies on. An inherited slave fd gives `isatty(1)` and `isatty(2)` without a controlling terminal (verified on macOS: `read </dev/tty` fails at once; `less` still needs `PAGER=cat` because it reads keys from stderr).
`requireBinary("pty.node")` is internal to `@lydell/node-pty`; the version is pinned exactly for that reason. Recheck `open(cols, rows)` before changing the version.

One terminal carries both stdout and stderr, read as `stdout`.
Why: two separate terminals reorder interleaved stdout and stderr, which a terminal user never sees. Monitor needs stderr apart from its stdout events and stays on pipes.

`close` waits for both the child's exit and the end of the terminal's output, or, after exit, for the output to stay quiet for Pi's own post-exit grace.
Why: the child's own `close` fires at exit because it has no piped stdio; reading the snapshot then would lose output still in the terminal. Linux ends the output with EIO, macOS with EOF. A descendant left in the background (`cmd &`) holds the terminal open forever, so waiting for the end alone would hang the command; the grace is re-armed on each chunk, as in Pi's `waitForChildProcess`, so a descendant still writing is not cut off mid-burst.
Coupled: components/tasks/src/bash-tool.ts, components/tasks/src/task-manager.ts
Verify: components/tasks/tests/terminal.test.ts, components/tasks/tests/terminal-fallback.test.ts

## symbol:terminalEnvironment

`BASH_ENV` points at `terminal-bash-env.sh`, which wraps `ls`, `grep`, and `diff` with `--color=auto` and then restores the operator's `BASH_ENV` (or unsets it) for nested shells.
Why: the operator's fish terminal colors these through shell functions; the programs default to no color, so a terminal alone left them plain (2026-10-24 comparison). Restoring the variable keeps the wrappers and their capability checks (about 17 ms) out of every nested bash a build or script starts. It only applies when Pi's shell is bash.
Verify: components/tasks/tests/terminal.test.ts

## symbol:terminalSize

The width subtracts the transcript's four-column output indent so wrapped command output fits where terse-tools shows it.
Coupled: components/terse-tools/src/formatters.ts
