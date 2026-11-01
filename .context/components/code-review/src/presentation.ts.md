## symbol:sourceLines

The captured-file inventory's navigation hint names the TUI manager's source-selection action. Keep that hint aligned with the real action label and key when changing navigation.

Why: the inventory is rendered as plain evidence text, so a stale hint can direct the operator to a removed control while source loading itself still passes. The loaded-command test opens both a file and the inventory through the real action.

Coupled: components/code-review/src/review-manager.ts, components/code-review/src/panel.ts
Verify: components/session-state/tests/review-queue.test.ts
