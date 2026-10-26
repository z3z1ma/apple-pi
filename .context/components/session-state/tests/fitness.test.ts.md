## file

Focus-history fixtures apply `changeWork` and `postToThread` in one transaction, using the runtime's `<command_id>:post` identity. Their timestamps establish the historical estimate; today's focus is deliberately insufficient. Apply task commands while the task is live, then record later cancellation as the current outcome that annotates earlier spend.
Why: hand-building only a focus row would bypass the production history contract, while pre-seeding a future `archived_at` makes take/assign reject the task as already finished. The adapter's results, rather than query shapes, must prove attribution, unchanged totals and unattributed unknown history. The missing-post case proves only that a missing retained pair is not replaced by today's focus; it does not certify recovery or detection of arbitrary deleted transitions.
Coupled: components/session-state/src/fitness.ts, components/session-state/src/work.ts, components/session-state/src/runtime.ts, components/session-state/src/threads.ts
Verify: components/session-state/tests/fitness.test.ts, components/session-state/tests/work.test.ts
