## file

The file-list root is the selected canonical directory, and paths are relative to it even for a repository subdirectory. Worktree discovery instead returns the canonical current Git worktree top-level; each listed worktree path is absolute. Opening a listed root is a separate UI selection, not Git checkout. Git status/diff keep their existing strict top-level requirement.

Locked/prunable are optional reason strings, not booleans: property presence signals the flag, including an empty reason. Bare and detached are independent facts; null branch alone cannot distinguish them. A listed prunable path may no longer exist and a bare entry has no editable working files. File discovery includes only actual regular files and never reads their contents.
Why: root confusion opens the wrong file, and truthiness checks silently hide a lock with no reason. Discovery must not imply filesystem availability or permission to mutate Git state.
Coupled: apps/agent-world/src/backend/workspace.ts, apps/agent-world/src/electron/main.ts, apps/agent-world/src/electron/preload.ts
Verify: apps/agent-world/tests/workspace-backend.test.ts
