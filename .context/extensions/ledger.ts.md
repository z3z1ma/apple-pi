## symbol:recordHistory

`history.json` holds only `{ "sessions": [...] }`: the sessions with a transcript that touched the task. The session-state model gets its work links from the `ledger:session-linked` events instead, so it also sees sessions without a transcript and every touch over time.
Why: commit recording for history replay was removed when replay was shelved; the session links stayed as the bundle's own record of who worked on it.
Verify: tests/ledger-history.test.ts
