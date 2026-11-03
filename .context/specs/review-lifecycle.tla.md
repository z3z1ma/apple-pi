## file

This model isolates cancellation completion across additional-work admission, not the entire review engine. Cancellation identities are admitted once, retain the generation they observed, and settle without being reused. The historical failing model and its once-per-identity trace remain in the experiment bundle; current execution checks the source's generation-bound no-op.
Why: resetting a settled pending slot to its initial value silently creates another request under the same identity, unlike the runtime command journal's exact retry behavior. The confirmed six-state trace did not depend on that extra behavior.

Cleanup success and target/owner/revision authorization are preconditions at this boundary. The model does not establish those guards, reviewer execution, receipt recovery, refinement or liveness. Changes to the production cancellation guard require updating this model and running the actual-runtime regression; TLC alone does not check TypeScript.

Coupled: specs/review-lifecycle.cfg, components/session-state/src/review-jobs.ts, components/session-state/tests/review-cancel-race.test.ts
Verify: tests/lifecycle-models.test.ts, components/session-state/tests/review-cancel-race.test.ts
