## file

The Git app's backend runs the machine's `git` through `git()` from workspace.ts, so it inherits that environment: argument arrays only, no pager, no fsmonitor, LC_ALL=C, inherited GIT_* repository overrides cleared, no terminal prompts, `GIT_EDITOR=true`, and SSH in batch mode unless the operator set GIT_SSH_COMMAND. Every operation first resolves the repository top-level, because status and diff paths are relative to it.
Why: a GUI has no terminal for an editor, passphrase or credential prompt; a prompt would hang the call forever. Failing with Git's message is the honest outcome. Inherited GIT_DIR or GIT_WORK_TREE from the launching session would aim every command at another repository.

The renderer sends a typed GitAction, never arguments. Each action maps to fixed argument lists; user values pass `revision()` or `branchName()` (no leading dash, no whitespace, no `..`), and file paths become `:(literal)` pathspecs after a containment check. Commit messages go on stdin (`--file=-`).
Why: a value starting with a dash would become an option, and an unquoted pathspec would expand globs and magic. Stdin keeps any message text out of the argument list.

Some actions read state before choosing arguments: push sets an upstream on origin (or the first remote) when the branch has none and force pushes use `--force-with-lease`; checking out a remote branch switches to an existing local branch of that name or creates a tracking one; Continue on a merge commits with `--no-edit`, while rebase, cherry-pick and revert use their own `--continue`. Discard restores tracked paths from the index and worktree and cleans only the chosen paths that `ls-files --others --exclude-standard` lists as untracked. The merge/rebase/cherry-pick/revert state is read from marker files in the git dir.
Why: `git status` has no machine-readable operation state, and discarding an untracked file through restore fails; the two kinds of path need different commands.

Log and refs use ASCII unit/record separators in their format strings so subjects and names with any printable text parse safely. An empty repository has no HEAD; overview reports a null head and log returns no commits instead of failing.
Coupled: apps/agent-workplace/src/git.ts, apps/agent-workplace/src/backend/workspace.ts, apps/agent-workplace/src/electron/main.ts, apps/agent-workplace/src/electron/preload.ts, apps/agent-workplace/web/workplace-git.tsx
Verify: apps/agent-workplace/tests/git-backend.test.ts
