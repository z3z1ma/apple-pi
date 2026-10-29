## file

The file-list root is the selected canonical directory, and paths are relative to it even for a repository subdirectory. Worktree discovery instead returns the canonical current Git worktree top-level; each listed worktree path is absolute. Opening a listed root is a separate UI selection, not Git checkout. Git status/diff keep their existing strict top-level requirement.

Locked/prunable are optional reason strings, not booleans: property presence signals the flag, including an empty reason. Bare and detached are independent facts; null branch alone cannot distinguish them. A listed prunable path may no longer exist and a bare entry has no editable working files. File discovery includes only actual regular files and never reads their contents.
Reference batches carry candidate strings plus optional explicit source cwd, never the currently selected Code root. Results identify each distinct valid candidate with a canonical root and canonical target-relative path; unresolved candidates are omitted. Conventional ~/ expansion belongs to the backend; colon/location parsing belongs to the renderer so an existing literal filename can win over a stripped location alternative. Resolution is metadata-only and does not guarantee the later content read succeeds.
Why: root confusion opens the wrong file, and truthiness checks silently hide a lock with no reason. Discovery must not imply filesystem availability or permission to mutate Git state.
Coupled: apps/agent-world/src/backend/workspace.ts, apps/agent-world/src/electron/main.ts, apps/agent-world/src/electron/preload.ts
Verify: apps/agent-world/tests/workspace-backend.test.ts
