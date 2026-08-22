---
name: workspace-isolation
description: "Use when the operator requests an isolated workspace or substantial work would otherwise conflict with existing uncommitted changes, concurrent writers, or destructive experiments."
---

# Isolate Work When It Pays

Isolation protects existing work; it is not a mandatory prelude to implementation.

## Decide

Stay in the current workspace when the requested paths are clear, existing changes can be preserved, and no concurrent writer or destructive experiment threatens them.

Use a separate worktree or platform-managed workspace when:

- the operator requests it;
- substantial changes would overlap unrelated dirty work;
- concurrent implementation needs separate writers;
- experiments may rewrite, generate, or delete broadly;
- branch separation materially simplifies integration.

A small bounded edit can remain in a dirty tree when status inspection establishes disjoint owned paths.

## Choose the owner

Use the platform's workspace mechanism when one already owns the environment. Orca-managed worktrees use `orca-cli`; other repositories use their documented convention or a normal Git worktree with operator authority.

Branch creation, checkout, worktree creation/removal, and deletion are consequential Git actions. Follow explicit operator direction; ask only when that authority is absent.

## Create safely

1. Record the current root, branch, and status.
2. Select a non-conflicting path and branch.
3. Verify the destination will not overwrite existing files.
4. Create the workspace through its owner.
5. Confirm the expected revision and required task/context files are present.
6. Install dependencies or run baseline checks only when needed for the work—not as automatic ceremony.

Isolation preserves uncommitted files.

## Work and integrate

Keep writers on non-overlapping paths. Run checks relevant to the isolated change. Before integration, inspect the diff and preserve unrelated state.

If the operator already directed commit, push, merge, or cleanup, follow that instruction after verification. Otherwise report the workspace and branch state for their decision.

Remove only workspaces created and owned by the current operation after their uncommitted files are preserved.
