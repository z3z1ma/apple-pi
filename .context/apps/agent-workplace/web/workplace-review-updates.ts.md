## file

The Reviews rail badge counts reviews whose current state differs from the state the operator last saw. It polls `reviews.states` (id and state only, scoped like the queue) every two seconds while the runtime is connected, so the badge works before the Reviews app is ever opened. Seen states live in localStorage under `workplace-reviews-seen`; ids that no longer exist are pruned. With no stored map (first run on this device), every current state is recorded as seen, so the operator starts at zero instead of every historical review. After that, a review with no seen entry is new and counts.
Why: the operator asked for a count of reviews with any state transition. "Seen" is a device-local reading habit like the other Workplace preferences, not organization state, so it needs no runtime record.

Given the current workspace's members, the badge counts only reviews whose requester or owner is a member, and Mark all seen marks only those; other workspaces keep their unseen states.

The state read is wrapped in a promise chain so a missing or failing API counts as no updates rather than an uncaught error.
Coupled: apps/agent-workplace/web/workplace.tsx, apps/agent-workplace/web/workplace-reviews.tsx, apps/agent-workplace/src/reviews.ts, components/session-state/src/review-read.ts
Verify: apps/agent-workplace/tests/world-reviews.test.ts
