## file

This is a paid, metadata-only classification exercise, not an automated skill-execution test. Its default model and catalog come from the current environment, so preserve the committed selection-results.json before an intentional rerun and qualify any new result separately from the recorded 18/18 run.
Why: implementation-evidence.md cites the original model, answers and cost; the script writes that report path after each answer, while future default models and skill descriptions can differ. A fresh classification result cannot silently replace the evidence for the original selection result.

The scratch lifetime includes settings loading and model-runtime construction, not only provider calls.
Why: a missing isolated settings.json failed before the old try/finally and left a process-selection-* directory behind. Cleanup must also cover setup failures that send no model request.
Coupled: .ledger/history/202610301415-first-class-organizational-process-skills/implementation-evidence.md, .ledger/history/202610301415-first-class-organizational-process-skills/selection-results.json
