## file

Creation ancestry, not the reporting tree, determines temporary ownership. A transfer can move a temporary person without freeing it from the program; a lasting person moved under it stays lasting and moves to the nearest surviving ancestor on disposal.

Keep a `program_peers` row until process and task-file cleanup succeeds. Person rows can disappear earlier. The work journal records bundle paths before deletion, so a daemon crash between the database commit and filesystem cleanup remains recoverable; scope completion can still see the ownership row. Shared tasks (including historical lasting assignees) and promoted ledger tasks survive. Pi transcript files remain outside this cleanup.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/work.ts, components/session-state/src/schema.ts
Verify: components/session-state/tests/program-peers.test.ts

The disposal transaction emits an event for each surviving person's manager change and each deleted person. The deletion event survives the person row. Incremental readers evict an event-named id with no remaining root row, rather than waiting for a full reread.
Why: updating only rows returned by a changed-row query retained deleted temporary peers at the inn, and a sleeping lasting report kept its old manager until the full refresh.
Coupled: apps/agent-world/src/backend/world-backend.ts
Verify: apps/agent-world/tests/workplace-disposal.test.ts
