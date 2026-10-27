## symbol:sessionRole

Pi's real extension loader isolates module caches. A role resolved by session-state is therefore not automatically cached in pi_exec's copy of this module. Honor a local resolved value, including explicitly unroled; when this copy has no entry, resolve and cache the existing transcript role name against the catalog, just as startup does. An absent transcript role stays unseen so the first start can still finish recording it; a stored but unknown role stays unroled until reload. Catalog edits take effect at reload, not halfway through a turn. The transcript remains the authority across extension graphs, without another role store or a global cache.
Why: direct-import or Vitest-spy tests can pass while real loaded manager calls are all denied. The work-panel fixture loads a real role installer through Pi's loader and checks managing-role and unroled-root execution and working-role rejection before any program scope or person is created.
Coupled: components/organization/src/install.ts, components/pi-exec/src/peer-calls.ts
Verify: tests/pi-exec-work-panel.test.ts, components/organization/tests/roles.test.ts

## symbol:installSessionRole

The role resolves in a `session_start` handler that must be registered before the session-state bridge's own (`installSessionRole` is called first in `sessionStateBridge`): the bridge's hello reads `sessionRole(ctx)` for the `role` fact, and the manager tools reconcile on `manages` in the same event.
Why: Pi runs `session_start` handlers in registration order; a role resolved after the hello would never reach the runtime, since the bridge reports `role` only in the hello, and the directory would show the person unroled.

The role is stored as an `organization-role` custom entry in the session's own transcript, not in the state database, together with the soul drawn (`soul.ts`, three random articles fetched from Wikipedia, no model call) at that first start; the stored name wins over the `--role` flag, and a later start reads the stored soul rather than drawing again. A start whose draw fails stores the role alone, and the next start draws; a stored soul without fragments (the older list soul) is drawn again.
Why: a reopen is `pi --session-id <id>` with no flag (the runtime passes `--role` only on a hire), and the transcript is the one record that follows the session through resume, fork, and a runtime whose database was deleted. A redraw on reopen would change who the person is; two people in one role are told apart by soul.

Posture (`writes: false` dropping `edit` and `write`) is applied at `session_start` and again at every `before_agent_start`.
Why: Pi restores the active tool set from the saved transcript after extensions load, so a session created before the role existed, or one whose user re-enabled a tool, would otherwise start a run with `edit` back.
Coupled: components/session-state/src/bridge.ts, components/session-state/src/coordinator.ts
Verify: components/organization/tests/roles.test.ts, components/session-state/tests/coordinator.test.ts
