---
name: code-review
description: "Review an exact change against repository standards and approved intent, using behavior-based scopes and risk-directed evidence. Use when asked to review a branch, a pull request, the working tree, or changes since a revision."
---

# Code review

Use the native review queue to inspect an exact captured target. Keep correctness, repository standards and approved intent distinct: missing intent is unassessed, not passed. The requester owns the scope and follow-through; ordinary independent advisory peers provide inspection and challenge.

For a pass already assigned within a review, inspect its captured source and answer its questions in the requested report schema. Route additional questions through that report to the plan owner. The requester initiates new reviews using the steps below.

## Set the boundary

Choose the comparison the request actually means: one commit with its parent, an endpoint range, a branch against its merge base, the staged tree, or the working tree including nonignored untracked files. Resolve ambiguity with the requester. Supply the approved task, specification or request as intent, and identify the repository standards that govern the behavior. Preserve their authority separately from the author's explanation.

Use `review_code` to capture and enqueue. Read the returned identity and retained target before interpreting results. Keep any path restriction and omitted evidence explicit. Capture and model execution are different steps; an admitted request is not a completed review. Recover an uncertain request with its original handle rather than starting duplicate work.

## Direct depth at the risk

Use behavior and contracts as inspection scopes, with changed regions as coverage accounting. Inspect the relevant unchanged callers, tests and constraints. A file boundary alone is not a behavior boundary.

Every scope needs correctness, applicable standards and intent inspection. Add independent authority or reliability work for destructive, private-data or state-transition paths; use compatibility, usability and other lenses for concrete risks. A small diff can carry a large obligation. Further work names the unresolved question, why it matters and the evidence that would settle it.

Read `review_queue` and `read_review` progressively. Examine gaps, requested work, attempt failures and retained evidence as well as findings. A completed model claim is evidence to challenge, not a correctness certificate. Source inspection, a causal trace, an executed reproducer and a model hypothesis support different claims. Initial inspections stay independent; later challenge can compare their reports.

## Resolve with evidence

For each material allegation, establish the triggering path, broken invariant, impact, cause, location and counterevidence. Distinguish severity from certainty. Use `resolve_finding` to retain an accountable response without erasing the original allegation or model validation.

Rejection needs counterevidence. Accepted risk needs evidence, authority and explicit scope. Record a proposed or unverified fix as a claim; a verified fix names a completed, unchallenged question on another captured target. A later correction does not repair the earlier snapshot. Changes to source, intent or policy require new review work rather than inherited approval.

When a confirmed finding is a pattern a machine can detect, the fix includes a rule: in a repository with `.pi/rules/`, a GritQL rule file there listed with its paths in `.pi/rules/policy.json`, an `actions` entry for a shell-command pattern, or a script rule for anything else. The harness then checks every call and edit against it. A finding that recurs after a rule exists means the rule is too narrow; widen it.

Use `manage_review` for cancellation, same-target recovery, priority, reassignment or an explicit fresh rerun. Keep failed, interrupted, incomplete and missing work visible. Finish when the authorized obligations have evidence, or report exactly what remains unresolved and who owns the next action.

## Report and consult

Report the target identity and assessment revision, material findings, standards and intent coverage, unassessed axes, source/current-target limits, and the checks actually run. Keep execution completion, coverage, finding judgments and operator approval separate. Fixes and publication require their own authority.

For consequential disagreement, use [peer consultation](../peer-consultation/SKILL.md) over the retained evidence. Choose the perspectives needed by the question; a standing board is optional, not a second review engine. Preserve independent first inspection and let an accountable owner judge evidence rather than count votes. If several people participate, close their exchange and record useful learning under the [shared process conventions](../handbook-writing/references/processes.md).
