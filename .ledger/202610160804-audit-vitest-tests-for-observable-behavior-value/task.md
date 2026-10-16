Status: in-progress
Created: 2026-10-16
Updated: 2026-10-16

# Audit Vitest tests for observable behavior value

## Intent

Identify tests and assertions that fail to protect observable contracts. Success means a reconciled Vitest inventory and independently checked recommendations with retained coverage and review gaps explicit.

## Current State

Approved pruning complete: 1,528 Vitest cases pass across all 146 files, down from 1,539. Removed duplicate cases, test-local aggregation, vacuous assertions, and historical implementation bans; strengthened native editing, rail styling, and worker-ownership checks. No production changes. See [outcome.md](outcome.md) for retained coverage, review limits, and validation.

## Next steps

Commit the validated changes, archive this task, and push as requested. The operator approved addressing the removal candidates and similar instances, then closing; this outcome does not claim exhaustive body-level review of every test. Existing changes to ledger production code and its two tests remain outside this work.

## Outcome

The removal candidates and verified similar instances are addressed. Independent coverage-preservation review found no material findings. Formatting, lint, typecheck, full Vitest, sidebar, offline pair, loader, package dry-run, and whitespace checks passed. Networked pair E2E and real terminal interaction were not exercised.
