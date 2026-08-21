Status: active
Created: 2026-08-16
Updated: 2026-08-16

# Drop review token gates

## Context

Review currently derives `maxTokens` and `maxPromptBytes`, estimates each role prompt, reserves expected-request tokens, and refuses launch when remaining capacity cannot cover the reservation. Live run `92c7e48c` reached 516,012 of 600,000 tokens and then refused seven focuses with `insufficient aggregate policy capacity after rendered prompt measurement`. The operator called token budgets and their tracking bloat and asked to drop them for this iteration. They want turn/step and group/focus caps kept.

The earlier harness-owned-limits task made those token fields controller-owned rather than caller-owned. It did not make them a useful product knob. Ralph still has its own token budget and currently forwards the remainder into review as `constraints.maxTokens`.

## Decision

Remove review-owned token ceilings as control surfaces:

- no review `maxTokens` launch refusal;
- no reservation arithmetic;
- no `maxPromptBytes` admission refusal;
- no live abort when settled plus inflight tokens cross a review token ceiling;
- no review terminal cause `aggregate_token_ceiling` for new runs;
- no Ralph-to-review `constraints.maxTokens` handoff.

Keep and continue to enforce:

- `maxGroups` and `maxFocuses`, stated to the planner;
- `maxConcurrency`;
- per-role turn caps;
- elapsed-time timeout;
- cancellation, authority, compaction, invalid-output, and workspace-conflict fail-closed paths.

Continue recording observed token usage on receipts and summaries. Ralph may still stop its own loop on Ralph token exhaustion; that stop happens in Ralph, not by shrinking review.

If a role prompt cannot physically fit the resolved model context window, fail that role as invalid or unlaunchable input with a non-token-budget cause. That is a model-context fact, not a review spending policy.

## Authority And Provenance

- User-ratified: review token budgets are not useful and are breaking runs.
- User-ratified: turn/step limits and group/focus caps are the useful knobs.
- Research: `.ledger/202608162041-slim-review-planner-drop-token-gates/research/live-planner-bottleneck.md`.
- Prior contrary authority: the earlier harness-owned-limits work made token ceilings controller-owned rather than caller-owned. This decision removes them from review control, not from Ralph.

## Alternatives Considered

### Raise review `maxTokens` until current models fit

This would paper over the live 600k abort without deleting the reservation machinery. The next larger change would hit the same gate. The operator rejected tracking this class of budget.

### Keep accounting but stop using it to refuse work

Silent unused fields are a second implementation. If tokens do not control admission or abort, the reservation code, `budgetExceeded` flag, and envelope token fields have no production consumer.

### Remove Ralph token budgets too

The operator scoped the complaint to review. Ralph iterations are a different spend loop and already use iteration count as their primary bound. Leave Ralph token policy alone except the review handoff.

## Consequences

- `deriveRoleEnvelope` and `ReviewController.runRole` lose reservation and review-token abort logic.
- `StartReviewOptions.constraints` no longer carries `maxTokens`.
- Receipts remain readable when they still contain old token-envelope fields or `aggregate_token_ceiling`.
- Tests that expect a review token-ceiling abort must change to the remaining caps or be removed.
- Review can spend more model tokens than today. Turn, concurrency, timeout, and group/focus caps remain the runaway controls.

## Limits And Revisit Conditions

Revisit a review spending ceiling only after a measured runaway exists that turn, timeout, and focus caps do not stop. Do not restore reservation arithmetic to make summaries look precise.

## Related Records

- `.ledger/202608162041-slim-review-planner-drop-token-gates/specs/slim-planner-and-review-limits.md`
