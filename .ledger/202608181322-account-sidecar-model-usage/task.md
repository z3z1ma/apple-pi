Status: open
Created: 2026-08-18
Updated: 2026-08-18

# Account for advisor and memory sidecar model usage

## Scope

Advisor reviews and observational-memory consolidation issue model calls that are recorded
nowhere durable, so their share of provider quota cannot be measured. This task makes every
sidecar model call emit a durable usage record (provider, model, input, cacheRead, cacheWrite,
output, cost, duration, and why the call fired) that can be aggregated per provider, model, and
session by the same method used to produce the measured baseline.

This is the measurement prerequisite for the three sibling efficiency tasks: none of them can
show a real before/after without it.

## Non-goals

- Changing any sidecar's behaviour, cadence, model routing, or output.
- Adding cost UI beyond what already exists (`/advisor status`, footer, `/om:status`).
- Mirroring usage into repository state; this is runtime state under the Pi agent directory.
- Building budget enforcement, caps, or throttling. Measurement only.

## Acceptance Criteria

- AC-001: Each advisor review model call produces a durable record carrying provider, model,
  input, cacheRead, cacheWrite, output, cost, duration, and the trigger that caused the review.
- AC-002: Each observer, reflector, and dropper model call produces a record of the same shape,
  including which stage and which threshold fired.
- AC-003: The records can be aggregated per provider, model, and session, reproducing the
  baseline table format in `research/quota-spend-baseline.md` with sidecars included.
- AC-004: Failure boundary — if writing a record fails, the review or consolidation completes
  unchanged and no error surfaces to the primary agent. Instrumentation never converts a
  working sidecar into a broken one.
- AC-005: Records contain no transcript content, prompt text, advice text, observation text, or
  file contents. Identifiers and counters only.

## Work Items

- [ ] WI-001: Decide and record where usage records live (see Blockers).
- [ ] WI-002: Emit records from the advisor review path, including self-compaction replays and
      failed or aborted reviews, which are exactly the calls most likely to be silently costly.
- [ ] WI-003: Emit records from observer, reflector, and dropper stages.
- [ ] WI-004: Provide a documented way to aggregate the records; confirm it reproduces the
      baseline shape.
- [ ] WI-005: Tests for record emission, for the no-content invariant, and for the write-failure
      boundary.

## References

- `.ledger/202608181322-gate-compaction-on-real-context-window/task.md`
- `.ledger/202608181322-merge-memory-consolidation-pass/task.md`
- `.ledger/202608181322-coalesce-advisor-reviews/task.md`
- `.ledger/202608181322-design-advisor-context-framing/task.md`
- `research/quota-spend-baseline.md` — the measured baseline this task makes extensible
- `components/advisor/src/extension.ts:487-504` — advisor usage, currently in-memory only
- `components/memory/src/debug-log.ts` — existing NDJSON debug channel with session scoping
- `docs/context.md`, `docs/advisor.md` — user-facing behaviour to keep accurate

## Assumptions

- Pi's `agentLoop` surfaces per-call usage to the advisor and memory call sites in the same
  shape already folded into `AdvisorRuntime.usage`. Verified for the advisor; **not verified**
  for the memory agents, which currently discard usage entirely.
- Operator intent is measurement of provider quota consumption, so list-price cost is an
  acceptable proxy and no billing integration is in scope.

## Journal

- 2026-08-18: Created from a chat-only analysis that measured $1,625 lifetime spend across 297
  sessions and found that essentially 100% of sidecar spend is unmeasurable. Baseline evidence
  captured in `research/quota-spend-baseline.md` before it could be lost.

## Blockers

Open design decision, required before implementation: where usage records live. Two candidates,
each with real consequences.

1. An NDJSON channel under the Pi agent directory, alongside `components/memory/src/debug-log.ts`.
   Keeps the transcript clean; needs its own rotation, session scoping, and aggregation path;
   the advisor currently has no such channel.
2. Custom entries in Pi's append-only session JSONL, where observational memory already stores
   its records. Aggregates with existing tooling and is durable by construction, but adds
   entries that VCC compaction, memory projection, and the source-entry token clocks must
   deliberately ignore.

Record the choice in `decisions/` before writing code.

## Evidence

Pending.

## Review

Pending.

## Retrospective

Pending.

## Distillation

Pending.
