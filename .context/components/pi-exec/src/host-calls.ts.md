## file

A settled call's worker detail is final; a late child-process update cannot reopen it. Nested tool calls go through Pi's `executeTool`, so validation, hooks, and nested usage stay on the `pi_exec` result. `attempted` counts every call the program attempted, including calls the call budget refused. `finish` settles calls still in flight and returns a detached copy of the trace.
Why: a late update would revive a finished call, and a shared trace array would change after the caller stored it.

Closing a peer is a control request: it still consumes call budget, but bypasses the work semaphore. Otherwise a running turn can hold the last slot while its own cancellation queues behind it. Invocation cleanup also runs outside the semaphore and completes before the final trace and usage snapshot.

Coupled: components/pi-exec/src/peer-calls.ts, components/pi-exec/src/index.ts
Verify: components/pi-exec/tests/peer-calls.test.ts
