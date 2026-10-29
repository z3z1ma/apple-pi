## file

All filesystem and Git mutation is isolated under a temporary repository; these tests never edit a real project or connect to session-state. The partial node:fs mock replaces only fsyncSync with a configurable wrapper to schedule a real source-file replacement between temporary write and final save validation. Spying directly on the native ESM namespace is unsupported. The production implementation has no test-only callback.

Coverage checks nested lazy entries, BOM/CRLF text preservation, returned save hash, executable mode retention, stale/intervening-save refusal without visible directory debris, path/symlink/metadata/binary refusal, literal bracket filenames in Git diffs, Git staged/unstaged/untracked/rename/detached semantics and unchanged index, manual-subdirectory refusal, discovery and public IPC payload shapes. It does not prove real Electron IPC/preload, native unload confirmation, browser drafts, or protection against an external write in the final check/rename race.
Why: cleanup is observable through the public tree, not an internal temporary filename convention. Brackets in the real Git filename distinguish literal path handling from an accidentally expanded pathspec; an ordinary filename would pass both implementations.
Coupled: apps/agent-world/src/backend/workspace.ts, apps/agent-world/src/workspace.ts
Verify: apps/agent-world/tests/workspace-backend.test.ts
