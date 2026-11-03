## symbol:reset

`reset` discards every task without a terminal notification because the owning session is ending.
Why: notifying an agent that is already gone would start work nobody can receive.
Verify: components/tasks/tests/tasks.test.ts
