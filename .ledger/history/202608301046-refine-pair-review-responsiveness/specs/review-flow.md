Status: complete
Created: 2026-08-30
Updated: 2026-08-30

# Pair review flow

## Roles

The main agent owns implementation and user communication. Pair supplies sparse independent scrutiny. Advisor supplies occasional deep adjudication. A Pair acknowledgment records that the main agent considered a material finding; it does not transfer authority to Pair.

## Primary latency

- A non-terminal primary `turn_end` does not await Pair construction, Pair model work, retry delay, Advisor work, repository recapture, or asynchronous delivery preparation.
- A terminal `turn_end` has one absolute 10-second Pair catch-up budget. Expiry returns control normally and does not abort healthy background review.
- Advisor never participates in the terminal gate.
- Expiry does not promote unconfirmed advice. A later successful, current review may still deliver at an idle boundary.

## Pair request lifecycle

- Pair HTTP stream idle timeout: 30 seconds.
- Whole logical review deadline: 75 seconds.
- Provider transport retries: zero.
- AgentSession automatic retries: one with a short backoff.
- PairRuntime whole-review retries: zero.
- A deadline aborts and invalidates the active private Pair session. A later review uses a newly constructed session and authoritative primary-session context.
- Private Pair session creation is the only runtime path. Construction failure is visible and retryable; no raw-Agent fallback is permitted.

A review attempt is transactional. Direct findings, Advisor requests, and notebook changes created by an attempt become visible only after the attempt completes successfully. Failed, aborted, truncated, timed-out, and stale attempts commit none of those effects.

## Finding discipline

The host does not discard findings by count or apply a subjective materiality cap. Pair instructions require it to:

- remain quiet when no concrete issue exists;
- consolidate findings that share one root cause;
- avoid implementation management, status narration, repeated phrasing, and preference-only nits;
- share distinct material issues once, ordered by severity and leverage;
- reconfirm an existing finding by stable identity rather than reproducing exact prose.

Operational size or time failures reject the review explicitly rather than silently trimming findings.

## Delivery

Direct Pair findings are never delayed by Advisor consultation or working-state recapture. An already validated Advisor finding may share the same boundary delivery; otherwise it arrives later. Every delivery is fenced to its session generation and is marked delivered only after the Pi send operation succeeds.

## Acknowledgment

Every delivered `concern` or `blocker` has a host-generated finding id. The primary-only acknowledgment tool accepts one or more dispositions:

- `address`: the finding applies and the main agent is acting on it;
- `decline`: the finding does not apply, with a concise evidence-based reason;
- `defer`: the finding is valid but outside the current authorized action, with a reason.

Nits require no acknowledgment. The first subsequent assistant run is the normal acknowledgment opportunity. If material findings remain unacknowledged at its terminal boundary, the host sends one reminder. If they remain unacknowledged after the reminder run, the host records them as `unacknowledged` and stops. There is no third reminder and no infinite autonomous loop.

Acknowledgment records are append-only session telemetry. They identify disposition and reason without claiming implementation or validation occurred.

## Advisor cadence

Advisor remains automated, with one active consultation and exact-identity collapse. Starts are separated by four primary turns. There is no lifetime or per-user-request maximum. Consultation and validation work are independently cancellable and never block the primary or direct Pair delivery.
