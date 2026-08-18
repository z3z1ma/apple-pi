Status: done
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

- [x] WI-001: Decide and record where usage records live (see Blockers).
- [x] WI-002: Emit records from the advisor review path, including self-compaction replays and
      failed or aborted reviews, which are exactly the calls most likely to be silently costly.
- [x] WI-003: Emit records from observer, reflector, and dropper stages.
- [x] WI-004: Provide a documented way to aggregate the records; confirm it reproduces the
      baseline shape.
- [x] WI-005: Tests for record emission, for the no-content invariant, and for the write-failure
      boundary.

## References

- `.ledger/202608181322-gate-compaction-on-real-context-window/task.md`
- `.ledger/202608181322-merge-memory-consolidation-pass/task.md`
- `.ledger/202608181322-coalesce-advisor-reviews/task.md`
- `.ledger/202608181322-design-advisor-context-framing/task.md`
- `research/quota-spend-baseline.md` — the measured baseline this task makes extensible
- `decisions/sidecar-usage-ndjson.md` — session-scoped NDJSON, not session JSONL
- `specs/sidecar-usage-records.md` — record contract, triggers, and failure boundary
- `components/shared/src/sidecar-usage.ts` — shared writer
- `docs/context.md`, `docs/advisor.md` — aggregation path and user-facing note

## Assumptions

- Pi assistant messages expose `usage.{input,output,cacheRead,cacheWrite,cost.total}` and
  `stopReason`. Verified on the advisor path and on memory `message_end` fixtures. Live
  provider payloads in a real session remain `Not verified`.
- Operator intent is measurement of provider quota consumption, so list-price cost is an
  acceptable proxy and no billing integration is in scope.

## Journal

- 2026-08-18: Created from a chat-only analysis that measured $1,625 lifetime spend across 297
  sessions and found that essentially 100% of sidecar spend is unmeasurable. Baseline evidence
  captured in `research/quota-spend-baseline.md` before it could be lost.
- 2026-08-18: Chose session-scoped NDJSON under `~/.pi/agent/sidecar-usage/`. Advisor emits
  from `#drain` after every `prompt()` using a runtime-bound session. Memory emits from
  observer, reflector, and dropper `message_end` events inside an ALS-bound pipeline.

## Blockers

None.

## Evidence

- AC-001: Advisor test `runtime: bound session records each prompt including a self-compaction
  replay` writes `turn_end` + `turn_end_replay` rows with provider, model, and usage. Unbound
  runtimes write nothing.
- AC-002: `components/memory/tests/sidecar-usage-emission.test.ts` records observer, reflector,
  and dropper rows with stage triggers and the bound threshold.
- AC-003: Shared unit test aggregates fixture records into the baseline
  `{calls,input,cacheRead,output,cost}` columns. Operator recipe is in `docs/context.md`.
  `Not verified`: a live `~/.pi/agent/sidecar-usage/` file from a real session.
- AC-004: Writer swallows filesystem errors; the shared test asserts no throw when the agent
  dir path is a file.
- AC-005: Serialized keys are the allowlist; emission tests assert transcript/observation text
  is absent.

Checks this run: `npm test` (unit 500/500, VCC 466/466, advisor 87/87, loader) and
`npm run pack:check`. `sidecar-usage.ts` is in the packed tarball.

## Review

No fresh-context review ran. Live advisor notes that were verified and applied: emit from
`#drain` rather than relying on `turn_end` ALS inheritance; bind recording so existing tests
cannot write into `~/.pi/agent`; emit only on `message_end`; fall back to `getSessionFile()`
when `getSessionId()` is missing.

## Retrospective

The storage decision was the load-bearing one. Session JSONL would have required ignore rules
on every source-entry consumer for thousands of advisor reviews. Binding the writer (ALS for
memory, `setUsageSession` for advisor) is what keeps measurement always-on in production
without turning the existing unit suites into writers against the real agent directory.

## Distillation

Promoted the operator-facing contract to `docs/context.md` (record location, allowlist,
aggregation recipe, write-failure isolation) and a pointer in `docs/advisor.md`. The
architectural choice stays in `decisions/sidecar-usage-ndjson.md`. No new skill: aggregation
is a documented scan, not a repeated agent procedure.
