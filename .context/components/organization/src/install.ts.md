## file

A root session gets its role, the `<org>` section, and, for a managing role, the `<manager>` charter. Managing roles and unroled recorded roots hold management capabilities.
Why: an unroled person manages only as a recorded organization root; a role, not the absence of a manager, is what grants management to everyone else.

`managerOf` is null for a recorded root and undefined before the runtime records the person. `installOrganization` skips reflection when `reflects` is false, including a program's temporary peer.
Why: null is a recorded fact; undefined is an unread record. A temporary peer has no future to carry a self into.

Creator specialization is separate from the catalog role, soul and self. The role still controls tools, model and management capabilities. The specialization section reads the immutable runtime record through specializationOf, using the same old-schema compatibility guard as other organization metadata. There is no specialization edit tool, launch flag, role rewrite or second transcript store.
Why: a focused hire retains every role obligation; creator instruction must not become a replacement role or be mistaken for an agent's editable self. Database-only persistence is deliberate, matching the runtime-owned creation fact.
Coupled: components/organization/src/directory.ts, components/organization/src/session-role.ts, components/session-state/src/runtime.ts, components/session-state/src/schema.ts
Verify: components/session-state/tests/specialization.test.ts, components/organization/tests/roles.test.ts
