## symbol:openReviews

These are on-demand operator views over a read-only database. Every mutation still belongs to the session-state runtime.
Why: a second writer would race the runtime's review journal.
Coupled: components/session-state/src/review-read.ts, apps/agent-workplace/src/reviews.ts
Verify: apps/agent-workplace/tests/reviews-backend.test.ts
