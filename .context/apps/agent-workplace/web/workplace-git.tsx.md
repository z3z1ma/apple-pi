## file

WorkplaceGit is the Git app: one repository or worktree root at a time, chosen from the known repositories, its linked worktrees or a typed absolute path, and remembered in localStorage. Every action goes through `window.agentWorkplace.git.run` with a typed GitAction; the renderer never builds command lines. After each action it rereads the overview and the first log page, so the graph, branches and working changes always come from Git rather than from optimistic local edits.
Why: the backend owns argument validation and the exact git invocation. Rereading after every action is cheap next to a network fetch and avoids a renderer model of Git state that can drift.

The view refreshes on activation and on window focus, and otherwise only on explicit Refresh. A refresh started for one root is dropped when the root changed before it returned.
Why: there is no watcher; focus is the moment an outside change (a terminal, an agent) becomes relevant to the operator. A late response from the previous repository must not replace the current one.

Destructive or history-losing actions confirm first: discard (which also deletes untracked files), hard reset, branch force delete and stash drop. Branch delete tries a normal delete and offers force only after Git refuses. Soft and mixed resets, checkout and the network actions run directly; Git's own refusal (dirty tree, conflicts) shows in the failure toast with Git's text.
Why: Git already refuses unsafe checkouts and merges; asking only where work is lost keeps everyday actions one click.

CommitGraph lays out lanes with `laneLayout` from workplace-git-graph.ts over the loaded commits only; Load more appends a page and recomputes the layout. It is a listbox of options: Enter selects, any other key goes to the commit menu handler (which opens on the context-menu key). The Working changes option sits above the first commit and draws a dashed line into HEAD's lane when HEAD is loaded.
Why: lanes depend on every commit above a row, so layout is recomputed for the whole loaded list rather than per page.

The commit draft (summary, description, amend) lives in WorkplaceGit, not CommitForm, so it survives selecting a commit and returning to Working changes. It clears only after a successful commit. A file diff replaces the graph in the centre (GitDiff in workplace-git-diff.tsx) and Escape or Graph returns; the diff viewer hides the patch header lines and numbers old and new lines from each hunk header.
Coupled: apps/agent-workplace/src/git.ts, apps/agent-workplace/src/backend/git.ts, apps/agent-workplace/web/workplace-git-diff.tsx, apps/agent-workplace/web/workplace-git-graph.ts, apps/agent-workplace/web/workplace-git.css, apps/agent-workplace/web/workplace.tsx
Verify: apps/agent-workplace/tests/world-git.test.ts, apps/agent-workplace/tests/git-backend.test.ts
