## file

The database is the exclusive lock the runtime holds for its whole life; the OS frees it on exit. The pid file is written after that lock. The log is the runtime's stdout and stderr. The transcript index stays apart from the runtime database. A leading `~` in `PI_CODING_AGENT_DIR` means the home directory. Paths are read at call time so tests can redirect them.
Why: a pid file taken before the lock let two runtimes start, and a path read at import time would ignore a test's redirect.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/runtime-main.runtime.ts
Verify: components/session-state/tests/singleton.test.ts
