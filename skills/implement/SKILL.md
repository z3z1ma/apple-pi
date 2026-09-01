---
name: implement
description: "Implement decided work from a ticket, small specification, or plan settled in the current conversation, with TDD, regular feedback, final review, and an authorized commit."
disable-model-invocation: true
---

# Implement

Implement the work described by the user in the specification, ticket, or current conversation.

The work is already decided. Read it, restate the behavior you will build, and implement it without reopening the plan or proposing a different architecture. Use ordinary engineering judgment for small implementation discoveries. If a material product or design decision is missing or contradictory, report the blocker rather than redesigning the work.

## Select the work

Honor an explicit path, issue reference, URL, or task reference. A bare local ticket number such as `03` may resolve against the ledger task already named or unambiguously governing the current work. Confirm the ticket title before mutation. If several ticket sets make the reference ambiguous, ask which one the user means.

Read the complete ticket or specification. For a ticket, check its blocking edges before implementation. `Status: ready-for-agent` means the ticket is sufficiently specified; it does not prove that its blockers are complete. Use the canonical ticket state or the user's explicit confirmation. Report an incomplete or unknown blocker instead of silently choosing different work. If a governing specification materially changed and left the ticket stale, stop for ticket regeneration rather than implementing the obsolete artifact.

Before mutation, inspect the working tree and retain the initial staged, unstaged, and untracked state as the ownership baseline. Preserve every pre-existing change. If the selected work must overlap a dirty path and the new edits cannot be distinguished safely, ask the user before continuing. Never revert, stage, or commit unrelated pre-existing work.

One normal run implements one ticket or one small specification. If a specification spans fresh contexts, use `to-tickets` first.

## Choose the execution shape

Keep one coherent change in the root when delegation would add no value.

When the user selects several frontier tickets that were identified during the approved sequencing as dependency-free and non-overlapping, they may run in parallel. Before dispatch, confirm concrete write ownership from the tickets and current code; an absent blocking edge alone does not establish non-overlap.

- Start one direct Builder subagent per ticket. Each subagent is already a fresh Pi session and works in the current worktree; create no extra worktrees.
- Give each Builder one complete ticket, its confirmed TDD seams, the applicable red → green procedure, and exclusive ownership of its writes. If it discovers another seam, it must return the proposal to the root and wait for operator confirmation before editing that test.
- If a newly discovered dependency, shared generated output, or overlapping write makes two lanes conflict, serialize the affected work.
- Builders implement and run focused checks. They do not stage, commit, switch branches, stash, reset, clean, change repository-global Git state, or mutate shared outputs outside their ownership. The root owns reconciliation, shared Git state, the final suite, review, the index, and any authorized commit.

Use direct `agent` fan-out for these independent lanes, not Pi Exec. This is explicit parallel work, not automatic queue dispatch or a persistent scheduler.

## Build with feedback

Use TDD where possible, at confirmed seams. Read and apply the installed `tdd` skill when the work has concrete behavior, observable input and output, and an independent expected result.

Before writing or editing any test, list the exact public seams, what each seam catches, what it misses, and its feedback cost. Stop and wait for fresh operator confirmation. A specification, ticket, existing test, or previous agreement informs the proposal but does not replace this checkpoint. For a parallel batch, the root may present every selected ticket's seam proposal in one checkpoint before dispatch; every seam must still be explicit.

After confirmation, work one test → intended red → minimal green vertical slice at a time. When TDD does not fit, explain why and follow the repository's applicable test requirements.

Run typechecking regularly when the repository provides it, run focused single test files regularly, and run the full repository-required test suite once at the end of implementation. In a parallel batch, Builders run their focused checks and the root runs the final combined suite after reconciliation. If review corrections mutate the code afterward, rerun the affected checks and the full required suite on the corrected tree; the final suite evidence must match the final code.

## Review the working tree

Once done, read and apply `code-review` to review the work before committing. Use `HEAD` as the explicit working-tree fixed point and scope the review to the selected implementation paths and intent sources. Include staged, unstaged, and in-scope untracked changes. An unexpectedly empty boundary is not a successful review.

Reconcile the findings in the root. The user's invocation of `implement` authorizes correction of confirmed findings required to satisfy the selected ticket or specification. Fix those in-scope defects and rerun the affected checks. Keep unrelated findings report-only. Follow code-review's bounded policy rather than rerunning reviews until they become clean.

## Finish

If a blocker, failed required check, partial Builder result, incomplete review boundary, or unresolved in-scope material finding remains, preserve the partial work and report that implementation is incomplete. Do not commit or change ticket state while that evidence is incomplete.

Stay on the current branch. Create or switch no branch automatically. Commit the implemented work to the current branch only when the user authorized a commit for this run. Otherwise leave the reviewed and validated change commit-ready and say that no commit was made.

Do not close the ticket, check its acceptance boxes, mutate blocker edges, advance local or remote ticket state, modify a parent specification or issue, push, publish, deploy, merge, or open a pull request unless the user separately authorizes that action. Local implementation or commit authority does not imply any of those effects.

Report:

- the selected ticket, specification, or conversation plan and the behavior implemented;
- changed paths and any parallel ticket ownership;
- confirmed TDD seams and red → green evidence, or why TDD did not fit;
- focused checks, typechecking, and final-suite results;
- the code-review boundary, findings, corrections, and remaining uncertainty;
- the commit identifier, or that commit authority was absent; and
- that ticket state was unchanged unless separately authorized.
