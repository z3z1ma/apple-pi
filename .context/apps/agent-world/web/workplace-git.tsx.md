## file

GitPane is the read-only changes list in the Code workspace. Path buttons open the editor through onOpenFile; View diff loads a patch and hands {path, staged, text} to onDiff. WorkplaceCode in workplace-code.tsx owns the main-area viewer, its Close control and the retained Monaco editor models. GitDiffText supplies the escaped patch presentation without owning that navigation. A file with both index and worktree changes intentionally appears in both groups, with staged:true only for the index diff. Untracked files can have no diff text; the viewer says so instead of inventing a patch.
Why: the staged and unstaged views compare different versions of the same path. Opening a file is not a request to fetch a diff or mutate Git state.

Unified-diff coloring changes only presentation: newline-retaining chunks remain escaped React text, added/removed prefixes receive background spans, and +++/--- file headers stay neutral. Rejoining the rendered text must reproduce the backend diff, including a missing final newline.
Why: adding line breaks during highlighting would change copied patches; treating file headers as changed content would give them a misleading added/removed background.

The inner component is keyed by the repository directory (`root`) and owns its status and diff requests. Changing directories unmounts that owner, whose effect cleanup ignores late responses. Keeping GitPane mounted while Code hides it preserves selection across tab switches. Explicit Refresh rereads status only; View diff rereads the patch. WorkplaceCode passes its stable state setter as onDiff: changing callback identity would rerun the selected-diff effect. Opening a file from the changes list clears that selection and lets the same effect cleanup discard its pending result. Refresh is explicit; there is no watcher or polling.
Why: a response from the previous root must not replace the new repository's view, while merely hiding a pane must not discard its selected file. Status refresh must not reopen a diff that the parent already closed.

Entry paths must use the same root basis as readFile/onOpenFile and gitDiff. Porcelain-v1 paths are repository-relative, not automatically relative to the supplied working directory. The backend therefore requires the repository top-level for Git operations and reports the actual root when a manually opened subdirectory is unsuitable; the editor can still use that manual directory.
Why: resolving a repository-relative path beneath a manually chosen subdirectory can open a different file or pass the wrong diff pathspec.
Coupled: apps/agent-world/src/workspace.ts, apps/agent-world/src/backend/workspace.ts, apps/agent-world/web/workplace-code.tsx
Verify: apps/agent-world/tests/workspace-backend.test.ts, apps/agent-world/tests/world-code.test.ts
