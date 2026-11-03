## file

`session.reload()` emits `session_start` only after a host is bound. The first prompt writes the session file so it can be reopened.
Why: asserting reload before `bindExtensions` misses the start the production host receives.
Verify: components/session-state/tests/runtime.test.ts
