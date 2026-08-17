Status: active
Created: 2026-08-16
Updated: 2026-08-16

# Implementation plan

## Outcome

Review planning becomes one low-thinking classification call over a file manifest, short excerpts, and parent context. Review no longer refuses or aborts work with token-reservation math. Group/focus, turn, concurrency, and timeout caps remain. Receipts reject duplicate group IDs. The sealed-diff planner reader is removed.

## Current-System Evidence

- `components/review/src/roles.ts` builds planner prompts with `fairDiffExcerpts`, documents `read_sealed_review_diff`, and implements `createSealedReviewDiffReader` with a 32-call global cap and per-item quota.
- `components/review/src/controller.ts` `plan()` admits that reader; `runRole()` calls `deriveRoleEnvelope`, reserves `reservationTokens`, passes `envelope.maxTokens`, and aborts when settled plus inflight tokens reach `run.budgets.maxTokens`. Planner fallback thinking is `high`.
- `components/review/src/policy.ts` derives profile `maxTokens`/`maxPromptBytes` and refuses launch when reserved capacity is insufficient. This is the live `policy_input` abort.
- `components/review/src/types.ts` still types `ReviewBudgets.maxTokens`, `maxPromptBytes`, `ReviewRoleEnvelope.reservationTokens`, `StartReviewOptions.constraints.maxTokens`, and terminal cause `aggregate_token_ceiling`.
- `components/review/src/receipts.ts` accepts overlapping group items but does not require unique group IDs.
- `components/ralph/src/controller.ts` computes `remainingReviewTokens` and passes `constraints.maxTokens` into `ReviewController.run`.
- Tests currently require the reader (`review-core.test.ts`, `review-controller.test.ts`, `review-policy.test.ts`) and a 60,000-token aggregate abort (`review-controller.test.ts`).

## Change Surfaces

- `components/review/src/roles.ts` and `skills/review-planner/SKILL.md`: remove the reader and complete-diff instructions; keep short excerpts; state caps; forbid pre-review.
- `components/review/src/controller.ts`: launch the planner with only the terminating plan tool; stop reserving/aborting on review tokens; force planner thinking low.
- `components/review/src/policy.ts` and `types.ts`: remove review token-admission fields and reservation behavior; keep group/focus/concurrency/turn/timeout derivation.
- `components/review/src/receipts.ts`: reject duplicate group IDs; keep historical `aggregate_token_ceiling` readable.
- `components/ralph/src/controller.ts`: stop forwarding `constraints.maxTokens` to review. Leave Ralph's own token loop intact.
- `components/review/tests/*`, `docs/review.md`, `README.md`: match the new contract; delete reader-only and review-token-admission tests.

## Sequence

1. **Slim the planner contract.** Delete `createSealedReviewDiffReader` and every planner instruction that names it. Keep a short per-item excerpt helper. Update the planner skill so groups and focuses come from the manifest, excerpts, and parent context. Add an explicit ban on findings and complete-diff reconstruction.

2. **Launch one low-thinking planner.** `plan()` admits only `submit_review_plan`. Planner `thinkingLevel` is `low` even when the route would have used high/xhigh. Preserve the existing planner model route.

3. **Remove review token gates.** Delete reservation accounting, `budgetExceeded` token abort, `constraints.maxTokens`, `maxPromptBytes` admission, and new-run `aggregate_token_ceiling` handling from review policy/controller/types. Keep turn, timeout, concurrency, and group/focus enforcement. Continue summing observed usage onto the run for display.

4. **Cut the Ralph handoff.** Ralph may still compare Ralph usage to Ralph `maxTokens`. It must not pass a remainder into review.

5. **Close the surviving receipt finding.** Receipt work-graph validation requires unique group IDs before building `groupsById`.

6. **Reconcile tests and docs.** Replace reader reconstruction tests with excerpt-presence tests. Remove or rewrite the aggregate token-ceiling controller test. Add a receipt test for duplicate group IDs. Update `docs/review.md` and README so planning is classification and review token ceilings are gone.

## Acceptance And Backpressure

- AC-001: planner prompt/tool tests prove the reader is absent and excerpts/manifest/caps/background remain.
- AC-002: controller tests still observe one planner role and zero pre-planner or post-planner planner roles.
- AC-003: planner skill and prompt contain the no-pre-review rule.
- AC-004: planner launch uses thinking `low`.
- AC-005: `deriveRoleEnvelope` / `runRole` have no review-token refusal path; a former 60k-token fixture can no longer stop a review for tokens.
- AC-006: new runs do not emit `aggregate_token_ceiling`; old receipts with that cause still load.
- AC-007: Ralph review invocation has no `constraints.maxTokens`.
- AC-008: receipt validation rejects duplicate group IDs.
- AC-009: docs and leftover reader/token tests match the deleted contract.

## Risks And Failure Modes

- **Coarser plans:** accepted. Reviewers still receive complete assigned diffs. Fail-closed graph validation still rejects uncovered items.
- **Prompt too large for a model window:** fail that role as unlaunchable input, not as a spending ceiling.
- **Ralph spend increases:** accepted for this task. Ralph still has iteration and Ralph-token stops.
- **Historical receipts:** keep unused token fields readable; do not rewrite old runs.

## Integration Points

- `ReviewController` remains the only review lifecycle owner.
- Ralph continues to consume complete or incomplete review outcomes; it just no longer budgets review tokens.
- Packaged skills stay `review-planner`, `reviewer`, and `review-verifier`.

## Rollback Or Recovery

The change is local. If planner quality collapses without excerpts-plus-reader, restore short excerpts first, not the complete-diff tool. If a runaway review appears, tighten turn, timeout, or focus caps rather than restoring reservation math.

## Related Records

- `.ledger/202608162041-slim-review-planner-drop-token-gates/specs/slim-planner-and-review-limits.md`
- `.ledger/202608162041-slim-review-planner-drop-token-gates/decisions/single-slim-planner.md`
- `.ledger/202608162041-slim-review-planner-drop-token-gates/decisions/drop-review-token-gates.md`
- `.ledger/202608162041-slim-review-planner-drop-token-gates/research/live-planner-bottleneck.md`
