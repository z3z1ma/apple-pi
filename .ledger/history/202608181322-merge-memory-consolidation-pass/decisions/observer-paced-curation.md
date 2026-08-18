Status: active
Created: 2026-08-18
Updated: 2026-08-18

# One observer-paced curation pass

## Context

Observer, reflector, and dropper already share one model, lock, and abort signal,
but they are three sequential `agentLoop` calls. The observer's input is a
superset of the folded pool the later stages re-send. A naive concatenation is
wrong because dropper guardrails are computed from a pre-loop snapshot that
becomes stale when the same pass records new observations or reflections.

The task requires one model call when today's pipeline would run multiple
stages, and it requires the three launch clocks to collapse toward one.

## Decision

Launch the merged curator on the observer clock (`observeAfterTokens`). The
package default is 20,000 tokens (user-ratified: 10,000 was too frequent).
`observationsPoolTargetTokens` stays 10,000 as an inner drop budget, not a
launch clock. That single pass may observe, reflect, retire, and drop.
`reflectAfterTokens` and pool-over-target cease to be independent launch clocks.

Inside the pass:

- Observation remains first in ledger-write order and still validates source
  ids against the serialized chunk.
- Reflection and retirement see observations accepted earlier in the same pass.
- Drop selection recomputes coverage tiers, pool metrics, and
  `maxDropsAllowed` at tool-execute time and again at final selection, using
  that same-pass state.
- A pass that accepts nothing writes no ledger entries, advances no coverage,
  and arms the observer empty backoff.

Do not close over start-of-pass snapshots. `record_reflections` must resolve
supporting observation ids against the live set (prior active plus those just
recorded). `drop_observations` and final candidate selection must recompute
pool metrics, coverage, maintenance eligibility, and the drop cap from that
same live set. A captured `allowedObservationIds`, dropper `allowed`,
`maxDropsAllowed`, or `coverageById` from loop construction is the current
three-stage bug and is not allowed in the curator.

The curator prompt is a sequenced three-job contract, not a concatenation of
the three stage prompts. Observation confirmation must not end the pass. A
chunk that yields no new observations may still reflect and drop. Default
`agentMaxTurns` is 24 so observe batches cannot consume the entire old
per-stage cap of 16.

`reflectAfterTokens` remains in config as unused compatibility until a later
task removes it. It does not launch work.

## Authority And Provenance

- Task AC-001, AC-007, and WI-003.
- Baseline research: the trio is under 1% of measured spend; this merge is for
  call count, latency, and one clock, not cost.
- Prior analysis: an observer-paced loop raises reflection cadence (~64% more
  often under defaults) and does not materially change token cost.

## Alternatives Considered

### Keep three launch clocks, one call when any is due

Steelman: reflection stays on its slower clock, so law is not rewritten every
observation chunk. The model is asked only for the stages that are due.

Rejected because AC-007 requires the clocks to collapse, and a partial prompt
still has to decide whether a due-only dropper can see same-pass observations
that were not requested. One always-complete curator is the smaller contract.

### Keep `reflectAfterTokens` as an inner skip

Steelman: same launch clock, but the curator is told not to reflect until the
old reflection threshold is met. Preserves today's reflection frequency.

Rejected as a hedged second clock. If reflection quality regresses, restore a
separate reflector rather than leave a dormant inner gate.

## Consequences

- Reflection and drop run whenever there is a new observation chunk, not only
  after a separate reflection clock or a pool overflow. With the 20k observe
  default, reflection cadence matches the old `reflectAfterTokens` default;
  observation itself is less frequent than the old 10k clock.
- Sidecar usage should show one `observer`-paced curator call where three
  stage calls used to appear. The merged agent name is `curator`.
- Users who tuned `reflectAfterTokens` independently will see that knob stop
  launching work. Document this in `docs/context.md`.

## Limits And Revisit Conditions

Revisit if compacted-context quality drops because one low-thinking pass cannot
be generous about observations and conservative about drops at the same time.
The remedy is to split roles again, not to add a hidden second clock.

## Related Records

- `.ledger/202608181322-merge-memory-consolidation-pass/task.md`
- `.ledger/history/202608181322-account-sidecar-model-usage/research/quota-spend-baseline.md`
