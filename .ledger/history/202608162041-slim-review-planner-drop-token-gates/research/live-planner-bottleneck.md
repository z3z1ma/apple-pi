Status: done
Created: 2026-08-16
Updated: 2026-08-16

# Live planner cost and leftover findings

## Question Or Hypothesis

Did the live review fail because planning needs another model phase, or because one planner is over-equipped and review token-admission math refuses later roles?

**Falsifiable hypothesis:** the planner already produced a valid overlapping graph from one invocation; wall-clock and coverage failure came from planner over-equipment plus aggregate token reservation, not from missing group-local focus planners.

## Motivation

The operator described planning as classification: file list, rough diff contents, parent context, and a known group/focus cap. They floated a map-reduce of group planners after the first split, and they asked to drop review token budgets. The answer decides whether this task adds a second planner wave or slims the existing one.

## Sources And Methods

- Live receipt `/Users/alexanderbut/.pi/agent/reviews/runs/306bab3d2c1a6932237c717e/92c7e48c-80d6-4a18-987e-2649479447f0.jsonl`, run `92c7e48c-80d6-4a18-987e-2649479447f0`, read 2026-08-16. Method: parsed event timestamps, graph, failures, and agent usage.
- Earlier abort receipt `/Users/alexanderbut/.pi/agent/reviews/runs/f4e5ea2688032efb83a59f99/69dd5b97-8f21-4973-b937-c047dd82eeb9.jsonl`, run `69dd5b97-8f21-4973-b937-c047dd82eeb9`. Method: confirmed planner sealed an overlapping graph before `workspace_conflict`.
- Current source at workspace `HEAD` plus uncommitted review changes: `components/review/src/{roles,policy,controller,receipts,types}.ts`, `components/ralph/src/controller.ts`, `skills/review-planner/SKILL.md`, `docs/review.md`.
- Prior ledger contracts for adaptive-focus review and harness-owned limits, inspected as historical context only.

No new review was executed for this record.

## Findings

### Observations

1. **The scoped review's planner already succeeded.** Run `92c7e48c` sealed 8 groups and 13 focuses. Several selected items appeared in multiple groups, including `types.ts` in five groups and `controller.ts` in three. Reviewers started. The overlapping-group validator was not the failure.
2. **Planning dominated wall-clock.** Event span was 729.4s. The planner completed at +406.1s (6m 46s). First-wave review and verification then ran until +573.0s, when seven remaining focuses failed admission. In-flight reviewers finished by +728.8s.
3. **Coverage failed on token admission, not planner output.** Eighteen of 21 items failed with `reviewer has insufficient aggregate policy capacity after rendered prompt measurement`. Settled usage was 516,012 / 600,000. Six focuses completed; seven never launched.
4. **The planner is equipped like a reviewer.** `plannerPrompt` injects fair excerpts plus an instruction to use `read_sealed_review_diff`. `ReviewController.plan` admits that reader as a custom tool. The planner skill tells the model to inspect complete old/deleted diffs and invent change-specific checks. Planner fallback thinking is `high` unless `modes.json` overrides it (`controller.ts` `resolveModel`).
5. **Token gates are the abort mechanism.** `deriveRoleEnvelope` estimates prompt tokens, multiplies by expected requests (2 or 3), and refuses launch when remaining `maxTokens` minus live reservations cannot cover that reservation. `runRole` also aborts live work when settled plus inflight usage reaches `run.budgets.maxTokens`. Balanced profile `maxTokens` is 600,000. Ralph currently forwards leftover Ralph tokens as `constraints.maxTokens`.
6. **The sealed-reader finding depends on a tool this task would remove.** `createSealedReviewDiffReader` advertises `chunkCount` but caps accepted calls at `floor(32 / min(items, 32))` and increments the global counter before validation. That defect is real against the current reader. It has no consumer if the planner no longer receives the reader.
7. **The duplicate-group-ID receipt finding is independent.** `compileReviewWorkGraph` throws `duplicate_group_id`. Receipt validation checks intra-group item uniqueness, then `new Map(groups.map(...))` collapses duplicate IDs. A persisted receipt can therefore describe a graph the compiler would reject.

### Inferences

- A second planner wave would add another mandatory model phase after a planner that already emitted a valid graph. That contradicts the live bottleneck and the existing AC-008 rule against extra planning phases.
- The planner does not need complete diffs to form cohesive groups. File paths, statuses, short excerpts, and parent context are the classification inputs the operator named.
- Group/focus caps remain useful because they are visible to the planner and bound fan-out. Token reservation is not visible to the planner and aborted later review work after planning had already succeeded.
- Removing the reader retires the quota finding. The receipt ID check remains a real compiler/receipt split.

## Conclusions

**Confidence: high** that this task should slim the existing planner and delete review token-admission/abort machinery rather than add group-local planners.

**Confidence: high** that the sealed-diff reader should be removed with the slim planner, which retires the significant live finding.

**Confidence: high** that receipt validation should reject duplicate group IDs; that finding survives the planner/budget change.

**Confidence: high** that Ralph may keep its own token budget but must stop injecting that remainder into review as `constraints.maxTokens`.

## Limits

- This is one live balanced run plus source inspection, not a latency benchmark suite.
- Planner quality after removing complete-diff access is unmeasured. The operator explicitly accepted that trade for speed and to stop pre-review.
- Historical schema-v1 receipts with token envelopes remain and must stay readable.

## Related Records

- `components/review/src/policy.ts`
- `components/review/src/roles.ts`
