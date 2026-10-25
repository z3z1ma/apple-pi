## file

Pi 1.4 strips ANSI in both its bash executor and BashExecutionComponent. The patch carries already-sanitized SGR text beside the executor's synchronous onData -> onChunk -> appendOutput call, rather than changing what Pi records or sends to the model. The scope restores in finally, and a process-wide symbol keeps repeated loads on the same patch state.
Why: the callback must reach appendOutput synchronously while the styled chunk is in scope. Deferring that callback would lose the display styles; passing them as output bytes instead would put ANSI into Pi's recording path.

The patch depends on BashExecutionComponent's private outputLines, contentContainer, expanded, outputPad, and updateDisplay. Pi currently places the output child immediately after the command header. Preserve native status/loader/notices and plain truncation; the patch replaces only that output child. Recheck this seam on Pi upgrades. Styles belong to the component's weak-map entry and are not persisted.

Align styled lines with Pi's truncated plain tail after excluding the final empty line only when truncation occurred.
Why: Pi's truncateTail counts newline-terminated text without its trailing empty split element and drops that element when truncating; retaining it in the styled slice shifts the displayed tail by one line.
Coupled: components/tasks/src/user-bash.ts
Verify: components/tasks/tests/user-bash.test.ts
