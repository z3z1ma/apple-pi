## file

ReviewWait is a liveness model: under its stated fairness a waiting `read_review` always returns, and switching off either the silence watchdog or SIGKILL escalation must produce a temporal violation (the controls keep the pass meaningful). Its implementation evidence is `review-silence.test.ts` (the watchdog) and the unresponsive-peer case in `program-peers.test.ts` (escalation), which failed at the commit before the change.

The other two are bounded source-derived safety models, not implementation-refinement or liveness proofs. ReviewLifecycle models two independent cancellation requests crossing one additional-work admission. DepartureLifecycle models one permanent identity, a known original writer and one rejected late writer, optional handoff, one new obligation/incarnation, unknown process observations, transcript headers, independent file/SQLite completion and repeated crashes/restarts. Model comments and the experiment log state the action mappings and exclusions.

The actual-runtime review-cancel-race regression is the implementation oracle for the discovered review trace; these TLC runs alone cannot establish the fix works in code.
Why: the CLI checks handwritten TLA+ input, not TypeScript, so retaining both tests prevents model success from being mistaken for implementation coverage. Departure produced no safety counterexample in its finite state space, so no trace-derived implementation test exists for that model. Existing focused departure controls provide separate behavioral evidence and do not certify every modeled transition.

The historical pre-fix review model and its trace live in the task bundle as experiment evidence. This test runs only current source-derived models. The model specs under `specs/` are apple-pi repository content and do not ship in the package.

CapabilityCandidate (design model of the steward's protocol) and ProgramComparison (derived from `compare.ts` as built) each keep a control that must violate a named property; the Lean file's theorems are checked by name.

Coupled: specs/capability-candidate.tla, specs/program-comparison.tla, specs/program-comparison.lean, specs/review-wait.tla, specs/review-wait.cfg, specs/review-lifecycle.tla, specs/review-lifecycle.cfg, specs/departure-lifecycle.tla, specs/departure-lifecycle.cfg, components/formal-verification/src/tlc.ts, components/session-state/tests/review-cancel-race.test.ts
Verify: tests/lifecycle-models.test.ts
