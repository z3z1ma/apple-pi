Status: complete
Created: 2026-09-03
Updated: 2026-09-03

# Retrospective

## What Mattered

The important separation was capture versus inference. Every completed primary step still enters one immutable ordered spool, while only the scheduler can permit a model review. Keeping spool claim/commit ownership in `PairRuntime` and pacing state in a pure scheduler made batching, partial settlement, and lifecycle invalidation explicit.

Mandatory host wakeups and pair-selected normal wakeups needed different authority. Orientation, failure, terminal evidence, starvation, and frontier reconfirmation remain host-owned; the pair can only tune normal semantic checkpoints.

## Learnings

- Active-run time must pause while waiting for the user and while a pair review is in flight.
- A failed retained claim can be shorter than the scheduler's current pending frontier. Successful retry settlement must commit only the reviewed prefix.
- New user direction and consequential evidence arriving during a review must outrank that review's stale attention lease or silent widening.
- Sticky phases prevent read/execute oscillation from recreating per-tool review frequency.
- Tool-result `content` is output, not command provenance. Command classification must use call arguments or structured result details.
- Runtime replacement must reset the long-lived scheduler; stale attempts must not publish settlement into a new lifecycle generation.

## Improvements

Use the new privacy-safe review telemetry after deployment to measure actual review reduction, active-run intervention latency, and the distribution of permit reasons. Tune thresholds only from that evidence; preserve the current five-active-minute / 8K-token close-attention fallback until data justifies a change.
