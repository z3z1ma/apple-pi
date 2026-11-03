## file

`ENVELOPE_TOOL_NAMES` (`bash`, `edit`, `write`) report failure to the program as `{ ok: false, output }` instead of raising. `coreToolDefinition` uses Pi's own definition for signatures and for calls Pi cannot run because the tool is inactive.
Why: those three tools are the program's own failure channel; an inactive core tool still needs Pi's signature when the host runs it.
Verify: components/pi-exec/tests/pi-exec.test.ts
