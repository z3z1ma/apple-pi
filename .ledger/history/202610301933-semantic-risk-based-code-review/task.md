Status: done
Created: 2026-10-31

# Plan semantic risk-based review

## Intent

After completing the requested Org batch-departure change, produce a complete source-grounded plan for first-class harness-assisted code review. Investigate https://github.com/alibaba/open-code-review and https://github.com/Agent-Field/pr-af alongside roboRev. Center semantic/structural decomposition into focused review chunks, risk/complexity-based depth and repeated review where justified, multiple independent reviewers and useful review lenses, a visible review queue/backlog, and sign-off bound to exact commits/content in a directory/worktree/branch. Reuse existing harness capabilities where they fit; specify missing guarantees, interfaces, lifecycle, evidence/validation, failure handling, scope and staged delivery. Distinguish verified source behavior from proposed benefits. Planning only, not authorization to implement a review engine.

## Acceptance criteria

- Verify decisive mechanisms in all three named reference projects at pinned source revisions; distinguish source inspection from execution and effectiveness evidence.
- Propose code-informed semantic/structural chunks, explicit cross-chunk coverage, risk-directed depth, independent first passes and justified repeat passes.
- Specify exact commit/range/branch/staged/working-tree identity, immutable review context and truthful sign-off freshness.
- Specify a durable visible queue using existing runtime ownership, including interfaces, cancellation, restart, retries, authority and evidence retention.
- Give staged delivery, observable acceptance tests and an evaluation against a simple independent reviewer without treating that baseline as the design ceiling.
- Present a complete operator-readable proposal, resolve material source/comprehension findings, and retain remaining uncertainty. Planning does not authorize implementation or activation.

## Records

- [Proposal and delivery plan](proposal.md)
- [Pinned research and local ownership](source-notes.md)
- [Planning checks and independent reading](evidence.md)
- [Retrospective](retrospective.md)

## Current state

The operator approved the proposal with two changes, now applied: use ordinary reviewer environments rather than a custom sandbox/tool restriction layer, and provide a dedicated review interface instead of depending on `/work`, which the operator intends to retire. Captured targets remain for review accuracy; they are not a security boundary. The review TUI may replace the old work interface while task/Pi Exec execution capabilities stay intact.

The scientific-skeptic source/design challenge found no material contradiction in the reviewed draft; the cold reader reconstructed the decision accurately and reported no material comprehension gap. These are source/teaching checks, not implementation or effectiveness proof. Their reports predate the operator's simplifications. Document integrity checks cover the final files at closeout.

## Outcome

Planning complete and approved with notes applied. The proposal covers the requested semantic decomposition, risk-directed depth, independent lenses, exact-artifact sign-off, durable visible queue, reuse boundaries, lifecycle/recovery, interfaces and staged validation. Source notes pin all three reference projects. No production code, runtime, hook, installed dependency or live app changed for this task. Implementation remains a separate authorization.

### Assignment 571: Tadhg Marinescu

Completed the source-grounded semantic/risk-based review plan in .ledger/202610301933-semantic-risk-based-code-review/. The operator approved the proposal with notes, now applied: use ordinary advisory-role peers and normal environments instead of custom sandbox/tool confinement; use a dedicated /reviews interface plus Workplace Code rather than depend on /work. The plan covers code-informed behavioral chunks, region and cross-chunk coverage, risk-directed independent passes, exact captured targets and artifact-bound approval, durable runtime-owned queue/recovery, native/UI interfaces, staged delivery and comparative evaluation. Verified decisive source paths at pinned Open Code Review, PR-AF and roboRev revisions; independent source/design challenge found no material contradiction and a cold reader understood the decision. These checks predate the operator's simplifications and do not establish implementation correctness or effectiveness. Final document checks passed for five documents, seven local links and eleven pinned source references, plus scoped whitespace and operator-note checks. Retrospective is complete. No production code, runtime/app activation, external engine execution or comparative experiment was performed; implementation remains separately authorized.
