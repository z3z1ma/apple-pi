Status: done
Created: 2026-08-30
Updated: 2026-08-30

# Refine Pair review responsiveness

## Intent

Make Pair a sparse, dependable second line of thought that cannot stall the primary agent, dump accumulated advice, thrash through redundant deep reviews, or leave material findings observably ignored.

## Outcome

Pair review and Advisor work run behind explicit latency and retry boundaries. Direct findings are not delayed by Advisor validation. Material findings carry stable identities and receive a bounded typed disposition from the main agent. Pair remains complete through instruction discipline rather than a lossy host finding-count cap.

## Scope

- Primary-session wait policy for Pair review and delivery.
- Pair transport idle timeout, total review deadline, and retry ownership.
- Pair review attempt atomicity and pending-work recovery.
- Direct-finding delivery independence from Advisor preparation.
- Pair communication and reconfirmation discipline.
- Typed concern/blocker acknowledgment with bounded enforcement and telemetry.
- Advisor cooldown and cancellation behavior.
- Removal of the semantically weaker bare-Agent fallback.
- Focused tests and user-facing documentation.

## Non-goals

- Changing the configured `pair` or `deep` model profiles.
- Suppressing material findings through a host count or materiality cap.
- Disabling automated Advisor consultation.
- Making Pair authoritative over the user or main agent.
- Replacing the separate operator-requested review workflow.

## Acceptance Criteria

- AC-001: Non-terminal primary turns await no Pair model, runtime construction, retry, Advisor, Git, or delivery-preparation work; terminal turns use one absolute brief gate of at most 10 seconds.
- AC-002: A stalled Pair stream is aborted by a 30-second idle timeout and a 75-second logical review deadline. One retry owner permits at most one retry; PairRuntime does not multiply AgentSession retries.
- AC-003: Timed-out, failed, truncated, aborted, or stale review attempts publish no attempt-created advice, Advisor request, or notebook update. A healthy later review can recover from authoritative session context.
- AC-004: Direct Pair findings flush without awaiting Advisor consultation or working-state revalidation. Late work remains session- and generation-fenced.
- AC-005: Pair instructions require sparse, non-overlapping, root-cause-oriented interventions and stable reconfirmation wording. The host does not silently discard findings by count.
- AC-006: Every delivered concern or blocker has a stable id. The main agent uses one typed acknowledgment tool to address, decline, or defer it with a reason. One reminder is allowed; omission after that is recorded and does not create an infinite loop.
- AC-007: Automated Advisor consultation remains available with one active consultation and a longer turn cooldown, without a lifetime or per-request maximum.
- AC-008: Pair session creation failure leaves Pair visibly unavailable and retryable; it never falls back to a different raw-Agent contract.
- AC-009: Focused regressions cover latency, retries, failed-attempt isolation, delivery separation, acknowledgments, cooldown, and construction failure. Full repository validation passes.

## Constraints

- Preserve the persistent Pair / episodic Advisor / main-agent ownership model.
- Acknowledgment means considered, not obeyed; the user remains authoritative.
- Operational ceilings fail or retry explicitly rather than trimming findings silently.
- Keep one implementation of Pair session lifecycle and transport policy.

## References

- `docs/pair-programmer.md`
- `components/pair-programmer/src/extension.ts`
- `components/pair-programmer/src/session.ts`
- `components/pair-programmer/src/escalation.ts`
- `components/pair-programmer/src/config.ts`
- `components/pair-programmer/tests/pair.test.mjs`
- `.ledger/202608301046-refine-pair-review-responsiveness/specs/review-flow.md`
- `.ledger/202608301046-refine-pair-review-responsiveness/plans/implementation.md`
