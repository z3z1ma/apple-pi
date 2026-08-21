Status: done
Created: 2026-08-16
Updated: 2026-08-16

# Slim review planning and drop review token gates

## Scope

Make review planning a cheap classification step and stop review token-budget machinery from aborting real review work.

The planner remains one fresh read-only role. It receives the selected-file manifest, short controller-owned excerpts, parent background or authority context, and the group/focus caps. It emits cohesive coverage groups and concrete focuses from that input. It does not receive a sealed-diff reader, does not reconstruct complete diffs, and does not perform the review.

Review keeps turn, concurrency, timeout, and group/focus caps. It stops using aggregate token ceilings, reservation arithmetic, `maxPromptBytes` admission, and role `maxTokens` envelopes to refuse or abort work. Usage may still be recorded. Ralph token budgets stay Ralph-owned.

If the earlier receipt finding remains after those removals, receipt validation must reject duplicate group IDs the same way `compileReviewWorkGraph` already does.

## Non-goals

- Adding a second planner wave, group-local focus planners, or any other mandatory model phase before review.
- Changing reviewer or verifier investigation depth, finding contracts, conservative verification, or focus-level pipelining.
- Changing Ralph, Agent, or Pi Exec token/turn/timeout policy except the review-side `constraints.maxTokens` handoff that currently injects a review token ceiling.
- Reintroducing caller-facing numeric budget fields on the public review tool or `/review` command.
- Broad receipt-schema cleanup unrelated to unused token-admission fields or the duplicate-group-ID gap.
- Reviewing binary files or binary diffs.

## Acceptance Criteria

- AC-001: The planner prompt contains the selected-item manifest, short excerpts for those items, optional parent background/authority context, and the stated `maxGroups`/`maxFocuses` caps. It does not mention, include, or admit `read_sealed_review_diff`.
- AC-002: The planner role remains one model invocation. Fast and balanced reviews still launch no model phase before that planner and no additional planner after it.
- AC-003: Planner instructions require cohesive groups and bounded focuses from filenames, short excerpts, and parent context. They forbid investigating defects, reconstructing complete diffs, or treating planning as a pre-review.
- AC-004: Planner thinking is low. The planner still uses the dedicated planner model route; only its reasoning effort is reduced.
- AC-005: A review role launch is not refused or aborted because estimated, reserved, or aggregate tokens exceed a review `maxTokens` or `maxPromptBytes` ceiling. Turn, concurrency, timeout, and group/focus caps remain in force. Incomplete work caused by those remaining caps stays incomplete.
- AC-006: Review receipts and summaries may record observed token usage. They no longer use `aggregate_token_ceiling` as a review-owned terminal cause. Historical receipts that contain the old cause remain readable.
- AC-007: Ralph continues to enforce its own token budget. It no longer forwards a remaining-token ceiling into review as `constraints.maxTokens`.
- AC-008: Receipt validation rejects a work graph whose groups repeat an ID, matching `compileReviewWorkGraph`'s `duplicate_group_id` rule.
- AC-009: Focused tests and `docs/review.md`, planner skill, and README wording match the slim planner and the removed review token gates. Tests that exist only to enforce review token reservation, `maxPromptBytes` admission, or the sealed-diff reader are updated or removed because that contract is gone.

## References

- `.ledger/202608162041-slim-review-planner-drop-token-gates/research/live-planner-bottleneck.md`
- `.ledger/202608162041-slim-review-planner-drop-token-gates/specs/slim-planner-and-review-limits.md`
- `.ledger/202608162041-slim-review-planner-drop-token-gates/decisions/single-slim-planner.md`
- `.ledger/202608162041-slim-review-planner-drop-token-gates/decisions/drop-review-token-gates.md`
- `.ledger/202608162041-slim-review-planner-drop-token-gates/plans/implementation.md`
- `components/review/src/roles.ts`
- `components/review/src/policy.ts`
- `components/review/src/controller.ts`
- `components/review/src/receipts.ts`
- `components/ralph/src/controller.ts`
- `docs/review.md`

## Assumptions

- User-ratified: planning is classification, not review. The planner needs file identity, rough diff contents, and parent context, with minimal exploration.
- User-ratified: a map-reduce second planner wave is a considered idea, not the required design. The useful knob is a known group/focus cap.
- User-ratified: review token budgets, reservation arithmetic, and token-tracking gates are bloat that abort useful work and should be removed for this iteration.
- Record-backed: live scoped review `92c7e48c-80d6-4a18-987e-2649479447f0` spent 6m 46s in one planner, then refused seven later focuses with `insufficient aggregate policy capacity after rendered prompt measurement` at 516,012 / 600,000 tokens.
- Record-backed: the sealed-diff reader finding is caused by a planner tool this task removes. The duplicate-group-ID receipt gap is independent and remains in scope.
- Decision-backed: keep one slim planner. `.ledger/202608162041-slim-review-planner-drop-token-gates/decisions/single-slim-planner.md`.
- Decision-backed: drop review token gates; keep turn, concurrency, timeout, and group/focus caps. `.ledger/202608162041-slim-review-planner-drop-token-gates/decisions/drop-review-token-gates.md`.

## Journal

- 2026-08-16: Opened after the live adaptive-focus review showed a 6m 46s planner and a later token-admission abort. The operator asked to slim planning, keep group/focus caps, drop review token budgets, and address leftover findings only if they survive that change.
- 2026-08-16: Operator closed the task. No further work in this bundle.

## Blockers

None.

## Evidence

- Done: Slim planner, dropped review token admission, and Ralph no longer forwarding remaining review tokens as `constraints.maxTokens` landed in `7b63dca`.
- Done: Later same-day review work in that commit also removed review turn envelopes (`maxTurns: 0`) and required first-cycle verification for `complete`.
- Done: Operator judged the review loop done after live scoped run `8edb2701-dd07-4340-bde2-7636debd33a7` and stated there will be no further work on this task.

## Review

Operator close. The operator stated both this task and the same-day adaptive-review-planning task are done by their standards. No further Ralph iteration or independent review was requested.

## Retrospective

The live abort was a long planner plus token-admission math, not missing investigation depth. Removing the sealed-diff reader and review token gates unblocked the loop. Later same-day work moved past this task's original turn-cap assumption; that belongs to the live review docs and code, not a follow-on in this bundle.

## Distillation

No promotion needed: the live slim-planner and no-review-token-gate contract is already in `docs/review.md`, packaged review skills, README, and `components/review`. This bundle stays historical.
