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

### WI-001: Consultation context and direct Advisor mode
State: completed

- Added typed, host-assembled consultation context and working-state fingerprints.
- Added `context_mode: consultation` for direct Advisor use.
- Added hidden read-only Advisor execution with typed `report_consultation`.

### WI-002: Sentinel escalation and host orchestration
State: completed

- Added private `escalate` beside `advise` without delegation or mutation capabilities.
- Added one-concurrent Advisor queue, semantic deduplication, turn throttling, staleness checks, cancellation, and typed outcome handling.
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
- `npm run test:sentinel` — 111 passed.
- `npx vitest run --maxWorkers=1` — 797 passed.
- `npm run test:loader` — passed.
- `npm run pack:check` — passed and includes the Sentinel component, extension, and docs.

The default parallel `npm test` run twice timed out only in the unrelated Ledger visual-companion WebSocket test. That test passed alone; the full unit suite passed with one worker. The flake is parked in the session backlog.
