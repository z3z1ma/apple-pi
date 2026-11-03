## file

Reviews this process is waiting on, or has waited out, still get milestone mail in the transcript, but as a short pointer, because the wait result already carries the outcome. Milestone message IDs are `review:<review>:<generation>:<milestone>`. Comments from people are never covered.
Why: the in-process registry is lost on restart, which then delivers the full mail again. A person's comment must not be turned into that pointer.
Coupled: components/session-state/src/bridge.ts, components/code-review/src/tools.ts
Verify: components/session-state/tests/review-queue.test.ts
