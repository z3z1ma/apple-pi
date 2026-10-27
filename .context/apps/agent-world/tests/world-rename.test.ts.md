## file

The departure fixture returns acceptance without changing membership, then pushes an explicit completion snapshot. Assertions use the built UI: permanent-removal wording, pending status, a still-present person before completion and removal without an inn entry afterward. The fixture's own snapshot values are setup, not evidence of UI behavior.
Why: a green assertion on mock state can survive an optimistic UI removal or a stale promise that the person can return. These cases verify presentation, not real runtime/process cleanup.
Coupled: apps/agent-world/web/overlay/places/retire.tsx, apps/agent-world/web/overlay/places/retire-state.ts
Verify: components/session-state/tests/departure-lifecycle.test.ts, apps/agent-world/tests/build.test.ts
