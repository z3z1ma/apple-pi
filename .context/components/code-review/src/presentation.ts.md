## file

`resultLabel` names confirmed findings and is never a pass/fail verdict. Captures from before labels carry only their ref, which the row already shows. `perLabel` is unknown when the total or every observation is unknown. `unreportedLabel` says how many attempts have no cost observation, so a total is a lower bound. Progressive evidence keeps its field names, including uncertainty and provenance.
Why: a glanceable outcome must not become the operator's sign-off, and a missing cost observation must not look like zero.

## symbol:sourceLines

The captured-file inventory's navigation hint names the TUI manager's source-selection action. Keep that hint aligned with the real action label and key when changing navigation.

Why: the inventory is rendered as plain evidence text, so a stale hint can direct the operator to a removed control while source loading itself still passes. The loaded-command test opens both a file and the inventory through the real action.

Coupled: components/code-review/src/review-manager.ts, components/code-review/src/panel.ts
Verify: components/session-state/tests/review-queue.test.ts
