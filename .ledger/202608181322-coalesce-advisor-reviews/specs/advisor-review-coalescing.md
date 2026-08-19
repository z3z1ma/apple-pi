Status: active
Created: 2026-08-18
Updated: 2026-08-18

# Advisor review coalescing

## Purpose And Authority

Define when the advisor model is called. Every eligible delta is still pushed, in order. Context shape is the framing spec; this spec only schedules drain.

## Actors And Boundaries

- **`push()`** enqueues a formatted delta into pending only. It MUST NOT, by itself, start a drain or append the delta to the reviewed frame.
- **Drain scheduler** decides when `#drain` runs.
- **`waitUntilSettled`** is used by the catch-up block. It MUST NOT wait on work that has not been started.
- Framing snapshot/frame reset is independent of drain. A curator persist MUST NOT close the frame. A budget reset may empty the reviewed frame while deltas are still pending; those pending deltas remain the next batch.

## Required Behavior

### Push versus drain

- Every `turn_end` delta that is pushed today SHALL still be pushed, in order. Content is the lean trajectory record in the framing spec, not a copy of the primary tool-result payload.
- `#pending` remains the unreviewed suffix. `#drain` already reviews the whole queue as one batch; coalescing keeps that batching and stops auto-starting it on every push.

### Low-signal step

A pending item is **low-signal** when all of the following hold:

- the raw primary event is not a user kickoff or steer (`before_agent_start` prompt, or a user-role steer entry). Judge that from the event, not from whether the formatted trajectory delta still contains a User section — user text now appends as its own message
- none of its raw tool results are a successful mutation (a successful edit/write, or any successful result that carries a line-numbered diff — judge the raw turn, not whether the formatted delta still contains that diff)
- none of its tool results are errors
- it is not a user-bash execution
- no high-severity note is held

This is name-agnostic. It MUST NOT be a tool-name allow-list. Read-only exploration is low-signal and stays in scope: it is batched, never dropped.

### When drain MUST start

Start drain on the first of these, even if every pending delta is low-signal:

1. The primary turn is terminal.
2. `hasHighPriority` is true (held concern or blocker).
3. The undrained pending set contains a delta that is not low-signal.
4. Pending count exceeds the scheduler backlog limit (initial: 8 deltas). There is no formatted-character backlog cap: `formatTurnDelta` includes thinking, so a character budget would force a drain on almost every step.
5. A deferral timer started at the first still-pending delta has elapsed (initial: 15 seconds, matching today's catch-up base).

`push()` of a low-signal delta with none of the above true SHALL leave `#busy` false and `#pending` non-empty.

### Drain / settle coupling

Today `idle` is `!#busy && #pending.length === 0`. Waiters are notified only from drain completion. That coupling is load-bearing and MUST stay correct under deferral:

- **Terminal catch-up** SHALL start drain (if pending is non-empty) and only then `waitUntilSettled`.
- **High-priority catch-up** SHALL start drain and only then wait.
- `waitUntilSettled` MUST treat "pending, not busy, drain not required by the rules above" as already settled for wait purposes, so a non-terminal low-signal deferral cannot sit on the 15s–120s catch-up block.
- A waiter MUST NOT be left blocked until timeout solely because drain was never started.

Do not redefine `idle` to mean "nothing pending" while also using `idle` to mean "caught up reviewing" without splitting those meanings in the implementation. If one flag cannot express both, the runtime SHALL expose "caught up or intentionally deferred" to the catch-up block separately from "no pending work."

### Held advice

Reconfirm preamble still rides the next drain batch. Deferral MUST NOT skip reconfirmation of held concerns/blockers: rule 2 starts drain whenever they are held.

### Identity change versus primary compact

- Session start, tree navigation, handoff, dispose: existing `reset()` / `dispose()` discard pending. That is a documented discard, not a silent lost review.
- Primary `session_compact` MUST NOT discard pending and MUST NOT require a drain by itself (framing leaves the frame in place).

## Error And Failure Behavior

- If drain fails, pending that was spliced into the failed batch follows today's retry / three-strike / `#lastOutcome === "failed"` behaviour. Failures MUST NOT be reported as successful silence.
- Shutdown and dispose abort waiters as they do today.
- A deferred queue that is discarded on identity change MUST NOT be described as reviewed.

## Given-When-Then Scenarios

- Given three consecutive read-only `turn_end`s with no held advice and no user kickoff or steer, when none of the drain triggers fire, no advisor model call has started and those deltas are still pending in order.
- Given those same deferred reads, when a mid-turn steer arrives as a raw user-role event, that item is not low-signal and drain starts even if no formatted delta contains a User section.
- Given those same deltas, when the primary emits a terminal turn, drain starts before the catch-up wait and the batch includes every pending delta plus the terminal delta.
- Given a held concern, when a low-signal `turn_end` arrives, drain starts so reconfirmation is not deferred behind reads.
- Given only deferred low-signal pending and a non-terminal turn with no high-priority notes, `waitUntilSettled` returns without waiting the timeout.
- Given pending deltas and a session handoff, pending is discarded and no waiter is left blocked as if a review were in flight.

## Acceptance Mapping

- AC-001: push-versus-drain.
- AC-002: terminal rule.
- AC-003: fewer model calls on low-signal streaks; write/diff/error/bash still force drain. Evidence still needs sidecar counts after implementation.
- AC-004: high-priority rule and reconfirm preamble.
- AC-005: identity-change discard versus compact-does-not-discard.
- AC-006: drain/settle coupling section.

## Exclusions

- Context budget, snapshot, recent user messages at seed, overflow cap, and what a delta contains (framing spec and `observation-receipts.md`).
- Changing nit flush timing, severity, or catch-up backoff numbers except where this spec starts a drain so those waits remain meaningful.

## Assumptions And Provenance

- Batching several deltas in one review does not materially reduce advice quality. **Not verified.**
- Low-signal as "no user text, no diff, no error, no bash" is operator-facing and does not require a tool allow-list. **Not verified** against a live session distribution.
- Accounting task has landed; AC-003 can be evidenced from sidecar usage after implementation.

## Related Records

- `.ledger/202608181322-design-advisor-context-framing/specs/advisor-context-frame.md`
- `.ledger/202608181322-design-advisor-context-framing/decisions/om-snapshot-prefix-curator-frame.md`
- `.ledger/history/202608181322-account-sidecar-model-usage/task.md`
