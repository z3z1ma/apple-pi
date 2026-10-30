## file

The comparison models sequential requests from two still-valid viewer identities. Retain the repeat-hit observation and perform logout clearing only after the compared request sequence.
Why: correct output alone also permits cache bypass, and clearing between viewers would remove the counterexample that invalidated the seeded logout-only proposal. This fixture tests neither parallel scheduling nor changing permissions; exercises.md owns the actual decision provenance and limits.
Coupled: .ledger/history/202610301415-first-class-organizational-process-skills/exercises.md, .ledger/history/202610301415-first-class-organizational-process-skills/decision-probe-results.json
Verify: .ledger/history/202610301415-first-class-organizational-process-skills/decision-probe.mjs
