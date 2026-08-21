Status: cancelled
Created: 2026-08-16
Updated: 2026-08-16

# Distill observational memory into current working state

## Scope

Make compacted observational memory present the session's current working state: live law plus active working evidence. Keep the existing observe / reflect / drop / recall bones. Close the algebra those roles already name: law can be superseded or retired, working evidence can be dropped against current law, and injection shows the result instead of a replayable log. Still-constraining attempts and pivots survive as scarce law, not as a window changelog.

This task owns specification, planning, and the later implementation of that contract. Implementation does not start until authorized.

## Non-goals

- Adding a fourth memory agent or an injection-time synthesizer.
- Rewriting observer into a thin event logger.
- Project-tree memory, cross-session share, or semantic search.
- Changing VCC's cut algorithm or transcript summary.
- Erasing ledger history when dropping or retiring records.
- Treating "make the dropper more aggressive" as the whole change.

## Acceptance Criteria

- AC-001: After compaction, injected memory presents current reflections as binding law and active observations as working evidence. Usage instructions do not tell the assistant to replay a historical stack for recency.
- AC-002: A later reflector pass can supersede or retire earlier reflections. Retired reflections do not appear in the compacted prompt, default `/om:view` output, or current-reflection lists given to memory agents. They remain recallable. A still-constraining pivot remains in current law.
- AC-003: Compaction projection applies reflections, retirements, and observation drops through the cut. It does not wait for observation-token overflow before including law or applying drops.
- AC-004: Dropper may run when the active observation pool is over target even if the same pipeline pass emitted zero reflections. It uses current law, including any same-run new reflections. A no-drop verdict does not relaunch on the next `turn_end` or `agent_start` over an unchanged set; retry only after law or the active set changes, or after another `observeAfterTokens` of source.
- AC-005: Dropper preservation applies to unique meaning not already present in current law or a newer observation. Absorbed or superseded paths, identifiers, and errors may be dropped.
- AC-006: Observer remains a capture stage. This task does not register a fourth memory agent.
- AC-007: `recall` recovers source for active, dropped, and retired ids. Dropping or retiring does not erase ledger history.
- AC-008: README and `/om:status` / `/om:view` copy match current-working-state semantics.

## References

- `.ledger/202608162324-distill-observational-memory-current-state/research/what-memory-is-trying-to-express.md`
- `.ledger/202608162324-distill-observational-memory-current-state/knowledge/current-working-state.md`
- `.ledger/202608162324-distill-observational-memory-current-state/specs/current-working-state.md`
- `.ledger/202608162324-distill-observational-memory-current-state/decisions/current-working-state.md`
- `.ledger/202608162324-distill-observational-memory-current-state/decisions/append-only-law-retirement.md`
- `.ledger/202608162324-distill-observational-memory-current-state/decisions/dropper-against-current-law.md`
- `.ledger/202608162324-distill-observational-memory-current-state/plans/current-working-state.md`
- `components/memory/src/session-ledger/projection.ts`
- `components/memory/src/session-ledger/render-summary.ts`
- `components/memory/src/hooks/consolidation-trigger.ts`
- `extensions/context.ts`

## Assumptions

- User-ratified: the bones of observer, reflector, dropper, and recall are worth keeping.
- User-ratified: compacted observational memory in the 2026-08-16 review session felt like a fossil record rather than current law.
- User-ratified: the follow-up must be holistic; dropper aggressiveness is not the whole problem.
- User-ratified: compacted memory presents current working state, with working-evidence details. Attempts and pivots matter, but not as a window log.
- User-ratified: append-only reflection retirement.
- User-ratified: dropper may run whenever the working-evidence pool is over target.
- Decision-backed: no-drop backoff of the same class as observer empty backoff. `.ledger/202608162324-distill-observational-memory-current-state/decisions/dropper-against-current-law.md`.
- Record-backed: current injection, `fullFold`, same-run dropper gate, and observer empty backoff. `.ledger/202608162324-distill-observational-memory-current-state/research/what-memory-is-trying-to-express.md`.

## Journal

- 2026-08-16: Opened after the compacted-context research pass. Source reading showed the named ontology is already evidence / law / prune, but law cannot retire, dropper cannot run against existing law, and projection withholds maintenance until overflow.
- 2026-08-16: Wrote first-principles research, vocabulary, a draft spec, and a proposed plan. Implementation is blocked on ratification.
- 2026-08-16: Operator ratified current working state, append-only retirement, and over-target dropper launch. Pivot residue stays in law; attempt logs stay out of the window. Spec activated; no-drop backoff added to AC-004 so KEEP-when-uncertain cannot pay a model call every turn.
- 2026-08-17: Implemented the contract directly. Operator added a model-call efficiency constraint: no extra agents, and memory stages only run when they can change state. `npx vitest run components/memory/tests` — 245 passed. `tsc` is clean for memory; pre-existing review UI type errors remain out of scope.

## Blockers

None.

## Evidence

- 2026-08-17: `npx vitest run components/memory/tests` — 24 files, 245 passed.
- 2026-08-17: Memory surfaces typecheck. Pre-existing `components/review/src/index.ts` errors are unrelated.

## Review

Pending.

## Retrospective

Pending.

## Distillation

Pending.
