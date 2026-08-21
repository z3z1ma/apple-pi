Status: active
Created: 2026-08-16
Updated: 2026-08-16

# Compacted memory as current working state

## Purpose And Authority

This specification is the behavioral contract for observational memory after compaction. It is authoritative for this task.

RFC 2119 terms are normative.

## Actors And Boundaries

- Observer captures new working evidence from a conversation chunk. It does not maintain law.
- Reflector maintains current law: it MAY emit new reflections and MUST be able to supersede or retire law that is no longer current.
- Dropper removes working evidence from the active set. It MUST NOT retire reflections.
- Fold and projection compute current law and working evidence from the append-only ledger.
- `renderSummary` is the only injected prose contract the main assistant sees after compaction.
- `recall` reads archive and source. It is not semantic search.
- VCC still owns the conversational cut. This contract does not change how VCC chooses `firstKeptEntryId`.

## Required Behavior

### Injected meaning

- After compaction, injected observational memory MUST present current law first and working evidence second.
- Usage instructions MUST describe those records as the session's current working memory.
- Usage instructions MUST NOT tell the assistant to treat the list as a historical log whose conflicts are resolved by replaying recency across the whole stack.
- When current law and a newer working-evidence line conflict, the newer observation is the latest known state for that fact until the reflector updates law.
- Work that current law or a current observation marks completed MUST NOT be redone unless the user asks.

### Law lifecycle

- New durable facts MUST continue to be recorded as reflections with supporting observation ids.
- A later reflector pass MUST be able to supersede one or more current reflections with a successor, or retire them with no successor when they are no longer current law.
- If a retirement or supersession would discard a still-constraining attempt or pivot, the same pass MUST leave that residue in current law, usually on the successor. Silent retirement that forgets a rejected path is incomplete.
- The full attempt changelog MUST NOT remain in the injected window. Detailed history stays in the ledger and is available through `recall`.
- Supersession and retirement MUST be append-only ledger records. Existing reflection rows MUST NOT be rewritten.
- Retired reflections MUST NOT appear in the compacted prompt, in `/om:view` default visible output, or in the "current reflections" lists given to observer, reflector, or dropper.
- Retired reflections MUST remain recallable by id, the same way dropped observations remain recallable.

### Projection

- Compaction projection MUST fold observations, reflections, retirements, and observation drops through the compaction cut.
- Projection MUST NOT withhold later reflections, retirements, or drops until observation tokens reach `observationsPoolMaxTokens`.
- `observationsPoolMaxTokens` MUST NOT silently clip injected text. Active-set membership is the only injection filter.

### Working-evidence maintenance

- Dropper MAY run when the active observation pool is over `observationsPoolTargetTokens`, using current law, even if the same pipeline pass emitted zero reflections.
- Dropper MUST see current law, including any reflections recorded earlier in that same pass.
- Default action when uncertain remains KEEP.
- The preservation floor MUST protect unique meaning that is not already present, at equivalent fidelity, in current law or in a newer observation. Named paths, identifiers, errors, dates, and completions that have been absorbed or superseded MAY be dropped.
- Dropping MUST NOT erase ledger history.
- A deliberate no-drop verdict MUST NOT re-fire every turn over the same active set. Retry only after current law or the active observation set changes, or after another `observeAfterTokens` of new source tokens arrives. This is the same class of due-ness as observer empty backoff.
- A pass that drops some observations but leaves the pool over target MAY run again on the next due consolidation. It MUST NOT launch solely because `turn_end` or `agent_start` fired again with an unchanged pool and an unchanged no-drop verdict.

### Capture and recall

- Observer remains a capture stage. It MUST continue to record new facts from the new chunk only.
- This contract MUST NOT add a fourth memory agent or an injection-time synthesizer that rewrites law or evidence for the prompt.
- `recall` MUST recover exact source for active observations, dropped observations, current reflections, and retired reflections.

## Error And Failure Behavior

- Invalid retirement ids, missing successor ids, or empty retirement batches MUST be rejected and MUST NOT tombstone law.
- A reflector that emits neither new law nor retirements is a valid no-op.
- A dropper that proposes nothing is a valid no-op.
- If the dropper cannot run, the active observation set remains unchanged. Projection MUST still inject current law.
- Stream or model failure in any stage MUST fail that stage without advancing false coverage, matching the current consolidation error model.

## Given-When-Then Scenarios

- Given two reflections that record successive planning contracts for the same decision, when the later pass supersedes the earlier one and compaction runs, then the prompt contains the successor and does not contain the retired contract.
- Given an observation whose durable meaning is already in current law, when the active pool is over target and the reflector emits nothing, then the dropper may still run and may drop that observation.
- Given a dropper pass that proposes no drops while the pool stays over target, when the next `turn_end` fires with the same active set and current law, then the dropper does not run again until law or the active set changes or another `observeAfterTokens` of source arrives.
- Given a reflector retiring a planning contract that was abandoned for a successor, when compaction runs, then the prompt contains the successor and the constraining pivot residue, not the retired contract and not the attempt changelog.
- Given a first compaction before observation tokens reach `observationsPoolMaxTokens`, when reflections and drops already exist through the cut, then the injected snapshot includes those reflections and applies those drops.
- Given a dropped observation or retired reflection id, when `recall` is called with that id, then the record is returned and is marked dropped or retired.
- Given observer, reflector, and dropper, when this contract is implemented, then no additional memory agent is registered.

## Acceptance Mapping

- AC-001: injected meaning and usage instructions.
- AC-002: law lifecycle, hidden retired reflections, and pivot residue in current law.
- AC-003: projection applies maintenance through the cut.
- AC-004: dropper may run without same-run new reflections, and a no-drop verdict does not re-fire every turn.
- AC-005: preservation floor is unique unabsorbed meaning.
- AC-006: no fourth agent.
- AC-007: recall of dropped and retired records.
- AC-008: operator-facing copy matches current-working-state semantics.

## Exclusions

- Cross-session or team-shared memory.
- Project-tree memory mirrors.
- Semantic search over observations.
- Rewriting historical reflection or observation content in place.
- Changing VCC's cut algorithm or transcript summary.
- Replacing observer capture with a thinner event log in this task.

## Assumptions And Provenance

- Decision-backed: current working state, including pivot residue outside the window. `.ledger/202608162324-distill-observational-memory-current-state/decisions/current-working-state.md`.
- Decision-backed: append-only law retirement. `.ledger/202608162324-distill-observational-memory-current-state/decisions/append-only-law-retirement.md`.
- Decision-backed: dropper against current law, with no-drop backoff. `.ledger/202608162324-distill-observational-memory-current-state/decisions/dropper-against-current-law.md`.
- Record-backed: current injection, `fullFold`, same-run dropper gate, and observer empty backoff. `.ledger/202608162324-distill-observational-memory-current-state/research/what-memory-is-trying-to-express.md`.

## Related Records

None.
