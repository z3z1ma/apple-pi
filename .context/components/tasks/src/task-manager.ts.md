## file

Listener failures are isolated for prompt, monitor, change and finish notifications; remaining listeners still run.
Why: a view or callback failure must not prevent another consumer from observing managed work.

## symbol:reset

`reset` discards every task without a terminal notification because the owning session is ending.
Why: notifying an agent that is already gone would start work nobody can receive.
Verify: components/tasks/tests/tasks.test.ts
