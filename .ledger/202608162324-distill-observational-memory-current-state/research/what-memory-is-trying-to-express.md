Status: done
Created: 2026-08-16
Updated: 2026-08-16

# Research question

What is observational memory trying to express, and which of its current operations prevent that expression from being distilled?

## Question Or Hypothesis

**Question.** After compaction, what product meaning should the injected observational-memory text carry? What do observer, reflector, dropper, fold, and projection actually express today?

**Hypothesis, not ratified.** The three agents already name the right ontology — evidence, law, and pruning — but the algebra is not closed. Law cannot be retired, pruning cannot run against existing law, and injection presents an append-only changelog that the next assistant must replay. Making the dropper more aggressive cannot, by itself, make compacted context read as current working state.

## Motivation

A long 2026-08-16 review session compacted to stacked superseded reflections plus a chronological observation list. The operator asked for a holistic, first-principles follow-up: the bones are good, bloat accumulates, there is no way to clear what is no longer relevant, and the dropper may not be aggressive enough. The earlier research task was forbidden from choosing a direction. This pass exists to name the expression and the distillation, not to implement it.

Whether compacted memory is a replayable log or current working state changes every later choice: reflection lifecycle, dropper gates, projection, and injection copy.

## Sources And Methods

Read on 2026-08-16 from this checkout:

- `components/memory/src/agents/observer/prompts.ts`
- `components/memory/src/agents/reflector/prompts.ts`
- `components/memory/src/agents/dropper/prompts.ts`
- `components/memory/src/agents/dropper/agent.ts`
- `components/memory/src/agents/dropper/pool.ts`
- `components/memory/src/agents/dropper/coverage.ts`
- `components/memory/src/agents/reflector/agent.ts`
- `components/memory/src/hooks/consolidation-trigger.ts`
- `components/memory/src/session-ledger/types.ts`
- `components/memory/src/session-ledger/fold.ts`
- `components/memory/src/session-ledger/projection.ts`
- `components/memory/src/session-ledger/render-summary.ts`
- `components/memory/src/session-ledger/recall.ts`
- `components/memory/src/tools/recall-observation.ts`
- `components/memory/src/commands/view.ts`
- `components/memory/src/commands/status.ts`
- `components/memory/src/config.ts`
- `extensions/context.ts`
- `README.md` (Context and memory)
- `components/memory/tests/session-ledger-projection.test.ts`
- `components/memory/tests/session-ledger-render-summary.test.ts`
- `components/memory/tests/consolidation-trigger.test.ts`

Method: source and test reading plus the operator-reported compacted-prompt symptom. This pass did not inspect that session's JSONL, `/om status`, or dropper debug log.

## Findings

### Observation: the named ontology is already evidence / law / prune / recall

Observer instructions say observations plus reflections are the only post-compaction memory, and they require fact splitting, supersession framing, completion markers, and conservative relevance.

Reflector instructions say reflections are scarce durable orientation anchors, not a second observation layer. They forbid turning each observation into a reflection and tell the model to emit zero when nothing is stable.

Dropper instructions say dropping removes an observation from active compacted memory without erasing ledger history, and that the default action is KEEP.

`recall` recovers exact source for an observation or reflection id, including dropped observations.

`README.md` states that observations, reflections, and drops live in Pi's append-only session JSONL, not in a project-tree mirror.

### Observation: the stored algebra is append-only events plus observation tombstones

`fold.ts` folds first-valid observations, first-valid reflections, and drop tombstones. There is no reflection tombstone type in `types.ts`. Reflections have no retirement field.

Reflector `record_reflections` accepts only `{ content, supportingObservationIds }`. The prompt forbids update-style records because a rewording would create a separate reflection.

Dropper can only call `drop_observations`. It cannot merge, rewrite, or drop reflections.

### Observation: dropper is gated on same-run new law

`runDropperStage` returns without running unless that pipeline pass produced reflections and a `sameRunReflectionCoverageId`. `anyStageDue` is only observer and reflector token thresholds. Tests encode this: dropper-only work does not launch when the pool is over target, and a reflector that emits nothing does not start the dropper even when the pool is over target.

When the dropper does run, `maxDropCountForPool` sizes a hard upper bound estimated to walk back toward `observationsPoolTargetTokens` (default 10_000), not below it. The prompt says the maximum is not a target and default action is KEEP. The preservation floor lists unique preferences, completions, identifiers, paths, errors, decisions, dates, blockers, and user terminology, regardless of relevance, budget, coverage, or age.

Coverage shown to the dropper is how many current reflections cite the observation id. It is not a judgment that those reflections are still live law.

### Observation: injection is a concatenated log whose conflict rule is left to the reader

`renderSummary` prepends usage instructions, then all supplied reflections, then all supplied observations. The instructions say to treat the text as past records and that the most recent observation wins on conflict.

`observationsPoolMaxTokens` (default 20_000) does not trim injected text.

### Observation: `fullFold` withholds law and drops until observation overflow

`buildCompactionProjection` folds observations up to the compaction cut, but folds reflections and drops only through the latest prior `fullFold` boundary, or not at all if none exists.

`session-ledger-projection.test.ts` states this as required behavior: the first normal compaction includes observations and excludes maintenance streams; a later normal compaction keeps reflections and drops at the last full-fold boundary, so newer reflections and drops are omitted.

`fullFold` becomes true when the *normal* observation-token sum is `>= observationsPoolMaxTokens`. Only then does the snapshot become `fullProjection` through the cut.

### Observation: capture is preservation-maximizing by design

Observer is told that anything uncaptured is forgotten and anything distorted is remembered wrong. It is instructed to preserve paths, identifiers, errors, counts, and completions. Those same details are exactly the dropper's preservation floor. A typical observation line therefore argues against its own later removal.

### Inference

The system is trying to express **current working state for a future assistant that woke up mid-session**: honor the user, continue the work, do not redo completed outcomes, and recover exact source when a compressed claim is load-bearing.

What it actually expresses is **session archaeology**: an event log, a diary of conclusions that cannot be unpublished, and an injection contract that asks the reader to replay both.

The keep-biased dropper is one layer of that. It is not the only layer, and it is often not even running. Even a more aggressive dropper cannot remove superseded reflections, cannot run when the reflector correctly emits nothing, and cannot stop `renderSummary` from presenting whatever remains as a historical stack. A silent injection-time clip would be a second, unaccountable dropper.

### Inference: distillation is closing the existing algebra, not adding a fourth agent

The bones worth keeping:

- Observer captures immutable facts at usable granularity.
- Reflector crystallizes scarce durable meaning.
- Dropper removes evidence from the active set once it is safe.
- The ledger stays append-only.
- Recall remains the precision path.
- Memory stays in session JSONL.

The missing operations:

- Law must be supersedable and retireable without rewriting history.
- Working evidence must be prunable against *current* law, not only against law written in the same pass.
- Projection must present the result of those operations at every compaction, not after a 20k-token overflow.
- Injection copy must describe current state, not a log to replay.

## Conclusions

A later specification can treat these as the supported product claims, if ratified:

1. Compacted observational memory SHOULD present current law plus a bounded working-evidence set.
2. Reflections SHOULD have an append-only supersession or retirement path. Retired law MUST remain recallable and MUST NOT be injected.
3. Compaction projection SHOULD apply current reflections, retirements, and observation drops through the cut. The `fullFold` maintenance split works against current-state presentation.
4. Dropper SHOULD be allowed to run when the active observation pool is over target, using current law, even if the same pass emitted zero reflections.
5. The preservation floor SHOULD protect unique meaning not already in current law or a newer observation, not every identifier forever.
6. Observer SHOULD remain a capture stage. This work SHOULD NOT add a synthesizer, `_v2` memory, or project-tree mirror.

Confidence is high on current code behavior (read today) and medium on the 2026-08-16 session mechanics (operator report only; fold mode and dropper receipts unobserved).

## Limits

- Source-backed as of 2026-08-16 in this checkout.
- No session-ledger fold, `/om status`, or dropper debug log from the long review session.
- No measurement of how often dropper runs or proposes zero drops in ordinary sessions.
- Null result: this pass did not find a reflection retirement type, a dropper-only launch path, or a trim of injected observations to `observationsPoolMaxTokens`.

## Related Records

- `components/memory/src/session-ledger/projection.ts`
- `components/memory/src/session-ledger/render-summary.ts`
- `components/memory/src/hooks/consolidation-trigger.ts`
