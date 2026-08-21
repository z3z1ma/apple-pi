Status: active
Created: 2026-08-16
Updated: 2026-08-16

# Implementation plan

This sequence implements the active current-working-state contract.

## Outcome

Compacted observational memory presents current law plus active working evidence. Superseded law can leave the prompt without leaving the ledger. The dropper can maintain the working set against current law. Capture, append-only storage, and exact-id recall stay in place.

## Current-System Evidence

- `components/memory/src/session-ledger/types.ts` defines observation, reflection, and observation-drop records only.
- `components/memory/src/session-ledger/fold.ts` and `projection.ts` fold first-valid records; `buildCompactionProjection` withholds reflections and drops until `fullFold`.
- `components/memory/src/session-ledger/render-summary.ts` injects all supplied reflections and observations and tells the reader to replay recency.
- `components/memory/src/hooks/consolidation-trigger.ts` runs observer, then reflector, then dropper, and skips dropper unless the same pass recorded reflections.
- `components/memory/src/agents/reflector/agent.ts` can only append `{ content, supportingObservationIds }`.
- `components/memory/src/agents/dropper/prompts.ts` uses a keep-default and a preservation floor that matches typical observer detail.
- Tests in `session-ledger-projection.test.ts` and `consolidation-trigger.test.ts` currently require the withheld-maintenance and same-run-dropper behaviors.

## Change Surfaces

- `components/memory/src/session-ledger/types.ts`, `fold.ts`, `projection.ts`, `recall.ts`, `render-summary.ts`: retirement records, active-law fold, always-apply maintenance through the cut, retired recall status, current-state injection copy.
- `components/memory/src/agents/reflector/agent.ts` and `prompts.ts`: supersede and retire current law.
- `components/memory/src/hooks/consolidation-trigger.ts` and `agents/dropper/*`: dropper launch against current law when the pool is over target; narrower preservation floor.
- `components/memory/src/commands/status.ts` and `view.ts`: recorded / retired / visible law counts; visible view stays current state.
- `components/memory/src/agents/observer/prompts.ts`: only the framing needed so capture knows law is maintained downstream. No observer rewrite.
- `extensions/context.ts`: keep one augmenter; it should keep calling projection plus `renderSummary`.
- `README.md` Context and memory: injected records are current working state.
- Matching tests listed above, plus new fold/recall/render cases for retirement.

## Sequence

1. **Add append-only law retirement to the ledger.** Introduce a retirement / supersession record type. Fold current reflections as first-valid minus retired ids. Keep first-valid reflection content immutable.

2. **Give the reflector the missing operations.** Extend the reflector tool surface so a pass can emit new law that supersedes current ids and can retire law with no successor. Reject invalid ids. Keep zero-output as a valid pass. A still-constraining pivot must remain on the successor or another current reflection.

3. **Project current state at every compaction.** Make `buildCompactionProjection` apply reflections, retirements, and observation drops through the cut. Stop using `fullFold` as a gate that hides later law or later drops. Do not add an injection-time token clip.

4. **Rewrite injected copy.** `renderSummary` presents current law, then working evidence, and tells the assistant not to replay a stack. Tests that require the old "past records" sentence are updated because the contract changed.

5. **Let the dropper maintain the working set.** Launch dropper when the active observation pool is over target, using current law, even if the same pass emitted no reflections. Add a launch path that does not depend on observer/reflector token due-ness alone. Keep KEEP-when-uncertain. Narrow the preservation floor to unique unabsorbed meaning. A no-drop verdict takes the same empty-backoff class as observer `#23`: do not relaunch on every `turn_end` or `agent_start` over an unchanged set.

6. **Keep recall and operator views honest.** `recall` marks dropped and retired records. `/om:status` and `/om:view` distinguish recorded, retired, and visible law. Default view is current state.

7. **Reconcile tests and README.** Replace same-run-only and first-compaction-excludes-maintenance tests with the new contract. Do not add a fourth agent.

## Acceptance And Backpressure

- AC-001: render-summary tests require current-state instructions and forbid replay wording.
- AC-002: fold/projection/view tests hide retired reflections from injected and visible current sets.
- AC-003: projection tests apply law and drops before `observationsPoolMaxTokens` overflow.
- AC-004: consolidation tests launch dropper when the pool is over target and the reflector emits nothing, and they refuse a second launch on the next turn after a no-drop verdict with an unchanged set.
- AC-005: dropper prompt/tests no longer treat absorbed identifiers as an absolute floor.
- AC-006: no new memory agent registration in `extensions/context.ts`.
- AC-007: recall tests return dropped and retired ids with status.
- AC-008: README and `/om:*` copy match current-state semantics.

## Risks And Failure Modes

- **Unsafe retirement.** Mitigate by rejecting invalid ids and keeping KEEP-when-uncertain on drops. Retired law stays recallable.
- **Dropper thrash.** KEEP-when-uncertain that cannot get under target would otherwise pay a model call on every `turn_end` or `agent_start`. The no-drop backoff is required, not optional.
- **Losing working context.** Accepted only when meaning is in current law or a newer observation. If live sessions lose load-bearing detail, tighten the floor before restoring the same-run gate.
- **Historical sessions.** Old JSONL has no retirement records. Fold MUST treat missing retirements as "all reflections current."

## Integration Points

- One `session_before_compact` owner remains in `extensions/context.ts`.
- VCC cut and transcript summary are unchanged.
- Observational-memory settings keys stay in `config.ts` unless a new key is required for dropper launch hysteresis.

## Rollback Or Recovery

Ledger additions are append-only. If retirement proves wrong, stop emitting retirement records; old sessions without them fold as they do today. If dropper-only launch is too aggressive, restore a due-ness gate without restoring the hide-law `fullFold` split.

## Related Records

- `.ledger/202608162324-distill-observational-memory-current-state/specs/current-working-state.md`
- `.ledger/202608162324-distill-observational-memory-current-state/decisions/current-working-state.md`
- `.ledger/202608162324-distill-observational-memory-current-state/decisions/append-only-law-retirement.md`
- `.ledger/202608162324-distill-observational-memory-current-state/decisions/dropper-against-current-law.md`
- `.ledger/202608162324-distill-observational-memory-current-state/research/what-memory-is-trying-to-express.md`
- `.ledger/202608162324-distill-observational-memory-current-state/knowledge/current-working-state.md`
