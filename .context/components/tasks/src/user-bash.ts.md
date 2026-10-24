## symbol:terminalShellOperations

The tasks extension returns these operations from `user_bash`, which ends Pi's handler loop. The pair programmer's `user_bash` handler only watches and returns nothing; it keeps seeing `!` commands because `extensions/pi-pair.ts` loads before `extensions/tasks.ts` in `package.json`.
Why: Pi stops at the first handler that returns a result. A tasks handler loaded earlier would silently stop the pair from reviewing the operator's shell commands.

The transcript has a one-line screen.
Why: Pi streams each chunk it receives and strips styles and carriage returns itself; a larger screen would hold lines back until they scroll out of it. Carriage-return progress still settles on the current line; a redraw across several lines repeats its frames.
Coupled: components/pair-programmer/src/extension.ts, package.json
Verify: components/tasks/tests/terminal.test.ts
