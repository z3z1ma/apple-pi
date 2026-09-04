Status: done
Created: 2026-09-03
Updated: 2026-09-03

# Pace pair reviews within active runs

## Intent

Replace per-primary-turn pair inference with attention-aware pacing that preserves the pair programmer's unique ability to inspect and steer during long-running agentic turns. Every trajectory delta remains captured in order; review happens at semantic checkpoints, pair-selected wake conditions, or balanced starvation safeguards rather than after every tool continuation.

Normal model-owned compaction remains the only pair-context bound. This task does not add proactive context truncation, rolling attention epochs, or cache-specific resets.

## Success criteria

- Every eligible primary `turn_end` delta is still captured immutably, source-addressed, and eventually reviewed in order.
- A review requires an explicit scheduler permit; arrivals during an in-flight review remain deferred instead of automatically causing another review.
- The scheduler wakes within an active run for orientation, meaningful work-phase transitions, failures, verification after unreviewed mutation, consequential delegated results, and terminal evidence that remains unseen.
- The pair can select its next normal wake conditions through a typed, terminating attention disposition without granting repository or transcript navigation.
- Pending evidence forces a fallback review after 5 active minutes or about 8K rendered trajectory tokens. Silent routine reviews widen fallback attention; new user direction, material phase changes, failures, or interventions restore close attention.
- Newly raised findings and questions receive an expedited frontier-confirmation opportunity so pacing does not delay or strand useful advice.
- Review telemetry records why a review ran and enough pacing state to measure review reduction and intervention latency.
- Lifecycle replacement, disablement, compaction, retry, construction failure, and stale-attempt behavior preserve existing cancellation, transactional effects, and exact spool ownership.
- Pair prompt, public documentation, status behavior, and tests describe the paced shared-screen contract.
- Normal Pi/selected-model compaction behavior remains unchanged.

## Current State

Complete. Pair reviews are permit-gated at semantic checkpoints with pair-selected attention leases, active-time/token starvation safeguards, expedited frontier reconfirmation, and lifecycle-safe transactional settlement.

## Outcome

Implemented an attention-aware scheduler between immutable trajectory capture and pair inference. The scheduler preserves ordered spool ownership while coalescing routine work, recognizes sticky work phases and consequential results, retains mandatory host wakes, and supports a terminating `set_pair_attention` disposition. Failed reviews remain exact retry work without tight-looping; stale and replaced runtimes cannot publish scheduler settlement.

Pair prompts, status output, sidecar telemetry, documentation, and deterministic scheduler/runtime tests now describe and verify the paced contract. Pair context still uses normal selected-model compaction without a custom bound.

Validation passed: formatting, lint, typecheck, 90 Vitest files / 971 tests, 123 offline pair tests, extension-loader smoke test, package dry run, and `git diff --check`.
