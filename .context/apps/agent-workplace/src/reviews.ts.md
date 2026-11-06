## file

ReviewAttemptRow includes the reader's reviewer union: temp, or worker with the original worker ID/name. The attempt ID identifies the disposable peer's attempt, not that lasting worker. Backend read forwards the shared projection without another DTO mapping.
Coupled: components/code-review/src/results.ts, components/session-state/src/review-read.ts
Verify: components/session-state/tests/review-workers.test.ts

## symbol:ReviewsApi

`states` returns only each visible review's id, state, requester and owner, for the rail badge's frequent poll; the queue builds full summaries and is too heavy to read every two seconds for every review. Requester and owner let the badge count only the current workspace's reviews; `queue`'s `people` filter keeps a review when its requester or owner is one of them (the workspace's members).

`around` asks for the page that holds that review, so a live reorder does not change the selection.
Why: queue order changes while the operator is looking at one review; paging by offset alone would jump away from it.
Coupled: apps/agent-workplace/src/backend/reviews.ts
Verify: apps/agent-workplace/tests/reviews-backend.test.ts
