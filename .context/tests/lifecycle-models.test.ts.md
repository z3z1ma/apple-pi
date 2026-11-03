## file

These are bounded source-derived safety models, not implementation-refinement or liveness proofs. ReviewLifecycle models two independent cancellation requests crossing one additional-work admission. DepartureLifecycle models one permanent identity, a known original writer and one rejected late writer, optional handoff, one new obligation/incarnation, unknown process observations, transcript headers, independent file/SQLite completion and repeated crashes/restarts. Model comments and the experiment log state the action mappings and exclusions.

The actual-runtime review-cancel-race regression is the implementation oracle for the discovered review trace; these TLC runs alone cannot establish the fix works in code. Departure produced no safety counterexample in its finite state space, so no trace-derived implementation test exists for that model. Existing focused departure controls provide separate behavioral evidence and do not certify every modeled transition.

The historical pre-fix review model and its trace live in the task bundle as experiment evidence. This test runs only current source-derived models. The model specs under `specs/` ship in the package with the runner; only these Vitest checks are checkout-only.

Coupled: specs/review-lifecycle.tla, specs/review-lifecycle.cfg, specs/departure-lifecycle.tla, specs/departure-lifecycle.cfg, scripts/run-tlc.mjs, components/session-state/tests/review-cancel-race.test.ts
Verify: tests/lifecycle-models.test.ts
