## file

Code uses local filesystem authority only on explicit renderer requests. Repository discovery reads current/dormant cwd metadata and probes Git roots; it changes no workplace facts. Manual absolute directory roots are intentional operator-selected authority, unlike transcript file links. Paths must stay within that root after realpath resolution; Git metadata is excluded. The lazy tree does not apply Git ignores and has no result cap. Only existing regular UTF-8 files can be saved; symlink files must be opened through their actual target path.

Save is optimistic concurrency, not a cross-process lock: the original byte hash must still match, and path/inode/device/mode/hash are checked again immediately before atomic replacement. There remains a check/rename race against noncooperating editors; this is an accepted limit, not an atomic compare-and-swap guarantee. A unique same-directory temporary file preserves mode, is fsynced, and is removed on refusal. Explicit Save is the only write method. Binary or invalid UTF-8 files are refused without truncation; BOM and line endings remain in the text.

Git commands use argument arrays, disable pager, external diff/textconv, fsmonitor and optional locks, and clear inherited GIT_* repository overrides. Git status/diff require the actual repository top-level because porcelain paths are always relative to that root. A manual subdirectory stays browsable/editable but Git returns the required root rather than passing incorrectly based paths to the editor. Rename records consume the second NUL-delimited path; filenames never pass through a shell or implicit pathspec patterns.

Why: agents and the operator share the same files; stale-buffer rejection protects ordinary concurrent edits, but a local hash check cannot lock unrelated writers. Keeping Git's root-relative path contract prevents a subdirectory workspace from opening a different file than the one selected in Git.
Coupled: apps/agent-world/src/workspace.ts, apps/agent-world/src/electron/main.ts, apps/agent-world/src/electron/preload.ts
Verify: apps/agent-world/tests/workspace-backend.test.ts
