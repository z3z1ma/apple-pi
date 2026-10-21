## symbol:factRows

The Record row lists `facts.tasks` (the session's `session_tasks`, newest first) minus the task it holds now, matched by the current task's bundle basename.
Why: the runtime records a task by its `task_id`, which is the bundle directory's name, while the current task fact carries the bundle path; the card shows the held task on its own row, so repeating it in the record would read as two tasks.
Coupled: apps/agent-world/src/backend/facts.ts, components/session-state/src/schema.ts
Verify: apps/agent-world/tests/world-interface.test.ts
