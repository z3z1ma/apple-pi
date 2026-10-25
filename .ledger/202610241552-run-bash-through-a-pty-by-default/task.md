Status: in-progress
Created: 2026-10-24

# Run Bash through a PTY by default

## Intent

Bash commands behave as they do in the operator's terminal: programs see a terminal on stdout and stderr, so they emit their normal colors (for example unchanged `git log` and `bat`). The change must be robust: no new hangs, no lost output, no broken cleanup, and no terminal-control garbage in the transcript or the model's context.

## Decisions (operator, 2026-10-24)

- The model receives plain text. Colors appear only in the transcript and inspector.
- The PTY width follows Pi's terminal width minus the transcript indent; headless runs use 80x24.
- When a PTY cannot be created (Windows, missing prebuilt binary, PTY exhaustion), Bash falls back to pipes and records that in the result details.
- Scope: foreground, background, and scheduled Bash. Monitor, `pi_exec` evidence, and branch-search judges stay on pipes.

## Design

Verified by a scratch spike with `@lydell/node-pty` 1.1.0 (prebuilt N-API binary, loads on Node 26):

- Open one PTY pair with the package's native `open(cols, rows)`. Spawn the shell with `child_process.spawn` as today (detached process group, stdin pipe or ignore), but give it the PTY slave as both stdout and stderr, then close the slave in the parent and read the master. One PTY keeps stdout and stderr in the order the program wrote them; a first version with two PTYs reordered them.
- The child gets no controlling terminal: `isatty(1)` and `isatty(2)` are true, stdin is not a TTY, and programs that open `/dev/tty` (sudo, ssh password prompts) fail at once as they do today instead of hanging. Process-group kill, exit codes, and Ctrl+B handoff are unchanged; stdout and stderr arrive as one stream, as they already did in the Bash result.
- Environment: `TERM=xterm-256color`, `COLUMNS`/`LINES` matching the PTY, `PAGER=cat`, `GIT_PAGER=cat` (the spike showed `less` waits for keys forever on a PTY).
- A terminal transcript turns raw output into lines: CRLF to LF, carriage-return and backspace overwrites, erase-line, cursor movement within the last screen of rows (progress redraws), save/restore cursor, alt-screen output discarded, other control sequences dropped, SGR colors kept. It yields a styled view (SGR only) and a plain view.
- The output buffer owns the transcript for every Bash path, so model-facing text (results, task status, full-output files) is plain and the UI gets the styled view. Truncation counts plain text.
- Failed and timed-out commands return `isError` results instead of throwing, so their details (styled output) survive; aborts still throw.

## Acceptance criteria

- Unchanged `git log --oneline -3` and `bat <file>` show colors in the transcript; the model's tool result contains no escape sequences.
- `isatty` true for stdout/stderr, false for stdin; `stdin` parameter still works.
- `read </dev/tty` and `sudo -k true` fail immediately; `less` via `PAGER` does not hang.
- Exit codes, timeouts, aborts, Ctrl+B backgrounding, background and scheduled tasks, and group cleanup of orphans behave as before.
- Large output (200k lines) is complete, truncated by plain size, and the full-output file is plain.
- Progress output that uses `\r`, erase-line, or cursor-up redraws produces final lines, not every frame.
- With the PTY unavailable, commands run on pipes and the details say so.
- Monitor events are unchanged (pipes).
- Relevant tests pass with one worker; typecheck, lint, loader test, and pack check pass. No full suite unless the operator asks.

## Outcome

Implemented; awaiting the operator's live check after a Pi restart.

- `components/tasks/src/terminal.ts`: opens one PTY (`@lydell/node-pty` 1.1.0 native `open`) shared by stdout and stderr, so their order is kept. `TerminalProcess` closes only after exit and end of terminal output.
- `components/tasks/src/terminal-transcript.ts`: terminal output to lines (CR/BS/EL/ED, cursor movement within the last screen, save/restore, alt screen dropped, SGR kept).
- `OutputBuffer` owns the transcript for every path: plain `content`, styled `styled`, plain truncation and full-output file (written synchronously).
- Bash returns `details.styledOutput`; failures and timeouts are `isError` results. terse-tools and `/work` show the styled text; the inspector hides `styledOutput` from its Details JSON.

Verified (one worker): tasks and terse-tools suites, 182 tests in 12 files, including real-PTY tests for isatty, colors, failing-command colors, size and pager environment, `/dev/tty` fail-fast, timeout group kill, 200k-line completeness, progress redraw, background tasks, monitor on pipes, and pipe fallback. Also rtk and pi-exec suites (55), typecheck, lint, loader test, pack check, context lint. A scratch run of the real tool showed `git log` (verbatim) with 22 SGR codes and `bat` with 2,624 in details and none in the model text.

Not verified: Linux (EIO end-of-output path), Windows fallback on Windows itself. RTK is now opt-in (`RTK_ENABLED=1`, 93e1fb6c), so its plain compact output no longer hides colors by default.

Follow-up after the operator's live check (colors confirmed for `git log`): a comparison with his fish terminal showed `ls`, `grep`, and `diff` colored only through fish's `--color=auto` wrappers. Bash now loads the same wrappers through `BASH_ENV` for each command's own shell, restoring the operator's `BASH_ENV` for nested shells. A descendant left in the background no longer holds a command open (Pi's post-exit quiet grace). The operator's `!` commands run on the same terminal through Pi's `user_bash` hook; Pi still strips their colors for display. Verified with real-PTY tests (14 in `terminal.test.ts`); tasks, terse-tools, and rtk suites 209 passed with one worker; typecheck, lint, loader, and pack check passed.
