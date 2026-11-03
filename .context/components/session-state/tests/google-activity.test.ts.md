## file

A stand-in `gws` on PATH answers each request from canned JSON, the way the real CLI prints it. Someone else replying updates the series; the same thing the operator would see keeps the same item.
Why: the test must not call the operator's Google account, and a reply must not look like a new item.
Verify: components/session-state/tests/google-activity.test.ts
