Status: done
Created: 2026-08-18
Updated: 2026-08-18

# Implementation plan

## Outcome

One observer-paced curator loop replaces the three-stage consolidation
pipeline. Default `observeAfterTokens` is 20,000. Reflection and pool-over-target
no longer launch work. Drop guardrails recompute from live same-pass state.

## Current-System Evidence

- `consolidation-trigger.ts` launches on any of three clocks and calls
  `runObserver` → `runReflector` → `runDropper`.
- `runDropper` snapshots `metrics`, `maxDropsAllowed`, `allowed`, and
  `coverageById` before the loop.
- `runReflector` snapshots `allowedObservationIds` before the loop.
- Defaults: `observeAfterTokens` 10,000, `reflectAfterTokens` 20,000,
  `observationsPoolTargetTokens` 10,000, `agentMaxTurns` 16 per stage.

## Change Surfaces

- `components/memory/src/config.ts` — `observeAfterTokens` 20,000;
  `agentMaxTurns` 24 so one pass can observe, then reflect, then drop.
  `observationsPoolTargetTokens` stays 10,000.
- `components/memory/src/agents/dropper/agent.ts` — export
  `resolveDropGuardrails` for live recompute.
- `components/memory/src/agents/curator/` — sequenced prompt and `runCurator`.
- `components/memory/src/hooks/consolidation-trigger.ts` — one launch clock,
  one model call, ledger writes after the loop.
- `components/memory/src/runtime.ts`, `commands/status.ts`, sidecar agent
  type, `docs/context.md`.

## Sequence

1. Record the 20k clock and live-recompute constraint.
2. Extract live drop guardrails.
3. Add curator prompt/agent. Observe confirmation must not end the pass.
4. Switch the pipeline to `runCurator`.
5. Update status, runtime errors, docs, and tests.

## Acceptance And Backpressure

| Criterion | Class | Check |
| --- | --- | --- |
| AC-001 | production | Pipeline calls `runCurator` once; sidecar agent is `curator`. |
| AC-002 | invariant | `drop_observations.execute` and final selection call `resolveDropGuardrails` on live state. |
| AC-003 | invariant | `record_reflections` accepts ids recorded earlier in the same pass. |
| AC-004 | invariant | Existing builders write four separate ledger types with `coversUpToId`. |
| AC-005 | invariant | Existing `normalizeSourceEntryIds` still rejects unknown chunk ids. |
| AC-006 | production | Empty pass writes nothing, does not advance coverage, arms observer backoff. |
| AC-007 | documentation | `docs/context.md` states the single 20k clock and unused `reflectAfterTokens`. |

## Risks And Failure Modes

- One low-thinking pass may be too generous or too conservative. Revisit by
  splitting roles, not by adding a hidden second clock.
- 24 turns can still starve later jobs if observe burns the budget. Receipts
  tell the model to proceed after the chunk is covered.

## Integration Points

Sidecar usage agent `curator`, trigger `observeAfterTokens`. Existing recall
and projection consume unchanged ledger types.

## Rollback Or Recovery

Restore the three-stage pipeline and 10k observe default. Ledger format is
unchanged.

## Related Records

- `decisions/observer-paced-curation.md`
- `task.md`
