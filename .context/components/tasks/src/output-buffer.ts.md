## file

Every consumer of a snapshot's `content` (tool results, task status, notifications, full-output files) gets plain text; only terminal views use `styled`.
Why: operator decision (2026-10-24): the model receives no escape sequences. Truncation therefore counts plain text, so colored output does not shrink what the model sees.

The full-output file is written synchronously, once per appended chunk, and opened by the first snapshot that is truncated.
Why: a result is read as soon as the command finishes; an asynchronous stream lost the last lines in tests. The transcript keeps the last screen of lines editable, so totals can exceed the limits before the lines become final.
Coupled: components/tasks/src/terminal-transcript.ts, components/tasks/src/bash-tool.ts, components/tasks/src/ui/task-manager.ts
Verify: components/tasks/tests/terminal.test.ts, components/tasks/tests/tasks.test.ts
