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

The execution checkpoint exercises the real runtime and separate SDK sessions on scripted models. It now proves more than fresh identities: first provider messages include the normal role section and captured-source tool results, exclude author narrative and other first reports, and expose those reports only during validation. Scripted risk labels still prove dispatch rather than the model's ability to choose a good plan or find a defect. Completion of this kernel is not delivery of the pending tools and UI.

The ordinary-onboarding positive control initially failed because it still expected full backscroll. An unchanged baseline reproduced it; the existing pointer contract, rather than the new review behavior, determined the correction. Keep the ordinary-hire positive control beside independent-review tests so an indiscriminate removal of startup context cannot look like success.

## Improvements

Pending completion of the undertaking.
