## file

Registering a workplace tool and making it active are separate steps. Every-person tools belong in `PERSON_TASK_TOOLS` as well as `installWork`; activation restores them on both session start and before an agent turn while preserving unrelated active tools.
Why: registration alone passes the loader surface check but can leave a tool unavailable to a running person's model after an explicit tool selection or role change. Faux-session calls and coordinator activation tests cover the runtime behavior that the loader alone cannot prove.
Inspection resolves a caller's current organization and scope before invoking the shared reader; the reader owns historical task and holder semantics. `org_work` renders those structured results without deriving a separate classification.
Why: current input authorization and historical observation answer different questions. Replacing the reader's event-time rules with today's roster can rewrite past views.
Coupled: components/session-state/src/inspect.ts, components/session-state/src/work.ts, components/session-state/src/tree.ts
Verify: components/session-state/tests/work.test.ts, components/session-state/tests/coordinator.test.ts, tests/package-load.mjs
