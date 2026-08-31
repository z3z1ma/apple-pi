---
name: plan-execution
description: "Use when an authorized implementation plan should be executed sequentially in the root session."
---

# Execute Plans Inline

The root session implements the plan directly. Keep momentum, use the plan as a map rather than a ceremony, and deliver verified increments without asking the operator to reconfirm work they already authorized.

## Start

1. Read the plan and only the governing records needed for the next ready Work Item.
2. Confirm dependencies and current repository state.
3. Resolve reversible implementation details yourself.
4. Begin immediately when the operator has authorized implementation.

A separate pre-flight review serves a concrete high-risk uncertainty named by the plan. When the plan is stale, repair it briefly or execute the still-valid intent.

## Execute

For each coherent increment:

1. Implement the smallest behavior that leaves the repository useful.
2. Use a failing test first when it cheaply proves a new invariant or reproduces a bug; otherwise use the most direct relevant check.
3. Inspect the bounded diff and run the named verification.
4. Fix ordinary defects, formatting, integration issues, and any cheap clearly useful nits yourself.
5. Update Work Item state only when the plan is serving as shared continuity.
6. Continue to the next ready increment without a progress approval gate.

Load another process skill only when it is the primary next action.

## Optional review

Root inspection and checks are sufficient unless the plan names an independent review:

- no `Review` field — root inspection and checks;
- `Review: one-pass — <risk>` — one independent review after the coherent change is complete;
- `Review: staged — <risk>` — bounded extra review for a named high-cost risk.

After review, validate findings and make normal corrections in the root session. Nits conclude there. Rerun affected checks after fixes. A second reviewer or follow-up review serves new material risk.

## ledger

When ledger is in use, keep plan state concise: active, blocked, complete, or cancelled; evidence notes preserve only observations another session needs.

## Stop conditions

Stop only for:

- irreversible or destructive action;
- missing authority for external side effects;
- an unresolved security-sensitive choice that changes trust, permissions, credentials, or exposure;
- unresolved product meaning that changes acceptance;
- repeated failure that invalidates the approach.

Otherwise change the method, fix the issue, and continue.

## Finish

Run the fresh checks that support the claims you will make. If the operator already directed commit, push, merge, or closure, execute that authorized action after verification. Otherwise report the completed work and available integration state concisely.
