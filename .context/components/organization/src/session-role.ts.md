## symbol:sessionRole

Pi's real extension loader isolates module caches. A role resolved by session-state is therefore not automatically cached in another extension's copy of this module (the peer tools in `components/programs`). Honor a local resolved value, including explicitly unroled; when this copy has no entry, resolve and cache the existing transcript role name against the catalog, just as startup does. An absent transcript role stays unseen so the first start can still finish recording it; a stored but unknown role stays unroled until reload. Catalog edits take effect at reload, not halfway through a turn. The transcript remains the authority across extension graphs, without another role store or a global cache.
Why: direct-import or Vitest-spy tests can pass while real loaded manager calls are all denied.
Coupled: components/organization/src/install.ts, components/programs/src/peers.ts
Verify: components/organization/tests/roles.test.ts, components/programs/tests/programs.test.ts

## symbol:installSessionRole

The role resolves in a `session_start` handler that must be registered before the session-state bridge's own (`installSessionRole` is called first in `sessionStateBridge`): the bridge's hello reads `sessionRole(ctx)` for the `role` fact, and the manager tools reconcile on `manages` in the same event.
Why: Pi runs `session_start` handlers in registration order; a role resolved after the hello would never reach the runtime, since the bridge reports `role` only in the hello, and the directory would show the person unroled.

The role is stored as an `organization-role` custom entry in the session's own transcript, not in the state database, together with the soul drawn (`soul.ts`, three random articles fetched from Wikipedia, no model call) at that first start; the stored name wins over the `--role` flag, and a later start reads the stored soul rather than drawing again. A start whose draw fails stores the role and selected mind, and the next start draws; a stored soul without fragments (the older list soul) is drawn again.
Why: a reopen is `pi --session-id <id>` with no flag (the runtime passes `--role` only on a hire), and the transcript is the one record that follows the session through resume, fork, and a runtime whose database was deleted. A redraw on reopen would change who the person is; two people in one role are told apart by soul.

The actual model and effective thinking level are retained in the same entry after successful selection, including the current default when no concrete recommendation can be selected. A stored mind bypasses profile loading, so profile edits and pool rotation affect new people rather than changing existing people on reopen. Older role-only entries select once and append their mind. Configured-profile and retained-mind failures abort before a run, rather than using concrete recommendations or the session's previous model. Pi catches lifecycle-handler exceptions, so the failure also calls `ctx.abort()` at `before_agent_start`; a provider may still receive an already-aborted signal and must honor it.
Why: a person that already worked on the default has a mind too; leaving it unrecorded would let a later profile addition change that person. Throwing alone cannot enforce failed selection because Pi catches lifecycle-handler errors and would otherwise continue on the previous model.
Coupled: components/shared/src/model-profiles.ts

A model or thinking level chosen after the role resolved (`model_select` other than `restore`, or `thinking_level_select`) is appended as the person's new mind, so a reopen keeps it. Selections made while the role applies its own mind at start happen before `resolved` is set and are not recorded twice.
Why: the operator moved the live coordinator to Terra through the runtime's `set_model`; a reload restored the stored Sol mind because only first selection was ever recorded.

A launcher can pass `--role-profile` to select a new person's first mind from another inference profile; captured review uses it for deep passes. It applies only to a role whose models start with a profile and only before a mind is stored, so it changes no existing person and never makes a concrete-only role read the profile file.
Why: the review runtime records each pass's policy (deep or balanced profile) and refuses a reviewer whose selected model is not in it. Without the override the resolver always chose from the role's own profile, so every deep pass failed before its turn; the first paid review after depth tiers failed that way.
Coupled: components/session-state/src/review-attempt.ts, components/session-state/src/runtime.ts, components/code-review/src/policy.ts
Verify: components/organization/tests/roles.test.ts, components/session-state/tests/review-queue.test.ts

A dispatching role (`dispatches: true`) also drops `bash`, `codemode`, `search_branches` and `monitor`, keeping reading, interns, communication and management. Delegation is enforced by the tool set because prompt-only delegation fails: DeepSeek's ablation saw a neutral-prompt main session delegate in 0 of 5 runs.

Posture (`writes: false` dropping `edit` and `write`) is applied at `session_start` and again at every `before_agent_start`.
Why: Pi restores the active tool set from the saved transcript after extensions load, so a session created before the role existed, or one whose user re-enabled a tool, would otherwise start a run with `edit` back.
Coupled: components/session-state/src/bridge.ts, components/session-state/src/coordinator.ts
Verify: components/organization/tests/roles.test.ts, components/session-state/tests/coordinator.test.ts
