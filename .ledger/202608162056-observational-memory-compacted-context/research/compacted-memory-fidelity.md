Status: done
Created: 2026-08-16
Updated: 2026-08-16

# Research question

Does observational memory, as injected after compaction, present a current working contract, or a historical log that a later assistant must mentally replay?

## Question Or Hypothesis

**Question.** How do observer, reflector, dropper, pool math, and compaction projection decide what survives into compacted context today?

**Hypothesis, not ratified.** The keep-biased dropper is only one layer. Observer, reflector, and inject rules may be what make a long session read as archaeology. This hypothesis is an inference from one session plus a source reading. It is not a design choice.

## Motivation

On 2026-08-16, after many review-system reversals, a compacted assistant context still contained:

- Reflections marked completed for designs that later observations had overturned.
- A long chronological observation list of run IDs, token counts, and intermediate judgments.
- A stated rule that the most recent observation wins when entries conflict.

A later assistant had to replay the stack to know which sentence was live. The operator asked whether the dropper should be more aggressive and how it decides today, then asked that the answer be captured as research without a prescribed direction.

Whether that injection shape is acceptable changes whether any later work is needed, and which layer would be in scope if it is.

## Sources And Methods

Read on 2026-08-16 from the apple-pi checkout, not from runtime dropper receipts:

- `components/memory/src/agents/observer/prompts.ts`
- `components/memory/src/agents/reflector/prompts.ts`
- `components/memory/src/agents/dropper/prompts.ts`
- `components/memory/src/agents/dropper/agent.ts`
- `components/memory/src/agents/dropper/pool.ts`
- `components/memory/src/agents/dropper/coverage.ts`
- `components/memory/src/hooks/consolidation-trigger.ts`
- `components/memory/src/session-ledger/projection.ts`
- `components/memory/src/session-ledger/render-summary.ts`
- `components/memory/src/config.ts`
- `extensions/context.ts`

Method: source reading plus one operator-reported compacted prompt from the same day. No `/om status`, no session JSONL fold, and no dropper debug log from that session were inspected.

## Findings

### Observation: consolidation order and gates

`registerConsolidationTrigger` launches observer, then reflector, then dropper.

Observer runs when tokens since observation coverage reach `observeAfterTokens` (default 10_000).

Reflector runs when tokens since reflection coverage reach `reflectAfterTokens` (default 20_000).

Dropper in `runDropperStage` returns without running unless that same pipeline pass produced reflections and a `sameRunReflectionCoverageId`. It also returns unless `observationPoolMetrics(...).ready` is true.

### Observation: pool math

Defaults in `DEFAULTS`:

- `observationsPoolTargetTokens`: 10_000
- `observationsPoolMaxTokens`: 20_000

Unset target derives as `floor(max / 2)`.

`observationPoolMetrics.ready` is true only when rendered observation-line tokens exceed the target and `maxDropCountForPool` is at least 1.

`maxDropCountForPool` is `ceil(tokensOverTarget / averageObservationTokens)`, clamped to the active count. It is the count estimated to walk back toward the target, not below it.

`runDropper` returns no drops when `maxDropsAllowed <= 0`.

The dropper user prompt states that the maximum is a hard upper bound, not a target, and that the agent should drop fewer or none when fewer items are clearly safe.

After the model calls `drop_observations`, `selectDropCandidates` re-ranks accepted ids by reflection coverage (strong, then partial, then none), then relevance (low before critical), then older timestamps, then proposal order, and slices to `maxDropsAllowed`.

### Observation: dropper keep bias

`DROPPER_SYSTEM` says default action is KEEP, and when uncertain, keep.

Priority drop classes in the prompt: redundant with current reflections, superseded by a later observation, routine tool acknowledgements, older working context already covered.

Relevance is resistance, not a lock. Critical items may be dropped only with strong semantic evidence.

A preservation floor says not to drop, regardless of relevance, budget, coverage, or age, observations that uniquely carry user preferences or corrections, concrete completions, named identifiers and paths, exact errors, architectural decisions, dates, unresolved blockers, or non-standard user terminology.

Reflections are not in the dropper's tool surface. The agent cannot merge, rewrite, or drop reflections.

Coverage shown to the dropper is how many current reflections cite the observation id. It is not a judgment that the cited reflection is still the live contract.

### Observation: observer and reflector write complementary logs

Observer instructions say these records are the only memory after compaction. They require new observations for the new chunk, fact splitting, supersession framing, explicit `completed:` markers, and preservation of paths, identifiers, errors, and counts. Relevance guidance says most items should be medium or low, and not to default to high or critical.

Reflector instructions say not to turn each observation into a reflection, to emit zero when nothing is stable, and that over-reflection is memory distortion. They also say completed outcomes and durable decisions should become reflections, and that support ids are provenance for later dropping, not a quota.

There is no reflector tool that replaces or retires an older reflection. New reflections append.

### Observation: what compaction injects

`createMemoryCompactionAugmenter` in `extensions/context.ts` calls `buildCompactionProjection` and `renderSummary`.

`renderSummary` prepends usage instructions, then all supplied reflections, then all supplied observations. Instructions say to treat them as past records, that the most recent observation wins on conflict, and that completed work should not be redone unless the user asks.

`observationsPoolMaxTokens` is not a trim of injected text.

In `buildCompactionProjection`:

- A `normalProjection` folds observations up to the compaction cut, but folds reflections and drops only up to the latest prior `fullFold` boundary, or not at all if none exists.
- `fullFold` becomes true when that normal observation-token sum is `>= observationsPoolMaxTokens`.
- If `fullFold` is false, the injected snapshot can omit later reflections and later drops.
- If `fullFold` is true, the snapshot is `fullProjection` up to the cut: the full active observation set after applied drops, plus all reflections. That set is not clipped to 20_000 tokens.

### Observation: live session symptom

The 2026-08-16 review-system session, after compaction, presented stacked reflections of superseded planning contracts and a long observation changelog. An assistant reading that prompt reported the useful residue as operator taste and a few invariants that survived reversals, and the rest as a fossil record.

This pass did not measure that prompt's token counts, dropper proposals, or whether `fullFold` had already tripped.

### Inference

The keep-biased dropper can leave a large active log even when it runs, because observer lines usually contain the preservation-floor details, and because one pass cannot take the pool under target.

The reflector can leave a parallel architecture diary that is never pruned, so “completed” reflections from earlier contracts remain visible beside later ones.

Compaction injects those layers as a concatenated list. Conflict resolution is left to the reader via recency.

It does not follow from the source that “make the dropper more aggressive” is the change that would make compacted context read as current law. Other unread explanations also fit: the dropper never ran because the reflector emitted nothing; `fullFold` had not tripped, so drops never entered the snapshot; observer relevance labels were systematically high; or the operator would still want the changelog.

## Conclusions

Today's machinery can be described without choosing a successor:

1. Observations are an append-only event log with a conservative, budget-capped drop pass that is gated on a same-run reflector emission and on being over a 10k-token target.
2. Reflections are an append-only durable layer with no retirement path.
3. Compaction injects a projection of those layers. The 20k setting selects fold mode. It does not cap the injected summary.
4. One long live session produced a compacted prompt that a later assistant treated as archaeology.

A later pass can decide whether that is acceptable. This record does not select a layer, a policy, or an implementation.

## Limits

- Source-backed as of 2026-08-16 in this checkout. Prompt or projection edits after that date are outside this reading.
- No session-ledger fold, `/om status`, or dropper debug log from the 2026-08-16 review session.
- No measurement of how often dropper runs in ordinary sessions, or how often it proposes zero drops.
- No comparison corpus of other sessions.
- Null result: this pass did not find a code path that trims injected observations to `observationsPoolMaxTokens`.

## Related Records

- Owning task root in this bundle.
