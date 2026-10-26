## file

The initial registered tool is unprivileged. Role resolution can occur after pi_exec's session-start hook, so reconcile role-specific parameters again before the agent turn. Keep the code parameter's description live with the selected peer capability. This affects model-facing context, not the independent peer-calls host guard.
Why: Pi loads these extensions in separate module graphs, and a new role's transcript entry may not exist when pi_exec first registers. The session-role reader supplies the recorded role across those graphs.

Supply managing-role guidance through the existing `setSystemPromptSection(event.systemPromptOptions, ...)` helper. Re-registering tool metadata during `before_agent_start` changes active schemas but does not by itself update the first prompt's already-assembled tool guidance. SDK tests inspect both active parameters and the first system prompt, with an empty `onError` channel; faux provider request contexts do not contain tool declarations.
Why: a schema-only assertion can pass while a managing session never receives ordinary peer-use guidance.

Saved-program schemas inherit the same role-appropriate limits. Keep limits identity stable between capability changes; saved-program registration observes that identity to refresh at the role boundary rather than rescanning scripts or changing schemas every turn.
Why: new managers must receive peer budget controls in their saved tools too, while unrelated turns should preserve stable tool definitions and prompt caching.
Coupled: components/organization/src/session-role.ts, components/pi-exec/src/guest-api.ts, components/pi-exec/src/peer-calls.ts, components/pi-exec/src/saved-programs.ts
Verify: components/organization/tests/roles.test.ts, tests/pi-exec-work-panel.test.ts, components/pi-exec/tests/saved-programs.test.ts
