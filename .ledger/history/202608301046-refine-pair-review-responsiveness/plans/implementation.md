Status: complete
Created: 2026-08-30
Updated: 2026-08-30

# Pair responsiveness implementation plan

## Goal

Deliver the review-flow contract in `specs/review-flow.md` without adding a lossy finding cap or a second Pair runtime.

## Constraints

- Preserve one persistent Pair session and episodic Advisor.
- Keep non-terminal primary progress fully asynchronous.
- Use one retry owner and bounded transport/review deadlines.
- Keep materiality judgment with Pair instructions and the main agent, not host count limits.
- Acknowledgment is bounded and records consideration only.

### WI-001: Bound Pair transport and primary waits
State: done
Dependencies: None
Files:
- Modify: `components/pair-programmer/src/session.ts`
- Modify: `components/pair-programmer/src/extension.ts`
- Modify: `components/pair-programmer/tests/pair.test.mjs`
Checks:
- `npm run test:pair`
Steps:
1. Configure the private Pair session with a 30-second HTTP idle timeout, zero provider retries, and one AgentSession retry.
2. Add a 75-second logical review watchdog and remove PairRuntime whole-review retry multiplication.
3. Make non-terminal `turn_end` enqueue and return without awaiting construction or review; apply one absolute 10-second terminal gate.
4. Leave unconfirmed advice queued after gate expiry for later successful delivery.
5. Remove the raw-Agent fallback; failed construction remains visible and can be retried.

### WI-002: Make review effects and delivery coherent
State: done
Dependencies: WI-001
Files:
- Modify: `components/pair-programmer/src/extension.ts`
- Modify: `components/pair-programmer/src/escalation.ts`
- Modify: `components/pair-programmer/src/formatting.ts`
- Modify: `components/pair-programmer/src/config.ts`
- Modify: `components/pair-programmer/tests/pair.test.mjs`
- Modify: `components/pair-programmer/tests/escalation.test.ts`
Checks:
- `npm run test:pair`
- `npx vitest run components/pair-programmer/tests/escalation.test.ts`
Steps:
1. Stage direct findings and Pair-originated Advisor requests inside the active review attempt; commit only after a successful complete response.
2. Keep notebook staging in the same successful-attempt boundary.
3. Decouple direct-note flushing from asynchronous Advisor validation and observe send failure before marking delivery.
4. Tighten Pair and reconfirmation instructions to consolidate shared-root findings, avoid implementation management, and use stable identities without imposing a host count cap.
5. Preserve generation/session fencing through timeout, teardown, and late callbacks.

### WI-003: Add bounded typed acknowledgment
State: done
Dependencies: WI-002
Files:
- Modify: `components/pair-programmer/src/types.ts`
- Modify: `components/pair-programmer/src/formatting.ts`
- Modify: `components/pair-programmer/src/config.ts`
- Modify: `components/pair-programmer/src/extension.ts`
- Modify: `components/pair-programmer/tests/pair.test.mjs`
- Modify: `tests/package-load.mjs` if the public tool inventory requires it
Checks:
- `npm run test:pair`
- `npm run test:loader`
Steps:
1. Assign stable host ids to delivered findings and register the primary acknowledgment tool.
2. Accept batched `address | decline | defer` dispositions with concise reasons and validate them against pending material findings.
3. Persist acknowledgment or terminal unacknowledged telemetry without claiming implementation or validation.
4. Send at most one reminder after a terminal omission; close missed findings after the reminder run.
5. Update the primary protocol, agent-facing note content, and status reporting so material findings cannot be silently mistaken for handled ones.

### WI-004: Bound Advisor cadence and integrate behavior
State: done
Dependencies: WI-001, WI-002, WI-003
Files:
- Modify: `components/pair-programmer/src/escalation.ts`
- Modify: `components/pair-programmer/tests/escalation.test.ts`
- Modify: `docs/pair-programmer.md`
Checks:
- `npx vitest run components/pair-programmer/tests/escalation.test.ts`
- `npm run test:pair`
Steps:
1. Increase automated Advisor start cooldown to four primary turns while keeping one active consultation and no lifetime cap.
2. Ensure Advisor consultation, cancellation, and validation never participate in the primary terminal gate or direct-note delivery.
3. Document latency, retry, delivery, instruction-discipline, acknowledgment, and cooldown contracts.
4. Run focused checks after each behavioral increment.

### WI-005: Verify and close
State: done
Dependencies: WI-001, WI-002, WI-003, WI-004
Files:
- Modify: `.ledger/202608301046-refine-pair-review-responsiveness/evidence/final-verification.md`
- Modify: `.ledger/202608301046-refine-pair-review-responsiveness/retrospective.md`
Checks:
- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run pack:check`
- `git diff --check`
Steps:
1. Inspect the integrated diff for accidental public-surface or trust-boundary changes.
2. Run the complete repository validation matrix.
3. Record evidence, limits, and any live-system paths not exercised.
4. Reconcile the task, plan, and retrospective before archival.
