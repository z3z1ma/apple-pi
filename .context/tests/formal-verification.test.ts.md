## file

The fault variants are disposable inputs to the public TLC runner. Their exact source anchors only ensure the intended faulty input was constructed; they are not an implementation contract for the production journal. Keep each variant distinct from the checked-in model and require a nonzero exit, the intended named violation and a counterexample trace. A parser error or missing Java is not a successful failure control.
Why: positive model completion alone would remain green if the runner swallowed TLC violations. Conversely, a deliberately broken model is evidence that the checking path rejects it, not a finding against runtime code or a refinement proof.

Coupled: scripts/run-tlc.mjs, specs/command-journal.tla, specs/command-journal.cfg
Verify: tests/formal-verification.test.ts
