## file

The migration fixture retains its version27 surviving-join/coverage-boundary scenario. historical-schema.ts removes later physical fields/index before lowering user_version, so forward migration cannot fail on already-existing later columns. New migration support keeps the original unknown-prehistory and replay assertions rather than inferring missing audience facts.
Coupled: components/session-state/tests/historical-schema.ts, components/session-state/src/schema.ts
Verify: components/session-state/tests/participation.test.ts
