## file

Workplace workHistory is separate from the live tasks board. Its headquarters is the task's recorded organization ID, not a remapping through the current reporting tree. Participants represent assignment episodes, so one person may occur several times with distinct endings; finished participation is not the same fact as a completed task. Consumers grouping by current team members label that aggregation separately from recorded-team work.
Why: moving a person or merging teams must not silently transfer historical task ownership or turn an unassignment into a contribution claim. Snapshot history contains metadata only; goal bodies use the existing explicit readTask action.

Coupled: apps/agent-world/src/backend/workplace.ts, apps/agent-world/web/workplace-work-history.tsx, apps/agent-world/web/workplace-org-search-model.ts
Verify: apps/agent-world/tests/work-history.test.ts, apps/agent-world/tests/org-search.test.ts
