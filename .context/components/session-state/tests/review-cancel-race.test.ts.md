## file

This is the executable translation of the six-state ReviewLifecycle TLC counterexample. It forks the actual Runtime with its ordinary TypeScript registration, real socket commands, temporary SQLite stores and an actually captured/verified Git artifact. Starting Runtime inside Vitest reached the defect but left the transcript worker without the registration it inherits from the daemon entry; the registered child removes that unrelated loader failure.

The fixture controls scheduling, not cancellation results: both actual waitCleanup calls must find a recorded previous-reviewer program scope and reach their own polling timers. The test removes that scope, releases the first timer, authorizes additional work through the public revision/digest-bound extend command, then releases the second timer. These are independent timers whose expiration can straddle an intervening socket command. Before the generation guard, the second old completion cancelled generation 2; the assertion requires the newly queued generation to survive. The old request still receives an applied receipt for its now-superseded cancellation.

The queue wake is suppressed in the child so it represents a busy worker and never launches a reviewer or paid model. The previous attempt/scope is seeded and the scope removal represents successful cleanup; this test proves the command-state race, not actual peer cleanup, semantic review quality or live activation. Child stderr is checked before the final state assertion. Teardown waits for the owned child to exit and removes only its temporary directory.

Coupled: specs/review-lifecycle.tla, components/session-state/tests/fixtures/review-cancel-runtime.ts, components/session-state/src/review-jobs.ts
Verify: components/session-state/tests/review-cancel-race.test.ts
