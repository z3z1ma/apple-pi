Status: active
Created: 2026-08-16
Updated: 2026-08-16

# Dropper maintains the working set against current law

## Context

The dropper runs only when the same consolidation pass records new reflections, and only when the active observation pool is over target. A correct reflector no-op therefore leaves an overflowing changelog in place. The preservation floor also treats typical observer detail as unsafely unique forever.

## Decision

The dropper may run whenever the active observation pool is over `observationsPoolTargetTokens`. It judges candidates against current law, including reflections recorded earlier in the same pass. It does not require that pass to emit new reflections.

KEEP remains the action when uncertain. The preservation floor protects unique meaning that is not already present, at equivalent fidelity, in current law or a newer observation. Absorbed or superseded identifiers, paths, and errors may be dropped.

A deliberate no-drop verdict does not re-fire every turn over the same active set. Retry only after current law or the active observation set changes, or after another `observeAfterTokens` of new source tokens arrives. This matches observer empty backoff: KEEP-when-uncertain that cannot get under target must not pay a dropper call on every `turn_end` or `agent_start`.

Do not replace the dropper with a deterministic "cited ids are dropped" rule in this task.

## Authority And Provenance

- User-ratified: drop whenever the pool is over target.
- Decision-backed: compacted memory presents current working state. `.ledger/202608162324-distill-observational-memory-current-state/decisions/current-working-state.md`.
- Record-backed: same-run gate and keep-biased floor. `.ledger/202608162324-distill-observational-memory-current-state/research/what-memory-is-trying-to-express.md`.

## Alternatives Considered

### Keep the same-run gate and only drop more aggressively

This would avoid a new launch path and would still prevent drops until new law is written. The reflector is correctly told to emit zero when nothing is stable. That is exactly when an overflowing working set most needs maintenance. The operator rejected keeping the gate.

### Deterministic non-LLM drops of cited observations

This would be cheaper and more aggressive. Coverage is only "a current reflection lists this id," not "the reflection preserved this meaning with equivalent fidelity." False or inflated support ids would delete unique working evidence. The keep-when-uncertain LLM pass stays as the safety boundary.

## Consequences

- `anyStageDue` / `runDropperStage` must be able to launch dropper-only work when the pool is over target.
- Dropper prompt and ranking still prefer covered, superseded, and low-signal items, but the floor no longer locks absorbed detail.
- Consolidation tests that forbid dropper-only launch are updated because the contract changed.
- Runtime needs a dropper no-drop backoff of the same class as `observerEmptyBackoff`.

## Limits And Revisit Conditions

Revisit a deterministic pre-filter only after live sessions show the LLM dropper repeatedly proposing the same safe covered set and a citation-equality check would have matched those proposals. Do not add a silent clip of injected observations as a second dropper.

Revisit the backoff watermark only if live sessions show dropper starved after real law or pool changes, or still thrashing despite the no-drop lock. Do not restore the same-run gate to fix cost.

## Related Records

- `.ledger/202608162324-distill-observational-memory-current-state/specs/current-working-state.md`
- `.ledger/202608162324-distill-observational-memory-current-state/research/what-memory-is-trying-to-express.md`
