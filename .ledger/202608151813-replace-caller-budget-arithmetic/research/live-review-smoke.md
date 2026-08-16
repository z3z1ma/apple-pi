Status: done
Created: 2026-08-16
Updated: 2026-08-16

# Live review smoke and hot-path diagnosis

## Question Or Hypothesis

Can the currently shipped review pipeline complete a small implementation-and-test review using the normal Pi environment, and which observed failures or hot-path structures make caller-selected numeric budgets a poor repair boundary?

## Motivation

The operator reports review as broken and unusable, beyond the caller budget UX. A live run is needed to distinguish an actual pipeline defect from an inferred default-limit problem before changing public contracts.

## Sources And Methods

- Live normal-environment review run `939c6d47-6177-4c52-9672-f8931f6cd4de`, executed 2026-08-16 against a disposable nested Git repository containing a two-file implementation-and-test workspace change. The repository was removed after the run. The durable receipt is at `$PI_CODING_AGENT_DIR/reviews/runs/3965ef999ed9851ab496dddf/939c6d47-6177-4c52-9672-f8931f6cd4de.jsonl`.
- Persisted planner child session recorded by that receipt.
- `components/review/src/index.ts`, `controller.ts`, `roles.ts`, `types.ts`, `work-graph.ts`, `receipts.ts`.
- `components/subagents/src/agent-runner.ts` and `usage.ts`.
- Focused deterministic check: `npm run test:unit -- tests/review-core.test.ts tests/review-controller.test.ts`, 13 passing tests on 2026-08-16.
- An earlier live attempt with a temporary `PI_CODING_AGENT_DIR` is excluded: the operator identified that override as invalid for their authentication configuration.
- Follow-up live normal-environment review run `5fb7f785-82db-4804-a2f0-6bf82bdaff2c`, executed 2026-08-16 against the same disposable two-file change after typed result-tool implementation. Its receipt remains under `$PI_CODING_AGENT_DIR/reviews/runs/`.

## Findings

### Observed live failure

- The normal-environment model call succeeded: `openai-codex/gpt-5.6-luna` completed the planner in about 8.7 seconds using 1,654 input and 257 output tokens (1,911 total).
- The planner returned one valid group containing both changed files and omitted only `contextPaths` because no extra context was needed.
- `parsePlannerOutput()` unconditionally calls `stringArray(group.contextPaths, ...)`. The skill describes `contextPaths` as optional, but the parser requires it. The run failed at planning with `groups[0].contextPaths must be an array`, marked both selected items failed, produced no findings, and never launched reviewer or verifier.
- This is a deterministic schema-contract mismatch. Treating it as a budget failure, retrying with a larger budget, or changing the model would not repair it.
- The follow-up run completed with coverage 2/2, one independently confirmed minor finding, and no reported limitation. It proves the planner, reviewer, and verifier can use controller-supplied terminating typed result tools in extensionless managed sessions; it does not establish whole-repository scaling behavior.

### Hot-path observations

- Normal review starts one planner, one reviewer per semantic group, and one verifier per group containing at least one finding. The planner can emit up to 32 groups, so the controller can create 1 + groups + finding-bearing-groups fresh sessions.
- The model-facing review schema and normal slash command expose aggregate tokens, time, concurrency, max groups, three role turn limits, and prompt size. The controller already fills defaults when omitted, so those numbers express implementation arithmetic rather than necessary review intent.
- `ReviewController.runRole()` turns `steered` and `aborted` into a generic budget classification. Its outer failure logic then separately labels an aborted controller as an operator stop. The result can lose the actual cause of provider failure, timeout, controller token gate, turn cap, or cancellation.
- Planner/reviewer/verifier parsers require several empty arrays. `contextPaths` is now observed to fail live; optional empty result arrays such as reviewer `findings`/`residualRisk` and verifier `residualRisk` have the same structural fragility.
- Aggregate usage is correctly accumulated from message-end deltas rather than cumulative cache reads. No accounting double-counting was established in this investigation.

## Conclusions

1. Replace prose JSON role output with controller-supplied typed terminating result tools, normalize truly optional empty collections inside captured arguments, and retain the successful live smoke as regression evidence.
2. Remove raw resource arithmetic from ordinary review model and command interfaces. Retain `fast`, `balanced`, and `thorough` as semantic review profiles; the controller derives and records one resolved internal policy from sealed input size and profile.
3. Keep hard ceilings, cancellation, bounded concurrency, receipt accounting, and controller-only enforcement. Expose named terminal causes rather than inferring budget exhaustion from generic agent status.
4. Apply the same public-ownership rule to Ralph, Agent/nested Agent, and Pi Exec after review establishes the shared policy primitives; do not use review's live failure to assume an unverified bug in those surfaces.

## Limits

- The initial live run did not reach reviewer or verifier because planner parsing failed; the follow-up typed-tool run reached both and completed. Larger changes, high-risk routing, prompt-capacity preflight, cancellation, and provider failure behavior remain unverified live.
- The provider spend and elapsed time of full review are not measured.
- The unavailable temporary-agent-dir run is not evidence about the operator's normal authentication or credits.

## Related Records

- `.ledger/202608151813-replace-caller-budget-arithmetic/research/current-state.md`
