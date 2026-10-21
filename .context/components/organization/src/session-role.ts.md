## symbol:installSessionRole

The role resolves in a `session_start` handler that must be registered before the session-state bridge's own (`installSessionRole` is called first in `sessionStateBridge`): the bridge's hello reads `sessionRole(ctx)` for the `role` fact, and the manager tools reconcile on `manages` in the same event.
Why: Pi runs `session_start` handlers in registration order; a role resolved after the hello would never reach the runtime, since the bridge reports `role` only in the hello, and the directory would show the person unroled.

The role is stored as an `organization-role` custom entry in the session's own transcript, not in the state database, and the stored name wins over the `--role` flag.
Why: a reopen is `pi --session-id <id>` with no flag (the runtime passes `--role` only on a hire), and the transcript is the one record that follows the session through resume, fork, and a runtime whose database was deleted.

Posture (`writes: false` dropping `edit` and `write`) is applied at `session_start` and again at every `before_agent_start`.
Why: Pi restores the active tool set from the saved transcript after extensions load, so a session created before the role existed, or one whose user re-enabled a tool, would otherwise start a run with `edit` back.
Coupled: components/session-state/src/bridge.ts, components/session-state/src/coordinator.ts
Verify: components/organization/tests/roles.test.ts, components/session-state/tests/coordinator.test.ts
