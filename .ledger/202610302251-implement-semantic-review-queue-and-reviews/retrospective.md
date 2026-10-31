Status: pending
Created: 2026-10-31
Updated: 2026-10-31

# Retrospective

## What Mattered

In progress. The capture foundation was exercised before any paid reviewer turn. Preserve the distinction between this checked component and the still-pending runtime and operator-facing experience.

## Learnings

Git's virtual empty-tree handling hid a missing stored object until full artifact verification ran. A root-commit capture needs a materialized empty tree, not only a resolvable ID. The capture context file owns that invariant.

A checkout-scale measurement exposed process-per-blob acquisition as the dominant cost: 353.7 seconds for 4,930 files. Git batch acquisition retained identical source and patch identities in 21.4 seconds, including verification. These single observations justify the changed I/O boundary, not a general latency or review-quality claim.

The first runtime increment kept capture/admission and actual review execution separate. A disconnected request can leave a verified queued target, but it is not a completed review. Restart requires explicit resume and re-verification rather than recapturing changed live source.

Peer regression checks found eight pre-existing cleanup failures at the committed baseline. The program lifecycle already journaled temporary task disposal, but its shared file-cleanup reader ignored that action. Fixing the shared reader restored cleanup without changing the process-death guards or deleting historical finished-task evidence. An explicit close assertion also prevents a test teardown's Promise.allSettled from hiding cleanup failure.

## Improvements

Pending completion of the undertaking.
