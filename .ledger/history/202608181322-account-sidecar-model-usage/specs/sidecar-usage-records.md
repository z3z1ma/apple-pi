Status: active
Created: 2026-08-18
Updated: 2026-08-18

# Sidecar usage records

## Purpose And Authority

Define the durable per-call usage record emitted by advisor reviews and
observational-memory stages. This spec governs the shared writer and the two
production callers. The task `task.md` acceptance criteria are the proof bar.

## Actors And Boundaries

- **Writer** (`components/shared/src/sidecar-usage.ts`) appends one JSON line
  per model call under `~/.pi/agent/sidecar-usage/`.
- **Advisor** emits from `AdvisorRuntime` after every `agent.prompt()`
  attempt, including self-compaction replays, retries, and failed or aborted
  reviews.
- **Observational memory** emits from observer, reflector, and dropper after
  each `agentLoop` invocation.
- **Primary agent** is unchanged. Instrumentation MUST NOT alter review or
  consolidation results.

## Required Behavior

- Each sidecar model call SHALL produce one record with: `ts`, `agent`,
  `trigger`, `status`, `provider`, `model`, `input`, `cacheRead`,
  `cacheWrite`, `output`, `cost`, `durationMs`.
- A record MAY include `sessionId` and numeric `threshold`.
- Advisor `trigger` values are `turn_end`, `turn_end_replay` (length overflow
  retry), and `turn_end_retry` (failed-review requeue).
- Memory `trigger` values are the config key that fired the stage:
  `observeAfterTokens`, `reflectAfterTokens`, `observationsPoolTargetTokens`,
  or `reflectionMaintenance`.
- `status` SHALL be the assistant `stopReason` when present, else `error` or
  `aborted` for thrown or signal-aborted calls with no assistant message.
- A call that produces no assistant message SHALL still emit one record with
  zeroed counters so silent failures remain countable.
- Serialized keys SHALL be only the allowlist above. Prompt text, advice,
  observations, reflections, file contents, and arbitrary extra fields MUST
  NOT appear.
- Write failure MUST be swallowed. The sidecar call completes as it would
  without instrumentation.

## Error And Failure Behavior

- Missing provider, model, or usage fields default to empty string or `0`.
- `getAgentDir` or filesystem errors do not surface to the primary agent.
- Unbound sessions (tests, or a caller that never enabled recording) write
  nothing.

## Given-When-Then Scenarios

- Given a bound advisor session, when a review prompt finishes, then one
  NDJSON line exists for that prompt with provider, model, and usage.
- Given a review that overflows and replays, when both prompts run, then two
  records exist (`turn_end` and `turn_end_replay`).
- Given an observer stage whose stream ends with no assistant message, when
  the loop returns, then one zero-counter record exists with the fallback
  status.
- Given the writer cannot create the file, when a sidecar call finishes, then
  the sidecar result is unchanged and no exception escapes.

## Acceptance Mapping

- AC-001 → advisor prompt emission, including replay and failure.
- AC-002 → observer, reflector, and dropper emission with stage trigger and
  threshold.
- AC-003 → records contain the columns needed for the baseline table.
- AC-004 → write-failure swallow.
- AC-005 → allowlist-only serialization.

## Exclusions

- No new cost UI.
- No budget enforcement.
- No session-JSONL custom entries.
- No repository fixtures copied from live sessions.

## Assumptions And Provenance

- Pi assistant messages expose `usage.{input,output,cacheRead,cacheWrite,cost.total}`
  and `stopReason`. Verified on the advisor path; memory agents now read the
  same message shape from `message_end` events.
- List-price `cost.total` is the accepted quota proxy.

## Related Records

- `.ledger/202608181322-account-sidecar-model-usage/decisions/sidecar-usage-ndjson.md`
- `.ledger/202608181322-account-sidecar-model-usage/research/quota-spend-baseline.md`
