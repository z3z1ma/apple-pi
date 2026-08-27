Status: active
Created: 2026-08-26
Updated: 2026-08-27

# Sentinel to Advisor implementation plan

## Goal

Land one coherent hierarchy: main agent, optional persistent Sentinel, and episodic deep Advisor sub-agent.

## Constraints

- Sentinel is the only persistent supervisor and `/sentinel` is its only command.
- Advisor names only the deep read-only sub-agent.
- Reuse trajectory projection, managed sub-agent execution, primary-bound recall, and safe-boundary delivery.
- Use throttling and deduplication, not absolute consultation budgets.
- Test deterministic machinery, not model output.
- Remove compatibility branches and minimize code.

### WI-001: Private Sentinel adjudication
State: completed

- Added typed, host-assembled consultation context and working-state fingerprints.
- Added hidden read-only Advisor execution with typed `report_consultation`.
- Kept ordinary `Agent` Advisor delegation separate from the private adjudication protocol.

### WI-002: Sentinel escalation and host orchestration
State: completed

- Added private `escalate` beside `advise` without delegation or mutation capabilities.
- Added one-concurrent Advisor queue, semantic deduplication, turn throttling, staleness checks, cancellation, and typed outcome handling.
- Consolidated boundary findings into one steer and closed terminal advisory episodes until the next user message.
- Added the conservative repeated-command-failure gate.

### WI-003: Names, profile, telemetry, and status
State: completed

- Keep only the `sentinel` persistent model profile and `.sentinel-state.json` enablement.
- Rename the persistent extension, component, command, APIs, fields, tests, and docs to Sentinel.
- Rename Counsel to the existing episodic Advisor sub-agent.
- Remove the old mode branch and compatibility surface.
- Distinguish `sentinel` and `advisor` usage and status.

### WI-004: Verification
State: completed

Checks:
- `npm run check` — passed.
- `npm run test:sentinel` — 112 passed.
- Focused Sentinel/Advisor/subagent suites — 63 passed.
- Vitest excluding the unrelated Ledger visual companion — 782 passed; its 14 tests passed separately.
- `npm run test:loader` — passed.
- `npm run pack:check` — passed and includes the Sentinel component, extension, and docs.

The full Vitest invocation timed out only in the unrelated Ledger visual-companion WebSocket test. The same file passed alone; all 796 tests pass when that flaky file is isolated. The flake remains parked in the session backlog.
