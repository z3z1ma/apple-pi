Status: pending
Created: 2026-10-24
Updated: 2026-10-24

# Retrospective

## What Mattered

- The success criterion was the operator's experience (colors as in his terminal), not byte preservation. Two earlier diagnoses verified pass-through and stopped short; the unchanged `bat` comparison made the gap undeniable.
- A five-minute spike with the real library decided the design. The package's own `spawn` makes the PTY the controlling terminal and stdin, which turns `sudo`, `ssh`, and pagers into hangs. Opening a bare pair and handing the slave to Node's `spawn` kept every existing process guarantee and still made `isatty(1)` true.
- One PTY for both streams matched the terminal; two PTYs reordered stdout and stderr in the first test run.

## Learnings

- Reading a result immediately after a process exits races an asynchronous `WriteStream`; files a result points to must be written synchronously.
- Throwing from a tool loses `details`; return `isError` results when the details carry display data.
- RTK rewrites common commands into plain compact output, so color work on Bash only shows for commands RTK leaves alone or with `verbatim: true`.

## Improvements

- Linux behavior (EIO at end of output) is reasoned from node-pty's code, not run here; check it the first time the package runs on Linux.
