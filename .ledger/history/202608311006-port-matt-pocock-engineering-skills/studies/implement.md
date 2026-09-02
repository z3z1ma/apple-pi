# `implement` fidelity study

Sources: `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`

- `skills/engineering/implement/SKILL.md`
- `docs/engineering/implement.md`
- `docs/engineering/to-tickets.md`
- `docs/engineering/tdd.md`
- `docs/engineering/code-review.md`
- `skills/in-progress/implement-spec/SKILL.md` as non-shipping contrast

Status: approved; implementation and validation complete

## Role in the workflow

`implement` is the deliberately small build step for work that has already been decided. It accepts one agent-sized ticket, a small specification, or a small plan settled in the current conversation. It does not reopen the plan, start a design interview, or substitute a different architecture while building.

The shipped upstream skill is only five instructions:

1. implement the supplied specification or ticket;
2. use TDD where possible at pre-agreed seams;
3. typecheck and run focused tests regularly, then run the full suite once at the end;
4. run code review; and
5. commit to the current branch.

The Apple Pi port should remain comparably direct. It is not a new task runner, tracker integration, scheduler, lifecycle engine, branch manager, or implementation-planning skill.

## Inputs and ticket resolution

Preserve all upstream entry shapes:

- an explicit ticket path, tracker reference, or URL;
- an unambiguous task-local ticket number such as `03`;
- a small specification that does not need ticket decomposition; or
- the small plan settled in the current conversation.

A bare ticket number is useful shorthand, not a security boundary. Resolve it against the governing task already named or unambiguously established by the current context. Confirm the ticket title before mutation. If several ticket sets make the number ambiguous, ask rather than guessing.

For a ticket, read its complete body and verify its blockers. `Status: ready-for-agent` means the ticket is well specified; it does not prove the ticket is on the frontier. Treat a blocker as complete when the canonical ticket/tracker state says so or the operator explicitly confirms it. If a blocker remains incomplete or unknown, report that fact before implementation rather than silently selecting another ticket. If a material specification pivot left the ticket stale, return it to `to-tickets` regeneration rather than implementing an obsolete artifact.

Before mutation, retain the initial staged, unstaged, and untracked working-tree state as the ownership baseline. Preserve unrelated changes. When selected work overlaps a pre-existing dirty path and ownership cannot be distinguished safely, ask the operator before continuing; neither review nor commit may absorb the unrelated work.

Trust the approved artifact. Restate the behavior to build, but do not re-plan it. A material contradiction or missing product/design decision is a blocker to report, not permission to redesign. Small implementation discoveries remain ordinary engineering judgment.

## The upstream work loop

Preserve the five beats and their order:

1. Read the selected work and identify the public test seams.
2. Apply TDD where it fits, one red → green vertical slice at a time.
3. Run typechecking regularly when the repository provides it and run focused single test files regularly.
4. Run the full repository-required test suite once at the end.
5. Review the completed working-tree change, then commit when authorized.

If review corrections mutate the code, they reopen the implementation beat: rerun the affected checks and the full required suite so the final suite evidence matches the final tree.

This is one coherent implementation loop. It should not gain a planning phase, arbitrary test budgets, a second artifact, or repeated review-until-clean machinery.

## TDD dependency contract

Upstream says to use `/tdd` at "pre-agreed seams," while its own documentation admits that `implement` does not establish the agreement. Apple Pi's approved TDD contract closes that gap:

- Use TDD only for concrete behavior with observable input/output and an independent expected result.
- Before writing or editing any test, load and apply `tdd`, list the exact public seams, explain what each catches, misses, and costs, then stop for fresh operator confirmation.
- A ticket, specification, existing test, or earlier design discussion informs the proposal but does not replace this confirmation.
- After confirmation, work one test → intended red → minimal green slice at a time. Refactoring remains in the later independent code-review stage.

For a parallel batch, the root may present every selected ticket's proposed seams in one grouped checkpoint before dispatch. Each ticket's seams and trade-offs must still be explicit, and no implementer starts test mutation before confirmation.

## Review and commit ordering

Upstream says review before commit, but its documentation records an unfixed failure: its code-review comparison looked only at committed history, so the pre-commit review could see an empty diff.

Apple Pi already supports working-tree review. Invoke `code-review` with `HEAD` as the explicit fixed point and the selected implementation paths as scope. Include staged, unstaged, and in-scope untracked changes. Reject an unexpectedly empty boundary before reporting review success.

The operator explicitly decided that invoking `implement` authorizes correction of confirmed review findings required to satisfy the selected ticket or specification. The root reconciles the findings, corrects only those in-scope defects, and reruns the affected checks plus the full required suite when code changed. Unrelated improvements remain report-only and out of scope. Use code-review's bounded review policy rather than rerunning reviews until they become clean.

Upstream commits eagerly. Apple Pi retains the upstream endpoint without treating mutation authority as ambient: remain on the current branch, create or switch no branch automatically, and commit only when the operator authorized a commit for this run. Otherwise stop with a reviewed, validated, commit-ready working tree and say that no commit was made. Implementation or commit authority does not imply push, pull-request creation, publication, deployment, merge, parent specification/issue mutation, or any other external effect.

## Ticket state

Preserve upstream's documented behavior: `implement` does not close the ticket, check acceptance boxes, mutate blocker edges, or advance a tracker state automatically. At completion, report the implementation evidence and state explicitly that the canonical ticket remains unchanged. The operator may then authorize the appropriate local or remote state transition.

This keeps tracker mutation and remote effects outside the implementation loop. It also makes the completion handoff visible rather than leaving `ready-for-agent` to imply success.

## Parallel implementation in Apple Pi

The released upstream skill says one invocation, one ticket and warns against concurrent sessions sharing a checkout. Its in-progress `implement-spec` explores subagent fan-out through separate branches and worktrees. Neither is adopted literally.

The operator selected the Apple Pi mapping:

- The current checkout is already the worktree where changes land. Do not create extra worktrees for implementation fan-out.
- A subagent is a fresh Pi session; session context and filesystem placement are separate concepts.
- Tickets identified during approved sequencing as dependency-free and non-overlapping may run concurrently in the same current worktree. Before dispatch, confirm concrete write ownership from the tickets and current code; an absent blocking edge alone does not prove non-overlap.
- Use flat direct `agent` fan-out, normally one Builder per selected ticket. Pi Exec adds no value to independent implementation lanes.
- Give each Builder one complete ticket, its root-confirmed TDD seams and red → green procedure, and exclusive write ownership. A newly discovered seam returns to the root for operator confirmation before that test is edited.
- If exploration reveals overlapping writes, shared generated outputs, or a new dependency, serialize the affected work rather than letting writers collide.
- Builders mutate and run focused checks; they do not stage, commit, switch branches, stash, reset, clean, change repository-global Git state, or mutate shared outputs outside their ownership. The root owns reconciliation, shared Git state, combined validation, working-tree review, the index, and any authorized commit.

A normal invocation still implements the single ticket or small specification the operator selected. Parallel fan-out is available when the operator selects several genuinely independent frontier tickets; it is not automatic queue dispatch and does not turn `implement` into a persistent scheduler.

## Completion report

Report:

- the selected ticket/specification and implemented behavior;
- changed paths and any parallel ticket ownership;
- TDD seams confirmed and red → green evidence, or why TDD did not fit;
- focused checks, typechecking, and final suite results;
- code-review boundary, findings, corrections, and remaining uncertainty;
- the commit identifier, or that commit authority was absent; and
- that ticket/tracker state was not changed unless separately authorized.

When a ticket is stale, a blocker remains, a required check fails, a Builder returns partial work, the review boundary is incomplete, or an in-scope material finding remains unresolved, preserve the partial work and report implementation as incomplete. Do not commit or change ticket state while that evidence is incomplete. Missing commit authority leaves otherwise reviewed and validated work commit-ready rather than making the implementation evidence disappear.

## Fidelity classification

### Preserved upstream doctrine

- Human-only invocation.
- Build settled work without redesigning it.
- Ticket, small spec, and current-conversation inputs.
- TDD where applicable, regular focused feedback, one final full suite.
- Code review before the commit endpoint.
- Current-branch behavior.
- No automatic ticket completion.

### Existing dependency contracts

These are not new harness mappings. `implement` composes the already adopted Apple Pi forms of its upstream dependencies:

- `tdd` requires fresh operator confirmation of the proposed seams on every invocation. This is an earlier approved Apple Pi policy deviation from upstream's weaker "pre-agreed" assumption; `implement` must not bypass it.
- `code-review` already supports a working-tree review with `HEAD` as the fixed point. Using that supported boundary preserves upstream's intended review-before-commit order while correcting the empty-diff failure documented by upstream itself.

### Actual platform mappings

- A local ticket number resolves through the semantically governing ledger bundle rather than upstream's configured issue-tracker registry.
- Safe flat parallel work uses direct Builder subagents, each of which is already a fresh Pi session, in the current worktree. Pi Exec and extra worktrees are unnecessary.

### Existing Apple Pi authority policy

These are policy constraints rather than capability mappings:

- Invoking `implement` authorizes correction of confirmed review defects that are required to satisfy the selected work. Unrelated findings remain report-only.
- A commit occurs only when separately authorized; otherwise the reviewed change remains commit-ready in the current worktree.
- Local or remote ticket-state mutation remains operator-owned rather than being inferred from implementation authority. This also preserves upstream's documented no-completion behavior.

### Deliberate addition

- Flat direct-Builder fan-out for explicitly selected, graph-independent, non-overlapping frontier tickets in the same current worktree, with the root retaining index and integration ownership.

### Rejected upstream limitations

- Do not require a full URL when a task-local number is unambiguous.
- Do not preserve the known empty pre-commit review failure.
- Do not let a specification silently satisfy the already approved TDD seam checkpoint.
- Do not require extra worktrees or ban safe same-tree parallelism.

## Resolved operator decisions

1. Keep the shipped upstream skill's direct five-beat work loop rather than expanding it into a planning or lifecycle system.
2. Allow unambiguous task-local ticket numbers; ask only when the reference is ambiguous.
3. Use direct Builder subagents for explicitly selected parallel frontier tickets in the same current worktree. Each subagent is a fresh Pi session; extra worktrees are neither required nor useful for non-overlapping tickets.
4. Treat fresh TDD seam confirmation and `HEAD` working-tree review as composition with the already adopted dependency contracts, not as new harness mappings.
5. Let `implement` authority include correction of confirmed in-scope review defects. Keep unrelated findings report-only.
6. Keep commit authority and ticket-state mutation separate.

## Validation

- The real loader discovers `implement` with human-only invocation and no diagnostics; Pi Exec skill discovery excludes it.
- The package dry run contains `skills/implement/SKILL.md`.
- Independent fidelity review confirmed the upstream five-beat loop and corrected final-suite staleness, write-ownership inference, shared same-worktree state, confirmed-seam propagation to fresh Builder sessions, and the in-scope completion gate.
- Safety review added explicit pre-existing dirty-state ownership, partial-run failure semantics, and external-effect boundaries without adding a runtime mechanism.
- Validation passed the 80-test focused runtime suite, the 916-test unit suite, typecheck, loader validation, formatting, focused lint, package inclusion, and scoped diff checks.
- No reference file, runtime graph, tracker adapter, lifecycle implementation, branch helper, worktree helper, or prose behavior harness was added.

## Proposed package shape

- One concise human-only `skills/implement/SKILL.md`.
- No reference files, runtime graph, tracker adapter, lifecycle implementation, branch helper, or prose behavior harness.
- README, provenance, adopted-boundary, loader, Pi Exec hidden-skill, and package inclusion reconciliation.
- Proportional loader/package validation plus the existing runtime and unit suites.
