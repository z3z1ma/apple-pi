## symbol:Runtime.takeLock

The single-runtime guarantee is an exclusive SQLite lock held for the runtime's whole life, not a pid file. The pid file only tells tests and people which process to stop.
Why: a pid lock file has a window between create and write that let two runtimes both start; the OS releases an SQLite exclusive lock on any exit, including SIGKILL, so there is no stale lock to reclaim.
Verify: components/session-state/tests/singleton.test.ts

## symbol:Runtime.setRunState

Only the connection of the session's current generation may change its run state; messages from a superseded process are dropped.
Why: an old process that is still connected would otherwise overwrite the new incarnation's activity and stamp its events with the new generation.
Verify: components/session-state/tests/liveness.test.ts

## symbol:Runtime.checkLiveness

Liveness covers every incarnation whose process state is still alive or alive with the bridge lost, including ended (superseded) ones, and only a proven-gone process ends as `lost`; a failed check stays `alive_bridge_lost`.
Why: filtering on `ended_at` left superseded incarnations reading as alive forever after their process died, and treating a failed `ps` as death permanently ended live sessions.
Verify: components/session-state/tests/liveness.test.ts
