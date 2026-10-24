## file

Open pseudo-terminal pairs with the native module's `open()` and give the slave to Node's `spawn` as stdout and stderr; do not use the package's `spawn()`.
Why: the package's spawn makes the terminal the child's controlling terminal and its stdin. Programs then wait forever on `/dev/tty` prompts (sudo, ssh) and pagers, and the process no longer fits the detached process-group kill, stdin pipe, and Ctrl+B handoff the tasks code relies on. An inherited slave fd gives `isatty(1)` and `isatty(2)` without a controlling terminal (verified on macOS: `read </dev/tty` fails at once; `less` still needs `PAGER=cat` because it reads keys from stderr).
`requireBinary("pty.node")` is internal to `@lydell/node-pty`; the version is pinned exactly for that reason. Recheck `open(cols, rows)` before changing the version.

One terminal carries both stdout and stderr, read as `stdout`.
Why: two separate terminals reorder interleaved stdout and stderr, which a terminal user never sees. Monitor needs stderr apart from its stdout events and stays on pipes.

`close` waits for both the child's exit and the end of the terminal's output.
Why: the child's own `close` fires at exit because it has no piped stdio; reading the snapshot then would lose output still in the terminal. Linux ends the output with EIO, macOS with EOF.
Coupled: components/tasks/src/bash-tool.ts, components/tasks/src/task-manager.ts
Verify: components/tasks/tests/terminal.test.ts, components/tasks/tests/terminal-fallback.test.ts

## symbol:terminalSize

The width subtracts the transcript's four-column output indent so wrapped command output fits where terse-tools shows it.
Coupled: components/terse-tools/src/formatters.ts
