## file

A schedule is mail the runtime sends on time, once or repeatedly, and it survives restarts. Each firing is an ordinary post on the schedule's own thread. The owner or recipient can cancel it; the operator can cancel any. A one-time schedule ends when it fires. A repeating schedule moves to its next time after now and skips firings missed while the runtime was down.
Why: replaying every missed firing at startup would deliver a burst nobody asked for.

A schedule may name an open task: each firing then carries a fresh snapshot of that task (holders and their state, last update) after the body, and the schedule stops without firing once the task closes. Scheduled mail wakes its recipient even when not on call: a schedule is an explicit request to be woken at that time (operator, 2026-11-07, task check-ins).
Coupled: components/session-state/src/runtime.ts, components/session-state/src/threads.ts
Verify: components/session-state/tests/on-call.test.ts
