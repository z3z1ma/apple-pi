Status: open
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

- [ ] WI-001: Move the dropper's snapshot-computed guardrails — `metrics`, `maxDropsAllowed`,
      `coverageById`, maintenance eligibility — out of pre-loop construction and into live
      recomputation at `drop_observations.execute` time and at final candidate selection.
- [ ] WI-002: Design the merged prompt and tool set, keeping each tool's contract and rejection
      rules intact.
- [ ] WI-003: Decide and record the merged cadence, including what happens to the separate
      `reflectAfterTokens` clock.
- [ ] WI-004: Preserve or deliberately re-shape the empty-result backoffs, which today are three
      independent mechanisms keyed to different identities.
- [ ] WI-005: Tests for live coverage recomputation, same-pass ordering, per-record coverage
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

## Blockers

None for planning. Before implementation, resolve WI-003 (merged cadence) and record it, since
it changes how often reflection happens and is a user-visible behaviour change.

## Evidence

Pending.

## Review

Pending.

## Retrospective

Pending.

## Distillation

Pending.
