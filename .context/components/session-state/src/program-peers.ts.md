## file

Creation ancestry, not the reporting tree, determines temporary ownership. A transfer can move a temporary person without freeing it from the program; a lasting person moved under it stays lasting and moves to the nearest surviving ancestor on disposal.

Keep a `program_peers` row until process and task-file cleanup succeeds. Person rows can disappear earlier. The work journal records bundle paths before deletion, so a daemon crash between the database commit and filesystem cleanup remains recoverable; scope completion can still see the ownership row. Shared tasks (including historical lasting assignees) and promoted ledger tasks survive. Pi transcript files remain outside this cleanup.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/work.ts, components/session-state/src/schema.ts
Verify: components/session-state/tests/program-peers.test.ts
