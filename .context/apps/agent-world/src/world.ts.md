## file

RecruitRequest.brief is optional initial work, not the person's identity. Omitted/blank brief creates no task and uses an explicitly empty opening prompt; supplying a catalog role still permits automatic naming. Electron's explicit forwarding boundary must accept the absent value as well as a string.
Coupled: apps/agent-world/src/backend/lifecycle.ts, apps/agent-world/src/electron/main.ts
Verify: apps/agent-world/tests/add-person.test.ts

Creator specialization is optional on creation requests and nullable top-level metadata on both Character and DormantAgent. It is separate from role, soul and Self; the runtime owns immutable creation-time persistence, while this DTO only carries it. Older snapshots can omit it and older runtime columns read as null. Existing-person planning and wake preserve stored text rather than accepting a new specialization.
Why: specialization steers attention within the full role; editing the role, Self or reporting tree must not silently redefine that creation-time instruction. Both live and sleeping profiles need the same recorded value.
Coupled: apps/agent-world/src/org.ts, apps/agent-world/src/backend/world-backend.ts, apps/agent-world/src/backend/projection.ts, apps/agent-world/web/game/layout.ts
Verify: apps/agent-world/tests/profile.test.ts, apps/agent-world/tests/add-person.test.ts

Workplace workHistory is separate from the live tasks board. Its headquarters is the task's recorded organization ID, not a remapping through the current reporting tree. Participants represent assignment episodes, so one person may occur several times with distinct endings; finished participation is not the same fact as a completed task. Consumers grouping by current team members label that aggregation separately from recorded-team work.
Why: moving a person or merging teams must not silently transfer historical task ownership or turn an unassignment into a contribution claim. Snapshot history contains metadata only; goal bodies use the existing explicit readTask action.

Coupled: apps/agent-world/src/backend/workplace.ts, apps/agent-world/web/workplace-work-history.tsx, apps/agent-world/web/workplace-org-search-model.ts
Verify: apps/agent-world/tests/work-history.test.ts, apps/agent-world/tests/org-search.test.ts
