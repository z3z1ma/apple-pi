## file

This fixture is only a scheduler for the real child Runtime. Both cancellation handlers must actually observe an existing program scope and enter waitCleanup before the parent removes that scope. IPC releases their independent polling timers around an intervening public extend command; cancellation outcomes, artifact verification and database mutations remain production code. The stack-name/RETRY_MS match is deliberately coupled to that scheduling seam, not a product assertion.
Why: an ordinary sleep would make the reproducing interleaving load-dependent, while returning fake cancellation results would merely reproduce the abstract model instead of testing the runtime.

Queue wake is suppressed to represent a busy queue without starting reviewer/model work. Program cleanup is represented by the parent removing the seeded scope; this fixture does not establish actual peer teardown. Keep the ordinary register.mjs bootstrap when forking: the runtime's transcript worker needs its inherited loader as well as the entry module.

Coupled: components/session-state/tests/review-cancel-race.test.ts, components/session-state/src/review-jobs.ts, components/session-state/src/register.mjs
Verify: components/session-state/tests/review-cancel-race.test.ts
