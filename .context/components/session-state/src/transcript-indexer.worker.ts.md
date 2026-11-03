## file

This worker is the transcript index's only writer. Each message names a session and its transcript file. The worker updates that session's rows, one session at a time, and coalesces repeated requests for a session that is already waiting.
Why: two writers, or two updates of the same session at once, would race the index rows.
Coupled: components/session-state/src/transcript-index.hot.ts
Verify: components/session-state/tests/transcript-index.test.ts
