## file

Only the jar is kept from the 192 MB release archive. The archive checksum is verified before extraction with `tar`, and the extracted jar's checksum on every run.

Apalache's command line overrides the `.cfg` (`--init`, `--inv`), which lets inductive mode reuse the spec's own `.cfg` for constants while replacing Init and the invariants. A `.cfg` that Apalache reads must name INIT and NEXT (or SPECIFICATION), so a config generated only for constants gets them prepended. Every option must come before the `.tla` argument.

Apalache splits each invariant into its conjuncts and reports a violation by conjunct index, not by invariant name. `property` is set only when exactly one invariant was checked; the message quotes the broken conjunct from `violation1.tla`.

The outcome `ExecutionsTooShort` means no behavior reaches the requested length, so every behavior was checked: that is a `pass`. `NoError` at a length some behavior reaches is `incomplete`.

Inductive mode runs three checks, all with `--no-deadlock`: Init establishes the inductive invariant (length 0); one step from any state satisfying it preserves it (init = the invariant, length 1); and it implies the targets (length 0). A step-check counterexample starts from a state that may be unreachable, so the trace labels its first state that way. A `timeLimit` is one deadline shared by the three runs, enforced by killing Java, because Apalache has no overall time limit.
Why: an agent must not read a counterexample to induction as a reachable bug, nor a bounded `NoError` as a proof.

Coupled: components/tla/src/index.ts, skills/formal-verification/SKILL.md
Verify: components/tla/tests/apalache.test.ts
