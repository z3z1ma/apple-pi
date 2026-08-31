Status: active
Created: 2026-08-30
Updated: 2026-08-30

# Harness surface simplification plan

## Goal

Deliver the approved reminder, Pi Exec description, operational ledger, naming, and terminology changes as small coherent increments while preserving the optional extensions and the distinct collaboration/composition behaviors.

## Constraints

- Keep saved Pi Exec programs and the existing guest API detail unchanged except for removing its duplicate placement.
- Keep `retrospective.md` as the concise learning artifact for every new ledger task.
- Preserve existing ledger task bundles without migration.
- Do not add compatibility aliases that retain removed model-facing names.
- Do not merge the interactive teammate lifecycle with Pi Exec workers.

### WI-001: Replace default tracking systems with self-reminders
State: complete
Dependencies: None
Files:
- Add: `components/reminders/`, `extensions/remind-me.ts`
- Move: `components/backlog/`, `components/todos/` to `optional-extensions/`
- Modify: package, loader, tests, and feature documentation
Checks:
- Focused reminder tests
- `npm run test:unit`
- `npm run typecheck`
- `npm run test:loader`
- `npm run pack:check`

### WI-002: Remove the duplicate Pi Exec contract
State: complete
Dependencies: None
Files:
- Modify: `extensions/runtime-api.ts`
- Modify: relevant runtime and package-load tests
Checks:
- Focused runtime tests
- Assert the complete guest contract remains on `code` and is absent from the top-level description
- `npm run typecheck`

### WI-003: Simplify the operational ledger
State: complete
Dependencies: WI-001
Files:
- Modify: `extensions/ledger.ts`
- Modify/Delete: `components/shared/src/ledger-system-prompt.ts`, `components/shared/src/workflow-system-prompt.ts`, `extensions/workflow.ts`
- Modify: ledger tests, package loader, docs, and ledger-related skills
Checks:
- ledger extension and prompt integration tests
- Package loader test
- `npm run typecheck`
Steps:
1. Remove the separate ambient workflow extension and its stripping machinery.
2. Replace the ledger system prompt with the approved concise operational-memory contract.
3. Make `ledger_add` create only `task.md` and `retrospective.md`.
4. Keep the retrospective concise and learning-focused; create other task artifacts only when useful.
5. Preserve existing task compatibility and archive behavior.

### WI-004: Normalize collaboration names and prose
State: complete
Dependencies: WI-002, WI-003
Files:
- Modify: subagent tool registration, Pi Exec guest runtime/API, tests, docs, skills, and user/model-facing prose
Checks:
- Subagent and runtime focused tests
- Package loader test
- Search assertions for obsolete model-facing `Agent`, `agents.run`, standalone `Pair`, and proper-noun `Ledger` prose, with explicit code/external-name exceptions
- `npm run typecheck`
Steps:
1. Rename root and nested `Agent` tools to `agent` without an alias.
2. Attach the structured worker API as `agent.run` and remove the model-facing `agents` global.
3. Preserve callable `agent()` behavior and the structured result behavior.
4. Refer to the ledger and pair programmer as common nouns in natural-language surfaces while leaving internal identifiers and external standards intact.

### WI-005: Reconcile and verify the integrated package
State: complete
Dependencies: WI-001, WI-002, WI-003, WI-004
Files:
- Modify: task records and any defects found by integration checks
Checks:
- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run pack:check`
- `git diff --check`
Steps:
1. Inspect the complete diff and package contents.
2. Measure the resulting model-facing surface against the initial inventory.
3. Record concise retrospective lessons and verification limits.
