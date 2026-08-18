Status: active
Created: 2026-08-18
Updated: 2026-08-18

# Sidecar usage lives in session-scoped NDJSON, not the session JSONL

## Context

Advisor reviews and observational-memory stages issue model calls that Pi does
not persist. The measured baseline can only see primary-session assistant
messages, so sidecar spend is invisible. The task required one durable record
per sidecar model call and blocked implementation on where those records live.

## Decision

Write one NDJSON line per sidecar model call under the Pi agent directory:

```text
~/.pi/agent/sidecar-usage/<session-id>.ndjson
```

Unscoped calls (no usable session id) go to `sidecar-usage/unscoped.ndjson`.
The writer is shared by advisor and observational memory. It serializes a
fixed allowlist of identifiers and counters. It never throws.

Recording is enabled only when a production caller binds a session:

- Memory wraps the awaited consolidation pipeline in an async-local context.
- The advisor stores the session id on `AdvisorRuntime` before `push` and
  emits from `#drain` itself, because drain is fire-and-forget and outlives
  `turn_end`.

Unit tests that do not bind a session do not write.

## Authority And Provenance

- Task non-goal: runtime state under the Pi agent directory, not repository
  state.
- `docs/context.md`: session JSONL is the observational-memory ledger, not a
  telemetry sink.
- Baseline research: a single long session can produce thousands of advisor
  reviews. Those must not become source entries.
- `components/memory/src/session-ledger/progress.ts`: `custom_message` is a
  source-entry type counted by the raw-token clocks.

## Alternatives Considered

### Custom entries in the session JSONL

Steelman: the file is already append-only and durable. Observational memory
already writes `om.*` custom entries there. The baseline aggregator already
scans session JSONL, so sidecar rows would join the same files.

Rejected because usage is telemetry, not conversation or memory state. A
4,793-step session would add thousands of `sidecar.usage` entries. Those
entries are `custom_message` source types unless every clock, projector,
observer serializer, and transcript viewer learns to ignore them. Compaction
does not delete historical JSONL lines, but it would still feed them to
anything that walks the active branch. The contamination surface is larger
than the convenience of one scan path.

### Reuse the observational-memory debug log

Steelman: `debug-log.ts` already has session-scoped NDJSON, rotation, and a
silent failure boundary.

Rejected because that channel is opt-in (`debugLog: true`) and may contain
operational event payloads. Usage accounting must run whenever a sidecar
model call happens, and its records must stay identifiers and counters only.

## Consequences

- Operators aggregate sidecar spend by scanning `~/.pi/agent/sidecar-usage/`,
  then can union that with session JSONL for a combined table.
- Session files stay free of measurement rows.
- Advisor emission cannot depend on `turn_end` still being on the stack.
- Tests must bind a session (or ALS context) and redirect `getAgentDir`
  before asserting files.

## Limits And Revisit Conditions

Revisit if Pi grows a first-party usage ledger that both sidecars can write
without becoming source entries. Do not move these records into session JSONL
without an ignore rule on every source-entry consumer.

## Related Records

- `.ledger/202608181322-account-sidecar-model-usage/task.md`
- `.ledger/202608181322-account-sidecar-model-usage/specs/sidecar-usage-records.md`
- `.ledger/202608181322-account-sidecar-model-usage/research/quota-spend-baseline.md`
