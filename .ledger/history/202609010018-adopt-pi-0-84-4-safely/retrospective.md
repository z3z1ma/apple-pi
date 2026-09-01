Status: done
Created: 2026-09-01
Updated: 2026-09-01

# Retrospective

## What Mattered

Separating Pi's normal native compaction path from the single-result cut-point gap preserved the fail-closed product contract without retaining the old fallback as the primary mechanism. Real AgentSession tests proved provider-boundary behavior rather than inferring it from event registration.

## Learnings

`session_compact_failed` and `ctx.abort()` identify a started failure, but Pi 0.84.4 still needs a narrow post-compaction gate because agent-core otherwise invokes providers with an already-aborted signal. `prepareCompaction()` can also return no preparation and no failure event when a trailing tool-result batch reaches `keepRecentTokens`; an empty hidden custom message supplies the missing cut point without replacing providers. Internal compaction and branch-summary requests use the raw stream and bypass `before_provider_request`. Repository dependency pins validate Apple Pi; they do not update the installed Pi host.

## Improvements

For future Pi upgrades, build a real-provider acceptance harness early and test boundary configurations on both sides of each threshold. Keep normal lifecycle behavior and exceptional compatibility fallbacks in separate scenarios so one cannot contaminate the proof of the other.
