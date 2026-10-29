## file

The query-only workplace reader is exercised against an isolated full-schema database and real task files. Its historical fixture supplies current reporting rows that place a completed contributor and the old head in another tree while keeping the task's recorded organization unchanged. It checks the reader's projection of that state, not the runtime operation that moved them. Repeated assignment rows distinguish unassignment from a later finished contribution; unknown legacy endings remain unknown. A focused live assignment is separate from completed history.
Why: filtering history by today's reporting tree or collapsing repeated assignments would erase whose work was recorded and confuse an unassignment with completion.

Snapshot assertions exclude private goal and outcome prose. The read action allows known historical IDs/bundles, rejects arbitrary paths, and leaves historical goals outside the live-only assignment action. Missing files, runtime closure overriding edited file status, existing metadata cache cadence, and unregistered backlog exclusion exercise the production reader rather than a parallel history model.

Coupled: apps/agent-world/src/backend/workplace.ts, apps/agent-world/src/backend/facts.ts, apps/agent-world/src/world.ts
Verify: apps/agent-world/tests/work-history.test.ts
