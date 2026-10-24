## symbol:prepareShellCommand

Bash commands the operator reads (foreground, background, scheduled) run on a pseudo-terminal; monitor and Pi Exec's bash keep pipes. Falling back to pipes when no terminal opens is deliberate (operator decision, 2026-10-24), and the reason travels in `details.terminalUnavailable`.
Why: programs such as Git and bat choose colors and layout from `isatty`; capturing and rendering ANSI correctly did not make piped commands colorful. Monitor events and program-read output need plain, separate stdout.
Coupled: components/tasks/src/terminal.ts, components/tasks/src/monitor-tool.ts, components/pi-exec/src/core-tools.ts
Verify: components/tasks/tests/terminal.test.ts, components/tasks/tests/terminal-fallback.test.ts

## symbol:executeBashImpl

Failed and timed-out commands return `isError` results instead of throwing; only an abort throws.
Why: a thrown error keeps only its message, so the styled output in `details.styledOutput` would be lost for exactly the failing runs (test failures) where colors help most.
Coupled: components/terse-tools/src/content-formatting.ts
Verify: components/tasks/tests/terminal.test.ts, components/tasks/tests/tasks.test.ts
