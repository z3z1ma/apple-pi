Status: active
Created: 2026-08-16
Updated: 2026-08-16

# Implementation plan

## Outcome

Apple-pi review keeps cohesive semantic coverage groups, which may share selected items, and receives a planner-generated bounded focus layer. Each focus is a concrete, independently reviewed question over a subset of its group's selected items; focuses may overlap inside that group, and a group's focuses must cover its items. A single global scheduler pipelines focus reviewers and necessary verifiers, aggregates completion only after all assigned focuses succeed, and deterministically suppresses only identity-certain overlapping-focus duplicates from the visible summary.

## Current-System Evidence

- `components/review/src/types.ts` models `ReviewGroup` as both exact coverage partition and reviewer assignment; `ReviewFinding` has only a group owner; `ReviewRun.completedItemIds` is the aggregate coverage output.
- `components/review/src/roles.ts` renders one `objective`/`rationale` per group and supplies the planner/reviewer/verifier TypeBox result contracts.
- `components/review/src/work-graph.ts` validates group-only exact coverage and normalizes profile tiers.
- `components/review/src/controller.ts` executes all group reviewers under `parallelLimit`, adds their group item IDs to `completedItemIds`, then executes finding-bearing group verifiers in a separate `parallelLimit` stage.
- `components/review/src/policy.ts` owns the sealed-input-derived group/concurrency limits and per-role capacity envelopes; normal callers do not set them.
- `components/review/tests/review-core.test.ts` exercises review graph invariants; `review-controller.test.ts` supplies managed role doubles and verifies routes, coverage, receipts, and terminal causes.

## Change Surfaces

- `components/review/src/types.ts`: distinguish coverage group, review focus, raw finding provenance, focus lifecycle/coverage state, focus cap policy, visible merged finding data, and complete custom-tool envelope data without breaking audit-only older receipt reads.
- `components/review/src/roles.ts` and `skills/review-planner/SKILL.md`: add typed group/focus planner output, fair per-item planner excerpts, a selected-item-only sealed diff chunk reader, focus-specific rendering, and explicit evidence-derived-question/no-padding requirements. Update reviewer/verifier prompt terminology from group assignment to focus assignment while retaining patch anchoring.
- `components/review/src/work-graph.ts`: compile and fail-close cohesive, possibly overlapping coverage groups plus the bounded focus layer; validate parent/subset/group-coverage/overlap/path/tier invariants.
- `components/review/src/policy.ts`: add independent sealed-input-derived `budgets.maxFocuses = clamp(maxGroups + 2, 3, profile.maxFocuses)` for non-empty inputs. Set explicit focus ceilings to fast 14, balanced 26, thorough 34, and package 34; serialize/count all supplied custom-tool schemas—not only the terminating tool—for envelope/admission policy.
- `components/review/src/controller.ts`: replace reviewer-stage then verifier-stage barriers with one bounded focus job lifecycle; aggregate item completion after every assigned focus succeeds; persist focus transitions; and compute deterministic visible merged findings from raw candidates.
- `components/review/tests/review-core.test.ts`, `components/review/tests/review-controller.test.ts`, and only any directly affected policy tests: falsify plan validation, focus scheduling, item completion, candidate identity/merge selection, receipt provenance, and retained existing terminal safety behavior.
- `docs/review.md`, `README.md`, `skills/reviewer/SKILL.md`, `skills/review-verifier/SKILL.md`: describe the single planner, coverage groups versus focuses, global pipelining, and conservative duplicate publication behavior.

## Sequence

1. **Establish typed plan and run vocabulary.** Add the bounded `ReviewFocus` contract under a coverage group, focus lifecycle/result state, the explicit `focuses.length <= budgets.maxFocuses` cap, raw candidate focus provenance, and visible merged-finding representation. Keep prior receipt fields additive/readable and make raw candidates the audit source.

2. **Give the planner complete, sealed evidence and validate the adaptive plan.** Replace manifest-order diff truncation with fair controller-bounded per-item excerpts. Add the non-terminating `read_sealed_review_diff(itemId, chunkIndex)` controller tool over fixed sealed-diff chunks, never live paths, so the planner can inspect added, modified, renamed, and deleted content beyond excerpts. Generalize role launch/envelope APIs from one terminating result tool to an explicit custom-tool list: admit every supplied schema in the extensionless static allowlist, pass the reader and result tool to `runFresh`, and serialize/count both during planner preflight. Update the planner terminating tool and parser to require coverage groups plus focuses. Render a focus-specific reviewer assignment from typed question/checks/context rather than planner prose. Compile a graph only if every selected item appears in at least one group and one focus, each group has unique internal item IDs and child-focus coverage, each focus is valid and bounded under its parent, and no focus selects items outside that parent. Test every invalid tool and graph boundary before controller changes.

3. **Pipeline focus work under one cap.** Refactor the controller's review/verify stages into a controller-owned bounded job scheduler. Seed reviewer jobs for all focuses; enqueue a verifier job only after a finding-bearing reviewer succeeds; record each focus's transitions and failures; do not mark selected items complete until scheduler quiescence and all their assigned focuses are successful. Reuse the existing `runRole`, model routing, envelope measurement, active-agent cancellation, and receipt mechanisms rather than introducing a runner or queue subsystem.

4. **Merge only certain overlapping duplicates for presentation.** After all raw focus candidates have their own verifier decisions, derive visible findings deterministically. Merge only equal path/side/category/unique changed range/normalized anchor/normalized `summary`+`impact`; normalization is CRLF/CR→LF, NFC, JavaScript whitespace-run collapse, and trim only—never case-folding or punctuation rewriting. Use the highest-severity non-rejected candidate as representative and stable candidate ID to break ties. Keep any uncertain identity separate and preserve every raw candidate/decision/focus relation in the run receipt.

5. **Reconcile role instructions and public contract.** Update review skills and documentation to teach one planner how to separate coverage groups from focus investigations, prohibit generic padded focuses, explain review-to-verification pipelining and global concurrency, and state the conservative duplicate rule. Do not document or implement PR-AF-only phases.

6. **Prove behavior and regressions.** Extend the core test graph with valid overlapping focuses and every fail-closed planner invariant. Extend the controller double to demonstrate a verifier begins while an unrelated focus reviewer remains active, an item stays incomplete after one overlapping focus/verifier fails, exact-identical non-rejected candidates merge with a stable representative, and uncertain/rejected candidates do not alter visible output. Re-run existing cancellation, policy-envelope, typed-submission, anchoring, workspace, and receipt compatibility cases.

## Acceptance And Backpressure

- AC-001–AC-003: type/parser/graph/policy tests must prove cohesive overlapping groups, `maxFocuses`-bounded overlapping focuses, a one-item change admitting two focuses, two groups admitting three focuses, all-item focus coverage, per-group child-focus coverage, focus parent subsets, paths/tier/IDs, and focus-specific prompt rendering. An over-cap or otherwise malformed plan fails before reviewer launch.
- AC-004: controller scheduling test must observe a verifier launch while a separate reviewer is still blocked, never exceed `budgets.maxConcurrency` across combined reviewer and verifier work, and prove failed focus work leaves every affected selected item incomplete.
- AC-005: merge tests must show exact identity-certain candidates compact to one visible representative independent of completion order; CRLF/LF, NFC, and whitespace normalization behavior is reproducible; case, punctuation, ambiguous anchors, mismatches, and rejected candidates cannot change visible content/severity. Receipt assertions retain all raw candidate and decision provenance.
- AC-006–AC-007: focused tests plus `docs/review.md`/skills/README updates must agree with the new behavior; existing typed-output, authority, anchoring, policy, and terminal-cause tests remain green.
- AC-008: inspect role call counts in controller tests: fast/balanced still launch one planner and no pre-planner model role. The new scheduler is controller code, not a new model phase.
- AC-009: role tests must prove fair excerpts contain every selected item, the diff reader returns deterministic sealed old/new chunks for known IDs, and unknown IDs/invalid chunks are rejected without repository-path access. Policy/controller tests must prove planner envelope bytes include both reader and terminating schemas and extensionless launch admits both tools.

## Risks And Failure Modes

- **Focus explosion or padded plans:** controller focus cap and fail-closed graph validation bound work; planner skill requires zero unnecessary focuses, but quality remains a measured future concern.
- **Premature completion from overlapping assignments:** derive `completedItemIds` only after the focus lifecycle settles rather than mutating it inside individual reviewer success paths.
- **Deadlock or accidental role oversubscription:** a single scheduler owns permits for both reviewer and verifier jobs; no role awaits a child while holding a permit.
- **Receipt/API ambiguity:** retain raw candidate data and add visible merged output/provenance rather than replacing historical `findings` without an audit boundary.
- **Incorrect deduplication:** merging is intentionally exact and deterministic; any unresolved anchor, text mismatch, category mismatch, or rejected-only source leaves candidates separate or hidden according to the specification.
- **Capacity reservation failure after a reviewer completes:** preserve the existing policy-input failure path, record the focus failure, and leave affected items incomplete rather than treating an absent verifier as success.

## Integration Points

- `ReviewController` remains the sole review lifecycle owner and continues to call `ManagedSubagentService.runFresh` with controller-supplied terminating tools and read-only authority policy.
- `review-planner`, `reviewer`, and `review-verifier` remain the only review roles and use existing model routes; their typed schemas change together.
- Ralph continues to consume only complete shared-review results. It requires no new role or pipeline: focus-derived incomplete coverage remains an ordinary non-complete review outcome.

## Rollback Or Recovery

The change is local, user-local receipts are append-only, and no external side effect is introduced. A review run with invalid plan or focus failure ends incomplete and leaves its receipt for inspection. If regression evidence requires reverting, restore the prior group-as-assignment controller behavior in a source rollback; do not mutate old receipts or infer new focus state for them.

## Related Records

- `.ledger/202608160933-adapt-review-planning-for-speed/specs/adaptive-focus-review.md`
- `.ledger/202608160933-adapt-review-planning-for-speed/decisions/focus-layer.md`
- `.ledger/202608160933-adapt-review-planning-for-speed/research/pr-af-comparison.md`
