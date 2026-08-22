---
name: task-closure
description: "Use when a Ledger task should be archived or completed work should be committed, pushed, merged, or otherwise integrated."
---

# Close Work Without Ceremony

Finish honestly and follow the operator's integration direction. Closure should preserve useful state, not reopen the project as a paperwork exercise.

## Verify proportionately

Run the fresh checks needed for the claims and integration action at hand:

- focused change: targeted checks;
- broad integrated change: broader relevant suite;
- documentation or skill: loader, formatting, links, or package checks that actually apply;
- task archival only: verify task state and intended index changes.

The full repository suite serves broad changes and broad claims. Evidence artifacts preserve observations with future value rather than repeat routine command output.

If a required check fails because of the change, stop integration and fix it. If an unrelated pre-existing failure is proven and does not make the requested integration unsafe, report it and continue only within the operator's stated tolerance.

## Reconcile Ledger when present

For an active task:

1. Confirm the promised outcome exists in the repository or other authoritative target.
2. Resolve material blockers and dependencies.
3. Mark substantial active plan work complete, cancelled, or superseded honestly.
4. Complete the retrospective only when it captures learning or improvements worth preserving; a scaffold alone creates no obligation.
5. Set `done` when the outcome is delivered; use `cancelled` when the operator abandons it.
6. Call `ledger_close` only when archival is authorized.

Closure uses the records the task actually needed and verifies the actual deliverable before archival.

## Integration authority

If the operator explicitly says commit, push, merge, create a PR, publish, or keep the branch, that is the choice. Execute it after verification without presenting another menu.

If no integration action was requested, leave Git state unchanged and report it. Ask for a specific choice only when the operator requested integration but the intended action remains ambiguous.

Discarding work requires explicit confirmation.

## Selective integration

Before committing:

- inspect `git status` and the staged diff;
- include only paths owned by this change;
- preserve unrelated uncommitted and untracked work;
- ensure referenced tracked artifacts are not dangling;
- use a concise commit message describing the delivered behavior.

Force-push, branch deletion, worktree removal, publication, and deployment follow explicit authority.

## Report

State:

- task status and archive path when applicable;
- commit/branch/remote result;
- checks actually run;
- unrelated work deliberately preserved;
- anything material still unverified.

Then stop.
