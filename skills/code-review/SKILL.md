---
name: code-review
description: "Review a branch, pull request, work in progress, working-tree change, or anything since a named revision against repository standards and originating intent. Use for code review, review since X, audit, critique, or sanity-check requests."
---

# Code Review

Review the change along two independent axes:

- **Standards**: does the code conform to this repository's documented standards and engineering constraints?
- **Intent / Spec**: does the change faithfully implement what the originating request, issue, task, or specification asked for?

A review succeeds when it establishes whether the change is well made **and** whether it is the right change. It does not succeed by creating more review work.

## Review posture and cadence

Prefer a fresh root session: reviewing in the authoring context preserves the assumptions that produced the change and invites confirmation bias. Delegated roles must perform only their assigned review; they must not invoke `code-review`, spawn another reviewer, or recursively re-enter a review graph.

Treat every finding as a hypothesis until the root checks its citation and evidence against current source. Do not rerun review until it becomes clean; fixes create new surface and judgment calls do not converge deterministically.

Reviewing each coherent ticket keeps the diff and Intent / Spec source narrow. A final review against the branch point catches interactions between tickets. For work in progress, explicitly choose working-tree scope; branch comparisons otherwise see committed changes only. This skill belongs after a coherent implementation batch and may also stand alone on any selected diff. It does not replace `diagnosing-bugs` for an unexplained failure or `codebase-design` for whole-codebase design work.

## 1. Pin and validate the boundary

Honor a fixed point the operator supplied: a commit, branch, tag, merge-base, or other revision. Resolve it before delegation. For a branch or pull request, inspect the merge-base comparison and retain both commands as review evidence:

```text
git diff <fixed-point>...HEAD
git log <fixed-point>..HEAD --oneline
```

For an unmistakable working-tree review, `HEAD` is the fixed point. Include normalized status, staged and unstaged changes, and every untracked file in scope. For a branch or pull request with no sound base, ask rather than guessing.

Confirm the revision resolves and the requested change is non-empty before spawning reviewers. Keep changed paths, untracked paths, commits, diff statistics, and the exact comparison visible. A bad reference or empty boundary fails here, not inside parallel workers.

## 2. Identify the Intent / Spec source

Look for originating intent in this order:

1. Issue or change references in commit messages or the branch, resolved only through the repository's documented tracker workflow.
2. A path or issue the operator supplied.
3. The governing ledger task, approved specification, or decision record.
4. A matching file under the repository's documentation or specification conventions.
5. The operator's request and current conversation.

If the source remains ambiguous, ask. If the operator confirms there is no source, do not invent one: report **Intent / Spec not assessed — no source was available**. That axis is neither a pass nor zero findings.

## 3. Identify the standards sources

Find the repository instructions and documents that govern the changed area, such as `AGENTS.md`, `CONTRIBUTING.md`, coding standards, architecture decisions, and module-local guidance.

Apply the complete [smell baseline](references/smell-baseline.md) in addition to documented standards:

- Repository rules override the baseline.
- A documented-standard breach may be a hard violation.
- A smell is always a labelled judgment call and matters only when it creates a concrete cost in this change.
- Skip formatter, linter, and other issues tooling already enforces; inspect or run the tool instead.

## 4. Review two independent axes

Keep the axes isolated while investigating. Good style must not hide wrong behavior, and correct behavior must not excuse a broken repository contract.

### Standards

Report:

- material violations of documented repository standards, citing the governing file and rule;
- baseline smells with the smell named, the relevant changed code cited, and the concrete maintenance or correctness cost;
- mismatches between changed interfaces, callers, tests, configuration, lifecycle paths, or error semantics that violate repository contracts.

### Intent / Spec

Report:

- requirements that are missing or only partially implemented;
- behavior that was not requested when it creates scope, compatibility, or maintenance risk;
- requirements that appear implemented but whose reachable behavior is wrong;
- acceptance criteria that cannot be established from the available change and evidence.

Cite the relevant requirement for every mismatch. When intent exists only in the operator request or conversation, state that coverage limit.

## 5. Choose the cheapest sound topology

### Root-only inspection

Use for one very small, explicitly narrow question where delegation adds no useful isolation. This preserves the targeted-question pattern without packaging a separate graph. Do not present it as a complete branch or pull-request review unless both axes were independently considered.

### Flat direct-agent fan-out

This is the normal complete review shape. Dispatch one read-only Standards reviewer and one read-only Intent / Spec reviewer in parallel. Give each the complete boundary, commit list, changed paths, axis-specific sources, checks already run, and one independent brief. If no Intent / Spec source exists, skip that lane and report it as not assessed.

Use direct `agent` sessions because neither lane determines the other and the root can reconcile both results directly.

### Pi Exec review graphs

Read and follow [`pi-exec`](../pi-exec/SKILL.md) before authoring or adapting a review program. Pass the comparison explicitly; planned and fixed-lens graphs also receive the axes the root intends to assess, plus the applicable standards and intent source paths. Use a graph only when composition adds real value:

- [Fixed multi-lens review](references/multi-lens-review.js): known independent risk questions need typed fan-in and independent candidate verification. Security-sensitive changes may use paired attacker and defender lenses over the same boundary rather than a separate security graph.
- [Planned review](references/plan-review-verify.js): the change is broad or structurally uncertain, so a planner must create cohesive partitions and focused investigations before fan-out.
- [Residual review](references/residual-review-loop.js): a first reducer identifies specific material coverage gaps that justify one bounded additional investigation wave.

A planner partitions and asks questions; it does not pre-review, suppress risks, or decide findings. Every planner, reviewer, reducer, and verifier is read-only and may not invoke `code-review`, spawn another reviewer, or re-enter the graph.

Use one reducer layer when one axis's complete candidate evidence fits one trustworthy fan-in. Use semantic partition or axis reducers followed by a final axis reducer when actual context fitting or independent partitions make one fan-in incomplete. Do not select two layers from an arbitrary candidate count.

Concurrency may queue work; it must not discard work. Candidate omission, failed lanes, truncated evidence, unknown or undecided IDs, and incomplete changed-path or axis coverage are explicit coverage failures. Process another complete semantic batch or report the gap. Never turn bounded context into a clean result.

## 6. Apply the finding standard

Every candidate finding must establish:

- the changed or omitted location;
- a `contract` citation to the violated repository standard or Intent / Spec requirement;
- a concrete input, state, or call path that triggers it;
- an evidence chain through relevant guards, callers, consumers, and tests;
- the observable impact;
- the smallest coherent correction direction.

Severity:

- `critical`: realistic security compromise, data loss or corruption, or catastrophic outage;
- `significant`: reachable functional, compatibility, or operational failure that should block completion;
- `minor`: bounded correctness issue worth fixing but not worth another review cycle.

Style preferences, speculative defenses, unrelated cleanup, and unsupported smells stay outside the findings. Report every material supported defect; do not pad the review and do not stop at an arbitrary count.

## 7. Reconcile evidence in the root

Reviewer and reducer output is a set of hypotheses, not proof. The root independently checks every candidate against current source and governing evidence, rejects false positives, and records unresolved material uncertainty honestly.

Recognize shared causes across axes without deduplicating, merging, or reranking the findings themselves. A Standards violation and an Intent / Spec violation remain separate decisions, each ranked only inside its axis. Attach the same stable shared-cause reference to affected findings and retain every axis-specific citation. An optional unranked shared-cause index may list linked finding IDs and one non-authoritative correction direction; implementation prioritization is a separate follow-on artifact, not part of the review verdict.

A deep verifier worker improves evidence quality but is not final authority. The root owns the final report, any checks it runs, and all mutation. A review request is report-only unless the operator also requested fixes or authorizes them afterward.

## 8. Report

Use this shape:

```markdown
## Standards

[Confirmed findings ordered by severity within this axis.]

### Unresolved
[Material questions the evidence could not decide.]

### Coverage limits
[Failed lanes, omissions, truncation, unavailable standards, or unreviewed paths.]

## Intent / Spec

Intent source: <issue, path, task, request, conversation, or unavailable>

[Confirmed findings ordered by severity within this axis.]

### Unresolved
...

### Coverage limits
...

## Shared-cause index (unranked, optional)

[Stable shared-cause references with linked Standards and Intent / Spec finding IDs and citations. Do not prioritize or merge the findings here.]

Summary: Standards — N confirmed, worst: ...; Intent / Spec — M confirmed, worst: ...
```

If an assessed axis has no material findings, say so directly. If both axes are complete and clean, finish. Do not manufacture follow-up work.

## Why the axes remain separate

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Intent / Spec fail.**
- Code that does exactly what was requested but breaks the repository's contracts → **Intent / Spec pass, Standards fail.**

Separate investigation and reporting prevent either success from masking the other failure.
