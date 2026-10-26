## file

Registering a workplace tool and making it active are separate steps. Every-person tools belong in `PERSON_TASK_TOOLS` as well as `installWork`; activation restores them on both session start and before an agent turn while preserving unrelated active tools.
Why: registration alone passes the loader surface check but can leave a tool unavailable to a running person's model after an explicit tool selection or role change. Faux-session calls and coordinator activation tests cover the runtime behavior that the loader alone cannot prove.
Inspection resolves a caller's current organization and scope before invoking the shared reader; the reader owns historical task and holder semantics. `org_work` renders those structured results without deriving a separate classification.
Why: current input authorization and historical observation answer different questions. Replacing the reader's event-time rules with today's roster can rewrite past views.
`org_fitness` keeps a root `Type.Object` with optional window/scenario fields and exactly-one-mode validation in execution. Native Pi Exec signatures inspect root properties; a root union would erase the tool's argument surface. Scenario preview captures one now for all relative origins. `predictions` belongs in the every-person activation set, separately from registration.
Why: a schema that validates direct calls can still become a zero-argument composition signature, and loader registration does not prove nonmanager activation. Native/faux-session proof does not establish composition-runtime execution.
Coupled: components/session-state/src/scenarios.ts, components/session-state/src/inspect.ts, components/session-state/src/work.ts, components/session-state/src/tree.ts
Verify: components/session-state/tests/work.test.ts, components/session-state/tests/coordinator.test.ts, tests/package-load.mjs
