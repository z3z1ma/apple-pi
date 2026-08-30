Status: active
Created: 2026-08-28
Updated: 2026-08-28

# Harness correctness implementation plan

## Goal

Resolve the complete audit through independent cohesive changes, regression tests, and repository-wide verification.

## Constraints

- Writers own disjoint production and test paths.
- Existing public behavior remains unless the audit names the contract as defective.
- The root session integrates, resolves cross-area failures, and runs final verification.

### WI-001: Pi Exec contracts and trust
State: done
Dependencies: None
Files:
- Modify: `extensions/runtime-*.ts`, `extensions/runtime-*.mjs`, `tests/runtime.test.ts`, neighboring runtime tests
Checks:
- Focused runtime Vitest tests
Steps:
1. Gate saved-program discovery and execution on project trust.
2. Align Bash failure, configured synchronous timeout, and JSON return validation.
3. Bound and clean state snapshots.
4. Make root droppable context marks resolve without serializing `undefined`.

### WI-002: Subagent ownership and policy
State: done
Dependencies: None
Files:
- Modify: `components/subagents/src/**`, `components/subagents/tests/**`
Checks:
- Subagent Vitest suites
Steps:
1. Enforce read-only tool policy structurally.
2. Introduce exclusive run ownership and exactly-once capacity accounting.
3. Bound resumed runs and preserve nested background semantics.
4. Isolate observer failures and publish resumed activity.

### WI-003: Pair and notebook lifecycle
State: done
Dependencies: None
Files:
- Modify: `components/notebook/src/**`, `components/notebook/tests/**`, `components/pair-programmer/src/**`, `components/pair-programmer/tests/**`, `tests/auto-compact-integration.test.ts`
Checks:
- Notebook, Pair, and auto-compact tests
Steps:
1. Make project configuration trust-aware.
2. Commit notebook maintenance as one durable envelope.
3. Serialize Pair runtime construction.
4. Remove failed and stale advisor entries from deduplication.
5. Make overflow interception process-owned with session-keyed state.

### WI-004: xAI fallback correctness
State: done
Dependencies: None
Files:
- Modify: `components/xai-context-compaction/src/**`, `components/xai-context-compaction/tests/**`
Checks:
- xAI compaction Vitest suites
Steps:
1. Preserve a continuation-quality textual fallback.
2. Attribute request rejection before disabling opaque injection.

### WI-005: Ledger transactions
State: done
Dependencies: None
Files:
- Modify: `extensions/ledger.ts`, `tests/ledger-add.test.ts`, `tests/ledger-close.test.ts`
Checks:
- Ledger Vitest suites
Steps:
1. Share a project-scoped lease across add and close.
2. Validate and stage before mutation.
3. Atomically update indexes and roll back failed moves.

### WI-006: Search safety and identity
State: done
Dependencies: None
Files:
- Modify: `components/session-search/src/**`, `components/session-search/tests/**`, related root session-search tests
Checks:
- Session-search Vitest suites
Steps:
1. Bound or reject unsafe regex evaluation.
2. Preserve actual turn identity before relevance ranking.
3. Require integer paging and expansion indices.

### WI-007: Durable auxiliary behavior
State: done
Dependencies: None
Files:
- Modify: `components/backlog/**`, `components/todos/**`, `components/notify/**`, `tsconfig.json`, `skills/ralph/references/ralph-ledger-review.js`
Checks:
- Focused backlog, todo, and notify tests; typecheck
Steps:
1. Publish backlog state only after persistence succeeds.
2. Recover stale shared locks and separate managed completion from root settlement.
3. Decouple notification processes from settlement latency.
4. Include TypeScript tests and correct the Ralph review task/status contract.

### WI-008: Integration and verification
State: done
Dependencies: WI-001, WI-002, WI-003, WI-004, WI-005, WI-006, WI-007
Files:
- Modify: only integration fixes and governing Ledger records
Checks:
- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run pack:check`
Steps:
1. Inspect and reconcile all diffs.
2. Run focused and full checks.
3. Resolve material regressions and record remaining empirical limits.
