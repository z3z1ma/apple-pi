Status: open
Created: 2026-08-18
Updated: 2026-08-18

# Coalesce advisor reviews without dropping deltas

## Scope

`push()` starts a drain immediately on every queued delta, and Pi emits `turn_end` once per
assistant step rather than once per user request. In the heaviest measured session that is up to
708 review opportunities, each re-sending the advisor's whole accumulated history.

This task defers the *drain* for low-signal steps so several deltas are reviewed in one batch,
while still queueing every delta. It does not skip, filter, or drop transcript content: the
advisor is stateful, its history is its context, and a delta that is never pushed is permanently
absent from everything it reasons about afterwards.

## Non-goals

- Changing the advisor's context budget, `ADVISOR_COMPACT_AT`, or its self-compaction strategy.
  Owned by `.ledger/202608181322-design-advisor-context-framing/task.md`; the operator has
  explicitly reserved that design.
- Changing severity semantics, the hold-and-reconfirm policy for concerns and blockers, or nit
  flush timing.
- Changing the bounded blocking catch-up wait, or adopting the reference implementation's
  non-blocking dispatch model. Parked separately with its own revisit conditions in
  `.ledger/history/202608181148-advisor-ux-reviewing-state-footer-bordered-advisory-card/`.
- Suppressing review of read-only steps. The advisor's own prompt names "Exploring the wrong
  code path" as a canonical `concern` trigger, so read steps are in scope; they may be batched,
  not hidden.

## Acceptance Criteria

- AC-001: Every `turn_end` delta that is pushed today is still pushed, in order, with unchanged
  content. Coalescing changes only when the model call happens.
- AC-002: A batch is drained no later than a terminal turn, so nothing is deferred past the
  point where the primary would go idle.
- AC-003: Review count over a representative session falls measurably, with advisory coverage of
  write and command steps unchanged.
- AC-004: Held concern and blocker reconfirmation still occurs before delivery, and the
  reconfirm preamble still carries survivors across batches.
- AC-005: Failure boundary — deferral never strands a delta: session shutdown, primary
  compaction, reprime, and dispose all either drain or deliberately discard with the existing
  documented behaviour, never silently lose queued work while claiming a review happened.
- AC-006: The bounded catch-up wait continues to see a settled or timed-out advisor; deferral
  must not cause the primary to wait on a drain that was never started.

## Work Items

- [ ] WI-001: Define "low-signal step" from delta content in a way that is explainable to a
      maintainer and does not encode a tool allow-list that silently rots.
- [ ] WI-002: Separate queueing from drain scheduling at `push()`, preserving order.
- [ ] WI-003: Guarantee drain-by-boundary: terminal turn, held advice present, backlog size, or
      elapsed time, whichever comes first.
- [ ] WI-004: Verify interaction with the existing catch-up wait and streak/timeout escalation.
- [ ] WI-005: Tests for ordering, drain-by-boundary, terminal flush, and the shutdown and
      reprime paths.

## References

- `components/advisor/src/extension.ts:508-512` — `push()` kicks `#drain()` immediately
- `components/advisor/src/extension.ts:580` — `#drain` already batches the whole queue, which is
  what makes deferral cheap
- `components/advisor/src/extension.ts:588-713` — reconfirm preamble, self-compaction, retries
- `components/advisor/src/config.ts:53, 89` — designed silence, and read-path exploration as a
  concern trigger
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:455-464` — `turn_end`
  is per assistant step
- `.ledger/202608181322-account-sidecar-model-usage/task.md` — evidence base; AC-003 needs its
  instrumentation to be measurable rather than asserted

## Assumptions

- Batching several deltas into one review does not materially reduce advice quality relative to
  reviewing each step alone. **Not verified.** The reference implementation and our own batching
  path already review multi-delta batches when the advisor falls behind, which is weak
  supporting evidence, not proof.

## Journal

- 2026-08-18: Created. Measured ~87% of reviews produce no advice, but that is designed
  behaviour rather than waste, which is why this task coalesces rather than filters.

## Blockers

AC-003 cannot be evidenced until `.ledger/202608181322-account-sidecar-model-usage/task.md`
lands. Either sequence this after it, or accept a weaker structural proof and say so explicitly.

## Evidence

Pending.

## Review

Pending.

## Retrospective

Pending.

## Distillation

Pending.
