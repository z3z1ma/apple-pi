## symbol:ReviewsApi

`around` asks for the page that holds that review, so a live reorder does not change the selection.
Why: queue order changes while the operator is looking at one review; paging by offset alone would jump away from it.
Coupled: apps/agent-workplace/src/backend/reviews.ts
Verify: apps/agent-workplace/tests/reviews-backend.test.ts
