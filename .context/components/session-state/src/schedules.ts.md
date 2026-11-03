## file

A schedule is mail the runtime sends on time, once or repeatedly, and it survives restarts. Each firing is an ordinary post on the schedule's own thread. The owner or recipient can cancel it; the operator can cancel any. A one-time schedule ends when it fires. A repeating schedule moves to its next time after now and skips firings missed while the runtime was down.
Why: replaying every missed firing at startup would deliver a burst nobody asked for.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/threads.ts
Verify: components/session-state/tests/on-call.test.ts
