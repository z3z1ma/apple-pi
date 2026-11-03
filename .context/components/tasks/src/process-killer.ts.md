## symbol:killProcessTree

Unix sends SIGKILL to the process group, then to the pid if the group kill fails. Windows uses `taskkill /F /T`. A process that is already gone is ignored.
Why: cancelling a task must stop its children, and a race with natural exit must not surface as a cancellation failure.
Verify: components/tasks/tests/tasks.test.ts
