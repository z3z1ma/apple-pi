---
name: task-closure
description: "Use when implementation is complete, checks and review are resolved, and the Ledger task and development branch need to be finished."
---

# Finishing a Development Branch

## Overview

**Core principle:** Verify tests → Reconcile Ledger closure → Detect environment → Present options → Execute choice → Clean up.

## Ledger State: Closure And Compounding

Finishing joins two decisions that must not be confused. First, judge the task from Acceptance Criteria evidence, dependencies, owning blocking records, completed/superseded plans, review dispositions, follow-up ownership, and the top-level `retrospective.md`. Then present operator-owned Git or forge integration choices. The retrospective synthesizes what worked, what should improve, learnings, and concrete improvements to repository docs, decisions, tests, runbooks, configured skills, or separately owned tasks. Task-specific history stays in the bundle. Integration success cannot manufacture task evidence, and a done task does not authorize merge, push, PR, or cleanup.

**Announce at start:** "I'm using the task-closure skill to complete this work."

## Step 1: Verify Tests

Run the project's full test suite (`npm test` / `cargo test` / `pytest` / `go test ./...`).

**If tests fail**, record the exact command, source state, failures, attribution evidence, and limits under `evidence/` before deciding ownership.

- If the failure is caused by this change, required by an Acceptance Criterion, or makes integration unsafe, record the blocking effect in the active plan, report `Partial` or `Blocked`, and stop before the integration menu.
- If the failure is demonstrably present in byte-identical `HEAD` files outside this task's perimeter and acceptance does not require that gate, link a separately owned follow-up (or record an explicit owner/revisit condition) and continue to Step 2 to reconcile this task. Do not repair unrelated files merely to manufacture green. Integration readiness remains bounded by the known failure unless the operator explicitly accepts that baseline.

A nonzero suite never becomes a passing claim; attribution determines ownership, not whether the observation is recorded.

**If tests pass:** continue to Step 2.

## Step 2: Reconcile and Close the Ledger Task

Before presenting integration as complete, reconcile the governing Ledger task.

1. Read `task.md`, every plan, validation/review evidence notes, `retrospective.md`, research limits, active specifications, and decisions.
2. Map each Acceptance Criterion to fresh evidence-note paths, exact procedures, observed results, and limits.
3. Confirm dependencies remain done; no referenced research, decision need, plan, or dependency blocks the outcome; no active plan remains; all plan work is complete or substantively cancelled with rationale; and material review findings are resolved, rejected with evidence, or explicitly bounded with rationale, owner, and revisit condition.
4. Classify each durable outcome by its real owner:
   - product or system contract → normal repository documentation;
   - consequential architecture choice → the repository's decision or ADR location;
   - operating boundary or vocabulary → maintainer documentation;
   - repeated error-prone procedure → a packaged skill or runbook;
   - independent unfinished outcome → a new Ledger task with any required dependency;
   - task-specific history → remain in the task bundle.
5. Update the existing authoritative owner instead of creating a parallel copy. External publication requires operator authorization.
6. Complete the one top-level `retrospective.md`: Summary, What Worked, What Could Improve, Learnings, and Improvements. `Improvements` records every completed owner change, separately owned follow-up, or substantive no-promotion rationale; then set retrospective Status to `complete`.

Set task `Status: done` only when every dependency is `done`; no referenced research, decision need, plan, or dependency blocks the outcome; no active plan remains and every plan is `complete` or `superseded` with all work complete or substantively cancelled with rationale; every Acceptance Criterion has adequate evidence under `evidence/` with applicable limits; every review finding and remediation is resolved, rejected with evidence, or explicitly bounded with rationale, owner, and revisit condition; and `retrospective.md` is complete. A paused or blocked task preserves its findings and explicit next owner without manufacturing completion. If these conditions are not met, report `Partial` or `Blocked` and stop before the integration menu.

When the operator authorizes archival, call `ledger_close` with `done` or `cancelled`. The tool moves the bundle and updates the live/history indexes; it does not judge completeness.

## Step 3: Detect Environment

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
# Capture now, while still inside the workspace — Step 6 changes directory
# before cleanup (Step 7) needs this value
WORKTREE_PATH=$(git rev-parse --show-toplevel)
```

This determines which menu to show and how cleanup works:

| State | Menu | Cleanup |
|-------|------|---------|
| `GIT_DIR == GIT_COMMON` (normal repo) | Standard 3 options | No worktree to clean up |
| `GIT_DIR != GIT_COMMON`, named branch | Standard 3 options | Provenance-based (see Step 6) |
| `GIT_DIR != GIT_COMMON`, detached HEAD | Reduced 2 options (no merge) | Externally managed — leave in place |

## Step 4: Determine Base Branch

The base branch is whatever this work forked from — usually named in the
plan, the conversation, or the branch's upstream. If it is not already
known, ask: "This branch split from <your best guess> - is that correct?"
Confirm before merging: merging into the wrong base is expensive to undo.

## Step 5: Present Options

**Normal repo and named-branch worktree — present exactly these 3 options:**

```
Implementation complete. What would you like to do?

1. Merge back to <base-branch> locally
2. Push and create a Pull Request
3. Keep the branch as-is (I'll handle it later)

Which option?
```

**Detached HEAD — present exactly these 2 options:**

```
Implementation complete. You're on a detached HEAD (externally managed workspace).

1. Push as new branch and create a Pull Request
2. Keep as-is (I'll handle it later)

Which option?
```

Present the menu exactly as written — concise, with every option coming
from the list above. Discarding the work happens only in response to the
operator explicitly asking for it (see "If the operator asks to discard
the work" below). Wait for their answer; the integration decision is
theirs.

## Step 6: Execute Choice

### Option 1: Merge Locally

```bash
# Get main repo root for CWD safety
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN_ROOT"

# Merge first — verify success before removing anything
git checkout <base-branch>
git pull
git merge <feature-branch>

# Verify tests on merged result
<test command>
```

If tests fail on the merged result: stop, leave the worktree and branch in
place, and investigate — nothing has been pushed, so the merge is local
and recoverable.

Once the merged result is green: clean up the worktree (Step 7), then
delete the branch:

```bash
git branch -d <feature-branch>
```

### Option 2: Push and Create PR

```bash
git push -u origin <feature-branch>
# From a detached HEAD, name the new branch on the remote:
# git push origin HEAD:refs/heads/<new-branch>
```

Then create the pull/merge request against <base-branch> with the forge's
tooling — its CLI if one is available, or the creation URL most forges
print when you push — following the repo's PR template and conventions if
present, and report the URL to the operator.

Keep the worktree — the operator iterates on PR feedback there.

### Option 3: Keep As-Is

Report: "Keeping branch <name>. Worktree preserved at <path>."

### If the operator asks to discard the work

This path exists only as a response to an explicit request to throw the
work away. Confirm first:

```
This will permanently delete:
- Branch <name>
- All commits: <commit-list>
- Worktree at <path>

Type 'discard' to confirm.
```

Wait for that exact confirmation. When it arrives:

```bash
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN_ROOT"
```

Then clean up the worktree (Step 7) and force-delete the branch:

```bash
git branch -D <feature-branch>
```

## Step 7: Cleanup Workspace

**Runs for Option 1 and confirmed discards.** Options 2 and 3 always
preserve the worktree. Both callers have already changed directory to the
main repo root — worktree removal must run from outside the worktree —
and use the `GIT_DIR`/`GIT_COMMON`/`WORKTREE_PATH` values captured in
Step 3, from before that directory change.

**If `GIT_DIR == GIT_COMMON`:** Normal repo, no worktree to clean up. Done.

**If the current session created `WORKTREE_PATH` under `.worktrees/` or `worktrees/`:** the session owns cleanup:

```bash
git worktree remove "$WORKTREE_PATH"
```

Do not run a repository-wide `git worktree prune`; unrelated stale registrations may belong to another session. Surface them to the operator instead.

**If removal is refused** (`contains modified or untracked files`): the
worktree holds files that exist nowhere else — uncommitted plans, notes,
or scratch work. Never `--force` on your own initiative. Show the operator
what is at stake and ask:

```bash
git -C "$WORKTREE_PATH" status --porcelain -uall
```

```
Worktree removal refused — these files were never committed:

<file list>

1. Commit them to <branch> before cleanup
2. Move them into <main repo root>
3. Delete them (unrecoverable)

Which?
```

Carry out the choice, then remove the worktree.

**Otherwise:** The host environment owns this workspace — leave it in
place. If your platform provides a workspace-exit tool, use it.

## Quick Reference

| Option | Merge | Push | Keep Worktree | Cleanup Branch |
|--------|-------|------|---------------|----------------|
| 1. Merge locally | yes | - | - | yes |
| 2. Create PR | - | yes | yes | - |
| 3. Keep as-is | - | - | yes | - |
| Discard (explicit request only) | - | - | - | yes (force) |

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Tests passed earlier this session" | Run the suite on the tree you are about to integrate. A green run only proves the tree it ran on. |
| "They obviously want it merged" | Integration is the operator's decision. Present the menu and wait. |
| "They seem done with this feature — I'll offer to discard it" | The menu is complete as written. Discard happens only when the operator asks for it in so many words. |
| "'Yeah, get rid of it' counts as confirmation" | Only the typed word `discard` authorizes deletion. |
| "The PR is up, so the worktree is clutter now" | PR feedback gets fixed in that worktree. It stays until the work lands. |
| "This other worktree looks stale — I'll clean it too" | Clean up only worktrees under `.worktrees/` or `worktrees/`. Everything else belongs to the host. |
| "Removal refused — `--force` is just finishing the cleanup" | The refusal means files exist only in that worktree. `--force` destroys them permanently. Show the operator and ask. |
| "The merged-result failure is probably flaky" | A failing merged result stops everything. Branch and worktree stay put while you investigate. |
| "The base branch is obviously main" | Confirm the fork point or ask. Merging into the wrong base is expensive to undo. |
| "The push was rejected — force-push will fix it" | A rejected push means the remote moved. Investigate; force-push only on the operator's explicit request. |
