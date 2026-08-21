Status: active
Created: 2026-08-16
Updated: 2026-08-16

# Make execution limits harness policy, not model arithmetic

## Context

Normal review currently exposes eight numeric resource controls although the controller already supplies defaults. A live review failed before review work began because a planner omitted an optional no-op field, demonstrating that model-output contract fragility—not caller token selection—is a present root cause. Ralph nests review limits, Agent exposes per-call turns, and Pi Exec exposes process resource arithmetic.

## Decision

- Ordinary model-facing calls express only behaviorally meaningful intent. Review retains existing `fast`, `balanced`, and `thorough` profiles; Ralph retains mode and task roots; Agent retains task/agent semantics; Pi Exec retains program and display intent.
- Controllers derive one resolved internal policy from sealed workload and semantic profile, enforce it internally, and persist the resolved policy and measured usage in receipts.
- Raw numeric tokens, turns, timeouts, groups, concurrency, memory, call-count, and worker-count controls are removed from normal model schemas and normal slash-command UX.
- Existing profiles select routing and policy together. A profile is not a disguised numeric override.
- Hard package maxima, cancellation, resource accounting, bounded concurrency, prompt/input limits, and internal role limits remain controller-owned safety controls.
- Review role output is submitted only through controller-supplied terminating typed tools. `ManagedAgentRequest` threads those SDK custom tools through the manager/runner into `createAgentSession`; the controller captures validated tool arguments and never parses a role's prose result as a fallback. A missing or inconsistent submission fails closed as invalid output.
- Terminal outcomes carry an explicit cause: operator stop, external cancellation, elapsed-time ceiling, aggregate-token ceiling, role-turn ceiling, compaction, provider failure, invalid output, authority denial, input/workspace conflict, or internal error. Generic agent statuses do not determine the cause by themselves.
- A future trusted configuration escape hatch requires a demonstrated operational consumer and explicit schema. None is introduced in this change.

## Authority And Provenance

The operator authorized replacing caller budget arithmetic and repairing the review process on 2026-08-15/16. The live run and current-state research establish omission support, the parser failure, current public surfaces, and controller enforcement.

## Alternatives Considered

- Keep numeric overrides in ordinary APIs: preserves expert control but continues asking models to estimate hidden nested accounting and makes defaults look like unreliable caller responsibilities.
- Remove all ceilings: avoids premature stopping but permits uncontrolled spend, elapsed time, concurrency, and worker growth.
- Add an `effort` field: duplicates existing review profiles unless it changes observable review semantics; rejected until a separate consumer exists.
- Retry malformed model output: rejected. It masks a deterministic contract mismatch, adds spend, and converts a typed-boundary defect into probabilistic behavior. The role receives a typed terminating result tool instead.

## Consequences

- Receipts need a versioned or additive resolved-policy representation and explicit terminal cause.
- Existing tests that construct raw controller budgets remain internal test fixtures, not public contracts.
- Review role output must move to typed result tools before live pipeline re-validation; tolerant normalization applies only to genuinely optional empty collections inside validated tool arguments.
- Ralph integration must stop translating review policy into caller arithmetic.

## Limits And Revisit Conditions

Revisit trusted numeric configuration only after operators demonstrate a recurring operational need that profiles and safe policy derivation cannot cover. Do not infer model/provider failures from terminal agent status alone.

## Related Records

- `.ledger/202608151813-replace-caller-budget-arithmetic/research/current-state.md`
- `.ledger/202608151813-replace-caller-budget-arithmetic/research/live-review-smoke.md`
