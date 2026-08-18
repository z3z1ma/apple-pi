Status: done
Created: 2026-08-18
Updated: 2026-08-18

# Merge memory consolidation into one curation pass

## Scope

Observer, reflector, and dropper run as up to three sequential model calls in one consolidation,
sharing one resolved model, one in-flight lock, and one abort signal. Their inputs overlap
heavily: the observer already receives the full folded pool plus the transcript delta, and the
reflector and dropper each re-send that same pool with no transcript at all. In the heaviest
measured session this was 120 + 73 + 54 = 247 calls.

This task merges them into one curation pass that observes, reflects, retires, and drops within
a single agent loop, with coverage tiers and the drop budget recomputed against state that
includes records made earlier in the same pass.

The motivation is call count, latency, and having one prompt and one clock rather than three.
It is explicitly **not** cost: the entire memory subsystem is under 1% of measured spend. Do not
justify this task on savings.

## Non-goals

- Merging memory work into the advisor. Rejected on evidence: opposite intelligence tier,
  opposite latency requirement (advisor reviews block the primary's next step), source-entry
  provenance loss, and coupling two independently-toggleable features.
- Changing recall (`memory_source`, `/om:view`), the compaction projection, or the ledger record
  formats consumed by them.
- Changing how observations cite source entries.

## Acceptance Criteria

- AC-001: A consolidation that today runs observer, reflector, and dropper issues one model call
  instead of up to three, with the pool sent once rather than up to three times.
- AC-002: Drop selection uses coverage tiers and pool metrics computed from state that includes
  observations and reflections recorded earlier in the same pass, not a pre-loop snapshot.
- AC-003: Ordering semantics are preserved: reflection considers observations recorded in this
  pass, and dropping considers reflections recorded in this pass.
- AC-004: Ledger entries remain individually valid and separately addressable, with correct
  `coversUpToId` semantics per record type, so existing recall and projection are unaffected.
- AC-005: Provenance is unchanged — observations still validate source entry ids against the
  serialized chunk, and unknown ids are still rejected.
- AC-006: Failure boundary — a pass that produces no records writes nothing, advances no
  coverage, and arms the existing backoff, exactly as the three stages do today.
- AC-007: The cadence change is documented: three thresholds (`observeAfterTokens`,
  `reflectAfterTokens`, pool-over-target) collapse toward one clock, and the user-facing effect
  is stated in `docs/context.md`.

## Work Items

- [x] WI-001: Move the dropper's snapshot-computed guardrails — `metrics`, `maxDropsAllowed`,
      `coverageById`, maintenance eligibility — out of pre-loop construction and into live
      recomputation at `drop_observations.execute` time and at final candidate selection.
- [x] WI-002: Design the merged prompt and tool set, keeping each tool's contract and rejection
      rules intact.
- [x] WI-003: Decide and record the merged cadence, including what happens to the separate
      `reflectAfterTokens` clock.
- [x] WI-004: Preserve or deliberately re-shape the empty-result backoffs, which today are three
      independent mechanisms keyed to different identities.
- [x] WI-005: Tests for live coverage recomputation, same-pass ordering, per-record coverage
      markers, and the no-record path.

## References

- `components/memory/src/hooks/consolidation-trigger.ts:339-384` — the three-stage pipeline
- `components/memory/src/agents/dropper/agent.ts:150-156, 267, 299` — the snapshot guardrails
  that make naive prompt concatenation incorrect
- `components/memory/src/agents/dropper/coverage.ts:26-44` — coverage tiers derived from current
  reflections
- `components/memory/src/agents/observer/agent.ts`, `.../reflector/agent.ts` — the two inputs
  that are a superset and a subset of each other
- `.ledger/202608181322-account-sidecar-model-usage/task.md` — evidence base and the
  instrumentation that would show the call-count change
- `docs/context.md`
- `decisions/observer-paced-curation.md` — one `observeAfterTokens` launch clock, default 20,000
- `plans/one-pass-curator.md`

## Assumptions

- One low-thinking agent loop can carry three record-keeping roles without degrading any of
  them. **Not verified** and it is the central risk: the roles differ in disposition
  (observation is generous, reflection is selective, dropping is conservative). A quality
  regression here is silent and only visible later as worse compacted context.

## Journal

- 2026-08-18: Created. Established that the reflector and dropper read identical rendered input
  and that the observer's input is a strict superset, which is what makes the merge coherent;
  and that the dropper's guardrails are computed before its loop, which is what makes the merge
  non-trivial.
- 2026-08-18: Recorded `decisions/observer-paced-curation.md`. The merged curator launches on
  `observeAfterTokens`. `reflectAfterTokens` and pool-over-target no longer launch model calls.
- 2026-08-18: User ratified `observeAfterTokens` default 20,000. Implemented `runCurator` with
  live drop guardrails, sequenced prompt, 24-turn default, and a single pipeline call.

## Blockers

None.

## Evidence

- AC-001: `runConsolidationPipeline` calls `runCurator` once. Sidecar agent is
  `curator` with trigger `observeAfterTokens`. Consolidation tests assert a
  single mocked call and observe/reflect/retire/drop append order.
- AC-002: `resolveDropGuardrails` runs in `drop_observations.execute` and again
  at final selection. Execute rejects when live `maxDropsAllowed === 0` or the
  id is outside `allowedIds`. Final selection intersects `proposedDropIds` with
  live `allowedIds`. Curator tests cover zero-cap reject then maintenance allow.
- AC-003: `record_reflections` resolves supporting ids from prior active plus
  same-pass recorded observations. Curator test records an observation then a
  reflection citing that new id.
- AC-004: Pipeline still uses `buildObservationsRecordedData`,
  `buildReflectionsRecordedData`, `buildReflectionsRetiredData`, and
  `buildObservationsDroppedData` with per-record `coversUpToId`.
- AC-005: `normalizeSourceEntryIds` still rejects unknown chunk ids; curator
  test covers the invented-id path.
- AC-006: Empty curator result writes nothing, does not advance coverage, and
  arms `observerEmptyBackoff`. Stream errors do not take that path.
- AC-007: `docs/context.md` states the single 20k observe clock, unused
  `reflectAfterTokens`, and pool target as an inner drop budget.

Checks this run: unit 492/492, VCC 466, advisor 87/87, loader, `pack:check`.
`Not verified`: live compacted-context quality of one low-thinking pass.

## Review

Same-context self-review only. Live drop execute now rejects a zero cap and
intersects the final candidate list with live `allowedIds`. Independent review
was not run.

## Retrospective

The merge is a clock and coordination change, not a cost play. Concatenating
the three system prompts would have ended the pass after observe; the phase
machine had to override that. Isolated `runObserver` / `runReflector` /
`runDropper` remain as unit-tested tool-contract runners and are not on the
production launch path.

## Distillation

User-facing cadence and one-pass behavior live in `docs/context.md`. The 20k
clock and live-recompute constraint are in
`decisions/observer-paced-curation.md`. No new packaged skill.
